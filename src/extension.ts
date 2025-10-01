/*---------------------------------------------------------------------------------------------
 *  MSSQL Git Sync Extension
 *  Git repository synchronization for SQL Server databases
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as vscodeMssql from 'vscode-mssql';
import { DatabaseScriptingService } from './services/databaseScriptingService';

let scriptingService: DatabaseScriptingService | undefined;

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

    // Register the command to script database to Git
    const scriptDatabaseCommand = vscode.commands.registerCommand(
        'mssql-git-sync.scriptDatabaseToGit',
        async (node: vscodeMssql.ITreeNodeInfo) => {
            try {
                await scriptingService?.scriptDatabaseToFiles(node);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`Failed to script database: ${errorMessage}`);
                console.error('Error scripting database:', error);
            }
        }
    );

    context.subscriptions.push(scriptDatabaseCommand);

    vscode.window.showInformationMessage('MSSQL Git Sync extension activated successfully!');
}

/**
 * Extension deactivation function
 * Called when the extension is deactivated
 */
export function deactivate(): void {
    console.log('MSSQL Git Sync extension is now deactivated');
    scriptingService = undefined;
}

