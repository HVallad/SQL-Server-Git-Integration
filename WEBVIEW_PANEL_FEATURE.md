# Webview Panel Feature - Implementation Summary

## Overview

This document describes the custom webview panel that provides a dedicated UI for managing database Git synchronization with visual indicators, icons, and interactive controls.

---

## Features Implemented

### 1. Custom Activity Bar Icon

**Location:** Left sidebar (Activity Bar) in VS Code

**Icon:** Database icon (`$(database)`)

**Title:** "MSSQL Git Sync"

**Click to open:** Git Sync Manager panel

---

### 2. Git Sync Manager Panel

**Location:** Opens in the sidebar when clicking the activity bar icon

**Features:**
- **Header** with title and refresh button
- **Database list** showing all connected databases
- **Git status indicators** with visual icons
- **Interactive buttons** for each database
- **Real-time updates** when actions are performed

---

### 3. Database Display

Each database is shown as a card with:

#### Visual Indicators
- **✓ Green checkmark** - Database is linked to Git
- **○ Gray circle** - Database is not linked to Git

#### Information Displayed
- **Server name** (small gray text above)
- **Database name** (bold, prominent)
- **Git branch** (with branch icon, shown only if linked)
- **Repository URL** (truncated with tooltip, shown only if linked)

#### Action Buttons

**For Linked Databases:**
- **Sync** - Syncs the LocalCache with latest database scripts
- **Open** - Opens the database folder in file explorer
- **Unlink** (red) - Unlinks the database from Git

**For Non-Linked Databases:**
- **Link to Git** - Opens the link workflow

---

## User Interface

### Panel Layout

```
┌─────────────────────────────────────────┐
│ MSSQL Git Sync              [Refresh]   │ ← Header
├─────────────────────────────────────────┤
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ Server1                             │ │
│ │ ✓ BMW_Spartanburg_Hunter            │ │ ← Linked database
│ │ $(git-branch) main                  │ │
│ │ https://github.com/user/repo.git    │ │
│ │ [Sync] [Open] [Unlink]              │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ Server1                             │ │
│ │ ○ BMW_Spartanburg_DevProd_Matt      │ │ ← Not linked
│ │ [Link to Git]                       │ │
│ └─────────────────────────────────────┘ │
│                                         │
└─────────────────────────────────────────┘
```

---

## Implementation Details

### Files Created

#### 1. `src/views/gitSyncPanelProvider.ts`

**Purpose:** WebviewViewProvider implementation

**Key Methods:**
```typescript
// Resolve the webview view
resolveWebviewView(webviewView, context, token)

// Refresh the panel with current data
async refresh()

// Update database list
async updateDatabases(databases: DatabaseInfo[])

// Handle messages from webview
private async _handleMessage(data)

// Action handlers
private async _handleSync(server, database)
private async _handleLink(server, database)
private async _handleUnlink(server, database)
private async _handleOpenFolder(server, database)
```

**DatabaseInfo Interface:**
```typescript
interface DatabaseInfo {
    server: string;
    database: string;
    isLinked: boolean;
    gitBranch?: string;
    gitRepositoryUrl?: string;
    node?: vscodeMssql.ITreeNodeInfo;
}
```

---

#### 2. `media/panel.css`

**Purpose:** Styling for the webview panel

**Key Styles:**
- Uses VS Code CSS variables for theming
- Responsive card-based layout
- Hover effects on database items
- Color-coded action buttons
- Codicon font integration

**Color Scheme:**
- **Linked status:** Green (`--vscode-testing-iconPassed`)
- **Not linked status:** Gray with opacity
- **Primary buttons:** Blue (`--vscode-button-background`)
- **Secondary buttons:** Gray (`--vscode-button-secondaryBackground`)
- **Danger buttons:** Red (`--vscode-inputValidation-errorBackground`)

---

#### 3. `media/panel.js`

**Purpose:** Client-side JavaScript for webview interactivity

**Key Functions:**
```javascript
// Render database list
renderDatabases(databases)

// Create HTML for a database item
createDatabaseItem(db)

// Action handlers
syncDatabase(server, database)
linkDatabase(server, database)
unlinkDatabase(server, database)
openFolder(server, database)
refresh()
```

**Message Passing:**
```javascript
// Send message to extension
vscode.postMessage({
    type: 'sync',
    server: server,
    database: database
});

// Receive message from extension
window.addEventListener('message', event => {
    const message = event.data;
    switch (message.type) {
        case 'refresh':
            renderDatabases(message.databases);
            break;
    }
});
```

---

### Integration with Extension

#### `src/extension.ts` Changes

**Initialize Panel:**
```typescript
gitSyncPanel = new GitSyncPanelProvider(context.extensionUri, scriptingService, mssqlApi);
context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(GitSyncPanelProvider.viewType, gitSyncPanel)
);
```

**Refresh Panel After Actions:**
```typescript
// After sync
await scriptingService?.scriptDatabaseToFiles(node);
await gitSyncPanel?.refresh();

// After link
await scriptingService?.linkToGit(node);
await gitSyncPanel?.refresh();

// After unlink
await scriptingService?.unlinkFromGit(node);
await gitSyncPanel?.refresh();
```

---

#### `package.json` Changes

