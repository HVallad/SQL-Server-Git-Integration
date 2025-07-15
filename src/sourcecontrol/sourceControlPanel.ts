import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { RetrieveDatabaseObjects, DatabaseObject } from '../sqlrunner';
import { GitManager } from '../gitmanagement';

export class SourceControlPanel {
	public static currentPanel: SourceControlPanel | undefined;
	public static readonly viewType = 'sqlServerGitIntegration.sourceControl';

	private readonly _panel: vscode.WebviewPanel;
	private readonly _extensionUri: vscode.Uri;
	private readonly _node: any;
	private readonly _repoDir: string;
	private _disposables: vscode.Disposable[] = [];

	public static createOrShow(extensionUri: vscode.Uri, node: any, repoDir: string) {
		const column = vscode.window.activeTextEditor
			? vscode.window.activeTextEditor.viewColumn
			: undefined;

		// If we already have a panel, show it.
		if (SourceControlPanel.currentPanel) {
			SourceControlPanel.currentPanel._panel.reveal(column);
			return;
		}

		// Otherwise, create a new panel.
		const panel = vscode.window.createWebviewPanel(
			SourceControlPanel.viewType,
			'Database Source Control',
			column || vscode.ViewColumn.One,
			{
				enableScripts: true,
				localResourceRoots: [
					vscode.Uri.joinPath(extensionUri, 'media'),
					vscode.Uri.joinPath(extensionUri, 'out/compiled')
				]
			}
		);

		SourceControlPanel.currentPanel = new SourceControlPanel(panel, extensionUri, node, repoDir);
	}

	public static revive(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, node: any, repoDir: string) {
		SourceControlPanel.currentPanel = new SourceControlPanel(panel, extensionUri, node, repoDir);
	}

