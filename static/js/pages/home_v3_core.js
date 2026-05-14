/* =====================
   GLOBAL DOM ELEMENTS
===================== */
const homeMain      = document.getElementById('homeMain');
const storageView   = document.getElementById('storageView');
const analyticsView = document.getElementById('analyticsView');
const workspaceView = document.getElementById('workspaceView');

/* =====================
   API HELPERS
===================== */
const CSRF = document.querySelector('meta[name="csrf-token"]')?.content || '';

async function apiFetch(url, opts = {}) {
  const defaults = {
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': CSRF
    },
    credentials: 'same-origin'
  };
  const res = await fetch(url, { ...defaults, ...opts });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error de servidor');
  return data;
}

/* =====================
   DATA (loaded from API)
===================== */
let FOLDERS = [];
let DOCS = [];
let archivedItems = [];
let selectedArchived = new Set();

// Color mapping for folder CSS classes
const COLOR_MAP = {
  '#d97706': 'fc-amber', '#1d4ed8': 'fc-blue', '#15803d': 'fc-green',
  '#be123c': 'fc-rose', '#6d28d9': 'fc-violet', '#0e7490': 'fc-cyan',
  '#dc2626': 'fc-red', '#7c3aed': 'fc-violet', '#059669': 'fc-green',
};

function getColorClass(hex) {
  return COLOR_MAP[hex] || 'fc-violet';
}

async function loadFolders() {
  try {
    const data = await apiFetch('/api/folders');
    FOLDERS = (data.folders || []).map(f => {
      window.hbSharedState = window.hbSharedState || {};
      if (f.shared && f.shared.length > 0) {
          window.hbSharedState['folder_' + f.id] = [...f.shared];
      }
      return {
        id: f.id,
        name: f.name,
        count: f.doc_count || 0,
        date: f.created_at ? new Date(f.created_at).toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'}) : '',
        created_at_raw: f.created_at,
        color: getColorClass(f.color),
        bg: f.color || '#6d28d9',
        shared: f.shared || [],
        docs: []
      };
    });
    if (homeMain) renderFolders();
    if (typeof updateSidebarCounts === 'function') updateSidebarCounts();
  } catch (e) {
    console.warn('Folders load (using demo):', e.message);
  }
}

async function loadDocuments() {
  try {
    const data = await apiFetch('/api/documents');
    DOCS = (data.documents || []).map(d => {
      window.hbSharedState = window.hbSharedState || {};
      if (d.shared && d.shared.length > 0) {
          window.hbSharedState['document_' + d.id] = [...d.shared];
      }
      return {
        id: d.id,
        tag: d.document_type === 'created' ? 'created' : (d.document_type === 'uploaded' ? 'uploaded' : (d.document_type || 'notes')),
        tagLabel: d.document_type === 'created' ? 'Created' : (d.document_type === 'uploaded' ? 'Uploaded' : (d.document_type ? d.document_type.charAt(0).toUpperCase() + d.document_type.slice(1) : 'Notes')),
        title: d.title || 'Untitled',
        preview: '',
        date: d.created_at ? new Date(d.created_at).toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'}) : '',
        created_at_raw: d.created_at,
        words: d.size_bytes ? Math.round(d.size_bytes / 5) + ' words' : '—',
        shared: d.shared || []
      };
    });
    if (homeMain) renderDocs();
    if (typeof updateSidebarCounts === 'function') updateSidebarCounts();
  } catch (e) {
    console.warn('Docs load (using demo):', e.message);
  }
}


/* =====================
   DOCUMENT ROUTING
===================== */
function editDocument(docId, event) {
    if (event) event.stopPropagation();
    let doc = DOCS.find(x => x.id == docId);
    if (!doc && window.currentFolderDocs) {
        doc = window.currentFolderDocs.find(x => x.id == docId);
    }
    
    if (!doc) {
        if (typeof showToast === 'function') showToast('Loading document securely...', 'info');
    }
    
    // Fetch a 24-hour secure token
    fetch(`/api/document/${docId}/access_token`)
        .then(r => r.json())
        .then(data => {
            if (data.token) {
                let isPdf = false;
                if (doc && doc.title) {
                    isPdf = doc.title.toLowerCase().endsWith('.pdf');
                }
                if (window.AppLoader) window.AppLoader.show(isPdf ? "Opening PDF viewer..." : "Opening document...");
                window.location.href = isPdf ? `/documentview/${data.token}` : `/documentedit/${data.token}`;
            } else {
                if (typeof showToast === 'function') showToast(data.error || 'Failed to acquire access token', 'error');
            }
        })
        .catch(err => {
            console.error('Token acquisition error:', err);
            if (typeof showToast === 'function') showToast('Error acquiring secure access', 'error');
        });
}
window.editDocument = editDocument;

/* =====================
   RENDER FOLDERS
===================== */
const foldersGrid = document.getElementById('foldersGrid');
function renderFolders() {
  if (!foldersGrid) return;
  foldersGrid.innerHTML = '';
  FOLDERS.forEach(f => {
    let tintAttr = '';
    let styleAttr = '';
    if (f.bg !== '#6d28d9') {
      const rgb = hexToRgb(f.bg);
      if (rgb) {
        tintAttr = `data-tint-r="${rgb[0]}"`;
        styleAttr = `style="--fr:${rgb[0]}; --fg:${rgb[1]}; --fb:${rgb[2]};"`;
      }
    }
    const el = document.createElement('div');
    el.className = 'folder-outer';
    el.dataset.folderId = f.id;
    el.dataset.searchName = f.name.toLowerCase();
    
    // Set the properties directly on el for immediate tinting
    if (tintAttr) {
      el.setAttribute('data-tint-r', tintAttr.match(/"([^"]*)"/)[1]);
      const rgb = hexToRgb(f.bg);
      el.style.setProperty('--fr', rgb[0]);
      el.style.setProperty('--fg', rgb[1]);
      el.style.setProperty('--fb', rgb[2]);
    }

    el.innerHTML = `
      <button class="folder-menu-btn" onclick="openCtx(event,'folder',${f.id})" aria-label="Folder menu">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.5" fill="white" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="white" stroke="none"/><circle cx="12" cy="19" r="1.5" fill="white" stroke="none"/></svg>
      </button>
      <div class="folder-wrapper ${f.color}" onclick="openFolderModal(${f.id})">
        <div class="folder-inner">
          <div class="folder-back"></div>
          <div class="paper-card"><div class="paper-card-line"></div></div>
          <div class="paper paper-3"></div>
          <div class="paper paper-2"></div>
          <div class="paper paper-1"></div>
          <div class="folder-front"></div>
        </div>
      </div>
      <div class="folder-label">
        <div class="f-name">${f.name}</div>
        <div class="f-sub">${f.count} docs</div>
      </div>`;
    foldersGrid.appendChild(el);
  });

  // Check for overflow and setup toggle
  setTimeout(checkFoldersOverflow, 100);
}

/* =====================
   FOLDERS TOGGLE LOGIC
===================== */
let foldersExpanded = false;

function checkFoldersOverflow() {
  if (!foldersGrid) return;
  const toggle = document.getElementById('foldersToggle');
  if (!toggle) return;

  // Temporarily remove collapse to check real height
  const wasCollapsed = foldersGrid.classList.contains('folders-grid--collapsed');
  foldersGrid.classList.remove('folders-grid--collapsed');
  
  const hasOverflow = foldersGrid.scrollHeight > 220; // 220px is our 1-row threshold
  
  if (wasCollapsed || (!foldersExpanded && hasOverflow)) {
    foldersGrid.classList.add('folders-grid--collapsed');
  } else if (foldersExpanded) {
    foldersGrid.classList.remove('folders-grid--collapsed');
  }

  toggle.style.display = hasOverflow ? 'inline-flex' : 'none';
}

function toggleFoldersGrid() {
  window.toggleFoldersGrid = toggleFoldersGrid;
  const toggle = document.getElementById('foldersToggle');
  const text = document.getElementById('foldersToggleText');
  
  foldersExpanded = !foldersExpanded;
  
  if (foldersExpanded) {
    foldersGrid.classList.remove('folders-grid--collapsed');
    foldersGrid.style.maxHeight = foldersGrid.scrollHeight + 'px';
    toggle.classList.add('active');
    text.textContent = 'Show less';
  } else {
    foldersGrid.classList.add('folders-grid--collapsed');
    foldersGrid.style.maxHeight = '220px';
    toggle.classList.remove('active');
    text.textContent = 'See all';
  }
}

// Re-check on resize
window.addEventListener('resize', () => {
  if (FOLDERS.length > 0) checkFoldersOverflow();
});

renderFolders();


/* =====================
   RENDER DOCS
===================== */
const docsGrid = document.getElementById('docsGrid');
function renderDocs() {
  if (!docsGrid) return;
  docsGrid.innerHTML = '';
  DOCS.forEach((d,i) => {
    const el = document.createElement('div');
    el.className = 'doc-outer';
    el.dataset.docIdx = d.id || i;
    el.dataset.searchName = (d.title + ' ' + d.tagLabel).toLowerCase();
    el.innerHTML = `
      <button class="doc-menu-btn" onclick="openCtx(event,'doc',${d.id || i})" aria-label="Document menu">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.5" fill="#555" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="#555" stroke="none"/><circle cx="12" cy="19" r="1.5" fill="#555" stroke="none"/></svg>
      </button>
      <div class="doc-stack" onclick="if(typeof editDocument==='function') editDocument(${d.id || i}, event)" ondblclick="if(typeof editDocument==='function') editDocument(${d.id || i}, event)">
        <div class="doc-page dp-b2"></div>
        <div class="doc-page dp-b1"></div>
        <div class="doc-page dp-front">
          <div class="doc-tag tag-${d.tag}">${d.tagLabel}</div>
          <div class="doc-title">${d.title}</div>
          <div class="doc-preview">${d.preview}</div>
          <div class="doc-footer">
            <span class="doc-date">${d.date}</span>
            <span class="doc-words">${d.words}</span>
          </div>
        </div>
      </div>`;
    docsGrid.appendChild(el);
  });

  // Kick off lazy preview loading for visible cards
  if (window.DocumentPreviewService) {
    window.DocumentPreviewService.observeCards();
  }
}
renderDocs();


/* =====================
   SEARCH
===================== */
let searchExpanded = false;
const searchWrapper = document.getElementById('searchWrapper');
const searchToggle = document.getElementById('searchToggle');
const searchInput = document.getElementById('searchInput');

function toggleSearch() {
  window.toggleSearch = toggleSearch;
  searchExpanded = !searchExpanded;
  searchWrapper.classList.toggle('expanded', searchExpanded);
  searchToggle.classList.toggle('active', searchExpanded);
  if (searchExpanded) {
    setTimeout(() => searchInput.focus(), 350);
  } else {
    searchInput.value = '';
    filterContent('');
  }
}

if (searchInput) {
  searchInput.addEventListener('input', e => filterContent(e.target.value.trim().toLowerCase()));

  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Escape') { toggleSearch(); }
  });
}

function filterContent(q) {
window.filterContent = filterContent;
  const folders = foldersGrid.querySelectorAll('.folder-outer');
  const docs = docsGrid.querySelectorAll('.doc-outer');

  let fVisible = 0, dVisible = 0;

  folders.forEach(el => {
    const name = el.dataset.searchName || '';
    const match = !q || name.includes(q);
    el.style.display = match ? '' : 'none';
    el.classList.toggle('search-highlight', !!q && match);
    if (match) fVisible++;
  });

  docs.forEach(el => {
    const name = el.dataset.searchName || '';
    const match = !q || name.includes(q);
    el.style.display = match ? '' : 'none';
    el.classList.toggle('search-highlight', !!q && match);
    if (match) dVisible++;
  });

  document.getElementById('foldersNoResults').classList.toggle('show', !!q && fVisible === 0);
  document.getElementById('docsNoResults').classList.toggle('show', !!q && dVisible === 0);
}

