/**
 * review_references_integrity.js
 * Semantic interpretation and UX visualization for citation/reference checks.
 * Converts technical verification metrics into academic integrity insights.
 */

window.ReferencesIntegrity = (function() {
    'use strict';

    /**
     * Maps score to semantic labels and CSS classes.
     */
    function getLabel(score, totalRefs) {
        if (totalRefs === 0) return { label: 'No References', cls: 'score-medium' };
        if (score >= 80)    return { label: 'Reliable', cls: 'score-high' };
        if (score >= 60)    return { label: 'Mostly Reliable', cls: 'score-medium' };
        if (score >= 40)    return { label: 'Needs Review', cls: 'score-medium' };
        return { label: 'High Risk', cls: 'score-low' };
    }

    /**
     * Calculates the global Source Reliability Score.
     */
    function calculateScore(data) {
        if (data.total_references === 0) return 0;

        const details = data.feature_details || {};
        const fabricated = details.fabricated_ratio?.value || 0;
        const chimeric   = details.chimeric_ratio?.value || 0;
        const confidence = details.mean_confidence?.value || 100;

        let score = 100;
        score -= fabricated * 50;
        score -= chimeric * 30;
        score -= (100 - confidence) * 0.2;

        return Math.max(0, Math.min(100, Math.round(score)));
    }

    /**
     * Generates a pedagogical insight summary.
     */
    function generateSummary(score, data) {
        if (data.total_references === 0) {
            return "No references were found in this document. Consider adding sources to support your work.";
        }
        if (score >= 80) {
            return "All references in this document appear to be valid and properly used.";
        }
        if (score >= 60) {
            return "Most sources used are verifiable, though some minor inconsistencies were detected.";
        }
        
        const details = data.feature_details || {};
        if (details.fabricated_ratio?.value > 0.3) {
            return "Significant risk detected: several references appear to be fabricated or non-existent.";
        }
        if (details.mean_confidence?.value < 40) {
            return "Low confidence: many sources could not be verified against academic databases.";
        }
        
        return "Multiple issues found in the reference list. Critical review of sources is recommended.";
    }

    /**
     * Maps technical metrics to qualitative UX labels.
     */
    function getMetricLabel(val, type) {
        if (type === 'authenticity') {
            if (val < 0.1) return 'High';
            if (val < 0.3) return 'Moderate';
            return 'Low';
        }
        if (type === 'verification') {
            if (val > 80) return 'High Confidence';
            if (val > 50) return 'Moderate';
            return 'Low Confidence';
        }
        if (type === 'integration') {
            if (val < 0.2) return 'Well Integrated';
            return 'Over-cited / Ornamental';
        }
        return '—';
    }

    /**
     * Main update function to populate the UI.
     */
    function updateUI(data) {
        const panel = document.getElementById('referencesIntegrity');
        if (!panel) return;

        const score = calculateScore(data);
        const total = data.total_references || 0;
        const semantic = getLabel(score, total);
        const summary = generateSummary(score, data);
        const details = data.feature_details || {};

        // 1. Update Badge & Score
        const badge = document.getElementById('refSemanticLabel');
        const scoreVal = document.getElementById('refScoreVal');
        const scoreFill = document.getElementById('refScoreFill');

        if (badge) {
            badge.textContent = semantic.label;
            badge.className = 'score-badge ' + semantic.cls;
        }
        if (scoreVal) scoreVal.textContent = total === 0 ? '—/100' : `${score}/100`;
        if (scoreFill) {
            scoreFill.style.width = total === 0 ? '0%' : `${score}%`;
            scoreFill.className = `score-fill score-fill-${semantic.cls.split('-')[1]}`;
        }

        // 2. Update Insight Box
        const insightBox = panel.querySelector('.insight-box p');
        if (insightBox) insightBox.textContent = summary;

        // 3. Update Breakdown
        const breakdown = document.getElementById('refBreakdown');
        if (breakdown) {
            if (total === 0) {
                breakdown.innerHTML = `
                    <div class="score-item"><span>Authenticity</span><span style="color:rgba(255,255,255,0.2);">—</span></div>
                    <div class="score-item"><span>Verification</span><span style="color:rgba(255,255,255,0.2);">—</span></div>
                    <div class="score-item"><span>Usage Quality</span><span style="color:rgba(255,255,255,0.2);">—</span></div>
                `;
            } else {
                breakdown.innerHTML = `
                    <div class="score-item">
                        <span>Reference Authenticity</span>
                        <span style="color:#fff; font-weight:600;">${getMetricLabel(details.fabricated_ratio?.value || 0, 'authenticity')}</span>
                    </div>
                    <div class="score-item">
                        <span>Verification Level</span>
                        <span style="color:#fff; font-weight:600;">${getMetricLabel(details.mean_confidence?.value || 0, 'verification')}</span>
                    </div>
                    <div class="score-item">
                        <span>Usage Quality</span>
                        <span style="color:#fff; font-weight:600;">${getMetricLabel(details.ornamental_ratio?.value || 0, 'integration')}</span>
                    </div>
                `;
            }
        }

        // 4. Render References List
        const listContainer = document.getElementById('refList');
        const emptyState = document.getElementById('refEmptyState');
        
        if (total === 0) {
            if (listContainer) listContainer.style.display = 'none';
            if (emptyState) emptyState.style.display = 'block';
        } else {
            if (emptyState) emptyState.style.display = 'none';
            if (listContainer) {
                listContainer.style.display = 'block';
                const body = document.getElementById('refListBody');
                if (body && Array.isArray(data.references)) {
                    body.innerHTML = '';
                    data.references.forEach(ref => {
                        const item = document.createElement('div');
                        const isVerified = (ref.confidence || 0) > 50;
                        item.className = `reference-item ${isVerified ? 'verified' : 'unverified'}`;
                        item.innerHTML = `
                            <span class="ref-status">${isVerified ? 'Verified' : 'Unverified'}</span>
                            <p>${escapeHtml(ref.raw_text || 'Unknown Reference')}</p>
                        `;
                        body.appendChild(item);
                    });
                }
            }
        }
    }

    function escapeHtml(str) {
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

    return {
        update: updateUI
    };

})();
