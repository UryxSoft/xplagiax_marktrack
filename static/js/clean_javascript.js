// Document Manager JavaScript - Core Logic
// Hierarchical Navigation and Explorer Features

// Global State
let documents = [];
let folders = [];
let currentDocumentId = null;
let currentFolderId = null;
let breadcrumbs = [{ id: null, name: 'My Documents' }];
let isViewingTrash = false;

const API_URL = '/x_buck/api/documents';
const API_DELETE_URL = '/x_doc/deletesave';

// Modal State
let activeRenameItem = null;
let activeShareItem = null;
let selectedShareUser = null;

// Debounce helper
function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', function () {
    initializeDocumentManager();
    if (typeof initializeFilePond === 'function') {
        initializeFilePond();
    }
    setupEventListeners();
    loadFolderContent(null);
});

// Initialize Document Manager
function initializeDocumentManager() {
    // Initialize Bootstrap components if available
    if (typeof bootstrap !== 'undefined') {
        const popoverTriggerList = document.querySelectorAll('[data-bs-toggle="popover"]');
        [...popoverTriggerList].map(popoverTriggerEl => new bootstrap.Popover(popoverTriggerEl));
    }
}

// Setup Event Listeners
function setupEventListeners() {
    // View toggle
    const toggleButtons = document.querySelectorAll('.toggle-btn');
    toggleButtons.forEach(btn => {
        btn.addEventListener('click', function () {
            const view = this.getAttribute('data-view');
            switchView(view);
        });
    });

    // Actions dropdown
    const actionsBtn = document.querySelector('.actions-btn');
    const actionsDropdown = document.querySelector('.actions-dropdown');
    if (actionsBtn && actionsDropdown) {
        actionsBtn.addEventListener('click', () => actionsDropdown.classList.toggle('active'));
        document.addEventListener('click', (e) => {
            if (!actionsDropdown.contains(e.target)) actionsDropdown.classList.remove('active');
        });

        const actionItems = document.querySelectorAll('.action-item');
        actionItems.forEach(item => {
            item.addEventListener('click', function () {
                handleAction(this.getAttribute('data-action'));
            });
        });
    }

    // Search functionality
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', function () {
            filterContent(this.value.toLowerCase());
        });
    }

    // Modal behavior
    const modalCloseButtons = document.querySelectorAll('.modal-close, .modal-cancel, .modal-overlay');
    modalCloseButtons.forEach(btn => {
        btn.addEventListener('click', closeModals);
    });

    const confirmCreateFolder = document.getElementById('confirm-create-folder');
    if (confirmCreateFolder) {
        confirmCreateFolder.addEventListener('click', createFolder);
    }

    // Rename Modal confirm
    const confirmRenameBtn = document.getElementById('confirm-rename');
    if (confirmRenameBtn) confirmRenameBtn.addEventListener('click', executeRename);

    // Share Search input
    const shareSearchInput = document.getElementById('share-user-search');
    if (shareSearchInput) {
        shareSearchInput.addEventListener('input', debounce(function () {
            searchUsers(this.value);
        }, 500));
    }

    // Share Modal confirm
    const confirmShareBtn = document.getElementById('confirm-share');
    if (confirmShareBtn) confirmShareBtn.addEventListener('click', executeShare);

    const clearSelectedUserBtn = document.getElementById('clear-selected-user');
    if (clearSelectedUserBtn) clearSelectedUserBtn.addEventListener('click', clearSelectedUser);

    // Side panel actions
    const panelOpen = document.getElementById('panel-open');
    if (panelOpen) {
        panelOpen.addEventListener('click', function () {
            if (activeSelection) {
                if (activeSelection.type === 'folder') openFolder(activeSelection.item.id, activeSelection.item.name);
                else handleDocumentAction('view', { url: activeSelection.item.minio_url });
            }
        });
    }

    const panelShare = document.getElementById('panel-share');
    if (panelShare) {
        panelShare.addEventListener('click', function () {
            if (activeSelection && activeSelection.item.minio_url) {
                const url = activeSelection.item.minio_url;
                navigator.clipboard.writeText(url).then(() => {
                    showAlert('Link copied to clipboard', 'success');
                }).catch(() => {
                    // Fallback for non-secure contexts
                    const el = document.createElement('textarea');
                    el.value = url;
                    document.body.appendChild(el);
                    el.select();
                    document.execCommand('copy');
                    document.body.removeChild(el);
                    showAlert('Link copied to clipboard', 'success');
                });
            } else if (activeSelection) {
                showAlert('Sharing not available for this item', 'info');
            }
        });
    }

    const panelDelete = document.getElementById('panel-delete');
    if (panelDelete) {
        panelDelete.addEventListener('click', function () {
            if (activeSelection) {
                openDeleteModal(activeSelection.item.id, activeSelection.type);
            }
        });
    }

    const panelClose = document.getElementById('close-panel');
    if (panelClose) {
        panelClose.addEventListener('click', () => {
            document.getElementById('context-panel').classList.add('hidden');
        });
    }

    // Delete confirmation
    const confirmDeleteButton = document.getElementById('confirmDeleteButton');
    if (confirmDeleteButton) {
        confirmDeleteButton.addEventListener('click', function () {
            if (currentDocumentId) {
                deleteItem(currentDocumentId, currentItemType);
                closeModals();
            }
        });
    }
}

let activeSelection = null;
let currentItemType = null;

function openDeleteModal(id, type) {
    currentDocumentId = id;
    currentItemType = type;
    const modal = document.getElementById('delete-modal');
    if (modal) modal.classList.add('active');
}

// Handle action items
function handleAction(action) {
    switch (action) {
        case 'upload-document':
            // Use new toast uploader instead of modal
            if (typeof openUploadToast === 'function') {
                openUploadToast();
            } else {
                openUploadModal(); // Fallback to old modal
            }
            break;
        case 'create-folder':
            const folderModal = document.getElementById('folder-modal');
            if (folderModal) folderModal.classList.add('active');
            break;
        case 'view-trash':
            isViewingTrash = true;
            breadcrumbs = [
                { id: null, name: 'My Documents', isTrash: false },
                { id: 'trash', name: 'Trash', isTrash: true }
            ];
            loadFolderContent(null, true);
            break;
    }
}

// Load Content (Folders and Files)
async function loadFolderContent(folderId = null, isTrash = false) {
    currentFolderId = folderId;

    // Show loading in the inline empty state area
    const emptyInline = document.getElementById('emptyStateInline');
    const cardGrid = document.getElementById('cardView');

    if (emptyInline) {
        emptyInline.innerHTML = `
            <div class="empty-inline-content">
                <div class="spinner-border text-primary" role="status" style="width: 2.5rem; height: 2.5rem;"></div>
                <h4 style="margin-top: 1rem;">Loading documents...</h4>
            </div>
        `;
        emptyInline.style.display = 'flex';
    }
    if (cardGrid) cardGrid.style.display = 'none';

    try {
        let url = `/x_doc/folders?trash=${isTrash}`;
        if (folderId) url += `&parent_id=${folderId}`;

        const response = await fetch(url);
        const data = await response.json();

        documents = data.files || [];
        folders = data.folders || [];

        renderContent();
        renderBreadcrumbs();
        updateEmptyState();
        animateEntrance();
    } catch (error) {
        console.error('Error loading content:', error);
        showAlert('Error loading folder content', 'error');
    }
}

// Rendering Logic
function renderContent() {
    renderCardView();
    renderListView();
}

function renderCardView() {
    const grid = document.getElementById('cardView');
    if (!grid) return;

    grid.innerHTML = '';
    folders.forEach(f => grid.appendChild(createFolderCard(f)));
    documents.forEach(doc => grid.appendChild(createDocumentCard(doc)));
}

function renderListView() {
    const tableBody = document.getElementById('documentTableBody');
    if (!tableBody) return;

    tableBody.innerHTML = '';
    folders.forEach(f => tableBody.appendChild(createFolderRow(f)));
    documents.forEach(doc => tableBody.appendChild(createDocumentRow(doc)));
}

