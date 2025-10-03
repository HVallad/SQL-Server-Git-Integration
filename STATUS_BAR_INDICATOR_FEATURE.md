# Status Bar Indicator Feature - Implementation Summary

## Overview

This document describes the status bar indicator feature that displays the Git branch when a database linked to Git is selected in the MSSQL Object Explorer.

---

## Features Implemented

### 1. Status Bar Item

**Location:** Bottom-left corner of VS Code window (left side of status bar)

**Appearance:**
- **Icon:** Git branch icon (`$(git-branch)`)
- **Text:** Branch name (e.g., `main`, `develop`, `feature/new-feature`)
- **Example:** `$(git-branch) main`

**Visibility:**
- **Shown:** When a database linked to Git is selected/active
- **Hidden:** When database is not linked to Git or no database is selected

**Tooltip:**
- Shows detailed information when hovering over the status bar item
- **Format:** 
  ```
  Database "DatabaseName" is linked to Git branch: main
  Repository: https://github.com/user/repo.git
  ```

---

## How It Works

### Automatic Updates

The status bar indicator automatically updates when:

1. **"Sync Local Cache" command is executed**
   - Updates status bar before syncing
   - Shows current Git branch if database is linked

2. **"Link to Git" command is executed**
   - Updates status bar before linking (hidden if not linked)
   - Updates status bar after linking (shows new branch)

3. **"Unlink from Git" command is executed**
   - Updates status bar before unlinking (shows current branch)
   - Updates status bar after unlinking (hides indicator)

### Manual Updates

You can also manually trigger a status bar update by:
- Executing the `mssql-git-sync.updateStatusBar` command (internal command)
- This command is automatically called by the three main commands

---

## Implementation Details

### Files Modified

#### 1. `src/extension.ts`

**New Status Bar Item:**
```typescript
statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
statusBarItem.name = 'MSSQL Git Sync - Branch Indicator';
```

**New Function: `updateStatusBarForNode()`**
```typescript
async function updateStatusBarForNode(node: vscodeMssql.ITreeNodeInfo): Promise<void> {
    if (!statusBarItem || !scriptingService) {
        return;
    }

    try {
        // Get database name
        const databaseName = scriptingService.getDatabaseName(node);
        if (!databaseName) {
            statusBarItem.hide();
            return;
        }

        // Check if database is linked to Git
        const isLinked = await scriptingService.isGitLinked(node);
        
        if (isLinked) {
            // Get metadata to retrieve branch information
            const metadata = await scriptingService.getGitMetadata(node);
            
            if (metadata && metadata.gitBranch) {
                statusBarItem.text = `$(git-branch) ${metadata.gitBranch}`;
                statusBarItem.tooltip = `Database "${databaseName}" is linked to Git branch: ${metadata.gitBranch}\nRepository: ${metadata.gitRepositoryUrl || 'Unknown'}`;
                statusBarItem.show();
            } else {
                statusBarItem.hide();
            }
        } else {
            statusBarItem.hide();
        }
    } catch (error) {
        console.error('Error updating status bar:', error);
        statusBarItem.hide();
    }
}
```

**Command Integration:**

All three main commands now call `updateStatusBarForNode()`:

```typescript
// Sync Local Cache
await updateStatusBarForNode(node);
await scriptingService?.scriptDatabaseToFiles(node);

// Link to Git
await updateStatusBarForNode(node);
await scriptingService?.linkToGit(node);
await updateStatusBarForNode(node); // Update again after linking

// Unlink from Git
await updateStatusBarForNode(node);
await scriptingService?.unlinkFromGit(node);
await updateStatusBarForNode(node); // Update again after unlinking
```

---

#### 2. `src/services/databaseScriptingService.ts`

**New Public Methods:**

```typescript
/**
 * Get the database name from a tree node (public method for external access)
 */
public getDatabaseName(node: vscodeMssql.ITreeNodeInfo): string | undefined {
    return this.mssqlApi.getDatabaseNameFromTreeNode(node);
}

/**
 * Get Git metadata for a database node (public method for external access)
 */
public async getGitMetadata(node: vscodeMssql.ITreeNodeInfo): Promise<DatabaseMetadata | undefined> {
    try {
        const outputPath = this.getOutputPath(node);
        const metadata = await this.readMetadata(outputPath);
        return metadata || undefined;
    } catch (error) {
        return undefined;
    }
}
```

These methods expose the necessary functionality to the extension.ts file for status bar updates.

---

## User Experience

### Visual Indicator

**Before (No Visual Indicator):**
```
MSSQL Object Explorer:
├── Server1
│   ├── BMW_Spartanburg_Hunter
│   ├── BMW_Spartanburg_DevProd_Matt
│   └── BMW_Spartanburg_JustinM
```

