/**
 * paste_detector.js — Internet Paste Detection for MarkTrack invite.html
 *
 * STEALTH MODE: Zero student-visible UI changes. No alerts, no banners.
 * The detector runs silently in the background.
 *
 * Architecture:
 *   - 6-layer intercept system (see below)
 *   - Heuristic scoring mirroring backend paste_scorer.py
 *   - DocumentSyncWatcher: debounced diff that marks fragments inactive
 *   - All API calls fire-and-forget (no await blocking the UX)
 *
 * Layers:
 *   1. Quill clipboard module override (highest priority)
 *   2. quill.root paste event
 *   3. document-level paste event (fallback)
 *   4. beforeinput (insertFromPaste) — anti-bypass
 *   5. quill text-change delta analysis (large single-insert = paste)
 *   6. dragdrop on editor root
 */

(function () {
    'use strict';

    // ─────────────────────────────────────────────────────────────────────────
    // CONFIG
    // ─────────────────────────────────────────────────────────────────────────
    const CFG = {
        ENDPOINT_REGISTER:   '/api/plagiarism/register-paste',
        ENDPOINT_REVALIDATE: '/api/plagiarism/revalidate',
        MIN_PASTE_CHARS:     30,       // Ignore tiny pastes (single words)
        SYNC_DEBOUNCE_MS:    4000,     // Wait after text-change before diff scan
        MAX_TEXT_CHARS:      10000,
        MAX_HTML_CHARS:      50000,
        RETRY_BOOT_MS:       800,      // Retry delay for early init
        MAX_BOOT_RETRIES:    20,
    };

    // ─────────────────────────────────────────────────────────────────────────
    // STATE
    // ─────────────────────────────────────────────────────────────────────────
    let _documentId      = null;
    let _pasteMap        = new Map();   // paste_uuid → pasted_text
    let _syncTimer       = null;
    let _initialized     = false;
    let _bootRetries     = 0;
    let _lastTextSnapshot = '';         // for delta-based paste detection
    let _csrfToken       = null;

    // ─────────────────────────────────────────────────────────────────────────
    // INIT — poll until Quill + documentId are ready
    // ─────────────────────────────────────────────────────────────────────────
    function _boot() {
        if (_initialized) return;

        // Resolve documentId from server-config or documentedit-config JSON
        if (!_documentId) {
            try {
                const cfg = document.getElementById('server-config') || document.getElementById('documentedit-config');
                if (cfg) {
                    const parsed = JSON.parse(cfg.textContent);
                    _documentId = parsed.documentId || parsed.id || null;
                }
            } catch (_) {}
        }

        if (!_documentId || !window.quillPagination) {
            if (++_bootRetries <= CFG.MAX_BOOT_RETRIES) {
                setTimeout(_boot, CFG.RETRY_BOOT_MS);
            }
            return;
        }

        _csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';
        _installAllLayers();
        _initialized = true;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // LAYER INSTALLER
    // ─────────────────────────────────────────────────────────────────────────
    function _installAllLayers() {
        const pagination = window.quillPagination;
        const quill = pagination.quill || (pagination.pages?.[0]?.quill) || null;
        if (!quill) return;

        // NOTE: Layer 1 (Quill clipboard.onPaste override) intentionally omitted.
        // Quill v2 clipboard.onPaste(e: ClipboardEvent) — overriding it would
        // mismatch the signature and silently block all Ctrl+V / paste events.
        // Layers 2–6 provide full coverage without any interference.
        _layer2_rootPaste(quill);
        _layer3_documentPaste();
        _layer4_beforeInput(quill);
        _layer5_deltaAnalysis(quill);
        _layer6_dragDrop(quill);
        _installSyncWatcher(quill);
    }
    // ─────────────────────────────────────────────────────────────────────────
    // LAYER 2 — quill.root paste event (DOM)
    // ─────────────────────────────────────────────────────────────────────────
    function _layer2_rootPaste(quill) {
        quill.root.addEventListener('paste', function (e) {
            const text = e.clipboardData?.getData('text/plain') || '';
            const html = e.clipboardData?.getData('text/html') || '';
            _handlePasteData({ text, html, layer: 2 });
        }, { capture: true, passive: true });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // LAYER 3 — document-level paste (catches CMD+V outside focused root)
    // ─────────────────────────────────────────────────────────────────────────
    function _layer3_documentPaste() {
        document.addEventListener('paste', function (e) {
            // Only relevant if focus is inside editor pages
            const editorPages = document.getElementById('editor-pages');
            if (!editorPages || !editorPages.contains(document.activeElement)) return;
            const text = e.clipboardData?.getData('text/plain') || '';
            const html = e.clipboardData?.getData('text/html') || '';
            _handlePasteData({ text, html, layer: 3 });
        }, { capture: true, passive: true });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // LAYER 4 — beforeinput anti-bypass
    // Catches mobile/virtual keyboard paste and browser context-menu paste
    // ─────────────────────────────────────────────────────────────────────────
    function _layer4_beforeInput(quill) {
        quill.root.addEventListener('beforeinput', function (e) {
            if (e.inputType === 'insertFromPaste' || e.inputType === 'insertFromDrop') {
                const text = e.data || '';
                _handlePasteData({ text, html: '', layer: 4 });
            }
        }, { capture: true, passive: true });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // LAYER 5 — Quill text-change delta analysis
    // Detects impossibly-fast large text insertions (paste without event)
    // ─────────────────────────────────────────────────────────────────────────
    function _layer5_deltaAnalysis(quill) {
        quill.on('text-change', function (delta, _old, source) {
            if (source !== 'user') return;

            // Look for a single large insert in the delta
            const ops = delta.ops || [];
            let insertedText = '';
            for (const op of ops) {
                if (typeof op.insert === 'string' && op.insert.length > CFG.MIN_PASTE_CHARS) {
                    insertedText += op.insert;
                }
            }

            if (insertedText.length >= CFG.MIN_PASTE_CHARS) {
                _handlePasteData({ text: insertedText, html: '', layer: 5 });
            }

            // Update snapshot for sync watcher
            _lastTextSnapshot = _getFullText(quill);
            _scheduleSyncWatcher();
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // LAYER 6 — Drag & Drop text
    // ─────────────────────────────────────────────────────────────────────────
    function _layer6_dragDrop(quill) {
        quill.root.addEventListener('drop', function (e) {
            const text = e.dataTransfer?.getData('text/plain') || '';
            const html = e.dataTransfer?.getData('text/html') || '';
            if (text.length >= CFG.MIN_PASTE_CHARS) {
                _handlePasteData({ text, html, layer: 6 });
            }
        }, { capture: true, passive: true });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PASTE HANDLER — deduplicates, scores, and fires API
    // ─────────────────────────────────────────────────────────────────────────
    const _recentTextHashes = new Set();

    function _handlePasteData({ text = '', html = '', layer = 0 }) {
        text = (text || '').trim().slice(0, CFG.MAX_TEXT_CHARS);
        if (text.length < CFG.MIN_PASTE_CHARS) return;

        // Fast dedup: skip if same text was already sent in the last 2s
        const hash = _simpleHash(text);
        if (_recentTextHashes.has(hash)) return;
        _recentTextHashes.add(hash);
        setTimeout(() => _recentTextHashes.delete(hash), 2000);

        // Record all pastes >= MIN_PASTE_CHARS, do not block plain text pastes
        // const score = _clientScore(text, html);
        // if (score < 30) return;   // Mirror backend threshold

        const pasteUUID = _uuid4();
        _pasteMap.set(pasteUUID, text);

        // Extract URL from HTML for richer data
        const sourceUrl = _extractUrl(html);

        _fireAndForget(CFG.ENDPOINT_REGISTER, {
            document_id:    _documentId,
            pasted_text:    text,
            clipboard_html: html.slice(0, CFG.MAX_HTML_CHARS),
            source_url:     sourceUrl,
            paste_uuid:     pasteUUID,
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CLIENT-SIDE HEURISTIC SCORE (mirrors paste_scorer.py signals)
    // ─────────────────────────────────────────────────────────────────────────
    function _clientScore(text, html) {
        let score = 0;
        const h = html || '';

        if (h)                                                   score += 20;
        if (/<a\s[^>]*href/i.test(h))                            score += 20;
        if (/https?:\/\//i.test(h))                              score += 20;
        if (/<(cite|blockquote|sup|bib)/i.test(h))               score += 10;
        if (text.length > 300)                                   score += 10;
        if (/(utm_\w+|gclid|ref=|source=|fbclid)/i.test(h))     score += 10;
        if (/<(div|section|article|header|nav)\s/i.test(h))      score += 10;

        return Math.min(score, 100);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // DOCUMENT SYNC WATCHER
    // Diffs current text against stored pastes; deactivates removed fragments.
    // ─────────────────────────────────────────────────────────────────────────
    function _installSyncWatcher(quill) {
        // Initial snapshot
        _lastTextSnapshot = _getFullText(quill);
    }

    function _scheduleSyncWatcher() {
        clearTimeout(_syncTimer);
        _syncTimer = setTimeout(_runSyncDiff, CFG.SYNC_DEBOUNCE_MS);
    }

    function _runSyncDiff() {
        if (_pasteMap.size === 0) return;

        const currentText = _lastTextSnapshot;
        const removedUUIDs    = [];
        const stillPresent    = [];

        for (const [uuid, pastedText] of _pasteMap.entries()) {
            // Use first 200 chars as the search anchor (avoid false-positives from edits)
            const anchor = pastedText.slice(0, 200).trim();
            if (currentText.includes(anchor)) {
                stillPresent.push(uuid);
            } else {
                removedUUIDs.push(uuid);
                _pasteMap.delete(uuid);
            }
        }

        if (removedUUIDs.length > 0) {
            _fireAndForget(CFG.ENDPOINT_REVALIDATE, {
                document_id:   _documentId,
                removed_uuids: removedUUIDs,
                still_present: stillPresent,
            });
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // UTILITIES
    // ─────────────────────────────────────────────────────────────────────────
    function _getFullText(quill) {
        try {
            const pagination = window.quillPagination;
            if (pagination && typeof pagination.exportContent === 'function') {
                const exp = pagination.exportContent();
                if (exp?.delta?.ops) {
                    return exp.delta.ops
                        .filter(op => typeof op.insert === 'string')
                        .map(op => op.insert)
                        .join('');
                }
            }
            return quill.getText() || '';
        } catch (_) { return ''; }
    }

    function _extractUrl(html) {
        if (!html) return null;
        
        // 1. Try to extract from the standard SourceURL metadata header
        const sourceUrlMatch = html.match(/SourceURL:(https?:\/\/[^\s"'<>]+)/i);
        if (sourceUrlMatch) {
            return sourceUrlMatch[1].slice(0, 2048);
        }
        
        // 2. Try to extract from standard anchor href links
        const linkMatch = html.match(/<a\s[^>]*href=["'](https?:\/\/[^"'\s<>]+)["']/i);
        if (linkMatch) {
            return linkMatch[1].slice(0, 2048);
        }

        // 3. Fallback to any URL present in the HTML that is NOT a stylesheet or script
        const allUrls = html.match(/https?:\/\/[^\s"'<>]+/g) || [];
        for (const url of allUrls) {
            const cleanUrl = url.trim();
            if (!cleanUrl.includes('.css') && !cleanUrl.includes('.js') && !cleanUrl.includes('gstatic') && !cleanUrl.includes('googleapis')) {
                return cleanUrl.slice(0, 2048);
            }
        }
        
        return null;
    }

    function _simpleHash(str) {
        let h = 0;
        for (let i = 0; i < Math.min(str.length, 500); i++) {
            h = ((h << 5) - h) + str.charCodeAt(i);
            h |= 0;
        }
        return h.toString(36);
    }

    function _uuid4() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
    }

    function _fireAndForget(url, body) {
        try {
            fetch(url, {
                method:      'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken':  _csrfToken || '',
                },
                body: JSON.stringify(body),
                keepalive: true,
            }).catch(() => {}); // Intentionally silent
        } catch (_) {}
    }

    // ─────────────────────────────────────────────────────────────────────────
    // BOOT
    // ─────────────────────────────────────────────────────────────────────────
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _boot);
    } else {
        setTimeout(_boot, 500); // Give invite-editor.js time to init Quill
    }

    // Expose for debugging in dev console only
    window._PasteDetectorDebug = {
        getMap:   () => _pasteMap,
        getScore: _clientScore,
        runDiff:  _runSyncDiff,
    };

})();
