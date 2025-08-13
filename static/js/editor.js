 // Global variables
let currentPage = 1;
let editors = {};
let activeEditor = null;
let darkMode = false;
let autoSaveInterval;
const pageHeight = (297 - 40) * 3.78; // A4 height minus margins in pixels

// Create Source Blot for highlighting pasted content
const Inline = Quill.import('blots/inline');
class SourceBlot extends Inline {
    static create(value) {
        let node = super.create();
        node.setAttribute('data-url', value.url);
        node.setAttribute('data-site', value.site);
        node.classList.add('source-highlight');
        return node;
    }

    static formats(node) {
        return {
            url: node.getAttribute('data-url'),
            site: node.getAttribute('data-site')
        };
    }
}
SourceBlot.blotName = 'source';
SourceBlot.tagName = 'span';
Quill.register(SourceBlot);

// Initialize Quill editor
function createQuillEditor(containerId) {
    const quill = new Quill(`#${containerId}`, {
        modules: {
            toolbar: '#toolbar',
            history: {
                delay: 2000,
                maxStack: 500,
                userOnly: true
            }
        },
        theme: 'snow',
        placeholder: 'Continue writing...'
    });

    // Add paste interceptor for source highlighting
    quill.clipboard.addMatcher(Node.ELEMENT_NODE, (node, delta) => {
        let html = node.outerHTML || '';
        let urlMatch = html.match(/https?:\/\/[^\s"]+/);
        let siteName = '';

        if (urlMatch) {
            try {
                let parsedUrl = new URL(urlMatch[0]);
                siteName = parsedUrl.hostname.replace('www.', '');
            } catch (err) {
                siteName = 'Unknown source';
            }
        }

        // Check if content was likely copied from a webpage
        if (urlMatch || html.includes('class=') || html.includes('style=')) {
            if (!siteName && window.location.href !== 'about:blank') {
                siteName = 'Web source';
                urlMatch = ['Web content'];
            }

            if (siteName) {
                delta.ops.forEach(op => {
                    if (op.insert && typeof op.insert === 'string') {
                        op.attributes = { 
                            ...op.attributes, 
                            source: { 
                                url: urlMatch[0] || 'Unknown URL', 
                                site: siteName 
                            } 
                        };
                    }
                });
            }
        }

        return delta;
    });

    // Text change handler
    quill.on('text-change', function(delta, oldDelta, source) {
        updateStats();
        if (source === 'user') {
            checkPageOverflow(quill, containerId);
            document.getElementById('lastSaved').textContent = 'Unsaved changes';
            
            // Check if page becomes empty and should be deleted
            setTimeout(() => {
                const pageNum = parseInt(containerId.split('-')[1]);
                if (pageNum > 1 && isPageEmpty(quill)) {
                    console.log('Page became empty, checking for deletion:', pageNum);
                }
            }, 100);
        }
    });

    // Selection change handler
    quill.on('selection-change', function(range) {
        if (range) {
            activeEditor = quill;
            updateCurrentPageDisplay(containerId);
        }
    });

    // Add keydown event listener directly to the editor element
    const editorElement = document.querySelector(`#${containerId} .ql-editor`);
    editorElement.addEventListener('keydown', function(e) {
        const pageNum = parseInt(containerId.split('-')[1]);
        
        if (e.key === 'Backspace' && pageNum > 1) {
            const isEmpty = isPageEmpty(quill);
            const atBeginning = isCursorAtBeginning(quill);
            
            console.log('=== BACKSPACE DEBUG ===');
            console.log('Page:', pageNum);
            console.log('Is Empty:', isEmpty);
            console.log('At Beginning:', atBeginning);
            console.log('Text content:', JSON.stringify(quill.getText()));
            console.log('Selection:', quill.getSelection());
            
            // If page is empty, delete it
            if (isEmpty) {
                console.log('Deleting empty page...');
                e.preventDefault();
                e.stopPropagation();
                
                const deleted = deleteEmptyPage(pageNum);
                console.log('Empty page deleted:', deleted);
                return false;
            }
            // If cursor is at beginning of non-empty page, move content to previous page
            else if (atBeginning) {
                console.log('Moving content to previous page...');
                e.preventDefault();
                e.stopPropagation();
                
                const moved = moveContentToPreviousPage(quill, containerId);
                console.log('Content moved to previous page:', moved);
                return false;
            }
        }
        
        if (e.key === 'Delete' && pageNum > 1 && isPageEmpty(quill)) {
            console.log('Delete pressed on empty page:', pageNum);
            e.preventDefault();
            e.stopPropagation();
            
            const deleted = deleteEmptyPage(pageNum);
            console.log('Empty page deleted:', deleted);
            return false;
        }
    });

    // Keyboard event handlers (keeping as backup)
    quill.keyboard.addBinding({
        key: 'Enter'
    }, function(range, context) {
        // Check if Enter is pressed at the beginning of the document
        if (range.index === 0) {
            const handled = handleEnterAtBeginning(quill, containerId);
            if (handled) {
                return false; // Prevent default
            }
        }
        return true; // Allow default behavior
    });

    return quill;
}

// Check if content overflows and create new page
function checkPageOverflow(quill, containerId) {
    const editorElement = document.querySelector(`#${containerId} .ql-editor`);
    if (!editorElement) return;

    if (editorElement.scrollHeight > pageHeight) {
        createNewPage();
        moveOverflowContent(quill, containerId);
    }
}

// Handle Enter key at beginning to push content to new page
function handleEnterAtBeginning(quill, containerId) {
    const selection = quill.getSelection();
    if (selection && selection.index === 0) {
        // Get current content
        const currentContent = quill.getContents();
        
        // Create new page if needed
        if (!editors[currentPage + 1]) {
            createNewPage();
        }
        
        // Move all content to next page
        const nextEditor = editors[currentPage];
        nextEditor.setContents(currentContent);
        
        // Clear current page
        quill.setContents([]);
        
        // Focus next page
        setTimeout(() => {
            nextEditor.focus();
            nextEditor.setSelection(0);
        }, 100);
        
        return true; // Prevent default enter behavior
    }
    return false;
}

// Check if page is empty
function isPageEmpty(quill) {
    const text = quill.getText();
    // Quill always adds a trailing newline, so empty content is just "\n"
    return text === '\n' || text.trim() === '';
}

// Delete empty page
function deleteEmptyPage(pageNum) {
    console.log('Attempting to delete page:', pageNum, 'Editors available:', Object.keys(editors));
    
    if (pageNum === 1) {
        console.log('Cannot delete page 1');
        return false; // Never delete first page
    }
    
    if (!editors[pageNum]) {
        console.log('Editor not found for page:', pageNum);
        return false;
    }
    
    const pageElement = document.getElementById(`page-${pageNum}`);
    const editorToDelete = editors[pageNum];
    
    if (!pageElement) {
        console.log('Page element not found:', `page-${pageNum}`);
        return false;
    }
    
    console.log('Checking if page is empty:', isPageEmpty(editorToDelete));
    
    if (isPageEmpty(editorToDelete)) {
        console.log('Deleting page:', pageNum);
        
        // Remove page from DOM
        pageElement.remove();
        
        // Remove editor from editors object
        delete editors[pageNum];
        
        // Focus previous page
        const prevPageNum = pageNum - 1;
        if (editors[prevPageNum]) {
            activeEditor = editors[prevPageNum];
            setTimeout(() => {
                activeEditor.focus();
                const length = activeEditor.getLength();
                activeEditor.setSelection(length - 1);
                updateCurrentPageDisplay(`editor-${prevPageNum}`);
            }, 100);
        }
        
        // Update page numbers
        renumberPages();
        updatePageCount();
        
        console.log('Page deleted successfully');
        return true;
    }
    
    console.log('Page not empty, cannot delete');
    return false;
}

// Renumber pages after deletion
function renumberPages() {
    const pageElements = document.querySelectorAll('.page');
    const newEditors = {};
    let newPageNum = 1;
    
    pageElements.forEach((pageElement, index) => {
        const oldPageNum = pageElement.id.split('-')[1];
        const newId = `page-${newPageNum}`;
        const newEditorId = `editor-${newPageNum}`;
        
        // Update page element
        pageElement.id = newId;
        pageElement.querySelector('.page-number').textContent = newPageNum;
        
        // Update editor element
        const editorElement = pageElement.querySelector('[id^="editor-"]');
        editorElement.id = newEditorId;
        
        // Update editors object
        if (editors[oldPageNum]) {
            newEditors[newPageNum] = editors[oldPageNum];
        }
        
        newPageNum++;
    });
    
    editors = newEditors;
    currentPage = newPageNum - 1;
}

// Create a new page
function createNewPage() {
    currentPage++;
    const pagesContainer = document.querySelector('.pages-container');
    
    const newPage = document.createElement('div');
    newPage.classList.add('page');
    newPage.id = `page-${currentPage}`;
    newPage.innerHTML = `
        <div class="page-number">${currentPage}</div>
        <div id="editor-${currentPage}"></div>
    `;
    
    pagesContainer.appendChild(newPage);
    
    // Create new editor instance
    editors[currentPage] = createQuillEditor(`editor-${currentPage}`);
    
    updatePageCount();
}

// Move overflow content to new page
function moveOverflowContent(currentQuill, currentContainerId) {
    const nextPageNum = currentPage;
    const nextEditor = editors[nextPageNum];
    
    if (!nextEditor) return;

    const currentContents = currentQuill.getContents();
    const editorElement = document.querySelector(`#${currentContainerId} .ql-editor`);
    
    // Simple overflow handling - move last paragraph to next page
    let ops = currentContents.ops;
    if (ops.length > 1) {
        // Find the last few operations to move
        let moveOps = [];
        let totalHeight = editorElement.scrollHeight;
        
        // Move the last paragraph or two to the new page
        while (totalHeight > pageHeight && ops.length > 1) {
            const lastOp = ops.pop();
            moveOps.unshift(lastOp);
            
            // Update current editor
            currentQuill.setContents({ ops: [...ops] });
            totalHeight = editorElement.scrollHeight;
        }
        
        // Add moved content to next page
        if (moveOps.length > 0) {
            nextEditor.setContents({ ops: moveOps });
        }
    }
}

// Update page count display
function updatePageCount() {
    const totalPages = Object.keys(editors).length;
    document.getElementById('totalPagesDisplay').textContent = totalPages;
    currentPage = Math.max(...Object.keys(editors).map(Number));
}

// Update current page display
function updateCurrentPageDisplay(containerId) {
    const pageNum = containerId.split('-')[1];
    document.getElementById('currentPageDisplay').textContent = pageNum;
}

// Enhanced statistics calculation
function updateStats() {
    let totalText = '';
    let totalWords = 0;
    let totalChars = 0;
    let totalParagraphs = 0;

    // Aggregate stats from all pages
    Object.values(editors).forEach(editor => {
        const text = editor.getText();
        totalText += text;
    });

    // Word count
    const words = totalText.trim() ? totalText.trim().split(/\s+/).length : 0;
    document.getElementById('wordCount').textContent = words;
    
    // Character count
    document.getElementById('charCount').textContent = Math.max(0, totalText.length - 1);
    
    // Paragraph count
    const paragraphs = totalText.split('\n').filter(p => p.trim().length > 0).length;
    document.getElementById('paragraphCount').textContent = Math.max(1, paragraphs);
    
    // Reading time
    const readingTime = Math.ceil(words / 200) || 1;
    document.getElementById('readingTime').textContent = readingTime;
}

// Tooltip functionality
function initializeTooltips() {
    const tooltip = document.getElementById('source-tooltip');

    document.addEventListener('mouseover', (e) => {
        if (e.target.classList.contains('source-highlight')) {
            const url = e.target.getAttribute('data-url');
            const site = e.target.getAttribute('data-site');
            tooltip.innerHTML = `<strong>${site}</strong><br><a href="${url}" target="_blank" style="color:#00d4ff">${url}</a>`;
            tooltip.style.display = 'block';
        }
    });

    document.addEventListener('mousemove', (e) => {
        if (tooltip.style.display === 'block') {
            tooltip.style.top = (e.pageY + 15) + 'px';
            tooltip.style.left = (e.pageX + 15) + 'px';
        }
    });

    document.addEventListener('mouseout', (e) => {
        if (e.target.classList.contains('source-highlight')) {
            tooltip.style.display = 'none';
        }
    });
}

// Auto-save functionality
function initializeAutoSave() {
    autoSaveInterval = setInterval(() => {
        const timestamp = new Date().toLocaleTimeString();
        document.getElementById('lastSaved').textContent = `Auto-saved at ${timestamp}`;
    }, 30000);
}

// Dark mode toggle
function toggleDarkMode() {
    darkMode = !darkMode;
    document.body.classList.toggle('dark', darkMode);
    try {
        localStorage.setItem('darkMode', darkMode);
    } catch (e) {
        console.log('localStorage not available');
    }
}

// Export functions
function exportAsHTML() {
    let allContent = '';
    Object.keys(editors).sort((a, b) => parseInt(a) - parseInt(b)).forEach(pageNum => {
        allContent += `<div class="page-break"><h3>Page ${pageNum}</h3>`;
        allContent += editors[pageNum].root.innerHTML;
        allContent += '</div>';
    });

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Exported Document</title>
<style>
body { font-family: Georgia, serif; line-height: 1.8; max-width: 800px; margin: 40px auto; padding: 20px; color: #2c3e50; }
.page-break { page-break-before: always; margin-top: 2em; }
.page-break:first-child { page-break-before: auto; margin-top: 0; }
h1, h2, h3 { font-weight: 400; margin: 1.5em 0 0.5em 0; }
p { margin-bottom: 1em; }
.source-highlight { background: rgba(220, 160, 255, 0.2); border-bottom: 1px dotted #9c27b0; }
@media print { .page-break { page-break-before: always; } }
</style>
</head>
<body>
${allContent}
</body>
</html>`;
    
    downloadFile(html, 'document.html', 'text/html');
}

function exportAsText() {
    let allText = '';
    Object.keys(editors).sort((a, b) => parseInt(a) - parseInt(b)).forEach(pageNum => {
        allText += `\n\n--- Page ${pageNum} ---\n\n`;
        allText += editors[pageNum].getText();
    });
    downloadFile(allText, 'document.txt', 'text/plain');
}

function exportAsMarkdown() {
    let allMarkdown = '';
    Object.keys(editors).sort((a, b) => parseInt(a) - parseInt(b)).forEach(pageNum => {
        allMarkdown += `\n\n## Page ${pageNum}\n\n`;
        
        const delta = editors[pageNum].getContents();
        delta.ops.forEach(op => {
            if (typeof op.insert === 'string') {
                let text = op.insert;
                
                if (op.attributes) {
                    if (op.attributes.header) {
                        const level = op.attributes.header;
                        text = '#'.repeat(level) + ' ' + text.replace('\n', '') + '\n\n';
                    } else if (op.attributes.bold) {
                        text = '**' + text + '**';
                    } else if (op.attributes.italic) {
                        text = '*' + text + '*';
                    }
                }
                
                allMarkdown += text;
            }
        });
    });
    
    downloadFile(allMarkdown, 'document.md', 'text/markdown');
}

function downloadFile(content, fileName, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
}

// Keyboard shortcuts
document.addEventListener('keydown', function(e) {
    if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        document.getElementById('lastSaved').textContent = 'Saved at ' + new Date().toLocaleTimeString();
    }
    
    if (e.ctrlKey && e.key === 'd') {
        e.preventDefault();
        toggleDarkMode();
    }
});

// Initialize everything
document.addEventListener('DOMContentLoaded', function() {
    // Create first editor
    editors[1] = createQuillEditor('editor-1');
    activeEditor = editors[1];

    // Load saved dark mode preference
    try {
        const savedDarkMode = localStorage.getItem('darkMode');
        if (savedDarkMode === 'true') {
            toggleDarkMode();
        }
    } catch (e) {
        console.log('localStorage not available');
    }
    
    // Initialize features
    initializeTooltips();
    updateStats();
    initializeAutoSave();
    
    // Focus the first editor
    setTimeout(() => {
        if (activeEditor) {
            activeEditor.focus();
            const length = activeEditor.getLength();
            activeEditor.setSelection(length - 1);
        }
    }, 300);

    // Handle image uploads for all editors
    Object.values(editors).forEach(editor => {
        editor.getModule('toolbar').addHandler('image', () => {
            const input = document.createElement('input');
            input.setAttribute('type', 'file');
            input.setAttribute('accept', 'image/*');
            input.click();
            
            input.onchange = () => {
                const file = input.files[0];
                if (file) {
                    const reader = new FileReader();
                    reader.onload = (e) => {
                        const range = activeEditor.getSelection() || { index: activeEditor.getLength() - 1 };
                        activeEditor.insertEmbed(range.index, 'image', e.target.result);
                    };
                    reader.readAsDataURL(file);
                }
            };
        });
    });
});

// Prevent accidental page unload
window.addEventListener('beforeunload', function(e) {
    const lastSavedText = document.getElementById('lastSaved').textContent;
    if (lastSavedText.includes('Unsaved changes')) {
        e.preventDefault();
        e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
    }
});