**After (Status Bar Shows Branch):**
```
MSSQL Object Explorer:
├── Server1
│   ├── BMW_Spartanburg_Hunter          ← Right-click this
│   ├── BMW_Spartanburg_DevProd_Matt
│   └── BMW_Spartanburg_JustinM

Status Bar (bottom-left):
[$(git-branch) main]  ← Shows when database is linked
```

### Workflow Example

1. **User right-clicks on "BMW_Spartanburg_Hunter"**
2. **User selects "Sync Local Cache"**
3. **Status bar updates to show:** `$(git-branch) main`
4. **User hovers over status bar item**
5. **Tooltip shows:**
   ```
   Database "BMW_Spartanburg_Hunter" is linked to Git branch: main
   Repository: https://github.com/user/repo.git
   ```

---

## Benefits

### 1. **Quick Visual Feedback** ✨
- Instantly see which Git branch a database is linked to
- No need to check metadata.json or remember which branch you're on

### 2. **Always Visible** 👁️
- Status bar is always visible at the bottom of VS Code
- No need to open additional panels or views

### 3. **Detailed Information** 📊
- Tooltip provides full repository URL and branch name
- Helps prevent confusion when working with multiple databases

### 4. **Non-Intrusive** 🎯
- Only shows when relevant (database is linked)
- Automatically hides when not needed
- Doesn't clutter the UI

### 5. **Consistent with VS Code** 🎨
- Uses standard VS Code status bar patterns
- Uses built-in Git branch icon
- Follows VS Code design guidelines

---

## Testing Instructions

### Test Case 1: Database Not Linked
1. Right-click on a database that is NOT linked to Git
2. Select "Sync Local Cache"
3. **Expected:** Status bar indicator is hidden

### Test Case 2: Database Linked to Git
1. Right-click on a database that IS linked to Git
2. Select "Sync Local Cache"
3. **Expected:** Status bar shows `$(git-branch) <branch-name>`
4. Hover over status bar item
5. **Expected:** Tooltip shows database name, branch, and repository URL

### Test Case 3: Link to Git
1. Right-click on a database that is NOT linked
2. Select "Link to Git"
3. Enter repository URL and select branch
4. **Expected:** Status bar updates to show the selected branch after linking

### Test Case 4: Unlink from Git
1. Right-click on a database that IS linked
2. Select "Unlink from Git"
3. Confirm the unlink operation
4. **Expected:** Status bar indicator is hidden after unlinking

### Test Case 5: Multiple Databases
1. Link Database A to Git (branch: `main`)
2. Link Database B to Git (branch: `develop`)
3. Right-click Database A → "Sync Local Cache"
4. **Expected:** Status bar shows `$(git-branch) main`
5. Right-click Database B → "Sync Local Cache"
6. **Expected:** Status bar shows `$(git-branch) develop`

---

## Future Enhancements

### 1. Click to Open SourceControl Folder
- Make status bar item clickable
- Opens SourceControl folder in file explorer

### 2. Show Sync Status
- Add indicator for uncommitted changes
- Show last sync time

### 3. Quick Actions Menu
- Right-click on status bar item
- Show menu with "Sync", "Pull", "Push" options

### 4. Multiple Database Support
- Show all linked databases in a dropdown
- Quick switch between databases

### 5. Color Coding
- Different colors for different branch types
- Red for `main`, yellow for `develop`, green for feature branches

---

## Troubleshooting

### Status Bar Not Showing

**Problem:** Status bar indicator doesn't appear when database is linked

**Solutions:**
1. Check that database is actually linked (metadata.json has `gitLinked: true`)
2. Verify that `gitBranch` field exists in metadata.json
3. Check console for errors: View → Output → MSSQL Git Sync
4. Try unlinking and re-linking the database

### Status Bar Shows Wrong Branch

**Problem:** Status bar shows incorrect branch name

**Solutions:**
1. Check metadata.json in the database folder
2. Verify `gitBranch` field matches actual Git branch
3. Re-link the database to update metadata

### Status Bar Doesn't Update

**Problem:** Status bar doesn't update after linking/unlinking

**Solutions:**
1. Reload VS Code window (Ctrl+Shift+P → "Reload Window")
2. Check that commands are completing successfully
3. Verify no errors in console

---

## Conclusion

The status bar indicator provides a simple, non-intrusive way to see which Git branch a database is linked to. It automatically updates when you interact with databases through the extension's commands, providing instant visual feedback without cluttering the UI.

The implementation follows VS Code best practices and integrates seamlessly with the existing extension functionality.

