/**
 * refresh_btn.js
 * Centralized utility to handle global refresh buttons across all views.
 * Standardizes API debouncing, loading states, rotation animations, and accessibility.
 */

class RefreshManager {
    /**
     * Executes a refresh action and binds UI loading states.
     * @param {HTMLElement} btnEl - The button element that was clicked.
     * @param {Function} fetchPromiseFn - A function returning a Promise to execute the refresh logic.
     */
    static async execute(btnEl, fetchPromiseFn) {
        // Prevent rapid multi-clicks
        if (btnEl.hasAttribute('aria-busy')) {
            return;
        }

        // Set Loading State
        btnEl.setAttribute('aria-busy', 'true');
        btnEl.setAttribute('data-tooltip', 'Refreshing...');
        btnEl.classList.add('refreshing');
        btnEl.classList.add('spinning'); // Support for legacy CSS animations

        // Execute API Call
        try {
            await fetchPromiseFn();
            
            // Success Feedback: brief green tint
            btnEl.style.color = '#34d399';
            btnEl.style.borderColor = 'rgba(52,211,153,0.4)';
            if (window.showToast) {
                const label = btnEl.getAttribute('aria-label') || 'Datos';
                showToast(`${label} actualizados`, 'success');
            }
            
            setTimeout(() => {
                btnEl.style.color = '';
                btnEl.style.borderColor = '';
            }, 1000);
            
        } catch (error) {
            console.error('[RefreshManager] Fetch failed:', error);
            
            // Error Feedback: brief red tint
            btnEl.style.color = '#f87171';
            if (window.showToast) showToast('Error al actualizar', 'error');
            
            setTimeout(() => {
                btnEl.style.color = '';
            }, 1000);
        } finally {
            // Restore Idle State
            btnEl.removeAttribute('aria-busy');
            btnEl.setAttribute('data-tooltip', 'Refresh');
            btnEl.classList.remove('refreshing');
            btnEl.classList.remove('spinning');
            
            // To prevent instant rapid clicks right after resolving (throttle)
            btnEl.style.pointerEvents = 'none';
            setTimeout(() => {
                btnEl.style.pointerEvents = 'auto';
            }, 600);
        }
    }
}

// Global Exposure
window.RefreshManager = RefreshManager;
