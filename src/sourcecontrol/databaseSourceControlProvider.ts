import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class DatabaseSourceControlProvider {
    private _disposables: vscode.Disposable[] = [];
    private _sourceControl: vscode.SourceControl;
    private _resourceGroup: vscode.SourceControlResourceGroup;
    private _gitDir: string;

    constructor(gitDir: string) {
        this._gitDir = gitDir;
        
        // Create source control instance
        this._sourceControl = vscode.scm.createSourceControl('sqlServerGitIntegration', 'Database Source Control');
        
        // Create resource group
        this._resourceGroup = this._sourceControl.createResourceGroup('changes', 'Changes');
        
        // Set up input box
        this._sourceControl.inputBox.placeholder = 'Message (press Ctrl+Enter to commit)';
        
        // Initial update
        this._update();
    }

    private _update() {
        // Get all files in the Git directory
        const files = this._getAllFiles(this._gitDir);
        
        // Create resource states for all files
        const resourceStates = files.map(file => ({
            resourceUri: vscode.Uri.file(file),
            command: {
                title: 'Open File',
                command: 'vscode.open',
                arguments: [vscode.Uri.file(file)]
            }
        }));
        
        this._resourceGroup.resourceStates = resourceStates;
        this._sourceControl.count = resourceStates.length;
    }

    private _getAllFiles(dir: string): string[] {
        const files: string[] = [];
        
        if (!fs.existsSync(dir)) {
            return files;
        }
        
        const items = fs.readdirSync(dir);
        
        for (const item of items) {
            const fullPath = path.join(dir, item);
            const stat = fs.statSync(fullPath);
            
            if (stat.isDirectory()) {
                files.push(...this._getAllFiles(fullPath));
            } else {
                files.push(fullPath);
            }
        }
        
        return files;
    }

    public dispose() {
        this._disposables.forEach(d => d.dispose());
        this._sourceControl.dispose();
    }
}