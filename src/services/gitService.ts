import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Service for Git operations
 */
export class GitService {
    /**
     * Check if Git is installed on the system
     * @returns True if Git is installed, false otherwise
     */
    public async isGitInstalled(): Promise<boolean> {
        try {
            await execAsync('git --version');
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Validate a Git repository URL
     * @param url The Git repository URL to validate
     * @returns True if the URL appears to be valid
     */
    public validateGitUrl(url: string): boolean {
        if (!url || url.trim().length === 0) {
            return false;
        }

        // Check for common Git URL patterns
        const httpsPattern = /^https?:\/\/.+\.git$/i;
        const sshPattern = /^git@.+:.+\.git$/i;
        const gitProtocolPattern = /^git:\/\/.+\.git$/i;

        return httpsPattern.test(url) || sshPattern.test(url) || gitProtocolPattern.test(url);
    }

    /**
     * Fetch the list of remote branches from a Git repository
     * @param repositoryUrl The Git repository URL
     * @returns Array of branch names
     */
    public async fetchRemoteBranches(repositoryUrl: string): Promise<string[]> {
        try {
            console.log(`[MSSQL-Git-Sync] Fetching branches from: ${repositoryUrl}`);
            
            // Use git ls-remote to list remote branches without cloning
            const { stdout } = await execAsync(`git ls-remote --heads "${repositoryUrl}"`);
            
            // Parse the output to extract branch names
            // Format: <hash>\trefs/heads/<branch-name>
            const branches = stdout
                .split('\n')
                .filter(line => line.trim().length > 0)
                .map(line => {
                    const match = line.match(/refs\/heads\/(.+)$/);
                    return match ? match[1] : null;
                })
                .filter(branch => branch !== null) as string[];

            console.log(`[MSSQL-Git-Sync] Found ${branches.length} branches`);
            return branches;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`[MSSQL-Git-Sync] Error fetching branches: ${errorMessage}`);
            
            // Check for common error scenarios
            if (errorMessage.includes('Authentication failed') || errorMessage.includes('Permission denied')) {
                throw new Error('Authentication failed. Please check your credentials or use SSH keys.');
            } else if (errorMessage.includes('Could not resolve host') || errorMessage.includes('Network is unreachable')) {
                throw new Error('Network error. Please check your internet connection.');
            } else if (errorMessage.includes('Repository not found')) {
                throw new Error('Repository not found. Please check the URL.');
            } else {
                throw new Error(`Failed to fetch branches: ${errorMessage}`);
            }
        }
    }

    /**
     * Clone a Git repository to a specific path
     * @param repositoryUrl The Git repository URL
     * @param branchName The branch to clone
     * @param destinationPath The destination path for the clone
     * @param progress Optional progress reporter
     */
    public async cloneRepository(
        repositoryUrl: string,
        branchName: string,
        destinationPath: string,
        progress?: vscode.Progress<{ message?: string; increment?: number }>
    ): Promise<void> {
        try {
            console.log(`[MSSQL-Git-Sync] Cloning repository: ${repositoryUrl}`);
            console.log(`[MSSQL-Git-Sync] Branch: ${branchName}`);
            console.log(`[MSSQL-Git-Sync] Destination: ${destinationPath}`);

            if (progress) {
                progress.report({ message: `Cloning branch '${branchName}' from repository...` });
            }

            // Clone the repository with the specified branch
            // --single-branch: Only clone the specified branch
            // --depth 1: Shallow clone (faster, less disk space)
            const command = `git clone --branch "${branchName}" --single-branch --depth 1 "${repositoryUrl}" "${destinationPath}"`;
            
            const { stdout, stderr } = await execAsync(command, {
                maxBuffer: 10 * 1024 * 1024 // 10MB buffer for large repositories
            });

            console.log(`[MSSQL-Git-Sync] Clone output: ${stdout}`);
            if (stderr) {
                console.log(`[MSSQL-Git-Sync] Clone stderr: ${stderr}`);
            }

            if (progress) {
                progress.report({ message: 'Repository cloned successfully!' });
            }

            console.log(`[MSSQL-Git-Sync] ✓ Repository cloned successfully`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`[MSSQL-Git-Sync] Error cloning repository: ${errorMessage}`);

            // Check for common error scenarios
            if (errorMessage.includes('Authentication failed') || errorMessage.includes('Permission denied')) {
                throw new Error('Authentication failed. Please check your credentials or use SSH keys.');
            } else if (errorMessage.includes('Could not resolve host') || errorMessage.includes('Network is unreachable')) {
                throw new Error('Network error. Please check your internet connection.');
            } else if (errorMessage.includes('Repository not found')) {
                throw new Error('Repository not found. Please check the URL.');
            } else if (errorMessage.includes('already exists')) {
                throw new Error('Destination folder already exists. Please remove it first or choose a different location.');
            } else if (errorMessage.includes('not found') && errorMessage.includes('branch')) {
                throw new Error(`Branch '${branchName}' not found in the repository.`);
            } else {
                throw new Error(`Failed to clone repository: ${errorMessage}`);
            }
        }
    }

    /**
     * Check if a directory is a Git repository
     * @param directoryPath The directory path to check
     * @returns True if the directory is a Git repository
     */
    public async isGitRepository(directoryPath: string): Promise<boolean> {
        try {
            await execAsync('git rev-parse --git-dir', { cwd: directoryPath });
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Get the current branch name of a Git repository
     * @param repositoryPath The path to the Git repository
     * @returns The current branch name
     */
    public async getCurrentBranch(repositoryPath: string): Promise<string> {
        try {
            const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: repositoryPath });
            return stdout.trim();
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to get current branch: ${errorMessage}`);
        }
    }

    /**
     * Get the remote URL of a Git repository
     * @param repositoryPath The path to the Git repository
     * @returns The remote URL
     */
    public async getRemoteUrl(repositoryPath: string): Promise<string> {
        try {
            const { stdout } = await execAsync('git config --get remote.origin.url', { cwd: repositoryPath });
            return stdout.trim();
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to get remote URL: ${errorMessage}`);
        }
    }

    /**
     * Pull the latest changes from the remote repository
     * @param repositoryPath The path to the Git repository
     * @param progress Optional progress reporter
     */
    public async pullLatestChanges(
        repositoryPath: string,
        progress?: vscode.Progress<{ message?: string; increment?: number }>
    ): Promise<void> {
        try {
            if (progress) {
                progress.report({ message: 'Pulling latest changes from remote...' });
            }

            const { stdout, stderr } = await execAsync('git pull', { cwd: repositoryPath });
            
            console.log(`[MSSQL-Git-Sync] Pull output: ${stdout}`);
            if (stderr) {
                console.log(`[MSSQL-Git-Sync] Pull stderr: ${stderr}`);
            }

            if (progress) {
                progress.report({ message: 'Latest changes pulled successfully!' });
            }

            console.log(`[MSSQL-Git-Sync] ✓ Latest changes pulled successfully`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`[MSSQL-Git-Sync] Error pulling changes: ${errorMessage}`);
            throw new Error(`Failed to pull latest changes: ${errorMessage}`);
        }
    }

    /**
     * Get Git version information
     * @returns Git version string
     */
    public async getGitVersion(): Promise<string> {
        try {
            const { stdout } = await execAsync('git --version');
            return stdout.trim();
        } catch (error) {
            throw new Error('Git is not installed or not in PATH');
        }
    }
}

