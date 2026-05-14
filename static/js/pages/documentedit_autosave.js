/**
 * documentedit_autosave.js
 * Handles document persistence with debouncing and status indicators.
 */

(function() {
    'use strict';

    let typingTimer;
    let isSaving = false;
    let pendingSave = false;
    let hasUnsavedChanges = false;
    
    const saveStatusLabel = document.getElementById('autoSaveIndicator');
    const DOC_ID          = Number(window.MT_DATA?.id);
    const DOC_TITLE       = window.MT_DATA?.title;

    function csrf() {
        const m = document.querySelector('meta[name="csrf-token"]');
        return m ? m.getAttribute('content') : '';
    }

    function updateSaveStatus(status) {
        if (!saveStatusLabel) return;
        
        if (status === 'Unsaved changes') {
            saveStatusLabel.innerHTML = '<span style="color:#f59e0b;font-weight:600;font-size:12px;">Unsaved</span>';
        } else if (status === 'Saving...') {
            saveStatusLabel.innerHTML = '<span style="color:#60a5fa;font-weight:600;font-size:12px;"><i data-lucide="loader" style="width:12px;height:12px;animation:spin 1s linear infinite;margin-right:4px;display:inline-block;"></i>Saving...</span>';
            if (typeof lucide !== 'undefined') lucide.createIcons();
        } else if (status === 'Saved') {
            saveStatusLabel.innerHTML = '<span style="color:#10b981;font-weight:600;font-size:12px;"><i data-lucide="check" style="width:12px;height:12px;margin-right:4px;display:inline-block;"></i>Saved</span>';
            if (typeof lucide !== 'undefined') lucide.createIcons();
            
            const ls = document.getElementById('lastSaved');
            if (ls) ls.innerText = new Date().toLocaleTimeString();
        }
    }

    async function performSave(is_autosave = true) {
        if (isSaving || (!hasUnsavedChanges && is_autosave) || !window.quillPagination) {
            if (hasUnsavedChanges) pendingSave = true;
            return;
        }
        
        isSaving = true;
        pendingSave = false;
        updateSaveStatus('Saving...');
        
        const quill = window.quillPagination.getQuill();
        const metrics = window.typingMetrics ? window.typingMetrics.getMetrics() : null;
        
        const data = {
            delta: quill.getContents(),
            html: quill.root.innerHTML,
            title: DOC_TITLE,
            is_autosave: is_autosave,
            metrics: metrics
        };
        
        try {
            const response = await fetch(`/api/document/${DOC_ID}/save`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': csrf()
                },
                body: JSON.stringify(data)
            });
            
            if (response.ok) {
                hasUnsavedChanges = false;
                updateSaveStatus('Saved');
            } else {
                updateSaveStatus('Unsaved changes');
            }
        } catch(err) {
            console.error("[Autosave] Error: ", err);
            updateSaveStatus('Unsaved changes');
        }
        
    isSaving = false;
    if (pendingSave) setTimeout(performSave, 1000);
}

// Expose for manual triggering
window.performSaveDocumentEdit = performSave;

    function initAutosave() {
        if (!window.quillPagination) return;
        
        const q = window.quillPagination.getQuill();
        if (!q) return;

        q.on('text-change', function() {
            hasUnsavedChanges = true;
            updateSaveStatus('Unsaved changes');
            
            clearTimeout(typingTimer);
            typingTimer = setTimeout(performSave, 2000);
        });
    }

    // Initialize after Core and Pagination are ready
    document.addEventListener('DOMContentLoaded', () => {
        const checkInit = setInterval(() => {
            if (window.quillPagination && window.MT_DATA) {
                clearInterval(checkInit);
                initAutosave();
            }
        }, 500);
    });

})();
