/**
 * docToText.js
 * Utility to extract plain text from .docx files in the browser.
 * Uses Mammoth.js and JSZip.
 */

class DocToText {
    constructor() {
        this.mammothUrl = 'https://unpkg.com/mammoth@1.4.8/mammoth.browser.min.js';
        this.jszipUrl = 'https://unpkg.com/jszip@3.7.1/dist/jszip.min.js';
    }

    /**
     * Main entry point: Extracts text from a Blob/File
     * @param {Blob} blob 
     * @param {string} ext 
     * @returns {Promise<string>}
     */
    async extractToText(blob, ext) {
        if (!blob) return '';
        
        // Only .docx is supported for deep extraction right now
        if (ext === 'docx') {
            return await this._extractDocx(blob);
        }
        
        // Fallback for .doc or other types: simple read as text if it's text-based
        // Usually, .doc is binary and requires server-side help.
        return '';
    }

    /**
     * Extracts text from .docx using Mammoth
     */
    async _extractDocx(blob) {
        try {
            await this._ensureDependencies();
            
            const arrayBuffer = await blob.arrayBuffer();
            const result = await window.mammoth.extractRawText({ arrayBuffer: arrayBuffer });
            return result.value || '';
        } catch (err) {
            console.error('[DocToText] .docx extraction failed:', err);
            return '';
        }
    }

    /**
     * Ensures Mammoth and JSZip are loaded from CDN
     */
    async _ensureDependencies() {
        // If mammoth is already here, we are good
        if (window.mammoth) return;

        console.log('[DocToText] Loading Mammoth.js from CDN...');
        
        // We need JSZip first for Mammoth
        if (!window.JSZip) {
            await this._loadScript(this.jszipUrl);
        }
        
        await this._loadScript(this.mammothUrl);
    }

    _loadScript(url) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = url;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }
}

// Global exposure
window.DocToText = DocToText;
