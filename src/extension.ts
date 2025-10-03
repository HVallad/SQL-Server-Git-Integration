/*---------------------------------------------------------------------------------------------
 *  MSSQL Git Sync Extension
 *  Git repository synchronization for SQL Server databases
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as vscodeMssql from 'vscode-mssql';
import { DatabaseScriptingService } from './services/databaseScriptingService';
import { GitSyncPanelProvider } from './views/gitSyncPanelProvider';

let scriptingService: DatabaseScriptingService | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;
let gitSyncPanel: GitSyncPanelProvider | undefined;

/**
 * Extension activation function
 * Called when the extension is activated
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
    console.log('MSSQL Git Sync extension is now active');

    // Verify that the MSSQL extension is installed and active
    const mssqlExtension = vscode.extensions.getExtension<vscodeMssql.IExtension>('ms-mssql.mssql');
    
    if (!mssqlExtension) {
        const message = 'MSSQL Git Sync requires the "SQL Server (mssql)" extension to be installed.';
        vscode.window.showErrorMessage(message);
        throw new Error(message);
    }

    // Activate the MSSQL extension if it's not already active
    let mssqlApi: vscodeMssql.IExtension;
    if (!mssqlExtension.isActive) {
        console.log('Activating MSSQL extension...');
        mssqlApi = await mssqlExtension.activate();
    } else {
        mssqlApi = mssqlExtension.exports;
    }

    console.log('MSSQL extension is active and available');

    // Initialize the scripting service
    scriptingService = new DatabaseScriptingService(context, mssqlApi);

    // Initialize the Git Sync Panel
    gitSyncPanel = new GitSyncPanelProvider(context.extensionUri, scriptingService, mssqlApi, context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(GitSyncPanelProvider.viewType, gitSyncPanel)
    );

    // Register the command to script database to Git
    const scriptDatabaseCommand = vscode.commands.registerCommand(
        'mssql-git-sync.scriptDatabaseToGit',
        async (node: vscodeMssql.ITreeNodeInfo) => {
            try {
                // Add/update database in panel
                await gitSyncPanel?.addOrUpdateDatabase(node);
                // Update status bar when command is invoked
                await updateStatusBarForNode(node);
                await scriptingService?.scriptDatabaseToFiles(node);
                // Refresh the panel
                await gitSyncPanel?.addOrUpdateDatabase(node);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`Failed to script database: ${errorMessage}`);
                console.error('Error scripting database:', error);
            }
        }
    );

    context.subscriptions.push(scriptDatabaseCommand);

    // Register the command to link database to Git
    const linkToGitCommand = vscode.commands.registerCommand(
        'mssql-git-sync.linkToGit',
        async (node: vscodeMssql.ITreeNodeInfo) => {
            try {
                // Add/update database in panel
                await gitSyncPanel?.addOrUpdateDatabase(node);
                // Update status bar when command is invoked
                await updateStatusBarForNode(node);
                await scriptingService?.linkToGit(node);
                // Update status bar again after linking
                await updateStatusBarForNode(node);
                // Refresh the panel with updated status
                await gitSyncPanel?.addOrUpdateDatabase(node);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`Failed to link to Git: ${errorMessage}`);
                console.error('Error linking to Git:', error);
            }
        }
    );

    context.subscriptions.push(linkToGitCommand);

    // Register the command to unlink database from Git
    const unlinkFromGitCommand = vscode.commands.registerCommand(
        'mssql-git-sync.unlinkFromGit',
        async (node: vscodeMssql.ITreeNodeInfo) => {
            try {
                // Add/update database in panel
                await gitSyncPanel?.addOrUpdateDatabase(node);
                // Update status bar when command is invoked
                await updateStatusBarForNode(node);
                await scriptingService?.unlinkFromGit(node);
                // Update status bar again after unlinking (should hide it)
                await updateStatusBarForNode(node);
                // Refresh the panel with updated status
                await gitSyncPanel?.addOrUpdateDatabase(node);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`Failed to unlink from Git: ${errorMessage}`);
                console.error('Error unlinking from Git:', error);
            }
        }
    );

    context.subscriptions.push(unlinkFromGitCommand);

    // Create status bar item for Git branch indicator
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.name = 'MSSQL Git Sync - Branch Indicator';
    context.subscriptions.push(statusBarItem);

    // Listen for tree view selection changes
    vscode.window.onDidChangeActiveTextEditor(() => updateStatusBar());

    // Register a command to handle tree view selection
    const updateStatusBarCommand = vscode.commands.registerCommand(
        'mssql-git-sync.updateStatusBar',
        async (node: vscodeMssql.ITreeNodeInfo) => {
            await updateStatusBarForNode(node);
        }
    );
    context.subscriptions.push(updateStatusBarCommand);

    // Register the command to add database to panel (called automatically from context menu commands)
    const addToPanelCommand = vscode.commands.registerCommand(
        'mssql-git-sync.addToPanel',
        async (node: vscodeMssql.ITreeNodeInfo) => {
            await gitSyncPanel?.addOrUpdateDatabase(node);
        }
    );

    context.subscriptions.push(addToPanelCommand);

    vscode.window.showInformationMessage('MSSQL Git Sync extension activated successfully!');
}

/**
 * Update the status bar to show Git branch for the selected database node
 */
async function updateStatusBarForNode(node: vscodeMssql.ITreeNodeInfo): Promise<void> {
    if (!statusBarItem || !scriptingService) {
        return;
    }

    try {
        // Get database name
        const databaseName = scriptingService.getDatabaseName(node);
        if (!databaseName) {
            statusBarItem.hide();
            return;
        }

        // Check if database is linked to Git
        const isLinked = await scriptingService.isGitLinked(node);

        if (isLinked) {
            // Get metadata to retrieve branch information
            const metadata = await scriptingService.getGitMetadata(node);

            if (metadata && metadata.gitBranch) {
                statusBarItem.text = `$(git-branch) ${metadata.gitBranch}`;
                statusBarItem.tooltip = `Database "${databaseName}" is linked to Git branch: ${metadata.gitBranch}\nRepository: ${metadata.gitRepositoryUrl || 'Unknown'}`;
                statusBarItem.show();
            } else {
                statusBarItem.hide();
            }
        } else {
            statusBarItem.hide();
        }
    } catch (error) {
        console.error('Error updating status bar:', error);
        statusBarItem.hide();
    }
}

/**
 * Update status bar based on current context
 */
function updateStatusBar(): void {
    // Hide status bar when not in relevant context
    if (statusBarItem) {
        statusBarItem.hide();
    }
}

/**
 * Extension deactivation function
 * Called when the extension is deactivated
 */
export function deactivate(): void {
    console.log('MSSQL Git Sync extension is now deactivated');
    scriptingService = undefined;
}

