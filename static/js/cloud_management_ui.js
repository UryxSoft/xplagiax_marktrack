/**
 * Cloud Storage Management UI Controller
 * Handles context menus, modals, and UI interactions for cloud storage operations
 * Works with StorageManager class for API calls
 */

// ============================================================
// CLOUD CONTEXT MENU
// ============================================================

let cloudContextMenuTarget = null;
let cloudContextMenuType = null;

function initCloudContextMenu() {
    const contextMenu = document.getElementById('cloud-context-menu');
    if (!contextMenu) return;

    // Close menu on click outside
    document.addEventListener('click', (e) => {
        if (!contextMenu.contains(e.target)) {
            hideCloudContextMenu();
        }
    });

    // Handle context menu actions
    contextMenu.querySelectorAll('.context-menu-item').forEach(item => {
        item.addEventListener('click', () => {
            const action = item.dataset.action;
            handleCloudContextAction(action);
            hideCloudContextMenu();
        });
    });

    // Close on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            hideCloudContextMenu();
        }
    });
}

function showCloudContextMenu(e, item, itemType) {
    e.preventDefault();
    e.stopPropagation();

    // Only show for cloud storage items
    if (!window.storageManager || window.storageManager.currentStorage === 'native') {
        return;
    }

    const contextMenu = document.getElementById('cloud-context-menu');
    if (!contextMenu) return;

    cloudContextMenuTarget = item;
    cloudContextMenuType = itemType;

    // Update context menu title
    const title = document.getElementById('context-menu-title');
    if (title) {
        const icon = itemType === 'folder' ? 'bi-folder-fill' : 'bi-file-earmark';
        const name = item.name || item.title || 'Item';
        title.innerHTML = `<i class="bi ${icon}"></i><span>${truncateText(name, 20)}</span>`;
    }

    // Show/hide download option based on type
    const downloadItem = contextMenu.querySelector('[data-action="download"]');
    if (downloadItem) {
        downloadItem.style.display = itemType === 'folder' ? 'none' : 'flex';
    }

    // Show/hide open option based on type
    const openItem = contextMenu.querySelector('[data-action="open"]');
    if (openItem) {
        openItem.style.display = itemType === 'folder' ? 'flex' : 'none';
    }

    // Position the menu
    const x = e.clientX;
    const y = e.clientY;

    contextMenu.style.left = `${Math.min(x, window.innerWidth - 200)}px`;
    contextMenu.style.top = `${Math.min(y, window.innerHeight - 250)}px`;
    contextMenu.classList.add('active');
}

function hideCloudContextMenu() {
    const contextMenu = document.getElementById('cloud-context-menu');
    if (contextMenu) {
        contextMenu.classList.remove('active');
    }
    cloudContextMenuTarget = null;
    cloudContextMenuType = null;
}

function handleCloudContextAction(action) {
    if (!cloudContextMenuTarget || !window.storageManager) return;

    const sm = window.storageManager;
    const item = cloudContextMenuTarget;
    const type = cloudContextMenuType;

    switch (action) {
        case 'open':
            if (type === 'folder') {
                sm.openCloudFolder(item.id, item.name);
            }
            break;
        case 'rename':
            openCloudRenameModal(item, type);
            break;
        case 'move':
            openCloudFolderPicker(item, type);
            break;
        case 'download':
            if (type === 'file') {
                sm.downloadCloudFile(item.id, item.name);
            }
            break;
        case 'delete':
            openCloudDeleteModal(item, type);
            break;
    }
}

// ============================================================
// CLOUD RENAME MODAL
// ============================================================

let renameTarget = null;
let renameTargetType = null;

function openCloudRenameModal(item, type) {
    renameTarget = item;
    renameTargetType = type;

    const modal = document.getElementById('cloud-rename-modal');
    const input = document.getElementById('cloud-rename-input');
    const currentName = document.getElementById('cloud-current-name');

    if (!modal || !input) return;

    const name = item.name || item.title || '';
    input.value = name;
    if (currentName) currentName.textContent = name;

    modal.classList.add('active');
    input.focus();
    input.select();
}

function closeCloudRenameModal() {
    const modal = document.getElementById('cloud-rename-modal');
    if (modal) modal.classList.remove('active');
    renameTarget = null;
    renameTargetType = null;
}

