# Troubleshooting Guide - MSSQL Git Sync

## Common Issues and Solutions

### Issue 1: "Application Name" Length Limit Error ✅ FIXED

**Symptoms:**
- Scripting process runs but SQL files are not created
- Folders are created but remain empty
- Error in console: `Error: The value's length for key 'Application Name' exceeds its limit of '128'`

**Root Cause:**
The MSSQL extension may set a very long application name in the connection string (e.g., including full file paths, extension IDs, etc.). SQL Server has a 128-character limit for the Application Name connection property.

**Solution (Implemented in v0.1.0):**
The extension now overrides the `applicationName` property with a short value (`'MSSQL-Git-Sync'`) when creating connections for scripting operations.

**Code Fix:**
```typescript
const cleanProfile: vscodeMssql.IConnectionInfo = {
    ...connectionProfile,
    applicationName: 'MSSQL-Git-Sync'  // Override with a short application name
};
```

**How to Verify the Fix:**
1. Reload the extension (close and reopen Extension Development Host)
2. Right-click on a database and select "Script Database to Git Repository"
3. Check that SQL files are now created in the output folders
4. Open Developer Tools (Help → Toggle Developer Tools) and check Console for any errors

---

### Issue 2: Empty Folders Created

**Symptoms:**
- Folder structure is created (Tables/, Views/, etc.)
- No SQL files inside the folders
- No error messages visible

**Possible Causes:**
1. Database has no user-defined objects
2. Permission issues preventing object enumeration
3. Silent errors in the scripting process

**Diagnostic Steps:**

1. **Check Developer Tools Console:**
   - Press `Ctrl+Shift+I` (or `Cmd+Shift+I` on macOS)
   - Go to Console tab
   - Filter by "Extension Host"
   - Look for error messages

2. **Verify Database Has Objects:**
   - Expand the database in MSSQL Object Explorer
   - Check if you can see tables, views, procedures, etc.
   - If you can't see objects, you may not have permissions

3. **Check Permissions:**
   Run this query in the database:
   ```sql
   SELECT 
       SCHEMA_NAME(schema_id) AS [schema],
       name,
       type_desc
   FROM sys.objects
   WHERE type IN ('U', 'V', 'P', 'FN', 'IF', 'TF', 'TR')
       AND is_ms_shipped = 0
   ORDER BY type_desc, name;
   ```
   
   If this returns no results, either:
   - The database has no user objects
   - You don't have permission to view sys.objects

**Solutions:**
- Ensure you have `VIEW DEFINITION` permission on the database
- Ask your DBA to grant necessary permissions
- Try scripting a different database that you know has objects

---

### Issue 3: Connection Errors

**Symptoms:**
- Error message: "Failed to establish connection"
- Scripting process fails immediately

**Possible Causes:**
1. Database connection is not active
2. Connection credentials expired (Azure AD)
3. Network connectivity issues

**Solutions:**

1. **Reconnect to the Server:**
   - In MSSQL Object Explorer, right-click the server
   - Select "Disconnect"
   - Right-click again and select "Connect"
   - Try scripting again

2. **Verify Connection:**
   - Try running a query in a SQL file
   - If queries work, the connection is fine
   - If queries fail, reconnect to the server

3. **Check Azure AD Token (if using Azure AD):**
   - Azure AD tokens expire after a period
   - Disconnect and reconnect to refresh the token

---

### Issue 4: Partial Scripting (Some Objects Missing)

**Symptoms:**
- Some SQL files are created
- Other objects are missing
- metadata.json shows errors > 0

