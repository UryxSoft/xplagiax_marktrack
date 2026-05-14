/**
 * review_style_analysis.js
 * Semantic interpretation and UX visualization for stylometric metrics.
 * Transforms raw data into pedagogical and actionable insights.
 */

window.StyleAnalysis = (function() {
    'use strict';

    /**
     * Normalizes a value to a 0-100 scale based on an ideal range.
     * @param {number} val - Raw value
     * @param {number} ideal - Ideal value for human-like consistency
     * @param {number} range - Tolerance range before score hits 0
     */
    function normalize(val, ideal, range) {
        const diff = Math.abs(val - ideal);
        const score = Math.max(0, 100 - (diff / range) * 100);
        return score;
    }

    /**
     * Calculates the global Stylistic Consistency Score.
     */
    function calculateConsistencyScore(data) {
        // Weights for each component
        const weights = {
            variance: 0.30,  // structural variability
            burstiness: 0.25, // natural flow
            lexical: 0.25,    // vocabulary richness
            complexity: 0.20  // sentence structure
        };

        // Normalization (values based on typical human writing distributions)
        const s_var  = normalize(data.sentence_length_variance || 0, 20, 40);
        const s_burst = normalize(data.burstiness || 0, 0, 0.8);
        const s_lex   = normalize(data.lexical_diversity || 0, 0.7, 0.4);
        const s_comp  = normalize(data.complex_sentence_ratio || 0, 0.4, 0.4);

        const globalScore = (s_var * weights.variance) + 
                            (s_burst * weights.burstiness) + 
                            (s_lex * weights.lexical) + 
                            (s_comp * weights.complexity);

        return Math.round(globalScore);
    }

    /**
     * Returns the semantic label and CSS class based on the score.
     */
    function getSemanticLabel(score) {
        if (score >= 80) return { label: 'Highly Consistent', cls: 'score-high' };
        if (score >= 60) return { label: 'Generally Consistent', cls: 'score-medium' };
        if (score >= 40) return { label: 'Unusual Variance', cls: 'score-medium' };
        return { label: 'High Stylistic Irregularity', cls: 'score-low' };
    }

    /**
     * Maps raw metrics to qualitative descriptions.
     */
    function getMetricQualitative(val, ideal, range) {
        const score = normalize(val, ideal, range);
        if (score >= 80) return 'High';
        if (score >= 50) return 'Moderate';
        return 'Low';
    }

    /**
     * Generates a primary interpretive insight based on the overall data.
     */
    function generateInsight(score, data) {
        if (score >= 80) {
            return "The text maintains a very uniform style throughout the document, suggesting a cohesive writing process.";
        }
        if (score >= 60) {
            return "The style is generally stable, though some minor variations in sentence structure are present.";
        }
        
        // Specific issues for lower scores
        if (data.sentence_length_variance > 45) {
            return "Significant stylistic shifts detected. The variation in sentence length is unusually high, which may indicate different authors or sources.";
        }
        if (data.burstiness < -0.5) {
            return "The flow of the text is unusually mechanical. This lack of natural variation is often associated with non-human generation.";
        }
        
        return "Multiple stylistic inconsistencies detected. The writing patterns vary significantly between sections.";
    }

    /**
     * Updates the UI panel with interpreted data.
     */
    function updateUI(data) {
        const panel = document.getElementById('styleAnalysis');
        if (!panel) return;

        const score = calculateConsistencyScore(data);
        const semantic = getSemanticLabel(score);
        const insight = generateInsight(score, data);

        // 1. Update Header & Badge
        const badge = panel.querySelector('.score-badge');
        if (badge) {
            badge.textContent = semantic.label;
            badge.className = 'score-badge ' + semantic.cls;
        }

        // 2. Update Progress Meter
        const scoreVal = panel.querySelector('.score-value');
        const scoreFill = panel.querySelector('.score-fill');
        if (scoreVal) scoreVal.textContent = `${score}/100`;
        if (scoreFill) {
            scoreFill.style.width = `${score}%`;
            scoreFill.className = `score-fill score-fill-${semantic.cls.split('-')[1]}`;
        }

        // 3. Update Breakdown (Human Language)
        const breakdown = panel.querySelector('.score-breakdown');
        if (breakdown) {
            breakdown.innerHTML = `
                <div class="score-item">
                    <span>Vocabulary Variety</span>
                    <span style="color:#fff; font-weight:600;">${getMetricQualitative(data.lexical_diversity, 0.7, 0.4)}</span>
                </div>
                <div class="score-item">
                    <span>Structural Flow</span>
                    <span style="color:#fff; font-weight:600;">${getMetricQualitative(data.burstiness, 0, 0.8)}</span>
                </div>
                <div class="score-item">
                    <span>Grammatical Complexity</span>
                    <span style="color:#fff; font-weight:600;">${getMetricQualitative(data.complex_sentence_ratio, 0.4, 0.4)}</span>
                </div>
            `;
        }

        // 4. Update Insights Section
        let insightArea = document.getElementById('styleInsights');
        if (!insightArea) {
            const h4 = document.createElement('h4');
            h4.style.cssText = 'font-size:12px; text-transform:uppercase; letter-spacing:0.1em; color:rgba(255,255,255,0.4); margin: 20px 0 12px;';
            h4.textContent = 'Interpretive Insights';
            
            insightArea = document.createElement('div');
            insightArea.id = 'styleInsights';
            insightArea.style.cssText = 'background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); padding:16px; border-radius:12px; font-size:13px; line-height:1.5; color:rgba(255,255,255,0.8);';
            
            panel.appendChild(h4);
            panel.appendChild(insightArea);
        }
        insightArea.textContent = insight;

        // 5. Stylistic Shift Indicator
        const shiftDetected = (data.sentence_length_variance > 35 || Math.abs(data.burstiness) > 0.6);
        let shiftStatus = document.getElementById('styleShiftStatus');
        if (!shiftStatus) {
            const container = document.createElement('div');
            container.style.cssText = 'margin-top:20px; display:flex; justify-content:space-between; align-items:center; padding:12px; background:rgba(0,0,0,0.2); border-radius:10px; border:1px solid rgba(255,255,255,0.05);';
            container.innerHTML = `
                <span style="font-size:12px; font-weight:600;">Stylistic Shifts</span>
                <span id="styleShiftStatus" class="score-badge" style="font-size:10px;">Not Detected</span>
            `;
            panel.appendChild(container);
            shiftStatus = document.getElementById('styleShiftStatus');
        }
        
        if (shiftDetected) {
            shiftStatus.textContent = 'Detected';
            shiftStatus.className = 'score-badge score-low';
        } else {
            shiftStatus.textContent = 'Not Detected';
            shiftStatus.className = 'score-badge score-high';
        }
    }

    return {
        update: updateUI
    };

})();
