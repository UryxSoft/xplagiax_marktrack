/**
 * invite_core.js
 * Core UI logic for the Student Document Editor (Invite View)
 */

(function() {
    'use strict';

    // ── Configuration ──────────────────────────────────────────────
    let config = {};
    try {
        const configEl = document.getElementById('server-config');
        if (configEl) {
            config = JSON.parse(configEl.textContent);
            window.TOKEN = config.token;
            window.DOCUMENT_ID = config.documentId;
            window.IS_STUDENT = config.isStudent;
        }
    } catch (e) {
        console.error("[InviteCore] Failed to parse server config:", e);
    }

    // ── Initialization ─────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', function() {
        // Init Lucide
        if (window.lucide) lucide.createIcons();

        // ── Panel collapse toggle ─────────────────────────────────────
        document.querySelectorAll('.panel-header[data-toggle]').forEach(function(header) {
            var id = header.getAttribute('data-toggle');
            var content = document.getElementById(id);
            if (content && !content.classList.contains('collapsed')) {
                header.setAttribute('aria-expanded', 'true');
            } else {
                header.setAttribute('aria-expanded', 'false');
            }

            header.addEventListener('click', function() {
                var targetId = this.getAttribute('data-toggle');
                var targetContent = document.getElementById(targetId);
                if (!targetContent) return;
                
                var isNowClosed = targetContent.classList.toggle('collapsed');
                this.setAttribute('aria-expanded', isNowClosed ? 'false' : 'true');
            });
        });

        // ── Sidebar / Pages-Offcanvas toggle ─────────────────────────
        var sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
        var pagesOffcanvasBtn = document.getElementById('pagesOffcanvasBtn');
        var sidebar = document.getElementById('appSidebar');
        var offcanvas = document.getElementById('pagesOffcanvas');
        
        if (sidebarToggleBtn && pagesOffcanvasBtn && sidebar && offcanvas) {
            var sidebarVisible = true, offcanvasVisible = false;

            sidebarToggleBtn.addEventListener('click', function() {
                sidebarVisible = !sidebarVisible;
                sidebar.classList.toggle('sidebar-hidden', !sidebarVisible);
                if (sidebarVisible && offcanvasVisible) {
                    offcanvasVisible = false;
                    offcanvas.classList.remove('offcanvas-visible');
                }
                var icon = sidebarToggleBtn.querySelector('[data-lucide]');
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
                    var si = sidebarToggleBtn.querySelector('[data-lucide]');
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

        // ── Find in document ──────────────────────────────────────────
        if (typeof EditorFind !== 'undefined') EditorFind.init();
    });

    // ── Global Helpers ──────────────────────────────────────────────
    window.csrfToken = function() {
        var meta = document.querySelector('meta[name="csrf-token"]');
        return meta ? meta.getAttribute('content') : '';
    };

})();
