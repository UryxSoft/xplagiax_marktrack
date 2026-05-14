/**
 * sidebar_filters.js 
 * Handles dynamic filtering and updating of sidebar counts 
 * on the home/dashboard view.
 */

(function(global) {
  'use strict';

  // State
  let currentFilter = 'all';

  // Helpers
  function isRecent(isoString, hours = 24) {
    if (!isoString) return false;
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return false; // Invalid date
    const now = new Date();
    const diffMs = now - date;
    const diffHours = diffMs / (1000 * 60 * 60);
    return diffHours <= hours;
  }

  function isShared(item) {
    if (item.shared && item.shared.length > 0) return true;
    return false;
  }

  // NEW: items others shared with ME (owner is not me, but I have a share record)
  function isSharedWithMe(item) {
    return !!item.shared_to_me;
  }

  // NEW: items I shared with others (I am the owner and shared array is populated)
  function isSharedByMe(item) {
    return !!(item.shared && item.shared.length > 0);
  }

  function getFoldersSafely() {
    return typeof FOLDERS !== 'undefined' ? FOLDERS : [];
  }

  function getDocsSafely() {
    return typeof DOCS !== 'undefined' ? DOCS : [];
  }

  /**
   * Updates all the sidebar badges based on loaded FOLDERS and DOCS arrays.
   */
  async function updateSidebarCounts() {
    const countAllEl          = document.getElementById('countAll');
    const countNewFoldersEl   = document.getElementById('countNewFolders');
    const countNewFilesEl     = document.getElementById('countNewFiles');
    const countSharedEl       = document.getElementById('countShared');
    const countSharedToMeEl   = document.getElementById('countSharedToMe');
    const countSharedWithEl   = document.getElementById('countSharedWith');
    const archivedCountEl     = document.getElementById('realArchivedCount');
    const trashCountEl        = document.getElementById('archivedCount');
    const activeWsCountEl     = document.getElementById('countActiveWorkspaces');

    const foldersArray = getFoldersSafely();
    const docsArray    = getDocsSafely();

    if (countAllEl) {
      countAllEl.textContent = foldersArray.length + docsArray.length;
    }

    if (countNewFoldersEl) {
      const recentFolds = foldersArray.filter(f => isRecent(f.created_at_raw, 24));
      countNewFoldersEl.textContent = recentFolds.length;
    }

    if (countNewFilesEl) {
      const recentDocs = docsArray.filter(d => isRecent(d.created_at_raw, 24));
      countNewFilesEl.textContent = recentDocs.length;
    }

    // Legacy counter preserved as-is
    if (countSharedEl) {
      const sharedFolds = foldersArray.filter(f => isShared(f));
      const sharedDocs  = docsArray.filter(d => isShared(d));
      countSharedEl.textContent = sharedFolds.length + sharedDocs.length;
    }

    // NEW: local Shared-with count (items I own that I've shared with others)
    if (countSharedWithEl) {
      const swFolders = foldersArray.filter(f => isSharedByMe(f)).length;
      const swDocs    = docsArray.filter(d => isSharedByMe(d)).length;
      countSharedWithEl.textContent = swFolders + swDocs;
    }

    // NEW: fetch shared-to-me & authoritative shared-with counts from backend
    try {
      const resShared = await fetch('/api/home/shared-counts', {
        headers: { 'X-CSRFToken': global.__CSRF_TOKEN__ }
      });
      if (resShared.ok) {
        const sharedData = await resShared.json();
        if (countSharedToMeEl) {
          countSharedToMeEl.textContent = sharedData.shared_to_me_count || 0;
        }
        // Prefer API count for Shared-with as well (more accurate than local array)
        if (countSharedWithEl) {
          countSharedWithEl.textContent = sharedData.shared_with_count || 0;
        }
      }
    } catch (err) {
      console.warn('[sidebar_filters] Failed to fetch shared-counts', err);
    }

    if (archivedCountEl || trashCountEl) {
      try {
        if (archivedCountEl) {
          const resArc = await fetch('/api/folders/archived', {
            headers: {'X-CSRFToken': global.__CSRF_TOKEN__}
          });
          if (resArc.ok) {
            const dataArc = await resArc.json();
            archivedCountEl.textContent = dataArc.items ? dataArc.items.length : (dataArc.folders ? dataArc.folders.length : 0);
          }
        }
        if (trashCountEl) {
          const resTrash = await fetch('/api/trash/all', {
            headers: {'X-CSRFToken': global.__CSRF_TOKEN__}
          });
          if (resTrash.ok) {
            const dataTrash = await resTrash.json();
            trashCountEl.textContent = dataTrash.items ? dataTrash.items.length : 0;
          }
        }
      } catch (err) {
        console.warn('Failed to fetch stats for archived/trash', err);
      }
    }
    
    if (activeWsCountEl) {
      try {
        const resWs = await fetch('/api/workspaces', {
          headers: {'X-CSRFToken': global.__CSRF_TOKEN__}
        });
        if (resWs.ok) {
          const dataWs = await resWs.json();
          if (dataWs.success && dataWs.workspaces) {
            const activeCount = dataWs.workspaces.filter(ws => !ws.is_closed).length;
            activeWsCountEl.textContent = activeCount;
          }
        }
      } catch (err) {
        console.warn('Failed to fetch stats for workspaces', err);
      }
    }

    // Notificar que los datos del sidebar están listos (permite inicialización desde URL params)
    document.dispatchEvent(new CustomEvent('sidebarDataReady'));
  }

  /**
   * Applies the selected filter to the main UI view.
   */
  function applyFilter() {
    const foldersGrid = document.getElementById('foldersGrid');
    const docsGrid = document.getElementById('docsGrid');
    
    if (!foldersGrid || !docsGrid) return;
    
    const allFolderEls = foldersGrid.querySelectorAll('.folder-outer');
    const allDocEls = docsGrid.querySelectorAll('.doc-outer');

    const foldersArray = getFoldersSafely();
    const docsArray = getDocsSafely();

    let visibleFolders = 0;
    let visibleDocs = 0;

    allFolderEls.forEach(el => {
      const folderId = parseInt(el.dataset.folderId, 10);
      const dataObj = foldersArray.find(f => f.id === folderId);
      
      let match = false;
      if      (currentFilter === 'all')         match = true;
      else if (currentFilter === 'new-folders') match = isRecent(dataObj?.created_at_raw, 24);
      else if (currentFilter === 'shared')      match = isShared(dataObj);      // legacy
      else if (currentFilter === 'shared-with') match = isSharedByMe(dataObj);  // NEW
      else if (currentFilter === 'shared-to-me') match = isSharedWithMe(dataObj); // NEW
      
      if (currentFilter === 'new-files') match = false;

      if (match) {
        el.style.display = '';
        el.classList.add('sidebar-filter-active');
        visibleFolders++;
      } else {
        el.style.display = 'none';
        el.classList.remove('sidebar-filter-active');
      }
    });

    allDocEls.forEach(el => {
      const docId = parseInt(el.dataset.docIdx, 10); 
      const dataObj = docsArray.find(d => d.id === docId);

      let match = false;
      if      (currentFilter === 'all')          match = true;
      else if (currentFilter === 'new-files')    match = isRecent(dataObj?.created_at_raw, 24);
      else if (currentFilter === 'shared')       match = isShared(dataObj);       // legacy
      else if (currentFilter === 'shared-with')  match = isSharedByMe(dataObj);   // NEW
      else if (currentFilter === 'shared-to-me') match = isSharedWithMe(dataObj);  // NEW

      if (currentFilter === 'new-folders') match = false;

      if (match) {
        el.style.display = '';
        el.classList.add('sidebar-filter-active');
        visibleDocs++;
      } else {
        el.style.display = 'none';
        el.classList.remove('sidebar-filter-active');
      }
    });

    const foldersNoResults = document.getElementById('foldersNoResults');
    const docsNoResults    = document.getElementById('docsNoResults');
    
    const hidesFolders = ['new-files'];
    const hidesDocs    = ['new-folders'];

    if (foldersNoResults) foldersNoResults.classList.toggle('show', visibleFolders === 0 && !hidesFolders.includes(currentFilter));
    if (docsNoResults)    docsNoResults.classList.toggle('show',    visibleDocs === 0    && !hidesDocs.includes(currentFilter));

    const folderSection = document.getElementById('homeFoldersSection');
    const docSection    = document.getElementById('homeDocsSection');
    
    if (folderSection) folderSection.style.display = hidesFolders.includes(currentFilter) ? 'none' : '';
    if (docSection)    docSection.style.display    = hidesDocs.includes(currentFilter)    ? 'none' : '';
  }

  /**
   * Called from sidebar HTML.
   */
  function filterSidebar(filterType, menuItem) {
    currentFilter = filterType;

    const allItems = document.querySelectorAll('.sidebar-panel .p-item');
    allItems.forEach(i => i.classList.remove('active'));

    if (menuItem) {
      // Llamada clásica desde código legado con referencia al elemento
      menuItem.classList.add('active');
    } else {
      // Llamada moderna: buscar el item por data-filter attribute
      const target = document.querySelector(`.sidebar-panel .p-item[data-filter="${filterType}"]`);
      if (target) target.classList.add('active');
    }

    applyFilter();
    
    const q = (document.getElementById('searchInput')?.value || '').trim().toLowerCase();
    if (q && typeof filterContent === 'function') {
      filterContent(q);
    } else if (q && global.filterContent) {
      global.filterContent(q);
    }
  }

  global.updateSidebarCounts = updateSidebarCounts;
  global.filterSidebar = filterSidebar;

})(window);