/* =====================
   PLUS DROPDOWN
===================== */
let dropdownOpen = false;
const plusBtn = document.getElementById('plusBtn');
const plusDropdown = document.getElementById('plusDropdown');

function toggleDropdown(e) {
  window.toggleDropdown = toggleDropdown;
  if (!plusBtn || !plusDropdown) return;
  e.stopPropagation();
  dropdownOpen = !dropdownOpen;
  plusBtn.classList.toggle('open', dropdownOpen);
  plusDropdown.classList.toggle('show', dropdownOpen);
}

async function ddAction(action) {
  window.ddAction = ddAction;
  plusDropdown.classList.remove('show');
  plusBtn.classList.remove('open');
  dropdownOpen = false;

  if (action === 'upload-doc') {
    uploadFileInput.webkitdirectory = false;
    uploadFileInput.click();
  } else if (action === 'upload-folder') {
    uploadFileInput.webkitdirectory = true;
    uploadFileInput.click();
  } else if (action === 'new-doc') {
    if (typeof openWdModal === 'function') openWdModal();
  } else if (action === 'new-folder') {
    openNewFolderModal();
  }
}

document.addEventListener('click', () => {
  if (plusDropdown) plusDropdown.classList.remove('show');
  if (plusBtn) plusBtn.classList.remove('open');
  dropdownOpen = false;
});

/* =====================
   UPLOAD PANEL
===================== */
let uploadItems = [];
let uploadCollapsed = false;
const uploadPanel = document.getElementById('uploadPanel');
const uploadList = document.getElementById('uploadList');

const uploadFileInput = document.createElement('input');
uploadFileInput.type = 'file';
uploadFileInput.multiple = true;
uploadFileInput.accept = '.doc,.docx';
uploadFileInput.style.display = 'none';
document.body.appendChild(uploadFileInput);

uploadFileInput.addEventListener('change', e => {
  if (e.target.files.length) handleFiles(e.target.files);
  uploadFileInput.value = '';
});

// Prevent default drag behaviors
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => {
  document.addEventListener(evt, e => { e.preventDefault(); e.stopPropagation(); });
});
document.addEventListener('dragover', () => { document.body.style.opacity = '0.9'; });
document.addEventListener('dragleave', () => { document.body.style.opacity = '1'; });
document.addEventListener('drop', e => {
  document.body.style.opacity = '1';
  if (e.dataTransfer.files && e.dataTransfer.files.length) {
    handleFiles(e.dataTransfer.files);
  }
});

function handleFiles(files) {
  const folderIdToUse = window.currentFolderId || null;
  Array.from(files).forEach(f => {
    const isDoc = f.name.toLowerCase().endsWith('.doc') || f.name.toLowerCase().endsWith('.docx');
    if (!isDoc) {
      showToast('Support only for .doc and .docx files');
      return;
    }
    const item = {
      id: Date.now() + Math.random(),
      name: f.name,
      type: 'document',
      progress: 0,
      status: 'uploading',
      xhr: null,
      folder_id: folderIdToUse
    };
    uploadItems.push(item);
    uploadPanel.classList.add('show');
    renderUploadList();
    uploadFileAPI(f, item);
  });
}

function uploadFileAPI(file, item) {
  const formData = new FormData();
  formData.append('file', file);
  if (item.folder_id) {
    formData.append('folder_id', item.folder_id);
  }
  item.xhr = new XMLHttpRequest();
  item.xhr.open('POST', '/upload_bp/api/document/upload');
  item.xhr.setRequestHeader('X-CSRFToken', CSRF);
  
  item.xhr.upload.onprogress = e => {
    if (e.lengthComputable) {
      item.progress = (e.loaded / e.total) * 100;
      renderUploadList();
    }
  };
  
  item.xhr.onload = () => {
    if (item.xhr.status >= 200 && item.xhr.status < 300) {
      item.progress = 100;
      item.status = 'done';
      loadDocuments();
      // If modal is open for this folder, refresh it so user sees the new document
      if (window.currentFolderId && item.folder_id == window.currentFolderId) {
          openFolderModal(window.currentFolderId);
      }
    } else {
      let err = 'Upload Error';
      try { err = JSON.parse(item.xhr.responseText).error || err; } catch(e){}
      showToast(err);
      item.status = 'error';
    }
    renderUploadList();
  };
  
  item.xhr.onerror = () => { item.status = 'error'; renderUploadList(); };
  item.xhr.onabort = () => { item.status = 'error'; renderUploadList(); };
  item.xhr.send(formData);
}

function openUploadPanel(files) {
  // Called by UI "Upload Document" button if it exists
  uploadFileInput.click();
}

function renderUploadList() {
  const done = uploadItems.filter(x => x.status === 'done').length;
  const total = uploadItems.length;

  uploadList.innerHTML = uploadItems.map(item => {
    const isFolder = item.type === 'folder';
    const isDone = item.status === 'done';
    const isError = item.status === 'error';
    const iconClass = isError ? 'error-icon' : isDone ? 'done-icon' : isFolder ? 'folder-icon' : '';
    const statusText = isError ? 'Upload failed' : isDone ? 'Completed' : `Uploading… ${Math.round(item.progress)}%`;
    const statusClass = isError ? 'error' : isDone ? 'done' : '';
    const fillClass = isError ? 'error-fill' : isDone ? 'done-fill' : '';

    const fileIcon = isFolder
      ? `<svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>`
      : isDone
      ? `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M9 12l2 2 4-4"/></svg>`
      : isError
      ? `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`
      : `<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;

    return `
      <div class="upload-item" data-id="${item.id}">
        <div class="upload-file-icon ${iconClass}">${fileIcon}</div>
        <div class="upload-info">
          <div class="upload-name">${item.name}</div>
          <div class="upload-status ${statusClass}">${statusText}</div>
          ${!isDone && !isError ? `<div class="progress-bar-wrap"><div class="progress-bar-fill ${fillClass}" style="width:${item.progress}%"></div></div>` : ''}
        </div>
        ${!isDone ? `<div class="upload-cancel" onclick="cancelUpload(${item.id})"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></div>` : ''}
      </div>`;
  }).join('');

  const footerEl = document.getElementById('uploadFooterText');
  if (done === total) {
    footerEl.innerHTML = `<span>${done} of ${total}</span> files uploaded`;
  } else {
    footerEl.innerHTML = `Uploading <span>${done} of ${total}</span> files…`;
  }
}

function cancelUpload(id) {
  const item = uploadItems.find(x => x.id === id);
  if (item && item.xhr && item.status === 'uploading') {
    item.xhr.abort();
  }
  uploadItems = uploadItems.filter(x => x.id !== id);
  if (uploadItems.length === 0) { closeUploadPanel(); return; }
  renderUploadList();
}

function closeUploadPanel() {
  window.closeUploadPanel = closeUploadPanel;
  uploadPanel.classList.remove('show');
  setTimeout(() => { uploadItems = []; uploadList.innerHTML = ''; }, 400);
}

function toggleUploadCollapse() {
  uploadCollapsed = !uploadCollapsed;
  const wrap = document.getElementById('uploadListWrap');
  const chevron = document.getElementById('upChevron');
  wrap.style.display = uploadCollapsed ? 'none' : '';
  chevron.querySelector('svg').style.transform = uploadCollapsed ? 'rotate(180deg)' : '';
}

function addMoreFiles() {
  uploadFileInput.click();
}
// ── Load real data from API at page init ──
// loadFolders y loadDocuments tienen guardas internas para renderizar grillas
// solo en /home; siempre se llaman para poblar los contadores del sidebar.
loadFolders();
loadDocuments();

/* =====================
   ARCHIVED OFFCANVAS
===================== */
let ocCurrentMode = 'trash'; // 'trash' or 'archive'

async function openArchived(mode = 'trash') {
  window.openArchived = openArchived;
  ocCurrentMode = mode;
  
  const titleEl = document.getElementById('ocViewTitle');
  const subEl = document.getElementById('ocViewSubtitle');
  const iconEl = document.getElementById('ocViewIcon');
  if (mode === 'archive') {
    titleEl.innerText = 'Archived Vault';
    subEl.innerText = 'Hidden folders that are safely stored away';
    iconEl.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor" width="24" height="24"><path d="M0 2a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1v7.5a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 1 12.5V5a1 1 0 0 1-1-1V2zm2 3v7.5A1.5 1.5 0 0 0 3.5 14h9a1.5 1.5 0 0 0 1.5-1.5V5H2zm13-3H1v2h14V2zM5 7.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5z"/></svg>';
  } else {
    titleEl.innerText = 'Trash';
    subEl.innerText = 'Items deleted permanently after 30 days';
    iconEl.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
  }

  try {
    if (mode === 'archive') {
      const data = await apiFetch('/api/folders/archived');
      archivedItems = (data.items || data.folders || []).map(item => ({
        id: item.id,
        name: item.name || item.title,
        type: item.item_type || 'folder',
        date: item.updated_at ? new Date(item.updated_at).toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'}) : '—'
      }));
    } else {
      const data = await apiFetch('/api/trash/all');
      archivedItems = (data.items || []).map(item => ({
        id: item.id,
        name: item.name || item.title,
        type: item.item_type,
        date: item.deleted_at ? new Date(item.deleted_at).toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'}) : '—'
      }));
    }
  } catch (e) { console.warn('Load error:', e.message); }
  selectedArchived.clear();
  renderArchivedItems();
  document.getElementById('offcanvasOverlay').classList.add('open');
  document.getElementById('offcanvas').classList.add('open');
}

function closeArchived() {
  window.closeArchived = closeArchived;
  document.getElementById('offcanvasOverlay').classList.remove('open');
  document.getElementById('offcanvas').classList.remove('open');
  selectedArchived.clear();
  updateOcToolbar();
}

function renderArchivedItems() {
  const body = document.getElementById('offcanvasBody');
  const countBadge = document.getElementById('ocCountBadge');
  countBadge.innerHTML = `<strong>${archivedItems.length}</strong> ${ocCurrentMode === 'archive' ? 'Archived' : 'Trash'} items`;
  if (ocCurrentMode === 'trash') {
    document.getElementById('archivedCount').textContent = archivedItems.length;
  } else {
    document.getElementById('realArchivedCount').textContent = archivedItems.length;
  }

  if (archivedItems.length === 0) {
    body.innerHTML = `
      <div class="offcanvas-empty">
        <div class="oc-empty-icon"><svg viewBox="0 0 24 24"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg></div>
        <div class="oc-empty-title">Empty Trash</div>
        <div class="oc-empty-sub">Deleted items will appear here.<br>You can restore them or permanently delete them.</div>
      </div>`;
    return;
  }

  body.innerHTML = archivedItems.map(item => {
    const sel = selectedArchived.has(item.id + '_' + item.type);
    const isFolder = item.type === 'folder';
    const icon = isFolder
      ? `<svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>`
      : `<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
    return `
      <div class="archived-item ${sel ? 'selected' : ''}" onclick="toggleArchiveSelect('${item.id}_${item.type}')">
        <div class="archived-item-cb"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></div>
        <div class="archived-item-icon">${icon}</div>
        <div class="archived-item-info">
          <div class="archived-item-name">${item.name}</div>
          <div class="archived-item-meta">${isFolder ? 'Folder' : 'Document'} · ${ocCurrentMode === 'archive' ? 'Archived' : 'Deleted'} ${item.date}</div>
        </div>
        <div class="archived-item-actions">
          <div class="arch-act-btn restore-btn" title="Restore" onclick="openRestoreModal(event,${item.id},'${item.type}')">
            <svg viewBox="0 0 24 24"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>
          </div>
          <div class="arch-act-btn delete-btn" title="Delete forever" onclick="deleteOne(event,${item.id},'${item.type}')">
            <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
          </div>
        </div>
      </div>`;
  }).join('');
}

function toggleArchiveSelect(key) {
  if (selectedArchived.has(key)) selectedArchived.delete(key);
  else selectedArchived.add(key);
  updateOcToolbar();
  renderArchivedItems();
}

