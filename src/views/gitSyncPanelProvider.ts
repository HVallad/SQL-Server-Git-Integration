/*---------------------------------------------------------------------------------------------
 *  Git Sync Panel Provider
 *  Provides a custom webview panel for managing database Git synchronization
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as vscodeMssql from 'vscode-mssql';
import { DatabaseScriptingService } from '../services/databaseScriptingService';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Interface for database information displayed in the panel
 */
interface DatabaseInfo {
    server: string;
    database: string;
    isLinked: boolean;
    gitBranch?: string;
    gitRepositoryUrl?: string;
    node?: vscodeMssql.ITreeNodeInfo;
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
 * Webview panel provider for Git Sync management
 */
export class GitSyncPanelProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'mssql-git-sync.gitSyncPanel';

    private _view?: vscode.WebviewView;
    private _databases: DatabaseInfo[] = [];

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _scriptingService: DatabaseScriptingService,
        private readonly _mssqlApi: vscodeMssql.IExtension,
        private readonly _context: vscode.ExtensionContext
    ) {}

    /**
     * Resolve the webview view
     */
    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(async (data) => {
            await this._handleMessage(data);
        });

        // Refresh the panel when it becomes visible
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                this.refresh();
            }
        });

        // Initial refresh
        this.refresh();
    }

    /**
     * Refresh the panel with current database information
     */
    public async refresh() {
        if (!this._view) {
            return;
        }

        // Discover databases from MSSQL Object Explorer
        await this._discoverDatabases();

        // Send updated database list to webview
        this._view.webview.postMessage({ type: 'refresh', databases: this._databases });
    }

    /**
     * Add or update a database in the panel
     */
    public async addOrUpdateDatabase(node: vscodeMssql.ITreeNodeInfo) {
        try {
            const databaseName = this._scriptingService.getDatabaseName(node);
            if (!databaseName) {
                return;
            }

            const server = node.connectionProfile.server || 'Unknown Server';

            // Check if database is already in the list
            const existingIndex = this._databases.findIndex(
                db => db.server === server && db.database === databaseName
            );

            // Get Git metadata
            const isLinked = await this._scriptingService.isGitLinked(node);
            const metadata = await this._scriptingService.getGitMetadata(node);

            const dbInfo: DatabaseInfo = {
                server: server,
                database: databaseName,
                isLinked: isLinked,
                gitBranch: metadata?.gitBranch,
                gitRepositoryUrl: metadata?.gitRepositoryUrl,
                node: node
            };

            if (existingIndex >= 0) {
                // Update existing database
                this._databases[existingIndex] = dbInfo;
            } else {
                // Add new database
                this._databases.push(dbInfo);
            }

            // Sort databases by server then database name
            this._databases.sort((a, b) => {
                if (a.server !== b.server) {
                    return a.server.localeCompare(b.server);
                }
                return a.database.localeCompare(b.database);
            });

            // Refresh the view
            await this.refresh();
        } catch (error) {
            console.error('[MSSQL-Git-Sync] Error adding/updating database:', error);
        }
    }

    /**
     * Discover databases from MSSQL saved connection profiles and Git metadata
     * This shows databases that have been scripted before, plus any from saved profiles
     */
    private async _discoverDatabases() {
        this._databases = [];

        try {
            console.log('[MSSQL-Git-Sync] Discovering databases...');

            // Create a map of Git metadata for quick lookup
            const gitMetadataMap = await this._loadGitMetadataMap();
            console.log(`[MSSQL-Git-Sync] Loaded ${gitMetadataMap.size} databases from Git metadata`);

            // First, add all databases from Git metadata (databases we've worked with before)
            for (const [key, metadata] of gitMetadataMap.entries()) {
                const parts = key.split('_');
                const server = parts[0] || 'Unknown Server';
                const database = metadata.databaseName;

                this._databases.push({
                    server: server,
                    database: database,
                    isLinked: metadata.gitLinked || false,
                    gitBranch: metadata.gitBranch,
                    gitRepositoryUrl: metadata.gitRepositoryUrl,
                    node: undefined
                });

                console.log(`[MSSQL-Git-Sync] Added from metadata: ${server} / ${database} (Linked: ${metadata.gitLinked})`);
            }

            // Then, try to add databases from saved connection profiles
            try {
                const config = vscode.workspace.getConfiguration('mssql');
                const connections = config.inspect('connections');

                console.log('[MSSQL-Git-Sync] Checking for saved connection profiles...');
                console.log('[MSSQL-Git-Sync] Global connections:', connections?.globalValue);
                console.log('[MSSQL-Git-Sync] Workspace connections:', connections?.workspaceValue);

                const configuredConnections = (connections?.globalValue || connections?.workspaceValue || []) as vscodeMssql.IConnectionInfo[];

                if (configuredConnections && configuredConnections.length > 0) {
                    console.log(`[MSSQL-Git-Sync] Found ${configuredConnections.length} saved connection profiles`);

                    for (const connection of configuredConnections) {
                        const serverName = connection.server || 'Unknown Server';
                        const databaseName = connection.database || '';

                        if (databaseName) {
                            // Check if we already have this database from metadata
                            const exists = this._databases.some(
                                db => db.server === serverName && db.database === databaseName
                            );

                            if (!exists) {
                                this._databases.push({
                                    server: serverName,
                                    database: databaseName,
                                    isLinked: false,
                                    node: undefined
                                });

                                console.log(`[MSSQL-Git-Sync] Added from profile: ${serverName} / ${databaseName}`);
                            }
                        }
                    }
                } else {
                    console.log('[MSSQL-Git-Sync] No saved connection profiles found in settings');
                }
            } catch (error) {
                console.error('[MSSQL-Git-Sync] Error reading connection profiles:', error);
            }

            // Sort databases by server then database name
            this._databases.sort((a, b) => {
                if (a.server !== b.server) {
                    return a.server.localeCompare(b.server);
                }
                return a.database.localeCompare(b.database);
            });

            console.log(`[MSSQL-Git-Sync] Total databases discovered: ${this._databases.length}`);

            if (this._databases.length === 0) {
                console.log('[MSSQL-Git-Sync] No databases found. This could mean:');
                console.log('  1. No databases have been scripted yet (no Git metadata)');
                console.log('  2. No connection profiles are saved in VS Code settings');
                console.log('  3. Connection profiles exist but have no database specified');
            }
        } catch (error) {
            console.error('[MSSQL-Git-Sync] Error discovering databases:', error);
        }
    }

    /**
     * Load Git metadata from global storage into a map for quick lookup
     */
    private async _loadGitMetadataMap(): Promise<Map<string, DatabaseMetadata>> {
        const metadataMap = new Map<string, DatabaseMetadata>();

        try {
            const globalStoragePath = this._context.globalStorageUri.fsPath;

            // Check if global storage directory exists
            try {
                await fs.access(globalStoragePath);
            } catch {
                return metadataMap; // Return empty map if directory doesn't exist
            }

            // Read all subdirectories in global storage
            const entries = await fs.readdir(globalStoragePath, { withFileTypes: true });
            const directories = entries.filter(entry => entry.isDirectory());

            // Scan each directory for metadata.json
            for (const dir of directories) {
                const metadataPath = path.join(globalStoragePath, dir.name, 'metadata.json');

                try {
                    // Read and parse metadata
                    const metadataContent = await fs.readFile(metadataPath, 'utf-8');
                    const metadata: DatabaseMetadata = JSON.parse(metadataContent);

                    // Extract server name from directory name
                    // Directory format: {server}_{database}_{hash}
                    const parts = dir.name.split('_');
                    const server = parts[0] || 'Unknown Server';
                    const database = metadata.databaseName;

                    // Store in map with key: server_database
                    const key = `${server}_${database}`;
                    metadataMap.set(key, metadata);
                } catch (error) {
                    // Skip directories without metadata.json or with invalid metadata
                    continue;
                }
            }

            console.log(`[MSSQL-Git-Sync] Loaded ${metadataMap.size} Git metadata entries`);
        } catch (error) {
            console.error('[MSSQL-Git-Sync] Error loading Git metadata:', error);
        }

        return metadataMap;
    }

    /**
     * Update database list
     */
    public async updateDatabases(databases: DatabaseInfo[]) {
        this._databases = databases;
        await this.refresh();
    }

    /**
     * Handle messages from the webview
     */
    private async _handleMessage(data: any) {
        switch (data.type) {
            case 'sync':
                await this._handleSync(data.server, data.database);
                break;
            case 'link':
                await this._handleLink(data.server, data.database);
                break;
            case 'unlink':
                await this._handleUnlink(data.server, data.database);
                break;
            case 'openFolder':
                await this._handleOpenFolder(data.server, data.database);
                break;
            case 'refresh':
                await this.refresh();
                break;
        }
    }

    /**
     * Handle sync action
     */
    private async _handleSync(server: string, database: string) {
        const dbInfo = this._databases.find(db => db.server === server && db.database === database);
        if (!dbInfo) {
            vscode.window.showErrorMessage(`Database "${database}" not found`);
            return;
        }

        if (!dbInfo.node) {
            vscode.window.showWarningMessage(
                `Cannot sync "${database}" - database is not currently connected. Please connect to the server in MSSQL Object Explorer and try again.`
            );
            return;
        }

        try {
            await this._scriptingService.scriptDatabaseToFiles(dbInfo.node);
            vscode.window.showInformationMessage(`Successfully synced database "${database}"`);
            await this.refresh();
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to sync database: ${errorMessage}`);
        }
    }

    /**
     * Handle link action
     */
    private async _handleLink(server: string, database: string) {
        const dbInfo = this._databases.find(db => db.server === server && db.database === database);
        if (!dbInfo) {
            vscode.window.showErrorMessage(`Database "${database}" not found`);
            return;
        }

        if (!dbInfo.node) {
            vscode.window.showWarningMessage(
                `Cannot link "${database}" - database is not currently connected. Please connect to the server in MSSQL Object Explorer and try again.`
            );
            return;
        }

        try {
            await this._scriptingService.linkToGit(dbInfo.node);
            await this.refresh();
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to link to Git: ${errorMessage}`);
        }
    }

    /**
     * Handle unlink action
     */
    private async _handleUnlink(server: string, database: string) {
        const dbInfo = this._databases.find(db => db.server === server && db.database === database);
        if (!dbInfo) {
            vscode.window.showErrorMessage(`Database "${database}" not found`);
            return;
        }

        if (!dbInfo.node) {
            vscode.window.showWarningMessage(
                `Cannot unlink "${database}" - database is not currently connected. Please connect to the server in MSSQL Object Explorer and try again.`
            );
            return;
        }

        try {
            await this._scriptingService.unlinkFromGit(dbInfo.node);
            await this.refresh();
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to unlink from Git: ${errorMessage}`);
        }
    }

    /**
     * Handle open folder action
     */
    private async _handleOpenFolder(server: string, database: string) {
        const dbInfo = this._databases.find(db => db.server === server && db.database === database);
        if (!dbInfo) {
            vscode.window.showErrorMessage(`Database "${database}" not found`);
            return;
        }

        try {
            // Construct the path manually from global storage
            const globalStoragePath = this._context.globalStorageUri.fsPath;

            // Find the directory that matches this database
            const entries = await fs.readdir(globalStoragePath, { withFileTypes: true });
            const directories = entries.filter(entry => entry.isDirectory());

            for (const dir of directories) {
                const metadataPath = path.join(globalStoragePath, dir.name, 'metadata.json');
                try {
                    const metadataContent = await fs.readFile(metadataPath, 'utf-8');
                    const metadata: DatabaseMetadata = JSON.parse(metadataContent);

                    if (metadata.databaseName === database) {
                        const outputPath = path.join(globalStoragePath, dir.name);
                        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(outputPath));
                        return;
                    }
                } catch {
                    continue;
                }
            }

            vscode.window.showErrorMessage(`Could not find folder for database "${database}"`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to open folder: ${errorMessage}`);
        }
    }

    /**
     * Get the HTML content for the webview
     */
    private _getHtmlForWebview(webview: vscode.Webview) {
        // Get URIs for resources
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'panel.css'));
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'panel.js'));

        // Use a nonce to only allow specific scripts to be run
        const nonce = getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src https://microsoft.github.io; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="${styleUri}" rel="stylesheet">
    <title>MSSQL Git Sync</title>
</head>
<body>
    <div class="container">
        <div class="header">
            <span class="header-title">CONNECTIONS</span>
            <button class="refresh-btn" onclick="refresh()" title="Refresh">
                <span class="codicon codicon-refresh"></span>
            </button>
        </div>

        <div id="tree-view" class="tree-view">
            <div class="empty-state">
                <p>No databases found</p>
                <p class="hint">Connect to a SQL Server in the MSSQL Object Explorer to see databases here.</p>
            </div>
        </div>
    </div>

    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
}

/**
 * Generate a nonce for CSP
 */
function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

