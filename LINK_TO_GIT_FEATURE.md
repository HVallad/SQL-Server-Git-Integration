# Link to Git Feature - Implementation Summary

## Overview

This document describes the "Link to Git" feature that enables linking SQL Server databases to Git repositories for source control integration.

---

## Features Implemented

### 1. New Folder Structure

The extension now uses a two-folder structure to separate local cache from source control:

**Before:**
```
{server}_{database}_{hash}/
├── metadata.json
├── Tables/
├── Views/
├── StoredProcedures/
├── Functions/
└── Triggers/
```

**After:**
```
{server}_{database}_{hash}/
├── metadata.json
├── LocalCache/
│   ├── Tables/
│   ├── Views/
│   ├── StoredProcedures/
│   ├── Functions/
│   └── Triggers/
└── SourceControl/
    └── (git repository cloned here)
```

**Benefits:**
- Clear separation between local cache and source control
- LocalCache contains the latest database scripts
- SourceControl contains the Git repository
- metadata.json tracks Git link status

---

### 2. New Context Menu Command: "Link to Git"

**Location:** Right-click on any database node in MSSQL Object Explorer

**Availability:** Always visible (future enhancement: hide when already linked)

**Workflow:**

#### Step 1: Prompt for Git Repository URL
- Input box with validation
- Supports HTTPS and SSH URLs
- Examples:
  - `https://github.com/user/repo.git`
  - `git@github.com:user/repo.git`

#### Step 2: Fetch and Display Available Branches
- Automatically fetches remote branches using `git ls-remote`
- Shows QuickPick menu with all available branches
- Handles authentication errors gracefully

#### Step 3: Clone the Repository
- Clones the selected branch to `SourceControl/` folder
- Uses shallow clone (`--depth 1`) for faster cloning
- Shows progress notification during clone
- Cleans up on failure

#### Step 4: Save Git Link Metadata
- Updates `metadata.json` with Git link information:
  ```json
  {
    "databaseName": "MyDatabase",
    "scriptedAt": "2025-01-15T10:30:00.000Z",
    "totalObjectsScripted": 150,
    "totalErrors": 0,
    "objectTypes": ["Table", "View", "StoredProcedure", "UserDefinedFunction", "Trigger"],
    "gitLinked": true,
    "gitRepositoryUrl": "https://github.com/user/repo.git",
    "gitBranch": "main",
    "gitLinkedDate": "2025-01-15T10:35:00.000Z"
  }
  ```

---

## Files Created/Modified

### New Files

#### 1. `src/services/gitService.ts` (New)
**Purpose:** Service class for Git operations

**Key Methods:**
- `isGitInstalled()` - Check if Git is installed
- `validateGitUrl(url)` - Validate Git repository URLs
- `fetchRemoteBranches(url)` - Fetch list of remote branches
- `cloneRepository(url, branch, path)` - Clone a Git repository
- `isGitRepository(path)` - Check if directory is a Git repo
- `getCurrentBranch(path)` - Get current branch name
- `getRemoteUrl(path)` - Get remote URL
- `pullLatestChanges(path)` - Pull latest changes
- `getGitVersion()` - Get Git version

**Error Handling:**
- Authentication failures
- Network connectivity issues
- Repository not found
- Invalid branch names
- Destination folder conflicts

---

### Modified Files

#### 1. `src/services/databaseScriptingService.ts`

**New Interface:**
```typescript
interface DatabaseMetadata {
    databaseName: string;
    scriptedAt: string;
    totalObjectsScripted: number;
    totalErrors: number;
    objectTypes: string[];
    gitLinked: boolean;
    gitRepositoryUrl?: string;
    gitBranch?: string;
    gitLinkedDate?: string;
}
```

**New Methods:**
- `linkToGit(node)` - Main handler for Link to Git command
- `readMetadata(rootPath)` - Read metadata.json
- `writeMetadata(rootPath, metadata)` - Write metadata.json
- `isGitLinked(node)` - Check if database is linked to Git
- `getOutputPath(node)` - Get output path for a database

**Modified Methods:**
- `scriptDatabaseToFiles()` - Now writes to `LocalCache/` subfolder
- `scriptObjectsByType()` - Updated to accept both root path and LocalCache path

---

#### 2. `src/extension.ts`