// Creators
function createFolderCard(folder) {
    const card = document.createElement('div');
    card.className = 'document-card folder-item';
    card.dataset.id = folder.id;
    card.dataset.type = 'folder';

    // Different menu for trash view
    const menuContent = isViewingTrash ? `
        <div class="dropdown-item text-success" onclick="event.stopPropagation(); restoreItem(${folder.id}, 'folder')">
            <i class="bi bi-arrow-counterclockwise"></i> Restore
        </div>
        <div class="dropdown-item text-danger" onclick="event.stopPropagation(); permanentDeleteItem(${folder.id}, 'folder')">
            <i class="bi bi-x-circle"></i> Delete Permanently
        </div>
    ` : `
        <div class="dropdown-item" onclick="event.stopPropagation(); openFolder(${folder.id}, '${folder.name.replace(/'/g, "\\'")}')">
            <i class="bi bi-folder-symlink"></i> Open
        </div>
        <div class="dropdown-item" onclick="event.stopPropagation(); shareItem(${folder.id}, 'folder')">
            <i class="bi bi-share"></i> Share
        </div>
        <div class="dropdown-item" onclick="event.stopPropagation(); renameItem(${folder.id}, 'folder', '${folder.name.replace(/'/g, "\\'")}')">
            <i class="bi bi-pencil"></i> Rename
        </div>
        <div class="dropdown-item" onclick="event.stopPropagation(); openMoveModal(${folder.id}, 'folder', '${folder.name.replace(/'/g, "\\'")}')">
            <i class="bi bi-arrow-right-circle"></i> Move
        </div>
        <div class="dropdown-item text-danger" onclick="event.stopPropagation(); openDeleteModal(${folder.id}, 'folder')">
            <i class="bi bi-trash"></i> Delete
        </div>
        <div class="dropdown-divider"></div>
        <div class="dropdown-item" onclick="event.stopPropagation(); showDetails(${folder.id}, 'folder')">
            <i class="bi bi-info-circle"></i> Details
        </div>
    `;

    card.innerHTML = `
        <div class="card-menu">
            <button class="card-menu-btn" onclick="event.stopPropagation(); toggleCardMenu(this)">
                <i class="bi bi-three-dots-vertical"></i>
            </button>
            <div class="card-dropdown">
                ${menuContent}
            </div>
        </div>
        <div class="card-icon"><i class="bi bi-folder-fill text-warning"></i></div>
        <div class="card-info">
            <h3 class="card-title" title="${folder.name}">${folder.name}</h3>
            <p class="card-meta">Folder</p>
        </div>
    `;
    card.addEventListener('click', () => selectItem(folder, 'folder'));
    if (!isViewingTrash) {
        card.addEventListener('dblclick', () => openFolder(folder.id, folder.name));
    }
    return card;
}

function createDocumentCard(doc) {
    const card = document.createElement('div');
    card.className = 'document-card';
    card.dataset.id = doc.id;
    card.dataset.type = 'file';

    // Different menu for trash view
    const menuContent = isViewingTrash ? `
        <div class="dropdown-item text-success" onclick="event.stopPropagation(); restoreItem(${doc.id}, 'file')">
            <i class="bi bi-arrow-counterclockwise"></i> Restore
        </div>
        <div class="dropdown-item text-danger" onclick="event.stopPropagation(); permanentDeleteItem(${doc.id}, 'file')">
            <i class="bi bi-x-circle"></i> Delete Permanently
        </div>
    ` : `
        <div class="dropdown-item" onclick="event.stopPropagation(); handleDocumentAction('view', {url: '${doc.minio_url || ''}'})">
            <i class="bi bi-eye"></i> View
        </div>
        <div class="dropdown-item" onclick="event.stopPropagation(); shareItem(${doc.id}, 'file')">
            <i class="bi bi-share"></i> Share
        </div>
        <div class="dropdown-item" onclick="event.stopPropagation(); renameItem(${doc.id}, 'file', '${(doc.original_filename || '').replace(/'/g, "\\'")}')">
            <i class="bi bi-pencil"></i> Rename
        </div>
        <div class="dropdown-item" onclick="event.stopPropagation(); openMoveModal(${doc.id}, 'file', '${(doc.original_filename || '').replace(/'/g, "\\'")}')">
            <i class="bi bi-arrow-right-circle"></i> Move
        </div>
        <div class="dropdown-item text-danger" onclick="event.stopPropagation(); openDeleteModal(${doc.id}, 'file')">
            <i class="bi bi-trash"></i> Delete
        </div>
        <div class="dropdown-divider"></div>
        <div class="dropdown-item" onclick="event.stopPropagation(); showDetails(${doc.id}, 'file')">
            <i class="bi bi-info-circle"></i> Details
        </div>
    `;

    card.innerHTML = `
        <div class="card-menu">
            <button class="card-menu-btn" onclick="event.stopPropagation(); toggleCardMenu(this)">
                <i class="bi bi-three-dots-vertical"></i>
            </button>
            <div class="card-dropdown">
                ${menuContent}
            </div>
        </div>
        <div class="card-icon">${getFileIconSVG(doc.original_filename)}</div>
        <div class="card-info">
            <h3 class="card-title" title="${doc.original_filename}">${doc.original_filename}</h3>
            <p class="card-meta">${formatSize(doc.size)} • ${doc.status || 'Active'}</p>
        </div>
    `;
    // card.addEventListener('click', () => selectItem(doc, 'file')); // Disabled: prevent auto-open side panel
    return card;
}

function createFolderRow(folder) {
    const row = document.createElement('div');
    row.className = 'table-row folder-row';
    row.innerHTML = `
        <div class="table-cell"><div class="doc-name-cell"><i class="bi bi-folder-fill text-warning me-2"></i><span>${folder.name}</span></div></div>
        <div class="table-cell">-</div>
        <div class="table-cell">${new Date(folder.created_at).toLocaleDateString()}</div>
        <div class="table-cell"><button class="btn btn-sm btn-outline-primary" onclick="openFolder(${folder.id}, '${folder.name}')">Open</button></div>
    `;
    row.addEventListener('click', () => selectItem(folder, 'folder'));
    return row;
}

function createDocumentRow(doc) {
    const row = document.createElement('div');
    row.className = 'table-row document-row';
    row.innerHTML = `
        <div class="table-cell"><div class="doc-name-cell"><span class="me-2 d-flex align-items-center">${getFileIconSVG(doc.original_filename)}</span><span>${doc.original_filename}</span></div></div>
        <div class="table-cell">${formatSize(doc.size)}</div>
        <div class="table-cell">${new Date(doc.created_at).toLocaleDateString()}</div>
        <div class="table-cell"><button class="btn btn-sm btn-outline-primary" onclick="handleDocumentAction('view', {url: '${doc.minio_url}'})">View</button></div>
    `;
    row.addEventListener('click', () => selectItem(doc, 'file'));
    return row;
}

// Navigation
function openFolder(id, name) {
    breadcrumbs.push({ id, name });
    loadFolderContent(id);
}

function navigateToBreadcrumb(index) {
    const targetItem = breadcrumbs[index];
    breadcrumbs = breadcrumbs.slice(0, index + 1);

    // If navigating to My Documents (first item without isTrash), reset trash mode
    if (index === 0 && !targetItem.isTrash) {
        isViewingTrash = false;
        breadcrumbs = [{ id: null, name: 'My Documents' }];
    }

    loadFolderContent(targetItem.id, targetItem.isTrash || false);
}

function renderBreadcrumbs() {
    const container = document.getElementById('dm-breadcrumbs');
    if (!container) return;
    container.innerHTML = '';
    breadcrumbs.forEach((bc, idx) => {
        const li = document.createElement('li');
        li.className = `breadcrumb-item ${idx === breadcrumbs.length - 1 ? 'active' : ''}`;

        // Check if this is the root item
        if (idx === 0) {
            if (bc.isTrash) {
                li.innerHTML = `<i class="bi bi-trash"></i> ${bc.name}`;
            } else {
                li.innerHTML = `<i class="bi bi-house"></i> ${bc.name}`;
            }
        } else {
            li.innerHTML = bc.name;
        }

        if (idx < breadcrumbs.length - 1) {
            li.style.cursor = 'pointer';
            li.onclick = () => navigateToBreadcrumb(idx);
        }
        container.appendChild(li);
    });
}

// Context Panel
function selectItem(item, type) {
    activeSelection = { item, type };
    document.querySelectorAll('.document-card, .table-row').forEach(el => el.classList.remove('selected'));

    // Highlight visually (approximate if no IDs on elements)
    // For now we just show the panel
    showSidePanel(item, type);
}

function showSidePanel(item, type) {
    const panel = document.getElementById('context-panel');
    if (!panel) return;

    document.getElementById('panel-title').textContent = type === 'folder' ? item.name : item.original_filename;
    document.getElementById('panel-status').textContent = type === 'folder' ? 'Local' : (item.status || 'Active');
    document.getElementById('panel-type').textContent = type === 'folder' ? 'Folder' : (item.mime_type || 'File');
    document.getElementById('panel-size').textContent = type === 'folder' ? '-' : formatSize(item.size);
    document.getElementById('panel-created').textContent = new Date(item.created_at).toLocaleDateString();

    panel.classList.remove('hidden');
}