async function confirmCloudRename() {
    if (!renameTarget || !window.storageManager) return;

    const input = document.getElementById('cloud-rename-input');
    const newName = input?.value?.trim();
    const currentName = renameTarget.name || renameTarget.title || '';

    if (!newName) {
        showToast('Please enter a name', 'warning');
        return;
    }

    if (newName === currentName) {
        closeCloudRenameModal();
        return;
    }

    const sm = window.storageManager;

    // Call the backend directly with the new name
    const endpoint = renameTargetType === 'folder'
        ? `/x_integ/storage/folder/rename/${sm.currentStorage}`
        : `/x_integ/storage/file/rename/${sm.currentStorage}`;

    const bodyKey = renameTargetType === 'folder' ? 'folder_id' : 'file_id';

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [bodyKey]: renameTarget.id, new_name: newName })
        });

        const result = await response.json();
        if (result.success) {
            showToast('Renamed successfully', 'success');
            await sm.loadStorageContent(sm.currentStorage, sm.cloudFolderId);
        } else {
            showToast(result.error || 'Failed to rename', 'error');
        }
    } catch (error) {
        console.error('Rename error:', error);
        showToast('Failed to rename', 'error');
    }

    closeCloudRenameModal();
}


// ============================================================
// CLOUD DELETE MODAL
// ============================================================

let deleteTarget = null;
let deleteTargetType = null;

function openCloudDeleteModal(item, type) {
    deleteTarget = item;
    deleteTargetType = type;

    const modal = document.getElementById('cloud-delete-modal');
    const title = document.getElementById('cloud-delete-title');
    const message = document.getElementById('cloud-delete-message');
    const folderWarning = document.getElementById('cloud-folder-delete-warning');
    const restoreInfo = document.getElementById('cloud-delete-restore-info');

    if (!modal) return;

    const name = item.name || item.title || 'this item';

    if (title) title.textContent = `Delete "${truncateText(name, 30)}"?`;
    if (message) message.textContent = `This will move ${type === 'folder' ? 'the folder' : 'the file'} to trash.`;

    if (folderWarning) {
        folderWarning.classList.toggle('d-none', type !== 'folder');
    }

    // Show restore info based on provider capabilities
    if (restoreInfo) {
        const sm = window.storageManager;
        const provider = sm?.currentStorage || '';
        // Dropbox delete is permanent, others have trash
        if (provider === 'dropbox') {
            restoreInfo.innerHTML = '<i class="bi bi-exclamation-triangle"></i> Warning: Dropbox delete may be permanent.';
            restoreInfo.classList.remove('alert-info');
            restoreInfo.classList.add('alert-warning');
        } else {
            restoreInfo.innerHTML = '<i class="bi bi-recycle"></i> You can restore from the cloud provider\'s trash.';
            restoreInfo.classList.remove('alert-warning');
            restoreInfo.classList.add('alert-info');
        }
    }

    modal.classList.add('active');
}

function closeCloudDeleteModal() {
    const modal = document.getElementById('cloud-delete-modal');
    if (modal) modal.classList.remove('active');
    deleteTarget = null;
    deleteTargetType = null;
}

async function confirmCloudDelete() {
    if (!deleteTarget || !window.storageManager) return;

    const sm = window.storageManager;
    await sm.deleteCloudItem(deleteTarget.id, deleteTargetType, deleteTarget.name || deleteTarget.title);
    closeCloudDeleteModal();
}

// ============================================================
// CLOUD FOLDER PICKER MODAL (for Move operations)
// ============================================================

let moveTarget = null;
let moveTargetType = null;
let pickerCurrentFolderId = null;
let pickerBreadcrumbs = [{ id: null, name: 'Root' }];
let selectedMoveDestination = null;

function openCloudFolderPicker(item, type) {
    moveTarget = item;
    moveTargetType = type;
    pickerCurrentFolderId = null;
    pickerBreadcrumbs = [{ id: null, name: 'Root' }];
    selectedMoveDestination = null;

    const modal = document.getElementById('cloud-folder-picker-modal');
    const itemName = document.getElementById('move-item-name');
    const itemIcon = document.getElementById('move-item-icon');
    const confirmBtn = document.getElementById('confirm-cloud-move');

    if (!modal) return;

    if (itemName) itemName.textContent = item.name || item.title || 'Item';
    if (itemIcon) {
        itemIcon.className = type === 'folder' ? 'bi bi-folder-fill text-warning' : 'bi bi-file-earmark text-secondary';
    }
    if (confirmBtn) confirmBtn.disabled = true;

    modal.classList.add('active');
    loadPickerFolders(null);
}

