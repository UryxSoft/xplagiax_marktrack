// ===========================
// VARIABLES GLOBALES Y ESTADO
// ===========================
const AppState = {
    currentView: localStorage.getItem('fileView') || 'card',
    files: [],
    filteredFiles: [],
    searchTerm: '',
    debounceTimer: null,
    activeDropdown: null,
    currentFileId: null,
    selectedFile: null,
    currentDocumentId: null,
    currentShareDocId: null,
    currentUserEmail: window.__APP_USER_EMAIL__ || 'anonymous',
    isSharedDocument: false,
    sharedDocumentInfo: null
};

// ===========================
// SIDEBAR FUNCTIONALITY
// ===========================
const expand_btn = document.querySelector(".expand-btn");

if (expand_btn) {
    expand_btn.addEventListener("click", () => {
        document.body.classList.toggle("collapsed");
        document.body.classList.toggle("sidebar-expanded");
        const isExpanded = document.body.classList.contains("sidebar-expanded");
        expand_btn.setAttribute('aria-expanded', isExpanded);
    });
}

// Micro-interacción: Efecto de click reactivo
document.querySelectorAll('.card').forEach(card => {
    card.addEventListener('mousedown', () => {
        card.style.transform = 'scale(0.96) translateY(-5px)';
    });

    card.addEventListener('mouseup', () => {
        card.style.transform = '';
    });

    card.addEventListener('mouseleave', () => {
        card.style.transform = '';
    });
});

// Soporte para Scroll con el mouse (Rueda) en PC
const gallery = document.querySelector('.files-container');
if (gallery) {
    gallery.addEventListener('wheel', (evt) => {
        // Only if we are in card view (like gallery in documentard)
        if (!gallery.closest('.files-list-wrapper') && evt.deltaY !== 0) {
            evt.preventDefault();
            gallery.scrollLeft += evt.deltaY;
        }
    });
}

// Enlaces activos del sidebar
const current = window.location.href;
const allLinks = document.querySelectorAll(".sidebar-links a");

allLinks.forEach((elem) => {
    elem.addEventListener("click", function () {
        const hrefLinkClick = elem.href;
        allLinks.forEach((link) => {
            if (link.href == hrefLinkClick) {
                link.classList.add("active");
            } else {
                link.classList.remove("active");
            }
        });
    });
});

