// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "sql-server-git-integration" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('sql-server-git-integration.helloWorld', () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		vscode.window.showInformationMessage('Hello World from SQL Server Git Integration!');
	});

	// Register minimal command handlers for the new menu items
	const initGitRepoCommand = vscode.commands.registerCommand('sql-server-git-integration.initGitRepo', (node) => {
		vscode.window.showInformationMessage(`Initialize Git Repository clicked for: ${node?.label || 'Database'}`);
	});

	const syncDatabaseCommand = vscode.commands.registerCommand('sql-server-git-integration.syncDatabase', (node) => {
		vscode.window.showInformationMessage(`Sync Database to Git clicked for: ${node?.label || 'Database'}`);
	});

	const viewGitHistoryCommand = vscode.commands.registerCommand('sql-server-git-integration.viewGitHistory', (node) => {
		vscode.window.showInformationMessage(`View Git History clicked for: ${node?.label || 'Database'}`);
	});

	// Add all disposables to the context subscriptions
	context.subscriptions.push(
		disposable,
		initGitRepoCommand,
		syncDatabaseCommand,
		viewGitHistoryCommand
	);
}

// This method is called when your extension is deactivated
export function deactivate() {}