function closeCloudFolderPicker() {
    const modal = document.getElementById('cloud-folder-picker-modal');
    if (modal) modal.classList.remove('active');
    moveTarget = null;
    moveTargetType = null;
}

async function loadPickerFolders(folderId) {
    pickerCurrentFolderId = folderId;
    const container = document.getElementById('picker-folder-list');

    if (!container || !window.storageManager) return;

    container.innerHTML = '<div class="text-center text-muted py-4"><i class="bi bi-arrow-repeat spin"></i> Loading...</div>';

    try {
        const sm = window.storageManager;
        const provider = sm.currentStorage;

        let url = `/x_integ/storage/folder/${provider}`;
        if (folderId) {
            url += `/${encodeURIComponent(folderId)}`;
        }

        const response = await fetch(url);
        const data = await response.json();

        renderPickerFolders(data.folders || []);
        renderPickerBreadcrumbs();
    } catch (error) {
        console.error('Error loading folders:', error);
        container.innerHTML = '<div class="text-center text-danger py-4"><i class="bi bi-exclamation-triangle"></i> Error loading folders</div>';
    }
}

function renderPickerFolders(folders) {
    const container = document.getElementById('picker-folder-list');
    if (!container) return;

    // Filter out the folder being moved (can't move to itself)
    const filteredFolders = folders.filter(f => {
        if (moveTargetType === 'folder' && moveTarget) {
            return f.id !== moveTarget.id;
        }
        return true;
    });

    if (filteredFolders.length === 0) {
        container.innerHTML = '<div class="text-center text-muted py-4"><i class="bi bi-folder"></i> No subfolders here</div>';
        return;
    }

    container.innerHTML = filteredFolders.map(folder => `
        <div class="folder-picker-item" data-id="${folder.id}" data-name="${folder.name}">
            <i class="bi bi-folder-fill text-warning"></i>
            <span class="flex-grow-1">${folder.name}</span>
            <i class="bi bi-chevron-right text-muted"></i>
        </div>
    `).join('');

    // Add click handlers
    container.querySelectorAll('.folder-picker-item').forEach(item => {
        item.addEventListener('click', () => {
            const id = item.dataset.id;
            const name = item.dataset.name;

            // Toggle selection
            if (item.classList.contains('selected')) {
                // Double click - navigate into folder
                pickerBreadcrumbs.push({ id, name });
                loadPickerFolders(id);
            } else {
                // Single click - select as destination
                container.querySelectorAll('.folder-picker-item').forEach(i => i.classList.remove('selected'));
                item.classList.add('selected');
                selectedMoveDestination = id;
                document.getElementById('confirm-cloud-move').disabled = false;
            }
        });

        // Double click to navigate into folder
        item.addEventListener('dblclick', () => {
            const id = item.dataset.id;
            const name = item.dataset.name;
            pickerBreadcrumbs.push({ id, name });
            loadPickerFolders(id);
        });
    });
}

function renderPickerBreadcrumbs() {
    const container = document.getElementById('picker-breadcrumbs');
    if (!container) return;

    container.innerHTML = pickerBreadcrumbs.map((crumb, index) => {
        const isLast = index === pickerBreadcrumbs.length - 1;
        const icon = index === 0 ? '<i class="bi bi-house"></i> ' : '';
        return `<span class="picker-crumb ${isLast ? 'active' : ''}" data-index="${index}">${icon}${crumb.name}</span>`;
    }).join(' <i class="bi bi-chevron-right text-muted" style="font-size: 0.7rem;"></i> ');

    // Add click handlers for breadcrumb navigation
    container.querySelectorAll('.picker-crumb').forEach(crumb => {
        crumb.addEventListener('click', () => {
            const index = parseInt(crumb.dataset.index);
            if (index < pickerBreadcrumbs.length - 1) {
                pickerBreadcrumbs = pickerBreadcrumbs.slice(0, index + 1);
                const targetId = pickerBreadcrumbs[index].id;
                loadPickerFolders(targetId);
            }
        });
    });

    // Enable moving to current folder (pickerCurrentFolderId)
    const confirmBtn = document.getElementById('confirm-cloud-move');
    if (confirmBtn) {
        // Always allow moving to the currently viewed folder
        selectedMoveDestination = pickerCurrentFolderId;
        confirmBtn.disabled = false;
    }
}