// ===========================
// FUNCIONES DE UTILIDAD
// ===========================
function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('es-ES', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function loadUserEmail() {
    if (window.__APP_USER_EMAIL__) {
        AppState.currentUserEmail = window.__APP_USER_EMAIL__;
    }
    console.log('Usuario autenticado:', AppState.currentUserEmail);
}

function showNotification(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `custom-toast custom-toast--${type}`;

    let icon = 'info-circle';
    if (type === 'success') icon = 'check-circle';
    if (type === 'error') icon = 'exclamation-triangle';
    if (type === 'warning') icon = 'exclamation-circle';

    toast.innerHTML = `
        <i class="bi bi-${icon}"></i>
        <div class="custom-toast-content">${message}</div>
    `;

    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.style.cssText = `
            position: fixed;
            bottom: 2rem;
            right: 2rem;
            z-index: 9999;
            display: flex;
            flex-direction: column;
            gap: 0.75rem;
        `;
        document.body.appendChild(container);
    }

    container.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

function showToast(message, type) {
    showNotification(message, type === 'error' ? 'error' : 'success');
}

function showLoading(message) {
    console.log('Loading:', message);
}

function hideLoading() {
    console.log('Loading complete');
}

// ===========================
// GESTIÓN DE USUARIO
// ===========================
const cardViewBtn = document.getElementById('cardViewBtn');
const listViewBtn = document.getElementById('listViewBtn');
const filesContainer = document.getElementById('docsGrid') || document.getElementById('documentsListContainer');

function switchView(view) {
    AppState.currentView = view;
    localStorage.setItem('fileView', view);

    if (cardViewBtn && listViewBtn) {
        [cardViewBtn, listViewBtn].forEach(btn => {
            const isActive = btn.dataset.view === view;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-pressed', isActive);
        });
    }

    if (filesContainer) {
        // Toggle wrapper class for list/grid layout control
        const wrapper = filesContainer.closest('.files-container')?.parentElement;
        if (wrapper) {
            if (view === 'list') {
                wrapper.classList.add('files-list-wrapper');
            } else {
                wrapper.classList.remove('files-list-wrapper');
            }
        }

        if (view === 'list') {
            filesContainer.classList.remove('files-grid');
            filesContainer.classList.add('files-list');
        } else {
            filesContainer.classList.remove('files-list');
            filesContainer.classList.add('files-grid');
        }
    }

    renderDocumentsList();
}

if (cardViewBtn) cardViewBtn.addEventListener('click', () => switchView('card'));
if (listViewBtn) listViewBtn.addEventListener('click', () => switchView('list'));

// ===========================
// SEARCH FUNCTIONALITY
// ===========================
const searchInput = document.getElementById('searchInput');
const searchClear = document.getElementById('searchClear');
const emptyState = document.getElementById('emptyState');

if (searchInput) {
    searchInput.addEventListener('input', (e) => {
        const value = e.target.value;
        if (searchClear) {
            searchClear.classList.toggle('show', value.length > 0);
        }

        clearTimeout(AppState.debounceTimer);
        AppState.debounceTimer = setTimeout(() => {
            performSearch(value);
        }, 250);
    });
}

if (searchClear) {
    searchClear.addEventListener('click', () => {
        if (searchInput) {
            searchInput.value = '';
            searchClear.classList.remove('show');
            performSearch('');
            searchInput.focus();
        }
    });
}

function performSearch(term) {
    AppState.searchTerm = term.toLowerCase().trim();

    if (!AppState.searchTerm) {
        AppState.filteredFiles = [];
        renderDocumentsList();
        return;
    }

    AppState.filteredFiles = AppState.files.filter(file => {
        const title = (file.title || file.name || '').toLowerCase();
        const size = formatBytes(file.size_bytes || 0).toLowerCase();
        return title.includes(AppState.searchTerm) || size.includes(AppState.searchTerm);
    });

    renderDocumentsList();
}

// ===========================
// DROPDOWN FUNCTIONALITY
// ===========================
function toggleDropdown(event, docId) {
    event.stopPropagation();
    const dropdown = document.getElementById(`dropdown-${docId}`);
    const button = event.currentTarget;
    const isOpen = dropdown && dropdown.classList.contains('show');

    closeAllDropdowns();

    if (!isOpen && dropdown) {
        dropdown.classList.add('show');
        button.setAttribute('aria-expanded', 'true');
        AppState.activeDropdown = docId;

        const rect = button.getBoundingClientRect();
        const dropdownRect = dropdown.getBoundingClientRect();

        if (rect.right + dropdownRect.width > window.innerWidth) {
            dropdown.style.right = '0';
            dropdown.style.left = 'auto';
        }

        setTimeout(() => {
            const firstItem = dropdown.querySelector('.dropdown-item');
            if (firstItem) firstItem.focus();
        }, 50);
    }
}

function closeAllDropdowns() {
    document.querySelectorAll('.dropdown-menu.show').forEach(dropdown => {
        dropdown.classList.remove('show');
        const container = dropdown.closest('.file-menu-container');
        const button = container?.querySelector('.file-menu-btn');
        if (button) button.setAttribute('aria-expanded', 'false');
    });
    AppState.activeDropdown = null;
}

document.addEventListener('click', (e) => {
    if (!e.target.closest('.file-menu-container') && !e.target.closest('.dropdown-menu')) {
        closeAllDropdowns();
    }
});

// ===========================
// API: CARGAR DOCUMENTOS
// ===========================
async function loadDocumentsList() {
    try {
        const response = await fetch(`/api/documents?owner_email=${AppState.currentUserEmail}&per_page=50`);

        if (!response.ok) {
            throw new Error('Error cargando lista de documentos');
        }

        const data = await response.json();
        AppState.files = data.documents || [];

        renderDocumentsList();
    } catch (error) {
        console.error('Error loading documents:', error);
        showNotification('Error loading documents. Showing demo data.', 'warning');
        AppState.files = [];
        renderDocumentsList();
    }
}

// ===========================
// RENDERIZADO DE DOCUMENTOS
// ===========================
function renderDocumentsList() {
    if (!filesContainer) return;

    filesContainer.classList.add('fade-out');

    setTimeout(() => {
        const filesToRender = AppState.filteredFiles.length > 0 ? AppState.filteredFiles : AppState.files;

        if (filesToRender.length === 0 && AppState.searchTerm && emptyState) {
            filesContainer.innerHTML = '';
            filesContainer.style.display = 'none';
            emptyState.style.display = 'block';
        } else {
            if (emptyState) emptyState.style.display = 'none';
            filesContainer.style.display = '';

            filesContainer.innerHTML = filesToRender.map(doc =>
                AppState.currentView === 'card'
                    ? renderFileCard(doc)
                    : renderFileListItem(doc)
            ).join('');
        }

        filesContainer.classList.remove('fade-out');
    }, 150);
}

function getTag(doc) {
    const mime = (doc.mime_type || "").toLowerCase();
    if (mime.includes("pdf")) return { label: "PDF", class: "tag--pdf" };
    if (mime.includes("word") || mime.includes("doc")) return { label: "Future", class: "tag--doc" };
    return { label: "Design", class: "tag--generic" };
}

function renderFileCard(doc) {
    const title = escapeHtml(doc.title || doc.name);
    let tagClass = "tag-work";
    let tagName = "GENERAL";

    if (doc.mime_type?.includes("pdf") || title.toLowerCase().endsWith('.pdf')) {
        tagClass = "tag-tech";
        tagName = "PDF";
    } else if (doc.mime_type?.includes("word") || title.toLowerCase().endsWith('.docx') || title.toLowerCase().endsWith('.doc')) {
        tagClass = "tag-future";
        tagName = "DOC";
    }

    const previewText = `Advancements in technology are enhancing capabilities in digital documentation. Updated at ${formatDate(doc.updated_at)}`;

    return `
        <div class="doc-outer" data-file-id="${doc.id}">
            <div class="doc-menu-btn" onclick="toggleDropdown(event, ${doc.id})" aria-haspopup="true">
                <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>
            </div>
            
            <div class="dropdown-menu" id="dropdown-${doc.id}" role="menu" style="right: 8px; top: 32px; z-index: 101;">
                <button class="dropdown-item" onclick="openRenameModal(${doc.id})" role="menuitem">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width:14px;height:14px;">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                    Rename
                </button>
                <button class="dropdown-item" onclick="editDocument(${doc.id}, event)" role="menuitem">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width:14px;height:14px;">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
                    </svg>
                    Edit
                </button>
                <button class="dropdown-item" onclick="showShareModal(${doc.id})" role="menuitem">
                    <svg fill="currentColor" viewBox="0 0 16 16" style="width:14px;height:14px;">
                        <path d="M13.5 1a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3M11 2.5a2.5 2.5 0 1 1 .603 1.628l-6.718 3.12a2.5 2.5 0 0 1 0 1.504l6.718 3.12a2.5 2.5 0 1 1-.488.876l-6.718-3.12a2.5 2.5 0 1 1 0-3.256l6.718-3.12A2.5 2.5 0 0 1 11 2.5m-8.5 4a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3m11 5.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3"/>
                    </svg>
                    Share
                </button>
                <button class="dropdown-item" onclick="openDownloadModal(${doc.id})" role="menuitem">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width:14px;height:14px;">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
                    </svg>
                    Download
                </button>
                <button class="dropdown-item danger" onclick="deleteDocument(${doc.id}, event)" role="menuitem">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width:14px;height:14px;">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                    </svg>
                    Delete
                </button>
            </div>

            <div class="doc-stack" onclick="loadDocument(${doc.id})">
                <div class="doc-page dp-b2"></div>
                <div class="doc-page dp-b1"></div>
                <div class="doc-page dp-front">
                    <div class="doc-tag ${tagClass}">${tagName}</div>
                    <div class="doc-title">${title}</div>
                    <div class="doc-preview">
                        ${previewText}
                    </div>
                    <div class="doc-footer">
                        <div class="doc-date">${formatDate(doc.updated_at)}</div>
                        <div class="doc-words">${formatBytes(doc.size_bytes || 0)}</div>
                    </div>
                </div>
            </div>
        </div>
    `;
}


// Helper function to get file type icon based on extension
function getFileTypeIcon(title) {
    const ext = title.split('.').pop().toLowerCase();

    const icons = {
        doc: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 16 16">
                    <path fill-rule="evenodd" d="M14 4.5V14a2 2 0 0 1-2 2v-1a1 1 0 0 0 1-1V4.5h-2A1.5 1.5 0 0 1 9.5 3V1H4a1 1 0 0 0-1 1v9H2V2a2 2 0 0 1 2-2h5.5zm-7.839 9.166v.522q0 .384-.117.641a.86.86 0 0 1-.322.387.9.9 0 0 1-.469.126.9.9 0 0 1-.471-.126.87.87 0 0 1-.32-.386 1.55 1.55 0 0 1-.117-.642v-.522q0-.386.117-.641a.87.87 0 0 1 .32-.387.87.87 0 0 1 .471-.129q.264 0 .469.13a.86.86 0 0 1 .322.386q.117.255.117.641m.803.519v-.513q0-.565-.205-.972a1.46 1.46 0 0 0-.589-.63q-.381-.22-.917-.22-.533 0-.92.22a1.44 1.44 0 0 0-.589.627q-.204.406-.205.975v.513q0 .563.205.973.205.406.59.627.386.216.92.216.535 0 .916-.216.383-.22.59-.627.204-.41.204-.973M0 11.926v4h1.459q.603 0 .999-.238a1.45 1.45 0 0 0 .595-.689q.196-.45.196-1.084 0-.63-.196-1.075a1.43 1.43 0 0 0-.59-.68q-.395-.234-1.004-.234zm.791.645h.563q.371 0 .609.152a.9.9 0 0 1 .354.454q.118.302.118.753a2.3 2.3 0 0 1-.068.592 1.1 1.1 0 0 1-.196.422.8.8 0 0 1-.334.252 1.3 1.3 0 0 1-.483.082H.79V12.57Zm7.422.483a1.7 1.7 0 0 0-.103.633v.495q0 .369.103.627a.83.83 0 0 0 .298.393.85.85 0 0 0 .478.131.9.9 0 0 0 .401-.088.7.7 0 0 0 .273-.248.8.8 0 0 0 .117-.364h.765v.076a1.27 1.27 0 0 1-.226.674q-.205.29-.55.454a1.8 1.8 0 0 1-.786.164q-.54 0-.914-.216a1.4 1.4 0 0 1-.571-.627q-.194-.408-.194-.976v-.498q0-.568.197-.978.195-.411.571-.633.378-.223.911-.223.328 0 .607.097.28.093.489.272a1.33 1.33 0 0 1 .466.964v.073H9.78a.85.85 0 0 0-.12-.38.7.7 0 0 0-.273-.261.8.8 0 0 0-.398-.097.8.8 0 0 0-.475.138.87.87 0 0 0-.301.398"/>
                </svg>`,
        docx: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 16 16">
                    <path fill-rule="evenodd" d="M14 4.5V11h-1V4.5h-2A1.5 1.5 0 0 1 9.5 3V1H4a1 1 0 0 0-1 1v9H2V2a2 2 0 0 1 2-2h5.5zm-6.839 9.688v-.522a1.5 1.5 0 0 0-.117-.641.86.86 0 0 0-.322-.387.86.86 0 0 0-.469-.129.87.87 0 0 0-.471.13.87.87 0 0 0-.32.386 1.5 1.5 0 0 0-.117.641v.522q0 .384.117.641a.87.87 0 0 0 .32.387.9.9 0 0 0 .471.126.9.9 0 0 0 .469-.126.86.86 0 0 0 .322-.386 1.55 1.55 0 0 0 .117-.642m.803-.516v.513q0 .563-.205.973a1.47 1.47 0 0 1-.589.627q-.381.216-.917.216a1.86 1.86 0 0 1-.92-.216 1.46 1.46 0 0 1-.589-.627 2.15 2.15 0 0 1-.205-.973v-.513q0-.569.205-.975.205-.411.59-.627.386-.22.92-.22.535 0 .916.22.383.219.59.63.204.406.204.972M1 15.925v-3.999h1.459q.609 0 1.005.235.396.233.589.68.196.445.196 1.074 0 .634-.196 1.084-.197.451-.595.689-.396.237-.999.237zm1.354-3.354H1.79v2.707h.563q.277 0 .483-.082a.8.8 0 0 0 .334-.252q.132-.17.196-.422a2.3 2.3 0 0 0 .068-.592q0-.45-.118-.753a.9.9 0 0 0-.354-.454q-.237-.152-.61-.152Zm6.756 1.116q0-.373.103-.633a.87.87 0 0 1 .301-.398.8.8 0 0 1 .475-.138q.225 0 .398.097a.7.7 0 0 1 .273.26.85.85 0 0 1 .12.381h.765v-.073a1.33 1.33 0 0 0-.466-.964 1.4 1.4 0 0 0-.49-.272 1.8 1.8 0 0 0-.606-.097q-.534 0-.911.223-.375.222-.571.633-.197.41-.197.978v.498q0 .568.194.976.195.406.571.627.375.216.914.216.44 0 .785-.164t.551-.454a1.27 1.27 0 0 0 .226-.674v-.076h-.765a.8.8 0 0 1-.117.364.7.7 0 0 1-.273.248.9.9 0 0 1-.401.088.85.85 0 0 1-.478-.131.83.83 0 0 1-.298-.393 1.7 1.7 0 0 1-.103-.627zm5.092-1.76h.894l-1.275 2.006 1.254 1.992h-.908l-.85-1.415h-.035l-.852 1.415h-.862l1.24-2.015-1.228-1.984h.932l.832 1.439h.035z"/>
                </svg>`,
        txt: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 16 16">
                    <path fill-rule="evenodd" d="M14 4.5V14a2 2 0 0 1-2 2h-2v-1h2a1 1 0 0 0 1-1V4.5h-2A1.5 1.5 0 0 1 9.5 3V1H4a1 1 0 0 0-1 1v9H2V2a2 2 0 0 1 2-2h5.5zM1.928 15.849v-3.337h1.136v-.662H0v.662h1.134v3.337zm4.689-3.999h-.894L4.9 13.289h-.035l-.832-1.439h-.932l1.228 1.983-1.24 2.016h.862l.853-1.415h.035l.85 1.415h.907l-1.253-1.992zm1.93.662v3.337h-.794v-3.337H6.619v-.662h3.064v.662H8.546Z"/>
                </svg>`,
        pdf: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 16 16">
                    <path fill-rule="evenodd" d="M14 4.5V14a2 2 0 0 1-2 2h-1v-1h1a1 1 0 0 0 1-1V4.5h-2A1.5 1.5 0 0 1 9.5 3V1H4a1 1 0 0 0-1 1v9H2V2a2 2 0 0 1 2-2h5.5zM1.6 11.85H0v3.999h.791v-1.342h.803q.43 0 .732-.173.305-.175.463-.474a1.4 1.4 0 0 0 .161-.677q0-.375-.158-.677a1.2 1.2 0 0 0-.46-.477q-.3-.18-.732-.179m.545 1.333a.8.8 0 0 1-.085.38.57.57 0 0 1-.238.241.8.8 0 0 1-.375.082H.788V12.48h.66q.327 0 .512.181.185.183.185.522m1.217-1.333v3.999h1.46q.602 0 .998-.237a1.45 1.45 0 0 0 .595-.689q.196-.45.196-1.084 0-.63-.196-1.075a1.43 1.43 0 0 0-.589-.68q-.396-.234-1.005-.234zm.791.645h.563q.371 0 .609.152a.9.9 0 0 1 .354.454q.118.302.118.753a2.3 2.3 0 0 1-.068.592 1.1 1.1 0 0 1-.196.422.8.8 0 0 1-.334.252 1.3 1.3 0 0 1-.483.082h-.563zm3.743 1.763v1.591h-.79V11.85h2.548v.653H7.896v1.117h1.606v.638z"/>
                </svg>`,
        xlsx: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 16 16">
                    <path fill-rule="evenodd" d="M14 4.5V11h-1V4.5h-2A1.5 1.5 0 0 1 9.5 3V1H4a1 1 0 0 0-1 1v9H2V2a2 2 0 0 1 2-2h5.5zm-4.66 8.617.013.736-1.29.26.013.735 1.29.262-.012.737-1.029.208v.734l1.028.207.013.737-1.29.261.013.736 1.029.207v.74l-1.03.208.014.736 1.29.262.012.737-1.29.26-.012.737 1.028.207"/>
                </svg>`,
        xls: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 16 16">
                    <path fill-rule="evenodd" d="M14 4.5V11h-1V4.5h-2A1.5 1.5 0 0 1 9.5 3V1H4a1 1 0 0 0-1 1v9H2V2a2 2 0 0 1 2-2h5.5zm-4.66 8.617.013.736-1.29.26.013.735 1.29.262-.012.737-1.029.208v.734l1.028.207.013.737-1.29.261.013.736 1.029.207v.74l-1.03.208.014.736 1.29.262.012.737-1.29.26-.012.737 1.028.207"/>
                </svg>`,
        default: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 16 16">
                    <path fill-rule="evenodd" d="M14 4.5V11h-1V4.5h-2A1.5 1.5 0 0 1 9.5 3V1H4a1 1 0 0 0-1 1v9H2V2a2 2 0 0 1 2-2h5.5zm-6.839 9.688v-.522a1.5 1.5 0 0 0-.117-.641.86.86 0 0 0-.322-.387.86.86 0 0 0-.469-.129.87.87 0 0 0-.471.13.87.87 0 0 0-.32.386 1.5 1.5 0 0 0-.117.641v.522q0 .384.117.641a.87.87 0 0 0 .32.387.9.9 0 0 0 .471.126.9.9 0 0 0 .469-.126.86.86 0 0 0 .322-.386 1.55 1.55 0 0 0 .117-.642m.803-.516v.513q0 .563-.205.973a1.47 1.47 0 0 1-.589.627q-.381.216-.917.216a1.86 1.86 0 0 1-.92-.216 1.46 1.46 0 0 1-.589-.627 2.15 2.15 0 0 1-.205-.973v-.513q0-.569.205-.975.205-.411.59-.627.386-.22.92-.22.535 0 .916.22.383.219.59.63.204.406.204.972M1 15.925v-3.999h1.459q.609 0 1.005.235.396.233.589.68.196.445.196 1.074 0 .634-.196 1.084-.197.451-.595.689-.396.237-.999.237zm1.354-3.354H1.79v2.707h.563q.277 0 .483-.082a.8.8 0 0 0 .334-.252q.132-.17.196-.422a2.3 2.3 0 0 0 .068-.592q0-.45-.118-.753a.9.9 0 0 0-.354-.454q-.237-.152-.61-.152Zm6.756 1.116q0-.373.103-.633a.87.87 0 0 1 .301-.398.8.8 0 0 1 .475-.138q.225 0 .398.097a.7.7 0 0 1 .273.26.85.85 0 0 1 .12.381h.765v-.073a1.33 1.33 0 0 0-.466-.964 1.4 1.4 0 0 0-.49-.272 1.8 1.8 0 0 0-.606-.097q-.534 0-.911.223-.375.222-.571.633-.197.41-.197.978v.498q0 .568.194.976.195.406.571.627.375.216.914.216.44 0 .785-.164t.551-.454a1.27 1.27 0 0 0 .226-.674v-.076h-.765a.8.8 0 0 1-.117.364.7.7 0 0 1-.273.248.9.9 0 0 1-.401.088.85.85 0 0 1-.478-.131.83.83 0 0 1-.298-.393 1.7 1.7 0 0 1-.103-.627zm5.092-1.76h.894l-1.275 2.006 1.254 1.992h-.908l-.85-1.415h-.035l-.852 1.415h-.862l1.24-2.015-1.228-1.984h.932l.832 1.439h.035z"/>
                </svg>`
    };

    return icons[ext] || icons.default;
}

function renderFileListItem(doc) {
    const title = escapeHtml(doc.title || doc.name);
    const fileIcon = getFileTypeIcon(title);
    return `
        <div class="file-card-wrapper" data-file-id="${doc.id}">
            <div class="card card--file" onclick="loadDocument(${doc.id})" role="listitem">
                <div class="file-icon-large app-icon" style="color:white;">
                    ${fileIcon}
                </div>
                <div class="file-info">
                    <p class="file-name">${title}</p>
                    <p class="file-size">${formatBytes(doc.size_bytes)} • ${formatDate(doc.updated_at)}</p>
                </div>
                <button class="file-menu-btn" onclick="toggleDropdown(event, ${doc.id})" aria-label="Options" aria-haspopup="true">
                    <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                        <path d="M3 9.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3m5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3m5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3"/>
                    </svg>
                </button>
            </div>
            <div class="dropdown-menu" id="dropdown-${doc.id}" role="menu">
                <button class="dropdown-item" onclick="editDocument(${doc.id}, event)" role="menuitem">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
                    </svg>
                    Edit
                </button>
                <button class="dropdown-item" onclick="showShareModal(${doc.id})" role="menuitem">
                    <svg fill="currentColor" viewBox="0 0 16 16">
                        <path d="M13.5 1a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3M11 2.5a2.5 2.5 0 1 1 .603 1.628l-6.718 3.12a2.5 2.5 0 0 1 0 1.504l6.718 3.12a2.5 2.5 0 1 1-.488.876l-6.718-3.12a2.5 2.5 0 1 1 0-3.256l6.718-3.12A2.5 2.5 0 0 1 11 2.5m-8.5 4a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3m11 5.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3"/>
                    </svg>
                    Share
                </button>
                <button class="dropdown-item" onclick="openDownloadModal(${doc.id})" role="menuitem">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
                    </svg>
                    Download
                </button>
                <button class="dropdown-item danger" onclick="deleteDocument(${doc.id}, event)" role="menuitem">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                    </svg>
                    Delete
                </button>
            </div>
        </div>
    `;
}

// ===========================
// API: CARGAR DOCUMENTO
// ===========================
async function loadDocument(docId) {
    try {
        showLoading('Cargando documento...');

        const response = await fetch(`/api/document/${docId}/load?user_email=${AppState.currentUserEmail}`);

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Error cargando documento');
        }

        const data = await response.json();

        AppState.currentDocumentId = docId;

        // Si existe quill y documentTitle en la página
        if (typeof quill !== 'undefined' && document.getElementById('documentTitle')) {
            document.getElementById('documentTitle').value = data.title;

            if (data.delta && data.delta.ops) {
                quill.setContents(data.delta);
            } else {
                quill.setContents([]);
            }

            if (typeof updateStatus !== 'undefined') {
                updateStatus('saved', 'Documento cargado');
            }
            if (typeof updateDocumentInfo !== 'undefined') {
                updateDocumentInfo(data);
            }
        } else {
            // Si no hay editor, redirigir
            const titleStr = (data.title || '').toLowerCase();
            const isPdf = titleStr.endsWith('.pdf') || (data.mime_type || '').includes('pdf');
            if (window.AppLoader) window.AppLoader.show(isPdf ? "Opening PDF viewer..." : "Opening document...");
            window.location.href = isPdf ? `/documentview/${docId}` : `/documentedit/${docId}`;
        }

        hideLoading();
        showNotification('Documento cargado correctamente', 'success');

    } catch (error) {
        console.error('Error:', error);
        hideLoading();
        showNotification(error.message, 'error');
    }
}

// ===========================
// API: DOCUMENTO COMPARTIDO
// ===========================
function checkForSharedDocument() {
    const urlParams = new URLSearchParams(window.location.search);
    const sharedToken = urlParams.get('shared_token');
    const docId = urlParams.get('doc_id');
    const permission = urlParams.get('permission');

    if (sharedToken && docId) {
        AppState.isSharedDocument = true;
        loadSharedDocument(sharedToken);

        if (permission === 'read') {
            showReadonlyBanner();
        }
    }
}

async function loadSharedDocument(token) {
    try {
        showLoading('Cargando documento compartido...');

        const response = await fetch(`/share_bp/api/shared-document/${token}`);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Error cargando documento compartido');
        }

        AppState.currentDocumentId = data.id;
        AppState.sharedDocumentInfo = data.share_info;

        hideLoading();
        showNotification(`Documento compartido por ${data.share_info?.shared_by || 'usuario'}`, 'info');

    } catch (error) {
        console.error('Error:', error);
        hideLoading();
        showNotification(error.message, 'error');
    }
}

function showReadonlyBanner() {
    console.log('Document is read-only');
    showNotification('Este documento es de solo lectura', 'warning');
}

// ===========================
// ACCIONES DE DOCUMENTOS
// ===========================
function editDocument(docId, event) {
    if (event) event.stopPropagation();
    closeAllDropdowns();
    showNotification(`Abriendo documento ${docId}...`, 'info');
    const file = AppState.files.find(f => f.id === docId);
    let isPdf = false;
    if (file) {
        const title = (file.title || '').toLowerCase();
        isPdf = file.mime_type?.includes('pdf') || title.endsWith('.pdf');
    }

    setTimeout(() => {
        if (window.AppLoader) window.AppLoader.show(isPdf ? "Opening PDF viewer..." : "Opening document...");
        window.location.href = isPdf ? `/documentview/${docId}` : `/documentedit/${docId}`;
    }, 500);
}

function deleteDocument(docId, event) {
    if (event) event.stopPropagation();
    closeAllDropdowns();
    openDeleteModal(docId);
}

function createNewDocument() {
    openCreateDocModal();
}

function handleUpload() {
    openUploadModal();
}

function openAssignment(assignmentId) {
    showNotification(`Opening assignment: ${assignmentId}`, 'info');
}

function editAssignment(assignmentId, event) {
    if (event) event.stopPropagation();
    showNotification(`Editing assignment: ${assignmentId}`, 'warning');
}

// ===========================
// MODALES - SHARE
// ===========================
function showShareModal(id, type = 'document') {
    if (window.event) window.event.stopPropagation();
    closeAllDropdowns();
    if (typeof AppState !== 'undefined') {
        AppState.currentShareId = id;
        AppState.currentShareType = type;
    }
    const modal = document.getElementById('shareModal');
    if (modal) {
        modal.classList.add('show');
        const emailInput = document.getElementById('recipientEmail');
        if (emailInput) emailInput.focus();
    }
}

function hideShareModal() {
    const modal = document.getElementById('shareModal');
    const form = document.getElementById('shareForm');
    const errorDiv = document.getElementById('emailError');

    if (modal) modal.classList.remove('show');
    if (form) form.reset();
    if (errorDiv) errorDiv.style.display = 'none';
    AppState.currentShareDocId = null;
}

function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

function handleShare(event) {
    event.preventDefault();

    const emailInput = document.getElementById('recipientEmail');
    const errorDiv = document.getElementById('emailError');
    const submitBtn = document.getElementById('shareSubmitBtn');
    const loading = document.getElementById('shareLoading');

    if (!emailInput || !errorDiv || !submitBtn || !loading) {
        console.error('Required elements not found');
        return;
    }

    const email = emailInput.value;

    // Validar email
    if (!validateEmail(email)) {
        errorDiv.textContent = 'Please enter a valid email address';
        errorDiv.style.display = 'block';
        return;
    }

    errorDiv.style.display = 'none';

    // Mostrar loading
    loading.style.display = 'inline-block';
    submitBtn.disabled = true;

    // Real API call
    const permission = document.getElementById('permissionLevel')?.value || 'read';
    const message = document.getElementById('shareMessage')?.value || '';
    const expires = document.getElementById('expirationDays')?.value || '7';

    const type = AppState.currentShareType || 'document';
    const id = AppState.currentShareId;
    const url = type === 'folder' 
        ? `/api/folder/${id}/share` 
        : `/share_bp/document/${id}/share`;

    apiFetch(url, {
        method: 'POST',
        body: JSON.stringify({
            email,
            permission,
            message,
            expires
        })
    }).then(() => {
        showNotification(`${type === 'folder' ? 'Carpeta compartida' : 'Documento compartido'} con ${email}!`, 'success');
        hideShareModal();
    }).catch(err => {
        showNotification(err.message || 'Error al compartir', 'error');
    }).finally(() => {
        loading.style.display = 'none';
        submitBtn.disabled = false;
    });
}

// ===========================
// MODALES - TRASH
// ===========================
async function openTrash() {
    const offcanvas = document.getElementById('trashOffcanvas');
    const backdrop = document.getElementById('trashBackdrop');
    if (offcanvas && backdrop) {
        closeAllModals();
        offcanvas.classList.add('show');
        backdrop.classList.add('show');
        document.body.style.overflow = 'hidden';
        setupFocusTrap(offcanvas);

        // Cargar documentos del trash
        await loadTrashDocuments();
    }
}

async function loadTrashDocuments() {
    const loading = document.getElementById('trashLoading');
    const empty = document.getElementById('trashEmpty');
    const container = document.getElementById('trashItems');

    // Show loading
    if (loading) loading.style.display = 'block';
    if (empty) empty.style.display = 'none';
    if (container) container.innerHTML = '';

    try {
        const response = await fetch(`/api/trash?owner_email=${AppState.currentUserEmail}`);
        const data = await response.json();

        if (loading) loading.style.display = 'none';

        if (!data.documents || data.documents.length === 0) {
            if (empty) empty.style.display = 'block';
            return;
        }

        // Update counter and bulk actions visibility
        const countEl = document.getElementById('trashCount');
        if (countEl) countEl.textContent = data.documents.length;

        const bulkActions = document.getElementById('trashBulkActions');
        if (bulkActions) bulkActions.style.display = data.documents.length > 0 ? 'flex' : 'none';

        // Uncheck select all
        const selectAll = document.getElementById('selectAllTrash');
        if (selectAll) selectAll.checked = false;

        // Render trash items
        data.documents.forEach(doc => {
            const deletedDate = doc.deleted_at ? new Date(doc.deleted_at).toLocaleDateString('en-US', {
                year: 'numeric', month: 'short', day: 'numeric'
            }) : 'Unknown';

            const itemHTML = `
                        <div class="trash-item" id="trash-item-${doc.id}">
                            <div class="trash-item-header">
                                <div class="trash-checkbox-container">
                                    <input type="checkbox" class="trash-checkbox item-checkbox" value="${doc.id}" onchange="updateTrashBulkActions()">
                                </div>
                                <div class="trash-item-icon">
                                    <svg fill="currentColor" viewBox="0 0 16 16">
                                        <path d="M14 4.5V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2h5.5zm-3 0A1.5 1.5 0 0 1 9.5 3V1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4.5z" />
                                    </svg>
                                </div>
                                <div class="trash-item-info">
                                    <div class="trash-item-title">${doc.title}</div>
                                    <div class="trash-item-date">Deleted: ${deletedDate}</div>
                                </div>
                            </div>
                            <div class="trash-item-actions">
                                <button class="trash-btn-small btn-restore" onclick="openRestoreModal(${doc.id})">
                                    <svg fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">
                                        <path fill-rule="evenodd" d="M7.364 3.5a.5.5 0 0 1 .5-.5H14.5A1.5 1.5 0 0 1 16 4.5v10a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 3 14.5V7.864a.5.5 0 1 1 1 0V14.5a.5.5 0 0 0 .5.5h10a.5.5 0 0 0 .5-.5v-10a.5.5 0 0 0-.5-.5H7.864a.5.5 0 0 1-.5-.5" />
                                        <path fill-rule="evenodd" d="M0 .5A.5.5 0 0 1 .5 0h5a.5.5 0 0 1 0 1H1.707l8.147 8.146a.5.5 0 0 1-.708.708L1 1.707V5.5a.5.5 0 0 1-1 0z" />
                                    </svg>
                                    Restore
                                </button>
                                <button class="trash-btn-small btn-delete-permanent" onclick="openDeleteForeverModal(${doc.id})">
                                    <svg fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">
                                        <path d="M6.854 7.146a.5.5 0 1 0-.708.708L7.293 9l-1.147 1.146a.5.5 0 0 0 .708.708L8 9.707l1.146 1.147a.5.5 0 0 0 .708-.708L8.707 9l1.147-1.146a.5.5 0 0 0-.708-.708L8 8.293z" />
                                        <path d="M14 14V4.5L9.5 0H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2M9.5 3A1.5 1.5 0 0 0 11 4.5h2V14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h5.5z" />
                                    </svg>
                                    Delete
                                </button>
                            </div>
                        </div>
                    `;
            container.insertAdjacentHTML('beforeend', itemHTML);
        });

    } catch (error) {
        console.error('Error loading trash:', error);
        if (loading) loading.style.display = 'none';
        if (container) container.innerHTML = '<p style="text-align: center; color: var(--error);">Error loading trash</p>';
    }
}

function toggleSelectAllTrash(checked) {
    const checkboxes = document.querySelectorAll('.item-checkbox');
    checkboxes.forEach(cb => {
        cb.checked = checked;
        const item = document.getElementById(`trash-item-${cb.value}`);
        if (item) {
            if (checked) item.classList.add('selected');
            else item.classList.remove('selected');
        }
    });
    updateTrashBulkActions();
}

function updateTrashBulkActions() {
    const checkboxes = document.querySelectorAll('.item-checkbox');
    const selectedCount = Array.from(checkboxes).filter(cb => cb.checked).length;
    const deleteBtn = document.getElementById('deleteSelectedBtn');

    if (deleteBtn) {
        if (selectedCount > 0) {
            deleteBtn.classList.add('show');
            deleteBtn.innerHTML = `
                        <svg fill="currentColor" viewBox="0 0 16 16"><path d="M11 1.5v1h3.5a.5.5 0 0 1 0 1h-.538l-.853 10.66A2 2 0 0 1 11.115 16h-6.23a2 2 0 0 1-1.994-1.84L2.038 3.5H1.5a.5.5 0 0 1 0-1H5v-1A1.5 1.5 0 0 1 6.5 0h3A1.5 1.5 0 0 1 11 1.5m-5 0v1h4v-1a.5.5 0 0 0-.5-.5h-3a.5.5 0 0 0-.5.5M4.5 5.029l.5 8.5a.5.5 0 1 0 .998-.06l-.5-8.5a.5.5 0 1 0-.998.06m6.53-.528a.5.5 0 0 0-.528.47l-.5 8.5a.5.5 0 0 0 .998.058l.5-8.5a.5.5 0 0 0-.47-.528M8 4.5a.5.5 0 0 0-.5.5v8.5a.5.5 0 0 0 1 0V5a.5.5 0 0 0-.5-.5"/></svg>
                        Delete ${selectedCount}
                    `;
        } else {
            deleteBtn.classList.remove('show');
        }
    }

    // Update highlight
    checkboxes.forEach(cb => {
        const item = document.getElementById(`trash-item-${cb.value}`);
        if (item) {
            if (cb.checked) item.classList.add('selected');
            else item.classList.remove('selected');
        }
    });

    // Sync "Select All" checkbox
    const selectAll = document.getElementById('selectAllTrash');
    if (selectAll) {
        selectAll.checked = checkboxes.length > 0 && selectedCount === checkboxes.length;
    }
}

async function deleteSelectedTrash() {
    const checkboxes = document.querySelectorAll('.item-checkbox:checked');
    const docIds = Array.from(checkboxes).map(cb => parseInt(cb.value));

    if (docIds.length === 0) return;

    // Mostrar el modal personalizado
    const modal = document.getElementById('deletePermanentModalBackdrop');
    const docNameEl = document.getElementById('deletePermanentDocName');

    if (docNameEl) {
        docNameEl.textContent = `${docIds.length} documents`;
    }
    if (modal) modal.style.display = 'flex';

    // Configurar el botón de confirmación para borrado masivo
    const confirmBtn = document.getElementById('confirmDeletePermanentBtn');
    if (confirmBtn) {
        confirmBtn.onclick = async () => {
            closeDeletePermanentModal();
            await executeBulkDelete(docIds);
        };
    }
}

async function executeBulkDelete(docIds) {

    try {
        const response = await fetch(`/api/document/delete-bulk?user_email=${AppState.currentUserEmail}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ doc_ids: docIds })
        });

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Error deleting documents');
        }

        const result = await response.json();
        showNotification(result.message, 'success');

        // Remove items from UI
        docIds.forEach(id => {
            const item = document.getElementById(`trash-item-${id}`);
            if (item) {
                item.style.animation = 'fadeOut 0.3s ease-out forwards';
                setTimeout(() => item.remove(), 300);
            }
        });

        // Update counter and check if empty
        setTimeout(() => {
            loadTrashDocuments(); // Reload to refresh counter and state correctly
        }, 350);

    } catch (error) {
        console.error('Bulk delete error:', error);
        showNotification(error.message || 'Error deleting documents', 'error');
    }
}

