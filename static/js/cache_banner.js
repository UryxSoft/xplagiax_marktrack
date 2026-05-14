/**
 * cache_banner.js
 * Modular Vanilla JS Notification Layer for Redis Cache Status.
 */

class CacheStatusService {
    constructor() {
        this.containerId = 'cacheStatusContainer';
        this.pollingInterval = 45000; // 45 seconds
        this.timerId = null;
        
        // Ensure DOM container exists
        this._ensureContainer();
    }

    /**
     * Entry point to boot the observer.
     */
    init() {
        // Immediate check on boot
        this.checkStatus();
        
        // Start polling loop
        this.timerId = setInterval(() => this.checkStatus(), this.pollingInterval);
    }

    _ensureContainer() {
        let container = document.getElementById(this.containerId);
        if (!container) {
            container = document.createElement('div');
            container.id = this.containerId;
            container.className = 'cache-status-container';
            document.body.appendChild(container);
        }
        return container;
    }

    async checkStatus() {
        try {
            const res = await fetch('/api/cache/status');
            if (!res.ok) return; // Silent fail if 500/502 (site down)
            
            const data = await res.json();

            if (data.status === 'down') {
                this._handleOfflineState();
            } else if (data.status === 'up') {
                this._handleOnlineState();
            }
        } catch (err) {
            // Fails silently if network is completely unreachable
            console.debug("[CacheStatus] Ping failed:", err);
        }
    }

    _handleOfflineState() {
        // Only trigger once per session when offline hits
        if (!sessionStorage.getItem('cache_notified_down')) {
            this.showBanner(
                'offline',
                'Cache Unavailable',
                'Cache service is currently unavailable. Performance may be temporarily degraded.',
                `<svg width="22" height="22" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
                false // Explicit dismiss required
            );
            sessionStorage.setItem('cache_notified_down', 'true');
            sessionStorage.removeItem('cache_notified_up');
        }
    }

    _handleOnlineState() {
        // Trigger if this is the first time verifying online state in this session
        // or if it was previously offline and just came back up.
        if (!sessionStorage.getItem('cache_notified_up')) {
            const wasDown = sessionStorage.getItem('cache_notified_down');
            const title = wasDown ? 'Cache Restored' : 'Cache Online';
            const message = wasDown 
                ? 'Cache service restored. Response times are now optimized.' 
                : 'High-performance cache layer is active and routing queries.';

            this.showBanner(
                'online',
                title,
                message,
                `<svg width="22" height="22" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
                true // Auto dismiss after 5s
            );
            sessionStorage.setItem('cache_notified_up', 'true');
            sessionStorage.removeItem('cache_notified_down');
        }
    }

    showBanner(type, title, message, svgStr, autoDismiss) {
        const container = this._ensureContainer();
        
        // Remove existing banners avoiding duplicates
        container.innerHTML = '';

        const banner = document.createElement('div');
        banner.className = `cache-banner ${type}`;
        
        banner.innerHTML = `
            <div class="cb-icon">${svgStr}</div>
            <div class="cb-content" style="cursor: pointer;" onclick="window.cacheDashboard && window.cacheDashboard.open()">
                <h4 class="cb-title">${title} <span style="opacity: 0.5; font-size: 0.8em; margin-left: 6px;">(Click for insights)</span></h4>
                <p class="cb-message">${message}</p>
            </div>
            <button class="cb-close" aria-label="Close notification">
                <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
        `;

        // Bind Close Event
        const closeBtn = banner.querySelector('.cb-close');
        closeBtn.addEventListener('click', () => this.dismissBanner(banner));

        container.appendChild(banner);

        if (autoDismiss) {
            setTimeout(() => {
                this.dismissBanner(banner);
            }, 5000);
        }
    }

    dismissBanner(bannerElement) {
        if (!bannerElement || !bannerElement.parentNode) return;
        
        bannerElement.classList.add('cb-exit');
        
        // Wait for CSS transition (300ms) to complete before DOM removal
        setTimeout(() => {
            if (bannerElement.parentNode) {
                bannerElement.parentNode.removeChild(bannerElement);
            }
        }, 300);
    }
}

// Global exposure
window.CacheStatusService = new CacheStatusService();