// Rich Details Offcanvas Logic
// Helper for relative time
function timeAgo(dateParam) {
    if (!dateParam) return '-';
    const date = typeof dateParam === 'object' ? dateParam : new Date(dateParam);
    const today = new Date();
    const seconds = Math.round((today - date) / 1000);
    const minutes = Math.round(seconds / 60);
    const hours = Math.round(minutes / 60);
    const days = Math.round(hours / 24);

    if (seconds < 5) return 'just now';
    else if (seconds < 60) return `${seconds} seconds ago`;
    else if (minutes < 60) return `${minutes} minutes ago`;
    else if (hours < 24) return `${hours} hours ago`;
    else if (days < 30) return `${days} days ago`;
    else return date.toLocaleDateString();
}

// Rich Details Offcanvas Logic
window.openRichDetails = function (item, type) {
    if (!item) return;
    const panel = document.getElementById('rich-details-offcanvas');
    if (!panel) return;

    try {
        // 1. Header
        const iconContainer = document.getElementById('rich-details-icon');
        const title = item.original_filename || item.name || item.title || 'Unknown';
        if (iconContainer) iconContainer.innerHTML = getFileIconSVG(title);

        const titleEl = document.getElementById('rich-details-title');
        if (titleEl) titleEl.textContent = title;

        // 2. Details Tab
        const statusEl = document.getElementById('rich-panel-status');
        if (statusEl) {
            statusEl.textContent = (item.status || 'Active');
            statusEl.className = 'badge bg-light text-dark'; // Reset classes
            if (item.status === 'deleted') statusEl.classList.add('bg-danger', 'text-white');
            else statusEl.classList.add('bg-success', 'text-white');
        }

        const typeEl = document.getElementById('rich-panel-type');
        if (typeEl) typeEl.textContent = type === 'folder' ? 'Folder' : (item.mime_type || 'File');

        const sizeEl = document.getElementById('rich-panel-size');
        if (sizeEl) sizeEl.textContent = type === 'folder' ? '-' : (window.formatSize ? window.formatSize(item.size || 0) : (item.size || 0) + ' B');

        const modEl = document.getElementById('rich-panel-modified');
        if (modEl) modEl.textContent = timeAgo(item.created_at || item.modified);

        // Determine Location/Provider
        const provider = item.provider || 'native';
        const locEl = document.getElementById('rich-panel-location');
        if (locEl) locEl.textContent = provider === 'native' ? 'My Documents' : (provider.charAt(0).toUpperCase() + provider.slice(1));

        // Actions
        const openBtn = document.getElementById('rich-panel-open');
        const downloadBtn = document.getElementById('rich-panel-download');

        if (type === 'folder') {
            if (openBtn) openBtn.onclick = () => openFolder(item.id, item.name);
            if (downloadBtn) downloadBtn.style.display = 'none';
        } else {
            const url = item.minio_url || item.download_url || item.url;
            if (url) {
                if (openBtn) {
                    openBtn.onclick = () => window.handleDocumentAction('view', { url: url });
                    openBtn.style.display = 'block';
                }
                if (downloadBtn) {
                    downloadBtn.onclick = () => window.location.href = url;
                    downloadBtn.style.display = 'block';
                }
            } else {
                if (openBtn) openBtn.style.display = 'none';
                if (downloadBtn) downloadBtn.style.display = 'none';
            }
        }

        // 3. Share Tab
        const shareList = document.getElementById('rich-share-list');
        if (shareList) {
            shareList.innerHTML = '<div class="text-center py-4"><div class="spinner-border spinner-border-sm text-primary"></div><p class="small text-muted mt-2">Loading access list...</p></div>';

            if (provider === 'native') {
                shareList.innerHTML = `
                    <div class="share-row">
                        <div class="avatar-small bg-primary text-white">ME</div>
                        <div class="flex-grow-1">
                            <div class="fw-bold" style="font-size: 0.9rem;">You</div>
                            <div class="small text-muted">${currentUserData.email}</div>
                        </div>
                        <span class="badge bg-light text-dark">Owner</span>
                    </div>
                    
                    <div class="mt-4">
                        <button class="btn btn-outline-primary w-100 py-3 d-flex align-items-center justify-content-center gap-2" style="border-radius: 14px; font-weight: 600;" onclick="window.handleDocumentAction('share')">
                            <i class="bi bi-person-plus"></i> Share with others
                        </button>
                    </div>
                `;
            } else {
                // Fetch shared users for cloud providers
                const fileId = item.id || item.fileId;
                if (fileId) {
                    window.fetchAndRenderSharedUsers(provider, fileId, item.webViewLink || item.url);
                } else {
                    shareList.innerHTML = `
                        <div class="text-center py-5">
                            <i class="bi bi-cloud-slash text-muted" style="font-size: 2rem;"></i>
                            <p class="text-muted mt-3 small">Manage sharing in ${provider.charAt(0).toUpperCase() + provider.slice(1)}</p>
                            <a href="${item.webViewLink || '#'}" target="_blank" class="btn btn-manage-cloud mt-3">
                                <img src="/static/img/svg/${provider.replace('_', '-')}.svg" height="18">
                                Manage in ${provider.charAt(0).toUpperCase() + provider.slice(1)}
                            </a>
                        </div>
                    `;
                }
            }
        }

        // 4. History Tab (Timeline)
        const historyList = document.getElementById('rich-history-list');
        if (historyList) {
            const baseDate = item.created_at || item.modified;
            const dateStr = baseDate ? timeAgo(baseDate) : 'Unknown time';
            let secondaryDateStr = 'Recent';

            if (baseDate) {
                try {
                    const parsedDate = new Date(baseDate);
                    if (!isNaN(parsedDate.getTime())) {
                        secondaryDateStr = timeAgo(new Date(parsedDate.getTime() + 1000 * 60 * 5));
                    }
                } catch (e) { }
            }

            historyList.innerHTML = `
                <div class="activity-item">
                    <div class="timeline-content">
                        <div class="fw-bold" style="font-size: 0.9rem;">Analysis Completed</div>
                        <div class="small text-muted">${secondaryDateStr}</div>
                    </div>
                </div>
                <div class="activity-item">
                    <div class="timeline-content">
                        <div class="fw-bold" style="font-size: 0.9rem;">Document Processed</div>
                        <div class="small text-muted">${dateStr}</div>
                    </div>
                </div>
                <div class="activity-item">
                    <div class="timeline-content">
                        <div class="fw-bold" style="font-size: 0.9rem;">File Uploaded</div>
                        <div class="small text-muted">${dateStr}</div>
                    </div>
                </div>
            `;
        }

        // Show Panel with Animation
        panel.classList.remove('hidden');
        panel.style.display = 'flex'; // Ensure flex
        // Force reflow
        void panel.offsetWidth;
        panel.classList.add('active');

        // Reset to first tab
        const firstTab = new bootstrap.Tab(document.querySelector('#richDetailsTabs button[data-bs-target="#details-pane"]'));
        firstTab.show();

    } catch (e) {
        console.error("Error showing rich details:", e);
    }
}

window.closeRichDetails = function () {
    const panel = document.getElementById('rich-details-offcanvas');
    if (panel) {
        panel.classList.remove('active');
        setTimeout(() => {
            panel.classList.add('hidden');
        }, 400); // Wait for transition
    }
}

// Share helpers
window.fetchAndRenderSharedUsers = async function (provider, fileId, fallbackUrl) {
    const shareList = document.getElementById('rich-share-list');
    try {
        const response = await fetch(`/x_integ/storage/files/${provider}/shared/${fileId}`);
        if (response.ok) {
            const data = await response.json();
            const users = data.shared_users || [];

            if (users.length > 0) {
                let html = '<div class="share-list-container">';
                users.forEach(user => {
                    const initials = (user.name || user.email || 'U').charAt(0).toUpperCase();
                    html += `
                        <div class="share-row">
                            <div class="avatar-small" style="background: ${window.getRandomPastel()}; color: white;">${initials}</div>
                            <div class="flex-grow-1">
                                <div class="fw-bold" style="font-size: 0.9rem;">${user.name || user.email}</div>
                                <div class="share-user-email">${user.email || ''}</div>
                            </div>
                            <span class="badge bg-light text-dark">${user.role || 'Viewer'}</span>
                        </div>
                    `;
                });

                html += `
                    <div class="mt-4 pt-2">
                        <a href="${fallbackUrl || '#'}" target="_blank" class="btn-manage-cloud">
                             <img src="/static/img/svg/${provider.replace('_', '-')}.svg" height="18">
                             Manage Access in ${provider.charAt(0).toUpperCase() + provider.slice(1)}
                        </a>
                    </div>
                </div>`;
                shareList.innerHTML = html;
            } else {
                throw new Error("No shared users");
            }
        } else {
            throw new Error("Failed to fetch");
        }
    } catch (e) {
        shareList.innerHTML = `
            <div class="text-center py-5">
                <i class="bi bi-people text-muted" style="font-size: 2rem; opacity: 0.5;"></i>
                <p class="text-muted mt-3 small">Only you have access to this file, or sharing is managed externally.</p>
                <a href="${fallbackUrl || '#'}" target="_blank" class="btn-manage-cloud mt-3">
                    <img src="/static/img/svg/${provider.replace('_', '-')}.svg" height="18">
                    Manage in ${provider.charAt(0).toUpperCase() + provider.slice(1)}
                </a>
            </div>
        `;
    }
}