function closeTrash() {
    const offcanvas = document.getElementById('trashOffcanvas');
    const backdrop = document.getElementById('trashBackdrop');
    if (offcanvas && backdrop) {
        offcanvas.classList.remove('show');
        backdrop.classList.remove('show');
        document.body.style.overflow = '';
    }
}

async function restoreDocument(docId) {
    try {
        const response = await fetch(`/api/document/${docId}/restore?user_email=${AppState.currentUserEmail}`, {
            method: 'POST'
        });

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Error restoring document');
        }

        // Remove from trash UI
        const item = document.getElementById(`trash-item-${docId}`);
        if (item) item.remove();

        // Check if trash is empty
        const container = document.getElementById('trashItems');
        if (container && container.children.length === 0) {
            document.getElementById('trashEmpty').style.display = 'block';
        }

        showNotification('Document restored successfully', 'success');

        // Reload main documents list
        loadDocuments();

    } catch (error) {
        console.error('Restore error:', error);
        showNotification(error.message || 'Error restoring document', 'error');
    }
}

// Variables para el modal de delete permanent
let deletePermanentDocId = null;
let deletePermanentDocTitle = '';

function deletePermanent(docId) {
    // Obtener el nombre del documento
    const trashItem = document.getElementById(`trash-item-${docId}`);
    const docTitle = trashItem?.querySelector('.trash-item-title')?.textContent || 'this document';

    deletePermanentDocId = docId;
    deletePermanentDocTitle = docTitle;

    // Mostrar el modal
    const modal = document.getElementById('deletePermanentModalBackdrop');
    const docNameEl = document.getElementById('deletePermanentDocName');

    if (docNameEl) docNameEl.textContent = `"${docTitle}"`;
    if (modal) modal.style.display = 'flex';

    // Configurar el botón de confirmación
    const confirmBtn = document.getElementById('confirmDeletePermanentBtn');
    if (confirmBtn) {
        confirmBtn.onclick = confirmDeletePermanent;
    }
}

