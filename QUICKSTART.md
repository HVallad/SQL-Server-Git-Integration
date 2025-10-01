# Quick Start Guide - MSSQL Git Sync

## Prerequisites

1. **Install VS Code**: Make sure you have Visual Studio Code installed
2. **Install MSSQL Extension**: Install the [SQL Server (mssql)](https://marketplace.visualstudio.com/items?itemName=ms-mssql.mssql) extension
3. **SQL Server Access**: Have access to a SQL Server instance (local or remote)

## Installation

### Option 1: Install from VSIX (Development)
1. Open VS Code
2. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on macOS)
3. Type "Extensions: Install from VSIX"
4. Select the `mssql-git-sync-0.1.0.vsix` file

### Option 2: Run from Source (Development)
1. Open the `mssql-git-sync` folder in VS Code
2. Press `F5` to launch the Extension Development Host
3. A new VS Code window will open with the extension loaded

## First Time Setup

### 1. Connect to SQL Server
1. Click on the SQL Server icon in the Activity Bar (left sidebar)
2. Click "Add Connection" or the + icon
3. Enter your connection details:
   - Server name (e.g., `localhost` or `server.database.windows.net`)
   - Database name (optional, can be changed later)
   - Authentication type
   - Username and password (if using SQL authentication)
4. Click "Connect"

### 2. Script Your First Database

1. In the SQL Server Object Explorer, expand your server connection
2. **Right-click on a database** (e.g., `AdventureWorks`, `master`, etc.)
3. Select **"Script Database to Git Repository"** from the context menu
4. Wait for the scripting process to complete (you'll see progress notifications)
5. When complete, click "Open Folder" to view the scripted files

## What Gets Scripted?

The extension scripts the following database objects:

- ✅ **Tables** - All user tables with their structure
- ✅ **Views** - All user-defined views
- ✅ **Stored Procedures** - All stored procedures
- ✅ **Functions** - Scalar, inline, and table-valued functions
- ✅ **Triggers** - All database triggers

**Note**: System objects are automatically excluded.

## Output Location

Scripted files are saved to:
- **Windows**: `%APPDATA%\Code\User\globalStorage\your-publisher-name.mssql-git-sync\`
- **macOS**: `~/Library/Application Support/Code/User/globalStorage/your-publisher-name.mssql-git-sync/`
- **Linux**: `~/.config/Code/User/globalStorage/your-publisher-name.mssql-git-sync/`

Each database gets its own unique folder named:
```
{ServerName}_{DatabaseName}_{UniqueHash}
```

Example: `localhost_AdventureWorks_a1b2c3d4`

## Folder Structure

After scripting, you'll see a structure like this:

```
localhost_AdventureWorks_a1b2c3d4/
├── metadata.json              # Scripting metadata
├── Tables/
│   ├── dbo.Customers.sql
│   ├── dbo.Orders.sql
│   ├── Sales.Products.sql
│   └── ...
├── Views/
│   ├── dbo.CustomerOrders.sql
│   └── ...
├── StoredProcedures/
│   ├── dbo.GetCustomerById.sql
│   ├── dbo.UpdateOrder.sql
│   └── ...
├── Functions/
│   ├── dbo.CalculateTotal.sql
│   └── ...
└── Triggers/
    └── ...
```

## Using with Git

### Initialize a Git Repository

1. Open the scripted folder in VS Code or your terminal
2. Initialize Git:
   ```bash
   cd "path/to/scripted/folder"
   git init
   ```
3. Create a `.gitignore` file (optional):
   ```
   metadata.json
   ```
4. Add and commit files:
   ```bash
   git add .
   git commit -m "Initial database schema"
   ```

### Push to Remote Repository

```bash
git remote add origin https://github.com/yourusername/your-repo.git
git branch -M main
git push -u origin main
```

## Common Workflows

### Workflow 1: Track Database Changes
1. Make changes to your database (add tables, modify procedures, etc.)
2. Right-click the database and select "Script Database to Git Repository"
3. Navigate to the output folder
4. Review changes with `git diff`
5. Commit changes: `git commit -am "Added new customer table"`

### Workflow 2: Compare Environments
1. Script your development database
2. Script your production database (they'll get different folders)
3. Use a diff tool to compare the folders
4. Identify differences between environments

### Workflow 3: Database Documentation
1. Script your database
2. The organized folder structure serves as documentation
3. Share the folder with team members
4. Use the SQL files as reference for database structure

## Troubleshooting

### Extension Not Showing in Context Menu
- **Solution**: Make sure you're right-clicking on a **Database** node, not a server or table
- The menu item only appears for database-level nodes

### "MSSQL extension not found" Error
- **Solution**: Install the SQL Server (mssql) extension from the marketplace
- Restart VS Code after installation

### Connection Errors
- **Solution**: Verify your connection details in the MSSQL extension
- Make sure the database is accessible and you have permissions
- Try reconnecting to the server

### Scripting Fails for Some Objects
- **Solution**: Check the console output (Help > Toggle Developer Tools > Console)
- Some objects may have dependencies that need to be scripted first
- Verify you have permissions to view the object definitions

### Can't Find Output Folder
- **Solution**: Click "Open Folder" in the success notification
- Or navigate manually to the global storage path (see "Output Location" above)

## Tips and Best Practices

### 1. Regular Scripting
- Script your database regularly (daily or after major changes)
- This creates a history of your database schema evolution

### 2. Use Meaningful Commit Messages
```bash
git commit -m "Added customer loyalty program tables and procedures"
```

### 3. Branch for Major Changes
```bash
git checkout -b feature/new-reporting-schema
# Make database changes
# Script database
git commit -am "Added reporting schema"
```

### 4. Review Before Committing
- Always review the changes before committing
- Use `git diff` to see what changed
- This helps catch unintended modifications

### 5. Exclude Metadata
- Consider adding `metadata.json` to `.gitignore`
- The metadata file changes every time you script
- It's useful for debugging but not necessary for version control

## Next Steps

- Explore the scripted SQL files
- Set up automated scripting (future feature)
- Integrate with your CI/CD pipeline
- Share the repository with your team

## Getting Help

- Check the [DEVELOPMENT.md](DEVELOPMENT.md) for technical details
- Review the [README.md](README.md) for feature overview
- Report issues on the GitHub repository

## Example: Complete Workflow

Here's a complete example from start to finish:

```bash
# 1. Script your database using the extension
# (Right-click database > Script Database to Git Repository)

# 2. Navigate to the output folder
cd "%APPDATA%\Code\User\globalStorage\your-publisher-name.mssql-git-sync\localhost_MyDB_abc123"

# 3. Initialize Git
git init

# 4. Create .gitignore
echo "metadata.json" > .gitignore

# 5. Add all files
git add .

# 6. Initial commit
git commit -m "Initial database schema for MyDB"

# 7. Add remote repository
git remote add origin https://github.com/yourusername/mydb-schema.git

# 8. Push to remote
git push -u origin main

# 9. Make database changes (add a table, modify a procedure)

# 10. Script again using the extension

# 11. Review changes
git diff

# 12. Commit changes
git commit -am "Added new customer feedback table"

# 13. Push changes
git push
```

Congratulations! You now have your database schema under version control! 🎉