**Possible Causes:**
1. Individual object scripting failures
2. Complex objects with dependencies
3. Encrypted objects (can't be scripted)

**Diagnostic Steps:**

1. **Check metadata.json:**
   ```json
   {
     "databaseName": "MyDatabase",
     "scriptedAt": "2025-10-01T...",
     "totalObjectsScripted": 45,
     "totalErrors": 3,  // <-- Check this
     "objectTypes": [...]
   }
   ```

2. **Check Console for Specific Errors:**
   - Open Developer Tools Console
   - Look for messages like: `Error scripting object dbo.ObjectName: ...`

3. **Check for Encrypted Objects:**
   ```sql
   SELECT name, type_desc
   FROM sys.objects
   WHERE is_ms_shipped = 0
       AND OBJECTPROPERTY(object_id, 'IsEncrypted') = 1;
   ```
   Encrypted objects cannot be scripted.

**Solutions:**
- Encrypted objects: Cannot be scripted (by design)
- Dependency issues: Script in multiple passes or manually
- Permission issues: Grant VIEW DEFINITION on specific objects

---

### Issue 5: "MSSQL extension not found" Error

**Symptoms:**
- Error on activation: "MSSQL Git Sync requires the SQL Server (mssql) extension"
- Extension doesn't activate

**Solution:**
1. Install the MSSQL extension from the marketplace
2. Search for "SQL Server (mssql)" in Extensions view
3. Install the extension by Microsoft (ms-mssql.mssql)
4. Reload VS Code
5. Try activating MSSQL Git Sync again

---

### Issue 6: Context Menu Option Not Visible

**Symptoms:**
- Right-click on database node
- "Script Database to Git Repository" option is not shown

**Possible Causes:**
1. Right-clicking on wrong node type (server, table, etc.)
2. Extension not activated
3. MSSQL extension not active

**Solutions:**

1. **Verify Node Type:**
   - The option ONLY appears for **Database** nodes
   - Not for: Servers, Tables, Views, Procedures, etc.
   - Expand the server and right-click on the database name

2. **Check Extension Status:**
   - Open Extensions view (`Ctrl+Shift+X`)
   - Search for "MSSQL Git Sync"
   - Verify it's enabled
   - Try reloading the window (`Ctrl+Shift+P` → "Reload Window")

3. **Check MSSQL Extension:**
   - Verify MSSQL extension is installed and enabled
   - Try connecting to a server first
   - Then try the context menu again

---

### Issue 7: Output Folder Not Found

**Symptoms:**
- Scripting completes successfully
- Can't find the output folder
- "Open Folder" button doesn't work

**Solution:**

The output is in VS Code's global storage directory:

**Windows:**
```
%APPDATA%\Code\User\globalStorage\your-publisher-name.mssql-git-sync\
```

**macOS:**
```
~/Library/Application Support/Code/User/globalStorage/your-publisher-name.mssql-git-sync/
```

**Linux:**
```
~/.config/Code/User/globalStorage/your-publisher-name.mssql-git-sync/
```

**To Find It:**
1. Copy the path above for your OS
2. Replace `your-publisher-name` with the actual publisher name from package.json
3. Paste into File Explorer / Finder
4. Look for folders named `{server}_{database}_{hash}`

**Alternative:**
- Check the success notification message - it shows the full path
- Copy the path from the notification

---

## How to View Detailed Logs

### Method 1: Developer Tools Console
1. **Help** → **Toggle Developer Tools** (or `Ctrl+Shift+I`)
2. Click the **Console** tab
3. Filter by typing "Extension Host" in the filter box
4. Look for messages from the extension

### Method 2: Extension Host Log
1. **Help** → **Toggle Developer Tools**
2. Click the **Console** tab
3. In the dropdown (top right), select "Extension Host"
4. All extension logs will be shown here

### Method 3: Output Panel
1. **View** → **Output** (or `Ctrl+Shift+U`)
2. In the dropdown, select "Extension Host"
3. Look for messages from MSSQL Git Sync

---

## Debugging Tips

### Enable Verbose Logging

Add console.log statements to see what's happening:

```typescript
// In databaseScriptingService.ts
console.log('Starting to script database:', databaseName);
console.log('Connection URI:', connectionUri);
console.log('Found objects:', objects.length);
```

### Test Individual Components

1. **Test Connection:**
   - Try running a simple query in a SQL file
   - If it works, connection is fine

2. **Test Object Enumeration:**
   - Run the sys.objects query manually
   - Verify you can see the objects

3. **Test Scripting:**
   - Try scripting a single object using MSSQL extension
   - Right-click a table → Script as Create

### Check Extension Activation

```typescript
// In extension.ts, add logging
console.log('MSSQL Git Sync: Extension activating...');
console.log('MSSQL extension found:', !!mssqlExtension);
console.log('MSSQL API available:', !!mssqlApi);
```

---

## Reporting Issues

If you encounter an issue not covered here:

1. **Gather Information:**
   - VS Code version
   - MSSQL extension version
   - MSSQL Git Sync version
   - SQL Server version
   - Error messages from Developer Tools Console
   - Steps to reproduce

2. **Check Existing Issues:**
   - Search the GitHub repository for similar issues

3. **Create a New Issue:**
   - Include all gathered information
   - Attach screenshots if relevant
   - Describe expected vs actual behavior

---

## Quick Fixes Checklist

Before reporting an issue, try these quick fixes:

- [ ] Reload VS Code window (`Ctrl+Shift+P` → "Reload Window")
- [ ] Reconnect to the SQL Server
- [ ] Check Developer Tools Console for errors
- [ ] Verify MSSQL extension is installed and active
- [ ] Ensure you're right-clicking on a Database node (not server/table)
- [ ] Check that the database has user-defined objects
- [ ] Verify you have VIEW DEFINITION permission
- [ ] Try scripting a different database
- [ ] Check that output folder exists in global storage
- [ ] Clear the output folder and try again

---

## Version History of Fixes

### v0.1.0 (2025-10-01)
- ✅ Fixed: Application Name length limit error
- ✅ Added: Short application name override ('MSSQL-Git-Sync')
- ✅ Improved: Error handling and logging