function closeDeletePermanentModal() {
    const modal = document.getElementById('deletePermanentModalBackdrop');
    if (modal) modal.style.display = 'none';
    deletePermanentDocId = null;
    deletePermanentDocTitle = '';
}

async function confirmDeletePermanent() {
    if (!deletePermanentDocId) return;

    const docId = deletePermanentDocId;
    closeDeletePermanentModal();

    try {
        const response = await fetch(`/api/document/${docId}/delete-permanent?user_email=${AppState.currentUserEmail}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Error deleting document');
        }

        // Remove from trash UI
        const item = document.getElementById(`trash-item-${docId}`);
        if (item) {
            item.style.animation = 'fadeOut 0.3s ease-out forwards';
            setTimeout(() => item.remove(), 300);
        }

        // Check if trash is empty after animation
        setTimeout(() => {
            const container = document.getElementById('trashItems');
            if (container && container.children.length === 0) {
                document.getElementById('trashEmpty').style.display = 'block';
            }
        }, 350);

        showNotification('Document permanently deleted', 'success');

    } catch (error) {
        console.error('Delete permanent error:', error);
        showNotification(error.message || 'Error deleting document', 'error');
    }
}

// ===========================
// MODALES - CREATE DOCUMENT
// ===========================
function openCreateDocModal() {
    const backdrop = document.getElementById('createDocModalBackdrop');
    if (backdrop) {
        backdrop.classList.add('show');
        document.body.style.overflow = 'hidden';

        setTimeout(() => {
            const input = document.getElementById('newDocName');
            if (input) input.focus();
        }, 300);
    }
}

function closeCreateDocModal() {
    const backdrop = document.getElementById('createDocModalBackdrop');
    if (backdrop) {
        backdrop.classList.remove('show');
        document.body.style.overflow = '';
        const input = document.getElementById('newDocName');
        const checkbox = document.getElementById('shareNewDoc');
        if (input) input.value = '';
        if (checkbox) checkbox.checked = false;
    }
}

function handleCreateDocSubmit() {
    const docName = document.getElementById('newDocName')?.value.trim();
    if (!docName) {
        showNotification('Please enter a document name', 'warning');
        return;
    }

    const shareDoc = document.getElementById('shareNewDoc')?.checked || false;
    const btn = event?.target;
    const loading = document.getElementById('createDocLoading');
    const btnText = document.getElementById('createDocBtnText');

    if (btn) btn.disabled = true;
    if (loading) loading.style.display = 'inline-block';
    if (btnText) btnText.textContent = 'Creating...';

    setTimeout(() => {
        const newFile = {
            id: AppState.files.length + 1,
            title: docName,
            name: docName + '.docx',
            size_bytes: 0,
            updated_at: new Date().toISOString(),
            type: 'doc'
        };

        AppState.files.unshift(newFile);
        renderDocumentsList();

        if (loading) loading.style.display = 'none';
        if (btnText) btnText.textContent = 'Create';
        if (btn) btn.disabled = false;

        closeCreateDocModal();

        if (shareDoc) {
            setTimeout(() => {
                showShareModal(newFile.id);
            }, 300);
        } else {
            showNotification('Document created successfully!', 'success');
        }
    }, 1000);
}

// ===========================
// MODALES - UPLOAD
// ===========================
function openUploadModal() {
    const backdrop = document.getElementById('uploadModalBackdrop');
    if (backdrop) {
        backdrop.classList.add('show');
        document.body.style.overflow = 'hidden';
        AppState.selectedFile = null;
        const uploadBtn = document.getElementById('uploadBtn');
        if (uploadBtn) uploadBtn.disabled = true;
        setTimeout(() => {
            const fileInput = document.getElementById('fileInput');
            if (fileInput) fileInput.focus();
        }, 300);
    }
}

function closeUploadModal() {
    const backdrop = document.getElementById('uploadModalBackdrop');
    if (backdrop) {
        backdrop.classList.remove('show');
        document.body.style.overflow = '';
        const preview = document.getElementById('uploadPreview');
        const fileInfo = document.getElementById('fileInfoContainer');
        if (preview) preview.classList.remove('has-file');
        if (fileInfo) {
            fileInfo.style.display = 'none';
            fileInfo.innerHTML = '';
        }
    }
}

function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    AppState.selectedFile = file;
    const uploadBtn = document.getElementById('uploadBtn');
    if (uploadBtn) uploadBtn.disabled = false;

    const preview = document.getElementById('uploadPreview');
    if (preview) preview.classList.add('has-file');

    const fileSize = (file.size / 1024 / 1024).toFixed(2) + ' MB';
    const fileInfoContainer = document.getElementById('fileInfoContainer');
    if (fileInfoContainer) {
        fileInfoContainer.style.display = 'block';
        fileInfoContainer.innerHTML = `
            <div class="modal-file-info">
                <div class="modal-file-icon">
                    <svg fill="currentColor" viewBox="0 0 16 16">
                        <path d="M14 4.5V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2h5.5zm-3 0A1.5 1.5 0 0 1 9.5 3V1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4.5z"/>
                    </svg>
                </div>
                <div class="modal-file-details">
                    <div class="modal-file-name">${file.name}</div>
                    <div class="modal-file-size">${fileSize}</div>
                </div>
            </div>
        `;
    }
}

function handleUploadSubmit() {
    if (!AppState.selectedFile) return;

    const btn = document.getElementById('uploadBtn');
    const loading = document.getElementById('uploadLoading');
    const btnText = document.getElementById('uploadBtnText');

    if (btn) btn.disabled = true;
    if (loading) loading.style.display = 'inline-block';
    if (btnText) btnText.textContent = 'Uploading...';

    setTimeout(() => {
        const newFile = {
            id: AppState.files.length + 1,
            title: AppState.selectedFile.name,
            name: AppState.selectedFile.name,
            size_bytes: AppState.selectedFile.size,
            updated_at: new Date().toISOString(),
            type: 'doc'
        };

        AppState.files.unshift(newFile);
        renderDocumentsList();

        if (loading) loading.style.display = 'none';
        if (btnText) btnText.textContent = 'Upload';
        if (btn) btn.disabled = false;

        closeUploadModal();
        showNotification('File uploaded successfully!', 'success');
    }, 1500);
}

// ===========================
// MODALES - RENAME
// ===========================
function openRenameModal(fileId) {
    closeAllDropdowns();
    const file = AppState.files.find(f => f.id === fileId);
    if (!file) return;

    AppState.currentFileId = fileId;
    const backdrop = document.getElementById('renameModalBackdrop');
    const input = document.getElementById('renameInput');

    if (input) input.value = file.title || file.name;
    if (backdrop) {
        backdrop.classList.add('show');
        document.body.style.overflow = 'hidden';

        setTimeout(() => {
            if (input) {
                input.focus();
                input.select();
            }
        }, 300);
    }
}

function closeRenameModal() {
    const backdrop = document.getElementById('renameModalBackdrop');
    if (backdrop) {
        backdrop.classList.remove('show');
        document.body.style.overflow = '';
        AppState.currentFileId = null;
    }
}

function handleRenameSubmit() {
    const newName = document.getElementById('renameInput')?.value.trim();
    if (!newName || !AppState.currentFileId) return;

    const btn = event?.target;
    const loading = document.getElementById('renameLoading');
    const btnText = document.getElementById('renameBtnText');

    if (btn) btn.disabled = true;
    if (loading) loading.style.display = 'inline-block';
    if (btnText) btnText.textContent = 'Renaming...';

    setTimeout(() => {
        const file = AppState.files.find(f => f.id === AppState.currentFileId);
        if (file) {
            file.title = newName;
            file.name = newName;
            renderDocumentsList();
        }

        if (loading) loading.style.display = 'none';
        if (btnText) btnText.textContent = 'Rename';
        if (btn) btn.disabled = false;

        closeRenameModal();
        showNotification('Document renamed successfully!', 'success');
    }, 800);
}

// ===========================
// MODALES - DELETE
// ===========================
function openDeleteModal(fileId) {
    closeAllDropdowns();
    const file = AppState.files.find(f => f.id === fileId);
    if (!file) return;

    AppState.currentFileId = fileId;
    const fileName = document.getElementById('deleteFileName');
    if (fileName) fileName.textContent = file.title || file.name;

    const backdrop = document.getElementById('deleteModalBackdrop');
    if (backdrop) {
        backdrop.classList.add('show');
        document.body.style.overflow = 'hidden';
    }
}

function closeDeleteModal() {
    const backdrop = document.getElementById('deleteModalBackdrop');
    if (backdrop) {
        backdrop.classList.remove('show');
        document.body.style.overflow = '';
        AppState.currentFileId = null;
    }
}

async function handleDeleteSubmit() {
    if (!AppState.currentFileId) return;

    const btn = event?.target;
    const loading = document.getElementById('deleteLoading');
    const btnText = document.getElementById('deleteBtnText');

    if (btn) btn.disabled = true;
    if (loading) loading.style.display = 'inline-block';
    if (btnText) btnText.textContent = 'Deleting...';

    try {
        const response = await fetch(`/api/document/${AppState.currentFileId}/delete?user_email=${AppState.currentUserEmail}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const contentType = response.headers.get('content-type');

        if (!response.ok) {
            // Check if response is JSON before parsing
            if (contentType && contentType.includes('application/json')) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Error deleting document');
            } else {
                throw new Error(`Server error: ${response.status} ${response.statusText}`);
            }
        }

        // Remove from local array
        const index = AppState.files.findIndex(f => f.id === AppState.currentFileId);
        if (index > -1) {
            AppState.files.splice(index, 1);
            performSearch(AppState.searchTerm);
        }

        closeDeleteModal();
        showNotification('Document moved to trash', 'success');

    } catch (error) {
        console.error('Delete error:', error);
        showNotification(error.message || 'Error deleting document', 'error');
    } finally {
        if (loading) loading.style.display = 'none';
        if (btnText) btnText.textContent = 'Move to Trash';
        if (btn) btn.disabled = false;
    }
}