function toggleSelectAll() {
  window.toggleSelectAll = toggleSelectAll;
  if (selectedArchived.size === archivedItems.length && archivedItems.length > 0) {
    selectedArchived.clear();
  } else {
    archivedItems.forEach(x => selectedArchived.add(x.id + '_' + x.type));
  }
  updateOcToolbar();
  renderArchivedItems();
}

function updateOcToolbar() {
  const has = selectedArchived.size > 0;
  document.getElementById('restoreBtn').classList.toggle('visible', has);
  document.getElementById('deletePermaBtn').classList.toggle('visible', has);
  const cb = document.getElementById('selectAllCb');
  const allSel = archivedItems.length > 0 && selectedArchived.size === archivedItems.length;
  cb.classList.toggle('checked', allSel);
}

async function restoreOne(e, id, type) {
  window.restoreOne = restoreOne;
  e.stopPropagation();
  try {
    if (type === 'folder') {
      await apiFetch(`/api/folder/${id}/restore`, { method: 'POST' });
    } else {
      await apiFetch(`/api/document/${id}/restore`, { method: 'POST' });
    }
    archivedItems = archivedItems.filter(x => !(x.id === id && x.type === type));
    selectedArchived.delete(id + '_' + type);
    updateOcToolbar();
    renderArchivedItems();
    showToast('Item restored');
    if (homeMain) { loadFolders(); loadDocuments(); }
  } catch (e2) { showToast(e2.message); }
}

async function deleteOne(e, id, type) {
  window.deleteOne = deleteOne;
  e.stopPropagation();
  const item = archivedItems.find(x => x.id === id && x.type === type);
  openDeleteForeverModal(id, type, item?.name || 'this item');
}

async function _execDeleteOne(id, type) {
  try {
    if (type === 'folder') {
      await apiFetch(`/api/folder/${id}/delete-permanent`, { method: 'DELETE' });
    } else {
      await apiFetch(`/api/document/${id}/delete-permanent`, { method: 'DELETE' });
    }
    archivedItems = archivedItems.filter(x => !(x.id === id && x.type === type));
    selectedArchived.delete(id + '_' + type);
    updateOcToolbar();
    renderArchivedItems();
    showToast('Permanently deleted');
  } catch (e2) { showToast(e2.message); }
}

async function restoreSelected() {
  window.restoreSelected = restoreSelected;
  const items = [...selectedArchived].map(key => {
    const [id, type] = key.split('_');
    return { id: parseInt(id), item_type: type };
  });
  
  try {
    if (ocCurrentMode === 'archive') {
      for (const item of items) {
        if (item.item_type === 'folder') {
          await apiFetch(`/api/folder/${item.id}/restore`, { method: 'POST' });
        } else {
          await apiFetch(`/api/document/${item.id}/restore`, { method: 'POST' });
        }
      }
      showToast('Items restored from archive');
    } else {
      await apiFetch('/api/trash/restore-bulk', {
        method: 'POST',
        body: JSON.stringify({ items })
      });
      showToast('Items restored from trash');
    }
    selectedArchived.clear();
    await openArchived(ocCurrentMode);
    if (homeMain) { loadFolders(); loadDocuments(); }
  } catch (e) { showToast(e.message); }
}

async function deleteSelected() {
  window.deleteSelected = deleteSelected;
  const items = [...selectedArchived].map(key => {
    const [id, type] = key.split('_');
    return { id: parseInt(id), item_type: type };
  });
  try {
    if (ocCurrentMode === 'archive') {
       // Send archived items to TRASH
       for (const item of items) {
         if (item.item_type === 'folder') {
           await apiFetch(`/api/folder/${item.id}/trash`, { method: 'PUT' });
         }
       }
       showToast('Items moved to trash');
    } else {
       await apiFetch('/api/trash/delete-bulk', {
         method: 'POST',
         body: JSON.stringify({ items })
       });
       showToast('Items permanently deleted');
    }
    selectedArchived.clear();
    await openArchived(ocCurrentMode);
  } catch(e) { showToast(e.message); }
}

function clearAllArchived() {
  window.clearAllArchived = clearAllArchived;
  archivedItems = [];
  selectedArchived.clear();
  updateOcToolbar();
  renderArchivedItems();
}

async function refreshViews() {
  await Promise.all([loadFolders(), loadDocuments()]);
  if (window.currentFolderId) {
    openFolderModal(window.currentFolderId);
  }
}

async function archiveItem(type, id) {
  window.archiveItem = archiveItem;
  try {
    if (type === 'folder') {
      await apiFetch(`/api/folder/${id}/archive`, { method: 'PUT' });
      const f = FOLDERS.find(x => x.id === id);
      showToast(`"${f?.name || 'Folder'}" archived`);
      await refreshViews();
    } else {
      await apiFetch(`/api/document/${id}/archive`, { method: 'PUT' });
      const d = DOCS.find(x => x.id == id) || (window.currentFolderDocs && window.currentFolderDocs.find(x => x.id == id));
      showToast(`"${d?.title || 'Document'}" archived`);
      await refreshViews();
    }
  } catch (e) { showToast(e.message); }
}

async function deleteItem(type, id) {
  window.deleteItem = deleteItem;
  // Find name for the modal
  let name = 'this item';
  if (type === 'folder') {
    const f = FOLDERS.find(x => x.id === id);
    name = f?.name || 'this folder';
  } else {
    const d = DOCS.find(x => x.id == id) || (window.currentFolderDocs && window.currentFolderDocs.find(x => x.id == id));
    name = d?.title || 'this document';
  }
  openDeleteModal(type, id, name);
}

async function _execDeleteItem(type, id) {
  try {
    if (type === 'folder') {
      await apiFetch(`/api/folder/${id}/delete`, { method: 'DELETE' });
      showToast('Folder moved to trash');
      await refreshViews();
    } else {
      await apiFetch(`/api/document/${id}/delete`, { method: 'DELETE' });
      showToast('Document moved to trash');
      await refreshViews();
    }
  } catch (e) { showToast(e.message); }
}

async function renameItem(type, id) {
  window.renameItem = renameItem;
  if (type === 'folder') {
    const f = FOLDERS.find(x => x.id === id);
    openRenameModal('folder', id, f?.name || '');
  } else {
    const d = DOCS.find(x => x.id == id) || (window.currentFolderDocs && window.currentFolderDocs.find(x => x.id == id));
    if (!d) return;
    openRenameModal('doc', id, d.title || '');
  }
}

async function _execRenameItem(type, id, newName) {
  try {
    if (type === 'folder') {
      await apiFetch(`/api/folder/${id}/rename`, {
        method: 'PUT',
        body: JSON.stringify({ name: newName })
      });
      showToast(`Renamed to "${newName}"`);
      await refreshViews();
    } else {
      await apiFetch(`/api/document/${id}/rename`, {
        method: 'PUT',
        body: JSON.stringify({ title: newName })
      });
      showToast(`Renamed to "${newName}"`);
      await refreshViews();
    }
  } catch (e) { showToast(e.message); }
}

/* =====================
   CONTEXT MENU - updated
===================== */
const ctxMenu = document.getElementById('ctxMenu');
let ctxTarget = null;

function openCtx(e, type, id) {
  window.openCtx = openCtx;
  e.stopPropagation();
  ctxTarget = { type, id };
  // Show/hide folder-only items
  ctxMenu.querySelectorAll('.ctx-folder-only').forEach(el => {
    el.style.display = type === 'folder' ? 'flex' : 'none';
  });
  // Show/hide doc-only items
  ctxMenu.querySelectorAll('.ctx-doc-only').forEach(el => {
    el.style.display = (type === 'document' || type === 'doc') ? 'flex' : 'none';
  });
  ctxMenu.classList.add('show');
  
  // Calculate position logic as it was
  let x = e.clientX;
  let y = e.clientY;
  
  // Basic bounds check so menu doesn't overflow screen
  const menuWidth = 180;
  const menuHeight = 220;
  
  if (x + menuWidth > window.innerWidth) x -= menuWidth;
  if (y + menuHeight > window.innerHeight) y -= menuHeight;
  
  ctxMenu.style.left = x + 'px';
  ctxMenu.style.top  = y + 'px';
}

ctxMenu.querySelectorAll('.ctx-item').forEach(item => {
  item.addEventListener('click', e => {
    const action = item.dataset.action;
    if (action === 'open' && ctxTarget?.type === 'folder') {
      openFolderModal(ctxTarget.id);
    } else if (action === 'open' && (ctxTarget?.type === 'doc' || ctxTarget?.type === 'document')) {
      if (typeof editDocument === 'function') editDocument(ctxTarget.id, e);
    }
    if (action === 'change-color' && ctxTarget?.type === 'folder') {
      const f = FOLDERS.find(x => x.id === ctxTarget.id);
      openColorPicker(ctxTarget.id, f ? f.bg : '#6d28d9');
    }
    if (action === 'rename') {
      renameItem(ctxTarget.type, ctxTarget.id);
    }
    if (action === 'move-to' && (ctxTarget?.type === 'document' || ctxTarget?.type === 'doc')) {
      openMoveModal(ctxTarget.id);
    }
    if (action === 'archive') {
      archiveItem(ctxTarget.type, ctxTarget.id);
    }
    if (action === 'delete') {
      deleteItem(ctxTarget.type, ctxTarget.id);
    }
    if (action === 'share') {
      let name = 'Resource';
      if (ctxTarget.type === 'folder') {
        const f = FOLDERS.find(x => x.id === ctxTarget.id);
        if (f) name = f.name;
      } else {
        const d = DOCS.find(x => x.id === ctxTarget.id);
        if (d) name = d.title || d.name; // documents often use title
      }
      hbOpenShare(ctxTarget.id, ctxTarget.type, name);
    }
    ctxMenu.classList.remove('show');
  });
});

document.addEventListener('click', () => ctxMenu.classList.remove('show'));
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    ctxMenu.classList.remove('show');
    closeModal();
    closeCp();
    if (searchExpanded) toggleSearch();
  }
});

/* =====================
   COLOR PICKER
===================== */
const cpOverlay  = document.getElementById('cpOverlay');
const cpCanvas   = document.getElementById('cpCanvas');
const cpCursor   = document.getElementById('cpCursor');
const cpHueTrack = document.getElementById('cpHueTrack');
const cpHueThumb = document.getElementById('cpHueThumb');
const cpPreview  = document.getElementById('cpPreview');
const cpHexInput = document.getElementById('cpHexInput');
const cpApply    = document.getElementById('cpApply');
const cpCancel   = document.getElementById('cpCancel');
const cpClose    = document.getElementById('cpClose');
// Live folder preview elements
const cpFolderBack  = document.getElementById('cpFolderBack');
const cpFolderFront = document.getElementById('cpFolderFront');
const cpPaper1      = document.getElementById('cpPaper1');
const cpFolderName  = document.getElementById('cpFolderName');
const cpFolderHex   = document.getElementById('cpFolderHex');

let cpHue = 270, cpSat = 0.75, cpVal = 0.65;
let cpTargetFolderId = null;
let cpCtx = null;

/* -- Utils -- */
function hsvToRgb(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60)       { r=c; g=x; b=0; }
  else if (h < 120) { r=x; g=c; b=0; }
  else if (h < 180) { r=0; g=c; b=x; }
  else if (h < 240) { r=0; g=x; b=c; }
  else if (h < 300) { r=x; g=0; b=c; }
  else              { r=c; g=0; b=x; }
  return [Math.round((r+m)*255), Math.round((g+m)*255), Math.round((b+m)*255)];
}

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b), d = max - min;
  let h = 0, s = max === 0 ? 0 : d / max, v = max;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  return [h, s, v];
}

function hexToRgb(hex) {
  const h = hex.replace('#','');
  if (h.length !== 6) return null;
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
}

function rgbToHex(r, g, b) {
  return '#' + [r,g,b].map(x => x.toString(16).padStart(2,'0')).join('');
}

function cpCurrentHex() {
  const [r,g,b] = hsvToRgb(cpHue, cpSat, cpVal);
  return rgbToHex(r,g,b);
}

