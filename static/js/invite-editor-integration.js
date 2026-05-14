/**
 * Invite Editor Integration
 * 
 * Adds advanced functionality to the invite module editor:
 * - Auto-save with 2-second debounce
 * - Image upload with SeaweedFS
 * - Real-time metrics tracking
 * - Version history display
 * - Manual save modal
 */

class InviteEditorIntegration {
    constructor(quillInstance, invitationToken) {
        this.quill = quillInstance;
        this.token = invitationToken;
        this.documentId = null;
        this.saveTimeout = null;
        this.isSaving = false;
        this.isLoading = true;
        this.isClosed = false;

        // Metrics tracking
        this.metrics = {
            wordCount: 0,
            paragraphCount: 0,
            activeTimeSeconds: 0,
            sessions: 0,
            spellingErrors: 0,
            grammarErrors: 0
        };

        // Activity tracking
        this.activityInterval = null;
        this.isTyping = false;
        this.inactivityTimeout = null;
        this.IDLE_THRESHOLD_MS = 5000; // 5 seconds to mark as idle

        // Error detection
        this.errorDetectionTimeout = null;
        this.ERROR_DETECTION_DEBOUNCE_MS = 10000; // 10 seconds

        // Persistence key
        this.statsKey = `invite_stats_${this.token}`;

        // Word limit configuration
        this.hasWordLimit = false;
        this.wordLimit = 0;
        this.showedLimitWarning = false;
    }

    /**
     * Initialize the integration
     */
    async init() {
        console.log('[InviteEditor] Initializing with token:', this.token);

        try {
            // Load existing document
            await this.loadDocument();

            // Setup auto-save
            this.setupAutoSave();

            // Setup image upload handler
            this.setupImageUpload();

            // Setup metrics tracking
            this.setupMetricsTracking();

            // Setup manual save button
            this.setupManualSave();

            // Load version history
            this.loadVersionHistory();

            // Start activity tracking
            this.startActivityTracking();

            this.isLoading = false;
            console.log('[InviteEditor] Initialization complete');

        } catch (error) {
            console.error('[InviteEditor] Initialization error:', error);
            this.showNotification('Error initializing editor', 'error');
        }
    }

    /**
     * Load document from server
     */
    async loadDocument() {
        if (this.documentLoaded) return; // Prevent double loading

        try {
            const response = await fetch(`/invite/${this.token}/document`);
            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Failed to load document');
            }

            this.isClosed = data.is_closed || false;

            if (data.document) {
                this.documentId = data.document.id;

                // Load content into Quill
                if (data.document.delta) {
                    if (window.quillPagination) {
                        window.quillPagination.importContent({ delta: data.document.delta });
                    } else {
                        this.quill.setContents(data.document.delta);
                    }
                }

                // Update metrics immediately
                this.updateMetrics();
            }

            // Load word limit settings
            if (data.workspace) {
                this.hasWordLimit = data.workspace.has_word_limit || false;
                this.wordLimit = data.workspace.word_limit || 0;
            }

            // Disable editor if closed
            if (this.isClosed) {
                this.quill.disable();
                this.showNotification('This assignment has been closed', 'warning');
            }

            console.log('[InviteEditor] Document loaded:', this.documentId);

            // Initialize auto-save
            // this.setupAutoSave(); // Logic moved below

            // Initialize image upload
            // this.setupImageUpload(); // Already called above

            // NEW: Instancia de QuillTypingMetrics (si está disponible)
            if (window.QuillTypingMetrics && !window.typingMetrics) {
                // Determine invitationId and workspaceId based on context
                const workspaceId = data.workspace ? data.workspace.id : null;
                const invitationId = data.invitation_id || null;
                
                window.typingMetrics = new QuillTypingMetrics(this.quill, {
                    workspaceId: workspaceId,
                    invitationId: invitationId,
                    documentId: this.documentId,
                    endpoint: '/api/save-essay-metrics',
                    inviteToken: window.TOKEN || null  // token para autenticación del endpoint
                });

                // FIX CRÍTICO: attachListeners() NO es llamado por el constructor.
                // Sin esta línea, handleKeyDown() nunca se registra y activityByMinute
                // permanece {} vacío para siempre, dejando la gráfica sin datos.
                window.typingMetrics.attachListeners();
                
                window.typingMetrics.onActivityChange = (isActive) => {
                    const indicator = document.getElementById('typingIndicator');
                    if (indicator) {
                        indicator.style.display = isActive ? 'flex' : 'none';
                    }
                    // También actualizar el activity indicator del footer
                    const activityDot = document.getElementById('activityIndicator');
                    if (activityDot) {
                        activityDot.classList.toggle('active', isActive);
                    }
                };
            }

            // NEW: Hook into Pagination system for global text changes (all pages)
            if (window.quillPagination) {
                // Override or attach to the callback
                const originalOnChange = window.quillPagination.config.onTextChange;
                window.quillPagination.config.onTextChange = (content, source) => {
                    // Call original if exists
                    if (originalOnChange) originalOnChange(content, source);

                    // Trigger our auto-save logic
                    this.onTextChange(null, null, source); // We don't need delta/oldDelta for debounce check, just source
                };
                console.log('[InviteEditor] Hooked into QuillPagination onTextChange');
            } else {
                // Standard single-page listener
                this.quill.on('text-change', (delta, oldDelta, source) => {
                    this.onTextChange(delta, oldDelta, source);
                });
            }
            // Listen to cursor movement / selection changes to update status bar
            const editorContainer = document.querySelector('.editor-container');
            if (editorContainer) {
                editorContainer.addEventListener('click', () => this.updateStatusBarUI());
                editorContainer.addEventListener('keyup', (e) => {
                    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
                        this.updateStatusBarUI();
                    }
                });
            }