// ===========================
// MODAL - LOGOUT CONFIRMATION
// ===========================
function showLogoutModal() {
    const backdrop = document.getElementById('logoutModalBackdrop');
    if (backdrop) {
        backdrop.classList.add('show');
        document.body.style.overflow = 'hidden';
    }
}

function closeLogoutModal() {
    const backdrop = document.getElementById('logoutModalBackdrop');
    if (backdrop) {
        backdrop.classList.remove('show');
        document.body.style.overflow = '';
    }
}

// ===========================
// MODALES - DOWNLOAD
// ===========================
function openDownloadModal(fileId) {
    closeAllDropdowns();
    const file = AppState.files.find(f => f.id === fileId);
    if (!file) return;

    AppState.currentFileId = fileId;
    const fileName = document.getElementById('downloadFileName');
    const fileSize = document.getElementById('downloadFileSize');
    if (fileName) fileName.textContent = file.title || file.name;
    if (fileSize) fileSize.textContent = formatBytes(file.size_bytes || 0);

    const backdrop = document.getElementById('downloadModalBackdrop');
    if (backdrop) {
        backdrop.classList.add('show');
        document.body.style.overflow = 'hidden';
    }
}

function closeDownloadModal() {
    const backdrop = document.getElementById('downloadModalBackdrop');
    if (backdrop) {
        backdrop.classList.remove('show');
        document.body.style.overflow = '';
        AppState.currentFileId = null;
    }
}

function handleDownloadSubmit() {
    if (!AppState.currentFileId) return;

    const btn = event?.target;
    const loading = document.getElementById('downloadLoading');
    const btnText = document.getElementById('downloadBtnText');

    if (btn) btn.disabled = true;
    if (loading) loading.style.display = 'inline-block';
    if (btnText) btnText.textContent = 'Downloading...';

    setTimeout(() => {
        if (loading) loading.style.display = 'none';
        if (btnText) btnText.textContent = 'Download';
        if (btn) btn.disabled = false;

        closeDownloadModal();
        showNotification('Download started!', 'success');
    }, 1200);
}

// ===========================
// MODALES - RESTORE
// ===========================
function openRestoreModal(docId) {
    AppState.currentFileId = docId;

    // Read document name from the trash UI DOM
    const trashItem = document.getElementById(`trash-item-${docId}`);
    const docName = trashItem?.querySelector('.trash-item-title')?.textContent || 'this document';
    const docDate = trashItem?.querySelector('.trash-item-date')?.textContent || '';

    const fileName = document.getElementById('restoreFileName');
    const fileDate = document.getElementById('restoreFileDate');
    if (fileName) fileName.textContent = docName;
    if (fileDate) fileDate.textContent = docDate;

    const backdrop = document.getElementById('restoreModalBackdrop');
    if (backdrop) {
        backdrop.classList.add('show');
        document.body.style.overflow = 'hidden';
    }
}

function closeRestoreModal() {
    const backdrop = document.getElementById('restoreModalBackdrop');
    if (backdrop) {
        backdrop.classList.remove('show');
        document.body.style.overflow = '';
        AppState.currentFileId = null;
    }
}

async function handleRestoreSubmit() {
    if (!AppState.currentFileId) return;

    const docId = AppState.currentFileId;
    const btn = event?.target;
    const loading = document.getElementById('restoreLoading');
    const btnText = document.getElementById('restoreBtnText');

    if (btn) btn.disabled = true;
    if (loading) loading.style.display = 'inline-block';
    if (btnText) btnText.textContent = 'Restoring...';

    try {
        const response = await fetch(`/api/document/${docId}/restore?user_email=${AppState.currentUserEmail}`, {
            method: 'POST'
        });

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Error restoring document');
        }

        closeRestoreModal();

        const item = document.getElementById(`trash-item-${docId}`);
        if (item) item.remove();

        const container = document.getElementById('trashItems');
        if (container && container.children.length === 0) {
            const emptyEl = document.getElementById('trashEmpty');
            if (emptyEl) emptyEl.style.display = 'block';
        }

        showNotification('Document restored successfully!', 'success');
        loadDocuments();

    } catch (error) {
        console.error('Restore error:', error);
        showNotification(error.message || 'Error restoring document', 'error');
    } finally {
        if (loading) loading.style.display = 'none';
        if (btnText) btnText.textContent = 'Restore';
        if (btn) btn.disabled = false;
    }
}

// ===========================
// MODALES - DELETE FOREVER
// ===========================
function openDeleteForeverModal(docId) {
    AppState.currentFileId = docId;

    // Read document name from trash UI DOM
    const trashItem = document.getElementById(`trash-item-${docId}`);
    const docName = trashItem?.querySelector('.trash-item-title')?.textContent || 'this document';

    const fileName = document.getElementById('deleteForeverFileName');
    if (fileName) fileName.textContent = docName;

    const backdrop = document.getElementById('deleteForeverModalBackdrop');
    if (backdrop) {
        backdrop.classList.add('show');
        document.body.style.overflow = 'hidden';
    }
}

function closeDeleteForeverModal() {
    const backdrop = document.getElementById('deleteForeverModalBackdrop');
    if (backdrop) {
        backdrop.classList.remove('show');
        document.body.style.overflow = '';
        AppState.currentFileId = null;
    }
}