async function confirmCloudMove() {
    if (!moveTarget || !window.storageManager) return;

    const sm = window.storageManager;
    await sm.moveCloudItem(moveTarget.id, moveTargetType, selectedMoveDestination);
    closeCloudFolderPicker();
}

// ============================================================
// CLOUD CREATE FOLDER MODAL
// ============================================================

function openCloudFolderModal() {
    if (!window.storageManager || window.storageManager.currentStorage === 'native') {
        showToast('Please select a cloud storage first', 'warning');
        return;
    }

    const modal = document.getElementById('cloud-folder-modal');
    const input = document.getElementById('cloud-folder-name-input');
    const parentName = document.getElementById('cloud-folder-parent-name');

    if (!modal) return;

    if (input) input.value = '';

    if (parentName) {
        const sm = window.storageManager;
        const crumbs = sm.cloudBreadcrumbs || [];
        const currentFolder = crumbs.length > 0 ? crumbs[crumbs.length - 1].name : 'Root';
        parentName.textContent = currentFolder;
    }

    modal.classList.add('active');
    if (input) {
        input.focus();
    }
}

function closeCloudFolderModal() {
    const modal = document.getElementById('cloud-folder-modal');
    if (modal) modal.classList.remove('active');
}

async function confirmCloudFolderCreate() {
    const input = document.getElementById('cloud-folder-name-input');
    const name = input?.value?.trim();

    if (!name) {
        showToast('Please enter a folder name', 'warning');
        return;
    }

    if (!window.storageManager) return;

    await window.storageManager.createCloudFolder(name);
    closeCloudFolderModal();
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

function truncateText(text, maxLength) {
    if (!text) return '';
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
}

function showToast(message, type = 'info') {
    // Use existing toast system if available
    if (window.showAlert) {
        window.showAlert(message, type);
    } else if (window.showSuccess && type === 'success') {
        window.showSuccess(message);
    } else if (window.showError && type === 'error') {
        window.showError(message);
    } else {
        console.log(`[${type.toUpperCase()}] ${message}`);
    }
}

// ============================================================
// INTEGRATION WITH STORAGE MANAGER
// ============================================================

function enhanceCloudItemCards() {
    // DISABLED: Context menu moved to card dropdown (3-dot menu)
    // Right-click is no longer used for cloud storage items
    // All cloud management actions are now in the card-menu dropdown

    /* Original right-click implementation disabled
    const addContextMenu = () => {
        if (!window.storageManager || window.storageManager.currentStorage === 'native') {
            return;
        }

        // Folder cards
        document.querySelectorAll('.document-card.folder-card').forEach(card => {
            if (card.dataset.contextMenuBound) return;
            card.dataset.contextMenuBound = 'true';
            
            card.addEventListener('contextmenu', (e) => {
                const folderId = card.dataset.id;
                const folderName = card.querySelector('.card-title')?.textContent || '';
                showCloudContextMenu(e, { id: folderId, name: folderName }, 'folder');
            });
        });

        // File cards (for cloud storage)
        document.querySelectorAll('.document-card:not(.folder-card)').forEach(card => {
            const provider = card.dataset.provider;
            if (!provider || provider === 'native') return;
            if (card.dataset.contextMenuBound) return;
            card.dataset.contextMenuBound = 'true';
            
            card.addEventListener('contextmenu', (e) => {
                const fileId = card.dataset.id;
                const fileName = card.querySelector('.card-title')?.textContent || '';
                showCloudContextMenu(e, { id: fileId, name: fileName, provider }, 'file');
            });
        });

        // List view rows
        document.querySelectorAll('.table-row.folder-row, .table-row.document-item').forEach(row => {
            const provider = row.dataset.provider;
            if (!provider || provider === 'native') return;
            if (row.dataset.contextMenuBound) return;
            row.dataset.contextMenuBound = 'true';
            
            const isFolder = row.classList.contains('folder-row');
            
            row.addEventListener('contextmenu', (e) => {
                const itemId = row.dataset.id;
                const itemName = row.querySelector('.doc-name-cell span:last-child')?.textContent || '';
                showCloudContextMenu(e, { id: itemId, name: itemName, provider }, isFolder ? 'folder' : 'file');
            });
        });
    };

    // Run initially and observe for changes
    addContextMenu();

    // Use MutationObserver to detect when new cards are added
    const observer = new MutationObserver(() => {
        addContextMenu();
    });

    const cardView = document.getElementById('cardView');
    const tableBody = document.getElementById('documentTableBody');

    if (cardView) observer.observe(cardView, { childList: true, subtree: true });
    if (tableBody) observer.observe(tableBody, { childList: true, subtree: true });
    */
}

// ============================================================
// OVERRIDE ACTIONS FOR CLOUD STORAGE
// ============================================================

function setupCloudActionOverrides() {
    // Override the create-folder action when in cloud storage mode
    const originalHandleAction = window.handleAction;

    window.handleAction = function (action) {
        if (window.storageManager && window.storageManager.currentStorage !== 'native') {
            switch (action) {
                case 'create-folder':
                    openCloudFolderModal();
                    return;
                // Add more overrides as needed
            }
        }

        // Call original function for native storage
        if (originalHandleAction) {
            originalHandleAction(action);
        }
    };
}

// ============================================================
// INITIALIZATION
// ============================================================

document.addEventListener('DOMContentLoaded', function () {
    // Initialize context menu
    initCloudContextMenu();

    // Setup cloud action overrides
    setupCloudActionOverrides();

    // Enhance cloud item cards after a short delay
    setTimeout(() => {
        enhanceCloudItemCards();
    }, 500);

    // Setup modal button handlers
    const confirmRenameBtn = document.getElementById('confirm-cloud-rename');
    if (confirmRenameBtn) {
        confirmRenameBtn.addEventListener('click', confirmCloudRename);
    }

    const confirmDeleteBtn = document.getElementById('confirm-cloud-delete');
    if (confirmDeleteBtn) {
        confirmDeleteBtn.addEventListener('click', confirmCloudDelete);
    }

    const confirmMoveBtn = document.getElementById('confirm-cloud-move');
    if (confirmMoveBtn) {
        confirmMoveBtn.addEventListener('click', confirmCloudMove);
    }

    const confirmFolderBtn = document.getElementById('confirm-cloud-folder-create');
    if (confirmFolderBtn) {
        confirmFolderBtn.addEventListener('click', confirmCloudFolderCreate);
    }

    // Handle Enter key in modals
    const renameInput = document.getElementById('cloud-rename-input');
    if (renameInput) {
        renameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') confirmCloudRename();
        });
    }

    const folderInput = document.getElementById('cloud-folder-name-input');
    if (folderInput) {
        folderInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') confirmCloudFolderCreate();
        });
    }

    // Close modals with Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeCloudRenameModal();
            closeCloudDeleteModal();
            closeCloudFolderPicker();
            closeCloudFolderModal();
            closeCloudShareModal();
            closeCloudLinkModal();
        }
    });
});