	private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, node: any, repoDir: string) {
		this._panel = panel;
		this._extensionUri = extensionUri;
		this._node = node;
		this._repoDir = repoDir;

		// Set the webview's initial html content
		this._update();

		// Listen for when the panel is disposed
		// This happens when the user closes the panel or when the panel is closed programmatically
		this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

		// Update the content based on view changes
		this._panel.onDidChangeViewState(
			e => {
				if (this._panel.visible) {
					this._update();
				}
			},
			null,
			this._disposables
		);

		// Handle messages from the webview
		this._panel.webview.onDidReceiveMessage(
			message => {
				switch (message.command) {
					case 'refresh':
						this._update();
						return;
					case 'syncToGit':
						this._syncToGit();
						return;
					case 'syncFromGit':
						this._syncFromGit();
						return;
					case 'viewDiff':
						this._viewDiff(message.objectPath);
						return;
				}
			},
			null,
			this._disposables
		);
	}

	public dispose() {
		SourceControlPanel.currentPanel = undefined;

		// Clean up our resources
		this._panel.dispose();

		while (this._disposables.length) {
			const x = this._disposables.pop();
			if (x) {
				x.dispose();
			}
		}
	}

	private async _update() {
		const webview = this._panel.webview;
		this._panel.webview.html = this._getHtmlForWebview(webview);

		// Load the comparison data
		try {
			const comparisonData = await this._getComparisonData();
			webview.postMessage({ type: 'updateData', data: comparisonData });
		} catch (error: any) {
			console.error('Error loading comparison data:', error);
			webview.postMessage({ type: 'error', message: error.message });
		}
	}

	private async _getComparisonData() {
		// Get current database objects
		const currentObjects = await RetrieveDatabaseObjects(this._node);
		
		// Get saved database objects from file system
		const savedObjects = this._getSavedDatabaseObjects();
		
		// Compare and categorize objects
		const comparison = this._compareObjects(currentObjects, savedObjects);
		
		return {
			databaseName: this._node?.label || 'Database',
			comparison,
			summary: {
				added: comparison.added.length,
				modified: comparison.modified.length,
				deleted: comparison.deleted.length,
				unchanged: comparison.unchanged.length
			}
		};
	}

	private _getSavedDatabaseObjects(): DatabaseObject[] {
		const comparisonDir = path.join(this._repoDir, "DatabaseState");
		const objects: DatabaseObject[] = [];

		if (!fs.existsSync(comparisonDir)) {
			return objects;
		}

		// Recursively read all SQL files
		const readDirectory = (dir: string, schema: string, type: string) => {
			const items = fs.readdirSync(dir);
			
			for (const item of items) {
				const fullPath = path.join(dir, item);
				const stat = fs.statSync(fullPath);
				
				if (stat.isDirectory()) {
					// If this is a schema directory, update schema name
					if (schema === '' && !['schemas'].includes(item)) {
						readDirectory(fullPath, item, type);
					} else if (schema !== '' && type === '') {
						// This is a type directory
						readDirectory(fullPath, schema, item);
					} else {
						readDirectory(fullPath, schema, type);
					}
				} else if (item.endsWith('.sql')) {
					const name = item.replace('.sql', '');
					const definition = fs.readFileSync(fullPath, 'utf8');
					
					objects.push({
						schema,
						name,
						type,
						definition
					});
				}
			}
		};

		readDirectory(comparisonDir, '', '');
		return objects;
	}

	private _compareObjects(current: DatabaseObject[], saved: DatabaseObject[]): {
		added: DatabaseObject[];
		modified: { current: DatabaseObject; saved: DatabaseObject }[];
		deleted: DatabaseObject[];
		unchanged: DatabaseObject[];
	} {
		const added: DatabaseObject[] = [];
		const modified: { current: DatabaseObject; saved: DatabaseObject }[] = [];
		const deleted: DatabaseObject[] = [];
		const unchanged: DatabaseObject[] = [];

		// Create maps for efficient lookup
		const currentMap = new Map<string, DatabaseObject>();
		const savedMap = new Map<string, DatabaseObject>();

		current.forEach(obj => {
			const key = `${obj.schema}.${obj.name}.${obj.type}`;
			currentMap.set(key, obj);
		});

		saved.forEach(obj => {
			const key = `${obj.schema}.${obj.name}.${obj.type}`;
			savedMap.set(key, obj);
		});

		// Find added and modified objects
		current.forEach(obj => {
			const key = `${obj.schema}.${obj.name}.${obj.type}`;
			const savedObj = savedMap.get(key);
			
			if (!savedObj) {
				added.push(obj);
			} else if (obj.definition !== savedObj.definition) {
				modified.push({ current: obj, saved: savedObj });
			} else {
				unchanged.push(obj);
			}
		});

		// Find deleted objects
		saved.forEach(obj => {
			const key = `${obj.schema}.${obj.name}.${obj.type}`;
			if (!currentMap.has(key)) {
				deleted.push(obj);
			}
		});

		return { added, modified, deleted, unchanged };
	}

	private async _syncToGit() {
		try {
			// Get current database objects
			const currentObjects = await RetrieveDatabaseObjects(this._node);
			
			// Update the saved state
			const comparisonDir = path.join(this._repoDir, "DatabaseState");
			
			// Clear existing files
			if (fs.existsSync(comparisonDir)) {
				fs.rmSync(comparisonDir, { recursive: true, force: true });
			}
			
			// Write new files
			for (const obj of currentObjects) {
				const declaredSchemaDir = path.join(comparisonDir, "schemas", obj.schema, obj.type);
				if (!fs.existsSync(declaredSchemaDir)) {
					fs.mkdirSync(declaredSchemaDir, { recursive: true });
				}
				const filePath = path.join(declaredSchemaDir, `${obj.name}.sql`);
				fs.writeFileSync(filePath, obj.definition);
			}

			// Commit to git
			const gitDir = path.join(this._repoDir, "SourceControlState");
			await this._commitToGit(gitDir, "Update database state from SQL Server");

			vscode.window.showInformationMessage('Successfully synced database state to Git');
			this._update();
		} catch (error: any) {
			console.error('Error syncing to Git:', error);
			vscode.window.showErrorMessage(`Failed to sync to Git: ${error.message}`);
		}
	}

	private async _syncFromGit() {
		try {
			const gitDir = path.join(this._repoDir, "SourceControlState");
			await this._pullFromGit(gitDir);
			
			vscode.window.showInformationMessage('Successfully synced from Git');
			this._update();
		} catch (error: any) {
			console.error('Error syncing from Git:', error);
			vscode.window.showErrorMessage(`Failed to sync from Git: ${error.message}`);
		}
	}

	private async _commitToGit(gitDir: string, message: string) {
		// Change to git directory
		const originalCwd = process.cwd();
		process.chdir(gitDir);

		try {
			// Add all files
			await GitManager.executeCommand('git add .');
			
			// Commit
			await GitManager.executeCommand(`git commit -m "${message}"`);
			
			// Push
			await GitManager.executeCommand('git push');
		} finally {
			process.chdir(originalCwd);
		}
	}

	private async _pullFromGit(gitDir: string) {
		// Change to git directory
		const originalCwd = process.cwd();
		process.chdir(gitDir);

		try {
			// Pull latest changes
			await GitManager.executeCommand('git pull');
		} finally {
			process.chdir(originalCwd);
		}
	}

	private _viewDiff(objectPath: string) {
		// This would open a diff view between current and saved versions
		// For now, just show a message
		vscode.window.showInformationMessage(`Viewing diff for: ${objectPath}`);
	}

	private _getHtmlForWebview(webview: vscode.Webview) {
		return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Database Source Control</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            margin: 0;
            padding: 20px;
        }
        
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 10px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        
        .title {
            font-size: 18px;
            font-weight: bold;
        }
        
        .summary {
            display: flex;
            gap: 20px;
            margin-bottom: 20px;
        }
        
        .summary-item {
            padding: 10px;
            border-radius: 4px;
            text-align: center;
            min-width: 80px;
        }
        
        .summary-added {
            background-color: var(--vscode-gitDecoration-addedResourceForeground);
            color: white;
        }
        
        .summary-modified {
            background-color: var(--vscode-gitDecoration-modifiedResourceForeground);
            color: white;
        }
        
        .summary-deleted {
            background-color: var(--vscode-gitDecoration-deletedResourceForeground);
            color: white;
        }
        
        .summary-unchanged {
            background-color: var(--vscode-gitDecoration-untrackedResourceForeground);
            color: white;
        }
        
        .actions {
            display: flex;
            gap: 10px;
            margin-bottom: 20px;
        }
        
        .btn {
            padding: 8px 16px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
        }
        
        .btn-primary {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        
        .btn-secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        
        .btn:hover {
            opacity: 0.8;
        }
        
        .section {
            margin-bottom: 20px;
        }
        
        .section-title {
            font-size: 16px;
            font-weight: bold;
            margin-bottom: 10px;
            padding: 8px;
            background-color: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 4px;
        }
        
        .object-list {
            max-height: 300px;
            overflow-y: auto;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
        }
        
        .object-item {
            padding: 8px 12px;
            border-bottom: 1px solid var(--vscode-panel-border);
            cursor: pointer;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .object-item:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        
        .object-item:last-child {
            border-bottom: none;
        }
        
        .object-name {
            font-weight: 500;
        }
        
        .object-path {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }
        
        .loading {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
        }
        
        .error {
            color: var(--vscode-errorForeground);
            padding: 20px;
            background-color: var(--vscode-inputValidation-errorBackground);
            border-radius: 4px;
            margin-bottom: 20px;
        }
    </style>
</head>
<body>
    <div id="app">
        <div class="loading">Loading source control data...</div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        let currentData = null;
        
        // Listen for messages from the extension
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.type) {
                case 'updateData':
                    currentData = message.data;
                    renderData();
                    break;
                case 'error':
                    showError(message.message);
                    break;
            }
        });
        
        function renderData() {
            if (!currentData) return;
            
            const app = document.getElementById('app');
            
            app.innerHTML = \`
                <div class="header">
                    <div class="title">\${currentData.databaseName} - Source Control</div>
                    <button class="btn btn-secondary" onclick="refresh()">Refresh</button>
                </div>
                
                <div class="summary">
                    <div class="summary-item summary-added">
                        <div>\${currentData.summary.added}</div>
                        <div>Added</div>
                    </div>
                    <div class="summary-item summary-modified">
                        <div>\${currentData.summary.modified}</div>
                        <div>Modified</div>
                    </div>
                    <div class="summary-item summary-deleted">
                        <div>\${currentData.summary.deleted}</div>
                        <div>Deleted</div>
                    </div>
                    <div class="summary-item summary-unchanged">
                        <div>\${currentData.summary.unchanged}</div>
                        <div>Unchanged</div>
                    </div>
                </div>
                
                <div class="actions">
                    <button class="btn btn-primary" onclick="syncToGit()">Sync to Git</button>
                    <button class="btn btn-secondary" onclick="syncFromGit()">Sync from Git</button>
                </div>
                
                \${renderSection('Added Objects', currentData.comparison.added, 'added')}
                \${renderSection('Modified Objects', currentData.comparison.modified, 'modified')}
                \${renderSection('Deleted Objects', currentData.comparison.deleted, 'deleted')}
                \${renderSection('Unchanged Objects', currentData.comparison.unchanged, 'unchanged')}
            \`;
        }
        
        function renderSection(title, items, type) {
            if (items.length === 0) return '';
            
            const itemHtml = items.map(item => {
                const displayName = type === 'modified' ? item.current.name : item.name;
                const displayPath = type === 'modified' ? 
                    \`\${item.current.schema}.\${item.current.name} (\${item.current.type})\` :
                    \`\${item.schema}.\${item.name} (\${item.type})\`;
                
                return \`
                    <div class="object-item" onclick="viewDiff('\${displayPath}')">
                        <div>
                            <div class="object-name">\${displayName}</div>
                            <div class="object-path">\${displayPath}</div>
                        </div>
                        <div>\${type === 'modified' ? 'Modified' : ''}</div>
                    </div>
                \`;
            }).join('');
            
            return \`
                <div class="section">
                    <div class="section-title">\${title} (\${items.length})</div>
                    <div class="object-list">
                        \${itemHtml}
                    </div>
                </div>
            \`;
        }
        
        function refresh() {
            vscode.postMessage({ command: 'refresh' });
        }
        
        function syncToGit() {
            vscode.postMessage({ command: 'syncToGit' });
        }
        
        function syncFromGit() {
            vscode.postMessage({ command: 'syncFromGit' });
        }
        
        function viewDiff(objectPath) {
            vscode.postMessage({ command: 'viewDiff', objectPath });
        }
        
        function showError(message) {
            const app = document.getElementById('app');
            app.innerHTML = \`
                <div class="error">
                    <strong>Error:</strong> \${message}
                </div>
                <button class="btn btn-secondary" onclick="refresh()">Retry</button>
            \`;
        }
    </script>
</body>
</html>`;
	}
} 