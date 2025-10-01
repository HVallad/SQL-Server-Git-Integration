# MSSQL Git Sync

Git repository synchronization for SQL Server databases. This extension allows you to script database objects and manage them in version control.

## Features

- **Script Database Objects**: Right-click on any database in the MSSQL Object Explorer and script all objects to files
- **Organized Structure**: Objects are organized by type (Tables, Views, Stored Procedures, Functions, Triggers)
- **Unique Storage**: Each connection-database pair gets a unique folder to prevent conflicts
- **Git-Ready**: Scripted files are ready to be committed to your Git repository

## Requirements

This extension requires the [SQL Server (mssql)](https://marketplace.visualstudio.com/items?itemName=ms-mssql.mssql) extension to be installed.

## Usage

1. Open the SQL Server Object Explorer
2. Connect to a SQL Server instance
3. Right-click on a database node
4. Select "Script Database to Git Repository"
5. The extension will script all database objects to the global storage directory
6. You can open the folder to view the scripted files

## Extension Settings

This extension does not currently add any VS Code settings.

## Known Issues

This is an initial release. Please report any issues on the GitHub repository.

## Release Notes

### 0.1.0

Initial release:
- Basic database scripting functionality
- Context menu integration with MSSQL extension
- Organized folder structure for scripted objects

