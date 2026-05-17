/**
 * documentedit_core.js
 * Core initialization and UI logic for the Document Review dashboard.
 */

(function() {
    'use strict';

    // 1. Initialize Configuration
    const configEl = document.getElementById('documentedit-config') || document.getElementById('marktrack-doc-data');
    if (!configEl) {
        console.error('[DocumentEdit] Configuration block not found.');
        return;
    }

    const MT_DATA = JSON.parse(configEl.textContent);
    window.MT_DATA = MT_DATA; // Global access for other modules

    // Debug helper
    function updateDebug(id, msg) {
        const el = document.getElementById(id);
        if (el) el.textContent = msg;
        console.log(`[ReviewDebug] ${id}: ${msg}`);
    }

    // 2. Toolbar & Lucide Icons
    document.addEventListener('DOMContentLoaded', async function() {
        if (typeof lucide !== 'undefined') lucide.createIcons();
        if (typeof EditorFind !== 'undefined') EditorFind.init();

        updateDebug('dbg-status', 'Status: DOMContentLoaded');

        // 2.5 Load Extra Quill Modules dynamically
        updateDebug('dbg-editor', 'Editor: Loading External Modules...');
        let extraModules = {};
        let _toolbarHandlerFactories = {};
        try {
            const { getQuillModules } = await import('/static/js/quill-modules.js?v=2.0.0');
            const { registry, config, toolbarHandlerFactories } = await getQuillModules('documentedit');
            
            // Explicitly register each downloaded module namespace
            Object.entries(registry).forEach(([name, mod]) => {
                Quill.register(name, mod, true);
            });
            
            // Use config block
            extraModules = config;
            _toolbarHandlerFactories = toolbarHandlerFactories || {};
        } catch (err) {
            console.error('[DocumentEdit] Failed to load extra modules', err);
            updateDebug('dbg-editor', 'Editor: WARNING - Ext modules failed');
        }

        // 3. Quill Pagination Initialization
        const containerEl = document.querySelector('#editor-pages');
        if (!containerEl) {
            updateDebug('dbg-status', 'Status: ERROR - #editor-pages missing');
            return;
        }

        containerEl.style.minHeight = "500px";

        updateDebug('dbg-editor', 'Editor: Initializing Pagination...');
        if (typeof QuillPagination === 'undefined') {
            console.error('[DocumentEdit] QuillPagination class not found.');
            return;
        }

        const pagination = new QuillPagination({
            container: '#editor-pages',
            readOnly: false,
            theme: 'snow',
            pageWidth: '210mm',
            pageHeight: '297mm',
            pageMargin: '15mm',
            pagePadding: '15mm',
            autoPageBreak: true,
            showPageNumbers: true,
            toolbar: '#custom-toolbar',
            quillModules: extraModules
        });
        window.quillPagination = pagination;

        const quill = pagination.quill;
        if (!quill) {
            updateDebug('dbg-editor', 'Editor: ERROR - Quill init failed');
            return;
        }

        // Strip text backgrounds and colors on paste to prevent unreadable styling
        if (quill && quill.clipboard) {
            quill.clipboard.addMatcher(Node.ELEMENT_NODE, (node, delta) => {
                delta.ops.forEach(op => {
                    if (op.attributes) {
                        delete op.attributes.background;
                        delete op.attributes.color;
                    }
                });
                return delta;
            });
        }

        // Initialize Floating Bubble Toolbar
        if (typeof QuillBubbleToolbar !== 'undefined') {
            new QuillBubbleToolbar(quill);
            console.log('[DocumentEdit] Floating Bubble Toolbar initialized');
        }
        
        // Apply all toolbar handlers returned by the module system
        // (includes table-better, placeholder, and any future additions)
        const toolbar = quill.getModule('toolbar');
        if (toolbar) {
            Object.entries(_toolbarHandlerFactories).forEach(([handlerName, factory]) => {
                try {
                    toolbar.addHandler(handlerName, factory(quill));
                    console.log(`[DocumentEdit] Toolbar handler registered: ${handlerName}`);
                } catch (e) {
                    console.warn(`[DocumentEdit] Failed to register handler "${handlerName}":`, e.message);
                }
            });
        }

        updateDebug('dbg-editor', 'Editor: Ready (ID: ' + MT_DATA.id + ')');

        // 4. Content Loading Logic
        const contentDeltaRaw = MT_DATA.content_delta;
        const contentHtmlRaw  = MT_DATA.content_html;

        function loadContent() {
            updateDebug('dbg-status', 'Status: Loading content...');
            try {
                let delta = null;
                if (contentDeltaRaw) {
                    if (typeof contentDeltaRaw === 'object' && contentDeltaRaw.ops) {
                        delta = contentDeltaRaw;
                    } else if (typeof contentDeltaRaw === 'string') {
                        const trimmed = contentDeltaRaw.trim();
                        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
                            delta = JSON.parse(trimmed);
                        }
                    }
                }

                if (delta && delta.ops && delta.ops.length > 0) {
                    updateDebug('dbg-status', 'Status: Rendering Delta...');
                    pagination.setAllContent(delta);
                    setTimeout(() => {
                        updateDebug('dbg-status', 'Status: DONE (Delta)');
                        updateStatusBar();
                    }, 1200);
                } else if (contentHtmlRaw && contentHtmlRaw.trim().length > 0) {
                    updateDebug('dbg-status', 'Status: Rendering HTML fallback...');
                    quill.clipboard.dangerouslyPasteHTML(contentHtmlRaw);
                    setTimeout(() => {
                        pagination._repaginate();
                        updateDebug('dbg-status', 'Status: DONE (HTML)');
                        updateStatusBar();
                    }, 1500);
                } else {
                    updateDebug('dbg-status', 'Status: WARN - Empty document');
                    quill.setText('No content available.');
                }
            } catch (err) {
                updateDebug('dbg-status', 'Status: CRITICAL ERROR: ' + err.message);
                console.error("[Review] Content loading failed:", err);
            }
        }

        setTimeout(loadContent, 500);

        // 5. Status Bar Updates
        function updateStatusBar() {
            const text = quill.getText() || '';
            const cleanText = text.trim();
            const words = cleanText ? cleanText.split(/\s+/).length : 0;
            const chars = Math.max(0, text.length - 1);
            const lines = text.split('\n').length;

            const qsWords = document.getElementById('qsWords');
            const qsChars = document.getElementById('qsChars');
            const qsLines = document.getElementById('qsLines');
            const qsPage  = document.getElementById('qsPage');

            if (qsWords) qsWords.textContent = words + ' words';
            if (qsChars) qsChars.textContent = chars + ' chars';
            if (qsLines) qsLines.textContent = lines + ' lines';
            if (qsPage && pagination) {
                qsPage.textContent = `Page ${pagination.currentPageIndex + 1} of ${pagination.pageCount}`;
            }
        }

        setTimeout(updateStatusBar, 1500);
        quill.on('text-change', updateStatusBar);

        // 6. Tab Navigation Logic
        const tabButtons = document.querySelectorAll('.tab');
        const tabPanels = document.querySelectorAll('.tab-panel');

        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                const tabId = button.getAttribute('data-tab');
                tabButtons.forEach(btn => btn.classList.remove('active'));
                tabPanels.forEach(panel => {
                    panel.classList.remove('active');
                    panel.style.display = 'none';
                });

                button.classList.add('active');
                const activePanel = document.getElementById(tabId);
                if (activePanel) {
                    activePanel.classList.add('active');
                    activePanel.style.display = 'block';
                }
            });
        });

        // 7. Sidebar & Offcanvas Toggles
        const sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
        const pagesOffcanvasBtn = document.getElementById('pagesOffcanvasBtn');
        const sidebar = document.getElementById('appSidebar');
        const offcanvas = document.getElementById('pagesOffcanvas');

        if (sidebarToggleBtn && pagesOffcanvasBtn && sidebar && offcanvas) {
            let sidebarVisible = true, offcanvasVisible = false;

            sidebarToggleBtn.addEventListener('click', function() {
                sidebarVisible = !sidebarVisible;
                sidebar.classList.toggle('sidebar-hidden', !sidebarVisible);
                if (sidebarVisible && offcanvasVisible) {
                    offcanvasVisible = false;
                    offcanvas.classList.remove('offcanvas-visible');
                }
                const icon = sidebarToggleBtn.querySelector('[data-lucide]');
                if (icon) {
                    icon.setAttribute('data-lucide', sidebarVisible ? 'panel-right' : 'panel-right-close');
                    if (window.lucide) lucide.createIcons();
                }
            });

            pagesOffcanvasBtn.addEventListener('click', function() {
                offcanvasVisible = !offcanvasVisible;
                offcanvas.classList.toggle('offcanvas-visible', offcanvasVisible);
                if (offcanvasVisible && sidebarVisible) {
                    sidebarVisible = false;
                    sidebar.classList.add('sidebar-hidden');
                    const si = sidebarToggleBtn.querySelector('[data-lucide]');
                    if (si) {
                        si.setAttribute('data-lucide', 'panel-right-close');
                        if (window.lucide) lucide.createIcons();
                    }
                }
                if (offcanvasVisible && window.PagesOffcanvas) {
                    window.PagesOffcanvas.refresh();
                }
            });
        }
        
        // 8. Manual Save Draft Button
        const saveDraftBtn = document.getElementById('saveDraftBtn');
        if (saveDraftBtn) {
            saveDraftBtn.addEventListener('click', function() {
                if (typeof window.performSaveDocumentEdit === 'function') {
                    window.performSaveDocumentEdit(false);
                } else {
                    console.error('[DocumentEdit] Manual save function not available.');
                }
            });
        }
    });

})();
