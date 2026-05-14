// ===================================================================
// MARKTRACK + QUILL INTEGRATION - PLAGIARISM DETECTOR (FIXED)
// Versión corregida que funciona correctamente con Quill.js
// ===================================================================

const PlagiarismDetector = {
    // Detection results storage
    webMatches: [],
    aiMatches: [],
    imageMatches: [],

    // Active highlights
    activeHighlights: {
        web: [],
        ai: [],
        images: []
    },

    // Configuration
    config: {
        webColor: '#ff9800',      // Orange
        aiColor: '#ff5252',       // Soft red
        imageColor: '#9c27b0',    // Purple
        minMatchPercentage: 30,
        tooltipDelay: 300
    },

    // ===============================================================
    // INITIALIZATION
    // ===============================================================
    init() {
        this.setupEventListeners();
        console.log('✓ Plagiarism Detector initialized');
    },

    // ===============================================================
    // EVENT LISTENERS
    // ===============================================================
    setupEventListeners() {
        const webSearchBtn = document.getElementById('webSearchBtn');
        if (webSearchBtn) {
            webSearchBtn.addEventListener('click', () => this.searchWeb());
        }

        const aiSearchBtn = document.getElementById('aiSearchBtn');
        if (aiSearchBtn) {
            aiSearchBtn.addEventListener('click', () => this.searchAI());
        }

        const imgSearchBtn = document.getElementById('imgSearchBtn');
        if (imgSearchBtn) {
            imgSearchBtn.addEventListener('click', () => this.searchImages());
        }

        const clearBtn = document.getElementById('clearHighlightsBtn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => this.clearAllHighlights());
        }
    },

    // ===============================================================
    // WEB PLAGIARISM DETECTION
    // ===============================================================
    async searchWeb() {
        this.showLoadingState('web');

        try {
            // Get text from editor
            let fullText = "";
            const quillPagination = window.quillPagination;
            if (quillPagination && quillPagination.quillInstances) {
                // Combine text from all pages
                quillPagination.quillInstances.forEach(quill => {
                    fullText += quill.getText() + "\n\n";
                });
            } else if (window.quill) {
                fullText = window.quill.getText();
            }

            if (!fullText || fullText.trim().length === 0) {
                console.warn("No text to check");
                this.hideLoadingState('web');
                return;
            }

            const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');

            const response = await fetch('/ai_writing_bp/check_plagiarism', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': csrfToken
                },
                body: JSON.stringify({ text: fullText })
            });

            if (!response.ok) throw new Error('Network response was not ok');
            const data = await response.json();

            // Transform backend results to frontend format
            const results = data.results.map(item => {
                const match = item.matches[0]; // Take top match

                // Generate logo URL from domain
                let logo = '';
                try {
                    const url = new URL(match.link);
                    logo = `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=32`;
                } catch (e) {
                    console.error("Error parsing URL for favicon", e);
                }

                return {
                    text: item.text,
                    source: match.title,
                    sourceUrl: match.link,
                    snippet: match.snippet,
                    matchPercentage: 100,
                    logo: logo
                };
            });

            this.webMatches = results;
            this.highlightTextMatches(results, 'web', this.config.webColor);
            this.updateResultsPanel('web', results);

            if (results.length === 0) {
                const resultsContainer = document.getElementById('plagiarismResults');
                if (resultsContainer) {
                    resultsContainer.innerHTML = '<div class="no-results">No plagiarism detected. Good job!</div>';
                }
            }

            console.log(`✓ Web detection complete: ${results.length} matches found`);

        } catch (error) {
            console.error("Error checking plagiarism:", error);
            alert("Error checking plagiarism. Please try again.");
        } finally {
            this.hideLoadingState('web');
        }
    },

    // ===============================================================
    // AI-GENERATED CONTENT DETECTION
    // ===============================================================
    async searchAI() {
        this.showLoadingState('ai');

        const results = await this.simulateAIDetection();

        this.aiMatches = results;
        this.highlightTextMatches(results, 'ai', this.config.aiColor);
        this.updateResultsPanel('ai', results);
        this.hideLoadingState('ai');

        console.log('✓ AI detection complete:', results.length, 'matches found');
    },

    simulateAIDetection() {
        return new Promise(resolve => {
            setTimeout(() => {
                resolve([
                    {
                        text: "Learning of the ghost from Horatio, Hamlet resolves to see it himself.",
                        source: "AI Detection - GPT Pattern",
                        sourceUrl: "#",
                        matchPercentage: 78,
                        logo: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23ff5252'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z'/%3E%3C/svg%3E"
                    },
                    {
                        text: "The prince confides to Horatio and the sentries that from now on he plans to put an antic disposition on, or act as though he has gone mad.",
                        source: "AI Detection - High Perplexity",
                        sourceUrl: "#",
                        matchPercentage: 85,
                        logo: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23ff5252'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z'/%3E%3C/svg%3E"
                    }
                ]);
            }, 1800);
        });
    },

    // ===============================================================
    // IMAGE PLAGIARISM DETECTION
    // ===============================================================
    async searchImages() {
        this.showLoadingState('image');

        const results = await this.simulateImageDetection();

        this.imageMatches = results;
        this.highlightImages(results);
        this.updateResultsPanel('image', results);
        this.hideLoadingState('image');

        console.log('✓ Image detection complete:', results.length, 'matches found');
    },

    simulateImageDetection() {
        return new Promise(resolve => {
            setTimeout(() => {
                resolve([
                    {
                        imageUrl: "sample-image.jpg",
                        source: "Getty Images",
                        sourceUrl: "https://www.gettyimages.com",
                        matchPercentage: 98,
                        logo: "https://www.gettyimages.com/favicon.ico"
                    }
                ]);
            }, 2000);
        });
    },

    // ===============================================================
    // TEXT HIGHLIGHTING (FIXED VERSION)
    // ===============================================================
    highlightTextMatches(matches, type, color) {
        console.log(`Buscando ${matches.length} coincidencias de tipo ${type}...`);

        // Get Quill instances
        const quillPagination = window.quillPagination;
        if (!quillPagination || !quillPagination.quillInstances) {
            console.error('❌ Quill instances no disponibles');
            console.log('Verificar que quillPagination esté inicializado');
            return;
        }

        let totalFound = 0;

        matches.forEach((match, matchIndex) => {
            quillPagination.quillInstances.forEach((quill, pageIndex) => {
                const editor = quill.root;
                const editorText = quill.getText();

                // Buscar el texto en el contenido
                const matchTextIndex = editorText.indexOf(match.text);

                if (matchTextIndex !== -1) {
                    console.log(`✓ Coincidencia encontrada en página ${pageIndex}: "${match.text.substring(0, 50)}..."`);
                    totalFound++;

                    // Método mejorado: manipular DOM directamente
                    this.highlightTextInDOM(editor, match.text, type, color, matchIndex, pageIndex, match);
                } else {
                    console.log(`✗ No encontrado en página ${pageIndex}: "${match.text.substring(0, 50)}..."`);
                }
            });
        });

        console.log(`Total encontrado: ${totalFound} de ${matches.length} coincidencias`);
        this.updateHighlightCount(type);
    },

    // ===============================================================
    // DOM MANIPULATION FOR HIGHLIGHTING
    // ===============================================================
    highlightTextInDOM(container, searchText, type, color, matchIndex, pageIndex, matchData) {
        const walker = document.createTreeWalker(
            container,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );

        let node;
        const nodesToHighlight = [];

        // Encontrar todos los nodos de texto que contienen el searchText
        while (node = walker.nextNode()) {
            const text = node.textContent;
            const index = text.indexOf(searchText);

            if (index !== -1) {
                nodesToHighlight.push({
                    node: node,
                    index: index,
                    length: searchText.length
                });
            }
        }

        // Aplicar highlights
        nodesToHighlight.forEach((item) => {
            const { node, index, length } = item;
            const highlightId = `${type}-highlight-${matchIndex}-${pageIndex}-${Date.now()}`;

            // Crear el wrapper span
            const span = document.createElement('span');
            span.className = `plagiarism-highlight ${type}-highlight`;
            span.dataset.highlightId = highlightId;
            span.dataset.type = type;
            span.style.backgroundColor = color;
            span.style.borderBottom = `2px solid ${this.darkenColor(color)}`;
            span.style.cursor = 'help';
            span.style.position = 'relative';
            span.style.display = 'inline';
            span.style.padding = '2px 0';

            // Extraer el texto a resaltar
            const beforeText = node.textContent.substring(0, index);
            const highlightText = node.textContent.substring(index, index + length);
            const afterText = node.textContent.substring(index + length);

            // Crear nuevos nodos de texto
            const parent = node.parentNode;

            if (beforeText) {
                parent.insertBefore(document.createTextNode(beforeText), node);
            }

            span.textContent = highlightText;
            parent.insertBefore(span, node);

            if (afterText) {
                parent.insertBefore(document.createTextNode(afterText), node);
            }

            // Remover el nodo original
            parent.removeChild(node);

            // Store highlight reference
            this.activeHighlights[type].push({
                id: highlightId,
                element: span,
                quillIndex: pageIndex,
                match: matchData
            });

            // Add tooltip
            this.attachTooltipToElement(span, matchData, type);

            console.log(`✓ Highlight aplicado: ${highlightId}`);
        });
    },

    // ===============================================================
    // TOOLTIP SYSTEM (FIXED)
    // ===============================================================
    attachTooltipToElement(element, match, type) {
        let tooltip = null;
        let tooltipTimeout = null;

        element.addEventListener('mouseenter', (e) => {
            tooltipTimeout = setTimeout(() => {
                tooltip = this.createTooltip(match, type);
                document.body.appendChild(tooltip);
                this.positionTooltip(tooltip, element);
                console.log('Tooltip mostrado');
            }, this.config.tooltipDelay);
        });

        element.addEventListener('mouseleave', () => {
            clearTimeout(tooltipTimeout);
            if (tooltip && tooltip.parentNode) {
                tooltip.remove();
                tooltip = null;
            }
        });

        element.addEventListener('mousemove', (e) => {
            if (tooltip) {
                this.positionTooltip(tooltip, element);
            }
        });
    },

    createTooltip(match, type) {
        const tooltip = document.createElement('div');
        tooltip.className = `plagiarism-tooltip ${type}-tooltip`;

        let colorClass = '';
        if (type === 'web') colorClass = 'web-color';
        else if (type === 'ai') colorClass = 'ai-color';
        else if (type === 'image') colorClass = 'image-color';

        tooltip.innerHTML = `
            <div class="tooltip-header ${colorClass}">
                <div class="tooltip-logo">
                    ${match.logo ? `<img src="${match.logo}" alt="source" onerror="this.style.display='none'">` : ''}
                </div>
                <div class="tooltip-title">${this.escapeHtml(match.source)}</div>
            </div>
            <div class="tooltip-body">
                <div class="tooltip-match">
                    <span class="match-label">Match:</span>
                    <span class="match-value ${colorClass}">${match.matchPercentage}%</span>
                </div>
                ${match.sourceUrl !== '#' ? `
                <div class="tooltip-link">
                    <a href="${this.escapeHtml(match.sourceUrl)}" target="_blank" rel="noopener">
                        Ver fuente →
                    </a>
                </div>
                ` : ''}
            </div>
        `;

        return tooltip;
    },

    positionTooltip(tooltip, element) {
        const rect = element.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();

        let top = rect.top - tooltipRect.height - 10 + window.scrollY;
        let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2) + window.scrollX;

        if (top < window.scrollY + 10) {
            top = rect.bottom + 10 + window.scrollY;
        }
        if (left < 10) {
            left = 10;
        }
        if (left + tooltipRect.width > window.innerWidth - 10) {
            left = window.innerWidth - tooltipRect.width - 10;
        }

        tooltip.style.top = `${top}px`;
        tooltip.style.left = `${left}px`;
    },

    // ===============================================================
    // IMAGE HIGHLIGHTING
    // ===============================================================
    highlightImages(matches) {
        const quillPagination = window.quillPagination;
        if (!quillPagination || !quillPagination.quillInstances) {
            console.warn('Quill instances not available');
            return;
        }

        quillPagination.quillInstances.forEach((quill, pageIndex) => {
            const editor = quill.root;
            const images = editor.querySelectorAll('img');

            images.forEach((img, imgIndex) => {
                const match = matches[imgIndex % matches.length];

                if (match) {
                    const highlightId = `image-highlight-${imgIndex}-${pageIndex}`;

                    img.style.outline = `4px solid ${this.config.imageColor}`;
                    img.style.outlineOffset = '2px';
                    img.style.cursor = 'pointer';
                    img.dataset.highlightId = highlightId;
                    img.classList.add('plagiarism-image-highlight');

                    this.activeHighlights.images.push({
                        id: highlightId,
                        element: img,
                        match: match
                    });

                    this.attachTooltipToElement(img, match, 'image');
                }
            });
        });

        this.updateHighlightCount('image');
    },

    // ===============================================================
    // RESULTS PANEL
    // ===============================================================
    updateResultsPanel(type, results) {
        const resultsContainer = document.getElementById('plagiarismResults');
        if (!resultsContainer) return;

        const typeLabel = type === 'web' ? 'Web Matches' :
            type === 'ai' ? 'AI-Generated' :
                'Image Matches';

        const resultHtml = `
            <div class="plagiarism-result-section ${type}-section">
                <div class="result-header">
                    <h4>${typeLabel}</h4>
                    <span class="result-count">${results.length} found</span>
                </div>
                <div class="result-list">
                    ${results.map((result, i) => `
                        <div class="result-item" data-index="${i}">
                            <div class="result-match-badge" style="background-color: ${type === 'web' ? this.config.webColor :
                type === 'ai' ? this.config.aiColor :
                    this.config.imageColor
            }">
                                ${result.matchPercentage}%
                            </div>
                            <div class="result-content">
                                <div class="result-source">${this.escapeHtml(result.source)}</div>
                                ${result.text ? `
                                    <div class="result-text">${this.escapeHtml(result.text.substring(0, 100))}...</div>
                                ` : ''}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;

        const existingSection = resultsContainer.querySelector(`.${type}-section`);
        if (existingSection) {
            existingSection.outerHTML = resultHtml;
        } else {
            resultsContainer.insertAdjacentHTML('beforeend', resultHtml);
        }
    },

    // ===============================================================
    // CLEAR HIGHLIGHTS
    // ===============================================================
    clearAllHighlights() {
        console.log('Limpiando todos los highlights...');
        this.clearHighlights('web');
        this.clearHighlights('ai');
        this.clearHighlights('images');

        const resultsContainer = document.getElementById('plagiarismResults');
        if (resultsContainer) {
            resultsContainer.innerHTML = '<p class="no-results">Run a check to see results</p>';
        }

        console.log('✓ Todos los highlights limpiados');
    },

    clearHighlights(type) {
        const highlights = this.activeHighlights[type];

        highlights.forEach(h => {
            if (h.element && h.element.parentNode) {
                // Reemplazar el span con su contenido de texto
                const textNode = document.createTextNode(h.element.textContent);
                h.element.parentNode.replaceChild(textNode, h.element);
            }
        });

        this.activeHighlights[type] = [];
        this.updateHighlightCount(type);
    },

    // ===============================================================
    // UI UPDATES
    // ===============================================================
    updateHighlightCount(type) {
        const countEl = document.getElementById(`${type}HighlightCount`);
        if (countEl) {
            const count = this.activeHighlights[type].length;
            countEl.textContent = count;
            countEl.style.display = count > 0 ? 'inline-block' : 'none';
        }
    },

    showLoadingState(type) {
        const btn = document.getElementById(`${type}SearchBtn`);
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = `<i data-lucide="loader"></i> Checking...`;
            if (typeof lucide !== 'undefined') {
                lucide.createIcons();
            }
        }
    },

    hideLoadingState(type) {
        const btn = document.getElementById(`${type}SearchBtn`);
        if (btn) {
            btn.disabled = false;
            const labels = {
                web: '<i data-lucide="globe"></i> Search Web',
                ai: '<i data-lucide="sparkles"></i> Search AI',
                image: '<i data-lucide="image"></i> Search Images'
            };
            btn.innerHTML = labels[type] || btn.innerHTML;
            if (typeof lucide !== 'undefined') {
                lucide.createIcons();
            }
        }
    },

    // ===============================================================
    // UTILITIES
    // ===============================================================
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    darkenColor(color) {
        // Convierte hex a RGB y oscurece
        const hex = color.replace('#', '');
        const r = Math.max(0, parseInt(hex.substring(0, 2), 16) - 40);
        const g = Math.max(0, parseInt(hex.substring(2, 4), 16) - 40);
        const b = Math.max(0, parseInt(hex.substring(4, 6), 16) - 40);
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }
};

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        PlagiarismDetector.init();
    });
} else {
    PlagiarismDetector.init();
}

// Export for external access
window.PlagiarismDetector = PlagiarismDetector;
