/**
 * AI Image Analysis System
 * Handles image detection in editor, batch analysis (AI vs Human + Reverse Search),
 * and rendering results in the sidebar.
 */
class AIImageAnalysis {
    constructor() {
        this.analyzing = false;
        this.resultsContainer = document.getElementById('plagiarismResults');
        this.webCount = document.getElementById('webHighlightCount');
        this.aiCount = document.getElementById('aiHighlightCount');
        this.imageCount = document.getElementById('imageHighlightCount');

        // Apply scroll styles
        if (this.resultsContainer) {
            this.resultsContainer.style.maxHeight = '600px';
            this.resultsContainer.style.overflowY = 'auto';
            this.resultsContainer.style.overflowX = 'hidden';
            this.resultsContainer.style.paddingRight = '5px'; // Prevent scrollbar overlap
        }

        this.init();
    }

    init() {
        console.log('[AIImageAnalysis] Initialized');

        // Button Listener
        const btn = document.getElementById('imgSearchBtn');
        if (btn) {
            // Remove old placeholder listeners if any (cloning handles it or we just add new)
            // Just adding new one is fine as long as we don't duplicate logic.
            // But wait, I added a placeholder alert earlier. 
            // Better to replace the button to clear listeners or just add this one and ensure it overrides/coexists.
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation(); // Stop placeholder
                this.analyzeImages();
            });
        }

        // Auto-save listener (custom event)
        document.addEventListener('documentSaved', () => {
            // Optional: Debounce or check settings before auto-analyzing images
            // For now, let's only analyze on button click to save resources/quota as per "Optimización"
            // But user asked for "Cada vez que ocurra... El documento se guarda automáticamente...".
            // I'll implement it but maybe with a flag or check.
            // Actually, complying strictly:
            this.analyzeImages(true); // isAutoSave = true
        });
    }

    /**
     * Detects images in the Quill editor.
     * @returns {Array} List of image objects {id, src}
     */
    detectImages() {
        const images = [];
        const imgs = document.querySelectorAll('.ql-editor img');

        imgs.forEach((img, index) => {
            // Generate a temp ID if not present
            if (!img.id) {
                img.id = `ai-img-${Date.now()}-${index}`;
            }

            images.push({
                id: img.id,
                src: img.src
            });
        });

        return images;
    }

    async analyzeImages(isAutoSave = false) {
        if (this.analyzing) return;

        const images = this.detectImages();

        if (images.length === 0) {
            if (!isAutoSave) {
                this.renderEmptyState("No images found in document.");
                if (window.showToast) window.showToast("No images found to analyze", "info");
            }
            return;
        }

        this.analyzing = true;

        // Clear previous results
        if (this.resultsContainer) this.resultsContainer.innerHTML = '';

        // Render placeholders
        images.forEach(img => {
            this.renderPlaceholder(img);
        });

        // Process each image in parallel
        const promises = images.map(img => this.analyzeSingleImage(img));

        try {
            await Promise.allSettled(promises);
            if (window.showToast && !isAutoSave) window.showToast("Analysis complete", "success");
        } finally {
            this.analyzing = false;
        }
    }

    renderPlaceholder(img) {
        if (!this.resultsContainer) return;

        const card = document.createElement('div');
        card.className = 'ai-card';
        card.id = `card-${img.id}`;
        card.style.borderLeft = '3px solid #e5e7eb'; // Default gray

        card.innerHTML = `
            <div class="ai-card-top" style="align-items: flex-start;">
                <div style="width:40px; height:40px; background:#f0f0f0; border-radius:4px; overflow:hidden; flex-shrink:0;">
                    <img src="${img.src}" style="width:100%; height:100%; object-fit:cover;">
                </div>
                <div style="flex:1; margin-left:10px;">
                     <div class="ai-card-content" id="ai-res-${img.id}">
                        <div style="display:flex; align-items:center; gap:6px; color:#666; font-size:0.8rem;">
                            <svg class="lucide lucide-loader spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>
                            Checking AI...
                        </div>
                     </div>
                </div>
            </div>
            <div class="ai-card-content" id="rev-res-${img.id}" style="margin-top:8px; padding-top:8px; border-top:1px dashed var(--border);">
                 <div style="display:flex; align-items:center; gap:6px; color:#666; font-size:0.75rem;">
                    <svg class="lucide lucide-loader spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>
                    Searching web...
                 </div>
            </div>
        `;

        this.resultsContainer.appendChild(card);
    }

    async analyzeSingleImage(img) {
        const card = document.getElementById(`card-${img.id}`);
        const aiContainer = document.getElementById(`ai-res-${img.id}`);
        const revContainer = document.getElementById(`rev-res-${img.id}`);

        // Prepare FormData
        const formData = new FormData();
        let isUrl = true;

        if (img.src.startsWith('data:')) {
            isUrl = false;
            const blob = await this._urlToBlob(img.src);
            formData.append('file', blob, 'image.jpg');
        } else {
            formData.append('image_url', img.src);
        }

        // 1. AI Detection
        this._fetchAiDetection(formData, aiContainer, card);

        // 2. Reverse Search (Requires file for upload if base64, or url)
        // We can reuse the same formData logic since we updated endpoints to match
        this._fetchReverseSearch(formData, revContainer);
    }

    async _fetchAiDetection(formData, container, card) {
        try {
            const response = await fetch('/ai_image/analyze_ai_detection', {
                method: 'POST',
                body: formData,
                headers: {
                    'X-CSRFToken': document.querySelector('meta[name="csrf-token"]').content
                }
            });
            const data = await response.json();

            if (response.ok) {
                const isAi = data.is_ai;
                const conf = Math.round(data.confidence * 100);

                // Update Card Border
                if (card) {
                    card.style.borderLeft = isAi ? '3px solid #ef4444' : '3px solid #10b981';
                }

                container.innerHTML = `
                    <strong>AI Detection:</strong> 
                    <span class="badgex ${isAi ? 'badge-danger' : 'badge-success'}" 
                          style="background:${isAi ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)'}; 
                                 color:${isAi ? '#ef4444' : '#047857'}; 
                                 padding:2px 6px; 
                                 border-radius:4px; 
                                 font-size:0.7rem; 
                                 font-weight:700;">
                        ${isAi ? 'AI Generated' : 'Human'} (${conf}%)
                    </span>
                `;

                // Update Counts
                if (isAi && this.aiCount) {
                    this.aiCount.textContent = parseInt(this.aiCount.textContent || '0') + 1;
                }
            } else {
                container.innerHTML = `<span style="color:#ef4444; font-size:0.75rem;">AI check failed</span>`;
            }
        } catch (e) {
            console.error(e);
            container.innerHTML = `<span style="color:#ef4444; font-size:0.75rem;">Error</span>`;
        }
    }

    async _fetchReverseSearch(formData, container) {
        try {
            const response = await fetch('/ai_image/reverse_image_search', {
                method: 'POST',
                body: formData,
                headers: {
                    'X-CSRFToken': document.querySelector('meta[name="csrf-token"]').content
                }
            });
            const data = await response.json();

            if (response.ok && data.results && data.results.image_results) {
                const matches = data.results.image_results;
                if (matches.length > 0) {
                    container.innerHTML = `
                       <div style="font-size:0.75rem; font-weight:700; color:var(--text); margin-bottom:4px;">WEB MATCHES</div>
                       ${matches.slice(0, 2).map(m => `
                           <div style="font-size:0.75rem; margin-bottom:4px;">
                               <a href="${m.link}" target="_blank" style="color:var(--primary); text-decoration:none;">${m.source || 'Unknown Source'}</a>
                           </div>
                       `).join('')}
                    `;
                    if (this.imageCount) {
                        this.imageCount.textContent = parseInt(this.imageCount.textContent || '0') + 1;
                    }
                } else {
                    container.innerHTML = `<div style="font-size:0.75rem; color:#999;">No web matches found</div>`;
                }
            } else {
                const errMsg = data.error || 'Search failed';
                container.innerHTML = `<div style="font-size:0.75rem; color:#f59e0b;">${errMsg}</div>`;
            }
        } catch (e) {
            console.error(e);
            container.innerHTML = `<div style="font-size:0.75rem; color:#f59e0b;">Network error</div>`;
        }
    }

    async _urlToBlob(url) {
        const res = await fetch(url);
        return await res.blob();
    }

    renderResults(results) {
        if (!this.resultsContainer) return;

        this.resultsContainer.innerHTML = '';

        if (!results || results.length === 0) {
            this.renderEmptyState("No results returned.");
            return;
        }

        let aiCount = 0;
        let imageCount = 0;

        results.forEach(result => {
            const card = document.createElement('div');
            card.className = 'ai-card';
            // Determine border color based on result
            let borderColor = 'transparent';
            if (result.ai_detection && result.ai_detection.is_ai) borderColor = '#ef4444'; // Red for AI
            else if (result.ai_detection && result.ai_detection.is_human) borderColor = '#10b981'; // Green for Human
            card.style.borderLeft = `3px solid ${borderColor}`;

            // Image Thumbnail
            const imgElement = document.getElementById(result.id);
            let imgSrc = imgElement ? imgElement.src : '';

            let aiHtml = '';
            if (result.ai_detection) {
                const isAi = result.ai_detection.is_ai;
                const conf = Math.round(result.ai_detection.confidence * 100);
                aiHtml = `
                    <div class="ai-card-content">
                        <strong>AI Detection:</strong> 
                        <span class="badgex ${isAi ? 'badge-danger' : 'badge-success'}" 
                              style="background:${isAi ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)'}; 
                                     color:${isAi ? '#ef4444' : '#047857'}; 
                                     padding:2px 6px; 
                                     border-radius:4px; 
                                     font-size:0.7rem; 
                                     font-weight:700;">
                            ${isAi ? 'AI Generated' : 'Human'} (${conf}%)
                        </span>
                    </div>
                 `;
                if (isAi) aiCount++;
            }

            let revHtml = '';
            let hasMatches = false;
            if (result.reverse_search && !result.reverse_search.error) {
                const matches = result.reverse_search.image_results || [];
                if (matches.length > 0) {
                    hasMatches = true;
                    imageCount++;
                    revHtml = `
                        <div class="ai-card-content" style="margin-top:8px; padding-top:8px; border-top:1px dashed var(--border);">
                           <div style="font-size:0.75rem; font-weight:700; color:var(--text); margin-bottom:4px;">WEB MATCHES</div>
                           ${matches.slice(0, 2).map(m => `
                               <div style="font-size:0.75rem; margin-bottom:4px;">
                                   <a href="${m.link}" target="_blank" style="color:var(--primary); text-decoration:none;">${m.source || 'Unknown Source'}</a>
                               </div>
                           `).join('')}
                        </div>
                     `;
                } else {
                    revHtml = `<div class="ai-card-content" style="font-size:0.75rem; color:#999;">No web matches found</div>`;
                }
            } else if (result.reverse_search && result.reverse_search.error) {
                // Show specific error (e.g., "Requires public URL")
                revHtml = `<div class="ai-card-content" style="font-size:0.75rem; color:#f59e0b;">${result.reverse_search.error}</div>`;
            }

            card.innerHTML = `
                <div class="ai-card-top" style="align-items: flex-start;">
                    <div style="width:40px; height:40px; background:#f0f0f0; border-radius:4px; overflow:hidden; flex-shrink:0;">
                        ${imgSrc ? `<img src="${imgSrc}" style="width:100%; height:100%; object-fit:cover;">` : ''}
                    </div>
                    <div style="flex:1; margin-left:10px;">
                        ${aiHtml}
                    </div>
                </div>
                ${revHtml}
             `;

            this.resultsContainer.appendChild(card);
        });

        // Update counts
        if (this.aiCount) this.aiCount.textContent = aiCount;
        if (this.imageCount) this.imageCount.textContent = imageCount;
    }

    updateLoadingState(loading) {
        if (!this.resultsContainer) return;
        if (loading) {
            this.resultsContainer.innerHTML = `
                <div class="ai-empty-state">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-loader spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>
                    <div style="margin-top:8px;">Analyzing images...</div>
                </div>
            `;
        }
    }

    renderEmptyState(message) {
        if (!this.resultsContainer) return;
        this.resultsContainer.innerHTML = `<div class="ai-empty-state">${message}</div>`;
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.aiImageAnalysis = new AIImageAnalysis();
});