window.getRandomPastel = function () {
    const colors = ['#667eea', '#764ba2', '#1a73e8', '#10b981', '#f59e0b', '#ef4444', '#6366f1'];
    return colors[Math.floor(Math.random() * colors.length)];
}

// Alias for context menu calls - redirect old showDetails to new Rich Details
window.showDetails = window.openRichDetails;
// Fix selectItem looking for showSidePanel
window.showSidePanel = window.openRichDetails;
var showSidePanel = window.openRichDetails; // Function scope alias for selectItem call

// Folder Creation
async function createFolder() {
    const input = document.getElementById('new-folder-name');
    const name = input.value.trim();
    if (!name) return showAlert('Name required', 'error');

    try {
        const res = await fetch('/x_doc/folders/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, parent_id: currentFolderId })
        });
        if (res.ok) {
            closeModals();
            input.value = '';
            loadFolderContent(currentFolderId);
            showAlert('Folder created', 'success');
        } else {
            const err = await res.json();
            showAlert(err.error || 'Failed to create', 'error');
        }
    } catch (e) {
        showAlert('Network error', 'error');
    }
}

// Trash/Delete
async function deleteItem(id, type) {
    try {
        const res = await fetch('/x_doc/organize/trash', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ item_id: id, type })
        });
        if (res.ok) {
            showAlert('Item moved to trash', 'success');
            loadFolderContent(currentFolderId);
            document.getElementById('context-panel').classList.add('hidden');
        } else {
            showAlert('Error moving to trash', 'error');
        }
    } catch (e) {
        showAlert('Network error', 'error');
    }
}

// Restore item from trash
async function restoreItem(id, type) {
    try {
        const res = await fetch('/x_doc/organize/restore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ item_id: id, type })
        });
        if (res.ok) {
            showAlert('Item restored successfully', 'success');
            loadFolderContent(null, true); // Reload trash view
            document.getElementById('context-panel').classList.add('hidden');
        } else {
            const err = await res.json();
            showAlert(err.error || 'Error restoring item', 'error');
        }
    } catch (e) {
        showAlert('Network error', 'error');
    }
}

// Permanently delete item
async function permanentDeleteItem(id, type) {
    if (!confirm('Are you sure you want to permanently delete this item? This action cannot be undone.')) {
        return;
    }

    try {
        const res = await fetch('/x_doc/organize/permanent-delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ item_id: id, type })
        });
        if (res.ok) {
            showAlert('Item permanently deleted', 'success');
            loadFolderContent(null, true); // Reload trash view
            document.getElementById('context-panel').classList.add('hidden');
        } else {
            const err = await res.json();
            showAlert(err.error || 'Error deleting item', 'error');
        }
    } catch (e) {
        showAlert('Network error', 'error');
    }
}

// Modals
function openUploadModal() {
    const modal = document.getElementById('upload-modal');
    if (modal) modal.classList.add('active');
}

function closeModals() {
    document.querySelectorAll('.upload-modal, #folder-modal').forEach(m => m.classList.remove('active'));
    const panel = document.getElementById('context-panel');
    if (panel) panel.classList.add('hidden');
}

// Utils
function formatSize(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const s = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    let i = Math.floor(Math.log(bytes) / Math.log(1024));
    // Ensure index doesn't exceed array bounds
    if (i >= s.length) i = s.length - 1;
    if (i < 0) i = 0;
    return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + s[i];
}

function getFileIconSVG(name) {
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

function getFileIconClass(name) {
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

function showAlert(msg, type) {
    const id = type === 'success' ? 'successAlert' : 'errorAlert';
    const el = document.getElementById(id);
    if (el) {
        const msgEl = el.querySelector('span') || el;
        msgEl.textContent = msg;
        el.classList.remove('d-none');
        setTimeout(() => el.classList.add('d-none'), 3000);
    }
}

function updateEmptyState() {
    const emptyOld = document.getElementById('notdocumentfound');
    const emptyInline = document.getElementById('emptyStateInline');
    const cardGrid = document.getElementById('cardView');
    const explorerLayout = document.querySelector('.dm-explorer-layout');
    const controlsContainer = document.querySelector('.controls-container');

    const isEmpty = documents.length === 0 && folders.length === 0;

    // When empty: hide explorer layout and controls, show old empty state
    // When has content: show explorer layout and controls, hide old empty state
    if (isEmpty) {
        // Hide explorer layout and controls when empty
        if (explorerLayout) explorerLayout.style.display = 'none';
        if (controlsContainer) controlsContainer.style.display = 'none';

        // Show the main empty state container
        if (emptyOld) {
            emptyOld.classList.remove('hidden');
            emptyOld.style.display = 'flex';
        }

        // Hide inline empty state (we use the main one when truly empty)
        if (emptyInline) emptyInline.style.display = 'none';
    } else {
        // Show explorer layout and controls when has content
        if (explorerLayout) explorerLayout.style.display = 'flex';
        if (controlsContainer) controlsContainer.style.display = 'flex';

        // Hide the main empty state container
        if (emptyOld) {
            emptyOld.classList.add('hidden');
            emptyOld.style.display = 'none';
        }

        // Hide inline empty state
        if (emptyInline) emptyInline.style.display = 'none';
    }

    // Show/hide grid
    if (cardGrid) {
        cardGrid.style.display = isEmpty ? 'none' : 'grid';
    }
}

function animateEntrance() {
    const items = document.querySelectorAll('.document-card, .table-row');
    items.forEach((el, i) => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(10px)';
        el.style.transition = 'all 0.3s ease';
        setTimeout(() => {
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
        }, i * 30);
    });
}

function switchView(view) {
    document.querySelectorAll('.toggle-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.view === view);
    });
    document.getElementById('card-view').classList.toggle('hidden', view !== 'card');
    document.getElementById('list-view').classList.toggle('hidden', view !== 'list');
}

// Search Filtering
function filterContent(term) {
    const grid = document.getElementById('cardView');
    const tableBody = document.getElementById('documentTableBody');

    if (!term) {
        renderContent();
        updateEmptyState();
        return;
    }

    const filteredFolders = folders.filter(f => f.name.toLowerCase().includes(term));
    const filteredDocs = documents.filter(d => (d.original_filename || '').toLowerCase().includes(term));

    if (grid) {
        grid.innerHTML = '';
        filteredFolders.forEach(f => grid.appendChild(createFolderCard(f)));
        filteredDocs.forEach(doc => grid.appendChild(createDocumentCard(doc)));
    }

    if (tableBody) {
        tableBody.innerHTML = '';
        filteredFolders.forEach(f => tableBody.appendChild(createFolderRow(f)));
        filteredDocs.forEach(doc => tableBody.appendChild(createDocumentRow(doc)));
    }

    const isEmpty = filteredFolders.length === 0 && filteredDocs.length === 0;
    const emptyMsg = document.getElementById('notdocumentfound');
    if (emptyMsg) {
        if (isEmpty) emptyMsg.classList.remove('hidden');
        else emptyMsg.classList.add('hidden');
    }
}

// Global actions shim for onclick handlers
window.openFolder = openFolder;
window.handleDocumentAction = (action, data) => {
    if (action === 'view') {
        const modal = document.getElementById('pdf-modal');
        const frame = document.getElementById('pdfFrame');
        const title = document.getElementById('pdfTitle');
        const downloadBtn = document.getElementById('downloadPdfBtn');

        if (modal && frame) {
            frame.src = data.url;
            title.textContent = data.name || 'Document Viewer';
            if (downloadBtn) {
                downloadBtn.href = data.url;
                downloadBtn.setAttribute('download', data.name || 'document.pdf');
            }

            document.getElementById('pdfLoadingIndicator').classList.remove('d-none');
            document.getElementById('pdfContainer').classList.add('d-none');

            frame.onload = () => {
                document.getElementById('pdfLoadingIndicator').classList.add('d-none');
                document.getElementById('pdfContainer').classList.remove('d-none');
            };

            modal.classList.add('active');
        } else {
            window.open(data.url, '_blank');
        }
    }
};

// Toggle card dropdown menu
function toggleCardMenu(btn) {
    const dropdown = btn.nextElementSibling;
    const allDropdowns = document.querySelectorAll('.card-dropdown.active');
    allDropdowns.forEach(d => { if (d !== dropdown) d.classList.remove('active'); });
    dropdown.classList.toggle('active');
}