async function handleDeleteForeverSubmit() {
    if (!AppState.currentFileId) return;

    const docId = AppState.currentFileId;
    const btn = event?.target;
    const loading = document.getElementById('deleteForeverLoading');
    const btnText = document.getElementById('deleteForeverBtnText');

    if (btn) btn.disabled = true;
    if (loading) loading.style.display = 'inline-block';
    if (btnText) btnText.textContent = 'Deleting...';

    try {
        const response = await fetch(`/api/document/${docId}/delete-permanent?user_email=${AppState.currentUserEmail}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Error deleting document');
        }

        closeDeleteForeverModal();

        const item = document.getElementById(`trash-item-${docId}`);
        if (item) {
            item.style.animation = 'fadeOut 0.3s ease-out forwards';
            setTimeout(() => item.remove(), 300);
        }

        setTimeout(() => {
            const container = document.getElementById('trashItems');
            if (container && container.children.length === 0) {
                const emptyEl = document.getElementById('trashEmpty');
                if (emptyEl) emptyEl.style.display = 'block';
            }
        }, 350);

        showNotification('Document permanently deleted', 'success');

    } catch (error) {
        console.error('Delete permanent error:', error);
        showNotification(error.message || 'Error deleting document', 'error');
    } finally {
        if (loading) loading.style.display = 'none';
        if (btnText) btnText.textContent = 'Delete Forever';
        if (btn) btn.disabled = false;
    }
}

// ===========================
// OFF-CANVAS - SHARE
// ===========================
function openShare(fileId) {
    closeAllDropdowns();
    const offcanvas = document.getElementById('shareOffcanvas');
    const backdrop = document.getElementById('shareBackdrop');

    if (offcanvas && backdrop) {
        closeAllModals();
        offcanvas.classList.add('show');
        backdrop.classList.add('show');
        document.body.style.overflow = 'hidden';
        setupFocusTrap(offcanvas);

        setTimeout(() => {
            const firstInput = offcanvas.querySelector('input:not([readonly])');
            if (firstInput) firstInput.focus();
        }, 300);
    }
}

function closeShare() {
    const offcanvas = document.getElementById('shareOffcanvas');
    const backdrop = document.getElementById('shareBackdrop');

    if (offcanvas && backdrop) {
        offcanvas.classList.remove('show');
        backdrop.classList.remove('show');
        document.body.style.overflow = '';
    }
}

function copyShareLink() {
    const linkInput = document.getElementById('shareLink');
    const copyBtn = document.getElementById('copyLinkBtn');
    const copyBtnText = document.getElementById('copyBtnText');

    if (linkInput) {
        linkInput.select();
        document.execCommand('copy');
    }

    if (copyBtn && copyBtnText) {
        copyBtn.classList.add('copied');
        copyBtnText.textContent = 'Copied!';

        setTimeout(() => {
            copyBtn.classList.remove('copied');
            copyBtnText.textContent = 'Copy';
        }, 2000);
    }
}

// ===========================
// OFF-CANVAS - SHARED FILES
// ===========================
function openSharedFiles() {
    const offcanvas = document.getElementById('sharedOffcanvas');
    const backdrop = document.getElementById('sharedBackdrop');

    if (offcanvas && backdrop) {
        closeAllModals();
        offcanvas.classList.add('show');
        backdrop.classList.add('show');
        document.body.style.overflow = 'hidden';
        setupFocusTrap(offcanvas);
        loadWorkspaces(); // Load workspaces dynamically
    }
}

function closeSharedFiles() {
    const offcanvas = document.getElementById('sharedOffcanvas');
    const backdrop = document.getElementById('sharedBackdrop');

    if (offcanvas && backdrop) {
        offcanvas.classList.remove('show');
        backdrop.classList.remove('show');
        document.body.style.overflow = '';
    }
}

// ===========================
// WORKSPACE MANAGEMENT
// ===========================
let workspaceEmails = [];

function loadWorkspaces() {
    fetch('/api/workspaces')
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                cachedWorkspaces = data.workspaces;
                renderWorkspaceCards(data.workspaces);
            }
        })
        .catch(err => console.error('Error loading workspaces:', err));
}

function renderWorkspaceCards(workspaces) {
    const container = document.getElementById('workspaceCardsContainer');
    const emptyState = document.getElementById('workspaceEmptyState');
    const countBadge = document.getElementById('workspaceCount');
    if (!container) return;

    // Remove all existing cards (keep empty state)
    container.querySelectorAll('.classroom-card').forEach(c => c.remove());

    if (countBadge) countBadge.textContent = workspaces.length;

    if (workspaces.length === 0) {
        if (emptyState) emptyState.style.display = 'block';
        return;
    }

    if (emptyState) emptyState.style.display = 'none';

    workspaces.forEach(ws => {
        container.insertAdjacentHTML('beforeend', renderWorkspaceCard(ws));
    });
}

function renderWorkspaceCard(ws) {
    const progress = ws.progress || 0;
    let progressClass = 'progress-green';
    if (progress < 40) progressClass = 'progress-orange';
    else if (progress < 70) progressClass = 'progress-blue';

    const deadlineDate = new Date(ws.deadline);
    const now = new Date();
    const daysLeft = Math.ceil((deadlineDate - now) / (1000 * 60 * 60 * 24));
    const daysText = ws.is_closed ? 'Closed' : (daysLeft > 0 ? daysLeft : '0');

    const avatarColors = ['avatar-1', 'avatar-2', 'avatar-3', 'avatar-4', 'avatar-5'];
    const invitations = ws.invitations || [];
    const showAvatars = invitations.slice(0, 3);
    const moreCount = invitations.length - 3;

    let avatarsHtml = showAvatars.map((inv, i) =>
        `<div class="avatar ${avatarColors[i % 5]}">${inv.initial || '?'}</div>`
    ).join('');
    if (moreCount > 0) {
        avatarsHtml += `<div class="avatar more-avatars">+${moreCount}</div>`;
    }

    return `
                <div class="classroom-card" onclick="openWorkspaceDetail(${ws.id})">
                    <div class="card-content">
                        <h3 class="assignment-title">${escapeHtml(ws.title)}</h3>
                        <p class="assignment-description">${escapeHtml(ws.description || '')}</p>
                        <div class="assignment-meta">
                            <span>${ws.classroom ? escapeHtml(ws.classroom) : 'No class'}</span>
                            <span class="due-date">${daysText}</span>
                        </div>
                        <div class="progress-section">
                            <div class="progress-label">Progress: ${ws.total_active}/${ws.total_invited}</div>
                            <div class="progress-bar" role="progressbar" aria-valuenow="${progress}" aria-valuemin="0" aria-valuemax="100">
                                <div class="progress-fill ${progressClass}" style="width: ${progress}%;"></div>
                            </div>
                        </div>
                        <div class="participants-section">
                            <div class="participant-avatars">${avatarsHtml}</div>
                            <div style="display:flex;gap:0.3rem;">
                                <button class="edit-btn" onclick="editWorkspace(${ws.id}, event)" aria-label="Edit" title="Edit">
                                    <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                    </svg>
                                </button>
                                <button class="edit-btn" onclick="deleteWorkspace(${ws.id}, '${escapeHtml(ws.title)}', event)" aria-label="Delete" title="Delete" style="color:#ef4444;">
                                    <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>`;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function openWorkspaceDetail(id) {
    const backdrop = document.getElementById('workspaceDetailBackdrop');
    if (backdrop) backdrop.classList.add('show');

    // Loading state
    const tableBody = document.getElementById('wsDetailTableBody');
    tableBody.innerHTML = '<tr><td colspan="6"><div class="ws-detail-loading"><div class="loading"></div><span>Loading workspace…</span></div></td></tr>';
    document.getElementById('wsDetailEmpty').style.display = 'none';

    fetch(`/api/workspaces/${id}/detail`)
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                const ws = data.workspace;
                document.getElementById('wsDetailTitle').textContent = ws.title;
                document.getElementById('wsDetailCreatedAt').textContent = new Date(ws.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                document.getElementById('wsDetailStudentCount').textContent = ws.total_invited || 0;
                document.getElementById('wsDetailDocCount').textContent = ws.invitations ? ws.invitations.filter(i => i.document_id).length : 0;

                const wsClass = document.getElementById('wsDetailClass');
                if (ws.classroom) {
                    wsClass.textContent = ws.classroom;
                    wsClass.style.display = 'inline-flex';
                } else {
                    wsClass.style.display = 'none';
                }

                renderWorkspaceDetailTable(ws.invitations || []);
            } else {
                showToast(data.error || 'Error loading workspace details', 'error');
                closeWorkspaceDetailModal();
            }
        })
        .catch(err => {
            console.error('Error fetching detail:', err);
            showToast('Connection error', 'error');
            closeWorkspaceDetailModal();
        });
}

function closeWorkspaceDetailModal() {
    const backdrop = document.getElementById('workspaceDetailBackdrop');
    if (backdrop) backdrop.classList.remove('show');
}

function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 KB';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getDocTypeIcon(docType) {
    if (docType === 'docx' || docType === 'uploaded') return { icon: 'bi-file-earmark-word-fill', cls: 'ws-doc-icon-docx' };
    if (docType === 'workspace') return { icon: 'bi-pencil-square', cls: 'ws-doc-icon-workspace' };
    return { icon: 'bi-file-earmark-text-fill', cls: 'ws-doc-icon-default' };
}

function getStatusBadge(status) {
    if (status === 'active' || status === 'accedido') {
        return '<span class="ws-status-badge ws-status-active"><i class="bi bi-check-circle-fill"></i> Accessed</span>';
    } else if (status === 'pending' || status === 'invitado') {
        return '<span class="ws-status-badge ws-status-pending"><i class="bi bi-send-fill"></i> Invitation Sent</span>';
    } else if (status === 'blocked') {
        return '<span class="ws-status-badge ws-status-blocked"><i class="bi bi-x-circle-fill"></i> Blocked</span>';
    }
    return '<span class="ws-status-badge ws-status-default"><i class="bi bi-clock"></i> Not Accessed</span>';
}

function renderWorkspaceDetailTable(invitations) {
    const tableBody = document.getElementById('wsDetailTableBody');
    const emptyState = document.getElementById('wsDetailEmpty');
    tableBody.innerHTML = '';

    if (!invitations || invitations.length === 0) {
        emptyState.style.display = 'block';
        return;
    }

    emptyState.style.display = 'none';
    invitations.forEach(inv => {
        const doc = inv.document || {};
        const hasDoc = !!inv.document_id;
        const typeInfo = getDocTypeIcon(doc.document_type || '');
        const tr = document.createElement('tr');
        tr.className = 'ws-detail-row';

        tr.innerHTML = `
                    <td>
                        <div class="ws-doc-icon ${typeInfo.cls}"><i class="bi ${typeInfo.icon}"></i></div>
                    </td>
                    <td>
                        <div class="ws-doc-name" title="${escapeHtml(doc.title || 'No document yet')}">
                            ${escapeHtml(doc.title || 'Untitled Document')}
                        </div>
                        <div class="ws-doc-updated">${doc.updated_at ? new Date(doc.updated_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</div>
                    </td>
                    <td><span class="ws-doc-email">${escapeHtml(inv.email)}</span></td>
                    <td><span class="ws-doc-size">${formatFileSize(doc.size_bytes)}</span></td>
                    <td>${getStatusBadge(inv.status)}</td>
                    <td style="text-align:right;">
                        ${hasDoc ? `<button class="ws-open-btn" onclick="openDocument(${doc.id})" title="Open Document"><i class="bi bi-box-arrow-up-right"></i> Open</button>` : '<span class="ws-no-doc">—</span>'}
                    </td>
                `;
        tableBody.appendChild(tr);
    });
}

function openDocument(id) {
    // Open the review view in a new tab
    window.open(`/review/${id}`, '_blank');
}

// Cached workspaces for editing
let cachedWorkspaces = [];
let deleteWsId = null;

let editWorkspaceEmails = [];
const editEmailColors = [
    { bg: 'rgba(37,99,235,0.15)', border: 'rgba(37,99,235,0.3)', text: '#2563eb' },
    { bg: 'rgba(124,58,237,0.15)', border: 'rgba(124,58,237,0.3)', text: '#7c3aed' },
    { bg: 'rgba(16,185,129,0.15)', border: 'rgba(16,185,129,0.3)', text: '#10b981' },
    { bg: 'rgba(245,158,11,0.15)', border: 'rgba(245,158,11,0.3)', text: '#f59e0b' },
    { bg: 'rgba(239,68,68,0.15)', border: 'rgba(239,68,68,0.3)', text: '#ef4444' },
    { bg: 'rgba(236,72,153,0.15)', border: 'rgba(236,72,153,0.3)', text: '#ec4899' },
    { bg: 'rgba(6,182,212,0.15)', border: 'rgba(6,182,212,0.3)', text: '#06b6d4' },
    { bg: 'rgba(249,115,22,0.15)', border: 'rgba(249,115,22,0.3)', text: '#f97316' }
];

function renderEditEmailChips() {
    const listDiv = document.getElementById('wsEditEmailList');
    listDiv.innerHTML = '';
    editWorkspaceEmails.forEach((email, i) => {
        const c = editEmailColors[i % editEmailColors.length];
        const chip = document.createElement('span');
        chip.style.cssText = `display:inline-flex;align-items:center;gap:0.25rem;padding:0.2rem 0.55rem;background:${c.bg};border:1px solid ${c.border};border-radius:16px;font-size:0.75rem;color:${c.text};font-weight:500;line-height:1.4;`;
        chip.innerHTML = `${email} <button onclick="removeEditWorkspaceEmail('${email}')" style="background:none;border:none;cursor:pointer;color:${c.text};opacity:0.7;font-size:0.9rem;line-height:1;padding:0;margin-left:2px;">×</button>`;
        listDiv.appendChild(chip);
    });
}

function editWorkspace(id, event) {
    event.stopPropagation();
    const ws = cachedWorkspaces.find(w => w.id === id);
    if (!ws) { showToast('Workspace not found', 'error'); return; }

    document.getElementById('wsEditId').value = ws.id;
    document.getElementById('wsEditTitle').value = ws.title || '';
    document.getElementById('wsEditDescription').value = ws.description || '';
    document.getElementById('wsEditClassroom').value = ws.classroom || '';
    document.getElementById('wsEditStartDate').value = ws.start_date ? ws.start_date.split('T')[0] : '';
    document.getElementById('wsEditDeadline').value = ws.deadline ? ws.deadline.split('T')[0] : '';

    // Populate existing emails
    editWorkspaceEmails = (ws.invitations || []).map(inv => inv.email);
    renderEditEmailChips();
    document.getElementById('wsEditEmailInput').value = '';
    document.getElementById('wsEditEmailError').style.display = 'none';

    document.getElementById('editWorkspaceBackdrop').classList.add('show');
}

function closeEditWorkspaceModal() {
    const backdrop = document.getElementById('editWorkspaceBackdrop');
    if (backdrop) backdrop.classList.remove('show');
    editWorkspaceEmails = [];
}

function addEditWorkspaceEmail() {
    const input = document.getElementById('wsEditEmailInput');
    const errorDiv = document.getElementById('wsEditEmailError');
    const email = input.value.trim().toLowerCase();
    errorDiv.style.display = 'none';
    if (!email) return;

    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(email)) {
        errorDiv.textContent = 'Invalid email';
        errorDiv.style.display = 'block';
        return;
    }
    if (editWorkspaceEmails.includes(email)) {
        errorDiv.textContent = 'This email was already added';
        errorDiv.style.display = 'block';
        return;
    }

    editWorkspaceEmails.push(email);
    input.value = '';
    renderEditEmailChips();
    input.focus();
}

function removeEditWorkspaceEmail(email) {
    editWorkspaceEmails = editWorkspaceEmails.filter(e => e !== email);
    renderEditEmailChips();
}

function submitEditWorkspace() {
    const id = document.getElementById('wsEditId').value;
    const title = document.getElementById('wsEditTitle').value.trim();
    const description = document.getElementById('wsEditDescription').value.trim();
    const classroom = document.getElementById('wsEditClassroom').value.trim();
    const startDate = document.getElementById('wsEditStartDate').value;
    const deadline = document.getElementById('wsEditDeadline').value;

    if (!title) { showToast('Title is required', 'error'); return; }
    if (!startDate || !deadline) { showToast('Dates are required', 'error'); return; }
    if (new Date(deadline) < new Date(startDate)) { showToast('Deadline cannot be before start date', 'error'); return; }
    if (editWorkspaceEmails.length === 0) { showToast('Add at least one email', 'error'); return; }

    const btn = document.getElementById('wsEditBtn');
    const btnText = document.getElementById('wsEditBtnText');
    const loading = document.getElementById('wsEditLoading');
    btn.disabled = true;
    btnText.style.display = 'none';
    loading.style.display = 'inline-block';

    fetch(`/api/workspaces/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, classroom, start_date: startDate, deadline, emails: editWorkspaceEmails })
    })
        .then(r => r.json())
        .then(data => {
            btn.disabled = false;
            btnText.style.display = 'inline';
            loading.style.display = 'none';
            if (data.success) {
                closeEditWorkspaceModal();
                loadWorkspaces();
                let msg = 'Workspace updated successfully';
                if (data.emails_added > 0) msg += `. ${data.emails_added} new invitation(s) sent.`;
                if (data.emails_removed > 0) msg += `. ${data.emails_removed} invitation(s) removed.`;
                showToast(msg, 'success');
            } else {
                showToast(data.error || 'Error updating workspace', 'error');
            }
        })
        .catch(() => {
            btn.disabled = false;
            btnText.style.display = 'inline';
            loading.style.display = 'none';
            showToast('Connection error', 'error');
        });
}

function deleteWorkspace(id, title, event) {
    event.stopPropagation();
    deleteWsId = id;
    document.getElementById('deleteWsName').textContent = title;
    const backdrop = document.getElementById('deleteWorkspaceBackdrop');
    backdrop.classList.add('show');
}

function closeDeleteWorkspaceModal() {
    const backdrop = document.getElementById('deleteWorkspaceBackdrop');
    if (backdrop) backdrop.classList.remove('show');
    deleteWsId = null;
}

function confirmDeleteWorkspace() {
    if (!deleteWsId) return;

    const btn = document.getElementById('wsDeleteBtn');
    const btnText = document.getElementById('wsDeleteBtnText');
    const loading = document.getElementById('wsDeleteLoading');
    btn.disabled = true;
    btnText.style.display = 'none';
    loading.style.display = 'inline-block';

    fetch(`/api/workspaces/${deleteWsId}`, { method: 'DELETE' })
        .then(r => r.json())
        .then(data => {
            btn.disabled = false;
            btnText.style.display = 'inline';
            loading.style.display = 'none';
            if (data.success) {
                closeDeleteWorkspaceModal();
                loadWorkspaces();
                showToast('Workspace deleted', 'success');
            } else {
                showToast(data.error || 'Error deleting workspace', 'error');
            }
        })
        .catch(() => {
            btn.disabled = false;
            btnText.style.display = 'inline';
            loading.style.display = 'none';
            showToast('Connection error', 'error');
        });
}

// Create Workspace Modal
function openCreateWorkspaceModal() {
    const backdrop = document.getElementById('createWorkspaceBackdrop');
    if (backdrop) {
        backdrop.classList.add('show');
        document.body.style.overflow = 'hidden';
        // Set default start date to today
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('wsStartDate').value = today;
        document.getElementById('wsTitle').focus();
    }
}

function closeCreateWorkspaceModal() {
    const backdrop = document.getElementById('createWorkspaceBackdrop');
    if (backdrop) {
        backdrop.classList.remove('show');
        // Reset form
        document.getElementById('wsTitle').value = '';
        document.getElementById('wsDescription').value = '';
        document.getElementById('wsClassroom').value = '';
        document.getElementById('wsStartDate').value = '';
        document.getElementById('wsDeadline').value = '';
        document.getElementById('wsEmailInput').value = '';
        document.getElementById('wsEmailList').innerHTML = '';
        document.getElementById('wsEmailError').style.display = 'none';
        workspaceEmails = [];
    }
}