// ============================================================
// CLOUD SHARE MODAL
// ============================================================

let shareTarget = null;
let shareTargetType = null;

function openCloudShareModal(item, type) {
    shareTarget = item;
    shareTargetType = type;

    const modal = document.getElementById('cloud-share-modal');
    const itemName = document.getElementById('share-item-name');
    const emailInput = document.getElementById('share-email-input');
    const messageInput = document.getElementById('share-message-input');

    if (!modal) return;

    if (itemName) itemName.textContent = item.name || 'Item';
    if (emailInput) emailInput.value = '';
    if (messageInput) messageInput.value = '';

    modal.classList.add('active');
    loadCollaborators(item.id);

    if (emailInput) emailInput.focus();
}

function closeCloudShareModal() {
    const modal = document.getElementById('cloud-share-modal');
    if (modal) modal.classList.remove('active');
    shareTarget = null;
    shareTargetType = null;
}

async function loadCollaborators(fileId) {
    const container = document.getElementById('collaborators-list');
    if (!container || !window.storageManager) return;

    container.innerHTML = '<div class="text-muted small text-center py-2">Loading...</div>';

    try {
        const sm = window.storageManager;
        const response = await fetch(`/x_integ/storage/files/${sm.currentStorage}/shared/${fileId}`);
        const data = await response.json();

        if (data.shared_users && data.shared_users.length > 0) {
            container.innerHTML = data.shared_users.map(user => `
                <div class="d-flex align-items-center gap-2 py-2 border-bottom collaborator-item" data-id="${user.id}" data-email="${user.email || ''}">
                    <div class="rounded-circle bg-primary text-white d-flex align-items-center justify-content-center" style="width: 32px; height: 32px; font-size: 0.8rem;">
                        ${(user.name || user.email || '?').substring(0, 2).toUpperCase()}
                    </div>
                    <div class="flex-grow-1">
                        <div class="small fw-medium">${user.name || user.email || 'Unknown'}</div>
                        <div class="text-muted" style="font-size: 0.7rem;">${user.role || 'Viewer'}</div>
                    </div>
                    <button class="btn btn-sm btn-outline-danger" onclick="revokeAccess('${user.id}', '${user.email || ''}')">
                        <i class="bi bi-x"></i>
                    </button>
                </div>
            `).join('');
        } else {
            container.innerHTML = '<div class="text-muted small text-center py-2">No one else has access</div>';
        }
    } catch (error) {
        console.error('Error loading collaborators:', error);
        container.innerHTML = '<div class="text-danger small text-center py-2">Error loading</div>';
    }
}