/* -- Canvas drawing -- */
function drawSVCanvas() {
  const W = cpCanvas.width, H = cpCanvas.height;
  if (!cpCtx) cpCtx = cpCanvas.getContext('2d');
  // Hue base
  const hueColor = `hsl(${cpHue},100%,50%)`;
  // White to hue (left to right)
  const gH = cpCtx.createLinearGradient(0,0,W,0);
  gH.addColorStop(0, '#fff');
  gH.addColorStop(1, hueColor);
  cpCtx.fillStyle = gH;
  cpCtx.fillRect(0,0,W,H);
  // Transparent to black (top to bottom)
  const gV = cpCtx.createLinearGradient(0,0,0,H);
  gV.addColorStop(0, 'rgba(0,0,0,0)');
  gV.addColorStop(1, '#000');
  cpCtx.fillStyle = gV;
  cpCtx.fillRect(0,0,W,H);
}

function updateCanvasSize() {
  const rect = cpCanvas.getBoundingClientRect();
  cpCanvas.width  = rect.width  || 254;
  cpCanvas.height = rect.height || 180;
  drawSVCanvas();
}

function updateCursor() {
  const W = cpCanvas.offsetWidth, H = cpCanvas.offsetHeight;
  cpCursor.style.left = (cpSat * W) + 'px';
  cpCursor.style.top  = ((1 - cpVal) * H) + 'px';
}

function updateHueThumb() {
  const W = cpHueTrack.offsetWidth;
  cpHueThumb.style.left = ((cpHue / 360) * W) + 'px';
}

function updatePreview() {
  const hex = cpCurrentHex();
  const rgb = hexToRgb(hex);
  cpPreview.style.background = hex;
  cpHexInput.value = hex;
  cpFolderHex.textContent = hex;

  if (rgb) {
    const [r,g,b] = rgb;
    // Tint folder preview with same opacity levels as the real folders
    const glassBg = `linear-gradient(180deg, rgba(${r},${g},${b},0.09) 0%, rgba(${r},${g},${b},0.22) 100%)`;
    const tabBg   = `rgba(${r},${g},${b},0.20)`;
    const paper1  = `rgba(${r},${g},${b},0.36)`;

    cpFolderBack.style.background  = glassBg;
    cpFolderFront.style.background = glassBg;

    // Update ::after / ::before via a dynamic <style> tag
    let dynStyle = document.getElementById('cpDynStyle');
    if (!dynStyle) {
      dynStyle = document.createElement('style');
      dynStyle.id = 'cpDynStyle';
      document.head.appendChild(dynStyle);
    }
    dynStyle.textContent = `
      #cpFolderBack::after, #cpFolderBack::before { background: ${tabBg} !important; }
      #cpFolderFront::after, #cpFolderFront::before { background: ${tabBg} !important; }
      .cp-paper-3 { background: rgba(${r},${g},${b},0.14) !important; }
      .cp-paper-2 { background: rgba(${r},${g},${b},0.24) !important; }
      #cpPaper1   { background: rgba(${r},${g},${b},0.36) !important; }
    `;
  }
}

function fullUpdate() {
  drawSVCanvas();
  updateCursor();
  updateHueThumb();
  updatePreview();
}

/* -- SV drag -- */
let svDragging = false;
function svFromEvent(e) {
  const rect = cpCanvas.getBoundingClientRect();
  const cx = e.touches ? e.touches[0].clientX : e.clientX;
  const cy = e.touches ? e.touches[0].clientY : e.clientY;
  cpSat = Math.max(0, Math.min(1, (cx - rect.left) / rect.width));
  cpVal = Math.max(0, Math.min(1, 1 - (cy - rect.top) / rect.height));
}
cpCanvas.addEventListener('mousedown', e => { svDragging=true; svFromEvent(e); fullUpdate(); });
document.addEventListener('mousemove', e => { if(svDragging){ svFromEvent(e); updateCursor(); updatePreview(); }});
document.addEventListener('mouseup', () => svDragging = false);
cpCanvas.addEventListener('touchstart', e => { e.preventDefault(); svDragging=true; svFromEvent(e); fullUpdate(); }, {passive:false});
document.addEventListener('touchmove', e => { if(svDragging){ e.preventDefault(); svFromEvent(e); updateCursor(); updatePreview(); }}, {passive:false});
document.addEventListener('touchend', () => svDragging = false);

/* -- Hue drag -- */
let hueDragging = false;
function hueFromEvent(e) {
  const rect = cpHueTrack.getBoundingClientRect();
  const cx = e.touches ? e.touches[0].clientX : e.clientX;
  cpHue = Math.max(0, Math.min(360, ((cx - rect.left) / rect.width) * 360));
}
cpHueTrack.addEventListener('mousedown', e => { hueDragging=true; hueFromEvent(e); fullUpdate(); });
document.addEventListener('mousemove', e => { if(hueDragging){ hueFromEvent(e); fullUpdate(); }});
document.addEventListener('mouseup', () => hueDragging = false);
cpHueTrack.addEventListener('touchstart', e => { e.preventDefault(); hueDragging=true; hueFromEvent(e); fullUpdate(); }, {passive:false});
document.addEventListener('touchmove', e => { if(hueDragging){ e.preventDefault(); hueFromEvent(e); fullUpdate(); }}, {passive:false});

/* -- Hex input -- */
cpHexInput.addEventListener('input', () => {
  let v = cpHexInput.value.trim();
  if (!v.startsWith('#')) v = '#' + v;
  if (/^#[0-9a-fA-F]{6}$/.test(v)) {
    const rgb = hexToRgb(v);
    if (rgb) {
      [cpHue, cpSat, cpVal] = rgbToHsv(...rgb);
      drawSVCanvas(); updateCursor(); updateHueThumb();
      cpPreview.style.background = v;
    }
  }
});

/* -- Swatches -- */
document.querySelectorAll('.cp-swatch').forEach(sw => {
  sw.style.background = sw.dataset.color;
  sw.addEventListener('click', () => {
    document.querySelectorAll('.cp-swatch').forEach(s => s.classList.remove('active'));
    sw.classList.add('active');
    const rgb = hexToRgb(sw.dataset.color);
    if (rgb) {
      [cpHue, cpSat, cpVal] = rgbToHsv(...rgb);
      fullUpdate();
    }
  });
});

/* -- Apply color to folder -- */
async function applyFolderColor(folderId, hex) {
  window.applyFolderColor = applyFolderColor;
  const rgb = hexToRgb(hex);
  if (!rgb) return;
  const [r, g, b] = rgb;

  // Save to API
  try {
    await apiFetch(`/api/folder/${folderId}/color`, {
      method: 'PUT',
      body: JSON.stringify({ color: hex })
    });
  } catch (e) { console.warn('Color save error:', e.message); }

  // Update FOLDERS data
  const f = FOLDERS.find(x => x.id === folderId);
  if (f) { f.bg = hex; f.color = getColorClass(hex); }

  // Find folder-outer element
  const el = document.querySelector(`.folder-outer[data-folder-id="${folderId}"]`);
  if (!el) return;

  // Set CSS variables for the tint system
  el.style.setProperty('--fr', r);
  el.style.setProperty('--fg', g);
  el.style.setProperty('--fb', b);
  el.setAttribute('data-tint-r', r);

  showToast('Color updated');
}

/* -- Open/close -- */
function openColorPicker(folderId, currentHex) {
  window.openColorPicker = openColorPicker;
  cpTargetFolderId = folderId;

  // Show folder name in preview
  const f = FOLDERS.find(x => x.id === folderId);
  cpFolderName.textContent = f ? f.name : 'Folder';

  // Init from current color
  const rgb = hexToRgb(currentHex);
  if (rgb) [cpHue, cpSat, cpVal] = rgbToHsv(...rgb);

  // Reset active swatch
  document.querySelectorAll('.cp-swatch').forEach(s => s.classList.remove('active'));

  cpOverlay.classList.add('open');

  // Draw after layout
  requestAnimationFrame(() => {
    updateCanvasSize();
    updateCursor();
    updateHueThumb();
    updatePreview();
  });
}

function closeCp() {
  window.closeCp = closeCp;
  cpOverlay.classList.remove('open');
  cpTargetFolderId = null;
}

cpApply.addEventListener('click', () => {
  if (cpTargetFolderId !== null) {
    applyFolderColor(cpTargetFolderId, cpCurrentHex());
  }
  closeCp();
});

cpCancel.addEventListener('click', closeCp);
cpClose.addEventListener('click', closeCp);
cpOverlay.addEventListener('click', e => { if (e.target === cpOverlay) closeCp(); });



/* =====================
   FOLDER MODAL
===================== */
const modal = document.getElementById('folderModal');
const AVATAR_COLORS = ['#d97706','#1d4ed8','#15803d','#be123c','#6d28d9','#0e7490','#c2410c','#0369a1'];

function openFolderModal(folderId) {
  window.openFolderModal = openFolderModal;
  window.currentFolderId = folderId;
  const f = FOLDERS.find(x => x.id === folderId);
  if (!f) return;
  document.getElementById('modalTitle').textContent = f.name;
  document.getElementById('modalDate').textContent = f.date;
  document.getElementById('modalCount').textContent = `${f.count} documents`;
  const iconEl = document.getElementById('modalIcon');
  iconEl.style.background = f.bg + '33';
  iconEl.style.border = `1px solid ${f.bg}55`;
  iconEl.innerHTML = `<svg viewBox="0 0 24 24" style="stroke:${f.bg}"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>`;
  const avatarEl = document.getElementById('modalAvatars');
  const cacheKey = 'folder_' + folderId;
  let sharedList = [];
  if (window.hbSharedState && window.hbSharedState[cacheKey]) {
      sharedList = window.hbSharedState[cacheKey];
  } else if (f.shared && Array.isArray(f.shared)) {
      sharedList = f.shared;
  }
  
  const emailsToShow = sharedList.slice(0, 4);
  avatarEl.innerHTML = emailsToShow.map((email, i) =>
    `<div class="avatar" style="background:${AVATAR_COLORS[i % AVATAR_COLORS.length]};text-transform:uppercase" title="${email}">${typeof email === 'string' ? email.charAt(0) : '?'}</div>`
  ).join('');
  if (sharedList.length > 4) {
    avatarEl.innerHTML += `<div class="avatar avatar-more" title="${sharedList.length - 4} more">+${sharedList.length - 4}</div>`;
  }
  document.getElementById('folderModalViewContent').style.display = 'flex';
  document.getElementById('folderModalMoveContent').style.display = 'none';

  modal.classList.add('open');
  
  // Fetch real documents for this folder
  const grid = document.getElementById('modalDocsGrid');
  grid.innerHTML = '<div style="color:rgba(255,255,255,0.5); padding: 20px;">Loading documents...</div>';
  
  apiFetch(`/api/documents?folder_id=${folderId}`)
    .then(data => {
      if(data && data.documents) {
        window.currentFolderDocs = data.documents; // Store for action lookups
        if(data.documents.length === 0) {
           grid.innerHTML = '<div style="color:rgba(255,255,255,0.5); padding: 20px;">Empty folder</div>';
           return;
        }
        // Utilizar la función renderDocuments ya existente (o renderHtml similar) 
        // pero inyectarla en el grid. Puesto que renderDocuments suele renderizar al contenedor principal,
        // crearemos el HTML localmente usando la misma estructura.
        let html = '';
        data.documents.forEach((doc, i) => {
            const tag = doc.document_type || 'notes';
            const tagLabel = doc.document_type ? doc.document_type.charAt(0).toUpperCase() + doc.document_type.slice(1) : 'Notes';
            const date = doc.created_at ? new Date(doc.created_at).toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'}) : '';
            const words = doc.size_bytes ? Math.round(doc.size_bytes / 5) + ' words' : '—';
            
            html += `
            <div class="doc-outer" data-doc-idx="${doc.id}" data-id="${doc.id}" data-type="document">
                <button class="doc-menu-btn" onclick="openCtx(event,'doc',${doc.id})" aria-label="Document menu" style="opacity: 1">
                    <svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.5" fill="#555" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="#555" stroke="none"/><circle cx="12" cy="19" r="1.5" fill="#555" stroke="none"/></svg>
                </button>
                <div class="doc-stack" onclick="if(typeof editDocument==='function') editDocument(${doc.id}, event)" ondblclick="if(typeof editDocument==='function') editDocument(${doc.id}, event)">
                    <div class="doc-page dp-b2"></div>
                    <div class="doc-page dp-b1"></div>
                    <div class="doc-page dp-front">
                        <div class="doc-tag tag-${tag}">${tagLabel}</div>
                        <div class="doc-title">${doc.title}</div>
                        <div class="doc-preview"></div>
                        <div class="doc-footer">
                            <span class="doc-date">${date}</span>
                            <span class="doc-words">${words}</span>
                        </div>
                    </div>
                </div>
            </div>`;
        });
        grid.innerHTML = html;

        // Kick off lazy preview loading for modal cards
        if (window.DocumentPreviewService) {
          window.DocumentPreviewService.observeCards();
        }
      }
    })
    .catch(err => {
        grid.innerHTML = '<div style="color:rgba(239, 68, 68, 0.8); padding: 20px;">Error loading documents</div>';
    });
}

