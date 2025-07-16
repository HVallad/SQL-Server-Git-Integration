import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { GitManager } from '../gitmanagement';

export class DatabaseSourceControlProvider implements vscode.QuickDiffProvider {
    private _disposables: vscode.Disposable[] = [];
    private _sourceControl: vscode.SourceControl;
    private _changesGroup: vscode.SourceControlResourceGroup;
    private _stagedGroup: vscode.SourceControlResourceGroup;
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
        
        // Create resource groups
        this._stagedGroup = this._sourceControl.createResourceGroup('staged', 'Staged Changes');
        this._changesGroup = this._sourceControl.createResourceGroup('changes', 'Changes');
        
        // Set up input box
        this._sourceControl.inputBox.placeholder = 'Message (press Ctrl+Enter to commit)';
        
        // Register commands
        this._registerCommands();
        
        // Initial update and pre-fetch Git files
        this._update();
    }

    public get instanceId(): string {
        return this._instanceId;
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

        // Stage single file command
        const stageFileCommand = vscode.commands.registerCommand(`sqlServerGitIntegration.stageFile.${this._instanceId}`, async (uri: vscode.Uri) => {
            await this._stageFile(uri);
        });

        // Stage all files command
        const stageAllCommand = vscode.commands.registerCommand(`sqlServerGitIntegration.stageAll.${this._instanceId}`, async () => {
            await this._stageAll();
        });

        // Unstage single file command
        const unstageFileCommand = vscode.commands.registerCommand(`sqlServerGitIntegration.unstageFile.${this._instanceId}`, async (uri: vscode.Uri) => {
            await this._unstageFile(uri);
        });

        // Unstage all files command
        const unstageAllCommand = vscode.commands.registerCommand(`sqlServerGitIntegration.unstageAll.${this._instanceId}`, async () => {
            await this._unstageAll();
        });

        this._disposables.push(commitCommand, refreshCommand, viewDiffCommand, stageFileCommand, stageAllCommand, unstageFileCommand, unstageAllCommand);
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
                console.log('Getting git status...');
                const statusResult = await GitManager.executeCommand('git status --porcelain');
                console.log('Git status result:', statusResult);
                
                if (statusResult.success && statusResult.output) {
                    const changedFiles = this._parseGitStatus(statusResult.output);
                    
                    // Pre-fetch all Git files
                    await this._prefetchGitFiles(changedFiles.map(f => f.path));
                    
                    // Separate staged and unstaged files
                    const stagedFiles: any[] = [];
                    const unstagedFiles: any[] = [];
                    
                    changedFiles.forEach(fileInfo => {
                        const fileUri = vscode.Uri.file(path.join(this._gitDir, fileInfo.path));
                        
                        const resourceState = {
                            resourceUri: fileUri,
                            command: {
                                title: 'View Changes',
                                command: `sqlServerGitIntegration.viewDiff.${this._instanceId}`,
                                arguments: [fileUri]
                            },
                            decorations: {
                                strikeThrough: fileInfo.status === 'D',
                                faded: false,
                                tooltip: this._getStatusTooltip(fileInfo.status),
                                iconPath: new vscode.ThemeIcon(this._getStatusIcon(fileInfo.status), new vscode.ThemeColor(this._getStatusColor(fileInfo.status)))
                            },
                            contextValue: fileInfo.isStaged ? 'staged' : 'unstaged'
                        };
                        
                        if (fileInfo.isStaged) {
                            stagedFiles.push(resourceState);
                        } else {
                            unstagedFiles.push(resourceState);
                        }
                    });
                    
                    // Update both resource groups
                    this._changesGroup.resourceStates = unstagedFiles;
                    this._stagedGroup.resourceStates = stagedFiles;
                    this._sourceControl.count = stagedFiles.length + unstagedFiles.length;
                    
                    console.log(`Updated groups: ${unstagedFiles.length} unstaged, ${stagedFiles.length} staged`);
                } else {
                    this._changesGroup.resourceStates = [];
                    this._stagedGroup.resourceStates = [];
                    this._sourceControl.count = 0;
                }
            } finally {
                process.chdir(originalCwd);
            }
        } catch (error) {
            console.error('Error updating source control:', error);
            this._changesGroup.resourceStates = [];
            this._stagedGroup.resourceStates = [];
            this._sourceControl.count = 0;
        }
    }

    private _parseGitStatus(statusOutput: string): Array<{path: string, status: string, isStaged: boolean}> {
        console.log('Git status output:', statusOutput); // Debug log
        return statusOutput
            .split('\n')
            .filter(line => line.trim())
            .map(line => {
                const statusCode = line.substring(0, 2);
                const indexStatus = statusCode[0]; // Staging area status
                const workTreeStatus = statusCode[1]; // Working directory status
                let filePath = line.substring(3); // Get file path
                
                // Remove quotes from filenames if present (Git adds quotes around filenames with spaces)
                if (filePath.startsWith('"') && filePath.endsWith('"')) {
                    filePath = filePath.slice(1, -1);
                }
                
                // Determine primary status and if it's staged
                let status: string;
                let isStaged: boolean;
                
                if (indexStatus !== ' ' && indexStatus !== '?') {
                    // File has changes in staging area
                    status = indexStatus;
                    isStaged = true;
                } else if (workTreeStatus !== ' ') {
                    // File has changes in working directory only
                    status = workTreeStatus;
                    isStaged = false;
                } else {
                    // Fallback
                    status = statusCode.trim() || 'M';
                    isStaged = false;
                }
                
                console.log(`Parsed: status="${status}", path="${filePath}", staged=${isStaged}`); // Debug log
                return { path: filePath, status, isStaged };
            });
    }

    private _getStatusTooltip(status: string): string {
        switch (status) {
            case 'M': return 'Modified';
            case 'A':
            case '?': return 'Added';
            case 'D': return 'Deleted';
            case 'R': return 'Renamed';
            case 'C': return 'Copied';
            case 'U': return 'Unmerged';
            default: return 'Changed';
        }
    }

    private _getStatusColor(status: string): string {
        switch (status) {
            case 'M': return 'gitDecoration.modifiedResourceForeground';
            case 'A':
            case '?': return 'gitDecoration.addedResourceForeground';
            case 'D': return 'gitDecoration.deletedResourceForeground';
            case 'R': return 'gitDecoration.renamedResourceForeground';
            case 'C': return 'gitDecoration.addedResourceForeground';
            case 'U': return 'gitDecoration.conflictingResourceForeground';
            default: return 'gitDecoration.modifiedResourceForeground';
        }
    }

    private _getStatusIcon(status: string): string {
        switch (status) {
            case 'M': return 'diff-modified';
            case 'A':
            case '?': return 'diff-added'; 
            case 'D': return 'diff-removed';
            case 'R': return 'diff-renamed';
            case 'C': return 'diff-added'; // Use added icon for copied files
            case 'U': return 'error'; // Use error icon for unmerged/conflict
            default: return 'diff-modified';
        }
    }

    private async _stageFile(uri: vscode.Uri) {
        try {
            console.log('_stageFile called with uri:', uri);
            if (!uri || !uri.fsPath) {
                console.log('Invalid URI - uri:', uri, 'fsPath:', uri?.fsPath);
                vscode.window.showErrorMessage('Invalid file URI provided for staging');
                return;
            }

            const relativePath = path.relative(this._gitDir, uri.fsPath);
            const originalCwd = process.cwd();
            process.chdir(this._gitDir);

            try {
                console.log(`Executing: git add "${relativePath}"`);
                const result = await GitManager.executeCommand(`git add "${relativePath}"`);
                console.log('Git add result:', result);
                
                if (result.success) {
                    console.log('Git add successful, calling _update()');
                    await this._update();
                    vscode.window.showInformationMessage(`Staged ${path.basename(relativePath)}`);
                } else {
                    console.log('Git add failed:', result.output);
                    vscode.window.showErrorMessage(`Failed to stage file: ${result.output}`);
                }
            } finally {
                process.chdir(originalCwd);
            }
        } catch (error) {
            console.error('Error staging file:', error);
            vscode.window.showErrorMessage(`Failed to stage file: ${error}`);
        }
    }

    private async _stageAll() {
        try {
            const originalCwd = process.cwd();
            process.chdir(this._gitDir);

            try {
                const result = await GitManager.executeCommand('git add .');
                if (result.success) {
                    this._update();
                    vscode.window.showInformationMessage('Staged all changes');
                } else {
                    vscode.window.showErrorMessage(`Failed to stage all files: ${result.output}`);
                }
            } finally {
                process.chdir(originalCwd);
            }
        } catch (error) {
            console.error('Error staging all files:', error);
            vscode.window.showErrorMessage(`Failed to stage all files: ${error}`);
        }
    }

    private async _unstageFile(uri: vscode.Uri) {
        try {
            if (!uri || !uri.fsPath) {
                vscode.window.showErrorMessage('Invalid file URI provided for unstaging');
                return;
            }

            const relativePath = path.relative(this._gitDir, uri.fsPath);
            const originalCwd = process.cwd();
            process.chdir(this._gitDir);

            try {
                const result = await GitManager.executeCommand(`git reset HEAD "${relativePath}"`);
                if (result.success) {
                    this._update();
                    vscode.window.showInformationMessage(`Unstaged ${path.basename(relativePath)}`);
                } else {
                    vscode.window.showErrorMessage(`Failed to unstage file: ${result.output}`);
                }
            } finally {
                process.chdir(originalCwd);
            }
        } catch (error) {
            console.error('Error unstaging file:', error);
            vscode.window.showErrorMessage(`Failed to unstage file: ${error}`);
        }
    }

    private async _unstageAll() {
        try {
            const originalCwd = process.cwd();
            process.chdir(this._gitDir);

            try {
                const result = await GitManager.executeCommand('git reset HEAD .');
                if (result.success) {
                    this._update();
                    vscode.window.showInformationMessage('Unstaged all changes');
                } else {
                    vscode.window.showErrorMessage(`Failed to unstage all files: ${result.output}`);
                }
            } finally {
                process.chdir(originalCwd);
            }
        } catch (error) {
            console.error('Error unstaging all files:', error);
            vscode.window.showErrorMessage(`Failed to unstage all files: ${error}`);
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