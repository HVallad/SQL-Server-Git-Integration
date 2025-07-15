import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { GitManager } from '../gitmanagement';

export class DatabaseSourceControlProvider implements vscode.QuickDiffProvider {
    private _disposables: vscode.Disposable[] = [];
    private _sourceControl: vscode.SourceControl;
    private _resourceGroup: vscode.SourceControlResourceGroup;
    private _gitDir: string;
    private _tempDir: string;
    private _gitCache: Map<string, string> = new Map();

    constructor(gitDir: string, extensionUri: vscode.Uri) {
        this._gitDir = gitDir;
        this._tempDir = path.join(extensionUri.fsPath, 'temp');
        
        // Create source control instance
        this._sourceControl = vscode.scm.createSourceControl('sqlServerGitIntegration', 'Database Source Control');
        this._sourceControl.quickDiffProvider = this;
        
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

        // View diff command
        const viewDiffCommand = vscode.commands.registerCommand('sqlServerGitIntegration.viewDiff', async (uri: vscode.Uri) => {
            try {
                const originalUri = await this.provideOriginalResource(uri);
                if (originalUri) {
                    await vscode.commands.executeCommand('vscode.diff', originalUri, uri, `${path.basename(uri.fsPath)} (Git HEAD vs Current)`);
                }
            } catch (error) {
                console.error('Error opening diff:', error);
            }
        });

        this._disposables.push(commitCommand, refreshCommand, viewDiffCommand);
    }

    // Implement QuickDiffProvider interface
    public async provideOriginalResource(uri: vscode.Uri): Promise<vscode.Uri | undefined> {
        try {
            // Get the relative path from the git directory
            const relativePath = path.relative(this._gitDir, uri.fsPath);
            
            // Convert to forward slashes for Git
            const gitPath = relativePath.replace(/\\/g, '/');
            
            // Check cache first
            if (this._gitCache.has(gitPath)) {
                const content = this._gitCache.get(gitPath)!;
                const fileName = path.basename(relativePath);
                const tempFile = path.join(this._tempDir, `${fileName}.git`);
                fs.writeFileSync(tempFile, content);
                return vscode.Uri.file(tempFile);
            }
            
            // Create temp directory if it doesn't exist
            if (!fs.existsSync(this._tempDir)) {
                fs.mkdirSync(this._tempDir, { recursive: true });
            }
            
            // Create a unique temp file name
            const fileName = path.basename(relativePath);
            const tempFile = path.join(this._tempDir, `${fileName}.git`);
            
            // Use git cat-file which is much faster than git show
            const originalCwd = process.cwd();
            process.chdir(this._gitDir);

            try {
                const result = await GitManager.executeCommand(`git cat-file blob HEAD:"${gitPath}"`);
                
                if (result.success) {
                    const content = result.output || '';
                    // Cache the result
                    this._gitCache.set(gitPath, content);
                    fs.writeFileSync(tempFile, content);
                    return vscode.Uri.file(tempFile);
                }
            } finally {
                process.chdir(originalCwd);
            }
        } catch (error) {
            console.error('Error providing original resource:', error);
        }
        
        return undefined;
    }

    private async _update() {
        this._gitCache.clear(); // Clear cache on update
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
                            title: 'View Changes',
                            command: 'sqlServerGitIntegration.viewDiff',
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
        // Clean up temp files
        if (fs.existsSync(this._tempDir)) {
            fs.rmSync(this._tempDir, { recursive: true, force: true });
        }
        
        this._disposables.forEach(d => d.dispose());
        this._sourceControl.dispose();
    }
}