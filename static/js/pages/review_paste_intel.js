/**
 * review_paste_intel.js — Paste Intelligence panel for MarkTrack review.html
 *
 * Loaded when the professor opens the Plagiarism tab.
 * Fetches evidence from GET /api/plagiarism/document/<id>
 * Renders fragment cards, score gauge, and "Highlight in Document" functionality.
 *
 * Highlight system:
 *   - Locates pasted text in the read-only Quill pages
 *   - Temporarily wraps in orange-glow span
 *   - Scrolls smoothly to the fragment
 *   - Auto-removes after 5 seconds
 *   - Vanilla glassmorphism tooltip on hover (zero external deps)
 */

(function () {
    'use strict';

    // ─────────────────────────────────────────────────────────────────────────
    // STATE
    // ─────────────────────────────────────────────────────────────────────────
    let _evidence       = [];
    let _loaded         = false;
    let _activeTooltip  = null;
    let _tooltipTimer   = null;
    const _HIGHLIGHT_DURATION_MS = 5000;
    const _HIGHLIGHT_COLOR       = 'rgba(255, 165, 0, 0.25)';
    const _HIGHLIGHT_BORDER      = '1px solid rgba(255, 165, 0, 0.6)';

    // ─────────────────────────────────────────────────────────────────────────
    // PUBLIC API (exposed as window.PasteIntel)
    // ─────────────────────────────────────────────────────────────────────────
    const PasteIntel = {
        load,
        showAll,
        highlightFragment,
        showHelpModal() {
            const modal = document.getElementById('piHelpModal');
            if (modal) {
                modal.classList.add('active');
                document.body.style.overflow = 'hidden';
            }
        },
        hideHelpModal() {
            const modal = document.getElementById('piHelpModal');
            if (modal) {
                modal.classList.remove('active');
                document.body.style.overflow = '';
            }
        },
        setHelpLang(lang) {
            const btnEs = document.getElementById('btnLangEs');
            const btnEn = document.getElementById('btnLangEn');
            const contentEs = document.getElementById('contentLangEs');
            const contentEn = document.getElementById('contentLangEn');

            if (lang === 'es') {
                btnEs?.classList.add('active');
                btnEn?.classList.remove('active');
                contentEs?.classList.add('active');
                contentEn?.classList.remove('active');
            } else {
                btnEn?.classList.add('active');
                btnEs?.classList.remove('active');
                contentEn?.classList.add('active');
                contentEs?.classList.remove('active');
            }
        }
    };
    window.PasteIntel = PasteIntel;

    // ─────────────────────────────────────────────────────────────────────────
    // AUTO-LOAD when Plagiarism tab is clicked
    // ─────────────────────────────────────────────────────────────────────────
    function _init() {
        // Intercept Plagiarism tab click via event delegation
        document.querySelectorAll('.tab[data-tab="plagiarism"]').forEach(btn => {
            btn.addEventListener('click', function () {
                if (!_loaded) load();
            });
            if (btn.classList.contains('active')) {
                load();
            }
        });

        // Backup: if plagiarism panel is active or block display on boot, load immediately
        const panel = document.getElementById('plagiarism');
        if (panel && (panel.classList.contains('active') || panel.style.display === 'block')) {
            load();
        }

        // Silent load on init to populate overview count alert card
        load();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _init);
    } else {
        _init();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // LOAD EVIDENCE
    // ─────────────────────────────────────────────────────────────────────────
    async function load() {
        const docId = _getDocumentId();
        if (!docId) {
            _setEmptyState('No document ID available.');
            return;
        }

        _setEmptyState('Loading paste evidence…');

        try {
            const res  = await fetch(`/api/plagiarism/document/${docId}?include_inactive=false`, {
                credentials: 'same-origin',
            });
            const data = await res.json();

            if (data.status !== 'success') throw new Error(data.message || 'API error');

            _evidence = data.fragments || [];
            _loaded   = true;
            _render(data);
        } catch (e) {
            _setEmptyState('Failed to load evidence. Try again.');
            console.error('[PasteIntel] load error:', e);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // RENDER
    // ─────────────────────────────────────────────────────────────────────────
    function _render(data) {
        const fragments = data.fragments || [];

        // ── Overview Alert Card Update ────────────────────────────────────────
        const overviewCountEl = document.getElementById('piOverviewCount');
        if (overviewCountEl) {
            overviewCountEl.textContent = fragments.length;
        }

        // ── Gauge ─────────────────────────────────────────────────────────────
        _updateGauge(data.avg_score || 0, fragments.length, data.domains || []);

        // ── Show All button ───────────────────────────────────────────────────
        const showAllBtn = document.getElementById('piShowAllBtn');
        if (showAllBtn) showAllBtn.style.display = fragments.length > 0 ? 'block' : 'none';

        // ── Fragment list ─────────────────────────────────────────────────────
        const list      = document.getElementById('piFragmentList');
        const emptyEl   = document.getElementById('piEmptyState');

        if (!list) return;
        list.innerHTML = '';

        if (fragments.length === 0) {
            if (emptyEl) emptyEl.textContent = 'No internet-paste evidence detected.';
            return;
        }
        if (emptyEl) emptyEl.style.display = 'none';

        fragments.forEach(frag => {
            const card = _buildCard(frag);
            list.appendChild(card);
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GAUGE UPDATE
    // ─────────────────────────────────────────────────────────────────────────
    function _updateGauge(score, count, domains) {
        const arc      = document.getElementById('piGaugeArc');
        const pctText  = document.getElementById('piGaugePct');
        const label    = document.getElementById('piRiskLabel');
        const desc     = document.getElementById('piRiskDesc');
        const statRow  = document.getElementById('piStatRow');
        const fragStat = document.getElementById('piStatFragments');
        const domStat  = document.getElementById('piStatDomains');

        const circumference = 565;
        const offset        = circumference - (score / 100) * circumference;

        let color, riskText, riskDesc;
        if (score >= 71) {
            color = '#ef4444'; riskText = 'High Risk';
            riskDesc = 'Multiple internet-sourced fragments detected.';
        } else if (score >= 31) {
            color = '#f59e0b'; riskText = 'Medium Risk';
            riskDesc = 'Some fragments may originate from online sources.';
        } else if (score > 0) {
            color = '#10b981'; riskText = 'Low Risk';
            riskDesc = 'Low similarity to internet-sourced content.';
        } else {
            color = '#6b7280'; riskText = 'No Evidence';
            riskDesc = 'No internet-paste events recorded.';
        }

        if (arc)     { arc.style.stroke = color; arc.setAttribute('stroke-dashoffset', offset); }
        if (pctText) pctText.textContent = score > 0 ? `${score}%` : '—';
        if (label)   { label.textContent = riskText; label.style.color = color; }
        if (desc)    desc.textContent = riskDesc;
        if (statRow && count > 0) {
            statRow.style.display = 'flex';
            if (fragStat) fragStat.textContent = `${count} fragment${count !== 1 ? 's' : ''}`;
            if (domStat)  domStat.textContent  = `${domains.length} source${domains.length !== 1 ? 's' : ''}`;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CARD BUILDER
    // ─────────────────────────────────────────────────────────────────────────
    function _buildCard(frag) {
        const score    = frag.internet_copy_score || 0;
        const scoreColor = score >= 71 ? '#ef4444' : (score >= 31 ? '#f59e0b' : '#10b981');
        const preview  = _esc((frag.pasted_text_preview || '').slice(0, 160));
        const domain   = _esc(frag.source_domain || '—');
        const when     = frag.created_at ? _relativeTime(frag.created_at) : '—';
        const exactTime = frag.created_at ? _formatDateTime(frag.created_at) : '';
        const chars    = frag.char_count || 0;

        const card = document.createElement('div');
        card.className = 'pi-card';
        card.setAttribute('data-uuid', frag.paste_uuid || '');
        card.innerHTML = `
            <div class="pi-card-header">
                <div class="pi-card-domain">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
                         stroke-linecap="round" stroke-linejoin="round" style="opacity:.6;">
                        <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
                        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                    </svg>
                    ${domain}
                </div>
                <span class="pi-score-badge" style="background:${scoreColor}20;color:${scoreColor};border:1px solid ${scoreColor}40;">
                    ${score}%
                </span>
            </div>
            <div class="pi-preview">${preview}${preview.length >= 160 ? '…' : ''}</div>
            <div class="pi-meta">
                <span title="${exactTime}">⏱ ${when} ${exactTime ? `(${exactTime})` : ''}</span>
                <span>📝 ${chars} chars</span>
            </div>
            <button class="pi-highlight-btn">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
                     stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                </svg>
                Highlight in Document
            </button>`;

        // Programmatically attach click listener to avoid quotes injection/HTML attribute truncation bugs!
        const btn = card.querySelector('.pi-highlight-btn');
        if (btn) {
            btn.addEventListener('click', () => {
                highlightFragment(frag.pasted_text || '');
            });
        }

        // Tooltip on hover (glassmorphism, vanilla)
        card.addEventListener('mouseenter', (e) => _showTooltip(e, frag));
        card.addEventListener('mousemove',  (e) => _positionTooltip(e));
        card.addEventListener('mouseleave', ()  => _hideTooltip());

        return card;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // HIGHLIGHT IN DOCUMENT
    // ─────────────────────────────────────────────────────────────────────────
    function highlightFragment(text, duration = _HIGHLIGHT_DURATION_MS, shouldScroll = true) {
        if (!text || !window.quillPagination) return;

        const pagination = window.quillPagination;
        const pages      = pagination.pages || [];
        
        let found = false;

        for (const page of pages) {
            const quill = page.quill || page;
            if (!quill || !quill.root) continue;

            const editorText = quill.getText();
            
            // Construct a robust RegExp matching the entire pasted text, allowing flexible spaces/newlines
            const escaped = text.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s\\u00a0]+');
            const regex = new RegExp(escaped, 'i');
            
            const match = editorText.match(regex);
            if (!match) continue;

            found = true;

            const startOffset = match.index;
            const matchedText = match[0];

            // Wrap the complete text range in DOM highlighted spans
            const highlightedSpans = _wrapQuillRangeInDOM(quill, startOffset, matchedText.length);
            if (!highlightedSpans || highlightedSpans.length === 0) continue;

            // Scroll to the first highlighted segment if requested
            if (shouldScroll && highlightedSpans.length > 0) {
                highlightedSpans[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
            }

            // Auto-remove after duration
            setTimeout(() => {
                highlightedSpans.forEach(span => {
                    if (span && span.parentNode) {
                        const textNode = document.createTextNode(span.textContent);
                        span.parentNode.replaceChild(textNode, span);
                    }
                });
            }, duration);

            break;  // Only highlight first occurrence
        }

        if (!found) {
            // Text may have been deleted or edited — flash a subtle notice
            const emptyEl = document.getElementById('piEmptyState');
            if (emptyEl) {
                emptyEl.textContent = '⚠ Fragment no longer present in document (student deleted it).';
                emptyEl.style.display = 'block';
                emptyEl.style.color   = '#f59e0b';
                setTimeout(() => {
                    emptyEl.style.display = 'none';
                    emptyEl.style.color   = '';
                }, 4000);
            }
        }
    }

    function _wrapQuillRangeInDOM(quill, startOffset, length) {
        const nodesToWrap = [];
        let currentIdx = startOffset;
        const endOffset = startOffset + length;

        while (currentIdx < endOffset) {
            const [leaf, relativeOffset] = quill.getLeaf(currentIdx);
            if (!leaf || !leaf.domNode) {
                // If it's a block newline, just advance by 1
                currentIdx++;
                continue;
            }

            const domNode = leaf.domNode;
            const leafLen = leaf.length();

            if (domNode.nodeType === Node.TEXT_NODE) {
                const nodeTextLen = domNode.textContent.length;
                const relativeStart = Math.min(relativeOffset, nodeTextLen);
                const highlightLen = Math.min(nodeTextLen - relativeStart, endOffset - currentIdx);

                if (highlightLen > 0) {
                    nodesToWrap.push({
                        node: domNode,
                        start: relativeStart,
                        length: highlightLen
                    });
                    currentIdx += highlightLen;
                    continue;
                }
            }
            
            // Advance to prevent infinite loops
            currentIdx += Math.max(1, leafLen - relativeOffset);
        }

        if (nodesToWrap.length === 0) return null;

        // Wrap the collected text nodes in reverse order to keep document indices aligned
        const highlightedSpans = [];
        for (let i = nodesToWrap.length - 1; i >= 0; i--) {
            const item = nodesToWrap[i];
            const originalNode = item.node;
            const parent = originalNode.parentNode;
            if (!parent) continue;

            const content = originalNode.textContent;
            const start = item.start;
            const len = item.length;
            const end = start + len;

            const before = content.slice(0, start);
            const match  = content.slice(start, end);
            const after  = content.slice(end);

            const span = document.createElement('span');
            span.className = 'pi-highlight-glow';
            span.style.cssText = `
                background: ${_HIGHLIGHT_COLOR};
                border: ${_HIGHLIGHT_BORDER};
                border-radius: 3px;
                padding: 0 2px;
                display: inline;
                animation: piGlowPulse 0.4s ease-out;
                transition: opacity ${_HIGHLIGHT_DURATION_MS}ms ease;
            `;
            span.textContent = match;

            if (after) {
                parent.insertBefore(document.createTextNode(after), originalNode.nextSibling);
            }
            parent.insertBefore(span, originalNode.nextSibling);
            if (before) {
                originalNode.textContent = before;
            } else {
                parent.removeChild(originalNode);
            }

            highlightedSpans.push(span);
        }

        return highlightedSpans;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SHOW ALL
    // ─────────────────────────────────────────────────────────────────────────
    function showAll() {
        _evidence.forEach((frag, i) => {
            setTimeout(() => {
                // Pass false to shouldScroll to prevent the browser window from jumping around frantically!
                highlightFragment(frag.pasted_text || '', _HIGHLIGHT_DURATION_MS + 4000, false);
            }, i * 150);
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // VANILLA GLASSMORPHISM TOOLTIP
    // ─────────────────────────────────────────────────────────────────────────
    function _showTooltip(e, frag) {
        _hideTooltip();
        clearTimeout(_tooltipTimer);

        _tooltipTimer = setTimeout(() => {
            const tip = document.createElement('div');
            tip.id = 'piTooltip';
            tip.className = 'pi-tooltip';

            const score = frag.internet_copy_score || 0;
            const scoreColor = score >= 71 ? '#ef4444' : (score >= 31 ? '#f59e0b' : '#10b981');
            const when  = frag.created_at ? new Date(frag.created_at).toLocaleString() : '—';

            tip.innerHTML = `
                <div class="pi-tip-header">
                    <span class="pi-tip-score" style="background:${scoreColor}20;color:${scoreColor};border:1px solid ${scoreColor}40;">
                        ${score}% internet copy
                    </span>
                </div>
                <div class="pi-tip-row">
                    <span class="pi-tip-label">Domain</span>
                    <span class="pi-tip-val">${_esc(frag.source_domain || '—')}</span>
                </div>
                ${frag.source_url ? `
                <div class="pi-tip-row">
                    <span class="pi-tip-label">URL</span>
                    <a class="pi-tip-url" href="${_esc(frag.source_url)}" target="_blank" rel="noopener noreferrer"
                       onclick="event.stopPropagation()">
                        ${_esc(frag.source_url.slice(0, 50))}${frag.source_url.length > 50 ? '…' : ''}
                    </a>
                </div>` : ''}
                <div class="pi-tip-row">
                    <span class="pi-tip-label">Detected</span>
                    <span class="pi-tip-val">${_esc(when)}</span>
                </div>
                <div class="pi-tip-row">
                    <span class="pi-tip-label">Length</span>
                    <span class="pi-tip-val">${frag.char_count || 0} chars</span>
                </div>`;

            document.body.appendChild(tip);
            _activeTooltip = tip;
            _positionTooltip(e);
        }, 300);
    }

    function _positionTooltip(e) {
        if (!_activeTooltip) return;
        const tip  = _activeTooltip;
        const rect = tip.getBoundingClientRect();
        let   left = e.clientX + 14;
        let   top  = e.clientY - rect.height / 2;

        if (left + rect.width + 8 > window.innerWidth)  left = e.clientX - rect.width - 14;
        if (top < 8)                                     top  = 8;
        if (top + rect.height > window.innerHeight - 8)  top  = window.innerHeight - rect.height - 8;

        tip.style.left = `${left + window.scrollX}px`;
        tip.style.top  = `${top  + window.scrollY}px`;
    }

    function _hideTooltip() {
        clearTimeout(_tooltipTimer);
        if (_activeTooltip) { _activeTooltip.remove(); _activeTooltip = null; }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // UTILITIES
    // ─────────────────────────────────────────────────────────────────────────
    function _getDocumentId() {
        try {
            const cfg = document.getElementById('review-config');
            if (cfg) return JSON.parse(cfg.textContent).documentId || null;
        } catch (_) {}
        return window.REVIEW_CONFIG?.documentId || null;
    }

    function _setEmptyState(msg) {
        const el = document.getElementById('piEmptyState');
        if (el) { el.textContent = msg; el.style.display = 'block'; el.style.color = ''; }
        const list = document.getElementById('piFragmentList');
        if (list) list.innerHTML = '';
    }

    function _esc(str) {
        const d = document.createElement('div');
        d.textContent = str || '';
        return d.innerHTML;
    }

    function _relativeTime(isoStr) {
        const diff = Date.now() - new Date(isoStr).getTime();
        const m    = Math.floor(diff / 60000);
        if (m < 1)   return 'just now';
        if (m < 60)  return `${m}m ago`;
        const h = Math.floor(m / 60);
        if (h < 24)  return `${h}h ago`;
        return `${Math.floor(h / 24)}d ago`;
    }

    function _formatDateTime(isoStr) {
        if (!isoStr) return '';
        try {
            const date = new Date(isoStr);
            if (isNaN(date.getTime())) return '';
            const optionsDate = { month: 'short', day: 'numeric', year: 'numeric' };
            const optionsTime = { hour: 'numeric', minute: '2-digit', hour12: true };
            const dateStr = date.toLocaleDateString('en-US', optionsDate);
            const timeStr = date.toLocaleTimeString('en-US', optionsTime);
            return `${dateStr} at ${timeStr}`;
        } catch (e) {
            return '';
        }
    }

})();
