import * as vscode from 'vscode'
import {getServerDatabaseKey, DatabaseObject} from '../sqlrunner'
import * as fs from 'fs';
import * as path from 'path';

// Interface for database directory configuration
export interface DatabaseDirectoryConfig {
	[key: string]: string; // Key format: "serverName_databaseName", Value: directory path
}

export function getExtensionGlobalPath(context: vscode.ExtensionContext): string
{
    const extension = vscode.extensions.getExtension(context.extension.id);

    return path.join(context.globalStorageUri.fsPath, extension?.packageJSON.name)
}

// Private function to prompt user for directory selection and save per database/server
export async function selectAndSaveDatabaseDirectory(node: any, context: vscode.ExtensionContext): Promise<string> {
	try {
		// Get server and database information
		const dbInfo = getServerDatabaseKey(node);
		if (!dbInfo) {
			vscode.window.showErrorMessage('Could not identify database and server information');
			return "";
		}

		const { serverName, databaseName, key } = dbInfo;

		// Get current configuration
		const config = vscode.workspace.getConfiguration('sqlServerGitIntegration');
		const currentDirectories: DatabaseDirectoryConfig = config.get('databaseDirectories') || {};

		// Check if directory is already configured for this database
		const existingDirectory = currentDirectories[key];
		let selectedDirectory: string;

        const choices: any[] = []

        const databaseRepoPath = path.join(getExtensionGlobalPath(context), key);

        if (existingDirectory) {
             choices.push(
                {
                    label: `Keep Current: ${existingDirectory}`,
                    description: 'Use the existing directory',
                    value: 'keep'
                }
             )
        }

        if (databaseRepoPath !== existingDirectory) {
            choices.push(
                {
					label: `Auto`,
					description: 'Let extension build directory',
					value: 'auto'
				}
            )
        }

        choices.push(
                {
					label: 'Select New Directory',
					description: 'Choose a different directory',
					value: 'change'
				}
        ) 


        const choice = await vscode.window.showQuickPick([...choices], {
				placeHolder: `Directory for ${serverName} - ${databaseName}`,
				title: 'Database Directory Configuration'
        });

        if (!choice) {
				return ""; // User cancelled
			}

			if (choice.value === 'keep') {
				return existingDirectory;
			}

            if (choice.value === "auto") {
                const databaseRepoPath = path.join(getExtensionGlobalPath(context), key);

                if (!databaseRepoPath || databaseRepoPath.length === 0) {
                    return ""; // User cancelled
                }

                currentDirectories[key] = databaseRepoPath;
                await config.update('databaseDirectories', currentDirectories, vscode.ConfigurationTarget.Global);
                return currentDirectories[key]
            }

            if (choice.value === "change") {
                // Prompt user to select a new directory
                const directoryUri = await vscode.window.showOpenDialog({
                    canSelectFiles: false,
                    canSelectFolders: true,
                    canSelectMany: false,
                    openLabel: 'Select Directory',
                    title: `Select directory for ${serverName} - ${databaseName}`
                });

                if (!directoryUri || directoryUri.length === 0) {
                    return ""; // User cancelled
                }

                selectedDirectory = directoryUri[0].fsPath;

                // Save the directory to configuration
                currentDirectories[key] = selectedDirectory;
                await config.update('databaseDirectories', currentDirectories, vscode.ConfigurationTarget.Global);

                console.log(`Saved directory for ${key}: ${selectedDirectory}`);
                vscode.window.showInformationMessage(
                    `Directory saved for ${serverName} - ${databaseName}: ${selectedDirectory}`
                );

                return currentDirectories[key];
            }

        return ""

	} catch (error: any) {
		console.error('Error selecting/saving database directory:', error);
		vscode.window.showErrorMessage(`Failed to configure directory: ${error.message}`);
		return "";
	}
}

// Private function to get saved directory for a database/server combination
export function getSavedDatabaseDirectory(node: any): string | undefined {
	try {
		const dbInfo = getServerDatabaseKey(node);
		if (!dbInfo) {
			return undefined;
		}

		const config = vscode.workspace.getConfiguration('sqlServerGitIntegration');
		const currentDirectories: DatabaseDirectoryConfig = config.get('databaseDirectories') || {};
		
		return currentDirectories[dbInfo.key];
	} catch (error) {
		console.error('Error getting saved database directory:', error);
		return undefined;
	}
}

export async function initializeRepoDirectoryAndFiles(repoDir: string, objectList: DatabaseObject[], gitCloneURL: string): Promise<boolean>
{
	if (!fs.existsSync(repoDir)) {
		return false;
	}

    const comparisonDir = path.join(repoDir, "comparison")
    if (fs.existsSync(comparisonDir))
    {
        return false;
    }

    const gitDir = path.join(repoDir, "versioned")
    if (fs.existsSync(gitDir) || !gitCloneURL)
    {
        return false;
    }

    //setup directory that is going to maintain the state of the actual database
	for (const obj of objectList) {
		const declaredSchemaDir = path.join(comparisonDir,"schemas", obj.schema, obj.type);
		if (!fs.existsSync(declaredSchemaDir)) {
			fs.mkdirSync(declaredSchemaDir, {recursive: true});
		}
		const filePath = path.join(declaredSchemaDir, `${obj.name}.sql`);
		fs.writeFileSync(filePath, obj.definition);
	}

    //setup directory for git repository
    

	return true
}