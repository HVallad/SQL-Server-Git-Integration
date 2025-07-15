// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import {RetrieveDatabaseObjects} from './sqlrunner'
import {selectAndSaveDatabaseDirectory, initializeRepoDirectoryAndFiles, getSavedDatabaseDirectory} from './dirmanager'
import { GitManager, GitBranch } from './gitmanagement';
import { SourceControlPanel } from './sourcecontrol/sourceControlPanel';

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
			// Get the saved directory for this database
			const savedDirectory = getSavedDatabaseDirectory(node);
			if (!savedDirectory) {
				vscode.window.showErrorMessage('No directory configured for this database. Please initialize the Git repository first.');
				return;
			}

			// Check if the repository is properly initialized
			const comparisonDir = path.join(savedDirectory, "DatabaseState");
			const gitDir = path.join(savedDirectory, "SourceControlState");
			
			if (!fs.existsSync(comparisonDir) || !fs.existsSync(gitDir)) {
				vscode.window.showErrorMessage('Repository not properly initialized. Please run "Initialize Git Repository" first.');
				return;
			}

			// Create and show the source control panel
			SourceControlPanel.createOrShow(context.extensionUri, node, savedDirectory);

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

export function deactivate() {}
