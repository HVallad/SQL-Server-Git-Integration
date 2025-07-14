// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import {RetrieveDatabaseObjects} from './sqlrunner'
import {selectAndSaveDatabaseDirectory, initializeRepoDirectoryAndFiles} from './dirmanager'
import { GitManager, GitBranch } from './gitmanagement';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "sql-server-git-integration" is now active!');

	const disposable = vscode.commands.registerCommand('sql-server-git-integration.helloWorld', () => {
		vscode.window.showInformationMessage('Hello World from SQL Server Git Integration!');
	});

	const initGitRepoCommand = vscode.commands.registerCommand('sql-server-git-integration.initGitRepo',  async (node) => {
		const repoDir = await selectAndSaveDatabaseDirectory(node,context)

		if (!repoDir || repoDir === "") {
			return false;
		}

		const databaseObjects = await RetrieveDatabaseObjects(node);
		console.log('Database objects:', databaseObjects);
		const repoInitialization = initializeRepoDirectoryAndFiles(repoDir, databaseObjects, "temp")


		vscode.window.showInformationMessage(`Initialize Git Repository clicked for: ${node?.label || 'Database'}`);
	});

	const syncDatabaseCommand = vscode.commands.registerCommand('sql-server-git-integration.syncDatabase', (node) => {
		vscode.window.showInformationMessage(`Sync Database to Git clicked for: ${node?.label || 'Database'}`);
	});

	const viewGitHistoryCommand = vscode.commands.registerCommand('sql-server-git-integration.viewGitHistory', async (node) => {
		vscode.window.showInformationMessage(`View Git History clicked for: ${node?.label || 'Database'}`);
	});

	context.subscriptions.push(
		disposable,
		initGitRepoCommand,
		syncDatabaseCommand,
		viewGitHistoryCommand
	);
}

export function deactivate() {}