// Close dropdowns when clicking outside
document.addEventListener('click', () => {
    document.querySelectorAll('.card-dropdown.active').forEach(d => d.classList.remove('active'));
});

// Rename item
function renameItem(id, type, currentName) {
    activeRenameItem = { id, type };
    const modal = document.getElementById('rename-modal');
    const input = document.getElementById('rename-input');
    const historyPreview = document.getElementById('rename-history-preview');
    const currentNameDisplay = document.getElementById('current-name-display');

    if (modal && input) {
        input.value = currentName;
        if (currentNameDisplay) currentNameDisplay.textContent = currentName;
        if (historyPreview) historyPreview.classList.remove('d-none');
        modal.classList.add('active');
        input.focus();
    }
}

async function executeRename() {
    if (!activeRenameItem) return;
    const newName = document.getElementById('rename-input').value.trim();
    if (!newName) return showAlert('Name is required', 'error');

    try {
        const res = await fetch('/x_doc/rename', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: activeRenameItem.id,
                type: activeRenameItem.type,
                name: newName
            })
        });
        const data = await res.json();
        if (res.ok) {
            showAlert('Renamed successfully', 'success');
            closeModals();
            loadFolderContent(currentFolderId);
        } else {
            showAlert(data.error || 'Error renaming', 'error');
        }
    } catch (e) {
        showAlert('Network error', 'error');
    }
}

// Share item
function shareItem(id, type) {
    activeShareItem = { id, type };
    const modal = document.getElementById('share-modal');
    if (modal) {
        clearSelectedUser();
        modal.classList.add('active');
    }
}

async function searchUsers(query) {
    const resultsContainer = document.getElementById('user-search-results');
    if (!resultsContainer) return;

    if (query.length < 3) {
        resultsContainer.classList.add('d-none');
        return;
    }

    try {
        const res = await fetch(`/x_doc/users/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();

        if (data.users && data.users.length > 0) {
            resultsContainer.innerHTML = data.users.map(user => `
                <div class="list-group-item list-group-item-action d-flex align-items-center gap-2 cursor-pointer" 
                    onclick="selectUser(${JSON.stringify(user).replace(/"/g, '&quot;')})">
                    <div class="shared-user-avatar small">${user.avatar}</div>
                    <div class="flex-grow-1">
                        <div class="fw-bold small">${user.name}</div>
                        <div class="extra-small text-muted">${user.email}</div>
                    </div>
                </div>
            `).join('');
            resultsContainer.classList.remove('d-none');
        } else {
            resultsContainer.innerHTML = '<div class="list-group-item small text-muted">No users found</div>';
            resultsContainer.classList.remove('d-none');
        }
    } catch (e) {
        console.error('Search error', e);
    }
}

function selectUser(user) {
    selectedShareUser = user;
    document.getElementById('user-search-results').classList.add('d-none');
    document.getElementById('share-user-search').value = user.email;

    const preview = document.getElementById('selected-user-preview');
    document.getElementById('selected-user-name').textContent = user.name;
    document.getElementById('selected-user-email').textContent = user.email;
    document.getElementById('selected-user-avatar').textContent = user.avatar;

    preview.classList.remove('d-none');
    document.getElementById('confirm-share').classList.remove('d-none');
}

function clearSelectedUser() {
    selectedShareUser = null;
    document.getElementById('selected-user-preview').classList.add('d-none');
    document.getElementById('confirm-share').classList.add('d-none');
    document.getElementById('share-user-search').value = '';
    document.getElementById('user-search-results').classList.add('d-none');
}

async function executeShare() {
    if (!activeShareItem || !selectedShareUser) return;

    const permission = document.getElementById('share-permission').value;

    try {
        const res = await fetch('/x_doc/share', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                item_id: activeShareItem.id,
                item_type: activeShareItem.type,
                email: selectedShareUser.email,
                permission: permission
            })
        });
        const data = await res.json();
        if (res.ok) {
            showAlert('Shared successfully', 'success');
            closeModals();
        } else {
            showAlert(data.error || 'Error sharing', 'error');
        }
    } catch (e) {
        showAlert('Network error', 'error');
    }
}

window.selectUser = selectUser;

// Show details in offcanvas
function showDetails(id, type) {
    const item = type === 'folder' ? folders.find(f => f.id === id) : documents.find(d => d.id === id);
    if (!item) return;

    let offcanvas = document.getElementById('details-offcanvas');
    if (!offcanvas) {
        createDetailsOffcanvas();
        offcanvas = document.getElementById('details-offcanvas');
    }

    // Populate basic info
    document.getElementById('offcanvas-title').textContent = type === 'folder' ? item.name : item.original_filename;
    document.getElementById('offcanvas-icon').className = type === 'folder' ? 'bi bi-folder-fill text-warning' : 'bi ' + getFileIcon(item.original_filename);
    document.getElementById('offcanvas-type').textContent = type === 'folder' ? 'Folder' : (item.mime_type || 'Document');
    document.getElementById('offcanvas-size').textContent = type === 'folder' ? '-' : formatSize(item.size);
    document.getElementById('offcanvas-created').textContent = new Date(item.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
    document.getElementById('offcanvas-status').textContent = type === 'folder' ? 'Local' : (item.status || 'Active');
    document.getElementById('offcanvas-id').textContent = '#' + id;

    // Load shared users (mock data - replace with API call)
    loadSharedUsers(id, type);

    // Load name history (mock data - replace with API call)
    loadNameHistory(id, type);

    // Show offcanvas with overlay
    document.getElementById('offcanvas-overlay').classList.add('active');
    offcanvas.classList.add('active');
}

function createDetailsOffcanvas() {
    // Create overlay
    const overlay = document.createElement('div');
    overlay.id = 'offcanvas-overlay';
    overlay.className = 'offcanvas-overlay';
    overlay.onclick = closeDetailsOffcanvas;
    document.body.appendChild(overlay);

    const offcanvas = document.createElement('div');
    offcanvas.id = 'details-offcanvas';
    offcanvas.className = 'details-offcanvas';
    offcanvas.innerHTML = `
        <div class="offcanvas-header">
            <div class="offcanvas-title-section">
                <i id="offcanvas-icon" class="bi bi-file-earmark offcanvas-icon"></i>
                <div>
                    <h5 id="offcanvas-title">Details</h5>
                    <span class="offcanvas-id" id="offcanvas-id">#0</span>
                </div>
            </div>
            <button class="offcanvas-close" onclick="closeDetailsOffcanvas()">
                <i class="bi bi-x-lg"></i>
            </button>
        </div>
        
        <div class="offcanvas-tabs">
            <button class="offcanvas-tab active" onclick="switchOffcanvasTab('info')">
                <i class="bi bi-info-circle"></i> Info
            </button>
            <button class="offcanvas-tab" onclick="switchOffcanvasTab('shared')">
                <i class="bi bi-people"></i> Shared
            </button>
            <button class="offcanvas-tab" onclick="switchOffcanvasTab('history')">
                <i class="bi bi-clock-history"></i> History
            </button>
        </div>
        
        <div class="offcanvas-body">
            <!-- Info Tab -->
            <div id="tab-info" class="offcanvas-tab-content active">
                <div class="info-card">
                    <div class="info-row">
                        <div class="info-item">
                            <i class="bi bi-file-earmark"></i>
                            <div>
                                <label>Type</label>
                                <span id="offcanvas-type">-</span>
                            </div>
                        </div>
                        <div class="info-item">
                            <i class="bi bi-hdd"></i>
                            <div>
                                <label>Size</label>
                                <span id="offcanvas-size">-</span>
                            </div>
                        </div>
                    </div>
                    <div class="info-row">
                        <div class="info-item">
                            <i class="bi bi-calendar"></i>
                            <div>
                                <label>Created</label>
                                <span id="offcanvas-created">-</span>
                            </div>
                        </div>
                        <div class="info-item">
                            <i class="bi bi-check-circle"></i>
                            <div>
                                <label>Status</label>
                                <span id="offcanvas-status">-</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- Shared Tab -->
            <div id="tab-shared" class="offcanvas-tab-content">
                <div class="shared-section">
                    <div class="shared-header">
                        <span>Shared with</span>
                        <button class="btn-add-share" onclick="openShareModal()">
                            <i class="bi bi-plus"></i> Add
                        </button>
                    </div>
                    <div id="shared-users-list" class="shared-users-list">
                        <div class="empty-state-small">
                            <i class="bi bi-person-x"></i>
                            <p>Not shared with anyone</p>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- History Tab -->
            <div id="tab-history" class="offcanvas-tab-content">
                <div class="history-section">
                    <div class="history-header">
                        <span>Name Changes</span>
                    </div>
                    <div id="name-history-list" class="history-list">
                        <div class="empty-state-small">
                            <i class="bi bi-clock"></i>
                            <p>No changes recorded</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(offcanvas);
}