            // Initial status bar setup
            this.updateStatusBarUI();

            // Initial save to register open
            this.updateStatus('saved', 'Ready');
            this.documentLoaded = true;
        } catch (error) {
            console.error('[InviteEditor] Error loading document:', error);
            this.showNotification('Error loading document', 'error');
        }
    }

    /**
     * Handle text changes with debounce
     */
    onTextChange(delta, oldDelta, source) {
        if (source !== 'user' || this.isClosed) return;

        // Mark as actively typing
        this.markActivity();

        this.updateStatus('saving', 'Saving...');

        // Update words/chars immediately
        this.updateMetrics();

        // Debounce save
        clearTimeout(this.saveTimeout);
        this.saveTimeout = setTimeout(async () => {
            await this.saveDocument(true);
        }, 2000); // 2 second debounce

        // Schedule error detection
        clearTimeout(this.errorDetectionTimeout);
        this.errorDetectionTimeout = setTimeout(() => {
            this.triggerErrorDetection();
        }, this.ERROR_DETECTION_DEBOUNCE_MS);
    }

    /**
     * Mark user activity (typing) — shared by text-change and raw input listeners
     */
    markActivity() {
        this.isTyping = true;
        const timerCard = document.getElementById('timerCard');
        if (timerCard) timerCard.classList.add('timer-active');

        // Reset inactivity timer
        clearTimeout(this.inactivityTimeout);
        this.inactivityTimeout = setTimeout(() => {
            this.isTyping = false;
            if (timerCard) timerCard.classList.remove('timer-active');
        }, this.IDLE_THRESHOLD_MS);
    }

    /**
     * Setup auto-save listener (Legacy/Single Page)
     */
    setupAutoSave() {
        console.log('[InviteEditor] Auto-save configured');
    }

    /**
     * Save document to server
     */
    async saveDocument(isAutosave = false) {
        if (this.isSaving || this.isClosed) return;

        this.isSaving = true;

        try {
            // Check for pagination system
            let delta, html;

            if (window.quillPagination) {
                // Use pagination system to get FULL content
                const exported = window.quillPagination.exportContent();
                delta = exported.delta;
                html = exported.html;
            } else {
                delta = this.quill.getContents();
                html = this.quill.root.innerHTML;
            }

            // Attach typing metrics inline (avoids the double-write race condition)
            let metricsPayload = null;
            if (window.typingMetrics) {
                metricsPayload = window.typingMetrics.getMetrics();
            }

            const body = {
                delta: delta,
                html: html,
                is_autosave: isAutosave
            };
            
            if (metricsPayload) {
                body.metrics = metricsPayload;
            }

            const response = await fetch(`/invite/${this.token}/document`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });

            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Save failed');
            }

            // Update status
            const statusText = isAutosave ? 'Auto-saved' : 'Saved';
            this.updateStatus('saved', statusText);

            // Record this save in local history
            this.recordSaveEntry(isAutosave);

            if (!isAutosave) {
                this.showNotification('Document saved successfully', 'success');
            }

            console.log('[InviteEditor] Document saved (metrics included inline)');

        } catch (error) {
            console.error('[InviteEditor] Save error:', error);
            this.updateStatus('error', 'Error saving');

            if (!isAutosave) {
                this.showNotification(error.message, 'error');
            }
        } finally {
            this.isSaving = false;
        }
    }

    /**
     * Setup image upload handler
     */
    setupImageUpload() {
        const toolbar = this.quill.getModule('toolbar');
        if (!toolbar) return;

        toolbar.addHandler('image', () => {
            if (this.isClosed) {
                this.showNotification('This document is closed', 'warning');
                return;
            }

            const input = document.createElement('input');
            input.setAttribute('type', 'file');
            input.setAttribute('accept', 'image/png, image/jpeg, image/jpg, image/gif, image/webp');
            input.click();

            input.onchange = async () => {
                const file = input.files[0];
                if (!file) return;

                await this.uploadImage(file);
            };
        });

        console.log('[InviteEditor] Image upload handler configured');
    }

    /**
     * Upload image to server
     */
    async uploadImage(file) {
        // Validate file size (max 5MB)
        if (file.size > 5 * 1024 * 1024) {
            this.showNotification('Image too large (max 5MB)', 'error');
            return;
        }

        try {
            this.showNotification('Uploading image...', 'info');

            const formData = new FormData();
            formData.append('file', file);
            formData.append('type', 'image');

            // Use upload endpoint
            const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');

            const response = await fetch('/upload_bp/api/image/upload', {
                method: 'POST',
                headers: {
                    'X-CSRFToken': csrfToken
                },
                body: formData
            });

            if (!response.ok) {
                throw new Error('Error uploading image');
            }

            const data = await response.json();

            // Get image URL (from SeaweedFS or response)
            const imageUrl = data.url || data.file_url || '';

            if (!imageUrl) {
                throw new Error('No image URL returned');
            }

            // Determine which editor instance to insert into
            let targetQuill = this.quill;
            let range = targetQuill.getSelection(true);

            // If pagination exists, try to find focused editor
            if (window.quillPagination) {
                const focused = window.quillPagination.getFocusedQuill();
                if (focused) {
                    targetQuill = focused;
                    range = targetQuill.getSelection(true); // get range of focused editor
                    if (!range) range = { index: targetQuill.getLength(), length: 0 };
                }
            }

            // Insert image
            targetQuill.insertEmbed(range.index, 'image', imageUrl);
            targetQuill.setSelection(range.index + 1);

            this.showNotification('Image uploaded successfully', 'success');

            // Trigger auto-save
            // We force an update on the TARGET quill instance
            targetQuill.updateContents({ ops: [{ retain: range.index }, { insert: '\n' }] });

        } catch (error) {
            console.error('[InviteEditor] Image upload error:', error);
            this.showNotification('Error uploading image', 'error');
        }
    }

    /**
     * Setup metrics tracking
     */
    setupMetricsTracking() {
        // Load previously saved stats from localStorage
        this.loadStats();

        // Increment session count
        this.metrics.sessions += 1;

        // Initial metrics update (word count from loaded doc)
        this.updateMetrics();

        // Save updated stats
        this.saveStats();

        console.log('[InviteEditor] Metrics tracking configured, session:', this.metrics.sessions);
    }

    /**
     * Get full text from editor (supports pagination)
     */
    getFullText() {
        if (window.quillPagination) {
            try {
                const exported = window.quillPagination.exportContent();
                // Extract text from delta ops
                if (exported && exported.delta && exported.delta.ops) {
                    return exported.delta.ops
                        .filter(op => typeof op.insert === 'string')
                        .map(op => op.insert)
                        .join('');
                }
            } catch (e) {
                console.warn('[InviteEditor] Could not get paginated text, falling back');
            }
        }
        return this.quill.getText();
    }

    /**
     * Update metrics (word count, paragraphs, WPM)
     */
    updateMetrics() {
        const text = this.getFullText();
        const words = text.trim().split(/\s+/).filter(w => w.length > 0);
        const paragraphs = text.split('\n').filter(p => p.trim().length > 0);

        this.metrics.wordCount = words.length;
        this.metrics.paragraphCount = paragraphs.length;

        // Check word limit
        if (this.hasWordLimit && this.metrics.wordCount >= this.wordLimit) {
            if (!this.showedLimitWarning) {
                this.showWordLimitModal();
                this.showedLimitWarning = true;
            }
        } else {
            this.showedLimitWarning = false;
        }

        // Update UI
        this.updateMetricsUI();

        // Persist
        this.saveStats();
    }

    /**
     * Update metrics in UI (stat cards + header elements)
     */
    updateMetricsUI() {
        // --- Header elements ---
        const headerWordCount = document.getElementById('wordCount');
        if (headerWordCount) headerWordCount.textContent = this.metrics.wordCount;

        const headerTimer = document.getElementById('timer');
        if (headerTimer) headerTimer.textContent = this.formatTime(this.metrics.activeTimeSeconds);

        // --- Stats panel cards ---
        const statWords = document.getElementById('statTotalWords');
        if (statWords) statWords.textContent = this.metrics.wordCount;

        const statTime = document.getElementById('statActiveTime');
        if (statTime) statTime.textContent = this.formatTime(this.metrics.activeTimeSeconds);

        // Calculate WPM (words per minute based on active time)
        const activeMinutes = this.metrics.activeTimeSeconds / 60;
        const wpm = activeMinutes > 0.5 ? Math.round(this.metrics.wordCount / activeMinutes) : 0;
        const statWPM = document.getElementById('statWPM');
        if (statWPM) statWPM.textContent = wpm;

        const statSpelling = document.getElementById('statSpellingErrors');
        if (statSpelling) statSpelling.textContent = this.metrics.spellingErrors;

        const statGrammar = document.getElementById('statGrammarErrors');
        if (statGrammar) statGrammar.textContent = this.metrics.grammarErrors;

        // --- Status Bar (#quillStatusBar) ---
        this.updateStatusBarUI();
    }

    /**
     * Updates the bottom status bar with granular metrics
     */
    updateStatusBarUI() {
        const text = this.getFullText() || '';
        
        // Update words
        const qsWords = document.getElementById('qsWords');
        if (qsWords) {
            const words = text.split(/\s+/).filter(w => w).length;
            qsWords.textContent = `${words} words`;
        }

        // Update characters (excluding trailing newline Quill adds)
        const qsChars = document.getElementById('qsChars');
        if (qsChars) {
            const charCount = text.endsWith('\n') ? Math.max(0, text.length - 1) : text.length;
            qsChars.textContent = `${charCount} chars`;
        }

        // Update lines
        const qsLines = document.getElementById('qsLines');
        if (qsLines) {
            const lines = text.split('\n').filter(l => l.length > 0).length || 1;
            qsLines.textContent = `${lines} lines`;
        }

        // Update pages
        const qsPage = document.getElementById('qsPage');
        if (qsPage) {
            if (window.quillPagination && window.quillPagination.pages) {
                const totalPages = window.quillPagination.pages.length;
                let activePageNum = 1;
                if (window.quillPagination.currentPageIndex !== undefined) {
                    activePageNum = window.quillPagination.currentPageIndex + 1;
                }
                qsPage.textContent = `Page ${activePageNum} of ${totalPages}`;
            } else {
                qsPage.textContent = `Page 1 of 1`;
            }
        }
        
        // Update cursor
        const qsCursor = document.getElementById('qsCursor');
        if (qsCursor) {
            let activeQuill = null;
            if (window.quillPagination) {
                activeQuill = window.quillPagination.getFocusedQuill();
            } else {
                activeQuill = this.quill;
            }
            
            if (!activeQuill) return;

            const range = activeQuill.getSelection();
            if (range) {
                const textUpToCursor = activeQuill.getText(0, range.index);
                const lines = textUpToCursor.split('\n');
                const row = lines.length;
                const col = lines[row - 1].length + 1;
                qsCursor.textContent = `Col ${col}, Row ${row}`;
            } else {
                qsCursor.textContent = `Col 1, Row 1`;
            }
        }
    }

    /**
     * Start activity tracking (1-second interval, only counts when typing)
     * Also hooks raw input listeners as backup for activity detection
     */
    startActivityTracking() {
        // 1-second interval that increments time only when isTyping
        this.activityInterval = setInterval(() => {
            if (this.isTyping) {
                this.metrics.activeTimeSeconds += 1;
                this.updateMetricsUI();

                // Save every 30 seconds while active
                if (this.metrics.activeTimeSeconds % 30 === 0) {
                    this.saveStats();
                }
            }
        }, 1000);

        // Backup: listen for raw input events on editor containers
        // This catches typing even if pagination's onTextChange doesn't fire
        const editorContainer = document.getElementById('editor-pages') || document.querySelector('.ql-editor');
        if (editorContainer) {
            editorContainer.addEventListener('keydown', (e) => {
                // Only content-modifying keys
                if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete' || e.key === 'Enter') {
                    this.markActivity();
                }
            });
            editorContainer.addEventListener('input', () => {
                this.markActivity();
            });
            console.log('[InviteEditor] Activity listeners attached to editor container');
        }

        console.log('[InviteEditor] Activity tracking started');
    }

    /**
     * Format time (seconds) to "Xh Ym" format
     */
    formatTime(totalSeconds) {
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        return `${hours}h ${minutes}m`;
    }

    /**
     * Save stats to localStorage
     */
    saveStats() {
        try {
            const data = {
                wordCount: this.metrics.wordCount,
                activeTimeSeconds: this.metrics.activeTimeSeconds,
                sessions: this.metrics.sessions,
                spellingErrors: this.metrics.spellingErrors,
                grammarErrors: this.metrics.grammarErrors,
                lastSaved: Date.now()
            };
            localStorage.setItem(this.statsKey, JSON.stringify(data));
        } catch (e) {
            console.warn('[InviteEditor] Could not save stats to localStorage:', e);
        }
    }

    /**
     * Load stats from localStorage
     */
    loadStats() {
        try {
            const raw = localStorage.getItem(this.statsKey);
            if (raw) {
                const data = JSON.parse(raw);
                this.metrics.activeTimeSeconds = data.activeTimeSeconds || 0;
                this.metrics.sessions = data.sessions || 0;
                this.metrics.spellingErrors = data.spellingErrors || 0;
                this.metrics.grammarErrors = data.grammarErrors || 0;
                console.log('[InviteEditor] Loaded persisted stats:', data);
            }
        } catch (e) {
            console.warn('[InviteEditor] Could not load stats from localStorage:', e);
        }
    }

    /**
     * Trigger spelling/grammar error detection via AI assistant endpoint
     */
    async triggerErrorDetection() {
        const text = this.getFullText().trim();
        if (text.length < 20) {
            this.metrics.spellingErrors = 0;
            this.metrics.grammarErrors = 0;
            this.updateMetricsUI();
            this.saveStats();
            return;
        }

        try {
            // Use a basic client-side approach: count misspelled words
            // by checking against common patterns
            let spellingCount = 0;
            let grammarCount = 0;

            // Simple heuristic checks:
            const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);

            for (const sentence of sentences) {
                const trimmed = sentence.trim();
                if (trimmed.length === 0) continue;

                // Grammar: sentence doesn't start with uppercase
                if (trimmed[0] !== trimmed[0].toUpperCase()) {
                    grammarCount++;
                }

                // Grammar: double spaces
                const doubleSpaces = (trimmed.match(/  +/g) || []).length;
                grammarCount += doubleSpaces;
            }

            // Spelling: repeated letters (3+) indicate possible typos
            const words = text.split(/\s+/).filter(w => w.length > 0);
            for (const word of words) {
                const cleanWord = word.replace(/[^a-zA-ZáéíóúñüÁÉÍÓÚÑÜ]/g, '');
                if (cleanWord.length === 0) continue;

                // Check for triple+ repeated letters
                if (/(.)(\1{2,})/.test(cleanWord)) {
                    spellingCount++;
                }

                // Check for uncommon letter combinations (basic heuristic)
                if (/[^aeiouáéíóúü]{5,}/i.test(cleanWord) && cleanWord.length > 3) {
                    spellingCount++;
                }
            }

            this.metrics.spellingErrors = spellingCount;
            this.metrics.grammarErrors = grammarCount;
            this.updateMetricsUI();
            this.saveStats();

            console.log('[InviteEditor] Error detection complete - spelling:', spellingCount, 'grammar:', grammarCount);

        } catch (error) {
            console.warn('[InviteEditor] Error detection failed:', error);
        }
    }

    /**
     * Load version history from localStorage + server
     */
    async loadVersionHistory() {
        // Load local save history
        const localHistory = this.getSaveHistory();

        // Also try to load server versions if document exists
        let serverVersions = [];
        if (this.documentId) {
            try {
                const response = await fetch(`/api/document/${this.documentId}/versions`);
                if (response.ok) {
                    const data = await response.json();
                    serverVersions = data.versions || [];
                }
            } catch (error) {
                console.warn('[InviteEditor] Could not load server versions:', error);
            }
        }

        // Merge: use local history (richer data) with server versions as fallback
        this.renderVersionHistory(localHistory, serverVersions);
    }

    /**
     * Get save history from localStorage
     */
    getSaveHistory() {
        try {
            const raw = localStorage.getItem(`invite_saves_${this.token}`);
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            return [];
        }
    }

    /**
     * Read active time seconds from all available sources
     * Priority: marktrack-script3 state > DOM #timer > own metrics
     */
    getActiveTimeSeconds() {
        // 1. Try marktrack-script3 state (most accurate — runs every 1s unconditionally)
        try {
            if (window.MarkTrack && window.MarkTrack.state && window.MarkTrack.state.activeTime > 0) {
                return Math.floor(window.MarkTrack.state.activeTime / 1000);
            }
        } catch(e) {}

        // 2. Parse the #timer DOM element: format is "Xh Ym"
        try {
            const timerEl = document.getElementById('timer');
            if (timerEl && timerEl.textContent) {
                const match = timerEl.textContent.match(/(\d+)h\s*(\d+)m/);
                if (match) {
                    const h = parseInt(match[1], 10);
                    const m = parseInt(match[2], 10);
                    const secs = h * 3600 + m * 60;
                    if (secs > 0) return secs;
                }
            }
        } catch(e) {}

        // 3. Fallback to own tracker
        return this.metrics.activeTimeSeconds;
    }

    /**
     * Record a save entry in localStorage
     */
    recordSaveEntry(isAutosave) {
        try {
            const history = this.getSaveHistory();
            const entry = {
                timestamp: Date.now(),
                type: isAutosave ? 'auto' : 'manual',
                wordCount: this.metrics.wordCount,
                activeTimeSeconds: this.getActiveTimeSeconds()   // ← use unified source
            };

            history.unshift(entry); // newest first

            // Keep max 50 entries
            if (history.length > 50) history.length = 50;

            localStorage.setItem(`invite_saves_${this.token}`, JSON.stringify(history));
        } catch (e) {
            console.warn('[InviteEditor] Could not record save entry:', e);
        }
    }

    /**
     * Render version history in UI
     */
    renderVersionHistory(localHistory, serverVersions) {
        const panel = document.querySelector('#versionHistory');
        if (!panel) return;

        // Build entries from local history
        const entries = localHistory.map(entry => {
            const date = new Date(entry.timestamp);
            const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const dateStr = this.formatDateShort(date);
            const investedTime = this.formatTime(entry.activeTimeSeconds || 0);
            const typeLabel = entry.type === 'manual' ? 'Manual Save' : 'Auto-saved';
            const typeIcon = entry.type === 'manual' ? 'bi-save' : 'bi-arrow-repeat';

            return `
                <div class="version-entry">
                    <div class="version-entry-header">
                        <span class="version-entry-type">
                            <i class="bi ${typeIcon}"></i> ${typeLabel}
                        </span>
                    </div>
                    <div class="version-entry-details">
                        <div class="version-detail">
                            <i class="bi bi-calendar3"></i>
                            <span>${dateStr}</span>
                        </div>
                        <div class="version-detail">
                            <i class="bi bi-clock"></i>
                            <span>${timeStr}</span>
                        </div>
                        <div class="version-detail">
                            <i class="bi bi-hourglass-split"></i>
                            <span>${investedTime}</span>
                        </div>
                        <div class="version-detail">
                            <i class="bi bi-file-word"></i>
                            <span>${entry.wordCount || 0} words</span>
                        </div>
                    </div>
                </div>
            `;
        });

        if (entries.length === 0) {
            panel.innerHTML = `
                <div class="version-empty">
                    <i class="bi bi-clock-history" style="font-size: 1.5rem; opacity: 0.4;"></i>
                    <p>No saved versions yet</p>
                    <span>Versions will appear here as you write</span>
                </div>
            `;
            return;
        }

        panel.innerHTML = entries.join('');
    }

    /**
     * Format date to short readable format (e.g. "Feb 13, 2026")
     */
    formatDateShort(date) {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
    }

    /**
     * Format bytes to human readable
     */
    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }

    /**
     * Setup manual save button
     */
    setupManualSave() {
        const saveBtn = document.querySelector('#saveDraftBtn');
        if (!saveBtn) return;

        saveBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            if (this.isClosed) {
                this.showNotification('This document is closed', 'warning');
                return;
            }

            await this.showSaveModal();
        });

        console.log('[InviteEditor] Manual save button configured');
    }

    /**
     * Show professional save modal
     */
    async showSaveModal() {
        // Create modal if it doesn't exist
        let modal = document.querySelector('#saveProgressModal');
        if (!modal) {
            modal = this.createSaveModal();
            document.body.appendChild(modal);
        }

        modal.style.display = 'flex';

        try {
            // Step 1: Saving content
            this.updateModalStep(1, 'Saving content...');
            await this.saveDocument(false);
            await this.delay(500);

            // Step 2: Processing images (simulated)
            this.updateModalStep(2, 'Processing images...');
            await this.delay(700);

            // Step 3: Finalizing
            this.updateModalStep(3, 'Finalizing...');
            await this.delay(500);

            // Success
            this.updateModalStep(4, '✓ Saved successfully');
            await this.delay(1000);

            modal.style.display = 'none';

        } catch (error) {
            this.updateModalStep(-1, '✗ Error saving');
            await this.delay(2000);
            modal.style.display = 'none';
        }
    }

    /**
     * Create save modal element
     */
    createSaveModal() {
        const modal = document.createElement('div');
        modal.id = 'saveProgressModal';
        modal.style.cssText = `
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            z-index: 10000;
            align-items: center;
            justify-content: center;
        `;

        modal.innerHTML = `
            <div style="background: white; padding: 2rem; border-radius: 12px; min-width: 300px; text-align: center;">
                <div class="loading" style="margin: 0 auto 1rem;"></div>
                <p id="saveModalText" style="font-size: 1rem; color: #333; margin: 0;">Starting...</p>
            </div>
        `;

        return modal;
    }

    /**
     * Update save modal step
     */
    updateModalStep(step, text) {
        const textEl = document.querySelector('#saveModalText');
        if (textEl) {
            textEl.textContent = text;
        }
    }

    /**
     * Delay helper
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Update status indicator
     */
    updateStatus(status, text) {
        const statusDot = document.querySelector('#statusDot');
        const statusText = document.querySelector('#statusText');

        if (statusDot) {
            statusDot.className = `status-dot status-${status}`;
        }

        if (statusText) {
            statusText.textContent = text;
            if (status === 'saved') {
                statusText.textContent += ' - ' + new Date().toLocaleTimeString();
            }
        }
    }

    /**
     * Show notification
     */
    showNotification(message, type = 'info') {
        // Try to find existing notification system
        let notification = document.querySelector('#notification');

        if (!notification) {
            // Create notification element
            notification = document.createElement('div');
            notification.id = 'notification';
            notification.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                padding: 1rem 1.5rem;
                border-radius: 8px;
                color: white;
                z-index: 9999;
                transform: translateX(400px);
                transition: transform 0.3s ease;
                max-width: 300px;
            `;
            document.body.appendChild(notification);
        }

        // Set color based on type
        const colors = {
            success: '#28a745',
            error: '#dc3545',
            warning: '#ffc107',
            info: '#17a2b8'
        };

        notification.style.background = colors[type] || colors.info;
        notification.textContent = message;
        notification.style.transform = 'translateX(0)';

        // Hide after 4 seconds
        setTimeout(() => {
            notification.style.transform = 'translateX(400px)';
        }, 4000);
    }

    /**
     * Cleanup
     */
    destroy() {
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
        }

        if (this.activityInterval) {
            clearInterval(this.activityInterval);
        }

        if (this.inactivityTimeout) {
            clearTimeout(this.inactivityTimeout);
        }

        if (this.errorDetectionTimeout) {
            clearTimeout(this.errorDetectionTimeout);
        }

        // Save final stats before destroying
        this.saveStats();

        console.log('[InviteEditor] Integration destroyed');
    }

    /**
     * Show word limit modal
     */
    showWordLimitModal() {
        // Create modal if it doesn't exist
        let modal = document.querySelector('#wordLimitModal');
        if (!modal) {
            modal = this.createWordLimitModal();
            document.body.appendChild(modal);
        }

        // Update word count in modal
        const countEl = modal.querySelector('#modalWordCount');
        if (countEl) {
            countEl.textContent = this.metrics.wordCount;
        }

        const limitEl = modal.querySelector('#modalWordLimit');
        if (limitEl) {
            limitEl.textContent = this.wordLimit;
        }

        // Show modal with animation
        modal.style.display = 'flex';
        setTimeout(() => modal.classList.add('active'), 10);
    }

    /**
     * Create word limit modal
     */
    createWordLimitModal() {
        const modal = document.createElement('div');
        modal.id = 'wordLimitModal';
        modal.className = 'word-limit-modal';

        modal.innerHTML = `
            <div class="word-limit-overlay"></div>
            <div class="word-limit-content">
                <div class="word-limit-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"></path>
                        <line x1="12" y1="9" x2="12" y2="13"></line>
                        <line x1="12" y1="17" x2="12.01" y2="17"></line>
                    </svg>
                </div>
                <h2 class="word-limit-title">Word Limit Reached</h2>
                <p class="word-limit-message">
                    You have reached the limit of <strong id="modalWordLimit">${this.wordLimit}</strong> words.
                </p>
                <p class="word-limit-current">
                    Current words: <strong id="modalWordCount">${this.metrics.wordCount}</strong>
                </p>
                <button class="word-limit-btn" onclick="this.closest('.word-limit-modal').classList.remove('active'); setTimeout(() => this.closest('.word-limit-modal').style.display = 'none', 300);">
                    Got it
                </button>
            </div>
        `;

        // Add styles
        const style = document.createElement('style');
        style.textContent = `
            .word-limit-modal {
                display: none;
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                z-index: 10001;
                align-items: center;
                justify-content: center;
            }
            
            .word-limit-modal.active .word-limit-overlay {
                opacity: 1;
            }
            
            .word-limit-modal.active .word-limit-content {
                transform: scale(1);
                opacity: 1;
            }
            
            .word-limit-overlay {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.6);
                backdrop-filter: blur(4px);
                opacity: 0;
                transition: opacity 0.3s ease;
            }
            
            .word-limit-content {
                position: relative;
                background: white;
                border-radius: 16px;
                padding: 2.5rem 2rem;
                max-width: 450px;
                width: 90%;
                text-align: center;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
                transform: scale(0.9);
                opacity: 0;
                transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
            }
            
            .word-limit-icon {
                width: 80px;
                height: 80px;
                margin: 0 auto 1.5rem;
                background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                animation: pulse 2s ease-in-out infinite;
            }
            
            @keyframes pulse {
                0%, 100% {
                    transform: scale(1);
                    box-shadow: 0 0 0 0 rgba(251, 191, 36, 0.4);
                }
                50% {
                    transform: scale(1.05);
                    box-shadow: 0 0 0 15px rgba(251, 191, 36, 0);
                }
            }
            
            .word-limit-icon svg {
                width: 40px;
                height: 40px;
                color: white;
            }
            
            .word-limit-title {
                font-size: 1.5rem;
                font-weight: 700;
                color: #1e293b;
                margin: 0 0 1rem;
            }
            
            .word-limit-message {
                font-size: 1rem;
                color: #64748b;
                line-height: 1.6;
                margin: 0 0 0.5rem;
            }
            
            .word-limit-current {
                font-size: 0.975rem;
                color: #94a3b8;
                margin: 0 0 2rem;
            }
            
            .word-limit-current strong,
            .word-limit-message strong {
                color: #f59e0b;
                font-weight: 600;
            }
            
            .word-limit-btn {
                background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
                color: white;
                border: none;
                padding: 0.875rem 2.5rem;
                border-radius: 12px;
                font-size: 1rem;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.3s ease;
                box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
            }
            
            .word-limit-btn:hover {
                transform: translateY(-2px);
                box-shadow: 0 6px 20px rgba(59, 130, 246, 0.4);
            }
            
            .word-limit-btn:active {
                transform: translateY(0);
            }
            
            [data-theme="dark"] .word-limit-content {
                background: #1e293b;
            }
            
            [data-theme="dark"] .word-limit-title {
                color: #f1f5f9;
            }
            
            [data-theme="dark"] .word-limit-message {
                color: #cbd5e1;
            }
            
            [data-theme="dark"] .word-limit-current {
                color: #94a3b8;
            }
        `;
        document.head.appendChild(style);

        return modal;
    }
}

// Export for use in invite.html
window.InviteEditorIntegration = InviteEditorIntegration;