function hbShowUploadModal(folderId) {
    window.hbUploadFolderId = folderId; // Store context
    uploadFileInput.webkitdirectory = false;
    uploadFileInput.click();
    closeModal(); // Optionally close folder modal, or keep it open.
}

function hbCreateDocInFolder(folderId) {
    // Añadir loader primitivo al botón
    const btn = document.activeElement;
    const originalHTML = btn ? btn.innerHTML : '';
    if (btn) btn.innerHTML = '<svg class="wv-spinner" style="margin:0; width:14px; height:14px;"></svg> Creating...';
    
    fetch('/api/document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Untitled Document', folder_id: folderId })
    }).then(res => res.json()).then(data => {
        if (btn) btn.innerHTML = originalHTML;
        if(data.id) {
            // Refresh views
            refreshViews();
        }
    }).catch(e => {
        if (btn) btn.innerHTML = originalHTML;
    });
}

/* =====================
   MOVE MODAL LOGIC (Centralized)
===================== */
let movingDocId = null;
window.selectedMoveTargetId = null; // null means root

function openMoveModal(docId) {
  window.openMoveModal = openMoveModal;
  movingDocId = docId;
  window.selectedMoveTargetId = null;
  document.getElementById('moveSelectionInfo').textContent = 'Destination: Root Directory';
  
  document.getElementById('folderModalViewContent').style.display = 'none';
  document.getElementById('folderModalMoveContent').style.display = 'flex';
  modal.classList.add('open');
  
  renderMoveTreeBase();
}

function renderMoveTreeBase() {
  const rootContainer = document.getElementById('moveTreeRoot');
  
  // Render Root Item
  let treeHtml = `
    <div class="tree-node root-node selected" id="tnode-root" onclick="selectMoveTarget(null, 'Root Directory')">
       <div class="tree-node-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg></div>
       <div class="tree-node-text">Root Directory</div>
    </div>
    <div class="folder-tree">
  `;
  
  // Recursive function to render folders
  function renderNode(f, depth) {
     const hasChildren = f.children && f.children.length > 0;
     let html = `
     <div class="tree-node" id="tnode-${f.id}" onclick="selectMoveTarget(${f.id}, '${f.name.replace(/'/g, "\\'")}')" style="margin-left: ${depth * 10}px">
        <div class="tree-node-icon" style="color: ${f.color || f.bg || '#8b5cf6'}">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
        </div>
        <div class="tree-node-text">${hasChildren ? '▼ ' : ''}${f.name}</div>
     </div>
     `;
     if (hasChildren) {
         html += `<div class="folder-tree-children">`;
         f.children.forEach(child => { html += renderNode(child, depth + 1); });
         html += `</div>`;
     }
     return html;
  }
  
  // FOLDERS as flat list? If it's a flat list, we only render flat. 
  // Wait, if it's flat we just render it. If it has parent_id, we build a tree.
  const flatFolders = FOLDERS || [];
  const map = {};
  flatFolders.forEach(f => { map[f.id] = {...f, children: []} });
  const roots = [];
  flatFolders.forEach(f => {
      if (f.parent_id && map[f.parent_id]) {
          map[f.parent_id].children.push(map[f.id]);
      } else {
          roots.push(map[f.id]);
      }
  });
  
  roots.forEach(f => {
      treeHtml += renderNode(f, 0);
  });
  
  treeHtml += `</div>`;
  rootContainer.innerHTML = treeHtml;
}

window.selectMoveTarget = function(id, name) {
   window.selectedMoveTargetId = id;
   document.getElementById('moveSelectionInfo').textContent = 'Destination: ' + name;
   
   // Update Selection UI
   document.querySelectorAll('#moveTreeRoot .tree-node').forEach(el => el.classList.remove('selected'));
   const targetEl = id === null ? document.getElementById('tnode-root') : document.getElementById('tnode-' + id);
   if(targetEl) targetEl.classList.add('selected');
};

document.getElementById('confirmMoveBtn').addEventListener('click', () => {
   if (!movingDocId) return;
   const btn = document.getElementById('confirmMoveBtn');
   btn.innerHTML = '<svg class="wv-spinner" style="width:14px;height:14px;margin-right:8px;"></svg> Moving...';
   btn.disabled = true;
   
   fetch(`/api/document/${movingDocId}/move`, {
       method: 'PUT',
       headers: {'Content-Type': 'application/json'},
       body: JSON.stringify({ folder_id: window.selectedMoveTargetId })
   }).then(res => res.json()).then(data => {
       btn.textContent = "Move"; btn.disabled = false;
       if(data.error) {
           alert(data.error);
       } else {
           closeModal();
           // Refresh UI
           refreshViews();
       }
   }).catch(err => {
       btn.textContent = "Move"; btn.disabled = false;
       alert("Error moving document");
   });
});

function closeModal() { 
  window.closeModal = closeModal; 
  modal.classList.remove('open'); 
  window.currentFolderId = null; // Important: Clear context on close
}
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

/* =====================
   SIDEBAR STORE (centralizado)
===================== */
const SidebarStore = (function() {
  const KEY = 'marktrack_sidebar_filter';
  return {
    get() { return sessionStorage.getItem(KEY) || 'all'; },
    set(v) { sessionStorage.setItem(KEY, v); },
    clear() { sessionStorage.removeItem(KEY); }
  };
})();

function sidebarSetActiveItem(filterType) {
  document.querySelectorAll('.sidebar-panel .p-item').forEach(i => i.classList.remove('active'));
  const target = document.querySelector(`.sidebar-panel .p-item[data-filter="${filterType}"]`);
  if (target) target.classList.add('active');
}

function handleSidebarFilter(filterType) {
  SidebarStore.set(filterType);
  const onHome = document.getElementById('homeMain') !== null;
  if (onHome) {
    sidebarSetActiveItem(filterType);
    if (typeof filterSidebar === 'function') filterSidebar(filterType, null);
  } else {
    window.location.href = '/home?filter=' + encodeURIComponent(filterType);
  }
}

function handleSidebarArchived(mode) {
  const onHome = document.getElementById('homeMain') !== null;
  if (onHome) {
    if (typeof openArchived === 'function') openArchived(mode);
  } else {
    window.location.href = '/home?sidebar=' + encodeURIComponent(mode);
  }
}

/**
 * Navigates to /workspace and signals the Active Sessions section
 * to be highlighted using a query param (?focus=active).
 * If already on the workspace page, scrolls and highlights inline.
 */
function handleSidebarWorkspace() {
  const workspaceEl = document.getElementById('wvActiveSectionHead');
  if (workspaceEl) {
    // Already on the workspace page — scroll + highlight in place
    workspaceEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    workspaceEl.classList.add('highlight-active-section');
    setTimeout(function() {
      workspaceEl.classList.remove('highlight-active-section');
    }, 2800);
    // Mark sidebar item as active
    document.querySelectorAll('.sidebar-panel .p-item').forEach(function(i) { i.classList.remove('active'); });
    var wsItem = document.getElementById('sidebarItemActiveWorkspaces');
    if (wsItem) wsItem.classList.add('active');
  } else {
    // Navigate to workspace with focus param
    window.location.href = '/workspace?focus=active';
  }
}

// Expose para compatibilidad con código legado (setActive sigue disponible)
function setActive(el) {
  window.setActive = setActive;
  if (el && el.dataset && el.dataset.filter) {
    handleSidebarFilter(el.dataset.filter);
  } else {
    document.querySelectorAll('.sidebar-panel .p-item').forEach(i => i.classList.remove('active'));
    if (el) el.classList.add('active');
  }
}

// Bind event listeners modernos (reemplaza onclick inline)
// Note: sidebarItemActiveWorkspaces has both data-filter AND data-sidebar-action;
// we give it a special handler so we skip the generic loops for it.
document.querySelectorAll('.sidebar-panel .p-item[data-filter]').forEach(function(item) {
  if (item.id === 'sidebarItemActiveWorkspaces') return; // handled separately below
  item.addEventListener('click', function() {
    handleSidebarFilter(item.dataset.filter);
  });
});
document.querySelectorAll('.sidebar-panel .p-item[data-sidebar-action]').forEach(function(item) {
  if (item.id === 'sidebarItemActiveWorkspaces') return; // handled separately below
  item.addEventListener('click', function() {
    handleSidebarArchived(item.dataset.sidebarAction);
  });
});
// Active Workspaces special binding
(function() {
  var awItem = document.getElementById('sidebarItemActiveWorkspaces');
  if (awItem) {
    awItem.addEventListener('click', function() {
      handleSidebarWorkspace();
    });
  }
})();

// Inicializar sidebar a partir de URL params (navegación cruzada)
(function initSidebarFromUrl() {
  var params = new URLSearchParams(window.location.search);
  var filterParam  = params.get('filter');
  var sidebarParam = params.get('sidebar');

  if (filterParam) {
    SidebarStore.set(filterParam);
    sidebarSetActiveItem(filterParam);
    // Aplicar filtro cuando los datos estén listos (evento disparado por updateSidebarCounts)
    document.addEventListener('sidebarDataReady', function() {
      if (typeof filterSidebar === 'function') filterSidebar(filterParam, null);
    }, { once: true });
    // Limpiar URL para evitar re-aplicación en refresh
    history.replaceState({}, '', window.location.pathname);

  } else if (sidebarParam) {
    // Abrir offcanvas Archived/Trash al llegar con ?sidebar=
    document.addEventListener('sidebarDataReady', function() {
      if (typeof openArchived === 'function') openArchived(sidebarParam);
    }, { once: true });
    history.replaceState({}, '', window.location.pathname);

  } else {
    // Restaurar filtro guardado solo si estamos en Home
    var saved = SidebarStore.get();
    if (saved && saved !== 'all' && document.getElementById('homeMain')) {
      sidebarSetActiveItem(saved);
      document.addEventListener('sidebarDataReady', function() {
        if (typeof filterSidebar === 'function') filterSidebar(saved, null);
      }, { once: true });
    } else {
      sidebarSetActiveItem('all');
    }
  }
})();

/* =====================
   TOAST
===================== */
function showToast(msg) {
  const t = document.createElement('div');
  t.style.cssText = `
    position:fixed;bottom:24px;right:24px;z-index:99999;
    background:rgba(20,26,40,.92);backdrop-filter:blur(20px);
    border:1px solid rgba(255,255,255,.14);border-top:1px solid rgba(255,255,255,.22);
    border-radius:12px;padding:11px 18px;font-size:13px;color:#fff;
    box-shadow:0 12px 40px rgba(0,0,0,.4);
    animation:toastIn .3s cubic-bezier(0.34,1.3,0.64,1) both;
    display:flex;align-items:center;gap:9px;
  `;
  t.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9 12l2 2 4-4"/></svg>${msg}`;
  document.body.appendChild(t);
  setTimeout(() => {
    t.style.animation = 'toastOut .25s ease forwards';
    setTimeout(() => t.remove(), 250);
  }, 2500);
}

