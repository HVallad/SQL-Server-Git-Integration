# Unlink from Git Feature - Implementation Summary

## Overview

This document describes the "Unlink from Git" feature that allows users to disconnect a SQL Server database from its linked Git repository.

---

## Features Implemented

### 1. New Context Menu Command: "Unlink from Git"

**Location:** Right-click on any database node in MSSQL Object Explorer

**Availability:** Always visible alongside "Link to Git" (both commands check Git link status internally)

**Workflow:**

#### Step 1: Check Git Link Status
- Verifies that the database is actually linked to a Git repository
- If not linked, shows a warning message and exits gracefully
- Reads current metadata to display repository information in confirmation dialog

#### Step 2: Show Confirmation Dialog
- **Modal dialog** to prevent accidental unlinking
- **Message:** "Are you sure you want to unlink this database from Git (repository-url)? This will delete the SourceControl folder and all its contents."
- **Buttons:** "Unlink" and "Cancel"
- If user clicks "Cancel", operation is aborted

#### Step 3: Delete SourceControl Folder
- Recursively deletes the `SourceControl/` folder and all its contents
- Uses `fs.rm()` with `recursive: true` and `force: true`
- Handles case where folder doesn't exist (logs warning but continues)
- If deletion fails, throws error and does NOT update metadata

#### Step 4: Update Metadata
- Updates `metadata.json` to reflect unlinked status:
  ```json
  {
    "databaseName": "MyDatabase",
    "scriptedAt": "2025-01-15T10:30:00.000Z",
    "totalObjectsScripted": 150,
    "totalErrors": 0,
    "objectTypes": ["Table", "View", "StoredProcedure", "UserDefinedFunction", "Trigger"],
    "gitLinked": false,
    "gitRepositoryUrl": undefined,
    "gitBranch": undefined,
    "gitLinkedDate": undefined
  }
  ```
- Sets `gitLinked: false`
- Removes `gitRepositoryUrl`, `gitBranch`, and `gitLinkedDate` fields

#### Step 5: Show Success Message
- **Message:** "Database 'DatabaseName' successfully unlinked from Git repository"
- Non-modal information message

---

## Context Menu Behavior

### Current Implementation

Both "Link to Git" and "Unlink from Git" commands are always visible in the context menu. Each command checks the Git link status internally:

**"Link to Git" command:**
- If database is NOT linked → Proceeds with linking workflow
- If database IS linked → Shows warning message: "Database is already linked to a Git repository. Please unlink it first if you want to link to a different repository."

**"Unlink from Git" command:**
- If database IS linked → Proceeds with unlinking workflow
- If database is NOT linked → Shows warning message: "Database is not linked to a Git repository."

### Why Both Commands Are Always Visible

VS Code's context menu system doesn't support dynamic `when` clauses based on async database checks. The `when` clause in `package.json` is evaluated synchronously and cannot call async methods like `isGitLinked()`.

**Alternative approaches considered:**
1. **Context keys** - Would require updating context keys on every tree view refresh, which is complex and may not work reliably with the MSSQL extension's tree view
2. **Separate tree view** - Would require creating a custom tree view provider, which is beyond the scope of this feature
3. **Current approach** - Simple, reliable, and provides clear feedback to users

---

## Files Modified

### 1. `src/services/databaseScriptingService.ts`

**New Method: `unlinkFromGit()`**

```typescript
public async unlinkFromGit(node: vscodeMssql.ITreeNodeInfo): Promise<void>
```

**Implementation details:**
- Lines 297-400
- Checks if database is linked
- Shows confirmation dialog
- Deletes SourceControl folder
- Updates metadata
- Shows success message
- Comprehensive error handling

**Modified Method: `linkToGit()`**

Added check at the beginning to prevent linking if already linked:
```typescript
// Check if database is already linked
const isLinked = await this.isGitLinked(node);
if (isLinked) {
    const metadata = await this.readMetadata(this.getOutputPath(node));
    const repoInfo = metadata?.gitRepositoryUrl ? ` to ${metadata.gitRepositoryUrl}` : '';
    vscode.window.showWarningMessage(
        `Database "${databaseName}" is already linked to a Git repository${repoInfo}. Please unlink it first if you want to link to a different repository.`
    );
    return;
}
```

---

### 2. `src/extension.ts`

**New Command Registration:**

```typescript
const unlinkFromGitCommand = vscode.commands.registerCommand(
    'mssql-git-sync.unlinkFromGit',
    async (node: vscodeMssql.ITreeNodeInfo) => {
        try {
            await scriptingService?.unlinkFromGit(node);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to unlink from Git: ${errorMessage}`);
            console.error('Error unlinking from Git:', error);
        }
    }
);

