class QuillTypingMetrics {
    constructor(quillOrPagination, options = {}) {
        // Accept either a QuillPagination instance or a bare Quill instance
        if (quillOrPagination && typeof quillOrPagination.exportContent === 'function') {
            this.quillPagination = quillOrPagination;
            this.quill           = quillOrPagination.quill;
        } else {
            this.quillPagination = null;
            this.quill           = quillOrPagination;
        }

        this.options = Object.assign({
            maxLogs: 200,           // Only audit events — max 200 entries (~5KB)
            pauseThresholdMs: 5000,
            endpoint: '/api/save-essay-metrics', // Legacy: metrics now travel with PUT /invite/:token/document
            workspaceId: null,
            invitationId: null,
            documentId: null,
            inviteToken: window.TOKEN || null   // token-based auth
        }, options);

        this.storageKey = `tm_metrics_${this.options.inviteToken || 'default'}`;
        
        this.startTime = performance.now();
        this.timeOffsetMs = 0; // Cumulative time from previous sessions
        this.isActive = true;
        this.lastActiveTime = this.startTime;
        this.isTypingSequence = false;
        
        this.reset();
        this.loadFromLocal(); // Load previously saved counters and calculate offset
        
        // Merge initial metrics from server if provided (optional)
        if (options.initialMetrics) {
            this._mergeInitialMetrics(options.initialMetrics);
        }
        
        // Polling loop to check for pauses over 5 seconds
        this.pauseChecker = setInterval(() => this.checkPause(), 1000);
        
        // Auto-save metrics to local storage every 5 seconds
        this.localSaveInterval = setInterval(() => this.saveToLocal(), 5000);
    }

    reset() {
        this.metrics = {
            totalKeystrokes: 0,
            backspacesCount: 0,
            longPausesCount: 0,
            mediumPausesCount: 0,
            effectiveTypingMs: 0,
            totalHoldTimeMs: 0,
            totalInterKeyMs: 0,
            totalInterKeyEvents: 0,
            approxWPM: 0,
            pasteCount: 0,
            largeDeletionsCount: 0,
            totalFocusTimeMs: 0,
            longestBurst: 0,         // in characters
            activityByMinute: {},    // minute -> keystroke count
        };
        this.rawLogs = [];
        this.keyTracker = new Map(); 
        this.lastKeyDownTime = null;
        this.activeSessionStart = performance.now();
        this.startTime = performance.now();
        this.focusStartTime = performance.now();
        this.currentBurstLength = 0;
        
        // For UI Sync
        this.onActivityChange = null;
        this.onTimerUpdate = null; // for MM:SS timer
    }

    saveToLocal() {
        try {
            const data = {
                metrics: this.metrics,
                // We don't save rawLogs to local storage to avoid quota issues, 
                // but we save the core counters.
                savedAt: Date.now()
            };
            localStorage.setItem(this.storageKey, JSON.stringify(data));
        } catch (e) {
            console.warn('[TypingMetrics] Failed to save to localStorage', e);
        }
    }

    loadFromLocal() {
        try {
            const raw = localStorage.getItem(this.storageKey);
            if (raw) {
                const data = JSON.parse(raw);
                
                // TTL: expire localStorage data older than 72 hours
                const MAX_AGE_MS = 72 * 60 * 60 * 1000;
                if (data.savedAt && (Date.now() - data.savedAt) > MAX_AGE_MS) {
                    localStorage.removeItem(this.storageKey);
                    console.log('[TypingMetrics] localStorage data expired (>72h), cleared.');
                    return;
                }
                
                if (data.metrics) {
                    // Restore metrics, keeping what we already have if newer
                    // Preserve activityByMinute keys (they are now relative, safe to merge)
                    const incoming = data.metrics;
                    Object.assign(this.metrics, incoming);
                    
                    // Calculate time offset: if we have totalTimeSeconds from before, 
                    // we want the new session's "Minute 0" to actually be "Minute N"
                    if (incoming.totalTimeSeconds) {
                        this.timeOffsetMs = incoming.totalTimeSeconds * 1000;
                    }
                    console.log('[TypingMetrics] Restored counters. Offset:', Math.round(this.timeOffsetMs/1000), 's');
                }
                this._isFromLocal = true; // Flag to indicate we have local state
            }
        } catch (e) {
            console.warn('[TypingMetrics] Failed to load from localStorage', e);
        }
    }

