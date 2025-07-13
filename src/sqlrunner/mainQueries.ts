import {executeQuery, DatabaseObject} from '../sqlrunner'
import * as vscode from 'vscode'

// Retrieve database objects using the generic executeQuery method
export async function RetrieveDatabaseObjects(node: any): Promise<DatabaseObject[]> {
    try {
        const query = `
            SELECT 
                s.name as SchemaName,
                o.name as ObjectName, 
                CASE    WHEN o.type_desc = 'SQL_STORED_PROCEDURE' THEN 'procedures'
                        WHEN o.type_desc = 'SQL_SCALAR_FUNCTION' THEN 'functions'
                        WHEN o.type_desc = 'SQL_INLINE_TABLE_VALUED_FUNCTION' THEN 'functions'
                        WHEN o.type_desc = 'SQL_TABLE_VALUED_FUNCTION' THEN 'functions'
                        WHEN o.type_desc = 'VIEW' THEN 'views'
                        WHEN o.type_desc = 'SQL_TRIGGER' THEN 'triggers'
                        WHEN o.type_desc = 'USER_TABLE' THEN 'tables'
                END as ObjectType,
                CAST(m.definition as NVARCHAR(MAX)) AS ObjectDefinition	
            FROM sys.objects o
            JOIN sys.schemas s ON o.schema_id = s.schema_id
            LEFT JOIN sys.sql_modules m ON o.object_id = m.object_id
            WHERE 
                o.type_desc IN (
                    'SQL_STORED_PROCEDURE',
                    'SQL_SCALAR_FUNCTION',
                    'SQL_INLINE_TABLE_VALUED_FUNCTION',
                    'SQL_TABLE_VALUED_FUNCTION',
                    'VIEW',
                    'SQL_TRIGGER',
                    'USER_TABLE'
                )
                AND o.is_ms_shipped = 0
            ORDER BY o.type_desc, o.name;
        `;
        
        const results = await executeQuery(node, query);
        const databaseObjects = results.map((row: any) => ({
            schema: row.SchemaName,
            name: row.ObjectName,
            type: row.ObjectType,
            definition: row.ObjectDefinition
        }));

        await setMissingTableDefinitions(node, databaseObjects);

        return databaseObjects
        
    } catch (error: any) {
        console.error('Error retrieving database objects:', error);
        vscode.window.showErrorMessage(`Failed to retrieve database objects: ${error.message}`);
        return [];
    }
}

export async function setMissingTableDefinitions(node: any, objectList: DatabaseObject[]): Promise<DatabaseObject[]>
    {
        const generalQuery = `
        SELECT 
        s.name AS SchemaName,
        t.name AS TableName,
        c.name AS ColumnName,
        ty.name AS DataType,
        c.max_length,
        c.precision,
        c.scale,
        c.is_nullable,
        c.is_identity,
        ic.seed_value,
        ic.increment_value,
        c.column_id
        FROM sys.tables t
        JOIN sys.schemas s ON t.schema_id = s.schema_id
        JOIN sys.columns c ON t.object_id = c.object_id
        JOIN sys.types ty ON c.user_type_id = ty.user_type_id
        JOIN sys.objects o ON o.object_id = t.object_id
        LEFT JOIN sys.identity_columns ic ON c.object_id = ic.object_id AND c.column_id = ic.column_id
        WHERE o.is_ms_shipped = 0
        ORDER BY s.name, t.name, c.column_id;
        `

        const pkQuery = `
        SELECT 
        s.name AS SchemaName,
        t.name AS TableName,
        kc.name AS ConstraintName,
        c.name AS ColumnName
        FROM sys.key_constraints kc
        JOIN sys.tables t ON kc.parent_object_id = t.object_id
        JOIN sys.schemas s ON t.schema_id = s.schema_id
        JOIN sys.index_columns ic ON ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id
        JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
        JOIN sys.objects o ON o.object_id = t.object_id
        WHERE kc.type = 'PK'
        AND o.is_ms_shipped = 0;
        `

        const generalResults = await executeQuery(node, generalQuery);
        const pkResults = await executeQuery(node, pkQuery);

        const pkMap = new Map<string, { constraint: string, columns: string[] }>();
    for (const row of pkResults) {
        const key = `${row.SchemaName}.${row.TableName}`;
        if (!pkMap.has(key)) {
        pkMap.set(key, { constraint: row.ConstraintName, columns: [] });
        }
        pkMap.get(key)!.columns.push(row.ColumnName);
    }

    const tablesMap = new Map<string, any[]>();
    for (const row of generalResults) {
        const key = `${row.SchemaName}.${row.TableName}`;
        if (!tablesMap.has(key)) {
        tablesMap.set(key, []);
        }
        tablesMap.get(key)!.push(row);
    }

    for (const [table, columns] of tablesMap.entries()) {
        const colDefs = columns.map(col => {
        let typeDef = col.DataType;
        if (["varchar", "nvarchar", "char", "nchar", "binary", "varbinary"].includes(col.DataType)) {
            typeDef += `(${col.max_length === -1 ? 'MAX' : col.max_length})`;
        } else if (["decimal", "numeric"].includes(col.DataType)) {
            typeDef += `(${col.precision},${col.scale})`;
        }

        let line = `[${col.ColumnName}] ${typeDef}`;

        if (col.is_identity) {
            const seed = col.seed_value ?? 1;
            const inc = col.increment_value ?? 1;
            line += ` IDENTITY(${seed},${inc})`;
        }
        line += col.is_nullable ? ' NULL' : ' NOT NULL';

        return line;
        });

        const [schema, tableName] = table.split('.');
        const pk = pkMap.get(table);
        if (pk) {
        colDefs.push(`CONSTRAINT [${pk.constraint}] PRIMARY KEY (${pk.columns.map(col => `[${col}]`).join(', ')})`);
        }

        const createStmt = `CREATE TABLE [${schema}].[${tableName}] (\n  ${colDefs.join(',\n  ')}\n);`;
        console.log(createStmt);
        console.log();

        const dbObject = objectList.find(obj => obj.schema === schema && obj.name === tableName && obj.type === 'tables');
        if (dbObject) {
        dbObject.definition = createStmt;
        }
    }

        return objectList
}