/* ═══════════════════════════════════════════════
   AUTO-INIT: detect current page and init charts
═══════════════════════════════════════════════ */



// Date filter buttons – storage (only if on storage page)
const svFG = document.getElementById('svFilterGroup');
if (svFG) {
  svFG.querySelectorAll('.sv-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      svFG.querySelectorAll('.sv-filter-btn')
        .forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
       showToast(`View: last ${btn.dataset.range} days`);
    });
  });
}

// Date filter buttons – analytics (only if on analytics page)
const avFG = document.getElementById('avFilterGroup');
if (avFG) {
  avFG.querySelectorAll('.av-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      avFG.querySelectorAll('.av-filter-btn')
        .forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      showToast(btn.dataset.range === 'today' ? 'Mostrando sesiones de hoy' : `Vista: últimos ${btn.dataset.range} días`);
    });
  });
}

function svExport() { showToast('Generando reporte PDF…'); }
function avExport(type) { showToast(`Generando reporte ${type.toUpperCase()}…`); }
function avNewDoc() { showToast('Iniciando análisis de nuevo documento…'); }



function svFilterTable(q) {
  const rows = document.querySelectorAll('#svTableBody tr');
  rows.forEach(row => {
    const text = row.cells[0]?.textContent?.toLowerCase() || '';
    row.style.display = !q || text.includes(q.toLowerCase()) ? '' : 'none';
  });
}

/* ── APEXCHARTS ── */
const APEX_BASE = {
  chart: { background: 'transparent', toolbar: { show: false }, fontFamily: 'Inter, sans-serif' },
  theme: { mode: 'dark' },
  tooltip: {
    theme: 'dark',
    style: { fontSize: '12px', fontFamily: 'Inter, sans-serif' },
    custom: undefined
  },
  grid: { borderColor: 'rgba(255,255,255,0.06)', strokeDashArray: 4 },
};




const toastStyle = document.createElement('style');
toastStyle.textContent = `
  @keyframes toastIn{from{opacity:0;transform:translateY(12px) scale(.95);}to{opacity:1;transform:translateY(0) scale(1);}}
  @keyframes toastOut{from{opacity:1;transform:translateY(0);}to{opacity:0;transform:translateY(8px);}}
`;
document.head.appendChild(toastStyle);





/* ── RENDER TABLE ── */
let avCurrentRisk = 'all';
let avCurrentFilter = '';

function avPctClass(v, low, high) { return v >= high ? 'av-pct-crit' : v >= low ? 'av-pct-warn' : 'av-pct-ok'; }
function avScoreClass(s)         { return s >= 80 ? 'av-score-ok' : s >= 60 ? 'av-score-warn' : 'av-score-crit'; }
function avRiskLabel(r)          { return r === 'crit' ? 'CRÍTICO' : r === 'warn' ? 'MEDIO' : 'BAJO'; }


if (analyticsView) renderAvTable();

function avToggleRow(id, btn) {
  const expRow = document.getElementById(`exp-${id}`);
  if (!expRow) return;
  const isOpen = !expRow.classList.contains('av-row-hidden');
  document.querySelectorAll('.av-row-expanded').forEach(r => r.classList.add('av-row-hidden'));
  document.querySelectorAll('.av-expand-btn').forEach(b => b.classList.remove('open'));
  if (!isOpen) { expRow.classList.remove('av-row-hidden'); btn.classList.add('open'); }
}
function avFilterTable(q) { avCurrentFilter = q; renderAvTable(); }
function avFilterRisk(risk, btn) {
  document.querySelectorAll('.av-risk-filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  avCurrentRisk = risk;
  renderAvTable();
}
function avJumpToSession(id) {
  avCurrentFilter = id;
  avCurrentRisk = 'all';
  const inp = document.getElementById('avTblFilter');
  if (inp) inp.value = id;
  renderAvTable();
  showToast(`Mostrando sesión ${id}`);
  setTimeout(() => {
    const btn = document.querySelector(`.av-main-row[data-id="${id}"] .av-expand-btn`);
    if (btn) btn.click();
  }, 80);
}
function avNotifyStudent(name) { showToast(`Notificación enviada a ${name} ✉`); }



/* ── MOCK REAL-TIME ── */
let avRealtimeTimer = null;
const AV_LIVE_NAMES = ['Valentina M.','Diego R.','Fernanda L.','Andrés C.','Camila V.'];



/* =====================
   SHARE MODAL LOGIC
===================== */
let hbShareTargetId = null;
let hbShareTargetType = null;
let hbShareEmails = [];
window.hbSharedState = window.hbSharedState || {};

function hbOpenShare(id, type, name) {
  hbShareTargetId = id;
  hbShareTargetType = type;
  
  const cacheKey = type + '_' + id;
  if (!window.hbSharedState[cacheKey]) {
      window.hbSharedState[cacheKey] = [];
  }
  hbShareEmails = [...window.hbSharedState[cacheKey]];
  
  const titleEl = document.getElementById('hbShareTitle');
  if(titleEl) titleEl.innerText = `Share ${type === 'folder' ? 'Folder' : 'Document'}: ${name}`;
  
  const inputEl = document.getElementById('hbShareEmailInput');
  if(inputEl) inputEl.value = '';
  
  const msgEl = document.getElementById('hbShareMessage');
  if(msgEl) msgEl.value = '';
  
  const permEl = document.getElementById('hbSharePermission');
  if(permEl) permEl.value = 'viewer';
  
  hbRenderSharePills();
  
  const bd = document.getElementById('hbShareBackdrop');
  if(bd) bd.style.display = 'flex';
  
  setTimeout(() => { if(inputEl) inputEl.focus(); }, 100);
}

function hbCloseShare() {
  const bd = document.getElementById('hbShareBackdrop');
  if(bd) bd.style.display = 'none';
}

function hbRenderSharePills() {
  const container = document.getElementById('hbSharePillsContainer');
  if(!container) return;
  
  container.innerHTML = '';
  
  hbShareEmails.forEach((email, idx) => {
    const pill = document.createElement('div');
    pill.style.cssText = 'display:flex;align-items:center;background:rgba(96,165,250,.15);border:1px solid rgba(96,165,250,.3);border-radius:6px;padding:4px 10px;font-size:12px;color:#93c5fd;';
    
    pill.innerHTML = `
      <span contenteditable="true" 
            onblur="hbUpdateShareEmail(${idx}, this.innerText)" 
            onkeydown="if(event.key==='Enter' || event.key===','){event.preventDefault();this.blur();}" 
            style="outline:none;min-width:20px;cursor:text;">${email}</span>
      <span onclick="hbRemoveShareEmail(${idx}, event)" style="cursor:pointer;opacity:0.6;font-size:14px;line-height:1;margin-left:8px;padding-left:6px;border-left:1px solid rgba(96,165,250,.3);">×</span>
    `;
    container.appendChild(pill);
  });
}

function hbUpdateShareEmail(idx, newEmail) {
  newEmail = newEmail.trim().replace(/,/g, '');
  if (!newEmail) {
    hbShareEmails.splice(idx, 1);
  } else if (/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+[.][a-zA-Z]{2,}$/.test(newEmail)) {
    // Solo actualizar si es válido y no está duplicado (o si es el mismo)
    if (!hbShareEmails.includes(newEmail.toLowerCase()) || hbShareEmails[idx] === newEmail.toLowerCase()) {
      hbShareEmails[idx] = newEmail.toLowerCase();
    } else {
      hbShareEmails.splice(idx, 1); // Remove duplicate
      showToast('Email already in list');
    }
  } else {
    showToast('Invalid email format, removed');
    hbShareEmails.splice(idx, 1);
  }
  hbRenderSharePills();
}

function hbRemoveShareEmail(idx, e) {
  if (e) { e.stopPropagation(); e.preventDefault(); }
  hbShareEmails.splice(idx, 1);
  hbRenderSharePills();
}

function hbAddShareEmailFromInput() {
  const input = document.getElementById('hbShareEmailInput');
  if(!input) return;
  const val = input.value.trim().replace(/,/g, '');
  if (!val) return;
  if (/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+[.][a-zA-Z]{2,}$/.test(val)) {
    if (!hbShareEmails.includes(val.toLowerCase())) {
      hbShareEmails.push(val.toLowerCase());
      hbRenderSharePills();
    }
    input.value = '';
  } else {
    showToast('Please enter a valid email address');
  }
}

function hbShareInputKeydown(e) {
  if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
    e.preventDefault();
    hbAddShareEmailFromInput();
  } else if (e.key === 'Backspace' && e.target.value === '' && hbShareEmails.length > 0) {
    hbShareEmails.pop();
    hbRenderSharePills();
  }
}

function hbShareInputBlur(e) {
  hbAddShareEmailFromInput();
}

async function hbSubmitShare() {
  hbAddShareEmailFromInput();
  if (hbShareEmails.length === 0) {
    showToast('Please add at least one email');
    return;
  }
  
  const permission = document.getElementById('hbSharePermission').value;
  const message = document.getElementById('hbShareMessage').value;
  
  const btn = document.getElementById('hbShareSubmitBtn');
  const spin = document.getElementById('hbShareSpinner');
  if(btn) btn.disabled = true;
  if(spin) spin.style.display = 'block';
  
    try {
      const res = await apiFetch('/share_bp/api/resource/share', {
        method: 'POST',
        body: JSON.stringify({
          emails: hbShareEmails,
          resource_id: hbShareTargetId,
          resource_type: hbShareTargetType,
          permission_level: permission,
          message: message
        })
      });
      showToast(res.message || 'Shared successfully');
      
      // Cache the currently shared emails so they persist when reopening the modal
      const cacheKey = hbShareTargetType + '_' + hbShareTargetId;
      window.hbSharedState[cacheKey] = [...hbShareEmails];
      
      // Update dynamically the avatar stack if the folder preview modal is open
      if (hbShareTargetType === 'folder' && window.currentFolderId === hbShareTargetId) {
          openFolderModal(window.currentFolderId);
      }
      
      hbCloseShare();
    } catch (err) {
    showToast('Error sharing resource: ' + err.message);
  } finally {
    if(btn) btn.disabled = false;
    if(spin) spin.style.display = 'none';
  }
}

/* ── RENAME MODAL ── */
let _hbRenameType, _hbRenameId, _hbRenameOld;
function openRenameModal(type, id, currentName) {
  _hbRenameType = type; _hbRenameId = id; _hbRenameOld = currentName;
  document.getElementById('hbRenameTitle').textContent = type === 'folder' ? 'Rename Folder' : 'Rename Document';
  const inp = document.getElementById('hbRenameInput');
  inp.value = currentName;
  const bd = document.getElementById('hbRenameBackdrop');
  bd.style.display = 'flex';
  setTimeout(() => { inp.focus(); inp.select(); }, 80);
}
function hbCloseRename() {
  document.getElementById('hbRenameBackdrop').style.display = 'none';
}
async function hbSubmitRename() {
  const newName = document.getElementById('hbRenameInput').value.trim();
  if (!newName || newName === _hbRenameOld) { hbCloseRename(); return; }
  const sp = document.getElementById('hbRenameSpinner');
  const btn = document.getElementById('hbRenameSaveBtn');
  sp.style.display = ''; btn.disabled = true;
  await _execRenameItem(_hbRenameType, _hbRenameId, newName);
  sp.style.display = 'none'; btn.disabled = false;
  hbCloseRename();
}

