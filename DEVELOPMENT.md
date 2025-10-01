# MSSQL Git Sync - Development Guide

## Overview

This extension integrates Git repository synchronization capabilities for SQL Server databases. It depends on the MSSQL extension and provides functionality to script database objects to files for version control.

## Project Structure

```
mssql-git-sync/
├── src/
│   ├── extension.ts                    # Main extension entry point
│   └── services/
│       └── databaseScriptingService.ts # Database object scripting service
├── typings/
│   └── vscode-mssql.d.ts              # Type definitions from MSSQL extension
├── out/                                # Compiled JavaScript output
├── package.json                        # Extension manifest
├── tsconfig.json                       # TypeScript configuration
└── README.md                           # User documentation
```

## Key Features Implemented

### Phase 1: Extension Boilerplate ✅
- ✅ Extension directory structure created
- ✅ package.json with MSSQL extension dependency configured
- ✅ TypeScript configuration set up
- ✅ Extension activation logic implemented
- ✅ Build scripts and development configuration created
- ✅ Compilation successful

### Phase 2: Database Context Menu and Scripting ✅
- ✅ Context menu command registered for database nodes
- ✅ Database object enumeration implemented
- ✅ Scripting service integration with MSSQL extension API
- ✅ Unique folder generation based on connection details
- ✅ File system operations for saving scripts
- ✅ Progress reporting and error handling

## How It Works

### 1. Extension Activation
The extension activates when the command `mssql-git-sync.scriptDatabaseToGit` is invoked. It:
- Verifies the MSSQL extension is installed and active
- Initializes the DatabaseScriptingService
- Registers the context menu command

### 2. Context Menu Integration
When you right-click on a database node in the MSSQL Object Explorer:
- The context menu shows "Script Database to Git Repository"
- This option only appears for Database nodes (not servers, tables, etc.)

### 3. Database Object Scripting Process
When the command is executed:

1. **Connection Verification**: Ensures a valid connection to the database
2. **Unique Folder Creation**: Generates a deterministic folder name using:
   - Server name (sanitized)
   - Database name (sanitized)
   - MD5 hash of connection details (8 characters)
   - Example: `localhost_AdventureWorks_a1b2c3d4`

3. **Object Enumeration**: Queries the database for objects using system views:
   - Tables (type 'U')
   - Views (type 'V')
   - Stored Procedures (type 'P')
   - Functions (types 'FN', 'IF', 'TF')
   - Triggers (type 'TR')

4. **Object Scripting**: For each object:
   - Uses MSSQL extension's `scriptObject` API
   - Scripts with CREATE operation
   - Saves to organized folders by object type
   - File naming: `{schema}.{objectName}.sql`

5. **Metadata Generation**: Creates a metadata.json file with:
   - Database name
   - Timestamp
   - Total objects scripted
   - Error count

## API Usage

### MSSQL Extension APIs Used

1. **Connection Management**:
   ```typescript
   await mssqlApi.connect(connectionProfile, false);
   ```

2. **Query Execution**:
   ```typescript
   await mssqlApi.connectionSharing.executeSimpleQuery(connectionUri, query);
   ```

3. **Object Scripting**:
   ```typescript
   await mssqlApi.connectionSharing.scriptObject(
       connectionUri,
       ScriptOperation.Create,
       scriptingObject
   );
   ```

## Building and Testing

### Install Dependencies
```bash
npm install
```

### Compile TypeScript
```bash
npm run compile
```

### Watch Mode (for development)
```bash
npm run watch
```

### Run Extension
1. Press F5 in VS Code to launch Extension Development Host
2. Connect to a SQL Server instance in the MSSQL extension
3. Right-click on a database node
4. Select "Script Database to Git Repository"

## Output Location

Scripted files are saved to the extension's global storage directory:
- Windows: `%APPDATA%\Code\User\globalStorage\your-publisher-name.mssql-git-sync\`
- macOS: `~/Library/Application Support/Code/User/globalStorage/your-publisher-name.mssql-git-sync/`
- Linux: `~/.config/Code/User/globalStorage/your-publisher-name.mssql-git-sync/`

Each database gets a unique subfolder based on connection details.

## Folder Structure Example

```
{server}_{database}_{hash}/
├── metadata.json
├── Tables/
│   ├── dbo.Customers.sql
│   ├── dbo.Orders.sql
│   └── ...
├── Views/
│   ├── dbo.CustomerOrders.sql
│   └── ...
├── StoredProcedures/
│   ├── dbo.GetCustomerById.sql
│   └── ...
├── Functions/
│   ├── dbo.CalculateTotal.sql
│   └── ...
└── Triggers/
    └── ...
```

## Error Handling

The extension includes comprehensive error handling:
- Connection failures are caught and reported
- Individual object scripting errors don't stop the entire process
- Errors are logged to console and counted in metadata
- User-friendly error messages displayed via VS Code notifications

## Future Enhancements

Potential improvements for future versions:
- Git integration (auto-commit, push)
- Incremental updates (only script changed objects)
- Custom output directory selection
- Object filtering options
- Comparison with previous versions
- Support for additional object types (schemas, users, roles, etc.)

## Dependencies

### Runtime Dependencies
- None (uses VS Code and MSSQL extension APIs)

### Development Dependencies
- TypeScript 5.3+
- VS Code types 1.98+
- ESLint for code quality
- Node.js types

## Extension Dependencies
- `ms-mssql.mssql` - Required for database connectivity and scripting

## Notes

- The extension does NOT modify any files in the MSSQL extension directory
- All type definitions are copied from MSSQL extension for reference only
- The extension uses the MSSQL extension's APIs exclusively
- No direct database connections are made (all through MSSQL extension)

