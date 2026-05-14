// Storage Manager JavaScript

class StorageManager {
    constructor() {
        this.connectedStorages = [];
        this.currentStorage = 'native';
        this.storageData = {};
        this.currentFiles = []; // Store current loaded files for stats calculation
        this.currentFolders = []; // Store current folders for cloud navigation
        this.cloudFolderId = null; // Current folder ID in cloud storage
        this.cloudBreadcrumbs = []; // Breadcrumb trail for cloud navigation
        this.loadingModal = null;
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.loadConnectedStorages();
        this.setupTabs();
        this.loadingModal = document.getElementById('storageLoadingModal');
    }

    setupEventListeners() {
        // Storage icon clicks
        const storageIcons = document.querySelectorAll('.storage-icon');
        storageIcons.forEach(icon => {
            icon.addEventListener('click', (e) => {
                const provider = e.currentTarget.getAttribute('data-provider');
                this.handleStorageClick(provider);
            });
        });

        // Tab clicks
        document.addEventListener('click', (e) => {
            if (e.target.closest('.storage-tab')) {
                const tab = e.target.closest('.storage-tab');
                const storage = tab.getAttribute('data-storage');
                this.switchToStorage(storage);
            }
        });

        // Tab close buttons
        document.addEventListener('click', (e) => {
            if (e.target.closest('.tab-close')) {
                e.stopPropagation();
                const tab = e.target.closest('.storage-tab');
                const storage = tab.getAttribute('data-storage');
                this.disconnectStorage(storage);
            }
        });

        // Refresh button click
        const refreshBtn = document.getElementById('refresh-storage-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                if (this.currentStorage === 'native') {
                    // Si estamos en almacenamiento nativo, usar la lógica de clean_javascript.js
                    if (typeof window.loadFolderContent === 'function') {
                        window.loadFolderContent(window.currentFolderId, window.isViewingTrash);
                    } else {
                        this.loadStorageContent('native');
                    }
                } else {
                    this.loadStorageContent(this.currentStorage);
                }
            });
        }

        // Stats button click
        const statsBtn = document.getElementById('stats-storage-btn');
        if (statsBtn) {
            statsBtn.addEventListener('click', () => {
                this.toggleStatsPanel();
            });
        }

        // Stats close button
        const closeStatsBtn = document.getElementById('close-stats-panel');
        if (closeStatsBtn) {
            closeStatsBtn.addEventListener('click', () => {
                document.getElementById('stats-panel').classList.add('hidden');
            });
        }

        // Check for connection success in URL
        this.checkConnectionSuccess();
    }

    checkConnectionSuccess() {
        const urlParams = new URLSearchParams(window.location.search);
        const connectedProvider = urlParams.get('connected');

        if (connectedProvider) {
            this.showSuccess(`Successfully connected to ${this.getProviderDisplayName(connectedProvider)}`);

            // Wait for connected storages to load then switch
            setTimeout(() => {
                this.switchToStorage(connectedProvider);
            }, 500);

            // Clean URL
            const url = new URL(window.location);
            url.searchParams.delete('connected');
            window.history.replaceState({}, document.title, url);
        }
    }

    async handleStorageClick(provider) {
        const icon = document.querySelector(`[data-provider="${provider}"]`);

        if (icon.classList.contains('connected')) {
            // If already connected, switch to that tab
            this.switchToStorage(provider);
        } else {
            // Start connection process
            await this.connectStorage(provider);
        }
    }

    async connectStorage(provider) {
        if (provider === 'mega') {
            this.showError('MEGA connection requires manual setup. Please contact support.');
            return;
        }

        try {
            this.showConnectionLoading(provider);

            // Redirect to OAuth endpoint
            window.location.href = `/x_integ/storage/connect/${provider}`;

        } catch (error) {
            console.error('Error connecting storage:', error);
            this.hideConnectionLoading();
            this.showError(`Failed to connect to ${this.getProviderDisplayName(provider)}`);
        }
    }

    async disconnectStorage(provider) {
        if (provider === 'native') {
            this.showError('Cannot disconnect native storage');
            return;
        }

        try {
            const response = await fetch(`/x_integ/storage/disconnect/${provider}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                // Clear state for this provider
                delete this.storageData[provider];
                this.connectedStorages = this.connectedStorages.filter(s => s.provider !== provider);

                // Update UI
                this.updateStorageIcon(provider, 'disconnected');
                this.removeStorageTab(provider);

                // Force clear current view to prevent ghosts
                const cardView = document.getElementById('cardView');
                const tableBody = document.getElementById('documentTableBody');
                if (cardView) cardView.innerHTML = '';
                if (tableBody) tableBody.innerHTML = '';

                // Switch back to native files immediately
                // if (this.currentStorage === provider || this.currentStorage === 'native') {
                await this.switchToStorage('native');
                // }

                this.showSuccess(`Disconnected from ${this.getProviderDisplayName(provider)}`);
            } else {
                throw new Error('Failed to disconnect');
            }
        } catch (error) {
            console.error('Error disconnecting storage:', error);
            this.showError(`Failed to disconnect from ${this.getProviderDisplayName(provider)}`);
        }
    }

    async loadConnectedStorages() {
        try {
            const response = await fetch('/x_integ/storage/connected');
            if (response.ok) {
                const data = await response.json();
                this.connectedStorages = data.connected_storages || [];
                this.updateStorageUI();
            }
        } catch (error) {
            console.error('Error loading connected storages:', error);
        }
    }

    updateStorageUI() {
        // Update storage icons
        const storageIcons = document.querySelectorAll('.storage-icon');
        storageIcons.forEach(icon => {
            const provider = icon.getAttribute('data-provider');
            const isConnected = this.connectedStorages.some(s => s.provider === provider);
            this.updateStorageIcon(provider, isConnected ? 'connected' : 'disconnected');
        });

        // Create tabs for connected storages
        this.connectedStorages.forEach(storage => {
            this.addStorageTab(storage.provider, storage.name);
        });
    }

    updateStorageIcon(provider, status) {
        const icon = document.querySelector(`[data-provider="${provider}"]`);
        if (!icon) return;

        icon.classList.remove('connected', 'connecting');

        if (status === 'connected') {
            icon.classList.add('connected');
            icon.title = `Connected to ${this.getProviderDisplayName(provider)} - Click to view files`;
        } else if (status === 'connecting') {
            icon.classList.add('connecting');
            icon.title = `Connecting to ${this.getProviderDisplayName(provider)}...`;
        } else {
            icon.title = `Connect to ${this.getProviderDisplayName(provider)}`;
        }
    }

    setupTabs() {
        let tabsContainer = document.getElementById('storageTabs');

        if (!tabsContainer) {
            // Create container if it doesn't exist (logic from clean_javascript.js)
            const breadcrumbs = document.querySelector('.breadcrumbs-container');
            if (breadcrumbs) {
                const container = document.createElement('div');
                container.className = 'storage-tabs-container';
                container.innerHTML = `
                    <div class="storage-tabs" id="storageTabs">
                        <div class="storage-tab active" data-storage="native">
                            <i class="bi bi-hdd"></i>
                            <span>My Documents</span>
                        </div>
                    </div>
                `;
                breadcrumbs.insertAdjacentElement('afterend', container);
                tabsContainer = document.getElementById('storageTabs');
            }
        }

        if (!tabsContainer) return;

        // Ensure native tab exist listener if not already added
        const nativeTab = tabsContainer.querySelector('[data-storage="native"]');
        if (nativeTab && !nativeTab.onclick) {
            nativeTab.addEventListener('click', () => this.switchToStorage('native'));
        }

        this.updateTabsVisibility();
    }

    addStorageTab(provider, displayName, isNative = false) {
        const tabsContainer = document.getElementById('storageTabs');
        if (!tabsContainer) return;

        // Check if tab already exists
        if (tabsContainer.querySelector(`[data-storage="${provider}"]`)) return;

        const tab = document.createElement('div');
        tab.className = 'storage-tab' + (this.currentStorage === provider ? ' active' : '');
        tab.setAttribute('data-storage', provider);

        const iconUrl = this.getProviderIconURL(provider);
        const iconHtml = iconUrl ? `<img src="${iconUrl}" alt="${provider}" style="width: 16px; height: 16px; margin-right: 8px;">` : `<i class="${this.getProviderIcon(provider)}"></i>`;

        tab.innerHTML = `
            ${iconHtml}
            <span>${displayName || this.getProviderDisplayName(provider)}</span>
            ${!isNative ? '<button class="tab-close"></button>' : ''}
        `;

        tabsContainer.appendChild(tab);
        this.updateTabsVisibility();
    }

    removeStorageTab(provider) {
        const tab = document.querySelector(`.storage-tab[data-storage="${provider}"]`);
        if (tab) {
            tab.remove();
        }
        this.updateTabsVisibility();
    }

    updateTabsVisibility() {
        const tabs = document.querySelectorAll('#storageTabs .storage-tab');
        const containerWrapper = document.querySelector('.storage-tabs-container');

        if (containerWrapper) {
            // Hide if no external integrations connected (more than 1 tab means active integrations)
            if (tabs.length <= 1) {
                containerWrapper.style.display = 'none';
            } else {
                containerWrapper.style.display = 'block';
            }
        }
    }

    async switchToStorage(storage) {
        // Update active tab
        const tabs = document.querySelectorAll('.storage-tab');
        tabs.forEach(tab => {
            tab.classList.toggle('active', tab.getAttribute('data-storage') === storage);
        });

        // Hide/Show controls based on storage type
        const controls = document.querySelector('.controls-container');
        const actions = document.querySelector('.actions-dropdown');
        if (controls) controls.style.display = (storage === 'native') ? 'flex' : 'none';
        if (actions) actions.style.display = (storage === 'native') ? 'block' : 'none';

        this.currentStorage = storage;
        this.currentFiles = []; // Reset files for new storage
        this.currentFolders = []; // Reset folders
        this.cloudFolderId = null; // Reset to root
        this.cloudBreadcrumbs = [{ id: null, name: this.getProviderDisplayName(storage) }]; // Reset breadcrumbs

        // Synchronize with clean_javascript.js if available
        if (typeof window.activeCloudProvider !== 'undefined') {
            window.activeCloudProvider = (storage === 'native') ? null : storage;
        }

        // Load storage content
        await this.loadStorageContent(storage);

        // Update Stats Panel if visible
        const statsPanel = document.getElementById('stats-panel');
        if (statsPanel && !statsPanel.classList.contains('hidden')) {
            this.updateStatsPanel();
        }

        // === UPLOAD TOAST MANAGEMENT ===
        // Automatically show upload toast when in cloud storage, hide when in native
        if (storage !== 'native') {
            // Show and expand upload toast for cloud storage
            if (typeof window.openUploadToast === 'function') {
                window.openUploadToast();
            } else if (window.uploadToast) {
                window.uploadToast.show();
                window.uploadToast.expand();
            }
            // Ensure provider icon is updated after toast is visible
            if (window.uploadToast && typeof window.uploadToast.updateProviderIcon === 'function') {
                window.uploadToast.updateProviderIcon();
            }
        } else {
            // Hide upload toast when returning to native files
            if (window.uploadToast) {
                window.uploadToast.hide();
            }
        }
    }

    async loadStorageContent(storage, folderId = null) {
        const cardView = document.getElementById('cardView');
        const tableBody = document.getElementById('documentTableBody');
        const emptyState = document.getElementById('notdocumentfound');

        try {
            // Show loading state
            this.showStorageLoading();

            let documents = [];
            let folders = [];

            if (storage === 'native') {
                // Load native documents using the main app logic to support hierarchy/folders
                if (typeof window.loadFolderContent === 'function') {
                    window.loadFolderContent(window.currentFolderId || null, window.isViewingTrash || false);
                } else {
                    const response = await fetch('/x_buck/api/documents');
                    if (response.ok) {
                        const data = await response.json();
                        documents = data.documents || [];
                        this.renderDocuments(documents);
                    }
                }
                this.hideStorageLoading();
                return; // Early return as loadFolderContent handles rendering
            } else {
                // Load cloud storage folder content (folders + files)
                const url = folderId
                    ? `/x_integ/storage/folder/${storage}/${encodeURIComponent(folderId)}`
                    : `/x_integ/storage/folder/${storage}`;

                const response = await fetch(url);
                if (response.ok) {
                    const data = await response.json();
                    folders = data.folders || [];
                    documents = data.files || [];
                } else if (response.status === 401) {
                    this.showError('Authentication expired. Please reconnect to this storage.');
                    this.updateStorageIcon(storage, 'disconnected');
                    return;
                }
            }

            // Store for navigation and stats
            this.cloudFolderId = folderId;
            this.currentFiles = documents;
            this.currentFolders = folders;

            this.hideStorageLoading();
            this.renderCloudContent(folders, documents);
            this.renderCloudBreadcrumbs();
            this.checkEmptyState(documents.length === 0 && folders.length === 0);

        } catch (error) {
            console.error('Error loading storage content:', error);
            this.hideStorageLoading();
            this.showStorageError(`Failed to load files from ${this.getProviderDisplayName(storage)}`);
        }
    }

    // Navigate to a cloud folder
    async openCloudFolder(folderId, folderName) {
        // Add to breadcrumbs
        this.cloudBreadcrumbs.push({ id: folderId, name: folderName });
        // Load folder content
        await this.loadStorageContent(this.currentStorage, folderId);
    }

    // Navigate back via breadcrumb
    async navigateCloudBreadcrumb(index) {
        // Truncate breadcrumbs to clicked position
        this.cloudBreadcrumbs = this.cloudBreadcrumbs.slice(0, index + 1);
        const target = this.cloudBreadcrumbs[index];
        // Load that folder
        await this.loadStorageContent(this.currentStorage, target.id);
    }

    // Render cloud breadcrumbs
    renderCloudBreadcrumbs() {
        const breadcrumbContainer = document.getElementById('dm-breadcrumbs');
        if (!breadcrumbContainer || this.currentStorage === 'native') return;

        breadcrumbContainer.innerHTML = this.cloudBreadcrumbs.map((crumb, index) => {
            const isLast = index === this.cloudBreadcrumbs.length - 1;
            return `
                <li class="breadcrumb-item ${isLast ? 'active' : ''}" 
                    ${!isLast ? `onclick="window.storageManager.navigateCloudBreadcrumb(${index})"` : ''}>
                    ${index === 0 ? `<i class="bi bi-cloud"></i>` : ''}
                    ${crumb.name}
                </li>
            `;
        }).join('');
    }

    // Render cloud content (folders + files)
    renderCloudContent(folders, files) {
        const cardView = document.getElementById('cardView');
        const tableBody = document.getElementById('documentTableBody');

        // Clear existing content
        if (cardView) cardView.innerHTML = '';
        if (tableBody) tableBody.innerHTML = '';

        // Render folders first
        folders.forEach(folder => {
            if (cardView) {
                cardView.appendChild(this.createCloudFolderCard(folder));
            }
            if (tableBody) {
                tableBody.appendChild(this.createCloudFolderRow(folder));
            }
        });

        // Then render files
        files.forEach((doc, index) => {
            if (cardView) {
                cardView.appendChild(this.createCardElement(doc));
            }
            if (tableBody) {
                tableBody.appendChild(this.createTableRowElement(doc, index + 1));
            }
        });

        // Setup event listeners
        this.setupDocumentEventListeners();
    }

    // Create folder card for cloud storage
    createCloudFolderCard(folder) {
        const cardDiv = document.createElement('div');
        cardDiv.className = 'document-card folder-card';
        cardDiv.dataset.id = folder.id || '';
        cardDiv.dataset.type = 'folder';
        cardDiv.dataset.provider = folder.provider || this.currentStorage;

        const folderName = folder.name || '';

        // Build menu content for folders
        let menuContent = `
            <div class="dropdown-item" onclick="event.stopPropagation(); window.storageManager.openCloudFolder('${folder.id}', '${folderName.replace(/'/g, "\\'")}')">
                <i class="bi bi-folder2-open"></i> Open
            </div>
            <div class="dropdown-divider"></div>
            <div class="dropdown-item" onclick="event.stopPropagation(); window.openCloudShareModal({id: '${folder.id}', name: '${folderName.replace(/'/g, "\\'")}'}, 'folder')">
                <i class="bi bi-share"></i> Share
            </div>
            <div class="dropdown-item" onclick="event.stopPropagation(); window.openCloudLinkModal({id: '${folder.id}', name: '${folderName.replace(/'/g, "\\'")}'}, 'folder')">
                <i class="bi bi-link-45deg"></i> Get Link
            </div>
            <div class="dropdown-divider"></div>
            <div class="dropdown-item" onclick="event.stopPropagation(); window.openCloudRenameModal({id: '${folder.id}', name: '${folderName.replace(/'/g, "\\'")}'}, 'folder')">
                <i class="bi bi-pencil"></i> Rename
            </div>
            <div class="dropdown-item" onclick="event.stopPropagation(); window.openCloudFolderPicker({id: '${folder.id}', name: '${folderName.replace(/'/g, "\\'")}'}, 'folder')">
                <i class="bi bi-arrows-move"></i> Move to...
            </div>
            <div class="dropdown-divider"></div>
            <div class="dropdown-item text-danger" onclick="event.stopPropagation(); window.openCloudDeleteModal({id: '${folder.id}', name: '${folderName.replace(/'/g, "\\'")}'}, 'folder')">
                <i class="bi bi-trash"></i> Delete
            </div>
        `;

        cardDiv.innerHTML = `
            <div class="card-menu">
                <button class="card-menu-btn" onclick="event.stopPropagation(); this.nextElementSibling.classList.toggle('active')">
                    <i class="bi bi-three-dots-vertical"></i>
                </button>
                <div class="card-dropdown">
                    ${menuContent}
                </div>
            </div>
            <div class="card-icon"><i class="bi bi-folder-fill text-warning" style="font-size: 2.5rem;"></i></div>
            <div class="card-info">
                <h3 class="card-title" title="${folderName}">${folderName}</h3>
                <p class="card-meta">Folder</p>
            </div>
        `;

        cardDiv.addEventListener('dblclick', () => {
            this.openCloudFolder(folder.id, folder.name);
        });
        cardDiv.addEventListener('click', () => {
            this.openCloudFolder(folder.id, folder.name);
        });

        return cardDiv;
    }

    // Create folder row for cloud storage list view
    createCloudFolderRow(folder) {
        const rowDiv = document.createElement('div');
        rowDiv.className = 'table-row folder-row';
        rowDiv.dataset.id = folder.id || '';
        rowDiv.dataset.provider = folder.provider || this.currentStorage;

        rowDiv.innerHTML = `
            <div class="table-cell">
                <div class="doc-name-cell">
                    <i class="bi bi-folder-fill text-warning me-2"></i>
                    <span>${folder.name}</span>
                </div>
            </div>
            <div class="table-cell">-</div>
            <div class="table-cell">-</div>
            <div class="table-cell">
                <button class="btn btn-sm btn-outline-primary" onclick="window.storageManager.openCloudFolder('${folder.id}', '${folder.name.replace(/'/g, "\\'")}')">
                    Open
                </button>
            </div>
        `;

        rowDiv.addEventListener('dblclick', () => {
            this.openCloudFolder(folder.id, folder.name);
        });

        return rowDiv;
    }

    renderDocuments(documents) {
        const cardView = document.getElementById('cardView');
        const tableBody = document.getElementById('documentTableBody');

        // Clear existing content
        if (cardView) cardView.innerHTML = '';
        if (tableBody) tableBody.innerHTML = '';

        if (documents.length === 0) return;

        documents.forEach((doc, index) => {
            if (cardView) {
                cardView.appendChild(this.createCardElement(doc));
            }
            if (tableBody) {
                tableBody.appendChild(this.createTableRowElement(doc, index + 1));
            }
        });

        // Setup event listeners for document elements
        this.setupDocumentEventListeners();
    }

    createCardElement(doc) {
        const cardDiv = document.createElement('div');
        cardDiv.className = 'document-card';
        cardDiv.dataset.id = doc.id || '';
        cardDiv.dataset.type = 'file';
        cardDiv.dataset.provider = doc.provider || 'native';

        const fileName = doc.name || doc.title || '';

        // Build menu content based on provider
        let menuContent = '';

        // View option (for all)
        if (doc.download_url || doc.url) {
            menuContent += `
            <div class="dropdown-item" onclick="event.stopPropagation(); window.handleDocumentAction('view', {url: '${doc.download_url || doc.url || ''}', name: '${fileName.replace(/'/g, "\\'")}'})">
                <i class="bi bi-eye"></i> View
            </div>`;
        }

        // Download option (for all with URL)
        if (doc.download_url || doc.url) {
            menuContent += `
            <div class="dropdown-item" onclick="event.stopPropagation(); window.location.href='${doc.download_url || doc.url}'">
                <i class="bi bi-download"></i> Download
            </div>`;
        }

        // Cloud storage specific options
        if (doc.provider && doc.provider !== 'native') {
            menuContent += `
            <div class="dropdown-divider"></div>
            <div class="dropdown-item" onclick="event.stopPropagation(); window.openCloudShareModal({id: '${doc.id}', name: '${fileName.replace(/'/g, "\\'")}', provider: '${doc.provider}'}, 'file')">
                <i class="bi bi-share"></i> Share
            </div>
            <div class="dropdown-item" onclick="event.stopPropagation(); window.openCloudLinkModal({id: '${doc.id}', name: '${fileName.replace(/'/g, "\\'")}', provider: '${doc.provider}'}, 'file')">
                <i class="bi bi-link-45deg"></i> Get Link
            </div>
            <div class="dropdown-divider"></div>
            <div class="dropdown-item" onclick="event.stopPropagation(); window.openCloudRenameModal({id: '${doc.id}', name: '${fileName.replace(/'/g, "\\'")}', provider: '${doc.provider}'}, 'file')">
                <i class="bi bi-pencil"></i> Rename
            </div>
            <div class="dropdown-item" onclick="event.stopPropagation(); window.openCloudFolderPicker({id: '${doc.id}', name: '${fileName.replace(/'/g, "\\'")}', provider: '${doc.provider}'}, 'file')">
                <i class="bi bi-arrows-move"></i> Move to...
            </div>
            <div class="dropdown-divider"></div>
            <div class="dropdown-item text-danger" onclick="event.stopPropagation(); window.openCloudDeleteModal({id: '${doc.id}', name: '${fileName.replace(/'/g, "\\'")}', provider: '${doc.provider}'}, 'file')">
                <i class="bi bi-trash"></i> Delete
            </div>`;

        } else if (doc.id && !doc.provider) {
            // Native storage delete option
            menuContent += `
            <div class="dropdown-item text-danger" onclick="event.stopPropagation(); window.openDeleteModal(${doc.id}, 'file')">
                <i class="bi bi-trash"></i> Delete
            </div>`;
        }

        // Details option (for all)
        menuContent += `
            <div class="dropdown-divider"></div>
            <div class="dropdown-item" onclick="event.stopPropagation(); window.storageManager.showSidePanel({id: '${doc.id || ''}', title: '${fileName.replace(/'/g, "\\'")}', size: ${doc.size || 0}, modified: '${doc.modified || doc.last_modified || ''}', provider: '${doc.provider || 'native'}'}, 'file')">
                <i class="bi bi-info-circle"></i> Details
            </div>
        `;

        const providerIcon = this.getProviderIconURL(doc.provider || 'native');
        const providerIconHtml = providerIcon ? `<img src="${providerIcon}" alt="" style="width: 12px; height: 12px; vertical-align: middle; margin-right: 4px;">` : '';

        cardDiv.innerHTML = `
            <div class="card-menu">
                <button class="card-menu-btn" onclick="event.stopPropagation(); this.nextElementSibling.classList.toggle('active')">
                    <i class="bi bi-three-dots-vertical"></i>
                </button>
                <div class="card-dropdown">
                    ${menuContent}
                </div>
            </div>
            <div class="card-icon">${this.getFileIconSVG(fileName)}</div>
            <div class="card-info">
                <h3 class="card-title" title="${fileName}">${fileName}</h3>
                <p class="card-meta">${this.formatSize(doc.size)} • ${providerIconHtml}</p>
            </div>
        `;

        cardDiv.addEventListener('click', () => {
            if (window.selectItem) {
                const item = {
                    ...doc,
                    original_filename: fileName,
                    created_at: doc.modified || doc.last_modified || new Date().toISOString(),
                    mime_type: 'Cloud File'
                };
                window.selectItem(item, 'file');
            }
        });

        return cardDiv;
    }

    createTableRowElement(doc, index) {
        const rowDiv = document.createElement('div');
        rowDiv.className = 'table-row document-item';
        rowDiv.dataset.id = doc.id || '';
        rowDiv.dataset.provider = doc.provider || 'native';

        const fileName = doc.name || doc.title || '';

        rowDiv.innerHTML = `
            <div class="table-cell">
                <div class="doc-name-cell">
                    <span class="me-2 d-flex align-items-center">${this.getFileIconSVG(fileName)}</span>
                    <span>${fileName}</span>
                </div>
            </div>
            <div class="table-cell">${this.formatSize(doc.size)}</div>
            <div class="table-cell">${this.formatDate(doc.modified || doc.last_modified || doc.created_at)}</div>
            <div class="table-cell">
                <div class="btn-group">
                    ${doc.download_url || doc.url ? `<button class="btn btn-sm btn-outline-primary" onclick="event.stopPropagation(); window.handleDocumentAction('view', {url: '${doc.download_url || doc.url}', name: '${fileName.replace(/'/g, "\\'")}'})" title="View"><i class="bi bi-eye"></i></button>` : ''}
                    ${doc.download_url || doc.url ? `<a class="btn btn-sm btn-outline-success" href="${doc.download_url || doc.url}" download title="Download"><i class="bi bi-download"></i></a>` : ''}
                    ${doc.id && !doc.provider ? `<button class="btn btn-sm btn-outline-danger" onclick="event.stopPropagation(); window.openDeleteModal(${doc.id}, 'file')" title="Delete"><i class="bi bi-trash"></i></button>` : ''}
                    <button class="btn btn-sm btn-outline-secondary" onclick="event.stopPropagation(); window.storageManager.showSidePanel({id: '${doc.id || ''}', title: '${fileName.replace(/'/g, "\\'")}', size: ${doc.size || 0}, modified: '${doc.modified || doc.last_modified || ''}', provider: '${doc.provider || 'native'}'}, 'file')" title="Details"><i class="bi bi-info-circle"></i></button>
                </div>
            </div>
        `;

        rowDiv.addEventListener('click', () => {
            if (window.selectItem) {
                const item = {
                    ...doc,
                    original_filename: fileName,
                    created_at: doc.modified || doc.last_modified || new Date().toISOString(),
                    mime_type: 'Cloud File'
                };
                window.selectItem(item, 'file');
            }
        });

        return rowDiv;
    }

    setupDocumentEventListeners() {
        // This will be called from the main document manager
        if (window.setupDocumentEventListeners) {
            window.setupDocumentEventListeners();
        }
    }

    showConnectionLoading(provider) {
        if (!this.loadingModal) return;

        const title = document.getElementById('loadingTitle');
        const message = document.getElementById('loadingMessage');

        if (title) title.textContent = `Connecting to ${this.getProviderDisplayName(provider)}...`;
        if (message) message.textContent = 'You will be redirected to authorize access';

        this.loadingModal.classList.add('active');
        this.updateStorageIcon(provider, 'connecting');
    }

    hideConnectionLoading() {
        if (this.loadingModal) {
            this.loadingModal.classList.remove('active');
        }
    }

    showStorageLoading() {
        const cardView = document.getElementById('cardView');
        const tableBody = document.getElementById('documentTableBody');
        const emptyState = document.getElementById('notdocumentfound');

        if (emptyState) emptyState.style.display = 'none';

        const loadingHTML = `
            <div class="storage-loading">
                <div class="spinner"></div>
                <span>Loading files...</span>
            </div>
        `;

        if (cardView) cardView.innerHTML = loadingHTML;
        if (tableBody) tableBody.innerHTML = '';
    }

    hideStorageLoading() {
        // Content will be replaced by renderDocuments
    }

    showStorageError(message) {
        const cardView = document.getElementById('cardView');
        const errorHTML = `
            <div class="storage-error">
                <i class="bi bi-exclamation-triangle"></i>
                <h4>Error Loading Files</h4>
                <p>${message}</p>
            </div>
        `;

        if (cardView) cardView.innerHTML = errorHTML;
    }

    checkEmptyState(isEmpty) {
        const emptyState = document.getElementById('notdocumentfound');
        const cardViewContainer = document.getElementById('card-view');
        const listViewContainer = document.getElementById('list-view');
        const explorerLayout = document.querySelector('.dm-explorer-layout');
        const controlsContainer = document.querySelector('.controls-container');

        if (!emptyState) return;

        if (isEmpty) {
            // Hide explorer layout and controls when empty
            if (explorerLayout) explorerLayout.style.display = 'none';
            if (controlsContainer) controlsContainer.style.display = 'none';

            // Show the main empty state container
            emptyState.style.display = 'flex';
            emptyState.classList.remove('hidden');

            if (cardViewContainer) cardViewContainer.classList.add('hidden');
            if (listViewContainer) listViewContainer.classList.add('hidden');
        } else {
            // Show explorer layout and controls when has content
            if (explorerLayout) explorerLayout.style.display = 'flex';
            if (controlsContainer) controlsContainer.style.display = 'flex';

            // Hide the main empty state container
            emptyState.style.display = 'none';
            emptyState.classList.add('hidden');

            // Use current view state from global toggle buttons
            const activeView = document.querySelector('.toggle-btn.active')?.getAttribute('data-view') || 'card';

            if (activeView === 'card') {
                if (cardViewContainer) cardViewContainer.classList.remove('hidden');
                if (listViewContainer) listViewContainer.classList.add('hidden');
            } else {
                if (cardViewContainer) cardViewContainer.classList.add('hidden');
                if (listViewContainer) listViewContainer.classList.remove('hidden');
            }
        }
    }

    // Utility methods
    getProviderDisplayName(provider) {
        const names = {
            'google_drive': 'Google Drive',
            'dropbox': 'Dropbox',
            'box': 'Box',
            'pcloud': 'pCloud',
            'mega': 'MEGA',
            'yandex': 'Yandex Disk',
            'native': 'My Documents'
        };
        return names[provider] || provider.charAt(0).toUpperCase() + provider.slice(1);
    }

    getProviderIcon(provider) {
        const icons = {
            'google_drive': 'bi bi-google',
            'dropbox': 'bi bi-dropbox',
            'box': 'bi bi-box',
            'pcloud': 'bi bi-cloud',
            'mega': 'bi bi-shield-lock',
            'yandex': 'bi bi-globe',
            'native': 'bi bi-hdd'
        };
        return icons[provider] || 'bi bi-folder';
    }

    getProviderIconURL(provider) {
        const icons = {
            'google_drive': '/static/img/svg/google-drive.svg',
            'dropbox': '/static/img/svg/dropbox.svg',
            'box': '/static/img/svg/box.svg',
            'pcloud': '/static/img/svg/pcloud.svg',
            'mega': '/static/img/svg/mega.svg',
            'yandex': '/static/img/svg/yandex.svg',
            'native': ''
        };
        return icons[provider] || '';
    }

    getFileIconSVG(name) {
        if (!name) return '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" fill="currentColor" class="bi bi-file-earmark text-secondary" viewBox="0 0 16 16"><path d="M14 4.5V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2h5.5zm-3 0A1.5 1.5 0 0 1 9.5 3V1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4.5z"/></svg>';
        const ext = name.split('.').pop().toLowerCase();

        const svgs = {
            doc: `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" fill="currentColor" class="bi bi-filetype-doc text-primary" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M14 4.5V14a2 2 0 0 1-2 2v-1a1 1 0 0 0 1-1V4.5h-2A1.5 1.5 0 0 1 9.5 3V1H4a1 1 0 0 0-1 1v9H2V2a2 2 0 0 1 2-2h5.5zm-7.839 9.166v.522q0 .384-.117.641a.86.86 0 0 1-.322.387.9.9 0 0 1-.469.126.9.9 0 0 1-.471-.126.87.87 0 0 1-.32-.386 1.55 1.55 0 0 1-.117-.642v-.522q0-.386.117-.641a.87.87 0 0 1 .32-.387.87.87 0 0 1 .471-.129q.264 0 .469.13a.86.86 0 0 1 .322.386q.117.255.117.641m.803.519v-.513q0-.565-.205-.972a1.46 1.46 0 0 0-.589-.63q-.381-.22-.917-.22-.533 0-.92.22a1.44 1.44 0 0 0-.589.627q-.204.406-.205.975v.513q0 .563.205.973.205.406.59.627.386.216.92.216.535 0 .916-.216.383-.22.59-.627.204-.41.204-.973M0 11.926v4h1.459q.603 0 .999-.238a1.45 1.45 0 0 0 .595-.689q.196-.45.196-1.084 0-.63-.196-1.075a1.43 1.43 0 0 0-.59-.68q-.395-.234-1.004-.234zm.791.645h.563q.371 0 .609.152a.9.9 0 0 1 .354.454q.118.302.118.753a2.3 2.3 0 0 1-.068.592 1.1 1.1 0 0 1-.196.422.8.8 0 0 1-.334.252 1.3 1.3 0 0 1-.483.082H.79V12.57Zm7.422.483a1.7 1.7 0 0 0-.103.633v.495q0 .369.103.627a.83.83 0 0 0 .298.393.85.85 0 0 0 .478.131.9.9 0 0 0 .401-.088.7.7 0 0 0 .273-.248.8.8 0 0 0 .117-.364h.765v.076a1.27 1.27 0 0 1-.226.674q-.205.29-.55.454a1.8 1.8 0 0 1-.786.164q-.54 0-.914-.216a1.4 1.4 0 0 1-.571-.627q-.194-.408-.194-.976v-.498q0-.568.197-.978.195-.411.571-.633.378-.223.911-.223.328 0 .607.097.28.093.489.272a1.33 1.33 0 0 1 .466.964v.073H9.78a.85.85 0 0 0-.12-.38.7.7 0 0 0-.273-.261.8.8 0 0 0-.398-.097.8.8 0 0 0-.475.138.87.87 0 0 0-.301.398"/></svg>`,
            docx: `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" fill="currentColor" class="bi bi-filetype-docx text-primary" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M14 4.5V11h-1V4.5h-2A1.5 1.5 0 0 1 9.5 3V1H4a1 1 0 0 0-1 1v9H2V2a2 2 0 0 1 2-2h5.5zm-6.839 9.688v-.522a1.5 1.5 0 0 0-.117-.641.86.86 0 0 0-.322-.387.86.86 0 0 0-.469-.129.87.87 0 0 0-.471.13.87.87 0 0 0-.32.386 1.5 1.5 0 0 0-.117.641v.522q0 .384.117.641a.87.87 0 0 0 .32.387.9.9 0 0 0 .471.126.9.9 0 0 0 .469-.126.86.86 0 0 0 .322-.386 1.55 1.55 0 0 0 .117-.642m.803-.516v.513q0 .563-.205.973a1.47 1.47 0 0 1-.589.627q-.381.216-.917.216a1.86 1.86 0 0 1-.92-.216 1.46 1.46 0 0 1-.589-.627 2.15 2.15 0 0 1-.205-.973v-.513q0-.569.205-.975.205-.411.59-.627.386-.22.92-.22.535 0 .916.22.383.219.59.63.204.406.204.972M1 15.925v-3.999h1.459q.609 0 1.005.235.396.233.589.68.196.445.196 1.074 0 .634-.196 1.084-.197.451-.595.689-.396.237-.999.237zm1.354-3.354H1.79v2.707h.563q.277 0 .483-.082a.8.8 0 0 0 .334-.252q.132-.17.196-.422a2.3 2.3 0 0 0 .068-.592q0-.45-.118-.753a.9.9 0 0 0-.354-.454q-.237-.152-.61-.152Zm6.756 1.116q0-.373.103-.633a.87.87 0 0 1 .301-.398.8.8 0 0 1 .475-.138q.225 0 .398.097a.7.7 0 0 1 .273.26.85.85 0 0 1 .12.381h.765v-.073a1.33 1.33 0 0 0-.466-.964 1.4 1.4 0 0 0-.49-.272 1.8 1.8 0 0 0-.606-.097q-.534 0-.911.223-.375.222-.571.633-.197.41-.197.978v.498q0 .568.194.976.195.406.571.627.375.216.914.216q.44 0 .785-.164t.551-.454a1.27 1.27 0 0 0 .226-.674v-.076h-.765a.8.8 0 0 1-.117.364.7.7 0 0 1-.273.248.9.9 0 0 1-.401.088.85.85 0 0 1-.478-.131.83.83 0 0 1-.298-.393 1.7 1.7 0 0 1-.103-.627zm5.092-1.76h.894l-1.275 2.006 1.254 1.992h-.908l-.85-1.415h-.035l-.852 1.415h-.862l1.24-2.015-1.228-1.984h.932l.832 1.439h.035z"/></svg>`,
            pdf: `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" fill="currentColor" class="bi bi-filetype-pdf text-danger" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M14 4.5V14a2 2 0 0 1-2 2h-1v-1h1a1 1 0 0 0 1-1V4.5h-2A1.5 1.5 0 0 1 9.5 3V1H4a1 1 0 0 0-1 1v9H2V2a2 2 0 0 1 2-2h5.5zM1.6 11.85H0v3.999h.791v-1.342h.803q.43 0 .732-.173.305-.175.463-.474a1.4 1.4 0 0 0 .161-.677q0-.375-.158-.677a1.2 1.2 0 0 0-.46-.477q-.3-.18-.732-.179m.545 1.333a.8.8 0 0 1-.085.38.57.57 0 0 1-.238.241.8.8 0 0 1-.375.082H.788V12.48h.66q.327 0 .512.181.185.183.185.522m1.217-1.333v3.999h1.46q.602 0 .998-.237a1.45 1.45 0 0 0 .595-.689q.196-.45.196-1.084 0-.63-.196-1.075a1.43 1.43 0 0 0-.589-.68q-.396-.234-1.005-.234zm.791.645h.563q.371 0 .609.152a.9.9 0 0 1 .354.454q.118.302.118.753a2.3 2.3 0 0 1-.068.592 1.1 1.1 0 0 1-.196.422.8.8 0 0 1-.334.252 1.3 1.3 0 0 1-.483.082h-.563zm3.743 1.763v1.591h-.79V11.85h2.548v.653H7.896v1.117h1.606v.638z"/></svg>`,
            ppt: `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" fill="currentColor" class="bi bi-filetype-ppt text-warning" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M14 4.5V14a2 2 0 0 1-2 2h-1v-1h1a1 1 0 0 0 1-1V4.5h-2A1.5 1.5 0 0 1 9.5 3V1H4a1 1 0 0 0-1 1v9H2V2a2 2 0 0 1 2-2h5.5zM1.6 11.85H0v3.999h.791v-1.342h.803q.43 0 .732-.173.305-.175.463-.474a1.4 1.4 0 0 0 .161-.677q0-.375-.158-.677a1.2 1.2 0 0 0-.46-.477q-.3-.18-.732-.179m.545 1.333a.8.8 0 0 1-.085.38.57.57 0 0 1-.238.241.8.8 0 0 1-.375.082H.788V12.48h.66q.327 0 .512.181.185.183.185.522m2.817-1.333h-1.6v3.999h.791v-1.342h.803q.43 0 .732-.173.305-.175.463-.474.162-.302.161-.677 0-.375-.158-.677a1.2 1.2 0 0 0-.46-.477q-.3-.18-.732-.179m.545 1.333a.8.8 0 0 1-.085.38.57.57 0 0 1-.238.241.8.8 0 0 1-.375.082H4.15V12.48h.66q.327 0 .512.181.185.183.185.522m2.767-.67v3.336H7.48v-3.337H6.346v-.662h3.065v.662z"/></svg>`,
            pptx: `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" fill="currentColor" class="bi bi-filetype-pptx text-warning" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M14 4.5V11h-1V4.5h-2A1.5 1.5 0 0 1 9.5 3V1H4a1 1 0 0 0-1 1v9H2V2a2 2 0 0 1 2-2h5.5zM1.5 11.85h1.6q.434 0 .732.179.302.175.46.477t.158.677-.16.677q-.159.299-.464.474a1.45 1.45 0 0 1-.732.173H2.29v1.342H1.5zm2.06 1.714a.8.8 0 0 0 .085-.381q0-.34-.185-.521-.185-.182-.513-.182h-.659v1.406h.66a.8.8 0 0 0 .374-.082.57.57 0 0 0 .238-.24m1.302-1.714h1.6q.434 0 .732.179.302.175.46.477t.158.677-.16.677q-.158.299-.464.474a1.45 1.45 0 0 1-.732.173h-.803v1.342h-.79zm2.06 1.714a.8.8 0 0 0 .085-.381q0-.34-.185-.521-.184-.182-.513-.182H5.65v1.406h.66a.8.8 0 0 0 .374-.082.57.57 0 0 0 .238-.24m2.852 2.285v-3.337h1.137v-.662H7.846v.662H8.98v3.337zm3.796-3.999h.893l-1.274 2.007 1.254 1.992h-.908l-.85-1.415h-.035l-.853 1.415h-.861l1.24-2.016-1.228-1.983h.931l.832 1.439h.035z"/></svg>`,
            txt: `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" fill="currentColor" class="bi bi-filetype-txt text-secondary" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M14 4.5V14a2 2 0 0 1-2 2h-2v-1h2a1 1 0 0 0 1-1V4.5h-2A1.5 1.5 0 0 1 9.5 3V1H4a1 1 0 0 0-1 1v9H2V2a2 2 0 0 1 2-2h5.5zM1.928 15.849v-3.337h1.136v-.662H0v.662h1.134v3.337zm4.689-3.999h-.894L4.9 13.289h-.035l-.832-1.439h-.932l1.228 1.983-1.24 2.016h.862l.853-1.415h.035l.85 1.415h.907l-1.253-1.992zm1.93.662v3.337h-.794v-3.337H6.619v-.662h3.064v.662H8.546Z"/></svg>`
        };

        return svgs[ext] || `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" fill="currentColor" class="bi bi-file-earmark text-secondary" viewBox="0 0 16 16"><path d="M14 4.5V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2h5.5zm-3 0A1.5 1.5 0 0 1 9.5 3V1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4.5z"/></svg>`;
    }

    getFileIconClass(name) {
        if (!name) return 'bi-file-earmark';
        const ext = name.split('.').pop().toLowerCase();
        const icons = {
            pdf: 'bi-file-earmark-pdf text-danger',
            doc: 'bi-file-earmark-word text-primary',
            docx: 'bi-file-earmark-word text-primary',
            txt: 'bi-file-earmark-text'
        };
        return icons[ext] || 'bi-file-earmark';
    }

    formatSize(bytes) {
        if (!bytes || bytes === 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB'];
        let i = 0;
        while (bytes >= 1024 && i < units.length - 1) {
            bytes /= 1024;
            i++;
        }
        return bytes.toFixed(2) + ' ' + units[i];
    }

    formatDate(dateString) {
        if (!dateString) return '';
        return new Date(dateString).toLocaleString('sv-SE').replace('T', ' ');
    }

    truncateText(text, length) {
        if (!text) return '';
        return text.length > length ? text.substring(0, length) + '...' : text;
    }

    showSuccess(message) {
        if (window.showSuccess) {
            window.showSuccess(message);
        } else {
            console.log('Success:', message);
        }
    }

    showError(message) {
        if (window.showError) {
            window.showError(message);
        } else {
            console.error('Error:', message);
        }
    }

    showSidePanel(item, type) {
        // Map storage item to expected format for Rich Details
        const mappedItem = {
            name: item.name || item.title || item.original_filename,
            original_filename: item.original_filename,
            status: 'Active',
            mime_type: item.mime_type || 'application/octet-stream',
            size: item.size,
            modified: item.modified || item.created_at,
            provider: item.provider || this.currentStorage,
            url: item.download_url || item.url || item.webViewLink, // webViewLink for Google Drive
            download_url: item.download_url
        };

        if (window.openRichDetails) {
            window.openRichDetails(mappedItem, type);
        } else {
            console.error('openRichDetails not found');
        }

        // Hide Stats panel if open
        const statsPanel = document.getElementById('stats-panel');
        if (statsPanel && !statsPanel.classList.contains('hidden')) {
            statsPanel.classList.add('hidden');
        }
    }

    // --- Stats Panel Logic ---
    toggleStatsPanel() {
        const panel = document.getElementById('stats-panel');
        if (!panel) return;

        if (panel.classList.contains('hidden')) {
            // Close other panels
            const contextPanel = document.getElementById('context-panel');
            if (contextPanel) contextPanel.classList.add('hidden');

            panel.classList.remove('hidden');
            this.updateStatsPanel();
        } else {
            panel.classList.add('hidden');
        }
    }



    async updateStatsPanel() {
        const provider = this.currentStorage;

        // Update Header
        document.getElementById('stats-provider-name').textContent = this.getProviderDisplayName(provider);
        const iconContainer = document.getElementById('stats-provider-icon');
        const iconUrl = this.getProviderIconURL(provider);

        const accountInfo = document.getElementById('stats-account-info');
        // Update account info based on context (simplified for now, ideally fetched from provider metadata)
        if (provider === 'native') {
            accountInfo.textContent = currentUserData.email;
            accountInfo.title = currentUserData.email; // Tooltip for truncation
        } else {
            // For cloud, we might want to store/fetch the connected account email
            accountInfo.textContent = `Linked ${this.getProviderDisplayName(provider)} Account`;
            accountInfo.title = "";
        }

        if (iconUrl) {
            iconContainer.innerHTML = `<img src="${iconUrl}" alt="${provider}">`;
        } else {
            iconContainer.innerHTML = `<i class="${this.getProviderIcon(provider)}"></i>`;
        }

        // Calculate Stats
        let stats = null;
        if (provider === 'native') {
            stats = await this.fetchNativeStats();
        } else {
            stats = await this.fetchCloudStats(provider);
        }

        this.renderStats(stats);
    }

    async fetchNativeStats() {
        console.log('Fetching native stats...');
        try {
            const response = await fetch('/storage_info');
            console.log('Native stats response:', response.status);
            if (response.ok) {
                const data = await response.json();
                console.log('Native stats data:', data);
                // If backend returns 0 total, fallback to plan-based quota
                if (data.total_storage === 0) {
                    return this.getPlanQuotaStats(data);
                }
                return data;
            } else {
                console.warn('Native stats fetch failed:', response.statusText);
            }
        } catch (e) {
            console.error('Error fetching native stats:', e);
        }
        console.log('Falling back to local stats calculation');
        return this.calculateLocalStats(true); // Fallback to calculate from visible files with plan quota
    }

    async fetchCloudStats(provider) {
        console.log(`Fetching cloud stats for ${provider}...`);
        // First, calculate stats from visible files (for file types distribution)
        const localStats = this.calculateLocalStats(false);

        try {
            // Fetch real quota from backend
            const response = await fetch(`/x_integ/storage/usage/${provider}`);
            console.log(`Cloud stats response for ${provider}:`, response.status);

            if (response.ok) {
                const quota = await response.json();
                console.log(`Cloud quota for ${provider}:`, quota);

                if (quota.error) {
                    console.error(`Backend reported error for ${provider}:`, quota.error);
                    // Optionally show a toast?
                    // showAlert(`Failed to refresh ${this.getProviderDisplayName(provider)} stats: ${quota.error}`, 'warning');
                }

                // If backend returns valid (>0) total storage, use it
                if (quota.total_storage > 0) {
                    return {
                        ...localStats,
                        used_storage: quota.used_storage,
                        total_storage: quota.total_storage,
                        error: quota.error
                    };
                }
            } else {
                console.warn(`Cloud stats fetch failed for ${provider}:`, response.statusText);
            }
        } catch (e) {
            console.error(`Error fetching stats for ${provider}:`, e);
        }

        // Fallback: Use local file list sum + mock total
        return localStats;
    }

    // Helper: Format Size
    formatSize(bytes) {
        if (typeof window.formatSize === 'function') return window.formatSize(bytes);
        if (!bytes || bytes === 0) return '0 B';
        if (bytes < 0) return '0 B';

        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
        let i = Math.floor(Math.log(bytes) / Math.log(k));

        // Ensure index doesn't exceed array bounds
        if (i >= sizes.length) i = sizes.length - 1;
        if (i < 0) i = 0;

        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    getPlanQuotaStats(backendStats) {
        // Define quotas based on plan (bytes)
        const quotas = {
            'Starter': 1 * 1024 * 1024 * 1024,      // 1GB
            'Pro': 10 * 1024 * 1024 * 1024,         // 10GB
            'Enterprise': 100 * 1024 * 1024 * 1024  // 100GB
        };

        // Safety check for currentUserData
        const userPlan = (typeof currentUserData !== 'undefined' && currentUserData.plan) ? currentUserData.plan : 'Starter';
        const total = quotas[userPlan] || quotas['Starter'];

        // Use backend used_storage if available, else calculate from DOM
        let used = backendStats && backendStats.used_storage ? backendStats.used_storage : this.calculateUsedFromDOM();

        return {
            used_storage: used,
            total_storage: total,
            files_count: backendStats ? backendStats.files_count : 0,
            file_types: backendStats && backendStats.file_types ? backendStats.file_types : this.calculateTypesFromDOM()
        };
    }

    renderStats(stats) {
        if (!stats) {
            console.warn('No stats to render');
            // Mock empty stats to prevent crash
            stats = { used_storage: 0, total_storage: 1, file_types: {} };
        }

        // Update Progress Bar
        let percent = 0;
        if (stats.total_storage > 0) {
            percent = Math.min(100, Math.round((stats.used_storage / stats.total_storage) * 100));
        }
        const progressBar = document.getElementById('stats-progress');
        const percentText = document.getElementById('stats-percentage');
        const usageText = document.getElementById('stats-usage-text');

        if (progressBar) progressBar.style.width = `${percent}%`;
        if (percentText) percentText.textContent = `${percent}%`;
        if (usageText) usageText.textContent = `${this.formatSize(stats.used_storage)} used of ${this.formatSize(stats.total_storage)}`;

        // Render Chart
        this.renderChart(stats.file_types || {});
    }

    calculateUsedFromDOM() {
        // Find both card and list items to be safer
        const cards = Array.from(document.querySelectorAll('.document-card'));
        const rows = Array.from(document.querySelectorAll('.table-row:not(.header-row)'));

        const items = cards.length > 0 ? cards : rows;

        return items.reduce((acc, item) => {
            let sizeText = '';
            if (cards.length > 0) {
                const meta = item.querySelector('.card-meta');
                sizeText = meta ? meta.textContent.split('•')[0].trim() : '0 B';
            } else {
                const sizeCell = item.querySelector('.table-cell:nth-child(2)');
                sizeText = sizeCell ? sizeCell.textContent.trim() : '0 B';
            }
            return acc + this.parseSize(sizeText);
        }, 0);
    }

    calculateTypesFromDOM() {
        const cards = Array.from(document.querySelectorAll('.document-card'));
        const rows = Array.from(document.querySelectorAll('.table-row:not(.header-row)'));
        const items = cards.length > 0 ? cards : rows;

        // Track by exact extension for granular colors
        const typeDistribution = { 'PDF': 0, 'DOC': 0, 'DOCX': 0, 'TXT': 0, 'EPUB': 0, 'PPT': 0, 'PPTX': 0, 'Other': 0 };

        items.forEach(item => {
            // Try to get filename from title or data-attribute
            let fileName = '';
            const titleEl = item.querySelector('.card-title, .doc-name-cell span:last-child');
            if (titleEl) {
                fileName = titleEl.textContent || titleEl.getAttribute('title') || '';
            }

            const type = this.getTypeFromFileName(fileName);
            typeDistribution[type] = (typeDistribution[type] || 0) + 1;
        });
        return typeDistribution;
    }

    calculateLocalStats(isNativeFallback = false) {
        // Calculate stats based on currently loaded documents
        const used = this.calculateUsedFromDOM();
        const types = this.calculateTypesFromFiles();
        const docsCount = this.currentFiles.length || document.querySelectorAll('.document-card').length;

        // Mock quota for cloud if unknown (15GB is common free tier for Google/others)
        let total = 15 * 1024 * 1024 * 1024;

        if (isNativeFallback) {
            const quotaStats = this.getPlanQuotaStats({ used_storage: used });
            total = quotaStats.total_storage;
        }

        return {
            used_storage: used,
            total_storage: total,
            files_count: docsCount,
            file_types: types
        };
    }

    calculateTypesFromFiles() {
        // Calculate from stored files if available, otherwise from DOM
        if (this.currentFiles && this.currentFiles.length > 0) {
            const typeDistribution = { 'PDF': 0, 'DOC': 0, 'DOCX': 0, 'TXT': 0, 'EPUB': 0, 'PPT': 0, 'PPTX': 0, 'Other': 0 };

            this.currentFiles.forEach(file => {
                const fileName = file.name || file.original_filename || '';
                const type = this.getTypeFromFileName(fileName);
                typeDistribution[type] = (typeDistribution[type] || 0) + 1;
            });

            return typeDistribution;
        }

        // Fallback to DOM calculation
        return this.calculateTypesFromDOM();
    }

    parseSize(sizeStr) {
        const units = { 'B': 1, 'KB': 1024, 'MB': 1024 * 1024, 'GB': 1024 * 1024 * 1024 };
        const parts = sizeStr.split(' ');
        if (parts.length !== 2) return 0;
        return parseFloat(parts[0]) * (units[parts[1]] || 1);
    }

    getTypeFromIcon(iconClass) {
        if (iconClass.includes('pdf')) return 'PDF';
        if (iconClass.includes('word')) return 'DOCX';
        if (iconClass.includes('text')) return 'TXT';
        if (iconClass.includes('audio') || iconClass.includes('epub')) return 'EPUB';
        if (iconClass.includes('powerpoint') || iconClass.includes('slides')) return 'PPTX';
        return 'Other';
    }

    getTypeFromFileName(fileName) {
        if (!fileName) return 'Other';
        const ext = fileName.split('.').pop().toLowerCase();
        switch (ext) {
            case 'pdf': return 'PDF';
            case 'doc': return 'DOC';
            case 'docx': return 'DOCX';
            case 'txt': return 'TXT';
            case 'epub': return 'EPUB';
            case 'ppt': return 'PPT';
            case 'pptx': return 'PPTX';
            case 'mobi': return 'Other';
            case 'rtf': return 'Other';
            default: return 'Other';
        }
    }


    renderChart(distribution) {
        const container = document.getElementById('file-distribution-chart');
        if (!container) return;

        container.innerHTML = ''; // Clear previous

        // Explicit Color Mapping as per user specification:
        // PDF: Rojo, DOC/DOCX: Azul, TXT: Gris, EPUB: Verde, PPT/PPTX: Naranja
        const colorMap = {
            'PDF': '#e53935',       // Red
            'DOC': '#1e88e5',       // Blue
            'DOCX': '#1976d2',      // Blue (slightly different shade)
            'TXT': '#757575',       // Grey
            'EPUB': '#43a047',      // Green
            'PPT': '#fb8c00',       // Orange
            'PPTX': '#f57c00',      // Orange (slightly different shade)
            'Other': '#bdbdbd'      // Light Grey
        };

        // Ensure "Other" exists
        if (!distribution['Other'] && Object.keys(distribution).length === 0) {
            distribution['Other'] = 0;
        }

        // Filter out zero-values to make the chart cleaner
        let categories = Object.keys(distribution).filter(key => distribution[key] > 0);

        // Ensure we have at least one category to show
        if (categories.length === 0) {
            categories = ['Other'];
            distribution['Other'] = 0.001; // Small value just to show the segment
        }

        const seriesData = categories.map(name => ({
            name: name,
            data: distribution[name]
        }));

        // Generate color array based on series order
        const chartColors = categories.map(name => colorMap[name] || colorMap['Other']);

        const data = {
            categories: ['File Types'],
            series: seriesData
        };

        const options = {
            chart: { width: 280, height: 280 },
            series: {
                dataLabels: { visible: true, pieSeriesName: { visible: true } }
            },
            legend: { visible: true, align: 'bottom' },
            theme: {
                series: {
                    colors: chartColors
                }
            }
        };

        if (typeof toastui !== 'undefined' && toastui.Chart) {
            toastui.Chart.pieChart({ el: container, data, options });
        }
    }

    // ============================================================
    // CLOUD STORAGE ACTIONS
    // ============================================================

    // Create new folder in cloud storage
    async createCloudFolder(folderName = null) {
        if (this.currentStorage === 'native') return;

        const name = folderName || prompt('Enter folder name:');
        if (!name || !name.trim()) return;

        try {
            const response = await fetch(`/x_integ/storage/folder/create/${this.currentStorage}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: name.trim(),
                    parent_id: this.cloudFolderId
                })
            });

            const result = await response.json();
            if (result.success) {
                this.showSuccess('Folder created successfully');
                await this.loadStorageContent(this.currentStorage, this.cloudFolderId);
            } else {
                this.showError(result.error || 'Failed to create folder');
            }
        } catch (error) {
            console.error('Create folder error:', error);
            this.showError('Failed to create folder');
        }
    }

    // Rename item (folder or file) in cloud storage
    async renameCloudItem(itemId, itemType, currentName) {
        if (this.currentStorage === 'native') return;

        const newName = prompt('Enter new name:', currentName);
        if (!newName || newName.trim() === currentName) return;

        const endpoint = itemType === 'folder'
            ? `/x_integ/storage/folder/rename/${this.currentStorage}`
            : `/x_integ/storage/file/rename/${this.currentStorage}`;

        const bodyKey = itemType === 'folder' ? 'folder_id' : 'file_id';

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ [bodyKey]: itemId, new_name: newName.trim() })
            });

            const result = await response.json();
            if (result.success) {
                this.showSuccess('Renamed successfully');
                await this.loadStorageContent(this.currentStorage, this.cloudFolderId);
            } else {
                this.showError(result.error || 'Failed to rename');
            }
        } catch (error) {
            console.error('Rename error:', error);
            this.showError('Failed to rename');
        }
    }

    // Delete item (folder or file) in cloud storage
    async deleteCloudItem(itemId, itemType, itemName) {
        if (this.currentStorage === 'native') return;

        const confirmed = confirm(`Are you sure you want to delete "${itemName}"?${itemType === 'folder' ? '\nThis will delete all contents inside.' : ''}`);
        if (!confirmed) return;

        const endpoint = itemType === 'folder'
            ? `/x_integ/storage/folder/delete/${this.currentStorage}`
            : `/x_integ/storage/file/delete/${this.currentStorage}`;

        const bodyKey = itemType === 'folder' ? 'folder_id' : 'file_id';

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ [bodyKey]: itemId })
            });

            const result = await response.json();
            if (result.success) {
                this.showSuccess('Deleted successfully');
                await this.loadStorageContent(this.currentStorage, this.cloudFolderId);
            } else {
                this.showError(result.error || 'Failed to delete');
            }
        } catch (error) {
            console.error('Delete error:', error);
            this.showError('Failed to delete');
        }
    }

    // Move item to another folder
    async moveCloudItem(itemId, itemType, newParentId) {
        if (this.currentStorage === 'native') return;

        const endpoint = itemType === 'folder'
            ? `/x_integ/storage/folder/move/${this.currentStorage}`
            : `/x_integ/storage/file/move/${this.currentStorage}`;

        const bodyKey = itemType === 'folder' ? 'folder_id' : 'file_id';

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ [bodyKey]: itemId, new_parent_id: newParentId })
            });

            const result = await response.json();
            if (result.success) {
                this.showSuccess('Moved successfully');
                await this.loadStorageContent(this.currentStorage, this.cloudFolderId);
            } else {
                this.showError(result.error || 'Failed to move');
            }
        } catch (error) {
            console.error('Move error:', error);
            this.showError('Failed to move');
        }
    }

    // Upload file to cloud storage
    async uploadToCloud(files) {
        if (this.currentStorage === 'native' || !files || files.length === 0) return;

        this.showStorageLoading();

        for (const file of files) {
            try {
                const formData = new FormData();
                formData.append('file', file);
                if (this.cloudFolderId) {
                    formData.append('parent_id', this.cloudFolderId);
                }

                const response = await fetch(`/x_integ/storage/file/upload/${this.currentStorage}`, {
                    method: 'POST',
                    body: formData
                });

                const result = await response.json();
                if (!result.success) {
                    this.showError(`Failed to upload ${file.name}: ${result.error}`);
                }
            } catch (error) {
                console.error('Upload error:', error);
                this.showError(`Failed to upload ${file.name}`);
            }
        }

        this.hideStorageLoading();
        this.showSuccess('Upload completed');
        await this.loadStorageContent(this.currentStorage, this.cloudFolderId);
    }

    // Download file from cloud storage
    downloadCloudFile(fileId, fileName) {
        if (this.currentStorage === 'native') return;

        const url = `/x_integ/storage/file/download/${this.currentStorage}/${encodeURIComponent(fileId)}`;

        // Create hidden link and trigger download
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName || 'download';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    // Restore file from trash (if supported)
    async restoreCloudFile(fileId) {
        if (this.currentStorage === 'native') return;

        try {
            const response = await fetch(`/x_integ/storage/file/restore/${this.currentStorage}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ file_id: fileId })
            });

            const result = await response.json();
            if (result.success) {
                this.showSuccess('File restored successfully');
                await this.loadStorageContent(this.currentStorage, this.cloudFolderId);
            } else {
                this.showError(result.error || 'Failed to restore file');
            }
        } catch (error) {
            console.error('Restore error:', error);
            this.showError('Failed to restore file');
        }
    }

    // Show cloud actions controls (for cloud storage only)
    showCloudActionsUI() {
        if (this.currentStorage === 'native') return;

        // Check if cloud actions container exists, if not create it
        let actionsContainer = document.getElementById('cloud-actions-container');
        if (!actionsContainer) {
            actionsContainer = document.createElement('div');
            actionsContainer.id = 'cloud-actions-container';
            actionsContainer.className = 'cloud-actions-container';
            actionsContainer.innerHTML = `
                <button class="btn btn-primary btn-sm" onclick="window.storageManager.createCloudFolder()">
                    <i class="bi bi-folder-plus"></i> New Folder
                </button>
                <button class="btn btn-success btn-sm" onclick="document.getElementById('cloud-file-input').click()">
                    <i class="bi bi-upload"></i> Upload
                </button>
                <input type="file" id="cloud-file-input" multiple style="display: none;" 
                    onchange="window.storageManager.uploadToCloud(this.files); this.value='';">
            `;

            // Insert after breadcrumbs
            const breadcrumbContainer = document.getElementById('dm-breadcrumbs');
            if (breadcrumbContainer && breadcrumbContainer.parentNode) {
                breadcrumbContainer.parentNode.insertBefore(actionsContainer, breadcrumbContainer.nextSibling);
            }
        }

        actionsContainer.style.display = 'flex';
    }

    hideCloudActionsUI() {
        const actionsContainer = document.getElementById('cloud-actions-container');
        if (actionsContainer) {
            actionsContainer.style.display = 'none';
        }
    }
}