async function confirmCloudShare() {
    if (!shareTarget || !window.storageManager) return;

    const email = document.getElementById('share-email-input')?.value?.trim();
    const role = document.getElementById('share-role-select')?.value || 'reader';
    const notify = document.getElementById('share-notify-check')?.checked ?? true;
    const message = document.getElementById('share-message-input')?.value?.trim() || '';

    if (!email) {
        showToast('Please enter an email address', 'warning');
        return;
    }

    const sm = window.storageManager;

    try {
        const response = await fetch(`/x_integ/storage/share/${sm.currentStorage}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                file_id: shareTarget.id,
                email,
                role,
                notify,
                message
            })
        });

        const result = await response.json();
        if (result.success) {
            showToast('Shared successfully!', 'success');
            document.getElementById('share-email-input').value = '';
            loadCollaborators(shareTarget.id);
        } else {
            showToast(result.error || 'Failed to share', 'error');
        }
    } catch (error) {
        console.error('Share error:', error);
        showToast('Failed to share', 'error');
    }
}

async function revokeAccess(permissionId, email) {
    if (!shareTarget || !window.storageManager) return;

    const sm = window.storageManager;

    try {
        const response = await fetch(`/x_integ/storage/unshare/${sm.currentStorage}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                file_id: shareTarget.id,
                permission_id: permissionId,
                email: email
            })
        });

        const result = await response.json();
        if (result.success) {
            showToast('Access revoked', 'success');
            loadCollaborators(shareTarget.id);
        } else {
            showToast(result.error || 'Failed to revoke access', 'error');
        }
    } catch (error) {
        console.error('Revoke error:', error);
        showToast('Failed to revoke access', 'error');
    }
}

// ============================================================
// CLOUD GET LINK MODAL
// ============================================================

let linkTarget = null;
let linkTargetType = null;
let currentPublicLink = null;

function openCloudLinkModal(item, type) {
    linkTarget = item;
    linkTargetType = type;
    currentPublicLink = null;

    const modal = document.getElementById('cloud-link-modal');
    const itemName = document.getElementById('link-item-name');
    const toggle = document.getElementById('public-link-toggle');
    const linkSettings = document.getElementById('link-settings');
    const noLinkMsg = document.getElementById('no-link-message');
    const removeBtn = document.getElementById('remove-link-btn');

    if (!modal) return;

    if (itemName) itemName.textContent = item.name || 'Item';
    if (toggle) toggle.checked = false;
    if (linkSettings) linkSettings.classList.add('d-none');
    if (noLinkMsg) noLinkMsg.classList.remove('d-none');
    if (removeBtn) removeBtn.classList.add('d-none');

    // Clear inputs
    document.getElementById('public-link-url').value = '';
    document.getElementById('link-expiry-input').value = '';
    document.getElementById('link-password-input').value = '';

    modal.classList.add('active');
}

function closeCloudLinkModal() {
    const modal = document.getElementById('cloud-link-modal');
    if (modal) modal.classList.remove('active');
    linkTarget = null;
    linkTargetType = null;
}

