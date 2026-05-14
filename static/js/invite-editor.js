/**
 * ============================================================
 * invite-editor.js  — Consolidated editor module for MarkTrack
 * Replaces: invite-inline.js + invite-editor-integration.js
 * ============================================================
 *
 * Responsibilities:
 *  1. Registration overlay handling
 *  2. Document load / auto-save (full multipágina delta)
 *  3. Image upload  (via server or base64 fallback)
 *  4. Keystroke + activity metrics
 *  5. Version-history UI
 *  6. Word-limit enforcement
 *  7. Status-bar updates
 *  8. Submit / signature flow glue
 *  9. Logout / save-and-exit modal
 * 10. Settings modal tabs / theme switching
 * 11. User dropdown
 * ============================================================
 */

// ─────────────────────────────────────────────────────────────
// 0. MODULE SCOPE  (TOKEN injected by invite.html before this script)
// ─────────────────────────────────────────────────────────────
(function (TOKEN) {
    'use strict';

    if (!TOKEN) {
        console.warn('[InviteEditor] No TOKEN found — editor disabled.');
        return;
    }

    // ──────────────────────────────────────────────────────────
    // STATE
    // ──────────────────────────────────────────────────────────
    let quillInstance = null;   // Single Quill (via QuillPagination)
    let pagination    = null;   // QuillPagination instance
    let documentId    = null;
    let workspaceId   = null;
    let invitationId  = null;
    let isClosed      = false;
    let hasWordLimit  = false;
    let wordLimit     = 0;
    let isSaving      = false;
    let saveTimeout   = null;
    let documentLoaded = false;

    // Metrics
    const statsKey  = `invite_stats_${TOKEN}`;
    const savesKey  = `invite_saves_${TOKEN}`;
    let metrics = { wordCount: 0, paragraphCount: 0, activeTimeSeconds: 0, sessions: 0,
                    spellingErrors: 0, grammarErrors: 0 };
    let isTyping = false;
    let inactivityTimeout = null;
    let activityInterval  = null;
    let errorTimeout      = null;
    let showedLimitWarning = false;

    // ──────────────────────────────────────────────────────────
    // 1. REGISTRATION OVERLAY
    // ──────────────────────────────────────────────────────────
    window.handleRegistration = function (e) {
        e.preventDefault();
        const firstName = (document.getElementById('firstName')?.value || '').trim();
        const lastName  = (document.getElementById('lastName')?.value  || '').trim();
        let valid = true;

        document.querySelectorAll('.form-error').forEach(el => el.style.display = 'none');
        document.querySelectorAll('.form-group input').forEach(el => el.classList.remove('error'));

        if (!firstName) {
            document.getElementById('firstNameError').style.display = 'block';
            document.getElementById('firstName').classList.add('error');
            valid = false;
        }
        if (!lastName) {
            document.getElementById('lastNameError').style.display = 'block';
            document.getElementById('lastName').classList.add('error');
            valid = false;
        }
        if (!valid) return;

        const btn = document.getElementById('registerBtn');
        btn.disabled    = true;
        btn.textContent = 'Registering...';

        fetch(`/invite/${TOKEN}/register`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ first_name: firstName, last_name: lastName }),
        })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                document.getElementById('registrationOverlay').style.display = 'none';
                document.getElementById('editorArea').style.display          = 'block';
                showToast('Registration successful! You may now begin writing.', 'success');
                _initEditorAfterVisible();
            } else {
                showToast(data.error || 'Registration failed. Please try again.', 'error');
                btn.disabled    = false;
                btn.textContent = 'Continue to assignment';
            }
        })
        .catch(() => {
            showToast('Connection error', 'error');
            btn.disabled    = false;
            btn.textContent = 'Continue to assignment';
        });
    };

    // ──────────────────────────────────────────────────────────
    // 2. QUILL / PAGINATION BOOTSTRAP
    // ──────────────────────────────────────────────────────────
    async function _initEditorAfterVisible() {
        // Now that marktrack-quill-bridge.js is removed, we MUST instantiate pagination here.
        if (typeof QuillPagination === 'undefined') {
             console.error('[InviteEditor] QuillPagination not found!');
             return;
        }

        console.log('[InviteEditor] Loading Quill modules...');
        let extraModules = {};
        let _toolbarHandlerFactories = {};
        try {
            const { getQuillModules } = await import('/static/js/quill-modules.js');
            const { registry, config, toolbarHandlerFactories } = await getQuillModules('invite');
            
            // Explicitly register each downloaded module namespace
            Object.entries(registry).forEach(([name, mod]) => {
                Quill.register(name, mod, true);
            });
            
            // Use the detailed config 
            extraModules = config;
            _toolbarHandlerFactories = toolbarHandlerFactories || {};
        } catch (err) {
            console.error('[InviteEditor] Failed to load extra modules', err);
        }

        console.log('[InviteEditor] Initializing QuillPagination...');
        pagination = new QuillPagination({
            container: '#editor-pages',
            pageWidth: '210mm',
            pageHeight: '297mm',
            pageMargin: '15mm',
            pagePadding: '15mm',
            theme: 'snow',
            placeholder: 'Start writing your assignment...',
            autoPageBreak: true,
            showPageNumbers: true,
            onTextChange: (content, source) => {
                if (source === 'user') _debouncedSave();
            },
            toolbar: '#custom-toolbar',
            quillModules: extraModules
        });

        quillInstance = pagination.quill || (pagination.pages[0] ? pagination.pages[0].quill : null);
        
        // Expose globally for any other scripts
        window.quillPagination = pagination;
        window.quill = quillInstance;
        
        // Initialize Floating Bubble Toolbar
        if (typeof QuillBubbleToolbar !== 'undefined') {
            new QuillBubbleToolbar(quillInstance);
            console.log('[InviteEditor] Floating Bubble Toolbar initialized');
        }

        // Store handler factories so _onQuillReady can apply them after init
        window._quillToolbarHandlerFactories = _toolbarHandlerFactories;

        _onQuillReady();
    }

    function _onQuillReady() {
        console.log('[InviteEditor] Quill ready, starting components...');
        _applyToolbarHandlers();
        _loadDocument();
        _setupAutoSave();
        _setupMetrics();
        _setupActivityTracking();
        _hookOnNewPage();
        _setupStatusBarUpdates();
        _setupFinalizeBtn();
        loadVersionHistory();
        loadStats();

        // ── Heartbeat ─────────────────────────────────────────────
        setInterval(() => {
            fetch('/api/cache/status').catch(() => {});
        }, 10000);
    }

    // ──────────────────────────────────────────────────────────
    // TOOLBAR HANDLERS — apply all handlers from quill-modules.js
    // ──────────────────────────────────────────────────────────
    function _applyToolbarHandlers() {
        if (!quillInstance) return;
        const toolbar = quillInstance.getModule('toolbar');
        if (!toolbar) return;

        const factories = window._quillToolbarHandlerFactories || {};
        Object.entries(factories).forEach(([handlerName, factory]) => {
            try {
                toolbar.addHandler(handlerName, factory(quillInstance));
                console.log(`[InviteEditor] Toolbar handler registered: ${handlerName}`);
            } catch (e) {
                console.warn(`[InviteEditor] Failed to register handler "${handlerName}":`, e.message);
            }
        });
    }

    // ──────────────────────────────────────────────────────────
    // 3. DOCUMENT LOAD
    // ──────────────────────────────────────────────────────────
    function _loadDocument() {
        if (documentLoaded) return;

        fetch(`/invite/${TOKEN}/document`)
        .then(r => r.json())
        .then(data => {
            if (!data.success) throw new Error(data.error || 'Load failed');

            isClosed     = data.is_closed || false;
            documentId   = data.document?.id   || null;
            workspaceId  = data.workspace?.id  || null;
            invitationId = data.invitation_id  || null;

            // Word limit
            if (data.workspace) {
                hasWordLimit = data.workspace.has_word_limit || false;
                wordLimit    = data.workspace.word_limit     || 0;
            }

            // Load content
            if (data.document) {
                const doc = data.document;
                const hasDelta = doc.delta && Array.isArray(doc.delta.ops) && doc.delta.ops.length > 0;
                if (pagination && hasDelta) {
                    pagination.importContent({ delta: doc.delta });
                } else if (quillInstance && hasDelta) {
                    quillInstance.setContents(doc.delta, 'silent');
                } else if (quillInstance && doc.html) {
                    quillInstance.root.innerHTML = doc.html;
                }
            }

            if (isClosed) {
                quillInstance?.disable();
                _setSaveStatus('lock', 'Read Only');
            }

            // Instantiate typing metrics (QuillTypingMetrics)
            _setupTypingMetrics();

            documentLoaded = true;
            _updateMetricsUI();
            console.log('[InviteEditor] Document loaded:', documentId);
        })
        .catch(err => {
            console.error('[InviteEditor] Load error:', err);
            showToast('Error loading document', 'error');
        });
    }

    // ──────────────────────────────────────────────────────────
    // 4. AUTO-SAVE  (FIX #2: covers ALL pages via pagination.exportContent)
    // ──────────────────────────────────────────────────────────
    function _setupAutoSave() {
        if (!quillInstance) return;

        quillInstance.on('text-change', (delta, old, source) => {
            if (source !== 'user' || isClosed) return;
            _markActivity();
            _setSaveStatus('loader', 'Unsaved');
            updateMetrics();          // keeps sidebar stats current
            _updateStatusBarUI();     // keeps status bar current
            _debouncedSave();
        });

        // Also hook pagination's onTextChange callback (belt-and-suspenders)
        if (pagination && pagination.config) {
            const orig = pagination.config.onTextChange;
            pagination.config.onTextChange = (content, source) => {
                if (orig) orig(content, source);
                if (source === 'user') _debouncedSave();
            };
        }
    }

    function _hookOnNewPage() {
        // If pagination creates a new visual page, compat hook (single instance — noop)
        if (pagination) {
            const orig = pagination.config.onNewPage;
            pagination.config.onNewPage = (q, idx) => {
                if (orig) orig(q, idx);
                // Nothing extra needed — single instance already auto-saves
            };
        }
    }

    function _debouncedSave() {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(_saveDocument, 2000);
    }

    async function _saveDocument(manual = false, isFinal = false) {
        if (isSaving || (isClosed && !isFinal)) return;
        isSaving = true;

        try {
            let delta, html;
            if (pagination) {
                const exp = pagination.exportContent();
                delta = exp.delta;
                html  = exp.html;
            } else if (quillInstance) {
                delta = quillInstance.getContents();
                html  = quillInstance.root.innerHTML;
            } else {
                return;
            }

            const res  = await fetch(`/invite/${TOKEN}/document`, {
                method:  'PUT',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ 
                    delta, 
                    html, 
                    is_autosave: !manual,
                    is_final:    isFinal,
                    metrics: window.typingMetrics ? window.typingMetrics.getMetrics() : null
                }),
            });
            const data = await res.json();

            if (!data.success) throw new Error(data.error || 'Save failed');

            _setSaveStatus('check-circle', manual ? 'Saved' : 'Auto-saved');
            const lastSaved = document.getElementById('lastSaved');
            if (lastSaved) lastSaved.textContent = new Date().toLocaleTimeString();

            _recordSaveEntry(!manual);

            // Metrics are now consolidated into the same PUT request above.
            // No need for a separate sendToServer call here. (Fix #Reliability)

            if (manual) showToast('Document saved successfully', 'success');
            document.dispatchEvent(new CustomEvent('documentSaved', { detail: { timestamp: Date.now() } }));

        } catch (err) {
            console.error('[InviteEditor] Save error:', err);
            _setSaveStatus('alert-circle', 'Error');
            if (manual) showToast(err.message, 'error');
        } finally {
            isSaving = false;
        }
    }

    // ──────────────────────────────────────────────────────────
    // 5. TYPING METRICS  (FIX #5: full-document content)
    // ──────────────────────────────────────────────────────────
    function _setupTypingMetrics() {
        if (!window.QuillTypingMetrics || window.typingMetrics) return;
        
        console.log('[InviteEditor] Initializing TypingMetrics with token:', !!TOKEN);
        const target = pagination || quillInstance;
        window.typingMetrics = new QuillTypingMetrics(target, {
            inviteToken:  TOKEN,          
            workspaceId:  workspaceId,
            invitationId: invitationId,
            documentId:   documentId,
            endpoint:     '/api/save-essay-metrics',
        });

        // CRITICAL: attach keydown / keyup / paste / visibility listeners.
        // Without this call ALL behavioral counters (WPM, backspaces, pauses,
        // burst, paste events, large deletions) stay permanently at zero.
        window.typingMetrics.attachListeners();
        
        // Restore previous active time into typingMetrics if we have it
        if (metrics.activeTimeSeconds > 0) {
            window.typingMetrics.metrics.effectiveTypingMs = metrics.activeTimeSeconds * 1000;
        }

        console.log('[InviteEditor] TypingMetrics instantiated + listeners attached:', !!window.typingMetrics);

        window.typingMetrics.onActivityChange = (active) => {
            const ind = document.getElementById('typingIndicator');
            if (ind) {
                if (active) ind.classList.add('active');
                else ind.classList.remove('active');
            }
        };

        // ── Session Timer (MM:SS) ──────────────────────────────────
        const timerEl = document.getElementById('sessionTimer');
        if (timerEl) {
            setInterval(() => {
                if (!window.typingMetrics) return;
                const totalSeconds = Math.round((performance.now() - window.typingMetrics.startTime) / 1000);
                const mins = Math.floor(totalSeconds / 60);
                const secs = totalSeconds % 60;
                timerEl.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
            }, 1000);
        }
    }

    // ──────────────────────────────────────────────────────────
    // 6. METRICS + STATS
    // ──────────────────────────────────────────────────────────
    function _setupMetrics() { /* initialized via loadStats() */ }

    function getFullText() {
        if (pagination) {
            try {
                const exp = pagination.exportContent();
                if (exp?.delta?.ops) {
                    return exp.delta.ops
                        .filter(op => typeof op.insert === 'string')
                        .map(op => op.insert)
                        .join('');
                }
            } catch (_) {}
        }
        return quillInstance?.getText() || '';
    }

    function updateMetrics() {
        const text  = getFullText();
        const words = text.trim().split(/\s+/).filter(w => w.length > 0);
        metrics.wordCount      = words.length;
        metrics.paragraphCount = text.split('\n').filter(p => p.trim().length > 0).length;

        // Word limit check
        if (hasWordLimit && wordLimit > 0 && metrics.wordCount >= wordLimit) {
            if (!showedLimitWarning) { _showWordLimitModal(); showedLimitWarning = true; }
        } else {
            showedLimitWarning = false;
        }

        _updateMetricsUI();
        saveStats();
    }

    function _updateMetricsUI() {
        // Header
        _el('wordCount',  metrics.wordCount);
        _el('timer',      _formatTime(metrics.activeTimeSeconds));

        // Sidebar stats
        _el('statTotalWords',  metrics.wordCount);
        _el('statActiveTime',  _formatTime(metrics.activeTimeSeconds));
        _el('statWPM',         metrics.activeTimeSeconds > 30
                                ? Math.round(metrics.wordCount / (metrics.activeTimeSeconds / 60))
                                : 0);
        _el('statSpellingErrors', metrics.spellingErrors);
        _el('statGrammarErrors',  metrics.grammarErrors);

        // Progress bar
        const maxWords   = wordLimit > 0 ? wordLimit : 2500;
        const progress   = Math.min((metrics.wordCount / maxWords) * 100, 100);
        const fill       = document.getElementById('progressFill');
        const pct        = document.getElementById('progressPercent');
        if (fill) fill.style.width       = `${progress}%`;
        if (pct)  pct.textContent        = `${Math.round(progress)}%`;

        // Status bar
        _updateStatusBarUI();
    }

    function _setupStatusBarUpdates() {
        const ec = document.querySelector('.editor-container');
        if (!ec) return;
        ec.addEventListener('click',  () => _updateStatusBarUI());
        ec.addEventListener('keyup',  (e) => {
            if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) _updateStatusBarUI();
        });
    }

    function _updateStatusBarUI() {
        const text = getFullText() || '';

        // words
        const qsW = document.getElementById('qsWords');
        if (qsW) qsW.textContent = `${text.split(/\s+/).filter(w=>w).length} words`;

        // chars
        const qsC = document.getElementById('qsChars');
        if (qsC) {
            const cnt = text.endsWith('\n') ? Math.max(0, text.length - 1) : text.length;
            qsC.textContent = `${cnt} chars`;
        }

        // lines
        const qsL = document.getElementById('qsLines');
        if (qsL) qsL.textContent = `${text.split('\n').filter(l => l.length > 0).length || 1} lines`;

        // pages
        const qsP = document.getElementById('qsPage');
        if (qsP && pagination) {
            qsP.textContent = `Page ${pagination.currentPageIndex + 1} of ${pagination.pageCount}`;
        }

        // cursor
        const qsCur = document.getElementById('qsCursor');
        if (qsCur && quillInstance) {
            const range = quillInstance.getSelection();
            if (range) {
                const textUp = quillInstance.getText(0, range.index);
                const lines  = textUp.split('\n');
                const row    = lines.length;
                const col    = lines[row - 1].length + 1;
                qsCur.textContent = `Col ${col}, Row ${row}`;
            }
        }
    }

    // ──────────────────────────────────────────────────────────
    // 7. ACTIVITY TRACKING
    // ──────────────────────────────────────────────────────────
    function _setupActivityTracking() {
        activityInterval = setInterval(() => {
            if (isTyping) {
                // Synchronize with window.typingMetrics if available
                if (window.typingMetrics) {
                    const tm = window.typingMetrics.getMetrics();
                    metrics.activeTimeSeconds = tm.effectiveTypingSeconds || 0;
                } else {
                    metrics.activeTimeSeconds += 1;
                }
                
                _el('timer', _formatTime(metrics.activeTimeSeconds));
                _el('statActiveTime', _formatTime(metrics.activeTimeSeconds));
                
                if (metrics.activeTimeSeconds % 10 === 0) saveStats(); // More frequent saves for time
            }
        }, 1000);

        // Listen on editor-pages container (works even across virtual pages)
        const host = document.getElementById('editor-pages') || document.querySelector('.ql-editor');
        if (host) {
            host.addEventListener('keydown', (e) => {
                if (e.key.length === 1 || ['Backspace','Delete','Enter'].includes(e.key)) _markActivity();
            });
            host.addEventListener('input', _markActivity);
        }

        document.addEventListener('visibilitychange', () => {
            if (document.hidden) _clearActivity();
        });
    }

    function _markActivity() {
        isTyping = true;
        clearTimeout(inactivityTimeout);
        inactivityTimeout = setTimeout(_clearActivity, 5000);

        const ind = document.getElementById('typingIndicator');
        if (ind) ind.style.display = 'flex';
    }

    function _clearActivity() {
        isTyping = false;
        const ind = document.getElementById('typingIndicator');
        if (ind) ind.style.display = 'none';
    }

    // ──────────────────────────────────────────────────────────
    // 8. VERSION HISTORY
    // ──────────────────────────────────────────────────────────
    async function loadVersionHistory() {
        // #versionHistory is the collapsible panel; renders into #versionList inside it
        const list = document.getElementById('versionList') || document.getElementById('versionHistory');
        if (!list) return;

        const local = _getSaveHistory();
        if (local.length === 0) {
            list.innerHTML = `
                <div class="version-empty" style="padding:16px;text-align:center;opacity:.6;">
                    <i class="bi bi-clock-history" style="font-size:1.5rem;"></i>
                    <p style="margin:8px 0 4px;">No saved versions yet</p>
                    <span style="font-size:11px;">Versions appear as you write</span>
                </div>`;
            return;
        }

        list.innerHTML = local.map(entry => {
            const d    = new Date(entry.timestamp);
            const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            const date = `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
            const icon  = entry.type === 'manual' ? 'bi-save' : 'bi-arrow-repeat';
            const label = entry.type === 'manual' ? 'Manual Save' : 'Auto-saved';
            return `
                <div class="version-entry">
                    <div class="version-entry-header">
                        <span class="version-entry-type"><i class="bi ${icon}"></i> ${label}</span>
                    </div>
                    <div class="version-entry-details">
                        <div class="version-detail"><i class="bi bi-calendar3"></i><span>${date}</span></div>
                        <div class="version-detail"><i class="bi bi-clock"></i><span>${time}</span></div>
                        <div class="version-detail"><i class="bi bi-hourglass-split"></i><span>${_formatTime(entry.activeTimeSeconds||0)}</span></div>
                        <div class="version-detail"><i class="bi bi-file-word"></i><span>${entry.wordCount||0} words</span></div>
                    </div>
                </div>`;
        }).join('');
    }

    function _getSaveHistory() {
        try { return JSON.parse(localStorage.getItem(savesKey) || '[]'); } catch (_) { return []; }
    }

    function _recordSaveEntry(isAuto) {
        try {
            const h = _getSaveHistory();
            h.unshift({ timestamp: Date.now(), type: isAuto ? 'auto' : 'manual',
                        wordCount: metrics.wordCount, activeTimeSeconds: metrics.activeTimeSeconds });
            h.length = Math.min(h.length, 50);
            localStorage.setItem(savesKey, JSON.stringify(h));
            loadVersionHistory();
        } catch (_) {}
    }

    // ──────────────────────────────────────────────────────────
    // 9. STATS PERSISTENCE
    // ──────────────────────────────────────────────────────────
    function saveStats() {
        try {
            localStorage.setItem(statsKey, JSON.stringify({
                wordCount: metrics.wordCount,
                activeTimeSeconds: metrics.activeTimeSeconds,
                sessions: metrics.sessions,
                spellingErrors: metrics.spellingErrors,
                grammarErrors:  metrics.grammarErrors,
                lastSaved: Date.now(),
            }));
        } catch (_) {}
    }

    function loadStats() {
        try {
            const raw = localStorage.getItem(statsKey);
            if (raw) {
                const d = JSON.parse(raw);
                metrics.activeTimeSeconds = d.activeTimeSeconds || 0;
                metrics.sessions          = (d.sessions || 0) + 1;
                metrics.spellingErrors    = d.spellingErrors || 0;
                metrics.grammarErrors     = d.grammarErrors  || 0;
            } else {
                metrics.sessions = 1;
            }
            saveStats();
        } catch (_) {}
    }

    // ──────────────────────────────────────────────────────────
    // 10. FINALIZE / SUBMIT BUTTON
    // ──────────────────────────────────────────────────────────
    function _setupFinalizeBtn() {
        const btn = document.getElementById('finalizeAssignmentBtn');
        if (btn) {
            btn.addEventListener('click', () => {
                const modal = document.getElementById('signatureModal');
                if (modal) modal.classList.add('active');
            });
        }

        // SignaturBtn (footer)
        const sigBtn = document.getElementById('SignaturBtn');
        if (sigBtn) {
            sigBtn.addEventListener('click', () => {
                const modal = document.getElementById('signatureModal');
                if (modal) modal.classList.add('active');
            });
        }

        // submitWithSignature
        const subBtn = document.getElementById('submitWithSignature');
        if (subBtn) {
            subBtn.addEventListener('click', _handleFinalSubmit);
        }

        // integrityCheckbox enables submit button
        const cb = document.getElementById('integrityCheckbox');
        if (cb && subBtn) {
            cb.addEventListener('change', () => { subBtn.disabled = !cb.checked; });
        }

        // Signature tabs
        const tabDraw   = document.getElementById('tabDraw');
        const tabUpload = document.getElementById('tabUpload');
        const areaDraw  = document.getElementById('areaDraw');
        const areaUpload= document.getElementById('areaUpload');
        if (tabDraw && tabUpload) {
            tabDraw.addEventListener('click', () => {
                tabDraw.classList.add('active');   tabUpload.classList.remove('active');
                if (areaDraw)   areaDraw.style.display   = '';
                if (areaUpload) areaUpload.style.display = 'none';
            });
            tabUpload.addEventListener('click', () => {
                tabUpload.classList.add('active'); tabDraw.classList.remove('active');
                if (areaDraw)   areaDraw.style.display   = 'none';
                if (areaUpload) areaUpload.style.display = '';
            });
        }

        // Signature canvas setup
        _setupSignatureCanvas();

        // Upload preview
        const upInput = document.getElementById('signatureUpload');
        const upPreview = document.getElementById('uploadPreview');
        const upPreviewImg = document.getElementById('uploadPreviewImg');
        const canvas = document.getElementById('signatureCanvas');

        if (upInput) {
            upInput.addEventListener('change', () => {
                const file = upInput.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (e) => {
                    const img = new Image();
                    img.onload = () => {
                        _processSignatureImage(img, canvas);
                        if (upPreview) upPreview.style.display = 'block';
                        if (upPreviewImg) upPreviewImg.src = canvas.toDataURL();
                        // Switch to Draw tab to show the result on canvas
                        const tabDraw = document.getElementById('tabDraw');
                        if (tabDraw) tabDraw.click(); 
                    };
                    img.src = e.target.result;
                };
                reader.readAsDataURL(file);
            });
        }
    }

    /**
     * Processes an uploaded image: removes white background and crops to content.
     */
    function _processSignatureImage(img, targetCanvas) {
        if (!targetCanvas) return;
        const ctx = targetCanvas.getContext('2d');
        
        // Use a temporary canvas to process
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        tempCanvas.width = img.width;
        tempCanvas.height = img.height;
        tempCtx.drawImage(img, 0, 0);

        const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
        const data = imageData.data;

        let minX = tempCanvas.width, minY = tempCanvas.height, maxX = 0, maxY = 0;
        let hasContent = false;

        // 1. Remove background (white/near-white to transparent)
        // 2. Find bounding box of content
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i], g = data[i + 1], b = data[i + 2];
            // Threshold for "white"
            if (r > 210 && g > 210 && b > 210) {
                data[i + 3] = 0; // Transparent
            } else {
                const x = (i / 4) % tempCanvas.width;
                const y = Math.floor((i / 4) / tempCanvas.width);
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                maxX = Math.max(maxX, x);
                maxY = Math.max(maxY, y);
                hasContent = true;
            }
        }

        if (!hasContent) return;

        tempCtx.putImageData(imageData, 0, 0);

        // 3. Clear target and draw cropped version fitting the canvas
        ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
        
        const cropWidth = maxX - minX + 1;
        const cropHeight = maxY - minY + 1;
        
        // Calculate scale to fit
        const scale = Math.min(targetCanvas.width / cropWidth, targetCanvas.height / cropHeight, 1);
        const drawW = cropWidth * scale;
        const drawH = cropHeight * scale;
        const drawX = (targetCanvas.width - drawW) / 2;
        const drawY = (targetCanvas.height - drawH) / 2;

        ctx.drawImage(tempCanvas, minX, minY, cropWidth, cropHeight, drawX, drawY, drawW, drawH);
    }

    function _setupSignatureCanvas() {
        const canvas = document.getElementById('signatureCanvas');
        if (!canvas) return;
        const ctx  = canvas.getContext('2d');
        let drawing = false, color = '#000000';

        // Color buttons
        document.querySelectorAll('.tool-btn[data-color]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tool-btn[data-color]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                color = btn.dataset.color;
            });
        });

        const clearBtn = document.getElementById('clearSignature');
        if (clearBtn) clearBtn.addEventListener('click', () => ctx.clearRect(0, 0, canvas.width, canvas.height));

        canvas.addEventListener('mousedown',  (e) => { drawing = true; ctx.beginPath(); _canvasMove(e); });
        canvas.addEventListener('mousemove',  (e) => { if (!drawing) return; _canvasMove(e); });
        canvas.addEventListener('mouseup',    () => { drawing = false; });
        canvas.addEventListener('mouseleave', () => { drawing = false; });

        canvas.addEventListener('touchstart',  (e) => { e.preventDefault(); drawing = true; ctx.beginPath(); _canvasMove(e.touches[0]); }, { passive: false });
        canvas.addEventListener('touchmove',   (e) => { e.preventDefault(); if (!drawing) return; _canvasMove(e.touches[0]); }, { passive: false });
        canvas.addEventListener('touchend',    () => { drawing = false; });

        function _canvasMove(e) {
            const rect = canvas.getBoundingClientRect();
            const x = (e.clientX - rect.left) * (canvas.width  / rect.width);
            const y = (e.clientY - rect.top)  * (canvas.height / rect.height);
            if (drawing) {
                ctx.lineWidth   = 2;
                ctx.lineCap     = 'round';
                ctx.strokeStyle = color;
                ctx.lineTo(x, y);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(x, y);
            }
        }
    }

    async function _handleFinalSubmit() {
        const cb  = document.getElementById('integrityCheckbox');
        const err = document.getElementById('signatureError');
        const subBtn = document.getElementById('submitWithSignature');

        // Check integrity checkbox
        if (!cb?.checked) {
            if (err) err.style.display = '';
            return;
        }

        // Get signature data from canvas (should contain processed image if uploaded)
        const canvas = document.getElementById('signatureCanvas');
        let signatureData = null;

        if (canvas) {
            const blank = document.createElement('canvas');
            blank.width  = canvas.width;
            blank.height = canvas.height;
            if (canvas.toDataURL() !== blank.toDataURL()) {
                signatureData = canvas.toDataURL('image/png');
            }
        }

        if (!signatureData) {
            if (err) err.style.display = '';
            const msg = err?.querySelector('span');
            if (msg) msg.textContent = 'Please provide a signature (draw or upload)';
            return;
        }
        if (err) err.style.display = 'none';

        // ── Loading State ──
        const originalText = subBtn.textContent;
        subBtn.disabled = true;
        subBtn.innerHTML = '<i class="bi bi-hourglass-split spin"></i> Submitting...';

        try {
            // 1. Save document first (as final — bypasses closed-session guard)
            await _saveDocument(true, true);

            // 2. Send typing metrics with signature (final)
            if (window.typingMetrics) {
                await window.typingMetrics.sendToServer(signatureData, true);
            }

            // 3. Success state
            showToast('Assignment submitted successfully', 'success');
            
            // Close modal
            const modal = document.getElementById('signatureModal');
            if (modal) modal.classList.remove('active');

            // 4. Lock Editor & Show Success Overlay
            if (quillInstance) quillInstance.disable();
            if (pagination) {
                const q = pagination.getFocusedQuill();
                if (q) q.disable();
            }

            _showFinalSuccessOverlay();

        } catch (error) {
            console.error('[FinalSubmit] Error:', error);
            showToast('Error submitting assignment. Please try again.', 'error');
            subBtn.disabled = false;
            subBtn.textContent = originalText;
        }
    }

    /**
     * Prevents any further interaction and confirms submission.
     */
    function _showFinalSuccessOverlay() {
        const overlay = document.createElement('div');
        overlay.id = 'finalSuccessOverlay';
        overlay.style = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(15, 23, 42, 0.95); backdrop-filter: blur(8px);
            z-index: 100000; display: flex; align-items: center; justify-content: center;
            color: white; font-family: 'Inter', sans-serif; text-align: center;
            animation: fadeIn 0.5s ease-out forwards;
        `;
        overlay.innerHTML = `
            <div style="max-width: 500px; padding: 40px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 24px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);">
                <div style="width: 80px; height: 80px; background: #22c55e; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 24px; box-shadow: 0 0 30px rgba(34, 197, 94, 0.4);">
                    <i class="bi bi-check-lg" style="font-size: 40px;"></i>
                </div>
                <h1 style="font-size: 28px; font-weight: 700; margin-bottom: 16px;">Submission Successful!</h1>
                <p style="font-size: 16px; color: #94a3b8; line-height: 1.6; margin-bottom: 32px;">
                    Your work has been signed and submitted correctly. <br>
                    You can no longer make changes to this document.
                </p>
                <button onclick="window.location.href='/'" style="background: white; color: #0f172a; border: none; padding: 12px 32px; border-radius: 12px; font-weight: 600; cursor: pointer; transition: transform 0.2s;">
                    Back to Dashboard
                </button>
            </div>
            <style>
                @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
            </style>
        `;
        document.body.appendChild(overlay);
        // Prevent all clicks
        document.body.style.overflow = 'hidden';
    }

    // ──────────────────────────────────────────────────────────
    // 11. LOGOUT / SAVE & EXIT MODAL
    // ──────────────────────────────────────────────────────────
    window.showLogoutModal = function () {
        const w = document.getElementById('userDropdownWrapper');
        if (w) w.classList.remove('open');
        const o = document.getElementById('logoutModalOverlay');
        if (o) { o.classList.add('active'); document.body.style.overflow = 'hidden'; }
    };

    window.closeLogoutModal = function () {
        const o = document.getElementById('logoutModalOverlay');
        if (o) { o.classList.remove('active'); document.body.style.overflow = ''; }
    };

    window.saveAndExit = async function () {
        await _saveDocument(false);
        showToast('Saved. Redirecting...', 'success');
        setTimeout(() => { window.location.href = '/'; }, 800);
    };

    window.exitWithoutSave = function () { window.location.href = '/'; };

    document.addEventListener('click', (e) => {
        const o = document.getElementById('logoutModalOverlay');
        if (e.target === o) window.closeLogoutModal();
    });

    // ──────────────────────────────────────────────────────────
    // 12. USER DROPDOWN
    // ──────────────────────────────────────────────────────────
    window.toggleUserDropdown = function () {
        document.getElementById('userDropdownWrapper')?.classList.toggle('open');
    };
    document.addEventListener('click', (e) => {
        const w = document.getElementById('userDropdownWrapper');
        if (w && !w.contains(e.target)) w.classList.remove('open');
    });

    // ──────────────────────────────────────────────────────────
    // 13. SETTINGS MODAL
    // ──────────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', () => {
        const settingsBtn   = document.getElementById('settingsBtn');
        const settingsModal = document.getElementById('settingsModal');

        if (settingsBtn && settingsModal) {
            settingsBtn.addEventListener('click', (e) => {
                e.preventDefault();
                settingsModal.classList.add('active');
            });
        }

        // Close modals via [data-modal] or overlay click
        document.addEventListener('click', (e) => {
            const closeBtn = e.target.closest('[data-modal]');
            if (closeBtn) {
                const m = document.getElementById(closeBtn.getAttribute('data-modal'));
                if (m) m.classList.remove('active');
            }
            if (e.target.classList.contains('modal-overlay') || e.target.classList.contains('modal')) {
                e.target.closest('.modal')?.classList.remove('active');
            }
        });

        // Settings tabs
        const tabBtns = document.querySelectorAll('.settings-tabs .tab-btn');
        const panels  = document.querySelectorAll('.settings-panel');
        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                tabBtns.forEach(b => b.classList.remove('active'));
                panels.forEach(p => p.style.display = 'none');
                btn.classList.add('active');
                const p = document.getElementById(btn.getAttribute('data-tab'));
                if (p) { p.style.display = 'block'; p.classList.add('active'); }
            });
        });

        // Theme switching
        document.querySelectorAll('.theme-option').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.theme-option').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const theme = btn.getAttribute('data-theme');
                if (theme === 'auto') {
                    document.documentElement.setAttribute('data-theme',
                        window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
                    localStorage.removeItem('theme');
                } else {
                    document.documentElement.setAttribute('data-theme', theme);
                    localStorage.setItem('theme', theme);
                }
            });
        });

        // Save Draft (manual save) — wire directly, no integration wrapper needed
        const saveDraftBtn = document.getElementById('saveDraftBtn');
        if (saveDraftBtn) {
            saveDraftBtn.addEventListener('click', (e) => {
                e.preventDefault();
                if (!quillInstance && !pagination) {
                    // Quill not ready yet, retry after short delay
                    setTimeout(() => { if (quillInstance || pagination) _saveDocument(true); }, 1000);
                } else {
                    _saveDocument(true);
                }
            });
        }

        // Submit Work — open signature modal
        const signaturBtn = document.getElementById('SignaturBtn');
        if (signaturBtn) {
            signaturBtn.addEventListener('click', (e) => {
                e.preventDefault();
                const modal = document.getElementById('signatureModal');
                if (modal) modal.classList.add('active');
                else console.warn('[InviteEditor] signatureModal not found');
            });
        }

        // Editor visible on load (pre-registered student)
        const editorArea = document.getElementById('editorArea');
        if (editorArea && editorArea.style.display !== 'none') {
            setTimeout(_initEditorAfterVisible, 800);
        }

        // Registration form focus
        const firstInput = document.getElementById('firstName');
        if (firstInput) setTimeout(() => firstInput.focus(), 400);

        // Lucide icons
        if (window.lucide) lucide.createIcons();
    });

    // ──────────────────────────────────────────────────────────
    // 14. WORD LIMIT MODAL
    // ──────────────────────────────────────────────────────────
    function _showWordLimitModal() {
        let modal = document.getElementById('wordLimitModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id        = 'wordLimitModal';
            modal.className = 'word-limit-modal';
            modal.innerHTML = `
                <div class="word-limit-overlay"></div>
                <div class="word-limit-content">
                    <div class="word-limit-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                        </svg>
                    </div>
                    <h2 class="word-limit-title">Word Limit Reached</h2>
                    <p class="word-limit-message">You've reached the limit of <strong id="wlLimit">${wordLimit}</strong> words.</p>
                    <p class="word-limit-current">Current: <strong id="wlCount">${metrics.wordCount}</strong></p>
                    <button class="word-limit-btn"
                        onclick="this.closest('.word-limit-modal').classList.remove('active');
                                 setTimeout(()=>this.closest('.word-limit-modal').style.display='none',300)">
                        Got it
                    </button>
                </div>`;
            document.body.appendChild(modal);

            const s = document.createElement('style');
            s.textContent = `.word-limit-modal{display:none;position:fixed;top:0;left:0;width:100%;height:100%;z-index:10001;align-items:center;justify-content:center}
.word-limit-modal.active .word-limit-overlay{opacity:1}
.word-limit-modal.active .word-limit-content{transform:scale(1);opacity:1}
.word-limit-overlay{position:absolute;inset:0;background:rgba(0,0,0,.6);backdrop-filter:blur(4px);opacity:0;transition:opacity .3s}
.word-limit-content{position:relative;background:white;border-radius:16px;padding:2.5rem 2rem;max-width:450px;width:90%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.3);transform:scale(.9);opacity:0;transition:all .3s cubic-bezier(.34,1.56,.64,1)}
.word-limit-icon{width:80px;height:80px;margin:0 auto 1.5rem;background:linear-gradient(135deg,#fbbf24,#f59e0b);border-radius:50%;display:flex;align-items:center;justify-content:center}
.word-limit-icon svg{width:40px;height:40px;color:white}
.word-limit-title{font-size:1.5rem;font-weight:700;color:#1e293b;margin:0 0 1rem}
.word-limit-message,.word-limit-current{font-size:1rem;color:#64748b;margin:0 0 .5rem}
.word-limit-message strong,.word-limit-current strong{color:#f59e0b}
.word-limit-btn{background:linear-gradient(135deg,#3b82f6,#2563eb);color:white;border:none;padding:.875rem 2.5rem;border-radius:12px;font-size:1rem;font-weight:600;cursor:pointer}
[data-theme=dark] .word-limit-content{background:#1e293b}
[data-theme=dark] .word-limit-title{color:#f1f5f9}
[data-theme=dark] .word-limit-message{color:#cbd5e1}`;
            document.head.appendChild(s);
        }
        const wlL = document.getElementById('wlLimit');
        const wlC = document.getElementById('wlCount');
        if (wlL) wlL.textContent = wordLimit;
        if (wlC) wlC.textContent = metrics.wordCount;
        modal.style.display = 'flex';
        setTimeout(() => modal.classList.add('active'), 10);
    }

    // ──────────────────────────────────────────────────────────
    // HELPERS
    // ──────────────────────────────────────────────────────────
    function _setSaveStatus(icon, text) {
        const el = document.getElementById('saveStatus');
        if (!el) return;
        const spinClass = icon === 'loader' ? ' class="spin"' : '';
        el.innerHTML = `<i data-lucide="${icon}"${spinClass}></i><span>${text}</span>`;
        if (window.lucide) lucide.createIcons();
    }

    function _el(id, value) {
        const el = document.getElementById(id);
        if (el && el.textContent !== String(value)) el.textContent = value;
    }

    function _formatTime(s) {
        return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
    }

    window.showToast = function showToast(message, type = 'info') {
        const toast = document.getElementById('toast');
        if (!toast) return;
        toast.className = `toast toast-${type} show`;
        const icon = type === 'success' ? 'check-circle-fill' : type === 'error' ? 'exclamation-circle-fill' : 'info-circle-fill';
        toast.innerHTML = `<i class="bi bi-${icon}"></i> ${message}`;
        setTimeout(() => toast.classList.remove('show'), 3500);
    };

    // Expose save for external callers
    window.inviteEditorSave = () => _saveDocument(true);

}(window.TOKEN || ''));