// Initialize Storage Manager when DOM is loaded
document.addEventListener('DOMContentLoaded', function () {
    // Wait a bit for the main document manager to initialize
    setTimeout(() => {
        window.storageManager = new StorageManager();
    }, 100);
});

// Integrate with existing document manager functions
document.addEventListener('DOMContentLoaded', function () {
    // Override the original setupDocumentEventListeners to include storage awareness
    const originalSetupEventListeners = window.setupDocumentEventListeners;

    window.setupDocumentEventListeners = function () {
        // Call original function first
        if (originalSetupEventListeners) {
            originalSetupEventListeners();
        }

        // Add storage-specific event listeners
        setupStorageDocumentEventListeners();
    };

    function setupStorageDocumentEventListeners() {
        // Options menu toggles
        const optionsButtons = document.querySelectorAll('.options-btn');
        optionsButtons.forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                const menu = this.closest('.options-menu');

                // Close other menus
                document.querySelectorAll('.options-menu.active').forEach(m => {
                    if (m !== menu) m.classList.remove('active');
                });

                menu.classList.toggle('active');
            });
        });

        // Option item clicks
        const optionItems = document.querySelectorAll('.option-item');
        optionItems.forEach(item => {
            item.addEventListener('click', function () {
                const action = this.getAttribute('data-action');
                const url = this.getAttribute('data-url');
                const id = this.getAttribute('data-id');

                handleStorageDocumentAction(action, { url, id });

                // Close menu
                this.closest('.options-menu').classList.remove('active');
            });
        });

        // Direct action buttons
        const viewButtons = document.querySelectorAll('.view-btn');
        const deleteButtons = document.querySelectorAll('.delete-btn');

        viewButtons.forEach(btn => {
            btn.addEventListener('click', function () {
                const url = this.getAttribute('data-url');
                handleStorageDocumentAction('view', { url });
            });
        });

        deleteButtons.forEach(btn => {
            btn.addEventListener('click', function () {
                const id = this.getAttribute('data-id');
                handleStorageDocumentAction('delete', { id });
            });
        });

        // Close menus when clicking outside
        document.addEventListener('click', function () {
            document.querySelectorAll('.options-menu.active').forEach(menu => {
                menu.classList.remove('active');
            });
        });
    }

    function handleStorageDocumentAction(action, data) {
        switch (action) {
            case 'view':
                if (data.url) {
                    if (data.url.toLowerCase().includes('.pdf')) {
                        // Use existing PDF modal functionality
                        if (window.openPdfModal) {
                            window.openPdfModal(data.url, 'Document');
                        } else {
                            window.open(data.url, '_blank');
                        }
                    } else {
                        window.open(data.url, '_blank');
                    }
                }
                break;
            case 'download':
                if (data.url) {
                    const a = document.createElement('a');
                    a.href = data.url;
                    a.download = '';
                    a.click();
                }
                break;
            case 'delete':
                if (data.id) {
                    // Use existing delete functionality for native files
                    if (window.openDeleteModal) {
                        window.openDeleteModal(data.id, 'Document');
                    }
                }
                break;
        }
    }
});

// Add CSS for provider-specific styling
document.addEventListener('DOMContentLoaded', function () {
    const style = document.createElement('style');
    style.textContent = `
        .provider-badge {
            font-size: 0.7rem;
            padding: 0.2rem 0.4rem;
            background: rgba(0, 0, 0, 0.7);
            color: white;
            border-radius: 3px;
            margin-left: 0.5rem;
        }

        .file-info {
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }

        .file-info .provider-badge {
            margin-left: auto;
        }

        .storage-loading .spinner {
            width: 30px;
            height: 30px;
            border: 3px solid #f3f3f3;
            border-top: 3px solid var(--primary);
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        .storage-error {
            text-align: center;
            padding: 2rem;
            color: #dc3545;
        }

        .storage-error i {
            font-size: 3rem;
            margin-bottom: 1rem;
            opacity: 0.7;
        }
    `;
    document.head.appendChild(style);
});

// Export for global access
if (typeof module !== 'undefined' && module.exports) {
    module.exports = StorageManager;
} else {
    window.StorageManager = StorageManager;
}