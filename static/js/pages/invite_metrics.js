/**
 * invite_metrics.js
 * Contribution tracking and word count analysis for the Student View
 */

(function () {
    'use strict';

    function init() {
        const DOC_ID = window.DOCUMENT_ID;
        if (!DOC_ID) return;

        // ── Helpers ──────────────────────────────────────────────────────────────
        function csrf() {
            return (typeof window.csrfToken === 'function') ? window.csrfToken() : '';
        }

        function countWords(text) {
            if (!text || typeof text !== 'string') return 0;
            return text.trim().split(/\s+/).filter(function (w) { return w.length > 0; }).length;
        }

        /**
         * Computes word_count_delta and primary action from a Quill delta.
         */
        function analyzeDelta(delta, oldDelta) {
            var wordsAdded = 0, wordsRemoved = 0;
            var firstInsert = '', posFrom = null, posTo = null, cursor = 0;
            var hasDelete = false, hasInsert = false;

            (delta.ops || []).forEach(function (op) {
                if (op.retain) {
                    cursor += op.retain;
                } else if (typeof op.insert === 'string') {
                    hasInsert = true;
                    wordsAdded += countWords(op.insert);
                    if (posFrom === null) posFrom = cursor;
                    if (!firstInsert) firstInsert = op.insert.slice(0, 200);
                    posTo = cursor + op.insert.length;
                    cursor += op.insert.length;
                } else if (op.insert && typeof op.insert === 'object') {
                    hasInsert = true;
                    wordsAdded += 1;
                    if (posFrom === null) posFrom = cursor;
                    posTo = cursor + 1;
                    cursor += 1;
                } else if (op.delete) {
                    hasDelete = true;
                    wordsRemoved += Math.max(1, Math.floor(op.delete / 5));
                    if (posFrom === null) posFrom = cursor;
                }
            });

            var action = hasInsert ? 'insert' : (hasDelete ? 'delete' : 'format');
            var wordDelta = hasInsert ? wordsAdded : (hasDelete ? -wordsRemoved : 0);

            return {
                action:    action,
                wordDelta: wordDelta,
                content:   firstInsert,
                posFrom:   posFrom,
                posTo:     posTo,
            };
        }

        // ── Batch buffer ─────────────────────────────────────────────────────────
        var buffer = [];
        var FLUSH_INTERVAL = 30;

        function addToBuffer(info) {
            var now = Date.now();
            if (buffer.length > 0) {
                var last = buffer[buffer.length - 1];
                if (last.action === info.action && (now - last.ts) < 5000) {
                    last.wordDelta += info.wordDelta;
                    last.content   = (last.content + ' ' + info.content).slice(0, 500);
                    last.posTo     = info.posTo;
                    return;
                }
            }
            buffer.push({
                action:    info.action,
                wordDelta: info.wordDelta,
                content:   info.content,
                posFrom:   info.posFrom,
                posTo:     info.posTo,
                ts:        now,
            });
        }

        function flushBuffer() {
            if (!buffer.length) return;
            var toSend = buffer.splice(0, buffer.length);
            toSend.forEach(function (entry) {
                if (entry.wordDelta === 0 && entry.action === 'format') return;
                fetch('/api/documents/' + DOC_ID + '/contributions', {
                    method:  'POST',
                    headers: {
                        'Content-Type':  'application/json',
                        'X-CSRFToken':   csrf(),
                    },
                    body: JSON.stringify({
                        action:           entry.action,
                        content:          entry.content,
                        position_from:    entry.posFrom,
                        position_to:      entry.posTo,
                        word_count_delta: entry.wordDelta,
                    }),
                }).catch(function () {});
            });
        }

        // ── Hook into Quill ───────────────────────────────────────────────────────
        function attachQuillListener() {
            var quill = null;
            if (window.quillPagination && window.quillPagination.pages && window.quillPagination.pages[0]) {
                quill = window.quillPagination.pages[0].quill;
            }
            if (!quill && window.quill) {
                quill = window.quill;
            }
            if (!quill) return false;

            quill.on('text-change', function (delta, oldDelta, source) {
                if (source !== 'user') return;
                var info = analyzeDelta(delta, oldDelta);
                if (info.wordDelta !== 0 || info.action === 'format') {
                    addToBuffer(info);
                }
            });
            return true;
        }

        var attachAttempts = 0;
        var attachTimer = setInterval(function () {
            if (attachQuillListener() || ++attachAttempts >= 20) {
                clearInterval(attachTimer);
            }
        }, 500);

        setInterval(flushBuffer, FLUSH_INTERVAL * 1000);
        document.addEventListener('marktrack:autosave', flushBuffer);
        window.addEventListener('beforeunload', flushBuffer);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
