/*---------------------------------------------------------------------------------------------
 *  Database Scripting Service
 *  Handles scripting database objects to files for Git version control
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as vscodeMssql from 'vscode-mssql';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';

/**
 * Enum for script operations (matching MSSQL extension)
 */
export enum ScriptOperation {
    Select = 0,
    Create = 1,
    Insert = 2,
    Update = 3,
    Delete = 4,
    Execute = 5,
    Alter = 6,
}

/**
 * Interface for database object metadata
 */
interface DatabaseObject {
    schema: string;
    name: string;
    type: string;
}

/**
 * Interface for database metadata stored in metadata.json
 */
interface DatabaseMetadata {
    databaseName: string;
    scriptedAt: string;
    totalObjectsScripted: number;
    totalErrors: number;
    objectTypes: string[];
    gitLinked: boolean;
    gitRepositoryUrl?: string;
    gitBranch?: string;
    gitLinkedDate?: string;
}

/**
 * Service responsible for scripting database objects to files
 */
export class DatabaseScriptingService {
    private readonly mssqlApi: vscodeMssql.IExtension;
    private readonly context: vscode.ExtensionContext;
    private currentDatabaseName: string = '';

    constructor(context: vscode.ExtensionContext, mssqlApi: vscodeMssql.IExtension) {
        this.context = context;
        this.mssqlApi = mssqlApi;
    }