/* ── NEW FOLDER MODAL ── */
function openNewFolderModal() {
  const inp = document.getElementById('hbNewFolderInput');
  inp.value = '';
  document.getElementById('hbNewFolderBackdrop').style.display = 'flex';
  setTimeout(() => inp.focus(), 80);
}
function hbCloseNewFolder() {
  document.getElementById('hbNewFolderBackdrop').style.display = 'none';
}
async function hbSubmitNewFolder() {
  const name = document.getElementById('hbNewFolderInput').value.trim();
  if (!name) return;
  hbCloseNewFolder();
  
  // Use the color saved in settings 
  const color_hex = typeof _stFolderColor !== 'undefined' ? _stFolderColor : '#6d28d9';
  
  try {
    await apiFetch('/api/folder', { 
      method: 'POST', 
      body: JSON.stringify({ name, color_hex }) 
    });
    showToast(`Folder "${name}" created`);
    await loadFolders();
  } catch (e) { showToast(e.message); }
}

/* ── DELETE FOREVER MODAL ── */
let _hbDelId, _hbDelType;
function openDeleteForeverModal(id, type, name) {
  _hbDelId = id; _hbDelType = type;
  document.getElementById('hbDeleteForeverName').textContent = name;
  document.getElementById('hbDeleteForeverBackdrop').style.display = 'flex';
}
function hbCloseDeleteForever() {
  document.getElementById('hbDeleteForeverBackdrop').style.display = 'none';
}
async function hbConfirmDeleteForever() {
  const sp = document.getElementById('hbDeleteForeverSpinner');
  const btn = document.getElementById('hbDeleteForeverBtn');
  sp.style.display = ''; btn.disabled = true;
  await _execDeleteOne(_hbDelId, _hbDelType);
  sp.style.display = 'none'; btn.disabled = false;
  hbCloseDeleteForever();
}

/* ── RESTORE MODAL ── */
let _hbRestoreId, _hbRestoreType, _hbRestoreEvent;
function openRestoreModal(e, id, type) {
  _hbRestoreId = id; _hbRestoreType = type; _hbRestoreEvent = e;
  const item = archivedItems.find(x => x.id === id && x.type === type);
  document.getElementById('hbRestoreName').textContent = item?.name || 'this item';
  document.getElementById('hbRestoreBackdrop').style.display = 'flex';
}
function hbCloseRestore() {
  document.getElementById('hbRestoreBackdrop').style.display = 'none';
}
async function hbConfirmRestore() {
  const sp = document.getElementById('hbRestoreSpinner');
  const btn = document.getElementById('hbRestoreBtn');
  sp.style.display = ''; btn.disabled = true;
  await restoreOne(_hbRestoreEvent || { stopPropagation: () => {} }, _hbRestoreId, _hbRestoreType);
  sp.style.display = 'none'; btn.disabled = false;
  hbCloseRestore();
}

/* ── DELETE (MOVE TO TRASH) MODAL ── */
let _hbDelItemType, _hbDelItemId;
function openDeleteModal(type, id, name) {
  _hbDelItemType = type; _hbDelItemId = id;
  document.getElementById('hbDeleteTitle').textContent = type === 'folder' ? 'Delete Folder' : 'Delete Document';
  document.getElementById('hbDeleteItemName').textContent = name;
  document.getElementById('hbDeleteBackdrop').style.display = 'flex';
}
function hbCloseDelete() {
  document.getElementById('hbDeleteBackdrop').style.display = 'none';
}
async function hbConfirmDelete() {
  const sp = document.getElementById('hbDeleteSpinner');
  const btn = document.getElementById('hbDeleteBtn');
  sp.style.display = ''; btn.disabled = true;
  await _execDeleteItem(_hbDelItemType, _hbDelItemId);
  sp.style.display = 'none'; btn.disabled = false;
  hbCloseDelete();
}

/* ── Close on Escape ── */
// DOC MODAL JS
function openWdModal() {
  const overlay = document.getElementById('wdModalOverlay');
  const input = document.getElementById('wdInputTitle');
  const err = document.getElementById('wdErrTitle');
  const btn = document.getElementById('wdBtnSubmit');
  const loader = document.getElementById('wdBtnLoader');
  const btnText = document.getElementById('wdBtnText');

  if (!overlay) return;
  input.value = '';
  if (err) err.style.display = 'none';
  if (btn) btn.disabled = false;
  if (loader) loader.style.display = 'none';
  if (btnText) btnText.textContent = 'Create Document';
  
  overlay.classList.add('open');
  setTimeout(() => input.focus(), 100);
}

function closeWdModal() {
  const overlay = document.getElementById('wdModalOverlay');
  if (overlay) overlay.classList.remove('open');
}

async function submitCreateDoc() {
  const input = document.getElementById('wdInputTitle');
  const err = document.getElementById('wdErrTitle');
  const btn = document.getElementById('wdBtnSubmit');
  const loader = document.getElementById('wdBtnLoader');
  const btnText = document.getElementById('wdBtnText');

  const title = (input.value || '').trim();
  if (!title) {
    if (err) err.style.display = 'block';
    input.focus();
    return;
  }
  if (err) err.style.display = 'none';

  // Mostrar loader
  if (btn) btn.disabled = true;
  if (loader) loader.style.display = 'inline-block';
  if (btnText) btnText.textContent = 'Creating...';

  try {
    await apiFetch('/api/document', {
      method: 'POST',
      body: JSON.stringify({ 
        title: title,
        folder_id: window.currentFolderId || null
      })
    });
    showToast('New document created');
    
    // Refresh Correct View
    refreshViews();
    closeWdModal();
  } catch (e) {
    showToast(e.message);
    if (btn) btn.disabled = false;
    if (loader) loader.style.display = 'none';
    if (btnText) btnText.textContent = 'Create Document';
  }
}
window.openWdModal = openWdModal;
window.closeWdModal = closeWdModal;
window.submitCreateDoc = submitCreateDoc;

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    hbCloseRename(); hbCloseNewFolder(); hbCloseDeleteForever(); hbCloseRestore(); hbCloseDelete(); closeWdModal();
  }
});


/* ═══════════════════════════════════════════════════════════
   SETTINGS MANAGER — Marktrack (Production Grade)
   Every function maps to a real backend endpoint.
   ═══════════════════════════════════════════════════════════ */

const stCSRF = () => document.querySelector('meta[name="csrf-token"]')?.content || '';