    _mergeInitialMetrics(initial) {
        // If we already loaded from local storage and it's newer/exists, we might want to skip.
        // But for consistency across devices, we use a basic "take the larger value" approach
        // for cumulative counters if local state exists.
        
        console.log('[TypingMetrics] Merging initial metrics from server');
        
        // Map of server-side/display keys to internal metric names
        const fieldMap = {
            'total_keystrokes': 'totalKeystrokes',
            'keystrokes':       'totalKeystrokes',
            'backspaces':       'backspacesCount',
            'long_pauses':      'longPausesCount',
            'effective_time_seconds': 'effectiveTypingSeconds', // will be converted to Ms
            'total_time_seconds': 'totalTimeSeconds',
            'wpm':              'approxWPM',
            'paste_events':     'pasteCount',
            'large_deletions':  'largeDeletionsCount',
            'longest_burst':    'longestBurst',
            'activity_by_minute': 'activityByMinute'
        };

        for (const [serverKey, internalKey] of Object.entries(fieldMap)) {
            let val = initial[serverKey];
            if (val === undefined || val === null) continue;

            // Handle numeric values
            if (typeof val === 'number') {
                if (internalKey === 'effectiveTypingSeconds') {
                    const ms = val * 1000;
                    this.metrics.effectiveTypingMs = Math.max(this.metrics.effectiveTypingMs, ms);
                } else if (internalKey === 'totalTimeSeconds') {
                    this.timeOffsetMs = Math.max(this.timeOffsetMs, val * 1000);
                } else if (typeof this.metrics[internalKey] === 'number') {
                    this.metrics[internalKey] = Math.max(this.metrics[internalKey], val);
                }
            } 
            // Handle activityByMinute (object merge)
            else if (internalKey === 'activityByMinute' && typeof val === 'object') {
                for (const [min, count] of Object.entries(val)) {
                    this.metrics.activityByMinute[min] = Math.max(this.metrics.activityByMinute[min] || 0, count);
                }
            }
        }
    }

