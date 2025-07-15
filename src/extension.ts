// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import {RetrieveDatabaseObjects} from './sqlrunner'
import {selectAndSaveDatabaseDirectory, initializeRepoDirectoryAndFiles, getDatabaseDirectoryFromNode} from './dirmanager'
import { GitManager, GitBranch } from './gitmanagement';
import { DatabaseSourceControlProvider } from './sourcecontrol/databaseSourceControlProvider';
import * as path from 'path';
import * as fs from 'fs';

// Add this at the top level of the extension
let currentSourceControlProvider: DatabaseSourceControlProvider | undefined;

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
		const repoInitializationResult = initializeRepoDirectoryAndFiles(repoDir, databaseObjects)

		if (!repoInitializationResult) {
			vscode.window.showErrorMessage('Failed to initialize Git repository');
			return false;
		}

		vscode.window.showInformationMessage(`Initialize Git Repository clicked for: ${node?.label || 'Database'}`);
	});

	const dbSourceControlCommand = vscode.commands.registerCommand('sql-server-git-integration.dbSourceControl', async (node) => {
		try {
			// Dispose of previous provider if it exists
			if (currentSourceControlProvider) {
				currentSourceControlProvider.dispose();
				currentSourceControlProvider = undefined;
			}

			// Get the directory using the database node as key
			const savedDirectory = getDatabaseDirectoryFromNode(node, context);
			if (!savedDirectory) {
				vscode.window.showErrorMessage('Could not determine directory for this database.');
				return;
			}

			// Check if the repository is properly initialized
			const gitDir = path.join(savedDirectory, "SourceControlState");
			
			if (!fs.existsSync(gitDir)) {
				vscode.window.showErrorMessage('Repository not properly initialized. Please run "Initialize Git Repository" first.');
				return;
			}

			// Create source control provider
			currentSourceControlProvider = new DatabaseSourceControlProvider(gitDir, context.extensionUri, context);

			// Show the source control view
			vscode.commands.executeCommand('workbench.view.scm');

			vscode.window.showInformationMessage(`Source control opened for: ${node?.label || 'Database'}`);

		} catch (error) {
			console.error('Error opening source control:', error);
			vscode.window.showErrorMessage(`Failed to open source control: ${error}`);
		}
	});

	const viewGitHistoryCommand = vscode.commands.registerCommand('sql-server-git-integration.viewGitHistory', async (node) => {
		vscode.window.showInformationMessage(`View Git History clicked for: ${node?.label || 'Database'}`);
	});

	context.subscriptions.push(
		disposable,
		initGitRepoCommand,
		dbSourceControlCommand,
		viewGitHistoryCommand
	);
}

// Also dispose when the extension deactivates
export function deactivate() {
	if (currentSourceControlProvider) {
		currentSourceControlProvider.dispose();
	}
}
