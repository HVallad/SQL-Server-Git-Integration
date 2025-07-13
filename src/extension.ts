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
			delete config.options.trustedConnection;
			delete config.options.integratedSecurity;
			console.log('Using SQL Server authentication from connection string:', JSON.stringify({ ...config, password: '***' }, null, 2));
			const pool = new sql.ConnectionPool(config);
			await pool.connect();
			
			const result = await pool.request().query(query);
			await pool.close();
			
			return result.recordset;
			
		} else if (hasIntegratedSecurity) {
			// Use integrated security from connection string
			config.options.trustedConnection = true;
			config.options.integratedSecurity = true;
			delete config.user;
			delete config.password;
			console.log('Using integrated security from connection string:', JSON.stringify(config, null, 2));
			const pool = new sql.ConnectionPool(config);
			await pool.connect();
			
			const result = await pool.request().query(query);
			await pool.close();
			
			return result.recordset;
			
		} else {
			// Try Windows Authentication
			console.log('Attempting connection with Windows Authentication...');
			
			// First attempt: Try with current Windows user
			try {
				const windowsConfig = { ...config };
				
				// Try multiple Windows auth approaches
				const authConfigs = [
					// Approach 1: Use raw connection string (preserves SSPI settings)
					{ connectionString: connectionString },
					// Approach 2: Basic trusted connection
					{ 
						...windowsConfig,
						options: { 
							...windowsConfig.options, 
							trustedConnection: true 
						}
					},
					// Approach 3: Integrated security
					{ 
						...windowsConfig,
						options: { 
							...windowsConfig.options, 
							integratedSecurity: true 
						}
					},
					// Approach 4: Both trusted and integrated
					{ 
						...windowsConfig,
						options: { 
							...windowsConfig.options, 
							trustedConnection: true,
							integratedSecurity: true 
						}
					}
				];
				
				for (let i = 0; i < authConfigs.length; i++) {
					try {
						console.log(`Trying Windows auth approach ${i + 1}:`, JSON.stringify(authConfigs[i], null, 2));
						
						// Declare pool outside the if/else blocks
						let pool: sql.ConnectionPool;
						
						if (authConfigs[i].connectionString) {
							pool = new sql.ConnectionPool(authConfigs[i]);
						} else {
							pool = new sql.ConnectionPool(authConfigs[i]);
						}
						
						await pool.connect();
						
						const result = await pool.request().query(query);
						await pool.close();
						
						console.log(`Windows auth approach ${i + 1} succeeded!`);
						return result.recordset;
						
					} catch (authError: any) {
						console.log(`Windows auth approach ${i + 1} failed:`, authError.message);
						if (i === authConfigs.length - 1) {
							throw authError; // Throw the last error if all approaches fail
						}
					}
				}
				
				// This should never be reached due to the throw above, but TypeScript needs it
				throw new Error('All Windows authentication approaches failed');
				
			} catch (windowsError: any) {
				console.log('Windows Authentication failed:', windowsError.message);
				
				// Second attempt: Try to prompt for SQL Server credentials
				const username = await vscode.window.showInputBox({
					prompt: 'Enter SQL Server username (or leave empty to skip SQL Auth)',
					placeHolder: 'sa'
				});
				
				if (username) {
					const password = await vscode.window.showInputBox({
						prompt: 'Enter SQL Server password',
						password: true
					});
					
					if (password) {
						try {
							const sqlConfig = { ...config };
							sqlConfig.user = username;
							sqlConfig.password = password;
							delete sqlConfig.options.trustedConnection;
							
							console.log('SQL auth config:', JSON.stringify({ ...sqlConfig, password: '***' }, null, 2));
							const pool = new sql.ConnectionPool(sqlConfig);
							await pool.connect();
							
							const result = await pool.request().query(query);
							await pool.close();
							
							return result.recordset;
							
						} catch (sqlError: any) {
							console.log('SQL Authentication failed:', sqlError.message);
							throw sqlError;
						}
					}
				}
				
				// If we get here, both auth methods failed or user cancelled
				throw windowsError;
			}
		}
		
	} catch (error: any) {
		console.error('Error executing query:', error);
		throw error;
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
		const databaseObjects = await RetrieveDatabaseObjects(node);
		console.log('Database objects:', databaseObjects);
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