function switchOffcanvasTab(tab) {
    document.querySelectorAll('.offcanvas-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.offcanvas-tab-content').forEach(c => c.classList.remove('active'));
    document.querySelector(`.offcanvas-tab[onclick*="${tab}"]`).classList.add('active');
    document.getElementById('tab-' + tab).classList.add('active');
}

function loadSharedUsers(id, type) {
    const container = document.getElementById('shared-users-list');

    // Show loading state
    container.innerHTML = `<div class="text-center py-3"><div class="spinner-border spinner-border-sm text-primary" role="status"></div></div>`;

    fetch(`/x_doc/shared/${type}/${id}`)
        .then(res => res.json())
        .then(data => {
            const shares = data.shares || [];

            if (shares.length === 0) {
                container.innerHTML = `<div class="empty-state-small"><i class="bi bi-person-x"></i><p>Not shared with anyone</p></div>`;
                return;
            }

            container.innerHTML = shares.map(share => {
                const user = share.user || {};
                return `
                    <div class="shared-user">
                        <div class="shared-user-avatar">${user.avatar || 'U'}</div>
                        <div class="shared-user-info">
                            <div class="shared-user-name">${user.name || 'Unknown User'}</div>
                            <div class="shared-user-email">${user.email || ''}</div>
                        </div>
                        <span class="shared-user-permission">${share.permission || 'Viewer'}</span>
                    </div>
                `;
            }).join('');
        })
        .catch(err => {
            console.error('Error loading shared users:', err);
            container.innerHTML = `<div class="empty-state-small"><i class="bi bi-person-x"></i><p>Not shared with anyone</p></div>`;
        });
}

function loadNameHistory(id, type) {
    const container = document.getElementById('name-history-list');

    // Show loading state
    container.innerHTML = `<div class="text-center py-3"><div class="spinner-border spinner-border-sm text-primary" role="status"></div></div>`;

    fetch(`/x_doc/history/${type}/${id}`)
        .then(res => res.json())
        .then(data => {
            const history = data.history || [];

            if (history.length === 0) {
                container.innerHTML = `<div class="empty-state-small"><i class="bi bi-clock"></i><p>No changes recorded</p></div>`;
                return;
            }

            container.innerHTML = history.map(h => {
                return `
                    <div class="history-item">
                        <div class="history-icon"><i class="bi bi-pencil"></i></div>
                        <div class="history-content">
                            <div class="history-change">
                                <span class="old-name">${h.old_value || 'N/A'}</span>
                                <i class="bi bi-arrow-right"></i>
                                <span class="new-name">${h.new_value || 'N/A'}</span>
                            </div>
                            <div class="history-meta">
                                <span>${h.user || 'You'}</span> • <span>${h.date || ''}</span>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        })
        .catch(err => {
            console.error('Error loading history:', err);
            container.innerHTML = `<div class="empty-state-small"><i class="bi bi-clock"></i><p>No changes recorded</p></div>`;
        });
}

function openShareModal() {
    showAlert('Share modal coming soon', 'info');
}

function closeDetailsOffcanvas() {
    const offcanvas = document.getElementById('details-offcanvas');
    const overlay = document.getElementById('offcanvas-overlay');
    if (offcanvas) offcanvas.classList.remove('active');
    if (overlay) overlay.classList.remove('active');
}

// Expose functions globally
window.toggleCardMenu = toggleCardMenu;
window.shareItem = shareItem;
window.renameItem = renameItem;
window.showDetails = showDetails;
window.openDeleteModal = openDeleteModal;
window.closeDetailsOffcanvas = closeDetailsOffcanvas;
window.switchOffcanvasTab = switchOffcanvasTab;
window.openShareModal = openShareModal;

// ==========================================
// MOVE DOCUMENTS FUNCTIONALITY
// ==========================================
let activeMoveItem = null;

function openMoveModal(id, type) {
    activeMoveItem = { id, type };
    const modal = document.getElementById('move-modal');
    if (modal) {
        loadFolderTree();
        modal.classList.add('active');
    }
}

async function loadFolderTree() {
    const container = document.getElementById('folder-tree-container');
    if (!container) return;

    container.innerHTML = '<div class="text-center py-3"><div class="spinner-border spinner-border-sm text-primary" role="status"></div></div>';

    try {
        const res = await fetch('/x_doc/folders/tree');
        const data = await res.json();
        container.innerHTML = renderFolderTree(data.tree, activeMoveItem);
    } catch (e) {
        container.innerHTML = '<div class="text-danger">Error loading folders</div>';
    }
}

function renderFolderTree(tree, excludeItem = null) {
    if (!tree || tree.length === 0) return '<div class="text-muted small">No folders</div>';

    return tree.map(folder => {
        // Exclude the item being moved (if it's a folder)
        if (excludeItem && excludeItem.type === 'folder' && folder.id === excludeItem.id) return '';

        const isRoot = folder.id === null;
        const hasChildren = folder.children && folder.children.length > 0;

        return `
            <div class="folder-tree-item" data-folder-id="${folder.id}">
                <div class="folder-tree-row" onclick="selectMoveTarget(${folder.id === null ? 'null' : folder.id})">
                    <i class="bi ${isRoot ? 'bi-house' : 'bi-folder'}"></i>
                    <span>${folder.name}</span>
                </div>
                ${hasChildren ? `<div class="folder-tree-children">${renderFolderTree(folder.children, excludeItem)}</div>` : ''}
            </div>
        `;
    }).join('');
}

let selectedMoveTarget = null;

function selectMoveTarget(folderId) {
    selectedMoveTarget = folderId;
    document.querySelectorAll('.folder-tree-row').forEach(el => el.classList.remove('selected'));
    const row = document.querySelector(`.folder-tree-item[data-folder-id="${folderId}"] > .folder-tree-row`);
    if (row) row.classList.add('selected');
    document.getElementById('confirm-move').disabled = false;
}

async function executeMove() {
    if (!activeMoveItem) return;

    try {
        const res = await fetch('/x_doc/organize/move-to', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                item_id: activeMoveItem.id,
                type: activeMoveItem.type,
                target_folder_id: selectedMoveTarget
            })
        });

        if (res.ok) {
            showAlert('Item moved successfully', 'success');
            closeMoveModal();
            loadFolderContent(currentFolderId);
        } else {
            const data = await res.json();
            showAlert(data.error || 'Error moving item', 'error');
        }
    } catch (e) {
        showAlert('Network error', 'error');
    }
}

function closeMoveModal() {
    const modal = document.getElementById('move-modal');
    if (modal) modal.classList.remove('active');
    activeMoveItem = null;
    selectedMoveTarget = null;
}

// ==========================================
// TAGS MANAGEMENT
// ==========================================
let userTags = [];

async function loadUserTags() {
    try {
        const res = await fetch('/x_doc/tags');
        const data = await res.json();
        userTags = data.tags || [];
        return userTags;
    } catch (e) {
        console.error('Error loading tags:', e);
        return [];
    }
}

async function createTag(name, color = '#007bff') {
    try {
        const res = await fetch('/x_doc/tags', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, color })
        });
        const data = await res.json();
        if (res.ok) {
            userTags.push(data.tag);
            return data.tag;
        }
        showAlert(data.error || 'Error creating tag', 'error');
        return null;
    } catch (e) {
        showAlert('Network error', 'error');
        return null;
    }
}

async function assignTagToFile(fileId, tagId) {
    try {
        const res = await fetch(`/x_doc/files/${fileId}/tags`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tag_id: tagId })
        });
        return res.ok;
    } catch (e) {
        return false;
    }
}

async function removeTagFromFile(fileId, tagId) {
    try {
        const res = await fetch(`/x_doc/files/${fileId}/tags/${tagId}`, {
            method: 'DELETE'
        });
        return res.ok;
    } catch (e) {
        return false;
    }
}

async function getFileTags(fileId) {
    try {
        const res = await fetch(`/x_doc/files/${fileId}/tags`);
        const data = await res.json();
        return data.tags || [];
    } catch (e) {
        return [];
    }
}

function renderTagPills(tags) {
    if (!tags || tags.length === 0) return '<span class="text-muted small">No tags</span>';
    return tags.map(tag => `
        <span class="tag-pill" style="background: ${tag.color}20; color: ${tag.color}; border: 1px solid ${tag.color}40">
            ${tag.name}
        </span>
    `).join('');
}

// ==========================================
// STATUS MANAGEMENT
// ==========================================
const VALID_STATUSES = ['Borrador', 'En revisión', 'Validado', 'Archivado'];

async function updateFileStatus(fileId, newStatus) {
    try {
        const res = await fetch(`/x_doc/files/${fileId}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus })
        });
        const data = await res.json();
        if (res.ok) {
            showAlert('Status updated', 'success');
            loadFolderContent(currentFolderId);
            return true;
        }
        showAlert(data.error || 'Error updating status', 'error');
        return false;
    } catch (e) {
        showAlert('Network error', 'error');
        return false;
    }
}

