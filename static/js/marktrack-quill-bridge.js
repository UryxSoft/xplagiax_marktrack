// ===================================================================
// MARKTRACK + QUILL INTEGRATION
// Connects pagination system with tracking functionality
// ===================================================================

const MarkTrackQuillBridge = {
    quillPagination: null,
    isInitialized: false,

    // ===============================================================
    // INITIALIZATION
    // ===============================================================
    init() {
        if (this.isInitialized) return;

        // Check if dependencies are loaded
        if (typeof Quill === 'undefined' || typeof QuillPagination === 'undefined') {
            console.log('Waiting for Quill.js to load...');
            // Retry after a short delay
            setTimeout(() => this.init(), 100);
            return;
        }

        console.log('Quill.js loaded, initializing pagination...');

        try {
            // Initialize Quill Pagination
            this.quillPagination = new QuillPagination({
                container: '#editor-pages',
                pageWidth: '210mm',
                pageHeight: '297mm',
                pageMargin: '15mm',      // Reduced margins for more text space
                pagePadding: '15mm',     // Reduced padding for more text space
                theme: 'snow',
                placeholder: 'Start writing your assignment...',
                autoPageBreak: true,
                showPageNumbers: true,
                onTextChange: (content, source) => {
                    this.handleTextChange(content, source);
                },
                toolbar: '#custom-toolbar' // Use the fixed custom toolbar from invite.html
            });

            // Expose the instances globally so existing scripts don't break
            window.quillPagination = this.quillPagination;
            if (this.quillPagination.pages.length > 0) {
                window.quill = this.quillPagination.pages[0].quill;
            }

            this.setupBridge();
            //this.setupDocumentInfo();
            this.setupPrintSupport();
            this.isInitialized = true;

        console.log('MarkTrack-Quill Bridge initialized');
        } catch (error) {
            console.error('Failed to initialize MarkTrack-Quill Bridge:', error);
            // Retry after delay
            this.isInitialized = false;
            setTimeout(() => this.init(), 500);
        }
    },

    // ===============================================================
    // BRIDGE SETUP
    // ===============================================================
    setupBridge() {
        // Connect to MarkTrack if available
        if (typeof MarkTrack !== 'undefined') {
            // Override MarkTrack's editor methods
            this.connectToMarkTrack();
        }

        // Setup auto-save
        this.setupAutoSave();

        // Setup keyboard shortcuts
        this.setupKeyboardShortcuts();
    },

    connectToMarkTrack() {
        // Save original MarkTrack methods
        const originalCaptureVersion = MarkTrack.captureVersion;
        const originalUpdateStats = MarkTrack.updateStats;

        // Override captureVersion to work with Quill
        MarkTrack.captureVersion = (type = 'auto') => {
            const content = this.quillPagination.exportContent();
            const text = content.text;
            const words = text.split(/\s+/).filter(w => w).length;

            const version = {
                id: `v_${Date.now()}`,
                timestamp: Date.now(),
                content: content.html,
                text: text,
                delta: content.delta,
                wordCount: words,
                pageCount: content.pages,
                sessionId: MarkTrack.state.currentSession,
                type: type,
                events: []
            };

            // Calculate diff from last version
            if (MarkTrack.state.versions.length > 0) {
                const lastVersion = MarkTrack.state.versions[MarkTrack.state.versions.length - 1];
                version.diff = MarkTrack.calculateDiff(lastVersion.text, text);
            }

            MarkTrack.state.versions.push(version);
            MarkTrack.state.documentContent = content.html;
            MarkTrack.updateVersionList();
            MarkTrack.saveState();
        };

        // Override updateStats
        MarkTrack.updateStats = () => {
            const content = this.quillPagination.exportContent();
            const text = content.text;
            const words = text.split(/\s+/).filter(w => w).length;
            const paragraphs = text.split(/\n\n+/).filter(p => p.trim()).length;

            MarkTrack.state.wordCount = words;
            MarkTrack.state.paragraphCount = paragraphs;

            // Update UI
            const wordCountElements = document.querySelectorAll('#wordCount, #currentWords');
            wordCountElements.forEach(el => el.textContent = words);

            const paragraphCountEl = document.getElementById('paragraphCount');
            if (paragraphCountEl) paragraphCountEl.textContent = paragraphs;

            // Update progress
            const progress = Math.min((words / 2500) * 100, 100);
            const progressFill = document.getElementById('progressFill');
            const progressPercent = document.getElementById('progressPercent');

            if (progressFill) progressFill.style.width = `${progress}%`;
            if (progressPercent) progressPercent.textContent = `${Math.round(progress)}%`;
        };

        // Load existing content if any
        if (MarkTrack.state.documentContent) {
            try {
                // Try to load as Delta first
                if (MarkTrack.state.versions.length > 0) {
                    const lastVersion = MarkTrack.state.versions[MarkTrack.state.versions.length - 1];
                    if (lastVersion.delta) {
                        this.quillPagination.setAllContent(lastVersion.delta);
                    }
                }
            } catch (e) {
                console.warn('Could not load previous content', e);
            }
        }
    },

    // ===============================================================
    // TEXT CHANGE HANDLER
    // ===============================================================
    handleTextChange(content, source) {
        if (source === 'user') {
            // Mark activity
            if (typeof MarkTrack !== 'undefined') {
                MarkTrack.state.lastActivity = Date.now();
                MarkTrack.state.isActive = true;

                // Update stats
                MarkTrack.updateStats();
            }

            // Update document info overlay
            this.updateDocumentInfo();
        }
    },

    // ===============================================================
    // AUTO-SAVE
    // ===============================================================
    setupAutoSave() {
        let saveTimeout;

        // Debounced save function
        const debouncedSave = () => {
            clearTimeout(saveTimeout);
            saveTimeout = setTimeout(() => {
                this.saveDocument();
            }, 2000);
        };

        // Trigger on any text change
        if (this.quillPagination.quillInstances[0]) {
            this.quillPagination.quillInstances.forEach(quill => {
                quill.on('text-change', debouncedSave);
            });
        }
    },

    saveDocument() {
        if (typeof MarkTrack !== 'undefined') {
            MarkTrack.captureVersion('auto');
            MarkTrack.setSaveStatus('saved');
            MarkTrack.updateLastSavedTime();
        }

        // Also save to localStorage as backup
        try {
            const content = this.quillPagination.exportContent();
            localStorage.setItem('marktrack_quill_backup', JSON.stringify({
                delta: content.delta,
                timestamp: Date.now()
            }));
        } catch (e) {
            console.error('Backup save failed', e);
            if (e.name === 'QuotaExceededError') {
                try { localStorage.removeItem('marktrack_quill_backup'); } catch(e2){}
            }
        }
    },

    // ===============================================================
    // DOCUMENT INFO OVERLAY
    // ===============================================================
    setupDocumentInfo() {
        // Create info overlay
        const overlay = document.createElement('div');
        overlay.id = 'documentInfoOverlay';
        overlay.className = 'document-info-overlay';
        overlay.innerHTML = `
            <div class="info-item">
                <span class="info-label">Words:</span>
                <span class="info-value" id="infoWords">0</span>
            </div>
            <div class="info-item">
                <span class="info-label">Pages:</span>
                <span class="info-value" id="infoPages">1</span>
            </div>
            <div class="info-item">
                <span class="info-label">Characters:</span>
                <span class="info-value" id="infoChars">0</span>
            </div>
        `;
        document.body.appendChild(overlay);

        this.updateDocumentInfo();
    },

    updateDocumentInfo() {
        const content = this.quillPagination.exportContent();
        const text = content.text;
        const words = text.split(/\s+/).filter(w => w).length;
        const chars = text.length;

        const infoWords = document.getElementById('infoWords');
        const infoPages = document.getElementById('infoPages');
        const infoChars = document.getElementById('infoChars');

        if (infoWords) infoWords.textContent = words.toLocaleString();
        if (infoPages) infoPages.textContent = content.pages;
        if (infoChars) infoChars.textContent = chars.toLocaleString();
    },

    // ===============================================================
    // KEYBOARD SHORTCUTS
    // ===============================================================
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ctrl/Cmd + P - Print
            if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
                e.preventDefault();
                this.printDocument();
            }

            // Ctrl/Cmd + Shift + E - Export
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'E') {
                e.preventDefault();
                this.exportDocument();
            }

            // Ctrl/Cmd + Enter - Page Break (handled by Quill Pagination)
        });
    },

    // ===============================================================
    // PRINT SUPPORT
    // ===============================================================
    setupPrintSupport() {
        // Add print button if not exists
        const exportBtn = document.getElementById('exportBtn');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => {
                this.showExportOptions();
            });
        }
    },

    printDocument() {
        window.print();
    },

    showExportOptions() {
        // Open export modal if using MarkTrack modal system
        if (typeof ModalSystem !== 'undefined') {
            ModalSystem.openModal('exportModal');
        }
    },

    // ===============================================================
    // EXPORT FUNCTIONS
    // ===============================================================
    exportDocument(format = 'html') {
        const content = this.quillPagination.exportContent();

        switch (format) {
            case 'html':
                this.downloadFile(content.html, 'document.html', 'text/html');
                break;
            case 'txt':
                this.downloadFile(content.text, 'document.txt', 'text/plain');
                break;
            case 'json':
                this.downloadFile(JSON.stringify(content.delta, null, 2), 'document.json', 'application/json');
                break;
            default:
                console.warn('Unknown export format:', format);
        }
    },

    downloadFile(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    },

    // ===============================================================
    // UTILITY FUNCTIONS
    // ===============================================================
    getContent() {
        return this.quillPagination ? this.quillPagination.exportContent() : null;
    },

    setContent(delta) {
        if (this.quillPagination) {
            this.quillPagination.setAllContent(delta);
        }
    },

    getWordCount() {
        const content = this.getContent();
        return content ? content.text.split(/\s+/).filter(w => w).length : 0;
    },

    getPageCount() {
        return this.quillPagination ? this.quillPagination.pages.length : 0;
    }
};

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        // Small delay to ensure Quill and other dependencies are loaded
        setTimeout(() => {
            MarkTrackQuillBridge.init();
        }, 100);
    });
} else {
    setTimeout(() => {
        MarkTrackQuillBridge.init();
    }, 100);
}

// Export for external access
window.MarkTrackQuillBridge = MarkTrackQuillBridge;