    /**
     * Main method to script all database objects to files
     * @param node The database node from the object explorer
     */
    public async scriptDatabaseToFiles(node: vscodeMssql.ITreeNodeInfo): Promise<void> {
        // Get database name from the node
        const databaseName = this.mssqlApi.getDatabaseNameFromTreeNode(node);

        console.log(`[MSSQL-Git-Sync] ========== STARTING DATABASE SCRIPTING ==========`);
        console.log(`[MSSQL-Git-Sync] Database name from tree node: ${databaseName}`);
        console.log(`[MSSQL-Git-Sync] Node type: ${node.nodeType}`);
        console.log(`[MSSQL-Git-Sync] Node label: ${node.label}`);

        if (!databaseName) {
            throw new Error('Could not determine database name from the selected node');
        }

        // Get connection profile information
        const connectionProfile = node.connectionProfile;
        if (!connectionProfile) {
            throw new Error('No connection profile found for the selected node');
        }

        console.log(`[MSSQL-Git-Sync] Connection profile database: ${connectionProfile.database}`);
        console.log(`[MSSQL-Git-Sync] Connection profile server: ${connectionProfile.server}`);

        // Create a unique folder name for this connection-database pair
        const uniqueFolderName = this.generateUniqueFolderName(connectionProfile, databaseName);
        const outputPath = path.join(this.context.globalStorageUri.fsPath, uniqueFolderName);

        // Show progress notification
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Scripting database: ${databaseName}`,
                cancellable: false
            },
            async (progress) => {
                try {
                    // Ensure output directory and LocalCache subfolder exist
                    await fs.mkdir(outputPath, { recursive: true });
                    const localCachePath = path.join(outputPath, 'LocalCache');
                    await fs.mkdir(localCachePath, { recursive: true });

                    progress.report({ message: 'Preparing to script database objects...' });

                    // Get connection URI for this node
                    // This uses mssqlApi.connect() which creates a connection compatible with scriptObject()
                    const connectionUri = await this.getConnectionUri(node, databaseName);

                    // Store the current database name for use in all queries
                    this.currentDatabaseName = databaseName;

                    // Script different types of objects to LocalCache folder
                    await this.scriptObjectsByType(connectionUri, node, databaseName, outputPath, localCachePath, progress);

                    // Show success message with option to open folder
                    const openFolder = 'Open Folder';
                    const result = await vscode.window.showInformationMessage(
                        `Database "${databaseName}" scripted successfully to: ${localCachePath}`,
                        openFolder
                    );

                    if (result === openFolder) {
                        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(outputPath));
                    }

                } catch (error) {
                    throw error;
                }
            }
        );
    }

    /**
     * Link a database to a Git repository
     * @param node The database node from the object explorer
     */
    public async linkToGit(node: vscodeMssql.ITreeNodeInfo): Promise<void> {
        const { GitService } = await import('./gitService');
        const gitService = new GitService();

        // Get database name
        const databaseName = this.mssqlApi.getDatabaseNameFromTreeNode(node);
        if (!databaseName) {
            throw new Error('Could not determine database name from the selected node');
        }

        console.log(`[MSSQL-Git-Sync] ========== LINKING DATABASE TO GIT ==========`);
        console.log(`[MSSQL-Git-Sync] Database: ${databaseName}`);

        // Check if database is already linked
        const isLinked = await this.isGitLinked(node);
        if (isLinked) {
            const metadata = await this.readMetadata(this.getOutputPath(node));
            const repoInfo = metadata?.gitRepositoryUrl ? ` to ${metadata.gitRepositoryUrl}` : '';
            vscode.window.showWarningMessage(
                `Database "${databaseName}" is already linked to a Git repository${repoInfo}. Please unlink it first if you want to link to a different repository.`
            );
            return;
        }

        // Check if Git is installed
        const gitInstalled = await gitService.isGitInstalled();
        if (!gitInstalled) {
            throw new Error('Git is not installed on your system. Please install Git and try again.');
        }

        const gitVersion = await gitService.getGitVersion();
        console.log(`[MSSQL-Git-Sync] Git version: ${gitVersion}`);

        // Get output path
        const outputPath = this.getOutputPath(node);
        const sourceControlPath = path.join(outputPath, 'SourceControl');

        // Check if SourceControl folder already exists (shouldn't happen if metadata is correct)
        try {
            await fs.access(sourceControlPath);
            throw new Error('SourceControl folder already exists. Please remove it first or unlink the existing repository.');
        } catch (error) {
            // Folder doesn't exist, which is what we want
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw error;
            }
        }

        // Step 1: Prompt for Git repository URL
        const repositoryUrl = await vscode.window.showInputBox({
            prompt: 'Enter the Git repository URL',
            placeHolder: 'https://github.com/user/repo.git or git@github.com:user/repo.git',
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Repository URL cannot be empty';
                }
                if (!gitService.validateGitUrl(value)) {
                    return 'Invalid Git URL format. Use HTTPS (https://...) or SSH (git@...)';
                }
                return null;
            }
        });

        if (!repositoryUrl) {
            // User cancelled
            return;
        }

        console.log(`[MSSQL-Git-Sync] Repository URL: ${repositoryUrl}`);

        // Step 2: Fetch and display available branches
        let branches: string[] = [];
        try {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Fetching branches from repository...',
                    cancellable: false
                },
                async () => {
                    branches = await gitService.fetchRemoteBranches(repositoryUrl);
                }
            );
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to fetch branches: ${errorMessage}`);
        }

        if (!branches || branches.length === 0) {
            throw new Error('No branches found in the repository');
        }

        // Show branch selection QuickPick
        const selectedBranch = await vscode.window.showQuickPick(branches, {
            placeHolder: 'Select a branch to link',
            title: 'Select Git Branch'
        });

        if (!selectedBranch) {
            // User cancelled
            return;
        }

        console.log(`[MSSQL-Git-Sync] Selected branch: ${selectedBranch}`);

        // Step 3: Clone the repository
        try {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Linking to Git repository (branch: ${selectedBranch})...`,
                    cancellable: false
                },
                async (progress) => {
                    // Ensure SourceControl folder exists
                    await fs.mkdir(sourceControlPath, { recursive: true });

                    // Clone the repository
                    await gitService.cloneRepository(repositoryUrl, selectedBranch, sourceControlPath, progress);
                }
            );
        } catch (error) {
            // Clean up SourceControl folder if clone failed
            try {
                await fs.rm(sourceControlPath, { recursive: true, force: true });
            } catch (cleanupError) {
                console.error('[MSSQL-Git-Sync] Error cleaning up after failed clone:', cleanupError);
            }

            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to clone repository: ${errorMessage}`);
        }

        // Step 4: Save Git link metadata
        const metadata = await this.readMetadata(outputPath);
        const updatedMetadata: DatabaseMetadata = {
            ...(metadata || {
                databaseName: databaseName,
                scriptedAt: new Date().toISOString(),
                totalObjectsScripted: 0,
                totalErrors: 0,
                objectTypes: []
            }),
            gitLinked: true,
            gitRepositoryUrl: repositoryUrl,
            gitBranch: selectedBranch,
            gitLinkedDate: new Date().toISOString()
        };

        await this.writeMetadata(outputPath, updatedMetadata);

        console.log(`[MSSQL-Git-Sync] ✓ Successfully linked to Git repository`);

        // Show success message
        const openFolder = 'Open Folder';
        const result = await vscode.window.showInformationMessage(
            `Database "${databaseName}" successfully linked to Git repository (branch: ${selectedBranch})`,
            openFolder
        );

        if (result === openFolder) {
            await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(sourceControlPath));
        }
    }

    /**
     * Unlink a database from a Git repository
     * @param node The database node from the object explorer
     */
    public async unlinkFromGit(node: vscodeMssql.ITreeNodeInfo): Promise<void> {
        // Get database name
        const databaseName = this.mssqlApi.getDatabaseNameFromTreeNode(node);
        if (!databaseName) {
            throw new Error('Could not determine database name from the selected node');
        }

        console.log(`[MSSQL-Git-Sync] ========== UNLINKING DATABASE FROM GIT ==========`);
        console.log(`[MSSQL-Git-Sync] Database: ${databaseName}`);

        // Get output path
        const outputPath = this.getOutputPath(node);
        const sourceControlPath = path.join(outputPath, 'SourceControl');

        // Check if database is actually linked
        const isLinked = await this.isGitLinked(node);
        if (!isLinked) {
            vscode.window.showWarningMessage(`Database "${databaseName}" is not linked to a Git repository.`);
            return;
        }

        // Read current metadata to get repository info for the confirmation message
        const metadata = await this.readMetadata(outputPath);
        const repoInfo = metadata?.gitRepositoryUrl ? ` (${metadata.gitRepositoryUrl})` : '';

        // Show confirmation dialog
        const confirmMessage = `Are you sure you want to unlink this database from Git${repoInfo}? This will delete the SourceControl folder and all its contents.`;
        const unlinkButton = 'Unlink';
        const cancelButton = 'Cancel';

        const result = await vscode.window.showWarningMessage(
            confirmMessage,
            { modal: true },
            unlinkButton,
            cancelButton
        );

        if (result !== unlinkButton) {
            // User cancelled
            console.log(`[MSSQL-Git-Sync] Unlink cancelled by user`);
            return;
        }

        console.log(`[MSSQL-Git-Sync] User confirmed unlink operation`);

        // Delete the SourceControl folder
        try {
            console.log(`[MSSQL-Git-Sync] Deleting SourceControl folder: ${sourceControlPath}`);

            // Check if folder exists before trying to delete
            try {
                await fs.access(sourceControlPath);
                // Folder exists, delete it
                await fs.rm(sourceControlPath, { recursive: true, force: true });
                console.log(`[MSSQL-Git-Sync] ✓ SourceControl folder deleted successfully`);
            } catch (accessError) {
                // Folder doesn't exist, which is fine
                if ((accessError as NodeJS.ErrnoException).code === 'ENOENT') {
                    console.log(`[MSSQL-Git-Sync] SourceControl folder doesn't exist, skipping deletion`);
                } else {
                    throw accessError;
                }
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`[MSSQL-Git-Sync] Error deleting SourceControl folder: ${errorMessage}`);
            throw new Error(`Failed to delete SourceControl folder: ${errorMessage}`);
        }

        // Update metadata to reflect unlinked status
        try {
            const updatedMetadata: DatabaseMetadata = {
                ...(metadata || {
                    databaseName: databaseName,
                    scriptedAt: new Date().toISOString(),
                    totalObjectsScripted: 0,
                    totalErrors: 0,
                    objectTypes: []
                }),
                gitLinked: false,
                gitRepositoryUrl: undefined,
                gitBranch: undefined,
                gitLinkedDate: undefined
            };

            await this.writeMetadata(outputPath, updatedMetadata);
            console.log(`[MSSQL-Git-Sync] ✓ Metadata updated successfully`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`[MSSQL-Git-Sync] Error updating metadata: ${errorMessage}`);
            throw new Error(`Failed to update metadata: ${errorMessage}`);
        }

        console.log(`[MSSQL-Git-Sync] ✓ Successfully unlinked from Git repository`);

        // Show success message
        vscode.window.showInformationMessage(
            `Database "${databaseName}" successfully unlinked from Git repository`
        );
    }

    /**
     * Get the database name from a tree node (public method for external access)
     * @param node The tree node
     * @returns The database name or undefined
     */
    public getDatabaseName(node: vscodeMssql.ITreeNodeInfo): string | undefined {
        return this.mssqlApi.getDatabaseNameFromTreeNode(node);
    }

    /**
     * Get Git metadata for a database node (public method for external access)
     * @param node The tree node
     * @returns The metadata or undefined
     */
    public async getGitMetadata(node: vscodeMssql.ITreeNodeInfo): Promise<DatabaseMetadata | undefined> {
        try {
            const outputPath = this.getOutputPath(node);
            const metadata = await this.readMetadata(outputPath);
            return metadata || undefined;
        } catch (error) {
            return undefined;
        }
    }

    /**
     * Generate a unique, deterministic folder name based on connection details and database name
     * @param connectionProfile The connection profile
     * @param databaseName The database name
     * @returns A unique folder name
     */
    private generateUniqueFolderName(connectionProfile: vscodeMssql.IConnectionInfo, databaseName: string): string {
        // Create a string that uniquely identifies this connection-database pair
        const server = connectionProfile.server || 'unknown-server';
        const user = connectionProfile.user || 'default-user';
        const port = connectionProfile.port || '';
        
        // Sanitize server name (remove special characters that aren't filesystem-friendly)
        const sanitizedServer = server.replace(/[^a-zA-Z0-9-_.]/g, '_');
        const sanitizedDatabase = databaseName.replace(/[^a-zA-Z0-9-_.]/g, '_');
        
        // Create a hash of the full connection details for uniqueness
        const connectionString = `${server}:${port}:${user}:${databaseName}`;
        const hash = crypto.createHash('md5').update(connectionString).digest('hex').substring(0, 8);
        
        // Combine sanitized names with hash
        return `${sanitizedServer}_${sanitizedDatabase}_${hash}`;
    }

    /**
     * Get a connection URI for the given node
     *
     * This method implements a two-step approach to solve the "works on second attempt" issue:
     *
     * 1. REUSE EXISTING CONNECTION (if available):
     *    - Checks if there's an active query editor connection for the same database
     *    - If found, reuses that connection (already fully initialized)
     *    - This is why Scenario 2 (with "New Query" open) works immediately
     *
     * 2. CREATE NEW CONNECTION (if needed):
     *    - Creates a new connection via connectionSharing.connect()
     *    - Polls the connection with test queries until it's fully ready
     *    - No arbitrary time delays - uses actual connection state
     *
     * This eliminates the need for arbitrary 10-15 second delays and makes
     * Scenario 1 work as reliably as Scenario 2.
     *
     * @param node The tree node
     * @param databaseName The database name to connect to
     * @returns The connection URI (either reused or newly created)
     */
    private async getConnectionUri(node: vscodeMssql.ITreeNodeInfo, databaseName: string): Promise<string> {
        const connectionProfile = node.connectionProfile;

        if (!connectionProfile) {
            throw new Error('No connection profile available');
        }

        // The connection profile should have an 'id' property, but TypeScript doesn't know about it
        // because IConnectionInfo doesn't include it. However, at runtime, the profile is actually
        // an IConnectionProfile which does have an id.
        const profileWithId = connectionProfile as any;
        const connectionId = profileWithId.id;

        if (!connectionId) {
            throw new Error('Connection profile does not have an ID. This should not happen.');
        }

        // Use a short extension ID to avoid 128-character limit errors
        // The extension ID is used in the connection URI and can cause length issues
        const extensionId = 'mssql-git-sync';

        try {
            console.log(`[MSSQL-Git-Sync] ========== CONNECTION SETUP ==========`);
            console.log(`[MSSQL-Git-Sync] Database: ${databaseName}`);
            console.log(`[MSSQL-Git-Sync] Server: ${connectionProfile.server}`);
            console.log(`[MSSQL-Git-Sync] Connection ID: ${connectionId}`);

            // STEP 1: Check if there's an existing active connection we can reuse
            // This is the key to making Scenario 1 work like Scenario 2
            console.log(`[MSSQL-Git-Sync] Checking for existing active connection...`);

            try {
                const activeConnectionId = await vscode.commands.executeCommand<string>(
                    'mssql.connectionSharing.getActiveEditorConnectionId',
                    extensionId
                );

                if (activeConnectionId) {
                    console.log(`[MSSQL-Git-Sync] Found active editor connection ID: ${activeConnectionId}`);

                    // Check if the active connection matches our target connection
                    if (activeConnectionId === connectionId) {
                        const activeDatabase = await vscode.commands.executeCommand<string>(
                            'mssql.connectionSharing.getActiveDatabase',
                            extensionId
                        );

                        console.log(`[MSSQL-Git-Sync] Active connection database: ${activeDatabase}`);

                        // If the active connection is for the same database, try to reuse it
                        if (activeDatabase === databaseName) {
                            console.log(`[MSSQL-Git-Sync] ✓ Reusing existing active connection for ${databaseName}`);

                            // Get the active editor's URI to use as connection URI
                            const activeEditor = vscode.window.activeTextEditor;
                            if (activeEditor) {
                                const editorUri = activeEditor.document.uri.toString(true);
                                console.log(`[MSSQL-Git-Sync] Using active editor URI as connection URI`);
                                console.log(`[MSSQL-Git-Sync] ✓ Connection ready immediately (reused existing connection)`);
                                return editorUri;
                            }
                        }
                    }
                }
            } catch (error) {
                // No active connection or error checking - that's fine, we'll create a new one
                console.log(`[MSSQL-Git-Sync] No active connection found or error checking: ${error}`);
            }

            console.log(`[MSSQL-Git-Sync] No suitable active connection found, creating new connection...`);

            // STEP 2: No existing connection, create a new one
            const uri = await vscode.commands.executeCommand<string>(
                'mssql.connectionSharing.connect',
                extensionId,
                connectionId,
                databaseName
            );

            if (!uri) {
                throw new Error('Connection sharing service returned undefined URI');
            }

            console.log(`[MSSQL-Git-Sync] New connection created: ${uri}`);

            // STEP 3: Add a mandatory settling delay
            // Even though connect() waits for the connection complete notification,
            // the connection needs additional time to be ready for complex queries
            const settlingDelay = 3000; // 3 seconds
            console.log(`[MSSQL-Git-Sync] Waiting ${settlingDelay}ms for connection to settle...`);
            await new Promise(resolve => setTimeout(resolve, settlingDelay));

            // STEP 4: Wait for the new connection to be fully ready
            // This is necessary because connect() returns before the connection is fully initialized
            await this.waitForConnectionReady(uri);

            return uri;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`[MSSQL-Git-Sync] Failed to establish connection: ${errorMessage}`);
            console.error(`[MSSQL-Git-Sync] Connection details: Server=${connectionProfile.server}, Database=${databaseName}, ConnectionId=${connectionId}`);
            throw new Error(`Failed to establish connection: ${errorMessage}`);
        }
    }

    /**
     * Wait for connection to be fully established and ready to use
     * Uses a polling approach with retries to ensure the connection is truly ready
     * @param connectionUri The connection URI to verify
     */
    private async waitForConnectionReady(connectionUri: string): Promise<void> {
        const maxRetries = 30; // Give it plenty of attempts
        const retryDelayMs = 500; // Check every 500ms

        console.log(`[MSSQL-Git-Sync] Verifying new connection is ready...`);

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                // Try to execute a simple query to verify connection is ready
                const testQuery = `SELECT DB_NAME() AS CurrentDatabase, @@VERSION AS ServerVersion`;
                const result = await vscode.commands.executeCommand<vscodeMssql.SimpleExecuteResult>(
                    'mssql.connectionSharing.executeSimpleQuery',
                    connectionUri,
                    testQuery
                );

                if (result && result.rows && result.rows.length > 0) {
                    const currentDb = String(result.rows[0][0].displayValue);
                    const serverVersion = String(result.rows[0][1].displayValue);

                    console.log(`[MSSQL-Git-Sync] ✓ Connection ready after ${attempt * retryDelayMs}ms`);
                    console.log(`[MSSQL-Git-Sync] Connected to database: ${currentDb}`);
                    console.log(`[MSSQL-Git-Sync] Server version: ${serverVersion.substring(0, 100)}...`);

                    // Warm up the connection with multiple queries to fully initialize it
                    // This is critical - the connection needs to be "exercised" before complex batch queries work
                    console.log(`[MSSQL-Git-Sync] Priming connection with test queries...`);

                    try {
                        // Query 1: Simple metadata query
                        const warmup1 = `SELECT TOP 1 name FROM sys.objects WHERE type = 'U'`;
                        await vscode.commands.executeCommand<vscodeMssql.SimpleExecuteResult>(
                            'mssql.connectionSharing.executeSimpleQuery',
                            connectionUri,
                            warmup1
                        );
                        console.log(`[MSSQL-Git-Sync] ✓ Warm-up query 1 successful`);

                        // Query 2: More complex query with joins (similar to batch queries)
                        const warmup2 = `
                            SELECT TOP 1
                                SCHEMA_NAME(t.schema_id) + '.' + t.name AS ObjectKey,
                                TYPE_NAME(c.user_type_id) AS DataType
                            FROM sys.tables t
                            INNER JOIN sys.columns c ON c.object_id = t.object_id
                            ORDER BY t.name
                        `;
                        await vscode.commands.executeCommand<vscodeMssql.SimpleExecuteResult>(
                            'mssql.connectionSharing.executeSimpleQuery',
                            connectionUri,
                            warmup2
                        );
                        console.log(`[MSSQL-Git-Sync] ✓ Warm-up query 2 successful`);

                        // Query 3: Query with string concatenation (like our batch queries)
                        const warmup3 = `
                            SELECT TOP 1
                                'CREATE TABLE [' + SCHEMA_NAME(t.schema_id) + '].[' + t.name + ']' AS Script
                            FROM sys.tables t
                        `;
                        await vscode.commands.executeCommand<vscodeMssql.SimpleExecuteResult>(
                            'mssql.connectionSharing.executeSimpleQuery',
                            connectionUri,
                            warmup3
                        );
                        console.log(`[MSSQL-Git-Sync] ✓ Warm-up query 3 successful`);

                        console.log(`[MSSQL-Git-Sync] ✓ Connection fully primed and ready`);
                    } catch (warmupError) {
                        console.warn(`[MSSQL-Git-Sync] ⚠️ Warm-up query failed: ${warmupError}`);
                        console.warn(`[MSSQL-Git-Sync] Continuing anyway, but first batch query may fail...`);
                    }

                    return;
                }
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);

                if (attempt < maxRetries) {
                    // Wait before retrying
                    await new Promise(resolve => setTimeout(resolve, retryDelayMs));
                } else {
                    // Last attempt failed
                    console.error(`[MSSQL-Git-Sync] ❌ Connection failed to become ready after ${maxRetries * retryDelayMs}ms`);
                    console.error(`[MSSQL-Git-Sync] Last error: ${errorMessage}`);
                    throw new Error(`Connection failed to become ready: ${errorMessage}`);
                }
            }
        }
    }

    /**
     * Write file only if content has changed
     * @param filePath The path to the file
     * @param content The new content
     * @returns True if file was updated, false if unchanged
     */
    private async writeFileIfChanged(filePath: string, content: string): Promise<boolean> {
        try {
            // Try to read existing file
            const existingContent = await fs.readFile(filePath, 'utf8');

            // Compare content
            if (existingContent === content) {
                // Content is identical, skip writing
                return false;
            }

            // Content is different, write the file
            await fs.writeFile(filePath, content, 'utf8');
            return true;
        } catch (error) {
            // File doesn't exist or can't be read, write it
            await fs.writeFile(filePath, content, 'utf8');
            return true;
        }
    }

    /**
     * Read metadata from metadata.json file
     * @param rootPath The root output path
     * @returns The metadata object or null if file doesn't exist
     */
    private async readMetadata(rootPath: string): Promise<DatabaseMetadata | null> {
        try {
            const metadataPath = path.join(rootPath, 'metadata.json');
            const content = await fs.readFile(metadataPath, 'utf8');
            return JSON.parse(content) as DatabaseMetadata;
        } catch (error) {
            // File doesn't exist or can't be read
            return null;
        }
    }

    /**
     * Write metadata to metadata.json file
     * @param rootPath The root output path
     * @param metadata The metadata to write
     */
    private async writeMetadata(rootPath: string, metadata: DatabaseMetadata): Promise<void> {
        const metadataPath = path.join(rootPath, 'metadata.json');
        await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
    }

    /**
     * Check if a database is linked to a Git repository
     * @param node The database node from the object explorer
     * @returns True if the database is linked to Git
     */
    public async isGitLinked(node: vscodeMssql.ITreeNodeInfo): Promise<boolean> {
        try {
            const databaseName = this.mssqlApi.getDatabaseNameFromTreeNode(node);
            if (!databaseName) {
                return false;
            }

            const connectionProfile = node.connectionProfile;
            if (!connectionProfile) {
                return false;
            }

            // Get the output path for this database
            const uniqueFolderName = this.generateUniqueFolderName(connectionProfile, databaseName);
            const outputPath = path.join(this.context.globalStorageUri.fsPath, uniqueFolderName);

            // Read metadata
            const metadata = await this.readMetadata(outputPath);
            return metadata?.gitLinked === true;
        } catch (error) {
            console.error('[MSSQL-Git-Sync] Error checking Git link status:', error);
            return false;
        }
    }

    /**
     * Get the output path for a database
     * @param node The database node from the object explorer
     * @returns The output path
     */
    public getOutputPath(node: vscodeMssql.ITreeNodeInfo): string {
        const databaseName = this.mssqlApi.getDatabaseNameFromTreeNode(node);
        const connectionProfile = node.connectionProfile;

        if (!databaseName || !connectionProfile) {
            throw new Error('Could not determine database name or connection profile');
        }

        const uniqueFolderName = this.generateUniqueFolderName(connectionProfile, databaseName);
        return path.join(this.context.globalStorageUri.fsPath, uniqueFolderName);
    }

    /**
     * Verify and switch to the correct database context
     *
     * The connectionSharing.connect() method does not honor the database parameter,
     * so we need to explicitly switch to the correct database using a USE statement.
     *
     * @param connectionUri The connection URI
     * @param expectedDatabase The expected database name
     */
    private async verifyDatabaseContext(connectionUri: string, expectedDatabase: string): Promise<void> {
        try {
            console.log(`[MSSQL-Git-Sync] ========== VERIFYING DATABASE CONTEXT ==========`);
            console.log(`[MSSQL-Git-Sync] Expected database: ${expectedDatabase}`);

            // Query to get the current database name
            const query = 'SELECT DB_NAME() AS CurrentDatabase';
            const result = await this.mssqlApi.connectionSharing.executeSimpleQuery(connectionUri, query);

            if (result.rows.length > 0) {
                const actualDatabase = String(result.rows[0][0].displayValue);
                console.log(`[MSSQL-Git-Sync] Actual database (from DB_NAME()): ${actualDatabase}`);

                if (actualDatabase.toLowerCase() !== expectedDatabase.toLowerCase()) {
                    console.log(`[MSSQL-Git-Sync] Database context mismatch detected - switching to correct database...`);

                    // Execute USE statement to switch to the correct database
                    // Use square brackets to handle database names with special characters or spaces
                    // Note: USE statement doesn't return a result set, so we wrap it with a query that does
                    const useStatement = `USE [${expectedDatabase}]; SELECT DB_NAME() AS CurrentDatabase;`;
                    console.log(`[MSSQL-Git-Sync] Executing: USE [${expectedDatabase}]`);

                    try {
                        const switchResult = await this.mssqlApi.connectionSharing.executeSimpleQuery(connectionUri, useStatement);

                        // The result should be from the SELECT DB_NAME() query
                        if (switchResult.rows.length > 0) {
                            const newDatabase = String(switchResult.rows[0][0].displayValue);
                            console.log(`[MSSQL-Git-Sync] Database after USE statement: ${newDatabase}`);

                            if (newDatabase.toLowerCase() !== expectedDatabase.toLowerCase()) {
                                throw new Error(`Failed to switch database context. Still connected to: "${newDatabase}"`);
                            }

                            console.log(`[MSSQL-Git-Sync] ✓ Successfully switched to database: ${newDatabase}`);
                        } else {
                            throw new Error('USE statement executed but no result returned from verification query');
                        }
                    } catch (error) {
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        console.error(`[MSSQL-Git-Sync] Failed to switch database: ${errorMessage}`);
                        throw new Error(`Failed to switch to database "${expectedDatabase}": ${errorMessage}`);
                    }
                } else {
                    console.log(`[MSSQL-Git-Sync] ✓ Database context is already correct`);
                }

                console.log(`[MSSQL-Git-Sync] ✓ Database context verified successfully`);
            } else {
                throw new Error('Failed to verify database context - no results from DB_NAME() query');
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`[MSSQL-Git-Sync] Failed to verify database context: ${errorMessage}`);
            throw error;
        }
    }

    /**
     * Wrap a query with USE statement to ensure it executes against the correct database
     * This is critical because the connection API doesn't always honor the database parameter
     * @param query The SQL query to execute
     * @returns The query wrapped with USE statement
     */
    private wrapQueryWithUseStatement(query: string): string {
        if (!this.currentDatabaseName) {
            console.warn(`[MSSQL-Git-Sync] Warning: No current database name set, query will execute without USE statement`);
            return query;
        }

        // Prepend USE statement to ensure query executes against correct database
        // Use square brackets to handle database names with special characters
        const wrappedQuery = `USE [${this.currentDatabaseName}];\n${query}`;
        return wrappedQuery;
    }

    /**
     * Execute a query with retry logic for transient connection issues
     * NOTE: We do NOT add USE [DatabaseName] statements because the connection
     * is already connected to the correct database via connectionSharing.connect(extensionId, connectionId, databaseName)
     * @param connectionUri The connection URI
     * @param query The SQL query to execute
     * @returns The query result
     */
    private async executeQueryWithDatabaseContext(
        connectionUri: string,
        query: string
    ): Promise<any> {
        // Do NOT wrap with USE statement - connection is already on the correct database
        const wrappedQuery = query;

        const maxRetries = 5; // Increased from 3
        const retryDelayMs = 2000; // Increased from 1000ms to 2000ms

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                if (attempt === 1) {
                    console.log(`[MSSQL-Git-Sync] Executing query with database context: ${this.currentDatabaseName} (COMMAND-BASED)`);
                } else {
                    console.log(`[MSSQL-Git-Sync] Retry attempt ${attempt}/${maxRetries} for query execution`);
                }

                // Use COMMAND-BASED approach for executeSimpleQuery
                const result = await vscode.commands.executeCommand<vscodeMssql.SimpleExecuteResult>(
                    'mssql.connectionSharing.executeSimpleQuery',
                    connectionUri,
                    wrappedQuery
                );

                if (attempt > 1) {
                    console.log(`[MSSQL-Git-Sync] ✓ Query succeeded on attempt ${attempt}/${maxRetries}`);
                } else {
                    console.log(`[MSSQL-Git-Sync] ✓ Query executed successfully`);
                }

                return result;
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);

                // Check if it's a transient connection error
                const isTransientError = errorMessage.includes('OwnerUri') ||
                                       errorMessage.includes('connection') ||
                                       errorMessage.includes('timeout') ||
                                       errorMessage.includes('Invalid');

                if (isTransientError && attempt < maxRetries) {
                    console.warn(`[MSSQL-Git-Sync] ⚠️ Query failed (attempt ${attempt}/${maxRetries}): ${errorMessage}`);
                    console.warn(`[MSSQL-Git-Sync] Waiting ${retryDelayMs}ms before retry...`);
                    await new Promise(resolve => setTimeout(resolve, retryDelayMs));
                } else {
                    // Not a transient error or last attempt - throw
                    if (attempt === maxRetries) {
                        console.error(`[MSSQL-Git-Sync] ❌ Query failed after ${maxRetries} attempts (${maxRetries * retryDelayMs / 1000} seconds)`);
                        console.error(`[MSSQL-Git-Sync] Final error: ${errorMessage}`);
                    } else {
                        console.error(`[MSSQL-Git-Sync] Query execution failed (non-transient error): ${errorMessage}`);
                    }
                    console.error(`[MSSQL-Git-Sync] Query: ${wrappedQuery.substring(0, 200)}...`);
                    throw error;
                }
            }
        }

        // Should never reach here, but TypeScript needs it
        throw new Error('Query execution failed after all retries');
    }

    /**
     * Verify connection is still valid and reconnect if needed
     * @param connectionUri The current connection URI
     * @param node The tree node
     * @param databaseName The database name
     * @returns The connection URI (same if still valid, new if reconnected)
     */
    private async ensureConnectionValid(
        connectionUri: string,
        node: vscodeMssql.ITreeNodeInfo,
        databaseName: string
    ): Promise<string> {
        try {
            // Try a simple query to verify connection is still valid
            const testQuery = 'SELECT 1 AS Test';
            await vscode.commands.executeCommand<vscodeMssql.SimpleExecuteResult>(
                'mssql.connectionSharing.executeSimpleQuery',
                connectionUri,
                testQuery
            );
            console.log(`[MSSQL-Git-Sync] ✓ Connection is still valid`);
            return connectionUri; // Connection is still valid
        } catch (error) {
            console.warn(`[MSSQL-Git-Sync] ⚠️ Connection is no longer valid, reconnecting...`);
            console.warn(`[MSSQL-Git-Sync] Error: ${error instanceof Error ? error.message : String(error)}`);

            // Connection is invalid, create a new one
            const newConnectionUri = await this.getConnectionUri(node, databaseName);
            console.log(`[MSSQL-Git-Sync] ✓ Reconnected successfully`);
            return newConnectionUri;
        }
    }

    /**
     * Script objects by type to organized folders
     * @param connectionUri The connection URI
     * @param node The tree node (for reconnection if needed)
     * @param databaseName The database name
     * @param rootPath The root output path (for metadata.json)
     * @param localCachePath The LocalCache subfolder path (for SQL files)
     * @param progress Progress reporter
     * @returns The final connection URI (may be different if reconnection occurred)
     */
    private async scriptObjectsByType(
        connectionUri: string,
        node: vscodeMssql.ITreeNodeInfo,
        databaseName: string,
        rootPath: string,
        localCachePath: string,
        progress: vscode.Progress<{ message?: string; increment?: number }>
    ): Promise<string> {
        // Define object types to script with their SQL query types
        const objectTypes = [
            { type: 'Table', folder: 'Tables', sqlType: 'U' },
            { type: 'View', folder: 'Views', sqlType: 'V' },
            { type: 'StoredProcedure', folder: 'StoredProcedures', sqlType: 'P' },
            { type: 'UserDefinedFunction', folder: 'Functions', sqlType: 'FN,IF,TF' },
            { type: 'Trigger', folder: 'Triggers', sqlType: 'TR' }
        ];

        let totalScripted = 0;
        let totalErrors = 0;
        let currentConnectionUri = connectionUri;

        for (const objType of objectTypes) {
            // Verify connection is still valid before processing each object type
            console.log(`[MSSQL-Git-Sync] Verifying connection before processing ${objType.folder}...`);
            currentConnectionUri = await this.ensureConnectionValid(currentConnectionUri, node, databaseName);

            progress.report({ message: `Querying ${objType.folder}...` });

            // Create folder for this object type in LocalCache
            const typePath = path.join(localCachePath, objType.folder);
            await fs.mkdir(typePath, { recursive: true });

            try {
                // Query database for objects of this type
                const objects = await this.queryDatabaseObjects(currentConnectionUri, objType.sqlType);

                if (objects.length === 0) {
                    progress.report({ message: `No ${objType.folder} found` });
                    continue;
                }

                progress.report({ message: `Scripting ${objects.length} ${objType.folder} in batch...` });

                // Script all objects of this type in a single batch query
                try {
                    const scripts = await this.scriptObjectsBatch(currentConnectionUri, objects, objType.type);

                    // Write each script to file (only if content changed)
                    let filesUpdated = 0;
                    let filesSkipped = 0;

                    for (const [key, script] of scripts.entries()) {
                        try {
                            const obj = objects.find(o => `${o.schema}.${o.name}` === key);
                            if (!obj || !script) continue;

                            // Save script to file (only if changed)
                            const fileName = `${obj.schema}.${obj.name}.sql`;
                            const filePath = path.join(typePath, fileName);
                            const wasUpdated = await this.writeFileIfChanged(filePath, script);

                            if (wasUpdated) {
                                filesUpdated++;
                            } else {
                                filesSkipped++;
                            }
                            totalScripted++;
                        } catch (error) {
                            console.error(`Error writing file for ${key}:`, error);
                            totalErrors++;
                        }
                    }

                    console.log(`[MSSQL-Git-Sync] ${objType.folder}: ${filesUpdated} updated, ${filesSkipped} unchanged`);


                    console.log(`[MSSQL-Git-Sync] ✓ Successfully scripted ${scripts.size} ${objType.folder}`);
                } catch (error) {
                    console.error(`Error batch scripting ${objType.folder}:`, error);
                    totalErrors++;
                }
            } catch (error) {
                console.error(`Error processing ${objType.folder}:`, error);
                totalErrors++;
            }
        }

        // Create a metadata file with connection and database information in the root folder
        const metadataPath = path.join(rootPath, 'metadata.json');
        const metadata = {
            databaseName: databaseName,
            scriptedAt: new Date().toISOString(),
            totalObjectsScripted: totalScripted,
            totalErrors: totalErrors,
            objectTypes: objectTypes.map(t => t.type),
            gitLinked: false  // Default to not linked
        };
        await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');

        progress.report({ message: `Scripting complete! ${totalScripted} objects scripted, ${totalErrors} errors` });

        // Return the final connection URI (may be different if reconnection occurred)
        return currentConnectionUri;
    }

    /**
     * Query database for objects of a specific type
     * @param connectionUri The connection URI
     * @param sqlType The SQL object type code (U=Table, V=View, P=Procedure, etc.)
     * @returns Array of database objects
     */
    private async queryDatabaseObjects(connectionUri: string, sqlType: string): Promise<DatabaseObject[]> {
        // Build query to get objects of the specified type
        const typeList = sqlType.split(',').map(t => `'${t}'`).join(',');
        const query = `
            SELECT
                SCHEMA_NAME(schema_id) AS [schema],
                name,
                type_desc AS [type]
            FROM sys.objects
            WHERE type IN (${typeList})
                AND is_ms_shipped = 0
            ORDER BY SCHEMA_NAME(schema_id), name
        `;

        try {
            console.log(`[MSSQL-Git-Sync] Querying database objects of type: ${sqlType}`);
            console.log(`[MSSQL-Git-Sync] Using connection URI: ${connectionUri}`);

            // Verify connection is still valid before querying
            const isConnected = this.mssqlApi.connectionSharing.isConnected(connectionUri);
            if (!isConnected) {
                throw new Error(`Connection URI is not connected: ${connectionUri}`);
            }

            // Execute query with automatic USE statement prepending
            const result = await this.executeQueryWithDatabaseContext(connectionUri, query);

            const objects: DatabaseObject[] = [];
            for (const row of result.rows) {
                objects.push({
                    schema: String(row[0].displayValue),
                    name: String(row[1].displayValue),
                    type: String(row[2].displayValue)
                });
            }

            console.log(`[MSSQL-Git-Sync] Found ${objects.length} objects of type ${sqlType}`);
            return objects;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`[MSSQL-Git-Sync] Error querying database objects: ${errorMessage}`);
            console.error(`[MSSQL-Git-Sync] Connection URI: ${connectionUri}`);
            console.error(`[MSSQL-Git-Sync] SQL Type: ${sqlType}`);
            throw new Error(`Failed to query database objects: ${errorMessage}`);
        }
    }

    /**
     * Script a single database object using SQL queries instead of the scripting API
     *
     * This approach uses system stored procedures and queries to generate CREATE scripts
     * instead of relying on the problematic scriptObject API.
     *
     * @param connectionUri The connection URI
     * @param obj The database object to script
     * @param objectType The object type for scripting
     * @returns The scripted SQL
     */
    private async scriptObject(connectionUri: string, obj: DatabaseObject, objectType: string): Promise<string | undefined> {
        try {
            console.log(`[MSSQL-Git-Sync] Scripting object: ${obj.schema}.${obj.name} (Type: ${obj.type})`);

            // Use SQL queries to get the object definition
            // This is more reliable than the scripting API
            let script: string | undefined;

            switch (obj.type.toUpperCase()) {
                case 'USER_TABLE':
                case 'TABLE':
                    script = await this.scriptTable(connectionUri, obj);
                    break;
                case 'VIEW':
                    script = await this.scriptView(connectionUri, obj);
                    break;
                case 'SQL_STORED_PROCEDURE':
                case 'STORED_PROCEDURE':
                    script = await this.scriptStoredProcedure(connectionUri, obj);
                    break;
                case 'SQL_SCALAR_FUNCTION':
                case 'SQL_TABLE_VALUED_FUNCTION':
                case 'SQL_INLINE_TABLE_VALUED_FUNCTION':
                case 'FUNCTION':
                    script = await this.scriptFunction(connectionUri, obj);
                    break;
                case 'SQL_TRIGGER':
                case 'TRIGGER':
                    script = await this.scriptTrigger(connectionUri, obj);
                    break;
                default:
                    console.warn(`[MSSQL-Git-Sync] Unsupported object type: ${obj.type}`);
                    return undefined;
            }

            if (script) {
                console.log(`[MSSQL-Git-Sync] ✓ Successfully scripted: ${obj.schema}.${obj.name}`);
            }

            return script;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`[MSSQL-Git-Sync] Error scripting ${obj.schema}.${obj.name}: ${errorMessage}`);
            throw error;
        }
    }

    /**
     * Script a table using SQL queries
     */
    private async scriptTable(connectionUri: string, obj: DatabaseObject): Promise<string> {
        // Use sp_helptext or INFORMATION_SCHEMA to get table definition
        // For now, return a simple CREATE TABLE statement
        const query = `
            USE [${this.currentDatabaseName}];

            DECLARE @TableName NVARCHAR(256) = N'${obj.name}';
            DECLARE @SchemaName NVARCHAR(256) = N'${obj.schema}';

            SELECT
                'CREATE TABLE [' + @SchemaName + '].[' + @TableName + '] (' + CHAR(13) + CHAR(10) +
                STUFF((
                    SELECT
                        '    [' + c.name + '] ' +
                        t.name +
                        CASE
                            WHEN t.name IN ('varchar', 'char', 'varbinary', 'binary')
                                THEN '(' + CASE WHEN c.max_length = -1 THEN 'MAX' ELSE CAST(c.max_length AS VARCHAR(5)) END + ')'
                            WHEN t.name IN ('nvarchar', 'nchar')
                                THEN '(' + CASE WHEN c.max_length = -1 THEN 'MAX' ELSE CAST(c.max_length/2 AS VARCHAR(5)) END + ')'
                            WHEN t.name IN ('decimal', 'numeric')
                                THEN '(' + CAST(c.precision AS VARCHAR(5)) + ',' + CAST(c.scale AS VARCHAR(5)) + ')'
                            ELSE ''
                        END +
                        CASE WHEN c.is_nullable = 1 THEN ' NULL' ELSE ' NOT NULL' END +
                        ',' + CHAR(13) + CHAR(10)
                    FROM sys.columns c
                    INNER JOIN sys.types t ON c.user_type_id = t.user_type_id
                    WHERE c.object_id = OBJECT_ID(@SchemaName + '.' + @TableName)
                    ORDER BY c.column_id
                    FOR XML PATH(''), TYPE
                ).value('.', 'NVARCHAR(MAX)'), 1, 0, '') +
                ');' AS ScriptText;
        `;

        const result = await this.executeQueryWithDatabaseContext(connectionUri, query);

        if (result.rows.length > 0 && result.rows[0][0].displayValue) {
            return String(result.rows[0][0].displayValue);
        }

        return `-- Unable to script table ${obj.schema}.${obj.name}`;
    }

    /**
     * Script a view using SQL queries
     */
    private async scriptView(connectionUri: string, obj: DatabaseObject): Promise<string> {
        const query = `
            USE [${this.currentDatabaseName}];
            SELECT OBJECT_DEFINITION(OBJECT_ID(N'${obj.schema}.${obj.name}')) AS Definition;
        `;

        const result = await this.executeQueryWithDatabaseContext(connectionUri, query);

        if (result.rows.length > 0 && result.rows[0][0].displayValue) {
            const definition = String(result.rows[0][0].displayValue);
            return `-- View: ${obj.schema}.${obj.name}\n${definition}`;
        }

        return `-- Unable to script view ${obj.schema}.${obj.name}`;
    }

    /**
     * Script a stored procedure using SQL queries
     */
    private async scriptStoredProcedure(connectionUri: string, obj: DatabaseObject): Promise<string> {
        const query = `
            USE [${this.currentDatabaseName}];
            SELECT OBJECT_DEFINITION(OBJECT_ID(N'${obj.schema}.${obj.name}')) AS Definition;
        `;

        const result = await this.executeQueryWithDatabaseContext(connectionUri, query);

        if (result.rows.length > 0 && result.rows[0][0].displayValue) {
            const definition = String(result.rows[0][0].displayValue);
            return `-- Stored Procedure: ${obj.schema}.${obj.name}\n${definition}`;
        }

        return `-- Unable to script stored procedure ${obj.schema}.${obj.name}`;
    }

    /**
     * Script a function using SQL queries
     */
    private async scriptFunction(connectionUri: string, obj: DatabaseObject): Promise<string> {
        const query = `
            USE [${this.currentDatabaseName}];
            SELECT OBJECT_DEFINITION(OBJECT_ID(N'${obj.schema}.${obj.name}')) AS Definition;
        `;

        const result = await this.executeQueryWithDatabaseContext(connectionUri, query);

        if (result.rows.length > 0 && result.rows[0][0].displayValue) {
            const definition = String(result.rows[0][0].displayValue);
            return `-- Function: ${obj.schema}.${obj.name}\n${definition}`;
        }

        return `-- Unable to script function ${obj.schema}.${obj.name}`;
    }

    /**
     * Script a trigger using SQL queries
     */
    private async scriptTrigger(connectionUri: string, obj: DatabaseObject): Promise<string> {
        const query = `
            USE [${this.currentDatabaseName}];
            SELECT OBJECT_DEFINITION(OBJECT_ID(N'${obj.schema}.${obj.name}')) AS Definition;
        `;

        const result = await this.executeQueryWithDatabaseContext(connectionUri, query);

        if (result.rows.length > 0 && result.rows[0][0].displayValue) {
            const definition = String(result.rows[0][0].displayValue);
            return `-- Trigger: ${obj.schema}.${obj.name}\n${definition}`;
        }

        return `-- Unable to script trigger ${obj.schema}.${obj.name}`;
    }

    /**
     * Script multiple objects in a single batch query
     * This is much faster than scripting objects one by one
     *
     * @param connectionUri The connection URI
     * @param objects Array of database objects to script
     * @param objectType The object type for scripting
     * @returns Map of object keys to their scripts
     */
    private async scriptObjectsBatch(
        connectionUri: string,
        objects: DatabaseObject[],
        objectType: string
    ): Promise<Map<string, string>> {
        const scripts = new Map<string, string>();

        if (objects.length === 0) {
            return scripts;
        }

        console.log(`[MSSQL-Git-Sync] Batch scripting ${objects.length} objects of type ${objectType}...`);

        // Determine the scripting method based on object type
        const firstObjType = objects[0].type.toUpperCase();

        if (firstObjType === 'USER_TABLE' || firstObjType === 'TABLE') {
            // For tables, we need to script each one individually due to complexity
            // But we can still batch the queries
            return await this.scriptTablesBatch(connectionUri, objects);
        } else {
            // For views, procedures, functions, triggers - use OBJECT_DEFINITION in batch
            return await this.scriptDefinitionsBatch(connectionUri, objects);
        }
    }

    /**
     * Batch script tables using a single query
     */
    private async scriptTablesBatch(
        connectionUri: string,
        objects: DatabaseObject[]
    ): Promise<Map<string, string>> {
        const scripts = new Map<string, string>();

        // Build a query that gets all table definitions at once
        const objectList = objects.map(obj => `N'${obj.schema}.${obj.name}'`).join(',');

        const query = `
            SELECT
                SCHEMA_NAME(t.schema_id) + '.' + t.name AS ObjectKey,
                'CREATE TABLE [' + SCHEMA_NAME(t.schema_id) + '].[' + t.name + '] (' + CHAR(13) + CHAR(10) +
                STUFF((
                    SELECT
                        '    [' + c.name + '] ' +
                        TYPE_NAME(c.user_type_id) +
                        CASE
                            WHEN TYPE_NAME(c.user_type_id) IN ('varchar', 'char', 'varbinary', 'binary')
                                THEN '(' + CASE WHEN c.max_length = -1 THEN 'MAX' ELSE CAST(c.max_length AS VARCHAR(5)) END + ')'
                            WHEN TYPE_NAME(c.user_type_id) IN ('nvarchar', 'nchar')
                                THEN '(' + CASE WHEN c.max_length = -1 THEN 'MAX' ELSE CAST(c.max_length/2 AS VARCHAR(5)) END + ')'
                            WHEN TYPE_NAME(c.user_type_id) IN ('decimal', 'numeric')
                                THEN '(' + CAST(c.precision AS VARCHAR(5)) + ',' + CAST(c.scale AS VARCHAR(5)) + ')'
                            ELSE ''
                        END +
                        CASE WHEN c.is_nullable = 1 THEN ' NULL' ELSE ' NOT NULL' END +
                        ',' + CHAR(13) + CHAR(10)
                    FROM sys.columns c
                    WHERE c.object_id = t.object_id
                    ORDER BY c.column_id
                    FOR XML PATH(''), TYPE
                ).value('.', 'NVARCHAR(MAX)'), 1, 0, '') +
                ');' AS ScriptText
            FROM sys.tables t
            WHERE SCHEMA_NAME(t.schema_id) + '.' + t.name IN (${objectList})
            ORDER BY SCHEMA_NAME(t.schema_id), t.name;
        `;

        try {
            const result = await this.executeQueryWithDatabaseContext(connectionUri, query);

            if (result.rows && result.rows.length > 0) {
                for (const row of result.rows) {
                    const objectKey = String(row[0].displayValue);
                    const scriptText = String(row[1].displayValue);
                    scripts.set(objectKey, scriptText);
                }
            }

            console.log(`[MSSQL-Git-Sync] ✓ Batch scripted ${scripts.size} tables`);
        } catch (error) {
            console.error(`[MSSQL-Git-Sync] Error in batch table scripting:`, error);
            throw error;
        }

        return scripts;
    }

    /**
     * Batch script views, procedures, functions, triggers using OBJECT_DEFINITION
     */
    private async scriptDefinitionsBatch(
        connectionUri: string,
        objects: DatabaseObject[]
    ): Promise<Map<string, string>> {
        const scripts = new Map<string, string>();

        // Build a query that gets all object definitions at once
        const objectList = objects.map(obj => `N'${obj.schema}.${obj.name}'`).join(',');

        const query = `
            SELECT
                SCHEMA_NAME(o.schema_id) + '.' + o.name AS ObjectKey,
                OBJECT_DEFINITION(o.object_id) AS Definition,
                o.type_desc AS ObjectType
            FROM sys.objects o
            WHERE SCHEMA_NAME(o.schema_id) + '.' + o.name IN (${objectList})
            ORDER BY SCHEMA_NAME(o.schema_id), o.name;
        `;

        try {
            const result = await this.executeQueryWithDatabaseContext(connectionUri, query);

            if (result.rows && result.rows.length > 0) {
                for (const row of result.rows) {
                    const objectKey = String(row[0].displayValue);
                    const definition = String(row[1].displayValue);
                    const objectType = String(row[2].displayValue);

                    if (definition && definition !== 'null') {
                        const script = `-- ${objectType}: ${objectKey}\n${definition}`;
                        scripts.set(objectKey, script);
                    }
                }
            }

            console.log(`[MSSQL-Git-Sync] ✓ Batch scripted ${scripts.size} objects`);
        } catch (error) {
            console.error(`[MSSQL-Git-Sync] Error in batch definition scripting:`, error);
            throw error;
        }

        return scripts;
    }
}

