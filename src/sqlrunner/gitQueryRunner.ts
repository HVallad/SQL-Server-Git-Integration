import * as sql from 'mssql';
import * as vscode from 'vscode';

// Interface for MSSQL extension API
export interface MssqlExtensionApi {
	sendRequest(requestType: any, params: any): Promise<any>;
	getDatabaseNameFromTreeNode(node: any): string;
	getConnectionString(connectionUri: string, includePassword: boolean): string;
}

// Interface for database objects
export interface DatabaseObject {
	schema: string;
	name: string;
	type: string;
	definition: string;
}

// Generic method to execute SQL queries with automatic connection handling
export async function executeQuery(node: any, query: string): Promise<any[]> {
    try {
        const mssqlExtension = vscode.extensions.getExtension('ms-mssql.mssql');
        if (!mssqlExtension) throw new Error('MSSQL extension not found');
        if (!mssqlExtension.isActive) await mssqlExtension.activate();
        const mssqlApi: MssqlExtensionApi = mssqlExtension.exports;
        const databaseName = mssqlApi.getDatabaseNameFromTreeNode(node);
        
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
            database: databaseName || connectionParams['Initial Catalog'] || connectionParams['Database'],
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
export function getServerDatabaseKey(node: any): { serverName: string, databaseName: string, key: string } | null {
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

