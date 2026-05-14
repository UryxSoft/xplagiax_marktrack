/**
 * review_media_integrity.js
 * Hooks into the existing aiAnalyzeBtn click to also scan all images
 * found in the Quill document. Results are shown in the "Media Integrity" tab.
 *
 * Endpoints used (via MarkTrack proxy, no X-API-Key needed):
 *   POST /api/media/ai-detection   { image_url }
 *   POST /api/media/plagiarism     { image_url, similarity_threshold }
 */

(function () {
    'use strict';

    const CSRF = () => document.querySelector('meta[name="csrf-token"]')?.content || '';

    // ── Image extraction from Quill ────────────────────────────────────────────
    /**
     * Collect all image URLs/src from the active Quill instance.
     * Returns an array of strings (data-URLs or absolute URLs).
     */
    function extractImagesFromQuill() {
        const quill = window.quillPagination?.quill;
        const urls = [];

        // Method 1: iterate Quill Delta ops
        if (quill) {
            const delta = quill.getContents();
            (delta.ops || []).forEach(op => {
                const insert = op.insert;
                if (insert && typeof insert === 'object') {
                    // Standard image blot
                    if (insert.image && typeof insert.image === 'string') {
                        urls.push(insert.image);
                    }
                    // Custom image blot (CustomImageBlot uses insert.customImage)
                    if (insert.customImage?.src) {
                        urls.push(insert.customImage.src);
                    }
                }
            });
        }

        // Method 2: fallback — scrape <img> tags from the editor DOM
        if (urls.length === 0) {
            const editorEl = document.querySelector('#editor-pages .ql-editor') ||
                             document.querySelector('.ql-editor');
            if (editorEl) {
                editorEl.querySelectorAll('img[src]').forEach(img => {
                    const src = img.getAttribute('src');
                    if (src) urls.push(src);
                });
            }
        }

        // Deduplicate
        return [...new Set(urls)];
    }

    // ── API calls ─────────────────────────────────────────────────────────────
    async function analyzeAIDetection(imageUrl) {
        const resp = await fetch('/api/media/ai-detection', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': CSRF() },
            body: JSON.stringify({ image_url: imageUrl }),
        });
        if (!resp.ok) throw new Error(`AI-detection HTTP ${resp.status}`);
        return resp.json();
    }

    async function analyzePlagiarism(imageUrl) {
        const resp = await fetch('/api/media/plagiarism', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': CSRF() },
            body: JSON.stringify({ image_url: imageUrl, similarity_threshold: 0.85 }),
        });
        if (!resp.ok) throw new Error(`Plagiarism HTTP ${resp.status}`);
        return resp.json();
    }

    // ── Rendering ─────────────────────────────────────────────────────────────
    function esc(s) {
        const d = document.createElement('div');
        d.textContent = String(s ?? '');
        return d.innerHTML;
    }

    function renderEmpty(panel) {
        panel.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                    padding:40px 20px;text-align:center;gap:12px;color:rgba(255,255,255,0.3);">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:.4">
                <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
            </svg>
            <p style="margin:0;font-size:13px;">No images found in this document.</p>
            <p style="margin:0;font-size:11px;opacity:.6;">Embed an image and click Analyze again.</p>
        </div>`;
    }

    function renderLoading(panel, count) {
        panel.innerHTML = `
        <div style="padding:20px 0;text-align:center;color:rgba(255,255,255,.5);font-size:13px;">
            <span style="display:inline-block;animation:spin 1s linear infinite;margin-right:8px;">⟳</span>
            Analysing ${count} image${count !== 1 ? 's' : ''}…
        </div>`;
    }

    function aiDetectionBadge(result) {
        if (!result || result.status === 'error') {
            return `<span style="color:rgba(255,255,255,0.3);font-size:11px;">N/A</span>`;
        }
        const isAI   = result.is_ai;
        const conf   = Math.round((result.confidence ?? result.ai_score ?? 0) * 100);
        const color  = isAI ? '#ef4444' : '#10b981';
        const label  = isAI ? 'AI Generated' : 'Human';
        return `<span style="background:${isAI ? 'rgba(239,68,68,0.15)' : 'rgba(16,185,129,0.15)'};
                             color:${color};border:1px solid ${color}33;
                             padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;">
                    ${label} ${conf}%
                </span>`;
    }

    function plagiarismBadge(result) {
        if (!result || result.status === 'error') {
            return `<span style="color:rgba(255,255,255,0.3);font-size:11px;">N/A</span>`;
        }
        if (!result.analyzed) {
            return `<span style="color:rgba(255,255,255,0.4);font-size:11px;">—</span>`;
        }
        const matches = result.total_matches ?? 0;
        const alert   = result.alert || (matches > 0 ? 'MATCH_FOUND' : 'CLEAR');
        const color   = matches > 0 ? '#f59e0b' : '#10b981';
        const label   = matches > 0 ? `${matches} match${matches !== 1 ? 'es' : ''}` : 'Clear';
        return `<span style="background:${matches > 0 ? 'rgba(245,158,11,0.15)' : 'rgba(16,185,129,0.15)'};
                             color:${color};border:1px solid ${color}33;
                             padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;">
                    ${label}
                </span>`;
    }

    function plagiarismMatchRows(result) {
        if (!result?.analyzed || !result.matches?.length) return '';
        return `
        <div style="margin-top:8px;display:flex;flex-direction:column;gap:4px;">
            ${result.matches.slice(0, 3).map(m => `
            <div style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);
                        border-radius:6px;padding:6px 10px;font-size:11px;color:rgba(255,255,255,0.7);">
                <strong style="color:#fbbf24;">${esc(m.match_type)}</strong>
                · ${Math.round((m.similarity_percent ?? m.score * 100) ?? 0)}% similar
                ${m.filename ? `· <em>${esc(m.filename)}</em>` : ''}
            </div>`).join('')}
        </div>`;
    }

    function isThumbnailUrl(url) {
        // Data URLs are large; show a placeholder instead
        return url && !url.startsWith('data:');
    }

    function renderResults(panel, images, results) {
        panel.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:16px;">
            ${images.map((url, i) => {
                const r     = results[i] || {};
                const aiRes = r.ai   || null;
                const plRes = r.plg  || null;
                const thumb = isThumbnailUrl(url)
                    ? `<img src="${esc(url)}" alt="img" style="width:100%;height:80px;object-fit:cover;border-radius:6px;display:block;"
                            onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">`
                    : '';
                const dataUrlPlaceholder = !isThumbnailUrl(url)
                    ? `<div style="width:100%;height:80px;background:rgba(255,255,255,0.05);
                                   border-radius:6px;display:flex;align-items:center;justify-content:center;
                                   font-size:11px;color:rgba(255,255,255,0.3);">Embedded image</div>`
                    : `<div style="display:none;width:100%;height:80px;background:rgba(255,255,255,0.05);
                                   border-radius:6px;align-items:center;justify-content:center;
                                   font-size:11px;color:rgba(255,255,255,0.3);">Preview unavailable</div>`;

                return `
                <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);
                            border-radius:12px;overflow:hidden;">
                    <!-- Thumbnail -->
                    <div style="padding:12px 12px 0;">
                        ${thumb}${dataUrlPlaceholder}
                    </div>
                    <!-- Results -->
                    <div style="padding:12px;display:flex;flex-direction:column;gap:8px;">
                        <div style="font-size:11px;font-weight:700;text-transform:uppercase;
                                    letter-spacing:.06em;color:rgba(255,255,255,0.4);">
                            Image ${i + 1}
                        </div>
                        <!-- AI Detection row -->
                        <div style="display:flex;justify-content:space-between;align-items:center;">
                            <span style="font-size:12px;color:rgba(255,255,255,0.6);">AI Detection</span>
                            ${aiDetectionBadge(aiRes)}
                        </div>
                        <!-- Plagiarism row -->
                        <div style="display:flex;justify-content:space-between;align-items:center;">
                            <span style="font-size:12px;color:rgba(255,255,255,0.6);">Plagiarism</span>
                            ${plagiarismBadge(plRes)}
                        </div>
                        ${plagiarismMatchRows(plRes)}
                    </div>
                </div>`;
            }).join('')}
        </div>`;
    }

    // ── Main analysis runner ──────────────────────────────────────────────────
    async function runMediaAnalysis() {
        const panel = document.getElementById('mediaIntegrityPanel');
        if (!panel) return;

        // Switch to the Media Integrity tab to show progress
        const images = extractImagesFromQuill();
        if (images.length === 0) {
            renderEmpty(panel);
            const badge = document.querySelector('#mediaIntegrityTab .mi-count-badge');
            if (badge) badge.style.display = 'none';
            return;
        }

        // Update badge with image count
        const badge = document.querySelector('#mediaIntegrityTab .mi-count-badge');
        if (badge) { badge.textContent = images.length; badge.style.display = 'inline-flex'; }
        renderLoading(panel, images.length);

        // Run all requests concurrently per image
        const results = await Promise.all(images.map(async (url) => {
            // Only analyse remote URLs with the microservice (data: URIs can't be fetched remotely)
            if (!isThumbnailUrl(url)) return { ai: null, plg: null };
            const [ai, plg] = await Promise.allSettled([
                analyzeAIDetection(url),
                analyzePlagiarism(url),
            ]);
            return {
                ai:  ai.status  === 'fulfilled' ? ai.value  : { status: 'error', message: ai.reason?.message },
                plg: plg.status === 'fulfilled' ? plg.value : { status: 'error', message: plg.reason?.message },
            };
        }));

        renderResults(panel, images, results);
    }

    // ── Initialisation ────────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', function () {
        const analyzeBtn = document.getElementById('aiAnalyzeBtn');
        if (!analyzeBtn) return;

        // Hook into the existing Analyze button click (run after a tick so
        // the primary AI-detection handler runs first)
        analyzeBtn.addEventListener('click', function () {
            setTimeout(runMediaAnalysis, 100);
        });
    });

})();
