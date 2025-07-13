// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as sql from 'mssql';

// Interface for query selection data
interface ISelectionData {
	startLine: number;
	startColumn: number;
	endLine: number;
	endColumn: number;
}

// Interface for execution plan options
interface ExecutionPlanOptions {
	includeEstimatedExecutionPlanXml?: boolean;
	includeActualExecutionPlanXml?: boolean;
}

// Interface for query execute parameters
interface QueryExecuteParams {
	ownerUri: string;
	executionPlanOptions?: ExecutionPlanOptions;
	querySelection: ISelectionData;
}

// Interface for query result
interface QueryResult {
	resultSetSummary?: {
		rowCount: number;
		columnInfo: any[];
	};
	rows?: any[][];
}

// Interface for MSSQL extension API
interface MssqlExtensionApi {
	sendRequest(requestType: any, params: any): Promise<any>;
	getDatabaseNameFromTreeNode(node: any): string;
	getConnectionString(connectionUri: string, includePassword: boolean): string;
}

// Interface for database objects
interface DatabaseObject {
	name: string;
	type: string;
	schema: string;
	object_id: number;
}

// Interface for database directory configuration
interface DatabaseDirectoryConfig {
	[key: string]: string; // Key format: "serverName_databaseName", Value: directory path
}

// Generic method to execute SQL queries with automatic connection handling
async function executeQuery(node: any, query: string): Promise<any[]> {
	try {
		const mssqlExtension = vscode.extensions.getExtension('ms-mssql.mssql');
		if (!mssqlExtension) throw new Error('MSSQL extension not found');
		if (!mssqlExtension.isActive) await mssqlExtension.activate();
		const mssqlApi: MssqlExtensionApi = mssqlExtension.exports;
		
		// Extract actual server name from URN metadata
		let actualServerName = 'localhost';
		if (node._metadata && node._metadata.urn) {
			const urnMatch = node._metadata.urn.match(/Server\[@Name='([^']+)'\]/);
			if (urnMatch) {
				actualServerName = urnMatch[1];
				console.log('Server from URN:', actualServerName);
			}
		}
		
		const connectionUri = node._sessionId || node.connectionProfile?.id || node.sessionId;
		if (!connectionUri) throw new Error('Could not determine connection URI from node');
		
		const connectionString = await mssqlApi.getConnectionString(connectionUri, true);
		console.log('Raw connection string:', connectionString);
		
		// Parse connection string parameters
		const connectionParams: any = {};
		connectionString.split(';').forEach(param => {
			const [key, value] = param.split('=');
			if (key && value) {
				connectionParams[key.trim()] = value.trim();
			}
		});
		
		console.log('Parsed connection parameters:', connectionParams);
		
		// Check if connection string already has SQL Server authentication
		const hasUserCredentials = connectionParams['User ID'] || connectionParams['UID'] || connectionParams['User'];
		const hasPassword = connectionParams['Password'] || connectionParams['PWD'];
		const hasIntegratedSecurity = connectionParams['Integrated Security'] === 'True' || connectionParams['Integrated Security'] === 'SSPI';
		
		console.log('Authentication detection:', {
			hasUserCredentials: !!hasUserCredentials,
			hasPassword: !!hasPassword,
			hasIntegratedSecurity: hasIntegratedSecurity
		});
		
		// Use the actual server name from URN, with fallback to connection string
		const serverFromConnectionString = connectionParams['Data Source'] || connectionParams['Server'];
		const finalServerName = actualServerName !== 'localhost' ? actualServerName : serverFromConnectionString;
		
		console.log('Final server name to use:', finalServerName);
		
		// Base configuration
		const config: any = {
			server: finalServerName,
			database: connectionParams['Initial Catalog'] || connectionParams['Database'],
			connectionTimeout: 30000,
			requestTimeout: 30000,
			options: {
				encrypt: connectionParams['Encrypt'] === 'True',
				trustServerCertificate: true,
				enableArithAbort: true
			}
		};
		
		// Handle named instances
		if (finalServerName && finalServerName.includes('\\')) {
			const [serverName, instanceName] = finalServerName.split('\\');
			config.server = serverName;
			if (instanceName) {
				config.options.instanceName = instanceName;
				console.log(`Parsed named instance - Server: ${serverName}, Instance: ${instanceName}`);
			}
		}
		
		// Try different authentication approaches
		if (hasUserCredentials && hasPassword) {
			// Use SQL Server authentication from connection string
			config.user = hasUserCredentials;
			config.password = hasPassword;
			console.log('Using SQL Server authentication from connection string:', JSON.stringify({ ...config, password: '***' }, null, 2));
			
			const pool = new sql.ConnectionPool(config);
			await pool.connect();
			
			const result = await pool.request().query(query);
			await pool.close();
			
			return result.recordset;
			
		} else if (hasIntegratedSecurity) {
			// Windows Authentication is not supported
			throw new Error('Windows Authentication (Integrated Security) is not supported by this extension. Please use SQL Server Authentication instead.');
			
		} else {
			// No authentication method detected - prompt for SQL Server credentials
			console.log('No authentication detected, prompting for SQL Server credentials...');
			
			const username = await vscode.window.showInputBox({
				prompt: 'Enter SQL Server username',
				placeHolder: 'sa'
			});
			
			if (!username) {
				throw new Error('Username is required for SQL Server authentication');
			}
			
			const password = await vscode.window.showInputBox({
				prompt: 'Enter SQL Server password',
				password: true
			});
			
			if (!password) {
				throw new Error('Password is required for SQL Server authentication');
			}
			
			const sqlConfig = { ...config };
			sqlConfig.user = username;
			sqlConfig.password = password;
			
			console.log('Using prompted SQL Server credentials:', JSON.stringify({ ...sqlConfig, password: '***' }, null, 2));
			const pool = new sql.ConnectionPool(sqlConfig);
			await pool.connect();
			
			const result = await pool.request().query(query);
			await pool.close();
			
			return result.recordset;
		}
		
	} catch (error: any) {
		console.error('Error executing query:', error);
		throw error;
	}
}