function getStatusBadgeClass(status) {
    const classes = {
        'Borrador': 'status-badge-draft',
        'En revisión': 'status-badge-review',
        'Validado': 'status-badge-validated',
        'Archivado': 'status-badge-archived'
    };
    return classes[status] || 'status-badge-draft';
}

function renderStatusBadge(status) {
    return `<span class="status-badge ${getStatusBadgeClass(status)}">${status}</span>`;
}

// ==========================================
// STACKED AVATARS FOR SHARED ITEMS
// ==========================================
async function loadSharedAvatars(itemType, itemId) {
    try {
        const res = await fetch(`/x_doc/shared/${itemType}/${itemId}/avatars`);
        const data = await res.json();
        return data;
    } catch (e) {
        return { avatars: [], total_shared: 0, has_more: false };
    }
}

function renderSharedAvatarsStack(avatars, hasMore = false, total = 0) {
    if (!avatars || avatars.length === 0) return '';

    const avatarHtml = avatars.slice(0, 4).map((avatar, index) => `
        <div class="shared-avatar-circle" style="z-index: ${10 - index}" title="${avatar.name} (${avatar.permission})">
            ${avatar.initials}
        </div>
    `).join('');

    const moreHtml = total > 4 ? `<div class="shared-avatar-more">+${total - 4}</div>` : '';

    return `<div class="shared-avatars-stack">${avatarHtml}${moreHtml}</div>`;
}

// ==========================================
// ENHANCED SHARE MODAL
// ==========================================
async function executeEnhancedShare() {
    if (!activeShareItem || !selectedShareUser) return;

    const permission = document.getElementById('share-permission').value;
    const expiresAtInput = document.getElementById('share-expires-at');
    const expiresAt = expiresAtInput ? expiresAtInput.value : null;

    try {
        const res = await fetch('/x_doc/share/enhanced', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                item_type: activeShareItem.type,
                item_id: activeShareItem.id,
                email: selectedShareUser.email,
                permission: permission,
                expires_at: expiresAt || null
            })
        });
        const data = await res.json();
        if (res.ok) {
            showAlert('Shared successfully', 'success');
            closeModals();
            loadFolderContent(currentFolderId);
        } else {
            showAlert(data.error || 'Error sharing', 'error');
        }
    } catch (e) {
        showAlert('Network error', 'error');
    }
}

// Expose new functions globally
window.openMoveModal = openMoveModal;
window.closeMoveModal = closeMoveModal;
window.selectMoveTarget = selectMoveTarget;
window.executeMove = executeMove;
window.loadUserTags = loadUserTags;
window.createTag = createTag;
window.assignTagToFile = assignTagToFile;
window.removeTagFromFile = removeTagFromFile;
window.updateFileStatus = updateFileStatus;
window.executeEnhancedShare = executeEnhancedShare;
window.restoreItem = restoreItem;
window.permanentDeleteItem = permanentDeleteItem;

// ========================================
// CLOUD STORAGE INTEGRATION
// ========================================

// Cloud storage state
let connectedStorages = [];
let activeCloudProvider = null;
window.activeCloudProvider = null;
let cloudFiles = [];

// Provider display names and icons
const PROVIDER_CONFIG = {
    google_drive: { name: 'Google Drive', icon: 'google-drive.svg', color: '#4285f4' },
    dropbox: { name: 'Dropbox', icon: 'dropbox.svg', color: '#0061fe' },
    box: { name: 'Box', icon: 'box.svg', color: '#0061d5' },
    onedrive: { name: 'OneDrive', icon: 'onedrive.svg', color: '#0078d4' },
    pcloud: { name: 'pCloud', icon: 'pcloud.svg', color: '#20c4cb' },
    mega: { name: 'MEGA', icon: 'mega.svg', color: '#d9272e' },
    yandex: { name: 'Yandex Disk', icon: 'yandex.svg', color: '#ffcc00' }
};

// Initialize cloud storage on page load
async function initCloudStorage() {
    // setupStorageIconListeners(); // Desactivado para evitar doble carga (StorageManager se encarga)
    setupStorageDropdownToggle();

    // Check if we just connected a provider (from OAuth callback)
    // StorageManager también maneja esto, pero mantenemos una alerta si es necesario
    const urlParams = new URLSearchParams(window.location.search);
    const connectedProvider = urlParams.get('connected');
    if (connectedProvider) {
        // Show success message
        const providerName = PROVIDER_CONFIG[connectedProvider]?.name || connectedProvider;
        showAlert(`Successfully connected to ${providerName}!`, 'success');

        // Clean the URL
        window.history.replaceState({}, document.title, window.location.pathname);

        // Create tabs container if needed and open the provider tab
        setTimeout(() => {
            openCloudStorageTab(connectedProvider);
        }, 500);
    }
}

// Check which storages are connected
async function checkConnectedStorages() {
    try {
        const res = await fetch('/x_integ/storage/connected');
        if (res.ok) {
            const data = await res.json();
            connectedStorages = data.connected_storages || [];
            updateStorageIconsStatus();
        }
    } catch (e) {
        console.log('Could not check connected storages:', e);
    }
}

// Update storage icons to show connection status
function updateStorageIconsStatus() {
    document.querySelectorAll('.storage-icon').forEach(icon => {
        const provider = icon.dataset.provider;
        const isConnected = connectedStorages.some(s => s.provider === provider);

        if (isConnected) {
            icon.classList.add('connected');
            const providerName = PROVIDER_CONFIG[provider]?.name || provider;
            icon.title = `Connected to ${providerName} - Click to view files`;
        } else {
            icon.classList.remove('connected');
            const providerName = PROVIDER_CONFIG[provider]?.name || provider;
            icon.title = `Connect to ${providerName}`;
        }
    });
}

// Setup click listeners for storage icons
function setupStorageIconListeners() {
    document.querySelectorAll('.storage-icon').forEach(icon => {
        icon.addEventListener('click', async () => {
            const provider = icon.dataset.provider;
            const isConnected = connectedStorages.some(s => s.provider === provider);

            if (isConnected) {
                // Open cloud storage tab and load files
                openCloudStorageTab(provider);
            } else {
                // Redirect to OAuth connection
                connectCloudStorage(provider);
            }
        });
    });
}

// Setup dropdown toggle for white actions button
function setupStorageDropdownToggle() {
    const dropdown = document.querySelector('.white-actions-dropdown');
    const btn = dropdown?.querySelector('.white-actions-btn');

    if (btn && dropdown) {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.classList.toggle('active');
        });

        // Close when clicking outside
        document.addEventListener('click', (e) => {
            if (!dropdown.contains(e.target)) {
                dropdown.classList.remove('active');
            }
        });
    }
}

// Connect to a cloud storage provider (OAuth flow)
function connectCloudStorage(provider) {
    // Redirect to OAuth endpoint
    window.location.href = `/x_integ/storage/connect/${provider}`;
}

// Disconnect from a cloud storage provider
async function disconnectCloudStorage(provider) {
    try {
        const res = await fetch(`/x_integ/storage/disconnect/${provider}`);
        if (res.ok) {
            showAlert(`Disconnected from ${PROVIDER_CONFIG[provider]?.name || provider}`, 'success');
            await checkConnectedStorages();
            removeCloudStorageTab(provider);
        } else {
            showAlert('Error disconnecting storage', 'error');
        }
    } catch (e) {
        showAlert('Network error', 'error');
    }
}

// Open a cloud storage tab
function openCloudStorageTab(provider) {
    const tabsContainer = document.getElementById('storageTabs');
    if (!tabsContainer) {
        // Create tabs container if doesn't exist
        createStorageTabsContainer();
    }

    // Check if tab already exists
    const existingTab = document.querySelector(`.storage-tab[data-storage="${provider}"]`);
    if (existingTab) {
        switchToStorageTab(provider);
        return;
    }

    // Create new tab
    const config = PROVIDER_CONFIG[provider] || { name: provider, icon: 'cloud.svg' };
    const tab = document.createElement('div');
    tab.className = 'storage-tab';
    tab.dataset.storage = provider;
    tab.innerHTML = `
        <img src="/static/img/svg/${config.icon}" alt="${config.name}" style="width: 16px; height: 16px;">
        <span>${config.name}</span>
        <button class="tab-close" onclick="event.stopPropagation(); closeCloudStorageTab('${provider}')"></button>
    `;
    tab.addEventListener('click', () => switchToStorageTab(provider));

    // Add tab to container or create container
    const tabs = document.getElementById('storageTabs');
    if (tabs) {
        tabs.appendChild(tab);
    }

    // Switch to the new tab and load files
    switchToStorageTab(provider);

    // Close the dropdown
    document.querySelector('.white-actions-dropdown')?.classList.remove('active');
}

