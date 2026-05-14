/**
 * review_ai_detection.js
 * Interactive AI detection analysis for the Review sidebar.
 * Captures Quill editor text, sends to XplagiaX via backend proxy,
 * and dynamically updates the AI Detection tab UI.
 */

(function () {
    'use strict';

    // ── Helpers ───────────────────────────────────────────────────────────────
    const CSRF = () =>
        document.querySelector('meta[name="csrf-token"]')?.content || '';

    const CIRCUMFERENCE = 2 * Math.PI * 90; // SVG circle r=90

    /**
     * Return colour + CSS class based on AI percentage.
     */
    function scoreLevel(pct) {
        if (pct <= 30) return { color: '#10B981', cls: 'score-high', label: 'Low Probability' };
        if (pct <= 60) return { color: '#F59E0B', cls: 'score-medium', label: 'Medium Probability' };
        return { color: '#EF4444', cls: 'score-low', label: 'High Probability' };
    }

    function wordCount(text) {
        const t = (text || '').trim();
        return t ? t.split(/\s+/).length : 0;
    }

    // ── DOM references (resolved once on DOMContentLoaded) ───────────────────
    document.addEventListener('DOMContentLoaded', function () {

        const btn          = document.getElementById('aiAnalyzeBtn');
        const panel        = document.getElementById('aiDetection');
        if (!btn || !panel) return; // Tab not present

        const badge        = document.getElementById('aiDetectionBadge') || panel.querySelector('.score-badge');
        const circleStroke = panel.querySelector('.circular-progress svg circle:nth-child(2)');
        const circleText   = panel.querySelector('.circular-progress svg text');
        const probLabel    = document.getElementById('aiProbLabel');
        const probDesc     = document.getElementById('aiProbDesc');
        const tbody        = document.getElementById('aiSegmentsBody');
        const errorSlot    = document.getElementById('aiErrorSlot');

        // ── Button Click Handler ─────────────────────────────────────────────
        btn.addEventListener('click', async function () {
            // 1. Get text from Quill
            const quill = window.quillPagination?.quill;
            if (!quill) {
                showError('Editor not initialised yet. Please wait a moment.');
                return;
            }

            const text = (quill.getText() || '').trim();
            if (!text || text.length < 20) {
                showError('Not enough text to analyse (minimum 20 characters).');
                return;
            }

            // 2. Enter loading state
            clearError();
            setLoading(true);

            try {
                // 3. Send to backend proxy
                const resp = await fetch('/api/ai/analyze', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': CSRF(),
                    },
                    body: JSON.stringify({
                        text: text,
                        plugins: ['ai_detection', 'citation_check', 'stylometric_analysis'],
                    }),
                });

                if (!resp.ok) {
                    const errBody = await resp.json().catch(() => ({}));
                    throw new Error(errBody.message || `Server error ${resp.status}`);
                }

                const json = await resp.json();

                if (json.status !== 'ok' || !json.results?.ai_detection) {
                    throw new Error(json.message || 'Invalid response from analysis service.');
                }

                // 4. Render results
                renderResults(json.results.ai_detection.data);

                // 5. Update Style Analysis if present
                if (json.results.stylometric_analysis && window.StyleAnalysis) {
                    window.StyleAnalysis.update(json.results.stylometric_analysis.data);
                }

                // 6. Update References Integrity if present
                if (json.results.citation_check && window.ReferencesIntegrity) {
                    window.ReferencesIntegrity.update(json.results.citation_check.data);
                }

            } catch (err) {
                console.error('[AIDetection]', err);
                showError(err.message || 'Analysis failed. Please try again.');
            } finally {
                setLoading(false);
            }
        });

        // ── Render helpers ───────────────────────────────────────────────────
        function renderResults(data) {
            const pct = data.ai_percentage ?? data.overall_summary?.total_ai_percentage ?? 0;
            const level = scoreLevel(pct);

            // Circular progress
            if (circleStroke) {
                const offset = CIRCUMFERENCE - (CIRCUMFERENCE * pct / 100);
                circleStroke.setAttribute('stroke-dashoffset', offset.toFixed(0));
                circleStroke.setAttribute('stroke', level.color);
            }
            if (circleText) {
                circleText.textContent = pct + '%';
            }

            // Badge — inject after analysis (badge is removed from static HTML)
            const headerRow = panel.querySelector('div[style*="justify-content:space-between"]');
            let badgeEl = document.getElementById('aiDetectionBadge');
            if (!badgeEl && headerRow) {
                badgeEl = document.createElement('span');
                badgeEl.id = 'aiDetectionBadge';
                badgeEl.style.fontSize = '10px';
                headerRow.appendChild(badgeEl);
            }
            if (badgeEl) {
                badgeEl.textContent = level.label;
                badgeEl.className = 'score-badge ' + level.cls;
            }

            // Probability label
            if (probLabel) {
                probLabel.textContent = 'AI Concentration';
            }
            if (probDesc) {
                const prediction = data.overall_summary?.overall_prediction || data.prediction || 'Unknown';
                if (prediction === 'AI') {
                    probDesc.textContent = 'Significant portions of the text match known LLM generative patterns.';
                } else if (prediction === 'Human') {
                    probDesc.textContent = 'The text shows natural human writing patterns.';
                } else {
                    probDesc.textContent = 'Analysis complete. Review the section breakdown below.';
                }
            }

            // Segments table
            if (tbody && Array.isArray(data.segments)) {
                tbody.innerHTML = '';
                data.segments.forEach((seg) => {
                    const score   = seg.score ?? 0;
                    const words   = wordCount(seg.text);
                    const preview = (seg.text || '').substring(0, 60).replace(/\s+/g, ' ');
                    const isHigh  = score >= 50;
                    const rowCls  = isHigh ? 'score-low' : 'score-high'; // CSS: score-low = red border, score-high = green
                    const tdColor = isHigh ? '#f87171' : '#34d399';

                    const tr = document.createElement('tr');
                    tr.className = rowCls;
                    tr.innerHTML = `
                        <td title="${escapeHtml(seg.text || '')}">Segment ${seg.segment_id}: ${escapeHtml(preview)}…</td>
                        <td style="text-align:right;">${words}</td>
                        <td style="text-align:right; font-weight:700; color:${tdColor};">${score}%</td>
                    `;
                    tbody.appendChild(tr);
                });
            }
        }

        // ── UI State Helpers ─────────────────────────────────────────────────
        function setLoading(on) {
            if (on) {
                btn.classList.add('is-loading');
                btn.disabled = true;
            } else {
                btn.classList.remove('is-loading');
                btn.disabled = false;
            }
        }

        function showError(msg) {
            if (errorSlot) {
                errorSlot.innerHTML = `<div class="ai-error-toast">${escapeHtml(msg)}</div>`;
            }
        }
        function clearError() {
            if (errorSlot) errorSlot.innerHTML = '';
        }

        function escapeHtml(str) {
            const d = document.createElement('div');
            d.textContent = str;
            return d.innerHTML;
        }
    });

})();
