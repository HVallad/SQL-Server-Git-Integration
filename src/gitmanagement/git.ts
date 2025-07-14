import * as vscode from 'vscode';
import * as child_process from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export interface GitCloneOptions {
    url: string;
    targetPath: string;
    branch?: string;
    depth?: number;
}

export interface GitBranch {
    name: string;
    isRemote: boolean;
    isCurrent?: boolean;
}

interface BranchQuickPickItem extends vscode.QuickPickItem {
    branchName?: string;
}

export class GitManager {
    /**
     * Clone a Git repository to a specified directory
     */
    static async cloneRepository(options: GitCloneOptions): Promise<boolean> {
        try {
            const { url, targetPath, branch, depth } = options;
            
            // Ensure target directory exists
            if (!fs.existsSync(targetPath)) {
                fs.mkdirSync(targetPath, { recursive: true });
            }
            
            // Build git clone command
            let command = `git clone`;
            
            if (branch) {
                command += ` -b ${branch}`;
            }
            
            if (depth) {
                command += ` --depth ${depth}`;
            }
            
            command += ` "${url}" "${targetPath}"`;
            
            console.log(`Executing: ${command}`);
            
            // Execute git clone command
            const result = await this.executeCommand(command);
            
            if (result.success) {
                vscode.window.showInformationMessage(`Successfully cloned repository to ${targetPath}`);
                return true;
            } else {
                vscode.window.showErrorMessage(`Failed to clone repository: ${result.error}`);
                return false;
            }
            
        } catch (error) {
            console.error('Error cloning repository:', error);
            vscode.window.showErrorMessage(`Error cloning repository: ${error}`);
            return false;
        }
    }
    
    /**
     * Get available branches from a Git repository URL
     */
    static async getAvailableBranches(url: string): Promise<GitBranch[]> {
        try {
            // Use git ls-remote to get remote branches without cloning
            const command = `git ls-remote --heads "${url}"`;
            console.log(`Fetching branches: ${command}`);
            
            const result = await this.executeCommand(command);
            
            if (!result.success) {
                throw new Error(`Failed to fetch branches: ${result.error}`);
            }
            
            const branches: GitBranch[] = [];
            const lines = result.output?.split('\n').filter(line => line.trim()) || [];
            
            for (const line of lines) {
                // Parse git ls-remote output format: <commit-hash>\trefs/heads/<branch-name>
                const match = line.match(/^[a-f0-9]+\s+refs\/heads\/(.+)$/);
                if (match) {
                    const branchName = match[1];
                    branches.push({
                        name: branchName,
                        isRemote: true
                    });
                }
            }
            
            // Sort branches with common names first (main, master, develop, etc.)
            branches.sort((a, b) => {
                const priorityOrder = ['main', 'master', 'develop', 'dev', 'staging', 'production'];
                const aIndex = priorityOrder.indexOf(a.name);
                const bIndex = priorityOrder.indexOf(b.name);
                
                if (aIndex !== -1 && bIndex !== -1) {
                    return aIndex - bIndex;
                } else if (aIndex !== -1) {
                    return -1;
                } else if (bIndex !== -1) {
                    return 1;
                }
                
                return a.name.localeCompare(b.name);
            });
            
            console.log(`Found ${branches.length} branches:`, branches.map(b => b.name));
            return branches;
            
        } catch (error) {
            console.error('Error fetching branches:', error);
            throw error;
        }
    }
    
    /**
     * Prompt user for repository URL and clone it with branch selection
     */
    static async promptAndCloneRepository(targetPath: string): Promise<boolean> {
        try {
            // Prompt user for repository URL
            const url = await vscode.window.showInputBox({
                prompt: 'Enter Git repository URL',
                placeHolder: 'https://github.com/username/repository.git',
                validateInput: (value) => {
                    if (!value) {
                        return 'Repository URL is required';
                    }
                    if (!this.isValidGitUrl(value)) {
                        return 'Please enter a valid Git repository URL';
                    }
                    return null;
                }
            });
            
            if (!url) {
                return false; // User cancelled
            }
            
            // Show progress while fetching branches
            let branches: GitBranch[] = [];
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Fetching available branches...',
                cancellable: false
            }, async (progress) => {
                try {
                    branches = await this.getAvailableBranches(url);
                    progress.report({ increment: 100 });
                } catch (error) {
                    vscode.window.showWarningMessage(`Could not fetch branches: ${error}. Proceeding with default branch.`);
                    branches = [];
                }
            });
            