async function createPublicLink() {
    if (!linkTarget || !window.storageManager) return;

    const expiry = document.getElementById('link-expiry-input')?.value;
    const password = document.getElementById('link-password-input')?.value;
    const linkInput = document.getElementById('public-link-url');

    const sm = window.storageManager;
    linkInput.value = 'Generating...';

    try {
        const response = await fetch(`/x_integ/storage/link/${sm.currentStorage}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                file_id: linkTarget.id,
                expires_at: expiry ? new Date(expiry).toISOString() : null,
                password: password || null
            })
        });

        const result = await response.json();
        if (result.success && result.link) {
            currentPublicLink = result.link;
            linkInput.value = result.link;
            document.getElementById('remove-link-btn').classList.remove('d-none');
            showToast('Public link created!', 'success');
        } else {
            linkInput.value = '';
            showToast(result.error || 'Failed to create link', 'error');
        }
    } catch (error) {
        console.error('Link error:', error);
        linkInput.value = '';
        showToast('Failed to create link', 'error');
    }
}

async function removePublicLink() {
    if (!linkTarget || !window.storageManager) return;

    const sm = window.storageManager;

    try {
        const response = await fetch(`/x_integ/storage/link/${sm.currentStorage}/${encodeURIComponent(linkTarget.id)}`, {
            method: 'DELETE'
        });

        const result = await response.json();
        if (result.success) {
            currentPublicLink = null;
            document.getElementById('public-link-url').value = '';
            document.getElementById('public-link-toggle').checked = false;
            document.getElementById('link-settings').classList.add('d-none');
            document.getElementById('no-link-message').classList.remove('d-none');
            document.getElementById('remove-link-btn').classList.add('d-none');
            showToast('Public link removed', 'success');
        } else {
            showToast(result.error || 'Failed to remove link', 'error');
        }
    } catch (error) {
        console.error('Remove link error:', error);
        showToast('Failed to remove link', 'error');
    }
}

function copyLinkToClipboard() {
    const linkInput = document.getElementById('public-link-url');
    if (linkInput && linkInput.value) {
        navigator.clipboard.writeText(linkInput.value).then(() => {
            showToast('Link copied!', 'success');
        }).catch(() => {
            linkInput.select();
            document.execCommand('copy');
            showToast('Link copied!', 'success');
        });
    }
}

// Setup link modal event listeners
document.addEventListener('DOMContentLoaded', function () {
    // Share modal
    const confirmShareBtn = document.getElementById('confirm-cloud-share');
    if (confirmShareBtn) {
        confirmShareBtn.addEventListener('click', confirmCloudShare);
    }

    // Link toggle
    const linkToggle = document.getElementById('public-link-toggle');
    if (linkToggle) {
        linkToggle.addEventListener('change', function () {
            const linkSettings = document.getElementById('link-settings');
            const noLinkMsg = document.getElementById('no-link-message');

            if (this.checked) {
                linkSettings.classList.remove('d-none');
                noLinkMsg.classList.add('d-none');
                createPublicLink();
            } else {
                removePublicLink();
            }
        });
    }

    // Copy link button
    const copyBtn = document.getElementById('copy-link-btn');
    if (copyBtn) {
        copyBtn.addEventListener('click', copyLinkToClipboard);
    }

    // Remove link button
    const removeBtn = document.getElementById('remove-link-btn');
    if (removeBtn) {
        removeBtn.addEventListener('click', removePublicLink);
    }
});

// Export functions for global access
window.showCloudContextMenu = showCloudContextMenu;
window.hideCloudContextMenu = hideCloudContextMenu;
window.openCloudRenameModal = openCloudRenameModal;
window.closeCloudRenameModal = closeCloudRenameModal;
window.openCloudDeleteModal = openCloudDeleteModal;
window.closeCloudDeleteModal = closeCloudDeleteModal;
window.openCloudFolderPicker = openCloudFolderPicker;
window.closeCloudFolderPicker = closeCloudFolderPicker;
window.openCloudFolderModal = openCloudFolderModal;
window.closeCloudFolderModal = closeCloudFolderModal;
window.openCloudShareModal = openCloudShareModal;
window.closeCloudShareModal = closeCloudShareModal;
window.openCloudLinkModal = openCloudLinkModal;
window.closeCloudLinkModal = closeCloudLinkModal;
window.revokeAccess = revokeAccess;
window.enhanceCloudItemCards = enhanceCloudItemCards;
