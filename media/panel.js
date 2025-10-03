/*---------------------------------------------------------------------------------------------
 *  Git Sync Panel Script
 *--------------------------------------------------------------------------------------------*/

(function () {
    const vscode = acquireVsCodeApi();

    // Handle messages from the extension
    window.addEventListener('message', event => {
        const message = event.data;
        switch (message.type) {
            case 'refresh':
                renderDatabases(message.databases);
                break;
        }
    });

    /**
     * Render the list of databases in tree view format
     */
    function renderDatabases(databases) {
        const container = document.getElementById('tree-view');

        if (!databases || databases.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <p>No databases found</p>
                    <p class="hint">Connect to a SQL Server in the MSSQL Object Explorer to see databases here.</p>
                </div>
            `;
            return;
        }

        // Group databases by server
        const serverGroups = {};
        databases.forEach(db => {
            if (!serverGroups[db.server]) {
                serverGroups[db.server] = [];
            }
            serverGroups[db.server].push(db);
        });

        // Create tree view HTML
        const serversHtml = Object.keys(serverGroups).sort().map(serverName => {
            const databases = serverGroups[serverName];
            return createServerGroup(serverName, databases);
        }).join('');

        container.innerHTML = serversHtml;

        // Add event listeners for expand/collapse
        document.querySelectorAll('.server-header').forEach(header => {
            header.addEventListener('click', toggleServer);
        });
    }

    /**
     * Create HTML for a server group
     */
    function createServerGroup(serverName, databases) {
        const databasesHtml = databases.map(db => createDatabaseItem(db)).join('');

        return `
            <div class="server-group">
                <div class="server-header expanded" data-server="${escapeHtml(serverName)}">
                    <span class="server-chevron codicon codicon-chevron-right expanded"></span>
                    <span class="server-icon codicon codicon-server"></span>
                    <span class="server-name">${escapeHtml(serverName)}</span>
                </div>
                <div class="server-databases expanded">
                    ${databasesHtml}
                </div>
            </div>
        `;
    }

    /**
     * Create HTML for a database item
     */
    function createDatabaseItem(db) {
        const isLinked = db.isLinked;
        const statusBadge = isLinked
            ? `<span class="git-status-badge linked" title="Linked to Git: ${escapeHtml(db.gitBranch || 'unknown')}">
                   <span class="codicon codicon-pass-filled"></span>
                   ${db.gitBranch ? `<span class="git-branch-text">${escapeHtml(db.gitBranch)}</span>` : ''}
               </span>`
            : `<span class="git-status-badge not-linked" title="Not linked to Git">
                   <span class="codicon codicon-circle-slash"></span>
               </span>`;

        const actions = isLinked ? `
            <button class="action-icon-btn" onclick="syncDatabase('${escapeHtml(db.server)}', '${escapeHtml(db.database)}')" title="Sync Local Cache">
                <span class="codicon codicon-sync"></span>
            </button>
            <button class="action-icon-btn" onclick="openFolder('${escapeHtml(db.server)}', '${escapeHtml(db.database)}')" title="Open Folder">
                <span class="codicon codicon-folder-opened"></span>
            </button>
            <button class="action-icon-btn" onclick="unlinkDatabase('${escapeHtml(db.server)}', '${escapeHtml(db.database)}')" title="Unlink from Git">
                <span class="codicon codicon-close"></span>
            </button>
        ` : `
            <button class="action-icon-btn" onclick="linkDatabase('${escapeHtml(db.server)}', '${escapeHtml(db.database)}')" title="Link to Git">
                <span class="codicon codicon-link"></span>
            </button>
        `;

        return `
            <div class="database-item" data-server="${escapeHtml(db.server)}" data-database="${escapeHtml(db.database)}">
                <span class="database-icon codicon codicon-database"></span>
                <span class="database-name">${escapeHtml(db.database)}</span>
                ${statusBadge}
                <div class="actions">
                    ${actions}
                </div>
            </div>
        `;
    }

    /**
     * Toggle server expand/collapse
     */
    function toggleServer(event) {
        const header = event.currentTarget;
        const chevron = header.querySelector('.server-chevron');
        const databases = header.nextElementSibling;

        if (databases && databases.classList.contains('server-databases')) {
            const isExpanded = databases.classList.contains('expanded');

            if (isExpanded) {
                databases.classList.remove('expanded');
                chevron.classList.remove('expanded');
                header.classList.remove('expanded');
            } else {
                databases.classList.add('expanded');
                chevron.classList.add('expanded');
                header.classList.add('expanded');
            }
        }
    }

    /**
     * Escape HTML to prevent XSS
     */
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Sync a database
     */
    window.syncDatabase = function(server, database) {
        vscode.postMessage({
            type: 'sync',
            server: server,
            database: database
        });
    };

    /**
     * Link a database to Git
     */
    window.linkDatabase = function(server, database) {
        vscode.postMessage({
            type: 'link',
            server: server,
            database: database
        });
    };

    /**
     * Unlink a database from Git
     */
    window.unlinkDatabase = function(server, database) {
        vscode.postMessage({
            type: 'unlink',
            server: server,
            database: database
        });
    };

    /**
     * Open the database folder
     */
    window.openFolder = function(server, database) {
        vscode.postMessage({
            type: 'openFolder',
            server: server,
            database: database
        });
    };

    /**
     * Refresh the panel
     */
    window.refresh = function() {
        vscode.postMessage({
            type: 'refresh'
        });
    };
})();

