/**
 * sidebar_collapse.js
 * Manages the horizontal collapse state of the dashboard sidebar.
 * Features: Persistence, Responsive auto-collapse, A11Y.
 */

(function() {
    'use strict';

    const sidebar = document.getElementById('sidebarPanel');
    const toggleBtn = document.getElementById('sidebarToggle');
    const dashboard = document.querySelector('.dashboard');
    const STORAGE_KEY = 'sidebar_collapsed';
    const BREAKPOINT = 1024;

    function setSidebarState(collapsed) {
        if (!sidebar || !dashboard) return;

        if (collapsed) {
            sidebar.classList.add('collapsed');
            dashboard.style.setProperty('--sidebar-w', '68px');
            if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'false');
        } else {
            sidebar.classList.remove('collapsed');
            dashboard.style.setProperty('--sidebar-w', '230px');
            if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'true');
        }

        // Store preference
        localStorage.setItem(STORAGE_KEY, collapsed);
        
        // Dispatch event for other components (like charts or grids) to resize if needed
        window.dispatchEvent(new Event('resize'));
    }

    function toggleSidebar() {
        const isCollapsed = sidebar.classList.contains('collapsed');
        setSidebarState(!isCollapsed);
    }

    function init() {
        if (!sidebar || !toggleBtn) return;

        // 1. Initial Load from LocalStorage
        const storedState = localStorage.getItem(STORAGE_KEY);
        let shouldCollapse = storedState === 'true';

        // 2. Responsive Check (override if first time or small screen)
        if (window.innerWidth < BREAKPOINT) {
            shouldCollapse = true;
        }

        setSidebarState(shouldCollapse);

        // 3. Event Listeners
        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleSidebar();
        });

        // 4. Responsive Resize Listener
        let resizeTimer;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                if (window.innerWidth < BREAKPOINT) {
                    setSidebarState(true);
                }
            }, 250);
        });

        // 5. Badge Zero-Hide Logic
        const counts = document.querySelectorAll('.p-count');
        const updateBadgeVisibility = (el) => {
            const val = el.textContent.trim();
            if (val === '0' || val === '') {
                el.setAttribute('data-empty', 'true');
            } else {
                el.removeAttribute('data-empty');
            }
        };

        const observer = new MutationObserver((mutations) => {
            mutations.forEach(m => {
                if (m.type === 'childList' || m.type === 'characterData') {
                    updateBadgeVisibility(m.target.parentElement || m.target);
                }
            });
        });

        counts.forEach(c => {
            updateBadgeVisibility(c);
            observer.observe(c, { childList: true, characterData: true, subtree: true });
        });

        // Sync on data ready
        document.addEventListener('sidebarDataReady', () => {
            counts.forEach(updateBadgeVisibility);
        });
    }

    // Run on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Expose for external use if needed
    window.SidebarManager = {
        toggle: toggleSidebar,
        setState: setSidebarState,
        isCollapsed: () => sidebar.classList.contains('collapsed')
    };
})();
