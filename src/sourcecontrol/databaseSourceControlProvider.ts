import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { GitManager } from '../gitmanagement';

export class DatabaseSourceControlProvider {
    private _disposables: vscode.Disposable[] = [];
    private _sourceControl: vscode.SourceControl;
    private _resourceGroup: vscode.SourceControlResourceGroup;
    private _gitDir: string;

    constructor(gitDir: string) {
        this._gitDir = gitDir;
        
        // Create source control instance
        this._sourceControl = vscode.scm.createSourceControl('sqlServerGitIntegration', 'Database Source Control');
        
        // Create resource group
        this._resourceGroup = this._sourceControl.createResourceGroup('changes', 'Changes');
        
        // Set up input box
        this._sourceControl.inputBox.placeholder = 'Message (press Ctrl+Enter to commit)';
        
        // Register commands
        this._registerCommands();
        
        // Initial update
        this._update();
    }

    private _registerCommands() {
        // Commit command
        const commitCommand = vscode.commands.registerCommand('sqlServerGitIntegration.commit', () => {
            this._commit();
        });

        // Refresh command
        const refreshCommand = vscode.commands.registerCommand('sqlServerGitIntegration.refresh', () => {
            this._update();
        });

        this._disposables.push(commitCommand, refreshCommand);
    }

    private async _update() {
        try {
            // Change to git directory
            const originalCwd = process.cwd();
            process.chdir(this._gitDir);

            try {
                // Get git status
                const statusResult = await GitManager.executeCommand('git status --porcelain');
                
                if (statusResult.success && statusResult.output) {
                    const changedFiles = this._parseGitStatus(statusResult.output);
                    const resourceStates = changedFiles.map(file => ({
                        resourceUri: vscode.Uri.file(path.join(this._gitDir, file)),
                        command: {
                            title: 'Open File',
                            command: 'vscode.open',
                            arguments: [vscode.Uri.file(path.join(this._gitDir, file))]
                        },
                        decorations: {
                            strikeThrough: false,
                            faded: false,
                            tooltip: this._getStatusTooltip(file),
                            iconPath: new vscode.ThemeIcon(this._getStatusIcon(file))
                        }
                    }));
                    
                    this._resourceGroup.resourceStates = resourceStates;
                    this._sourceControl.count = resourceStates.length;
                } else {
                    this._resourceGroup.resourceStates = [];
                    this._sourceControl.count = 0;
                }
            } finally {
                process.chdir(originalCwd);
            }
        } catch (error) {
            console.error('Error updating source control:', error);
            this._resourceGroup.resourceStates = [];
            this._sourceControl.count = 0;
        }
    }

    private _parseGitStatus(statusOutput: string): string[] {
        return statusOutput
            .split('\n')
            .filter(line => line.trim())
            .map(line => line.substring(3)); // Remove status codes (e.g., " M " -> "filename")
    }

    private _getStatusTooltip(filename: string): string {
        // You could enhance this to show more detailed status
        return 'Modified';
    }

    private _getStatusIcon(filename: string): string {
        // You could enhance this to show different icons based on status
        return 'modified';
    }

    private async _commit() {
        const message = this._sourceControl.inputBox.value;
        if (!message.trim()) {
            vscode.window.showErrorMessage('Please enter a commit message');
            return;
        }

        try {
            const originalCwd = process.cwd();
            process.chdir(this._gitDir);

            try {
                await GitManager.executeCommand('git add .');
                await GitManager.executeCommand(`git commit -m "${message}"`);
                
                // Clear input box
                this._sourceControl.inputBox.value = '';
                
                // Update the view
                this._update();
                
                vscode.window.showInformationMessage('Successfully committed changes');
            } finally {
                process.chdir(originalCwd);
            }
        } catch (error) {
            console.error('Error committing changes:', error);
            vscode.window.showErrorMessage(`Failed to commit changes: ${error}`);
        }
    }

    public dispose() {
        this._disposables.forEach(d => d.dispose());
        this._sourceControl.dispose();
    }
}