async function stApiFetch(url, opts = {}) {
    const res = await fetch(url, {
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': stCSRF() },
        credentials: 'same-origin',
        ...opts
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Server error');
    return data;
}

// ── State ─────────────────────────────────────────────────
let _stSettings   = null;
let _stUser       = null;
let _stFolderColor = '#6d28d9';
let _stCreativity  = 'balanced';

// ── Open / Close ──────────────────────────────────────────
function openSettingsModal() {
    document.getElementById('settingsModal').classList.add('open');
    switchSettingsTab('profile');
    stLoadAll();
}

function closeSettings() {
    document.getElementById('settingsModal').classList.remove('open');
}

// ── Load all data ─────────────────────────────────────────
async function stLoadAll() {
    try {
        const r = await stApiFetch('/api/settings/');
        if (r.status === 'success') {
            _stSettings = r.data;
            _stUser     = r.user;
            stPopulate(r.data, r.user, r.institutions);
        }
    } catch(e) { console.error('Settings load failed', e); }
}

// ── Populate all tabs ─────────────────────────────────────
function stPopulate(settings, user, institutions) {
    // Sidebar
    const initials = (user.name || user.email || 'U').charAt(0).toUpperCase();
    document.getElementById('stUserName').textContent  = user.name || user.email;
    document.getElementById('stUserEmail').textContent = user.email;
    const sideAvatar = document.getElementById('stUserAvatar');
    const bigAvatar  = document.getElementById('stBigAvatar');
    if (user.avatar) {
        sideAvatar.innerHTML = `<img src="${user.avatar}" alt="avatar">`;
        bigAvatar.innerHTML  = `<img src="${user.avatar}" alt="avatar">`;
    } else {
        sideAvatar.textContent = initials;
        bigAvatar.textContent  = initials;
    }

    // Profile tab
    document.getElementById('stInputName').value      = user.name     || '';
    document.getElementById('stInputLastname').value  = user.lastname || '';
    const instEl = document.getElementById('stInputInstitute');
    if (instEl && institutions) {
        let html = '<option value="">Select your Institution</option>';
        institutions.forEach(inst => {
            html += `<option value="${inst.id}">${inst.name}</option>`;
        });
        instEl.innerHTML = html;
        instEl.value = user.institute || '';
    }
    const countryEl = document.getElementById('stSelectCountry');
    if (countryEl && user.country) countryEl.value = user.country;

    // Workspace tab
    const compact = settings.preferences?.compact_view || false;
    document.getElementById('stCheckCompact').checked = compact;
    if (compact) document.body.classList.add('compact-docs');

    // Folder color swatches
    _stFolderColor = settings.workspace?.default_folder_color || '#6d28d9';
    document.querySelectorAll('#stFolderColorSwatches .st-color-swatch').forEach(sw => {
        sw.classList.toggle('selected', sw.dataset.color === _stFolderColor);
    });

    // Share expiry
    const expiryEl = document.getElementById('stSelectShareExpiry');
    if (expiryEl) expiryEl.value = String(settings.workspace?.share_link_expiry_days || 7);

    // AI Creativity
    _stCreativity = settings.ai?.creativity_level || 'balanced';
    stSelectCreativity(_stCreativity, false); // false = don't save yet

    // Security tab
    document.getElementById('stInputEmail').value = user.email;

    // OAuth info
    if (user.oauth_provider) {
        const oauthInfo  = document.getElementById('stOAuthInfo');
        const oauthBadge = document.getElementById('stOAuthBadge');
        oauthInfo.style.display = 'block';
        oauthBadge.textContent  = user.oauth_provider;
        oauthBadge.className    = `st-oauth-badge ${user.oauth_provider.toLowerCase()}`;
        // Hide password section for OAuth users
        const pwSection = document.getElementById('stPasswordSection');
        if (pwSection) pwSection.style.display = 'none';
    }

    // Session info
    const sessionMeta = document.getElementById('stSessionMeta');
    if (sessionMeta) {
        const started  = user.session_created_at ? new Date(user.session_created_at).toLocaleString() : 'Unknown';
        const lastLogin = user.last_login ? new Date(user.last_login).toLocaleString() : 'Unknown';
        sessionMeta.textContent = `Started: ${started} · Last login: ${lastLogin}`;
    }
}

// ── Tab switching ─────────────────────────────────────────
function switchSettingsTab(tabId) {
    document.querySelectorAll('.st-nav-item').forEach(el =>
        el.classList.toggle('active', el.dataset.tab === tabId)
    );
    document.querySelectorAll('.settings-pane').forEach(el =>
        el.classList.toggle('active', el.id === `pane-${tabId}`)
    );
    const titles = {
        profile:   'Profile Settings',
        workspace: 'Workspace',
        security:  'Account & Security',
        plan:      'Usage & Plan'
    };
    document.getElementById('settingsTabTitle').textContent = titles[tabId] || 'Settings';

    // Lazy-load data when entering that tab
    if (tabId === 'plan') stLoadPlan();
    if (tabId === 'security') stLoadAuthLogs();
}

// ── Save status helpers ───────────────────────────────────
function stShowSaving() {
    const el = document.getElementById('stSaveStatus');
    el.textContent  = 'Syncing…';
    el.className    = 'save-status syncing';
    el.style.display = 'flex';
}

function stShowSaved(msg = 'Changes saved') {
    const el = document.getElementById('stSaveStatus');
    el.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg> ${msg}`;
    el.className    = 'save-status';
    el.style.display = 'flex';
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => { el.style.display = 'none'; el.style.opacity = '1'; }, 300); }, 2500);
}

function stShowSaveError(msg = 'Save failed') {
    const el = document.getElementById('stSaveStatus');
    el.textContent  = `⚠ ${msg}`;
    el.className    = 'save-status error';
    el.style.display = 'flex';
    setTimeout(() => { el.style.display = 'none'; }, 3000);
}

function stShowAlert(elId, msg, type = 'success') {
    const el = document.getElementById(elId);
    if (!el) return;
    el.textContent  = msg;
    el.className    = `st-inline-alert ${type}`;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 3500);
}

// ── PROFILE — Save ────────────────────────────────────────
async function stSaveProfile() {
    stShowSaving();
    const payload = {
        name:      document.getElementById('stInputName').value.trim(),
        lastname:  document.getElementById('stInputLastname').value.trim(),
        institute: document.getElementById('stInputInstitute').value.trim(),
        country:   document.getElementById('stSelectCountry')?.value || ''
    };
    try {
        const r = await stApiFetch('/api/settings/profile', {
            method: 'POST', body: JSON.stringify(payload)
        });
        if (r.status === 'success') {
            stShowSaved();
            stShowAlert('stProfileAlert', 'Profile saved successfully.', 'success');
            document.getElementById('stUserName').textContent = r.user.name || payload.name;
        }
    } catch(e) {
        stShowSaveError(e.message);
        stShowAlert('stProfileAlert', e.message, 'error');
    }
}

// ── AVATAR — Upload ───────────────────────────────────────
async function stUploadAvatar(input) {
    const errEl = document.getElementById('stAvatarError');
    errEl.style.display = 'none';

    const file = input.files[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
        errEl.textContent   = 'File exceeds 2 MB limit.';
        errEl.style.display = 'block';
        input.value = '';
        return;
    }

    const formData = new FormData();
    formData.append('avatar', file);

    try {
        const res = await fetch('/api/settings/avatar', {
            method: 'POST',
            headers: { 'X-CSRFToken': stCSRF() },
            body: formData,
            credentials: 'same-origin'
        });
        const r = await res.json();
        if (r.status === 'success') {
            const img = `<img src="${r.avatar_url}?t=${Date.now()}" alt="avatar">`;
            document.getElementById('stBigAvatar').innerHTML  = img;
            document.getElementById('stUserAvatar').innerHTML = img;
            stShowSaved('Avatar updated');
        } else {
            errEl.textContent   = r.message || 'Upload failed.';
            errEl.style.display = 'block';
        }
    } catch(e) {
        errEl.textContent   = 'Upload failed. Try again.';
        errEl.style.display = 'block';
    }
    input.value = '';
}

// ── WORKSPACE — Compact view toggle (auto-save) ───────────
document.addEventListener('DOMContentLoaded', () => {
    const compactEl = document.getElementById('stCheckCompact');
    if (compactEl) {
        compactEl.addEventListener('change', async () => {
            document.body.classList.toggle('compact-docs', compactEl.checked);
            try {
                stShowSaving();
                await stApiFetch('/api/settings/', {
                    method: 'POST',
                    body: JSON.stringify({ preferences: { compact_view: compactEl.checked } })
                });
                stShowSaved();
            } catch(e) { stShowSaveError(); }
        });
    }
});

// ── WORKSPACE — Folder color swatches ────────────────────
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('stFolderColorSwatches')?.addEventListener('click', async (e) => {
        const sw = e.target.closest('.st-color-swatch');
        if (!sw) return;
        _stFolderColor = sw.dataset.color;
        document.querySelectorAll('#stFolderColorSwatches .st-color-swatch').forEach(s =>
            s.classList.toggle('selected', s === sw)
        );
        try {
            stShowSaving();
            await stApiFetch('/api/settings/', {
                method: 'POST',
                body: JSON.stringify({ workspace: { default_folder_color: _stFolderColor } })
            });
            stShowSaved();
        } catch(e) { stShowSaveError(); }
    });

    // Share expiry auto-save
    document.getElementById('stSelectShareExpiry')?.addEventListener('change', async (e) => {
        try {
            stShowSaving();
            await stApiFetch('/api/settings/', {
                method: 'POST',
                body: JSON.stringify({ workspace: { share_link_expiry_days: parseInt(e.target.value) } })
            });
            stShowSaved();
        } catch(e) { stShowSaveError(); }
    });
});

// ── WORKSPACE — AI creativity ─────────────────────────────
async function stSelectCreativity(val, save = true) {
    _stCreativity = val;
    document.querySelectorAll('#stAICreativityGroup .st-radio-card').forEach(card =>
        card.classList.toggle('selected', card.dataset.value === val)
    );
    if (!save) return;
    try {
        stShowSaving();
        await stApiFetch('/api/settings/', {
            method: 'POST',
            body: JSON.stringify({ ai: { creativity_level: val } })
        });
        stShowSaved();
    } catch(e) { stShowSaveError(); }
}

// ── SECURITY — Password toggle reveal ────────────────────
function stTogglePw(inputId, eyeEl) {
    const inp = document.getElementById(inputId);
    if (!inp) return;
    inp.type = inp.type === 'password' ? 'text' : 'password';
}

// ── SECURITY — Change password ───────────────────────────
async function stChangePassword() {
    const oldPw = document.getElementById('stInputOldPw')?.value.trim();
    const newPw = document.getElementById('stInputNewPw')?.value.trim();
    if (!oldPw || !newPw) {
        stShowAlert('stPwAlert', 'Both password fields are required.', 'error');
        return;
    }
    if (newPw.length < 8) {
        stShowAlert('stPwAlert', 'New password must be at least 8 characters.', 'error');
        return;
    }
    try {
        const r = await stApiFetch('/api/settings/password', {
            method: 'POST',
            body: JSON.stringify({ old_password: oldPw, new_password: newPw })
        });
        if (r.status === 'success') {
            stShowAlert('stPwAlert', 'Password changed successfully.', 'success');
            document.getElementById('stInputOldPw').value = '';
            document.getElementById('stInputNewPw').value = '';
        }
    } catch(e) {
        stShowAlert('stPwAlert', e.message, 'error');
    }
}

// ── SECURITY — Terminate sessions ────────────────────────
async function stTerminateSessions() {
    const btn = document.getElementById('stBtnTerminate');
    if (btn) { btn.disabled = true; btn.textContent = 'Terminating…'; }
    try {
        await stApiFetch('/api/settings/sessions/terminate', { method: 'POST' });
        stShowAlert('stSessionAlert', 'All sessions terminated. Redirecting to login…', 'success');
        setTimeout(() => window.location.href = '/logout', 2000);
    } catch(e) {
        stShowAlert('stSessionAlert', e.message, 'error');
        if (btn) { btn.disabled = false; btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg> Terminate All'; }
    }
}

// ── PLAN — Load real data ─────────────────────────────────
async function stLoadPlan() {
    try {
        const r = await stApiFetch('/api/settings/plan');
        if (r.status !== 'success') return;

        // Plan badge
        document.getElementById('stPlanBadge').textContent = r.plan.name;
        document.getElementById('stPlanName').textContent  = `${r.plan.name} Plan`;

        // Subscription status
        let subText = '';
        if (r.plan.is_trial && r.plan.trial_ends_at) {
            const ends = new Date(r.plan.trial_ends_at).toLocaleDateString();
            subText = `Trial · Ends ${ends}`;
        } else if (r.plan.subscription_status === 'active') {
            subText = r.plan.subscription_ends_at
                ? `Active · Renews ${new Date(r.plan.subscription_ends_at).toLocaleDateString()}`
                : 'Active';
        } else {
            subText = 'Free tier';
        }
        document.getElementById('stPlanSubStatus').textContent = subText;

        // 1. Storage Metric (Gauge/Bar)
        const sPct = Math.min(r.storage.percentage, 100);
        document.getElementById('stStorageText').textContent = `${r.storage.used_mb} / ${r.storage.total_mb} MB`;
        stRenderUsageChart('stStorageChart', sPct, sPct > 85 ? '#ef4444' : '#6d28d9');

        // 2. Analysis Quota Metric
        const qUsed = r.analysis.used_today;
        const qLimit = r.analysis.daily_limit;
        const qPct = qLimit > 0 ? Math.min((qUsed / qLimit) * 100, 100) : 0;
        document.getElementById('stQuotaText').textContent = `${qUsed} / ${qLimit} used`;
        stRenderUsageChart('stQuotaChart', qPct, '#0e7490');

        // 3. Redis Status
        const redisStatus = document.getElementById('stRedisStatus');
        const redisDot    = document.getElementById('stRedisDot');
        const redisLabel  = document.getElementById('stRedisLabel');
        const isUp = r.cache.status === 'up';

        redisStatus.className = `st-redis-status ${isUp ? 'up' : 'down'}`;
        redisDot.className    = `st-status-dot ${isUp ? 'up' : 'down'}`;
        redisLabel.innerHTML = isUp
            ? `Redis Online <span style="opacity:0.6; font-size:11px; margin-left:4px;">· ${r.cache.latency_ms}ms latency</span>`
            : 'Redis Offline <span style="opacity:0.6; font-size:11px; margin-left:4px;">· Fallback mode</span>';

    } catch(e) {
        console.warn('Plan data load failed', e);
    }
}

// ── PLAN — Metric Visualization ──────────────────────────
const _planCharts = {};

function stRenderUsageChart(containerId, percentage, color) {
    const el = document.getElementById(containerId);
    if (!el) return;

    const options = {
        series: [Math.round(percentage)],
        chart: {
            height: 140,
            type: 'radialBar',
            sparkline: { enabled: true },
            animations: { enabled: true, easing: 'easeinout', speed: 800 }
        },
        plotOptions: {
            radialBar: {
                startAngle: -90,
                endAngle: 90,
                track: {
                    background: 'rgba(255,255,255,0.05)',
                    strokeWidth: '97%',
                    margin: 5,
                },
                dataLabels: {
                    name: { show: false },
                    value: {
                        offsetY: -2,
                        fontSize: '16px',
                        fontWeight: '700',
                        color: '#fff',
                        formatter: val => val + '%'
                    }
                }
            }
        },
        fill: {
            type: 'gradient',
            gradient: {
                shade: 'dark',
                type: 'horizontal',
                gradientToColors: [color],
                stops: [0, 100]
            }
        },
        colors: [color],
        stroke: { lineCap: 'round' }
    };

    if (_planCharts[containerId]) {
        _planCharts[containerId].updateSeries([Math.round(percentage)]);
    } else {
        _planCharts[containerId] = new ApexCharts(el, options);
        _planCharts[containerId].render();
    }
}

// ── SECURITY — Auth History Chart ─────────────────────────
let _authChart = null;

async function stLoadAuthLogs() {
    try {
        const r = await stApiFetch('/api/settings/auth-logs');
        if (r.status !== 'success') return;
        
        const chartEl = document.getElementById('stAuthHistoryChart');
        if (!chartEl) return;
        
        const options = {
            series: r.data.series,
            chart: {
                type: 'bar',
                height: 250,
                stacked: true,
                toolbar: { show: false },
                background: 'transparent',
                fontFamily: 'Inter, sans-serif',
                animations: { enabled: true }
            },
            colors: ['#10b981', '#ef4444'], // Green for logins, Red for logouts
            plotOptions: {
                bar: {
                    horizontal: false,
                    borderRadius: 4,
                    columnWidth: '50%'
                },
            },
            dataLabels: { enabled: false },
            stroke: { width: 0 },
            xaxis: {
                categories: r.data.categories,
                labels: { style: { colors: '#888', fontSize: '11px' } },
                axisBorder: { show: false },
                axisTicks: { show: false }
            },
            yaxis: {
                labels: { style: { colors: '#888', fontSize: '11px' } },
                min: 0,
                forceNiceScale: true
            },
            legend: {
                position: 'top',
                horizontalAlign: 'right',
                labels: { colors: '#ccc' },
                markers: { radius: 12 }
            },
            grid: {
                borderColor: 'rgba(255,255,255,0.05)',
                strokeDashArray: 4,
                yaxis: { lines: { show: true } }
            },
            theme: { mode: 'dark' },
            tooltip: {
                theme: 'dark',
                y: { formatter: function (val) { return val + " events" } }
            }
        };

        if (_authChart) {
            _authChart.updateOptions(options);
        } else {
            _authChart = new ApexCharts(chartEl, options);
            _authChart.render();
        }
    } catch(e) {
        console.warn('Auth logs load failed', e);
    }
}

// ── Legacy compatibility functions ───────────────────────
function saveProfileData() { stSaveProfile(); }
function showChangePassword() {}  // No-op — password section is always visible