context.subscriptions.push(unlinkFromGitCommand);
```

---

### 3. `package.json`

**New Command:**
```json
{
    "command": "mssql-git-sync.unlinkFromGit",
    "title": "Unlink from Git",
    "category": "MSSQL Git Sync"
}
```

**New Context Menu Entry:**
```json
{
    "command": "mssql-git-sync.unlinkFromGit",
    "when": "view == objectExplorer && viewItem =~ /\\btype=(Database)\\b/",
    "group": "9_MSSQL_GIT_SYNC@3"
}
```

**New Activation Event:**
```json
"activationEvents": [
    "onCommand:mssql-git-sync.scriptDatabaseToGit",
    "onCommand:mssql-git-sync.linkToGit",
    "onCommand:mssql-git-sync.unlinkFromGit"
]
```

---

## Error Handling

### Database Not Linked
**Scenario:** User clicks "Unlink from Git" on a database that is not linked

**Behavior:**
- Shows warning message: "Database 'DatabaseName' is not linked to a Git repository."
- Operation is cancelled
- No changes are made

### User Cancels Confirmation
**Scenario:** User clicks "Cancel" in the confirmation dialog

**Behavior:**
- Operation is cancelled
- Console log: "Unlink cancelled by user"
- No changes are made

### SourceControl Folder Doesn't Exist
**Scenario:** Metadata says database is linked, but SourceControl folder doesn't exist

**Behavior:**
- Logs warning: "SourceControl folder doesn't exist, skipping deletion"
- Continues with metadata update
- Shows success message

### SourceControl Folder Deletion Fails
**Scenario:** Deletion fails due to permissions, locked files, etc.

**Behavior:**
- Throws error with message: "Failed to delete SourceControl folder: {error}"
- Does NOT update metadata
- Shows error message to user
- SourceControl folder remains (may be partially deleted)

### Metadata Update Fails
**Scenario:** Metadata file cannot be written

**Behavior:**
- Throws error with message: "Failed to update metadata: {error}"
- Shows error message to user
- SourceControl folder has been deleted but metadata still shows linked

---

## Usage Instructions

### How to Unlink a Database from Git

1. **Open MSSQL Object Explorer** in VS Code
2. **Expand your server connection**
3. **Right-click on a database node** that is linked to Git
4. **Select "Unlink from Git"** from the context menu
5. **Review the confirmation dialog**
   - Verify the repository URL is correct
   - Understand that the SourceControl folder will be deleted
6. **Click "Unlink"** to confirm or "Cancel" to abort
7. **Wait for the operation** to complete
8. **Verify success message** appears

### After Unlinking

**Folder Structure:**
```
{server}_{database}_{hash}/
├── metadata.json                    # gitLinked: false
└── LocalCache/                      # Unchanged
    ├── Tables/
    ├── Views/
    ├── StoredProcedures/
    ├── Functions/
    └── Triggers/
```

**What Happens:**
- ✅ SourceControl folder is deleted
- ✅ metadata.json is updated (gitLinked: false)
- ✅ LocalCache folder is preserved
- ✅ Can link to the same or different repository again

---

## Testing Checklist

### Basic Functionality
- [x] "Unlink from Git" command appears in context menu for database nodes
- [x] Command checks if database is linked before proceeding
- [x] Warning message shown if database is not linked
- [x] Confirmation dialog appears with correct repository URL
- [x] User can cancel the operation
- [x] SourceControl folder is deleted successfully
- [x] metadata.json is updated correctly
- [x] Success message is shown

### Link to Git Integration
- [x] "Link to Git" shows warning if database is already linked
- [x] After unlinking, "Link to Git" works correctly
- [x] Can re-link to the same repository
- [x] Can re-link to a different repository

### Error Handling
- [x] Warning shown when unlinking a non-linked database
- [x] Operation cancelled when user clicks "Cancel"
- [x] Handles missing SourceControl folder gracefully
- [x] Error shown if SourceControl folder deletion fails
- [x] Error shown if metadata update fails
- [x] Console logs provide useful debugging information

### Edge Cases
- [x] Unlinking immediately after linking
- [x] Unlinking when SourceControl folder is manually deleted
- [x] Unlinking when metadata.json is corrupted
- [x] Multiple unlink attempts on the same database

---

## Future Enhancements

### 1. Dynamic Context Menu (Ideal Solution)
**Goal:** Show only "Link to Git" OR "Unlink from Git" based on Git link status

**Challenges:**
- VS Code context menus don't support async `when` clauses
- Would require maintaining context keys for each database
- Complex to implement with MSSQL extension's tree view

**Potential Approach:**
- Listen to MSSQL tree view refresh events
- Update context keys for each database node
- Use context keys in `when` clauses

### 2. Unlink with Backup
- Option to backup SourceControl folder before deletion
- Create a zip file of SourceControl folder
- Store in a separate "Backups" folder

### 3. Partial Unlink
- Option to keep SourceControl folder but update metadata
- Useful for temporarily disconnecting without losing local changes

### 4. Bulk Unlink
- Unlink multiple databases at once
- Show progress for each database
- Summary report of successes/failures

### 5. Unlink History
- Track when databases were linked/unlinked
- Store in metadata.json
- Show in a dedicated view

---

## Conclusion

The "Unlink from Git" feature provides a safe and user-friendly way to disconnect databases from Git repositories. The confirmation dialog prevents accidental unlinking, and comprehensive error handling ensures data integrity. While both "Link to Git" and "Unlink from Git" commands are always visible in the context menu, each command checks the Git link status internally and provides appropriate feedback to users.

