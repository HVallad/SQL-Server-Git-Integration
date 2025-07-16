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
    private _instanceId: string; // Add unique instance ID

    constructor(gitDir: string, extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
        this._gitDir = gitDir;
        // Use extension global storage for temp files
        this._tempDir = path.join(context.globalStorageUri.fsPath, 'git-temp');
        this._instanceId = Date.now().toString(); // Generate unique ID
        
        // Create source control instance
        this._sourceControl = vscode.scm.createSourceControl('sqlServerGitIntegration', 'Database Source Control');
        this._sourceControl.quickDiffProvider = this;
        
        // Create resource group
        this._resourceGroup = this._sourceControl.createResourceGroup('changes', 'Changes');
        
        // Set up input box
        this._sourceControl.inputBox.placeholder = 'Message (press Ctrl+Enter to commit)';
        
        // Register commands
        this._registerCommands();
        
        // Initial update and pre-fetch Git files
        this._update();
    }

    private _registerCommands() {
        // Use unique command IDs with instance ID
        const commitCommand = vscode.commands.registerCommand(`sqlServerGitIntegration.commit.${this._instanceId}`, () => {
            this._commit();
        });

        // Refresh command
        const refreshCommand = vscode.commands.registerCommand(`sqlServerGitIntegration.refresh.${this._instanceId}`, () => {
            this._update();
        });

        // View diff command
        const viewDiffCommand = vscode.commands.registerCommand(`sqlServerGitIntegration.viewDiff.${this._instanceId}`, async (uri: vscode.Uri) => {
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

    // Pre-fetch all Git files for changed files
    private async _prefetchGitFiles(changedFiles: string[]) {
        try {
            // Create temp directory if it doesn't exist
            if (!fs.existsSync(this._tempDir)) {
                fs.mkdirSync(this._tempDir, { recursive: true });
            }

            // Clear existing temp files
            if (fs.existsSync(this._tempDir)) {
                fs.rmSync(this._tempDir, { recursive: true, force: true });
                fs.mkdirSync(this._tempDir, { recursive: true });
            }

            const originalCwd = process.cwd();
            process.chdir(this._gitDir);

            try {
                // Pre-fetch all changed files from Git
                for (const file of changedFiles) {
                    const gitPath = file.replace(/\\/g, '/');
                    const result = await GitManager.executeCommand(`git cat-file blob HEAD:"${gitPath}"`);
                    
                    if (result.success) {
                        // Create temp file with same structure as original
                        const tempFilePath = path.join(this._tempDir, gitPath);
                        const tempDir = path.dirname(tempFilePath);
                        
                        if (!fs.existsSync(tempDir)) {
                            fs.mkdirSync(tempDir, { recursive: true });
                        }
                        
                        fs.writeFileSync(tempFilePath, result.output || '');
                        this._gitCache.set(gitPath, result.output || '');
                    }
                }
            } finally {
                process.chdir(originalCwd);
            }
        } catch (error) {
            console.error('Error pre-fetching Git files:', error);
        }
    }

    // Implement QuickDiffProvider interface
    public async provideOriginalResource(uri: vscode.Uri): Promise<vscode.Uri | undefined> {
        try {
            // Get the relative path from the git directory
            const relativePath = path.relative(this._gitDir, uri.fsPath);
            
            // Convert to forward slashes for Git
            const gitPath = relativePath.replace(/\\/g, '/');
            
            // Check if we have a pre-fetched file
            const tempFilePath = path.join(this._tempDir, gitPath);
            if (fs.existsSync(tempFilePath)) {
                return vscode.Uri.file(tempFilePath);
            }
            
            // Fallback to cache
            if (this._gitCache.has(gitPath)) {
                const content = this._gitCache.get(gitPath)!;
                const fileName = path.basename(relativePath);
                const tempFile = path.join(this._tempDir, `${fileName}.git`);
                fs.writeFileSync(tempFile, content);
                return vscode.Uri.file(tempFile);
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
                    
                    // Pre-fetch all Git files
                    await this._prefetchGitFiles(changedFiles.map(f => f.path));
                    
                    const resourceStates = changedFiles.map(fileInfo => ({
                        resourceUri: vscode.Uri.file(path.join(this._gitDir, fileInfo.path)),
                        command: {
                            title: 'View Changes',
                            command: `sqlServerGitIntegration.viewDiff.${this._instanceId}`,
                            arguments: [vscode.Uri.file(path.join(this._gitDir, fileInfo.path))]
                        },
                        decorations: {
                            strikeThrough: fileInfo.status === 'D',
                            faded: false,
                            tooltip: this._getStatusTooltip(fileInfo.status),
                            iconPath: new vscode.ThemeIcon(this._getStatusIcon(fileInfo.status), new vscode.ThemeColor(this._getStatusColor(fileInfo.status)))
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

    private _parseGitStatus(statusOutput: string): Array<{path: string, status: string}> {
        console.log('Git status output:', statusOutput); // Debug log
        return statusOutput
            .split('\n')
            .filter(line => line.trim())
            .map(line => {
                const status = line.substring(0, 2).trim(); // Get status code (e.g., "M", "A", "D")
                const path = line.substring(3); // Get file path
                console.log(`Parsed: status="${status}", path="${path}"`); // Debug log
                return { path, status };
            });
    }

    private _getStatusTooltip(status: string): string {
        switch (status) {
            case 'M': return 'Modified';
            case 'A': return 'Added';
            case 'D': return 'Deleted';
            case 'R': return 'Renamed';
            case 'C': return 'Copied';
            case 'U': return 'Unmerged';
            case '??': return 'Untracked';
            default: return 'Changed';
        }
    }

    private _getStatusColor(status: string): string {
        switch (status) {
            case 'M': return 'gitDecoration.modifiedResourceForeground';
            case 'A': return 'gitDecoration.addedResourceForeground';
            case 'D': return 'gitDecoration.deletedResourceForeground';
            case 'R': return 'gitDecoration.renamedResourceForeground';
            case 'C': return 'gitDecoration.addedResourceForeground';
            case 'U': return 'gitDecoration.conflictingResourceForeground';
            case '??': return 'gitDecoration.untrackedResourceForeground';
            default: return 'gitDecoration.modifiedResourceForeground';
        }
    }

    private _getStatusIcon(status: string): string {
        switch (status) {
            case 'M': return 'diff-modified';
            case 'A': return 'diff-added'; 
            case 'D': return 'diff-removed';
            case 'R': return 'diff-renamed';
            case 'C': return 'diff-added'; // Use added icon for copied files
            case 'U': return 'error'; // Use error icon for unmerged/conflict
            case '??': return 'new-file'; // Use new-file icon for untracked
            default: return 'diff-modified';
        }
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