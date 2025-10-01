# Incremental Sync Update - Implementation Summary

## Overview

This document describes the improvements made to the MSSQL-Git-Sync extension to implement incremental file updates and rename the context menu command.

## Changes Implemented

### 1. Context Menu Command Renamed

**File:** `package.json`

**Change:** Renamed the context menu command from "Script Database to Git Repository" to "Sync Local Cache"

**Before:**
```json
"title": "Script Database to Git Repository"
```

**After:**
```json
"title": "Sync Local Cache"
```

**Rationale:** The new name better reflects the extension's purpose of maintaining a local cache of database objects that can be synced to git.

---

### 2. Incremental File Updates

**File:** `src/services/databaseScriptingService.ts`

#### New Method: `writeFileIfChanged()`

**Location:** Lines 366-390

**Purpose:** Only write files when their content has actually changed, preventing unnecessary file system operations and git changes.

**Implementation:**
```typescript
private async writeFileIfChanged(filePath: string, content: string): Promise<boolean> {
    try {
        // Try to read existing file
        const existingContent = await fs.readFile(filePath, 'utf8');
        
        // Compare content
        if (existingContent === content) {
            // Content is identical, skip writing
            return false;
        }
        
        // Content is different, write the file
        await fs.writeFile(filePath, content, 'utf8');
        return true;
    } catch (error) {
        // File doesn't exist or can't be read, write it
        await fs.writeFile(filePath, content, 'utf8');
        return true;
    }
}
```

**How It Works:**
1. Attempts to read the existing file content
2. Compares the new content with the existing content
3. If identical, returns `false` (file not updated)
4. If different or file doesn't exist, writes the file and returns `true` (file updated)

#### Updated File Writing Logic

**Location:** Lines 610-637 in `scriptObjectsByType()` method

**Changes:**
- Replaced direct `fs.writeFile()` calls with `writeFileIfChanged()`
- Added tracking for files updated vs. files skipped
- Added console logging to show update statistics

**Before:**
```typescript
// Write each script to file
for (const [key, script] of scripts.entries()) {
    try {
        const obj = objects.find(o => `${o.schema}.${o.name}` === key);
        if (!obj || !script) continue;

        // Save script to file
        const fileName = `${obj.schema}.${obj.name}.sql`;
        const filePath = path.join(typePath, fileName);
        await fs.writeFile(filePath, script, 'utf8');
        totalScripted++;
    } catch (error) {
        console.error(`Error writing file for ${key}:`, error);
        totalErrors++;
    }
}
```

**After:**
```typescript
// Write each script to file (only if content changed)
let filesUpdated = 0;
let filesSkipped = 0;

for (const [key, script] of scripts.entries()) {
    try {
        const obj = objects.find(o => `${o.schema}.${o.name}` === key);
        if (!obj || !script) continue;

        // Save script to file (only if changed)
        const fileName = `${obj.schema}.${obj.name}.sql`;
        const filePath = path.join(typePath, fileName);
        const wasUpdated = await this.writeFileIfChanged(filePath, script);
        
        if (wasUpdated) {
            filesUpdated++;
        } else {
            filesSkipped++;
        }
        totalScripted++;
    } catch (error) {
        console.error(`Error writing file for ${key}:`, error);
        totalErrors++;
    }
}

console.log(`[MSSQL-Git-Sync] ${objType.folder}: ${filesUpdated} updated, ${filesSkipped} unchanged`);
```

---

## Benefits

### 1. Performance Improvements
- **Faster sync operations**: Only writes files that have changed
- **Reduced disk I/O**: Skips unnecessary file writes
- **Better for large databases**: Significant time savings when most objects haven't changed

### 2. Git History Improvements
- **Cleaner git diffs**: Only files with actual changes are modified
- **Meaningful commits**: Git commits only show objects that actually changed
- **Reduced noise**: No more "file modified but content identical" changes

### 3. Better Visibility
- **Console logging**: Shows how many files were updated vs. skipped for each object type
- **Example output:**
  ```
  [MSSQL-Git-Sync] Tables: 5 updated, 45 unchanged
  [MSSQL-Git-Sync] Views: 2 updated, 18 unchanged
  [MSSQL-Git-Sync] StoredProcedures: 0 updated, 32 unchanged
  ```

---

## Testing Recommendations

### Test Case 1: First Sync (All New Files)
1. Delete the output folder for a database
2. Run "Sync Local Cache"
3. **Expected:** All files should be created (filesUpdated = total objects)

### Test Case 2: Re-sync Without Changes
1. Run "Sync Local Cache" on a database
2. Immediately run it again without making any database changes
3. **Expected:** All files should be skipped (filesSkipped = total objects, filesUpdated = 0)

### Test Case 3: Partial Changes
1. Run "Sync Local Cache" on a database
2. Modify one stored procedure in the database
3. Run "Sync Local Cache" again
4. **Expected:** Only the modified stored procedure file should be updated (filesUpdated = 1)

### Test Case 4: Git Integration
1. Initialize a git repository in the output folder
2. Run "Sync Local Cache"
3. Commit all files
4. Run "Sync Local Cache" again without database changes
5. Run `git status`
6. **Expected:** No modified files should appear in git status

---

## Implementation Notes

### Content Comparison
- Uses exact string comparison (`===`)
- Compares the entire file content
- Case-sensitive comparison
- Preserves line endings and whitespace

### Error Handling
- If existing file can't be read (doesn't exist, permissions, etc.), treats it as "needs update"
- Errors during file writing are caught and logged
- Doesn't stop processing if one file fails

### Performance Considerations
- Reading existing files adds minimal overhead
- For large databases with many objects, the time saved by skipping writes far outweighs the read overhead
- File system caching makes repeated reads very fast

---

## Future Enhancements

Potential improvements for future versions:

1. **Hash-based comparison**: Use file hashes instead of full content comparison for very large files
2. **Parallel processing**: Read and compare multiple files in parallel
3. **Statistics in metadata.json**: Include update/skip counts in the metadata file
4. **Dry-run mode**: Option to preview what would be updated without actually writing files
5. **Change detection report**: Generate a report of what changed between syncs

---

## Conclusion

These improvements make the extension more efficient and git-friendly by only updating files when their content has actually changed. The renamed context menu command ("Sync Local Cache") better reflects this incremental sync behavior.

