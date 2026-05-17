/**
 * review_core.js
 * Core logic for the Document Review interface.
 * Handles Quill initialization, content loading, and UI navigation (tabs/sidebar).
 */

(function () {
    'use strict';

    // 1. Data & Dependency Checks
    const configEl = document.getElementById('review-config');
    if (!configEl) {
        console.error('[ReviewCore] CRITICAL: #review-config missing.');
        return;
    }

    const config = JSON.parse(configEl.textContent);
    window.REVIEW_CONFIG = config; // Export for other modules

    function updateDebug(id, msg) {
        const el = document.getElementById(id);
        if (el) el.textContent = msg;
        console.log(`[ReviewDebug] ${id}: ${msg}`);
    }

    document.addEventListener('DOMContentLoaded', function () {
        updateDebug('dbg-status', 'Status: DOMContentLoaded');

        // 2. Icon & Search Initialization
        if (typeof lucide !== 'undefined') lucide.createIcons();
        if (typeof EditorFind !== 'undefined') EditorFind.init();

        // 3. Editor Container Verification
        const containerEl = document.querySelector('#editor-pages');
        if (!containerEl) {
            updateDebug('dbg-status', 'Status: ERROR - #editor-pages missing');
            return;
        }
        containerEl.style.minHeight = "500px";

        // 4. Quill Pagination Initialization
        updateDebug('dbg-editor', 'Editor: Initializing Pagination...');
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
            toolbar: false
        });
        window.quillPagination = pagination;

        const quill = pagination.quill;
        if (!quill) {
            updateDebug('dbg-editor', 'Editor: ERROR - Quill init failed');
            return;
        }
        updateDebug('dbg-editor', 'Editor: Ready (ID: ' + config.documentId + ')');

        // 5. Content Loading Logic
        function loadContent() {
            updateDebug('dbg-status', 'Status: Loading content...');
            const { contentDelta, contentHtml } = config;

            try {
                let delta = null;
                if (contentDelta) {
                    if (typeof contentDelta === 'object' && contentDelta.ops) {
                        delta = contentDelta;
                    } else if (typeof contentDelta === 'string') {
                        const trimmed = contentDelta.trim();
                        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
                            delta = JSON.parse(trimmed);
                        }
                    }
                }

                if (delta && delta.ops && delta.ops.length > 0) {
                    updateDebug('dbg-status', 'Status: Rendering Delta...');
                    pagination.setAllContent(delta);
                    setTimeout(() => {
                        quill.disable();
                        updateDebug('dbg-status', 'Status: DONE (Delta)');
                        updateStatusBar();
                    }, 1200);
                } else if (contentHtml && contentHtml.trim().length > 0) {
                    updateDebug('dbg-status', 'Status: Rendering HTML fallback...');
                    quill.clipboard.dangerouslyPasteHTML(contentHtml);
                    setTimeout(() => {
                        pagination._repaginate();
                        quill.disable();
                        updateDebug('dbg-status', 'Status: DONE (HTML)');
                        updateStatusBar();
                    }, 1500);
                } else {
                    updateDebug('dbg-status', 'Status: WARN - Empty document');
                    quill.setText('No content available.');
                    quill.disable();
                }
            } catch (err) {
                updateDebug('dbg-status', 'Status: CRITICAL ERROR: ' + err.message);
                console.error("[Review] Content loading failed:", err);
            }
        }

        setTimeout(loadContent, 500);

        // 6. Status Bar Metrics
        function updateStatusBar() {
            const text = quill.getText() || '';
            const cleanText = text.trim();
            const words = cleanText ? cleanText.split(/\s+/).length : 0;
            const chars = Math.max(0, text.length - 1);
            const lines = text.split('\n').length;

            const qsWords = document.getElementById('qsWords');
            const qsChars = document.getElementById('qsChars');
            const qsLines = document.getElementById('qsLines');
            const qsPage = document.getElementById('qsPage');

            if (qsWords) qsWords.textContent = words + ' words';
            if (qsChars) qsChars.textContent = chars + ' chars';
            if (qsLines) qsLines.textContent = lines + ' lines';
            if (qsPage && pagination) {
                qsPage.textContent = `Page ${pagination.currentPageIndex + 1} of ${pagination.pageCount}`;
            }
        }

        setTimeout(updateStatusBar, 1500);
        quill.on('text-change', updateStatusBar);

        // 7. Tab Navigation
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

        // 8. Sidebar & Offcanvas Toggles
        const sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
        const pagesOffcanvasBtn = document.getElementById('pagesOffcanvasBtn');
        const sidebar = document.getElementById('appSidebar');
        const offcanvas = document.getElementById('pagesOffcanvas');

        if (sidebarToggleBtn && pagesOffcanvasBtn && sidebar && offcanvas) {
            let sidebarVisible = true;
            let offcanvasVisible = false;

            sidebarToggleBtn.addEventListener('click', function () {
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

            pagesOffcanvasBtn.addEventListener('click', function () {
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
        // Expose globally to navigate to Plagiarism tab
        window.switchToPlagiarismTab = function() {
            const tabButtons = document.querySelectorAll('.tab');
            const tabPanels = document.querySelectorAll('.tab-panel');
            tabButtons.forEach(btn => {
                if (btn.getAttribute('data-tab') === 'plagiarism') {
                    tabButtons.forEach(b => b.classList.remove('active'));
                    tabPanels.forEach(p => {
                        p.classList.remove('active');
                        p.style.display = 'none';
                    });
                    btn.classList.add('active');
                    const panel = document.getElementById('plagiarism');
                    if (panel) {
                        panel.classList.add('active');
                        panel.style.display = 'block';
                        // Trigger PasteIntel load
                        if (window.PasteIntel) {
                            window.PasteIntel.load();
                        }
                    }
                }
            });
        };
    });

})();