**View Container:**
```json
"viewsContainers": {
    "activitybar": [
        {
            "id": "mssql-git-sync",
            "title": "MSSQL Git Sync",
            "icon": "$(database)"
        }
    ]
}
```

**View Registration:**
```json
"views": {
    "mssql-git-sync": [
        {
            "type": "webview",
            "id": "mssql-git-sync.gitSyncPanel",
            "name": "Git Sync Manager"
        }
    ]
}
```

---

## User Experience

### Opening the Panel

1. **Click the database icon** in the Activity Bar (left sidebar)
2. **Panel opens** showing "Git Sync Manager"
3. **Database list loads** (currently shows empty state)

### Empty State

When no databases are connected:
```
┌─────────────────────────────────────────┐
│ MSSQL Git Sync              [Refresh]   │
├─────────────────────────────────────────┤
│                                         │
│         No databases found              │
│                                         │
│  Connect to a SQL Server in the MSSQL   │
│  Object Explorer to see databases here. │
│                                         │
└─────────────────────────────────────────┘
```

### Interacting with Databases

**Sync a Database:**
1. Click **[Sync]** button on a linked database
2. Extension scripts all database objects to LocalCache
3. Success message appears
4. Panel refreshes automatically

**Link a Database:**
1. Click **[Link to Git]** button on a non-linked database
2. Enter repository URL
3. Select branch
4. Repository is cloned to SourceControl folder
5. Panel refreshes showing new Git status

**Unlink a Database:**
1. Click **[Unlink]** button (red) on a linked database
2. Confirmation dialog appears
3. Confirm to unlink
4. SourceControl folder is deleted
5. Panel refreshes showing updated status

**Open Folder:**
1. Click **[Open]** button on a linked database
2. File explorer opens showing the database folder

---

## Benefits

### 1. **Centralized Management** 🎯
- All databases in one place
- Quick overview of Git link status
- No need to navigate MSSQL Object Explorer

### 2. **Visual Feedback** ✨
- Clear icons show link status at a glance
- Color-coded buttons for different actions
- Real-time updates after operations

### 3. **Quick Actions** ⚡
- One-click sync, link, unlink operations
- No need to right-click in Object Explorer
- Faster workflow for managing multiple databases

### 4. **Better Organization** 📊
- Grouped by server
- Shows repository and branch information
- Easy to see which databases are linked

### 5. **Consistent with VS Code** 🎨
- Uses standard VS Code theming
- Follows VS Code design patterns
- Integrates seamlessly with sidebar

---

## Future Enhancements

### 1. **Auto-Discovery of Databases**
- Automatically detect connected SQL Servers
- Populate panel with all available databases
- Update when connections change

### 2. **Search and Filter**
- Search box to filter databases
- Filter by linked/not linked status
- Filter by server

### 3. **Batch Operations**
- Select multiple databases
- Sync all linked databases at once
- Bulk link/unlink operations

### 4. **Git Operations**
- Pull latest changes from remote
- Push local changes to remote
- View commit history
- Show uncommitted changes

### 5. **Status Indicators**
- Show last sync time
- Indicate uncommitted changes
- Show sync status (syncing, up-to-date, error)

### 6. **Sorting and Grouping**
- Sort by name, server, status
- Group by server or link status
- Collapsible server groups

---

## Testing Instructions

### Test Case 1: Open Panel
1. Press **F5** to launch Extension Development Host
2. Click the **database icon** in Activity Bar
3. **Expected:** Panel opens showing "Git Sync Manager"
4. **Expected:** Empty state message appears

### Test Case 2: Panel Refresh
1. Click **[Refresh]** button in panel header
2. **Expected:** Panel refreshes (currently shows empty state)

### Test Case 3: Link Database from Panel
1. (Once auto-discovery is implemented)
2. Click **[Link to Git]** on a database
3. Complete link workflow
4. **Expected:** Panel updates showing Git status

### Test Case 4: Sync from Panel
1. (Once auto-discovery is implemented)
2. Click **[Sync]** on a linked database
3. **Expected:** Sync operation runs
4. **Expected:** Success message appears
5. **Expected:** Panel refreshes

### Test Case 5: Unlink from Panel
1. (Once auto-discovery is implemented)
2. Click **[Unlink]** on a linked database
3. Confirm unlink
4. **Expected:** Database is unlinked
5. **Expected:** Panel updates showing new status

---

## Known Limitations

### Current Implementation

1. **No Auto-Discovery**
   - Panel doesn't automatically populate with databases
   - Requires manual implementation to fetch databases from MSSQL API
   - Currently shows empty state

2. **Manual Refresh Required**
   - Panel doesn't auto-refresh when connections change
   - User must click refresh button

3. **No Real-Time Updates**
   - Panel only updates after explicit actions
   - Doesn't detect external changes to metadata

### Planned Improvements

These limitations will be addressed in future updates by:
- Implementing database discovery from MSSQL connections
- Adding event listeners for connection changes
- Implementing file system watchers for metadata changes

---

## Conclusion

The webview panel provides a modern, user-friendly interface for managing database Git synchronization. While the current implementation establishes the foundation with a complete UI and action handlers, the next step is to implement auto-discovery of databases from MSSQL connections to populate the panel automatically.

The panel follows VS Code best practices, uses proper theming, and provides a clean, intuitive interface for managing multiple databases efficiently.