// Create storage tabs container if it doesn't exist
function createStorageTabsContainer() {
    const existingContainer = document.querySelector('.storage-tabs-container');
    if (existingContainer) return;

    const container = document.createElement('div');
    container.className = 'storage-tabs-container';
    container.innerHTML = `
        <div class="storage-tabs" id="storageTabs">
            <div class="storage-tab active" data-storage="native">
                <i class="bi bi-hdd"></i>
                <span>My Files</span>
            </div>
        </div>
    `;

    // Insert after breadcrumbs container
    const breadcrumbs = document.querySelector('.breadcrumbs-container');
    if (breadcrumbs) {
        breadcrumbs.insertAdjacentElement('afterend', container);
    }

    // Add click listener to native tab
    container.querySelector('.storage-tab[data-storage="native"]')?.addEventListener('click', () => {
        switchToStorageTab('native');
    });
}

// Switch to a storage tab
async function switchToStorageTab(storage) {
    // Update active tab
    document.querySelectorAll('.storage-tab').forEach(t => t.classList.remove('active'));
    const targetTab = document.querySelector(`.storage-tab[data-storage="${storage}"]`);
    if (targetTab) targetTab.classList.add('active');

    if (storage === 'native') {
        // Load native files
        activeCloudProvider = null;
        window.activeCloudProvider = null;
        loadFolderContent(currentFolderId);

        // Hide upload toast when returning to native files
        if (window.uploadToast) {
            window.uploadToast.hide();
        }
    } else {
        // Load cloud files
        activeCloudProvider = storage;
        window.activeCloudProvider = storage;
        await loadCloudFiles(storage);

        // Automatically show and expand upload toast for cloud storage
        if (typeof openUploadToast === 'function') {
            openUploadToast();
        } else if (window.uploadToast) {
            window.uploadToast.show();
            window.uploadToast.expand();
        }
        // Ensure provider icon is updated after toast is visible
        if (window.uploadToast && typeof window.uploadToast.updateProviderIcon === 'function') {
            window.uploadToast.updateProviderIcon();
        }
    }
}

// Close a cloud storage tab
function closeCloudStorageTab(provider) {
    const tab = document.querySelector(`.storage-tab[data-storage="${provider}"]`);
    if (tab) {
        tab.remove();
        // Switch to native if closing active tab
        if (activeCloudProvider === provider) {
            switchToStorageTab('native');
        }
    }
}

// Remove cloud storage tab (alias for closeCloudStorageTab)
function removeCloudStorageTab(provider) {
    closeCloudStorageTab(provider);
}

// Load files from a cloud storage provider
async function loadCloudFiles(provider) {
    const grid = document.getElementById('cardView');
    if (!grid) return;

    // Show loading state
    grid.innerHTML = `
        <div class="cloud-loading" style="grid-column: 1 / -1;">
            <div class="spinner"></div>
            <p>Loading files from ${PROVIDER_CONFIG[provider]?.name || provider}...</p>
        </div>
    `;

    try {
        const res = await fetch(`/x_integ/storage/files/${provider}`);
        if (res.ok) {
            const data = await res.json();
            cloudFiles = data.files || [];
            renderCloudFiles(cloudFiles, provider);
        } else if (res.status === 401) {
            grid.innerHTML = `
                <div class="cloud-loading" style="grid-column: 1 / -1;">
                    <i class="bi bi-exclamation-circle" style="font-size: 2rem; color: #ef4444;"></i>
                    <p>Session expired. Please reconnect.</p>
                    <button class="btn btn-primary btn-sm mt-2" onclick="connectCloudStorage('${provider}')">
                        Reconnect
                    </button>
                </div>
            `;
        } else {
            throw new Error('Failed to load files');
        }
    } catch (e) {
        console.error('Error loading cloud files:', e);
        grid.innerHTML = `
            <div class="cloud-loading" style="grid-column: 1 / -1;">
                <i class="bi bi-exclamation-circle" style="font-size: 2rem; color: #ef4444;"></i>
                <p>Error loading files</p>
            </div>
        `;
    }
}

// Render cloud files in the grid
function renderCloudFiles(files, provider) {
    const grid = document.getElementById('cardView');
    if (!grid) return;

    if (files.length === 0) {
        grid.innerHTML = `
            <div class="cloud-loading" style="grid-column: 1 / -1;">
                <i class="bi bi-folder-x" style="font-size: 2rem; color: #9ca3af;"></i>
                <p>No documents found in ${PROVIDER_CONFIG[provider]?.name || provider}</p>
            </div>
        `;
        return;
    }

    grid.innerHTML = '';

    files.forEach(file => {
        const card = createCloudFileCard(file, provider);
        grid.appendChild(card);
    });
}

// Create a cloud file card
function createCloudFileCard(file, provider) {
    const card = document.createElement('div');
    card.className = 'document-card cloud-file-card';
    card.dataset.id = file.id;
    card.dataset.provider = provider;

    const config = PROVIDER_CONFIG[provider] || {};

    card.innerHTML = `
        <div class="card-menu">
            <button class="card-menu-btn" onclick="event.stopPropagation(); toggleCardMenu(this)">
                <i class="bi bi-three-dots-vertical"></i>
            </button>
            <div class="card-dropdown">
                <div class="dropdown-item" onclick="event.stopPropagation(); viewCloudFile('${file.download_url || ''}', '${file.name}')">
                    <i class="bi bi-eye"></i> View
                </div>
                <div class="dropdown-item" onclick="event.stopPropagation(); downloadCloudFile('${file.download_url || ''}', '${file.name}')">
                    <i class="bi bi-download"></i> Download
                </div>
                <div class="dropdown-divider"></div>
                <div class="dropdown-item" onclick="event.stopPropagation(); importCloudFile('${file.id}', '${provider}', '${file.name.replace(/'/g, "\\'")}')">
                    <i class="bi bi-box-arrow-in-down"></i> Import to My Files
                </div>
            </div>
        </div>
        <div class="card-icon"><i class="bi ${getFileIcon(file.name)}"></i></div>
        <div class="card-info">
            <h3 class="card-title" title="${file.name}">${file.name}</h3>
            <p class="card-meta">${formatSize(file.size || 0)}</p>
        </div>
        <div class="cloud-badge" title="${config.name}">
            <img src="/static/img/svg/${config.icon}" alt="${config.name}">
        </div>
    `;

    return card;
}

// View a cloud file
function viewCloudFile(url, filename) {
    if (url) {
        window.open(url, '_blank');
    } else {
        showAlert('Preview not available', 'warning');
    }
}

// Download a cloud file
function downloadCloudFile(url, filename) {
    if (url) {
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.target = '_blank';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } else {
        showAlert('Download not available', 'warning');
    }
}

// Import a cloud file to native storage
async function importCloudFile(fileId, provider, filename) {
    showAlert(`Importing ${filename}...`, 'info');

    // This would need a backend endpoint to download from cloud and save locally
    try {
        const res = await fetch('/x_doc/import-cloud-file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                file_id: fileId,
                provider: provider,
                filename: filename,
                folder_id: currentFolderId
            })
        });

        if (res.ok) {
            showAlert(`${filename} imported successfully!`, 'success');
            // Optionally switch to native files tab
            switchToStorageTab('native');
        } else {
            const data = await res.json();
            showAlert(data.error || 'Import failed', 'error');
        }
    } catch (e) {
        showAlert('Import feature coming soon', 'info');
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    // Instantiate Storage Manager
    if (typeof StorageManager !== 'undefined') {
        window.storageManager = new StorageManager();
    } else {
        console.error('StorageManager class not found. Make sure storage_manager_js.js is loaded.');
    }

    initCloudStorage();

    // Legacy: expose for console debugging if needed
    window.updateStatsPanel = () => {
        if (window.storageManager) window.storageManager.updateStatsPanel();
    }

    // Robust Fallback: Delegated listener for Stats Button
    document.body.addEventListener('click', (e) => {
        if (e.target.closest('#stats-storage-btn')) {
            if (window.storageManager) {
                window.storageManager.toggleStatsPanel();
            } else {
                console.error('StorageManager not initialized');
            }
        }
    });
});

// Expose cloud storage functions globally
window.initCloudStorage = initCloudStorage;
window.connectCloudStorage = connectCloudStorage;
window.disconnectCloudStorage = disconnectCloudStorage;
window.openCloudStorageTab = openCloudStorageTab;
window.closeCloudStorageTab = closeCloudStorageTab;
window.switchToStorageTab = switchToStorageTab;
window.loadCloudFiles = loadCloudFiles;
window.viewCloudFile = viewCloudFile;
window.downloadCloudFile = downloadCloudFile;
window.importCloudFile = importCloudFile;