    attachListeners() {
        // Use capture phase and check for ql-editor to be sure we catch events in pagination pages
        document.addEventListener('keydown', (e) => {
            if (e.target.closest('.ql-editor')) this.handleKeyDown(e);
        }, true);

        document.addEventListener('keyup', (e) => {
            if (e.target.closest('.ql-editor')) this.handleKeyUp(e);
        }, true);

        document.addEventListener('paste', (e) => {
            if (e.target.closest('.ql-editor')) this.handlePaste(e);
        }, true);

        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.logEvent('visibility-hidden');
                this.handlePause();
                // Update focus time
                if (this.focusStartTime) {
                    this.metrics.totalFocusTimeMs += (performance.now() - this.focusStartTime);
                    this.focusStartTime = null;
                }
                this.saveToLocal();
            } else {
                this.logEvent('visibility-visible');
                this.focusStartTime = performance.now();
                this.resumeActivity();
            }
        });

        // Optional: Listen to Quill text-change for large deletions
        if (this.quill) {
            this.quill.on('text-change', (delta, oldDelta, source) => {
                if (source === 'user') {
                    delta.forEach(op => {
                        if (op.delete && op.delete > 10) {
                            this.metrics.largeDeletionsCount++;
                            this.logEvent('large-deletion', { length: op.delete });
                        }
                    });
                }
            });
        }
    }

    markActive() {
        const now = performance.now();
        
        if (!this.isActive) {
            this.resumeActivity();
        }
        
        this.lastActiveTime = now;
        
        // Notify UI
        if (!this.isTypingSequence && this.onActivityChange) {
            this.isTypingSequence = true;
            this.onActivityChange(true);
        }
    }

    checkPause() {
        if (!this.isActive || document.hidden) return;
        
        const now = performance.now();
        const diff = now - this.lastActiveTime;

        if (diff > this.options.pauseThresholdMs) {
            this.handlePause('long');
        } else if (diff > 1000) {
            this.handlePause('medium');
        }
    }

    handlePause(type = 'long') {
        if (!this.isActive) return;
        
        const now = performance.now();
        this.isActive = false;

        if (type === 'long') {
            this.metrics.longPausesCount++;
        } else {
            this.metrics.mediumPausesCount++;
        }

        // Finish current burst
        if (this.currentBurstLength > this.metrics.longestBurst) {
            this.metrics.longestBurst = this.currentBurstLength;
        }
        this.currentBurstLength = 0;
        
        // Log explicitly using lastActiveTime so exact pause start is tracked
        const sessionDuration = this.lastActiveTime - this.activeSessionStart;
        if (sessionDuration > 0) {
            this.metrics.effectiveTypingMs += sessionDuration;
        }

        this.logEvent('pause', { type: type, start: this.lastActiveTime, duration: now - this.lastActiveTime });
        
        if (this.isTypingSequence && this.onActivityChange) {
            this.isTypingSequence = false;
            this.onActivityChange(false);
        }
        
        this.saveToLocal();
    }

    resumeActivity() {
        if (this.isActive) return;
        this.isActive = true;
        this.activeSessionStart = performance.now();
        this.lastActiveTime = this.activeSessionStart;
        this.logEvent('resume');
        
        if (!this.isTypingSequence && this.onActivityChange) {
            this.isTypingSequence = true;
            this.onActivityChange(true);
        }
    }

    handleKeyDown(e) {
        this.markActive();
        const now = performance.now();
        this.metrics.totalKeystrokes++;

        // Burst tracking
        if (e.key.length === 1 || e.key === 'Enter') {
            this.currentBurstLength++;
        }

        // Minute tracking: use relative time (minutes since page load) as key → 0, 1, 2, 3...
        // BUG FIX: Previously used Date.now()/60000 → absolute UNIX minutes (~29M) which caused
        // workspace.html to iterate 30 million times in the chart loop, CRASHING the browser.
        // Minute tracking: use relative time (minutes since initial start) as key → 0, 1, 2, 3...
        const elapsedMs = (performance.now() - this.startTime) + (this.timeOffsetMs || 0);
        const minuteKey = Math.floor(elapsedMs / 60000);
        this.metrics.activityByMinute[minuteKey] = (this.metrics.activityByMinute[minuteKey] || 0) + 1;

        if (e.key === 'Backspace' || e.key === 'Delete') {
            this.metrics.backspacesCount++;
        }

        // Avoid repeated keydown events if holding the key
        if (!e.repeat && !this.keyTracker.has(e.code)) {
            this.keyTracker.set(e.code, now);
        }
        
        if (this.lastKeyDownTime !== null) {
            const timeSinceLastKey = now - this.lastKeyDownTime;
            if (timeSinceLastKey > 0 && timeSinceLastKey < 2000) { // Reject anomalies
                this.metrics.totalInterKeyMs += timeSinceLastKey;
                this.metrics.totalInterKeyEvents++;
            }
        }
        
        this.lastKeyDownTime = now;
        // NOTE: keydown events are NOT logged — they are high-frequency and not useful for audit.
        // Only audit events (pause, paste, visibility, large-deletion) are stored in rawLogs.
    }

    handleKeyUp(e) {
        this.markActive();
        const now = performance.now();
        
        if (this.keyTracker.has(e.code)) {
            const holdTime = now - this.keyTracker.get(e.code);
            if (holdTime > 0 && holdTime < 5000) { // Reject anomaly holds over 5s
                this.metrics.totalHoldTimeMs += holdTime;
            }
            this.keyTracker.delete(e.code);
        }
        // NOTE: keyup events are NOT logged — high-frequency, not needed for audit.
    }

    handlePaste(e) {
        this.markActive();
        this.metrics.pasteCount++;
        let pasteLength = 0;
        if (e.clipboardData && e.clipboardData.getData) {
            const text = e.clipboardData.getData('text/plain');
            pasteLength = text.length;
        }
        this.logEvent('paste', { length: pasteLength });
        this.saveToLocal();
    }

    logEvent(type, details = {}) {
        // AUDIT FILTER: Only store events that are meaningful for integrity review.
        // Skipping keydown/keyup events (~99% of volume) reduces storage ~90%.
        const AUDIT_EVENTS = ['pause', 'paste', 'visibility-hidden', 'visibility-visible',
                              'large-deletion', 'resume'];
        if (!AUDIT_EVENTS.includes(type)) return;
        
        if (this.rawLogs.length >= this.options.maxLogs) {
            // Keep the most recent 150 entries when limit (200) is reached
            this.rawLogs = this.rawLogs.slice(-150);
        }
        
        this.rawLogs.push({
            t: type,
            ms: Math.round(performance.now() - this.startTime),
            ...details
        });
    }

    getMetrics() {
        // Force wrap up current session
        if (this.isActive) {
            const sessionDuration = performance.now() - this.activeSessionStart;
            this.metrics.effectiveTypingMs += Math.max(0, sessionDuration);
            // reset start to now so it doesn't double count if getMetrics is called again
            this.activeSessionStart = performance.now(); 
        }

        const effectiveSeconds = Math.round(this.metrics.effectiveTypingMs / 1000);
        const totalSeconds = Math.round((performance.now() - this.startTime) / 1000);
        
        // Approx: 1 word = 5 chars. WPM = (Total chars / 5) / (effective minutes)
        // using total keystrokes as a proxy for physical effort
        const words = this.metrics.totalKeystrokes / 5;
        const effectiveMinutes = effectiveSeconds / 60;
        const wpm = (effectiveMinutes > 0) ? Math.round(words / effectiveMinutes) : 0;

        const avgHoldTimeMs = this.metrics.totalKeystrokes > 0 ? 
                              (this.metrics.totalHoldTimeMs / this.metrics.totalKeystrokes) : 0;
                              
        const avgInterKeyMs = this.metrics.totalInterKeyEvents > 0 ? 
                              (this.metrics.totalInterKeyMs / this.metrics.totalInterKeyEvents) : 0;

        const totalFocusSeconds = Math.round((this.metrics.totalFocusTimeMs + (this.focusStartTime ? performance.now() - this.focusStartTime : 0)) / 1000);

        return {
            totalTimeSeconds: totalSeconds,
            effectiveTypingSeconds: effectiveSeconds,
            totalFocusSeconds: totalFocusSeconds,
            totalKeystrokes: this.metrics.totalKeystrokes,
            backspacesCount: this.metrics.backspacesCount,
            longPausesCount: this.metrics.longPausesCount,
            mediumPausesCount: this.metrics.mediumPausesCount,
            avgHoldTimeMs: Math.round(avgHoldTimeMs),
            avgInterKeyMs: Math.round(avgInterKeyMs),
            approxWPM: wpm,
            pasteCount: this.metrics.pasteCount,
            largeDeletionsCount: this.metrics.largeDeletionsCount,
            longestBurst: this.metrics.longestBurst,
            activityByMinute: this.metrics.activityByMinute,
            rawLogs: this.rawLogs
        };
    }

    async sendToServer(signatureData = null, isFinal = false) {
        const metricsData = this.getMetrics();

        // Use ALL pages' content when pagination is available (FIX #5)
        let finalText, quillDelta;
        if (this.quillPagination) {
            try {
                const exp = this.quillPagination.exportContent();
                finalText  = exp.text;
                quillDelta = exp.delta;
            } catch (_) {
                finalText  = this.quill ? this.quill.getText()       : '';
                quillDelta = this.quill ? this.quill.getContents()   : {};
            }
        } else {
            finalText  = this.quill ? this.quill.getText()     : '';
            quillDelta = this.quill ? this.quill.getContents() : {};
        }

        const payload = {
            invite_token:   this.options.inviteToken || window.TOKEN,
            workspace_id:   this.options.workspaceId,
            invitation_id:  this.options.invitationId,
            document_id:    this.options.documentId,
            metrics:        metricsData,
            final_text:     finalText,
            quill_delta:    quillDelta,
            signature_data: signatureData,
            is_final:       isFinal
        };

        try {
            const response = await fetch(this.options.endpoint, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify(payload)
            });
            const result = await response.json();
            if (result.success) {
                console.log('[TypingMetrics] Stored successfully.', result.submission_id);
                // Clear local storage on final submission
                if (isFinal) localStorage.removeItem(this.storageKey);
                return result;
            } else {
                console.error('[TypingMetrics] Failed:', result.error);
                return false;
            }
        } catch (error) {
            console.error('[TypingMetrics] Network error:', error);
            return false;
        }
    }
}

// Explicitly expose to window for cross-script access
window.QuillTypingMetrics = QuillTypingMetrics;