function addWorkspaceEmail() {
    const input = document.getElementById('wsEmailInput');
    const errorDiv = document.getElementById('wsEmailError');
    const email = input.value.trim().toLowerCase();
    errorDiv.style.display = 'none';

    if (!email) return;

    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(email)) {
        errorDiv.textContent = 'Invalid email';
        errorDiv.style.display = 'block';
        return;
    }

    if (workspaceEmails.includes(email)) {
        errorDiv.textContent = 'This email was already added';
        errorDiv.style.display = 'block';
        return;
    }

    workspaceEmails.push(email);
    input.value = '';

    const listDiv = document.getElementById('wsEmailList');
    const chip = document.createElement('span');
    const colors = [
        { bg: 'rgba(37,99,235,0.15)', border: 'rgba(37,99,235,0.3)', text: '#2563eb' },
        { bg: 'rgba(124,58,237,0.15)', border: 'rgba(124,58,237,0.3)', text: '#7c3aed' },
        { bg: 'rgba(16,185,129,0.15)', border: 'rgba(16,185,129,0.3)', text: '#10b981' },
        { bg: 'rgba(245,158,11,0.15)', border: 'rgba(245,158,11,0.3)', text: '#f59e0b' },
        { bg: 'rgba(239,68,68,0.15)', border: 'rgba(239,68,68,0.3)', text: '#ef4444' },
        { bg: 'rgba(236,72,153,0.15)', border: 'rgba(236,72,153,0.3)', text: '#ec4899' },
        { bg: 'rgba(6,182,212,0.15)', border: 'rgba(6,182,212,0.3)', text: '#06b6d4' },
        { bg: 'rgba(249,115,22,0.15)', border: 'rgba(249,115,22,0.3)', text: '#f97316' }
    ];
    const c = colors[workspaceEmails.length % colors.length];
    chip.style.cssText = `display:inline-flex;align-items:center;gap:0.25rem;padding:0.2rem 0.55rem;background:${c.bg};border:1px solid ${c.border};border-radius:16px;font-size:0.75rem;color:${c.text};font-weight:500;line-height:1.4;`;
    chip.innerHTML = `${email} <button onclick="removeWorkspaceEmail('${email}',this)" style="background:none;border:none;cursor:pointer;color:${c.text};opacity:0.7;font-size:0.9rem;line-height:1;padding:0;margin-left:2px;">×</button>`;
    listDiv.appendChild(chip);

    input.focus();
}

function removeWorkspaceEmail(email, btn) {
    workspaceEmails = workspaceEmails.filter(e => e !== email);
    btn.parentElement.remove();
}

function submitCreateWorkspace() {
    const title = document.getElementById('wsTitle').value.trim();
    const description = document.getElementById('wsDescription').value.trim();
    const classroom = document.getElementById('wsClassroom').value.trim();
    const startDate = document.getElementById('wsStartDate').value;
    const deadline = document.getElementById('wsDeadline').value;
    const errorDiv = document.getElementById('wsEmailError');

    // Validate
    if (!title) {
        showToast('Title is required', 'error');
        return;
    }
    if (!startDate || !deadline) {
        showToast('Dates are required', 'error');
        return;
    }
    if (new Date(deadline) < new Date(startDate)) {
        showToast('Deadline cannot be before start date', 'error');
        return;
    }
    if (workspaceEmails.length === 0) {
        errorDiv.textContent = 'Add at least one email';
        errorDiv.style.display = 'block';
        return;
    }

    // Show loading
    const btn = document.getElementById('wsCreateBtn');
    const btnText = document.getElementById('wsCreateBtnText');
    const loading = document.getElementById('wsCreateLoading');
    btn.disabled = true;
    btnText.style.display = 'none';
    loading.style.display = 'inline-block';

    fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            title,
            description,
            classroom,
            start_date: startDate,
            deadline: deadline,
            emails: workspaceEmails
        })
    })
        .then(r => r.json())
        .then(data => {
            btn.disabled = false;
            btnText.style.display = 'inline';
            loading.style.display = 'none';

            if (data.success) {
                closeCreateWorkspaceModal();
                loadWorkspaces();
                showToast(`Workspace created. ${data.emails_sent}/${data.total_emails} emails sent.`, 'success');
            } else {
                showToast(data.error || 'Error creating workspace', 'error');
            }
        })
        .catch(err => {
            btn.disabled = false;
            btnText.style.display = 'inline';
            loading.style.display = 'none';
            showToast('Connection error', 'error');
        });
}

// ===========================
// UTILITY FUNCTIONS
// ===========================
function closeAllModals() {
    closeTrash();
    closeShare();
    closeSharedFiles();
    closeUploadModal();
    closeCreateWorkspaceModal();
    closeEditWorkspaceModal();
    closeDeleteWorkspaceModal();
    closeWorkspaceDetailModal();
    closeRenameModal();
    closeDeleteModal();
    closeDownloadModal();
    closeCreateDocModal();
    closeRestoreModal();
    closeDeleteForeverModal();
    hideShareModal();
}

function setupFocusTrap(container) {
    if (!container) return;

    const focusableElements = container.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );

    if (focusableElements.length === 0) return;

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    const trapStart = container.querySelector('.focus-trap-start');
    const trapEnd = container.querySelector('.focus-trap-end');

    if (trapStart) {
        trapStart.onfocus = () => lastElement.focus();
    }

    if (trapEnd) {
        trapEnd.onfocus = () => firstElement.focus();
    }
}

// ===========================
// KEYBOARD SHORTCUTS
// ===========================
document.addEventListener('keydown', (e) => {
    // Escape key
    if (e.key === 'Escape') {
        if (document.getElementById('sharedOffcanvas')?.classList.contains('show')) {
            closeSharedFiles();
        } else if (document.getElementById('shareOffcanvas')?.classList.contains('show')) {
            closeShare();
        } else if (document.getElementById('trashOffcanvas')?.classList.contains('show')) {
            closeTrash();
        } else if (document.getElementById('uploadModalBackdrop')?.classList.contains('show')) {
            closeUploadModal();
        } else if (document.getElementById('renameModalBackdrop')?.classList.contains('show')) {
            closeRenameModal();
        } else if (document.getElementById('deleteModalBackdrop')?.classList.contains('show')) {
            closeDeleteModal();
        } else if (document.getElementById('downloadModalBackdrop')?.classList.contains('show')) {
            closeDownloadModal();
        } else if (document.getElementById('createDocModalBackdrop')?.classList.contains('show')) {
            closeCreateDocModal();
        } else if (document.getElementById('restoreModalBackdrop')?.classList.contains('show')) {
            closeRestoreModal();
        } else if (document.getElementById('deleteForeverModalBackdrop')?.classList.contains('show')) {
            closeDeleteForeverModal();
        } else if (document.getElementById('shareModal')?.classList.contains('show')) {
            hideShareModal();
        } else {
            closeAllDropdowns();

            // Cerrar notificaciones
            const notifications = document.querySelectorAll('.notification');
            notifications.forEach(notification => {
                notification.style.transform = 'translateX(100%)';
                setTimeout(() => {
                    if (notification.parentNode) {
                        notification.remove();
                    }
                }, 300);
            });
        }
    }

    // Ctrl/Cmd + F para buscar
    if ((e.ctrlKey || e.metaKey) && e.key === 'f' && searchInput) {
        e.preventDefault();
        searchInput.focus();
    }

    // Ctrl/Cmd + K para buscar
    if ((e.ctrlKey || e.metaKey) && e.key === 'k' && searchInput) {
        e.preventDefault();
        searchInput.focus();
    }

    // Ctrl/Cmd + U para upload
    if ((e.ctrlKey || e.metaKey) && e.key === 'u') {
        e.preventDefault();
        handleUpload();
    }

    // Ctrl/Cmd + N para nuevo documento
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        createNewDocument();
    }

    // Navegación de dropdowns
    if (!AppState.activeDropdown) return;

    const dropdown = document.getElementById(`dropdown-${AppState.activeDropdown}`);
    if (!dropdown || !dropdown.classList.contains('show')) return;

    const items = Array.from(dropdown.querySelectorAll('.dropdown-item'));
    const currentIndex = items.indexOf(document.activeElement);

    switch (e.key) {
        case 'ArrowDown':
            e.preventDefault();
            const nextIndex = (currentIndex + 1) % items.length;
            items[nextIndex].focus();
            break;
        case 'ArrowUp':
            e.preventDefault();
            const prevIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
            items[prevIndex].focus();
            break;
        case 'Home':
            e.preventDefault();
            items[0].focus();
            break;
        case 'End':
            e.preventDefault();
            items[items.length - 1].focus();
            break;
    }
});

// Enter key support for inputs
const renameInput = document.getElementById('renameInput');
if (renameInput) {
    renameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            handleRenameSubmit();
        }
    });
}

const newDocName = document.getElementById('newDocName');
if (newDocName) {
    newDocName.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            handleCreateDocSubmit();
        }
    });
}

// ===========================
// ANIMATIONS & EFFECTS
// ===========================
function addRippleEffect() {
    document.querySelectorAll('.card.card--file, .classroom-card').forEach(card => {
        card.addEventListener('click', function (e) {
            if (e.target.closest('.edit-btn') || e.target.closest('.file-menu-btn')) return;

            const ripple = document.createElement('div');
            const rect = this.getBoundingClientRect();
            const size = Math.max(rect.width, rect.height);
            const x = e.clientX - rect.left - size / 2;
            const y = e.clientY - rect.top - size / 2;

            ripple.style.cssText = `
                position: absolute;
                border-radius: 50%;
                background: rgba(22, 33, 255, 0.1);
                transform: scale(0);
                animation: ripple 0.6s cubic-bezier(0.4, 0, 0.2, 1);
                width: ${size}px;
                height: ${size}px;
                left: ${x}px;
                top: ${y}px;
                pointer-events: none;
                z-index: 10;
            `;

            this.style.position = 'relative';
            this.appendChild(ripple);

            setTimeout(() => {
                if (ripple.parentNode) {
                    ripple.remove();
                }
            }, 600);
        });
    });
}

function setupIntersectionObserver() {
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, observerOptions);

    document.querySelectorAll('.shared-section').forEach(section => {
        observer.observe(section);
    });
}

// ===========================
// ANIMACIONES CSS
// ===========================
const style = document.createElement('style');
style.textContent = `
    @keyframes ripple {
        to {
            transform: scale(4);
            opacity: 0;
        }
    }
    
    .classroom-card, .card.card--file {
        position: relative;
        overflow: hidden;
    }
    
    .animate-spin {
        animation: spin 1s linear infinite;
    }
    
    @keyframes spin {
        from {
            transform: rotate(0deg);
        }
        to {
            transform: rotate(360deg);
        }
    }
    
    .fade-out {
        opacity: 0.5;
        transition: opacity 0.15s ease;
    }
`;
document.head.appendChild(style);

// ===========================
// THEME MANAGEMENT
// ===========================
function initTheme() {
    const themeToggle = document.getElementById('theme-toggle-input');
    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    // Apply theme immediately from localStorage for fast render
    function applyTheme(theme) {
        if (theme === 'dark') {
            document.documentElement.classList.add('dark-theme');
            document.body.classList.add('dark-theme');
            if (themeToggle) themeToggle.checked = true;
        } else {
            document.documentElement.classList.remove('dark-theme');
            document.body.classList.remove('dark-theme');
            if (themeToggle) themeToggle.checked = false;
        }
    }

    // Initial apply from localStorage or system preference
    if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
        applyTheme('dark');
    } else {
        applyTheme('light');
    }

    // Fetch theme from server and sync (only override if server has a real preference)
    fetch('/api/user/preferences')
        .then(response => response.json())
        .then(data => {
            if (data.success && data.preferences && data.preferences.theme) {
                const serverTheme = data.preferences.theme;
                // Only override localStorage if server has a real stored preference
                if (serverTheme === 'dark' || serverTheme === 'light') {
                    localStorage.setItem('theme', serverTheme);
                    applyTheme(serverTheme);
                }
            }
        })
        .catch(err => {
            console.log('Could not fetch theme from server, using local preference');
        });

    // Save theme to server when toggled
    if (themeToggle) {
        themeToggle.addEventListener('change', function () {
            const newTheme = this.checked ? 'dark' : 'light';

            // Apply immediately
            applyTheme(newTheme);
            localStorage.setItem('theme', newTheme);

            // Save to server
            fetch('/api/user/preferences/theme', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ theme: newTheme })
            })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        console.log('Theme saved to server:', newTheme);
                    }
                })
                .catch(err => {
                    console.log('Could not save theme to server');
                });
        });
    }
}

// ===========================
// CLOUD STORAGE MANAGER
// ===========================
const CloudStorageState = {
    connectedStorages: [],
    currentStorage: 'native',
    cloudFiles: {},
    cloudFolders: {}
};

function initCloudStorageManager() {
    // Setup dropdown toggle
    const cloudDropdown = document.querySelector('.cloud-storage-dropdown');
    const cloudBtn = cloudDropdown?.querySelector('.cloud-storage-btn');

    if (cloudBtn) {
        cloudBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            cloudDropdown.classList.toggle('active');
        });
    }

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (cloudDropdown && !cloudDropdown.contains(e.target)) {
            cloudDropdown.classList.remove('active');
        }
    });

    // Setup provider icon clicks
    document.querySelectorAll('.cloud-storage-icon').forEach(icon => {
        icon.addEventListener('click', () => {
            const provider = icon.dataset.provider;
            if (icon.classList.contains('connected')) {
                // Show disconnect modal
                showDisconnectModal(provider);
            } else {
                connectCloudStorage(provider);
            }
        });
    });

    // Setup storage tab clicks
    document.querySelector('.storage-tabs')?.addEventListener('click', (e) => {
        const tab = e.target.closest('.storage-tab');
        if (tab) {
            const storage = tab.dataset.storage;
            switchToStorage(storage);
        }
    });

    // Check for existing connections
    loadConnectedStorages();

    // Check if returning from OAuth
    checkOAuthCallback();
}