            // Let user select a branch if branches were found
            let selectedBranch: string | undefined;
            
            if (branches.length > 0) {
                const branchChoices = branches.map(branch => ({
                    label: branch.name,
                    description: branch.isRemote ? 'Remote branch' : 'Local branch',
                    value: branch.name
                }));
                
                // Add option to use default branch
                branchChoices.unshift({
                    label: 'Use default branch (main/master)',
                    description: 'Clone without specifying a branch',
                    value: ''
                });
                
                const selected = await vscode.window.showQuickPick(branchChoices, {
                    placeHolder: 'Select a branch to clone',
                    title: 'Branch Selection'
                });
                
                if (!selected) {
                    return false; // User cancelled
                }
                
                selectedBranch = selected.value || undefined;
            } else {
                // Fallback to manual branch input if fetching failed
                const branch = await vscode.window.showInputBox({
                    prompt: 'Enter branch name (optional)',
                    placeHolder: 'main',
                    value: 'main'
                });
                
                selectedBranch = branch || undefined;
            }
            
            return await this.cloneRepository({
                url,
                targetPath,
                branch: selectedBranch
            });
            
        } catch (error) {
            console.error('Error in promptAndCloneRepository:', error);
            vscode.window.showErrorMessage(`Error: ${error}`);
            return false;
        }
    }
    
    /**
     * Enhanced version that shows branch selection in a more user-friendly way
     */
    static async promptAndCloneRepositoryWithBranchSelection(targetPath: string): Promise<boolean> {
        try {
            // Step 1: Get repository URL
            const url = await vscode.window.showInputBox({
                prompt: 'Enter Git repository URL',
                placeHolder: 'https://github.com/username/repository.git',
                validateInput: (value) => {
                    if (!value) {
                        return 'Repository URL is required';
                    }
                    if (!this.isValidGitUrl(value)) {
                        return 'Please enter a valid Git repository URL';
                    }
                    return null;
                }
            });
            
            if (!url) {
                return false; // User cancelled
            }
            
            // Step 2: Fetch and display branches
            let branches: GitBranch[] = [];
            try {
                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: `Fetching branches from ${this.getRepositoryName(url)}...`,
                    cancellable: false
                }, async (progress) => {
                    branches = await this.getAvailableBranches(url);
                    progress.report({ increment: 100 });
                });
            } catch (error) {
                const continueAnyway = await vscode.window.showWarningMessage(
                    `Could not fetch branches: ${error}. Would you like to continue with the default branch?`,
                    'Continue Anyway',
                    'Cancel'
                );
                
                if (continueAnyway !== 'Continue Anyway') {
                    return false;
                }
            }
            
            // Step 3: Branch selection
            let selectedBranch: string | undefined;
            
            if (branches.length > 0) {
                // Group branches by type for better organization
                const mainBranches = branches.filter(b => ['main', 'master'].includes(b.name));
                const otherBranches = branches.filter(b => !['main', 'master'].includes(b.name));
                
                const branchChoices: BranchQuickPickItem[] = [];
                
                // Add main branches first
                if (mainBranches.length > 0) {
                    branchChoices.push({
                        label: '$(repo) Main Branches',
                        kind: vscode.QuickPickItemKind.Separator
                    });
                    
                    mainBranches.forEach(branch => {
                        branchChoices.push({
                            label: `$(git-branch) ${branch.name}`,
                            description: 'Primary branch',
                            branchName: branch.name
                        });
                    });
                }
                
                // Add other branches
                if (otherBranches.length > 0) {
                    if (branchChoices.length > 0) {
                        branchChoices.push({
                            label: '$(git-branch) Other Branches',
                            kind: vscode.QuickPickItemKind.Separator
                        });
                    }
                    
                    otherBranches.forEach(branch => {
                        branchChoices.push({
                            label: `$(git-branch) ${branch.name}`,
                            description: 'Feature/development branch',
                            branchName: branch.name
                        });
                    });
                }
                
                // Add option to use default
                branchChoices.push({
                    label: '$(repo-clone) Use Default Branch',
                    description: 'Clone without specifying a branch',
                    branchName: ''
                });
                
                const selected = await vscode.window.showQuickPick(branchChoices, {
                    placeHolder: `Select a branch from ${this.getRepositoryName(url)}`,
                    title: 'Branch Selection'
                });
                
                if (!selected) {
                    return false; // User cancelled
                }
                
                selectedBranch = selected.branchName || undefined;
            } else {
                // Fallback to manual input
                const branch = await vscode.window.showInputBox({
                    prompt: 'Enter branch name (optional)',
                    placeHolder: 'main',
                    value: 'main'
                });
                
                selectedBranch = branch || undefined;
            }
            
            // Step 4: Clone with progress
            return await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Cloning ${this.getRepositoryName(url)}${selectedBranch ? ` (${selectedBranch})` : ''}...`,
                cancellable: false
            }, async (progress) => {
                const success = await this.cloneRepository({
                    url,
                    targetPath,
                    branch: selectedBranch
                });
                
                progress.report({ increment: 100 });
                return success;
            });
            
        } catch (error) {
            console.error('Error in promptAndCloneRepositoryWithBranchSelection:', error);
            vscode.window.showErrorMessage(`Error: ${error}`);
            return false;
        }
    }
    
    /**
     * Extract repository name from URL for display purposes
     */
    private static getRepositoryName(url: string): string {
        try {
            // Handle different URL formats
            const patterns = [
                /github\.com[\/:]([^\/]+)\/([^\/]+?)(?:\.git)?$/,
                /gitlab\.com[\/:]([^\/]+)\/([^\/]+?)(?:\.git)?$/,
                /bitbucket\.org[\/:]([^\/]+)\/([^\/]+?)(?:\.git)?$/,
                /([^\/]+)\/([^\/]+?)(?:\.git)?$/
            ];
            
            for (const pattern of patterns) {
                const match = url.match(pattern);
                if (match) {
                    return `${match[1]}/${match[2]}`;
                }
            }
            
            // Fallback: extract from URL
            const urlParts = url.split('/');
            return urlParts[urlParts.length - 1].replace('.git', '');
        } catch {
            return 'repository';
        }
    }
    
    /**
     * Validate if the URL is a valid Git repository URL
     */
    public static isValidGitUrl(url: string): boolean {
        // Basic validation for common Git URL formats
        const gitUrlPatterns = [
            /^https?:\/\/.*\.git$/,
            /^git@.*:.*\.git$/,
            /^ssh:\/\/.*\.git$/,
            /^git:\/\/.*\.git$/,
            // Also allow URLs without .git extension
            /^https?:\/\/.*\/[^\/]+\/[^\/]+$/,
            /^git@.*:[^\/]+\/[^\/]+$/
        ];
        
        return gitUrlPatterns.some(pattern => pattern.test(url));
    }
    
    /**
     * Execute a shell command
     */
    private static executeCommand(command: string): Promise<{ success: boolean; output?: string; error?: string }> {
        return new Promise((resolve) => {
            child_process.exec(command, { maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
                if (error) {
                    resolve({
                        success: false,
                        error: error.message || stderr || 'Unknown error'
                    });
                } else {
                    resolve({
                        success: true,
                        output: stdout
                    });
                }
            });
        });
    }
    
    /**
     * Check if Git is available on the system
     */
    static async isGitAvailable(): Promise<boolean> {
        try {
            const result = await this.executeCommand('git --version');
            return result.success;
        } catch {
            return false;
        }
    }
}