**New Command Registration:**
```typescript
const linkToGitCommand = vscode.commands.registerCommand(
    'mssql-git-sync.linkToGit',
    async (node: vscodeMssql.ITreeNodeInfo) => {
        try {
            await scriptingService?.linkToGit(node);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to link to Git: ${errorMessage}`);
            console.error('Error linking to Git:', error);
        }
    }
);
```

---

#### 3. `package.json`

**New Command:**
```json
{
    "command": "mssql-git-sync.linkToGit",
    "title": "Link to Git",
    "category": "MSSQL Git Sync"
}
```

**New Context Menu Entry:**
```json
{
    "command": "mssql-git-sync.linkToGit",
    "when": "view == objectExplorer && viewItem =~ /\\btype=(Database)\\b/",
    "group": "9_MSSQL_GIT_SYNC@2"
}
```

**New Activation Event:**
```json
"activationEvents": [
    "onCommand:mssql-git-sync.scriptDatabaseToGit",
    "onCommand:mssql-git-sync.linkToGit"
]
```

---

## Usage Instructions

### Prerequisites
- Git must be installed on your system
- Git must be in your system PATH
- You need access to the Git repository (credentials or SSH keys)

### How to Link a Database to Git

1. **Open MSSQL Object Explorer** in VS Code
2. **Expand your server connection**
3. **Right-click on a database node**
4. **Select "Link to Git"** from the context menu
5. **Enter the Git repository URL** when prompted
   - Example: `https://github.com/myorg/database-scripts.git`
6. **Select a branch** from the list of available branches
7. **Wait for the clone operation** to complete
8. **Click "Open Folder"** to view the cloned repository

### Folder Structure After Linking

```
{server}_{database}_{hash}/
├── metadata.json                    # Contains Git link metadata
├── LocalCache/                      # Latest database scripts
│   ├── Tables/
│   │   ├── dbo.Users.sql
│   │   └── dbo.Orders.sql
│   ├── Views/
│   ├── StoredProcedures/
│   ├── Functions/
│   └── Triggers/
└── SourceControl/                   # Git repository
    ├── .git/
    ├── README.md
    ├── scripts/
    └── ...
```

---

## Error Handling

### Git Not Installed
**Error:** "Git is not installed on your system. Please install Git and try again."

**Solution:** Install Git from https://git-scm.com/

### Authentication Failed
**Error:** "Authentication failed. Please check your credentials or use SSH keys."

**Solutions:**
- For HTTPS: Ensure you have the correct username/password or personal access token
- For SSH: Ensure your SSH keys are properly configured

### Network Error
**Error:** "Network error. Please check your internet connection."

**Solution:** Check your internet connection and firewall settings

### Repository Not Found
**Error:** "Repository not found. Please check the URL."

**Solution:** Verify the repository URL is correct and you have access to it

### SourceControl Folder Exists
**Error:** "SourceControl folder already exists. Please remove it first or unlink the existing repository."

**Solution:** Delete the SourceControl folder or use a different database

### Branch Not Found
**Error:** "Branch 'branch-name' not found in the repository."

**Solution:** Verify the branch name exists in the repository

---

## Future Enhancements

### 1. Conditional Context Menu
- Hide "Link to Git" when database is already linked
- Show "Unlink from Git" when database is linked
- Requires VS Code context key support

### 2. Sync to Git Command
- New command to sync LocalCache changes to SourceControl
- Automatically commit and push changes
- Show diff before committing

### 3. Pull from Git Command
- Pull latest changes from remote repository
- Merge with LocalCache
- Handle conflicts

### 4. Git Status Indicator
- Show Git status in tree view
- Indicate when LocalCache is out of sync with SourceControl
- Show number of uncommitted changes

### 5. Branch Switching
- Allow switching branches without re-cloning
- Preserve local changes

### 6. Credential Management
- Integrate with VS Code credential storage
- Support for Git credential helpers
- Remember credentials for future operations

---

## Testing Checklist

### Basic Functionality
- [ ] "Link to Git" command appears in context menu for database nodes
- [ ] Git installation check works correctly
- [ ] Repository URL validation works for HTTPS and SSH URLs
- [ ] Branch fetching works for public repositories
- [ ] Branch fetching works for private repositories (with credentials)
- [ ] Repository cloning works successfully
- [ ] metadata.json is updated with Git link information
- [ ] SourceControl folder is created correctly

### Folder Structure
- [ ] LocalCache folder is created
- [ ] "Sync Local Cache" writes files to LocalCache/
- [ ] SourceControl folder contains cloned repository
- [ ] metadata.json is in root folder (not in LocalCache or SourceControl)

### Error Handling
- [ ] Error shown when Git is not installed
- [ ] Error shown for invalid repository URLs
- [ ] Error shown for authentication failures
- [ ] Error shown for network errors
- [ ] Error shown for repository not found
- [ ] Error shown when SourceControl folder already exists
- [ ] SourceControl folder is cleaned up on clone failure

### User Experience
- [ ] Progress notifications shown during branch fetching
- [ ] Progress notifications shown during cloning
- [ ] Success message shown after linking
- [ ] "Open Folder" button opens SourceControl folder
- [ ] Console logs provide useful debugging information

---

## Conclusion

The "Link to Git" feature provides a seamless way to integrate SQL Server databases with Git repositories for version control. The two-folder structure (LocalCache and SourceControl) provides clear separation between database scripts and source control, enabling future enhancements like automatic syncing and conflict resolution.