function getProviderDisplayName(provider) {
    const names = {
        'google_drive': 'Google Drive',
        'onedrive': 'OneDrive',
        'dropbox': 'Dropbox',
        'box': 'Box'
    };
    return names[provider] || provider;
}

function getProviderIcon(provider) {
    const icons = {
        'google_drive': '/static/img/svg/google-drive.svg',
        'onedrive': '/static/img/svg/onedrive.png',
        'dropbox': '/static/img/svg/dropbox.svg',
        'box': '/static/img/svg/box.svg'
    };
    return icons[provider] || '';
}

function connectCloudStorage(provider) {
    const icon = document.querySelector(`.cloud-storage-icon[data-provider="${provider}"]`);
    if (icon) {
        icon.classList.add('connecting');
    }

    // Redirect to OAuth
    window.location.href = `/storage/connect/${provider}`;
}

function disconnectCloudStorage(provider) {
    fetch(`/storage/disconnect/${provider}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                // Update UI
                const icon = document.querySelector(`.cloud-storage-icon[data-provider="${provider}"]`);
                if (icon) {
                    icon.classList.remove('connected', 'connecting');
                }

                // Remove from connected list
                CloudStorageState.connectedStorages = CloudStorageState.connectedStorages.filter(s => s !== provider);

                // Remove tab
                removeStorageTab(provider);

                // If current storage was disconnected, switch to native
                if (CloudStorageState.currentStorage === provider) {
                    switchToStorage('native');
                }

                console.log(`Disconnected from ${getProviderDisplayName(provider)}`);
            }
        })
        .catch(err => {
            console.error('Error disconnecting:', err);
        });
}

function showDisconnectModal(provider) {
    const modal = document.getElementById('disconnectCloudModalBackdrop');
    const icon = document.getElementById('disconnectModalIcon');
    const img = document.getElementById('disconnectModalProviderImg');
    const name = document.getElementById('disconnectModalProviderName');
    const confirmBtn = document.getElementById('disconnectModalConfirmBtn');

    // Set provider-specific content
    img.src = getProviderIcon(provider);
    name.textContent = getProviderDisplayName(provider);
    icon.className = 'disconnect-modal-icon ' + provider;

    // Set confirm action
    confirmBtn.onclick = () => {
        disconnectCloudStorage(provider);
        closeDisconnectModal();
    };

    modal.style.display = 'flex';
}

function closeDisconnectModal() {
    const modal = document.getElementById('disconnectCloudModalBackdrop');
    modal.style.display = 'none';
}

function loadConnectedStorages() {
    fetch('/storage/connected')
        .then(response => response.json())
        .then(data => {
            // Handle both response formats
            let connected = data.connected || data.connected_storages || [];
            if (data.connected_storages) {
                // Backend returns array of objects with 'provider' key
                connected = data.connected_storages.map(s => s.provider || s);
            }
            if (connected.length > 0) {
                CloudStorageState.connectedStorages = connected;
                updateStorageUI();
            }
        })
        .catch(err => {
            console.log('Could not load connected storages');
        });
}

function updateStorageUI() {
    // Update icons
    CloudStorageState.connectedStorages.forEach(provider => {
        const icon = document.querySelector(`.cloud-storage-icon[data-provider="${provider}"]`);
        if (icon) {
            icon.classList.add('connected');
            icon.classList.remove('connecting');
        }

        // Add tab if not exists
        addStorageTab(provider);
    });

    // Show tabs container if has connections
    const tabsContainer = document.getElementById('storageTabsContainer');
    if (tabsContainer) {
        if (CloudStorageState.connectedStorages.length > 0) {
            tabsContainer.classList.add('has-connections');
        } else {
            tabsContainer.classList.remove('has-connections');
        }
    }
}

function addStorageTab(provider) {
    const tabs = document.querySelector('.storage-tabs');
    if (!tabs) return;

    // Check if tab already exists
    if (tabs.querySelector(`[data-storage="${provider}"]`)) return;

    const tab = document.createElement('button');
    tab.className = 'storage-tab';
    tab.dataset.storage = provider;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', 'false');
    tab.innerHTML = `
                <img src="${getProviderIcon(provider)}" alt="${getProviderDisplayName(provider)}">
                <span>${getProviderDisplayName(provider)}</span>
                <button class="tab-close" title="Disconnect">
                    <i class="bi bi-x"></i>
                </button>
            `;

    // Handle close button
    tab.querySelector('.tab-close')?.addEventListener('click', (e) => {
        e.stopPropagation();
        showDisconnectModal(provider);
    });

    tabs.appendChild(tab);
}

function removeStorageTab(provider) {
    const tab = document.querySelector(`.storage-tab[data-storage="${provider}"]`);
    if (tab) {
        tab.remove();
    }

    // Hide tabs container if no more connections
    if (CloudStorageState.connectedStorages.length === 0) {
        document.getElementById('storageTabsContainer')?.classList.remove('has-connections');
    }
}

function switchToStorage(storage) {
    CloudStorageState.currentStorage = storage;

    // Update tab active states
    document.querySelectorAll('.storage-tab').forEach(tab => {
        const isActive = tab.dataset.storage === storage;
        tab.classList.toggle('active', isActive);
        tab.setAttribute('aria-selected', isActive);
    });

    if (storage === 'native') {
        // Show local documents
        loadDocumentsList();
    } else {
        // Load cloud documents
        loadCloudDocuments(storage);
    }
}

function loadCloudDocuments(provider) {
    const container = document.getElementById('docsGrid') || document.getElementById('documentsListContainer');
    if (!container) return;

    container.innerHTML = `
                <div class="loading-cloud-docs" style="grid-column: 1/-1; text-align: center; padding: 3rem;">
                    <div class="storage-loading-spinner"></div>
                    <p style="margin-top: 1rem; color: var(--text);">Loading ${getProviderDisplayName(provider)} documents...</p>
                </div>
            `;

    fetch(`/storage/files/${provider}`)
        .then(response => response.json())
        .then(data => {
            if (data.files) {
                // Filter only DOC/DOCX files
                const docFiles = data.files.filter(file => {
                    const name = file.name || file.title || '';
                    const ext = name.split('.').pop().toLowerCase();
                    return ['doc', 'docx'].includes(ext);
                });

                CloudStorageState.cloudFiles[provider] = docFiles;
                renderCloudDocuments(docFiles, provider);
            }
        })
        .catch(err => {
            console.error('Error loading cloud documents:', err);
            container.innerHTML = `
                        <div style="grid-column: 1/-1; text-align: center; padding: 3rem; color: var(--danger);">
                            <i class="bi bi-exclamation-triangle" style="font-size: 2rem;"></i>
                            <p style="margin-top: 1rem;">Failed to load documents from ${getProviderDisplayName(provider)}</p>
                            <button class="btn btn--primary" onclick="loadCloudDocuments('${provider}')" style="margin-top: 1rem;">
                                <i class="bi bi-arrow-clockwise"></i> Retry
                            </button>
                        </div>
                    `;
        });
}

function renderCloudDocuments(files, provider) {
    const container = document.getElementById('docsGrid') || document.getElementById('documentsListContainer');
    if (!container) return;

    if (files.length === 0) {
        container.innerHTML = `
                    <div style="grid-column: 1/-1; text-align: center; padding: 3rem;">
                        <i class="bi bi-file-earmark-x" style="font-size: 3rem; color: var(--text);"></i>
                        <p style="margin-top: 1rem; color: var(--text);">No DOC/DOCX files found in ${getProviderDisplayName(provider)}</p>
                    </div>
                `;
        return;
    }

    container.innerHTML = '';

    files.forEach(file => {
        const card = createCloudFileCard(file, provider);
        container.appendChild(card);
    });
}

function createCloudFileCard(file, provider) {
    const card = document.createElement('div');
    card.className = 'card card--file';
    card.dataset.cloudFile = file.id;
    card.dataset.provider = provider;

    const name = file.name || file.title || 'Untitled';
    const ext = name.split('.').pop().toLowerCase();
    const size = file.size ? formatFileSize(file.size) : 'Unknown size';
    const modified = file.modifiedTime || file.modified_at || file.client_modified || '';

    card.innerHTML = `
                <div class="file-icon-large ${ext === 'docx' ? 'docx' : 'doc'}" aria-hidden="true">
                    <svg fill="currentColor" viewBox="0 0 16 16">
                        <path d="M5.526 10.273c-.542 0-.832.563-.832 1.612 0 .088.003.173.006.252l1.559-1.143c-.126-.474-.375-.72-.733-.72zm-.732 2.508c.126.472.372.718.732.718.54 0 .83-.563.83-1.614 0-.085-.003-.17-.006-.25l-1.556 1.146z"/>
                        <path d="M9.293 0H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4.707A1 1 0 0 0 13.707 4L10 .293A1 1 0 0 0 9.293 0zM9.5 3.5v-2l3 3h-2a1 1 0 0 1-1-1zm-2.45 8.385c0 1.415-.548 2.206-1.524 2.206C4.548 14.09 4 13.3 4 11.885c0-1.412.548-2.203 1.526-2.203.976 0 1.524.79 1.524 2.203z"/>
                    </svg>
                </div>
                <p class="file-name">${name.length > 25 ? name.substring(0, 22) + '...' : name}</p>
                <span class="file-meta">${size}</span>
                <div class="cloud-provider-badge" style="position: absolute; top: 8px; right: 8px;">
                    <img src="${getProviderIcon(provider)}" alt="${provider}" style="width: 16px; height: 16px;">
                </div>
            `;

    card.addEventListener('click', () => {
        openCloudFile(file, provider);
    });

    return card;
}

function openCloudFile(file, provider) {
    // Download and process the cloud file
    const fileId = file.id;
    const fileName = file.name || file.title || 'document';

    console.log(`Opening cloud file: ${fileName} from ${provider}`);

    // Could redirect to a processing page or download
    window.location.href = `/storage/file/download/${provider}/${fileId}?filename=${encodeURIComponent(fileName)}`;
}

function checkOAuthCallback() {
    const urlParams = new URLSearchParams(window.location.search);
    const connected = urlParams.get('connected');
    const provider = urlParams.get('provider');

    if (connected === 'true' && provider) {
        // Successfully connected
        if (!CloudStorageState.connectedStorages.includes(provider)) {
            CloudStorageState.connectedStorages.push(provider);
        }
        updateStorageUI();

        // Clean URL
        window.history.replaceState({}, document.title, window.location.pathname);

        // Show notification
        console.log(`Successfully connected to ${getProviderDisplayName(provider)}`);
    }
}

// ===========================
// INICIALIZACIÓN
// ===========================
document.addEventListener('DOMContentLoaded', function () {
    console.log('✅ MarkTrack Enhanced initialized');

    // Inicializar Tema
    initTheme();

    // Cargar email y verificar documentos compartidos
    loadUserEmail();
    checkForSharedDocument();

    // Cargar lista de documentos desde API (only if not using new home_base.html UI)
    if (!document.getElementById('homeMain')) {
        loadDocumentsList();
    }

    // Initialize Cloud Storage Manager
    initCloudStorageManager();

    // Configurar vista inicial
    switchView(AppState.currentView);

    // Agregar efectos visuales
    setupIntersectionObserver();
    addRippleEffect();

    // Scroll suave
    document.documentElement.style.scrollBehavior = 'smooth';
});

// Smooth scroll global
document.documentElement.style.scrollBehavior = 'smooth';

// Event Delegation for reactive click effect on cards
document.addEventListener('mousedown', (e) => {
    const card = e.target.closest('.card--file');
    if (card) {
        card.style.transform = 'scale(0.96) translateY(-5px)';
    }
});

document.addEventListener('mouseup', (e) => {
    const card = e.target.closest('.card--file');
    if (card) {
        card.style.transform = '';
    }
});

document.addEventListener('mouseleave', (e) => {
    const card = e.target.closest('.card--file');
    if (card) {
        card.style.transform = '';
    }
});

// EXPLICIT GLOBAL EXPORTS FOR DEBUGGING
try {
    window.openSharedFiles = openSharedFiles;
    window.openTrash = openTrash;
    window.openUploadModal = openUploadModal;
    window.createNewDocument = createNewDocument;
    window.switchView = switchView;
    window.performSearch = performSearch;
    window.toggleDropdown = toggleDropdown;
    window.closeAllDropdowns = closeAllDropdowns;
    window.showLogoutModal = showLogoutModal;
    window.closeLogoutModal = closeLogoutModal;
    window.openAssignment = openAssignment;
    window.editAssignment = editAssignment;
    window.showShareModal = showShareModal;
    window.openRenameModal = openRenameModal;
    window.openDeleteModal = openDeleteModal;
    window.openDownloadModal = openDownloadModal;
    window.openRestoreModal = openRestoreModal;
    window.openDeleteForeverModal = openDeleteForeverModal;
    window.openCreateWorkspaceModal = openCreateWorkspaceModal;
    window.openWorkspaceDetail = openWorkspaceDetail;
    window.editWorkspace = editWorkspace;
    window.closeEditWorkspaceModal = closeEditWorkspaceModal;
    window.deleteWorkspace = deleteWorkspace;
    window.openCloudFile = openCloudFile;
    console.log("Global functions exported successfully");
} catch (e) {
    console.error("Error exporting global functions:", e);
}