// Private function to get server and database names from node
function getServerDatabaseKey(node: any): { serverName: string, databaseName: string, key: string } | null {
	try {
		// Extract server name from URN metadata
		let serverName = 'localhost';
		if (node._metadata && node._metadata.urn) {
			const urnMatch = node._metadata.urn.match(/Server\[@Name='([^']+)'\]/);
			if (urnMatch) {
				serverName = urnMatch[1];
			}
		}

		// Get database name using MSSQL extension API
		const mssqlExtension = vscode.extensions.getExtension('ms-mssql.mssql');
		if (!mssqlExtension || !mssqlExtension.isActive) {
			console.error('MSSQL extension not available');
			return null;
		}
		
		const mssqlApi: MssqlExtensionApi = mssqlExtension.exports;
		const databaseName = mssqlApi.getDatabaseNameFromTreeNode(node);
		
		if (!databaseName) {
			console.error('Could not extract database name from node');
			return null;
		}

		// Create a safe key for storage (remove invalid characters)
		const sanitizedServer = serverName.replace(/[\\/:*?"<>|]/g, '_');
		const sanitizedDatabase = databaseName.replace(/[\\/:*?"<>|]/g, '_');
		const key = `${sanitizedServer}_${sanitizedDatabase}`;

		return {
			serverName,
			databaseName,
			key
		};
	} catch (error) {
		console.error('Error extracting server/database info:', error);
		return null;
	}
}

// Private function to prompt user for directory selection and save per database/server
async function selectAndSaveDatabaseDirectory(node: any): Promise<string | undefined> {
	try {
		// Get server and database information
		const dbInfo = getServerDatabaseKey(node);
		if (!dbInfo) {
			vscode.window.showErrorMessage('Could not identify database and server information');
			return undefined;
		}

		const { serverName, databaseName, key } = dbInfo;

		// Get current configuration
		const config = vscode.workspace.getConfiguration('sqlServerGitIntegration');
		const currentDirectories: DatabaseDirectoryConfig = config.get('databaseDirectories') || {};

		// Check if directory is already configured for this database
		const existingDirectory = currentDirectories[key];
		let selectedDirectory: string | undefined;

		if (existingDirectory) {
			// Show current directory and ask if user wants to change it
			const choice = await vscode.window.showQuickPick([
				{
					label: `Keep Current: ${existingDirectory}`,
					description: 'Use the existing directory',
					value: 'keep'
				},
				{
					label: 'Select New Directory',
					description: 'Choose a different directory',
					value: 'change'
				}
			], {
				placeHolder: `Directory for ${serverName} - ${databaseName}`,
				title: 'Database Directory Configuration'
			});

			if (!choice) {
				return undefined; // User cancelled
			}

			if (choice.value === 'keep') {
				return existingDirectory;
			}
		}

		// Prompt user to select a new directory
		const directoryUri = await vscode.window.showOpenDialog({
			canSelectFiles: false,
			canSelectFolders: true,
			canSelectMany: false,
			openLabel: 'Select Directory',
			title: `Select directory for ${serverName} - ${databaseName}`
		});

		if (!directoryUri || directoryUri.length === 0) {
			return undefined; // User cancelled
		}

		selectedDirectory = directoryUri[0].fsPath;

		// Save the directory to configuration
		currentDirectories[key] = selectedDirectory;
		await config.update('databaseDirectories', currentDirectories, vscode.ConfigurationTarget.Global);

		console.log(`Saved directory for ${key}: ${selectedDirectory}`);
		vscode.window.showInformationMessage(
			`Directory saved for ${serverName} - ${databaseName}: ${selectedDirectory}`
		);

		return selectedDirectory;

	} catch (error: any) {
		console.error('Error selecting/saving database directory:', error);
		vscode.window.showErrorMessage(`Failed to configure directory: ${error.message}`);
		return undefined;
	}
}

// Private function to get saved directory for a database/server combination
function getSavedDatabaseDirectory(node: any): string | undefined {
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

// Retrieve database objects using the generic executeQuery method
async function RetrieveDatabaseObjects(node: any): Promise<DatabaseObject[]> {
	try {
		const mssqlExtension = vscode.extensions.getExtension('ms-mssql.mssql');
		if (!mssqlExtension) throw new Error('MSSQL extension not found');
		if (!mssqlExtension.isActive) await mssqlExtension.activate();
		const mssqlApi: MssqlExtensionApi = mssqlExtension.exports;
		const databaseName = mssqlApi.getDatabaseNameFromTreeNode(node);
		
		const query = `
			USE [${databaseName}];
			SELECT 
				name,
				object_id
			FROM sys.objects 
			WHERE type IN ('U', 'V', 'P', 'FN', 'IF', 'TF')
			ORDER BY type_desc, name;
		`;
		
		const results = await executeQuery(node, query);
		
		return results.map((row: any) => ({
			name: row.name,
			type: row.type,
			schema: row.schema,
			object_id: row.object_id
		}));
		
	} catch (error: any) {
		console.error('Error retrieving database objects:', error);
		vscode.window.showErrorMessage(`Failed to retrieve database objects: ${error.message}`);
		return [];
	}
}

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
	const initGitRepoCommand = vscode.commands.registerCommand('sql-server-git-integration.initGitRepo',  async (node) => {
		//const databaseObjects = await RetrieveDatabaseObjects(node);
		//console.log('Database objects:', databaseObjects);

		selectAndSaveDatabaseDirectory(node)

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
