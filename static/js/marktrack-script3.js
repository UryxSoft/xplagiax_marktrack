// ===================================================================
// MARKTRACK JAVASCRIPT
// Educational Integrity & Writing Process Tracking System
// ===================================================================

const MarkTrack = {
    // ===============================================================
    // STATE MANAGEMENT
    // ===============================================================
    state: {
        currentView: 'student', // 'student' or 'teacher'
        documentContent: '',
        versions: [],
        aiInteractions: [],
        sessions: [{
            id: 'session_1',
            startTime: Date.now(),
            endTime: null,
            wordsWritten: 0,
            activeTime: 0
        }],
        currentSession: 'session_1',
        wordCount: 0,
        paragraphCount: 0,
        startTime: Date.now(),
        activeTime: 0,
        lastActivity: Date.now(),
        isActive: true,
        pasteEvents: [],
        typingSpeed: [],
        aiFirstUse: true,
        submitted: false,
        lastSaveTime: Date.now()
    },

    // ===============================================================
    // INITIALIZATION
    // ===============================================================
    init() {
        this.loadState();
        this.setupEditor();
        this.setupToolbar();
        this.setupAIAssistant();
        this.setupPanelToggles();
        this.setupViewToggle();
        this.setupSubmitModal();
        this.setupActivityTracking();
        this.setupAutoSave();
        this.setupTeacherView();
        this.updateStats();
        this.startTimer();
        
        // Initialize Lucide icons
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
        
        console.log('MarkTrack initialized');
    },

    // ===============================================================
    // STATE PERSISTENCE
    // ===============================================================
    loadState() {
        try {
            const saved = localStorage.getItem('marktrack_state');
            if (saved) {
                try {
                    const parsed = JSON.parse(saved);
                    this.state = { ...this.state, ...parsed };
                    this.state.lastActivity = Date.now();
                } catch (e) {
                    console.error('Error parsing state, clearing corrupted data:', e);
                    // Clear corrupted state
                    localStorage.removeItem('marktrack_state');
                    localStorage.removeItem('marktrack_quill_backup');
                }
            }
        } catch (e) {
            // Handle NS_ERROR_FILE_CORRUPTED or other localStorage errors
            console.error('localStorage error, attempting to clear:', e);
            try {
                localStorage.clear();
            } catch (clearError) {
                console.error('Failed to clear localStorage:', clearError);
            }
        }
    },

    saveState() {
        try {
            // Prevent large state from breaking localStorage by keeping only latest versions if too large
            let stateStr = JSON.stringify(this.state);
            
            // If the state is getting close to the quota limit
            if (stateStr.length > 3500000) { // Aggressive threshold (~3.5MB)
                console.warn('State approaching quota limit, aggressive truncation...');
                
                // 1. Keep only the 3 most recent versions
                if (this.state.versions && this.state.versions.length > 3) {
                    this.state.versions = this.state.versions.slice(-3);
                }
                
                // 2. Clear paste events
                this.state.pasteEvents = [];
                // 3. Keep only latest AI interactions
                if (this.state.aiInteractions && this.state.aiInteractions.length > 5) {
                    this.state.aiInteractions = this.state.aiInteractions.slice(-5);
                }

                stateStr = JSON.stringify(this.state);
                
                // 4. Absolute floor: if still too large, clear ALL versions
                if (stateStr.length > 4500000) {
                    this.state.versions = [];
                    stateStr = JSON.stringify(this.state);
                }
            }
            
            localStorage.setItem('marktrack_state', stateStr);
        } catch (e) {
            console.error('Error saving state:', e);
            if (e.name === 'QuotaExceededError' || e.code === 22) {
                console.warn('Quota exceeded, clearing ALL storage to allow recovery.');
                try {
                    localStorage.removeItem('marktrack_state');
                    localStorage.removeItem('marktrack_quill_backup');
                    // Save just the minimal state
                    const minState = { ...this.state, versions: [], pasteEvents: [] };
                    localStorage.setItem('marktrack_state', JSON.stringify(minState));
                } catch (e2) {
                    console.error('Failed to recover from QuotaExceededError', e2);
                }
            }
        }
    },

    // ===============================================================
    // EDITOR FUNCTIONALITY
    // ===============================================================
    setupEditor() {
        const editor = document.getElementById('editor');
        if (!editor) return;

        // Load saved content
        if (this.state.documentContent) {
            editor.innerHTML = this.state.documentContent;
        }

        // Input event for tracking changes
        let inputTimeout;
        editor.addEventListener('input', (e) => {
            this.state.lastActivity = Date.now();
            this.state.isActive = true;
            
            clearTimeout(inputTimeout);
            inputTimeout = setTimeout(() => {
                this.captureVersion('edit');
                this.updateStats();
            }, 500);
        });

        // Paste detection
        editor.addEventListener('paste', (e) => {
            const pastedText = (e.clipboardData || window.clipboardData).getData('text');
            const wordCount = pastedText.split(/\s+/).filter(w => w).length;
            
            this.state.pasteEvents.push({
                timestamp: Date.now(),
                wordsAdded: wordCount,
                text: pastedText.substring(0, 100) // Store first 100 chars
            });
            
            this.showWarning(`⚠️ Pasted ${wordCount} words from external source`);
            
            setTimeout(() => {
                this.captureVersion('paste');
            }, 100);
        });

        // Keyboard shortcuts
        editor.addEventListener('keydown', (e) => {
            if (e.ctrlKey || e.metaKey) {
                switch(e.key) {
                    case 'b':
                        e.preventDefault();
                        this.executeCommand('bold');
                        break;
                    case 'i':
                        e.preventDefault();
                        this.executeCommand('italic');
                        break;
                    case 'u':
                        e.preventDefault();
                        this.executeCommand('underline');
                        break;
                    case 's':
                        e.preventDefault();
                        this.saveDocument();
                        break;
                }
            }
        });
    },

    setupToolbar() {
        document.querySelectorAll('.toolbar-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const command = btn.dataset.command;
                const value = btn.dataset.value;
                this.executeCommand(command, value);
            });
        });
    },

    executeCommand(command, value = null) {
        document.execCommand(command, false, value);
        document.getElementById('editor').focus();
    },

    // ===============================================================
    // VERSION CONTROL
    // ===============================================================
    captureVersion(type = 'auto') {
        const editor = document.getElementById('editor');
        if (!editor) return;

        const content = editor.innerHTML;
        const text = editor.innerText;
        const words = text.split(/\s+/).filter(w => w).length;
        
        const version = {
            id: `v_${Date.now()}`,
            timestamp: Date.now(),
            content: content,
            text: text,
            wordCount: words,
            sessionId: this.state.currentSession,
            type: type,
            events: []
        };

        // Calculate diff from last version
        if (this.state.versions.length > 0) {
            const lastVersion = this.state.versions[this.state.versions.length - 1];
            version.diff = this.calculateDiff(lastVersion.text, text);
        }

        this.state.versions.push(version);
        this.state.documentContent = content;
        this.updateVersionList();
        this.saveState();
    },

    calculateDiff(oldText, newText) {
        const oldWords = oldText.split(/\s+/).filter(w => w);
        const newWords = newText.split(/\s+/).filter(w => w);
        
        const added = newWords.length - oldWords.length;
        const deleted = added < 0 ? Math.abs(added) : 0;
        
        return {
            added: Math.max(0, added),
            deleted: deleted,
            netChange: added
        };
    },

    updateVersionList() {
        const versionList = document.getElementById('versionList');
        if (!versionList) return;

        const recentVersions = this.state.versions.slice(-10).reverse();
        
        versionList.innerHTML = recentVersions.map(version => {
            const timeAgo = this.getTimeAgo(version.timestamp);
            const changes = version.diff ? 
                `${version.diff.added > 0 ? '+' : ''}${version.diff.netChange} words` : 
                'Initial version';
            
            return `
                <div class="version-item" data-version="${version.id}">
                    <div class="version-time">${timeAgo}</div>
                    <div class="version-changes">${changes}</div>
                </div>
            `;
        }).join('');

        // Add click handlers
        versionList.querySelectorAll('.version-item').forEach(item => {
            item.addEventListener('click', () => {
                const versionId = item.dataset.version;
                this.loadVersion(versionId);
            });
        });
    },

    loadVersion(versionId) {
        const version = this.state.versions.find(v => v.id === versionId);
        if (version) {
            const editor = document.getElementById('editor');
            editor.innerHTML = version.content;
            alert('Version loaded. This is a preview only. Click anywhere to continue editing.');
        }
    },

    getTimeAgo(timestamp) {
        const seconds = Math.floor((Date.now() - timestamp) / 1000);
        
        if (seconds < 60) return 'Just now';
        if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
        return `${Math.floor(seconds / 86400)} days ago`;
    },

    // ===============================================================
    // AI ASSISTANT
    // ===============================================================
    setupAIAssistant() {
        const sendBtn = document.getElementById('sendAiBtn');
        const input = document.getElementById('aiInput');
        
        if (!sendBtn || !input) return;

        const sendMessage = () => {
            const message = input.value.trim();
            if (!message) return;

            // Show first use modal
            if (this.state.aiFirstUse) {
                this.showAIFirstUseModal();
                return;
            }

            this.addChatMessage('student', message);
            input.value = '';

            // Log interaction
            this.state.aiInteractions.push({
                timestamp: Date.now(),
                question: message,
                response: '',
                appropriate: true
            });

            // Simulate AI response
            setTimeout(() => {
                const response = this.generateAIResponse(message);
                this.addChatMessage('ai', response);
                
                // Update last interaction
                this.state.aiInteractions[this.state.aiInteractions.length - 1].response = response;
                
                this.showWarning('🤖 AI assistant used - visible to teacher');
                this.saveState();
            }, 1000);
        };

        sendBtn.addEventListener('click', sendMessage);
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                sendMessage();
            }
        });
    },

    addChatMessage(type, content) {
        const chatMessages = document.getElementById('chatMessages');
        if (!chatMessages) return;

        const messageDiv = document.createElement('div');
        messageDiv.className = `chat-message ${type}-message`;
        messageDiv.innerHTML = `<div class="message-content">${content}</div>`;
        
        chatMessages.appendChild(messageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    },

    generateAIResponse(question) {
        const lower = question.toLowerCase();
        
        // Check for inappropriate requests
        if (lower.includes('write') && (lower.includes('paragraph') || lower.includes('essay'))) {
            return "I can't write the content for you, but I can help you structure your ideas. Try outlining your main points first, and I can give you feedback on your structure.";
        }
        
        // Helpful responses
        if (lower.includes('improve') || lower.includes('better')) {
            return "To improve your writing, focus on: 1) Clear topic sentences, 2) Supporting evidence for each point, 3) Smooth transitions between ideas. Would you like specific feedback on a section?";
        }
        
        if (lower.includes('introduction')) {
            return "A strong introduction should: hook the reader, provide context, and clearly state your thesis. Consider starting with a compelling question or relevant quote to engage your reader.";
        }
        
        if (lower.includes('conclusion')) {
            return "Your conclusion should: restate your main argument, summarize key points, and leave the reader with something to think about. Avoid introducing new information here.";
        }
        
        // Default helpful response
        return "I'm here to help you improve your writing. I can suggest improvements, explain concepts, and help you revise. What specific aspect would you like help with?";
    },

    showAIFirstUseModal() {
        const modal = document.getElementById('aiFirstUseModal');
        if (!modal) return;

        modal.classList.add('active');

        const checkbox = document.getElementById('aiRulesCheckbox');
        const acceptBtn = document.getElementById('aiRulesAcceptBtn');

        checkbox.addEventListener('change', () => {
            acceptBtn.disabled = !checkbox.checked;
        });

        acceptBtn.addEventListener('click', () => {
            this.state.aiFirstUse = false;
            modal.classList.remove('active');
            this.saveState();
            
            // Now send the message
            const input = document.getElementById('aiInput');
            if (input && input.value) {
                setTimeout(() => {
                    document.getElementById('sendAiBtn').click();
                }, 100);
            }
        });

        // Close on overlay click
        modal.querySelector('.modal-overlay').addEventListener('click', () => {
            modal.classList.remove('active');
        });
    },

    // ===============================================================
    // STATISTICS & TRACKING
    // ===============================================================
    updateStats() {
        const editor = document.getElementById('editor');
        if (!editor) return;

        const text = editor.innerText;
        const words = text.split(/\s+/).filter(w => w).length;
        const paragraphs = text.split(/\n\n+/).filter(p => p.trim()).length;

        this.state.wordCount = words;
        this.state.paragraphCount = paragraphs;

        // Update UI
        const wordCountElements = document.querySelectorAll('#wordCount, #currentWords');
        wordCountElements.forEach(el => el.textContent = words);

        const paragraphCountEl = document.getElementById('paragraphCount');
        if (paragraphCountEl) paragraphCountEl.textContent = paragraphs;

        // Update progress
        const progress = Math.min((words / 2500) * 100, 100);
        const progressFill = document.getElementById('progressFill');
        const progressPercent = document.getElementById('progressPercent');
        
        if (progressFill) progressFill.style.width = `${progress}%`;
        if (progressPercent) progressPercent.textContent = `${Math.round(progress)}%`;
    },

    startTimer() {
        setInterval(() => {
            if (this.state.isActive) {
                this.state.activeTime += 1000;
                
                // Check for inactivity
                const inactiveTime = Date.now() - this.state.lastActivity;
                if (inactiveTime > 30000) { // 30 seconds
                    this.state.isActive = false;
                }
            }

            this.updateTimeDisplay();
        }, 1000);
    },

    updateTimeDisplay() {
        const hours = Math.floor(this.state.activeTime / 3600000);
        const minutes = Math.floor((this.state.activeTime % 3600000) / 60000);
        
        const timerElements = document.querySelectorAll('#timer, #activeTime');
        timerElements.forEach(el => {
            el.textContent = `${hours}h ${minutes}m`;
        });

        const sessionCountEl = document.getElementById('sessionCount');
        if (sessionCountEl) {
            sessionCountEl.textContent = this.state.sessions.length;
        }
    },

    setupActivityTracking() {
        // Track when user leaves/returns to page
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.state.isActive = false;
            } else {
                this.state.lastActivity = Date.now();
                this.state.isActive = true;
            }
        });
    },

    // ===============================================================
    // AUTO-SAVE
    // ===============================================================
    setupAutoSave() {
        let saveTimeout;
        const editor = document.getElementById('editor');
        
        if (!editor) return;

        editor.addEventListener('input', () => {
            this.setSaveStatus('saving');
            
            clearTimeout(saveTimeout);
            saveTimeout = setTimeout(() => {
                this.saveDocument();
            }, 2000); // 2 second debounce
        });
    },

    saveDocument() {
        this.captureVersion('auto');
        this.setSaveStatus('saved');
        this.updateLastSavedTime();
    },

    setSaveStatus(status) {
        const statusEl = document.getElementById('saveStatus');
        if (!statusEl) return;

        if (status === 'saving') {
            statusEl.className = 'save-status saving';
            statusEl.innerHTML = '<i data-lucide="loader"></i><span>Saving...</span>';
        } else {
            statusEl.className = 'save-status';
            statusEl.innerHTML = '<i data-lucide="check-circle"></i><span>Saved</span>';
        }

        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    },

    updateLastSavedTime() {
        const lastSavedEl = document.getElementById('lastSaved');
        if (!lastSavedEl) return;

        this.state.lastSaveTime = Date.now();
        lastSavedEl.textContent = 'just now';

        // Update periodically
        setInterval(() => {
            lastSavedEl.textContent = this.getTimeAgo(this.state.lastSaveTime);
        }, 10000);
    },

    showWarning(message) {
        const indicatorsEl = document.getElementById('warningIndicators');
        if (!indicatorsEl) return;

        const warning = document.createElement('div');
        warning.className = 'warning-indicator';
        warning.textContent = message;
        
        indicatorsEl.appendChild(warning);

        setTimeout(() => {
            warning.remove();
        }, 5000);
    },

    // ===============================================================
    // PANEL TOGGLES
    // ===============================================================
    setupPanelToggles() {
        // Logic removed: It is now handled solely by the inline script in invite.html
        // to prevent double-toggling issues (which caused panels to not open).
    },

    // ===============================================================
    // VIEW TOGGLE
    // ===============================================================
    setupViewToggle() {
        const toggleButtons = document.querySelectorAll('#viewToggle, #viewToggleTeacher');
        
        toggleButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                this.toggleView();
            });
        });
    },

    toggleView() {
        const studentView = document.getElementById('studentView');
        const teacherView = document.getElementById('teacherView');
        
        if (this.state.currentView === 'student') {
            studentView.style.display = 'none';
            teacherView.style.display = 'block';
            this.state.currentView = 'teacher';
            this.renderTeacherView();
        } else {
            studentView.style.display = 'block';
            teacherView.style.display = 'none';
            this.state.currentView = 'student';
        }
    },

    // ===============================================================
    // SUBMIT MODAL
    // ===============================================================
    setupSubmitModal() {
        const submitBtn = document.getElementById('submitBtn');
        const modal = document.getElementById('submitModal');
        const checkbox = document.getElementById('integrityCheckbox');
        const confirmBtn = document.getElementById('confirmSubmitBtn');
        const cancelBtn = document.getElementById('cancelSubmitBtn');
        
        if (!submitBtn || !modal) return;

        submitBtn.addEventListener('click', () => {
            this.showSubmitModal();
        });

        checkbox.addEventListener('change', () => {
            confirmBtn.disabled = !checkbox.checked;
        });

        confirmBtn.addEventListener('click', () => {
            this.submitWork();
        });

        cancelBtn.addEventListener('click', () => {
            modal.classList.remove('active');
        });

        modal.querySelector('.modal-overlay').addEventListener('click', () => {
            modal.classList.remove('active');
        });
    },

    showSubmitModal() {
        const modal = document.getElementById('submitModal');
        if (!modal) return;

        // Update checklist values
        document.getElementById('submitWordCount').textContent = this.state.wordCount;
        
        const hours = Math.floor(this.state.activeTime / 3600000);
        const minutes = Math.floor((this.state.activeTime % 3600000) / 60000);
        document.getElementById('submitWorkTime').textContent = `${hours}h ${minutes}m`;
        
        document.getElementById('submitAiUses').textContent = this.state.aiInteractions.length;

        modal.classList.add('active');
    },

    submitWork() {
        this.state.submitted = true;
        this.state.submittedAt = Date.now();
        this.saveState();

        alert('Work submitted successfully!');
        
        const modal = document.getElementById('submitModal');
        modal.classList.remove('active');
        
        // Disable editor
        const editor = document.getElementById('editor');
        if (editor) {
            editor.contentEditable = false;
            editor.style.opacity = '0.6';
        }
    },

    // ===============================================================
    // TEACHER VIEW
    // ===============================================================
    setupTeacherView() {
        this.setupTabs();
        this.setupHighlightToggles();
        this.setupReplayPlayer();
    },

    setupTabs() {
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const tabName = tab.dataset.tab;
                
                // Update active tab
                document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                
                // Show corresponding panel
                document.querySelectorAll('.tab-panel').forEach(panel => {
                    panel.style.display = 'none';
                });
                
                const targetPanel = document.getElementById(tabName);
                if (targetPanel) {
                    targetPanel.style.display = 'block';
                }
            });
        });
    },

    setupHighlightToggles() {
        document.querySelectorAll('.highlight-toggle input').forEach(checkbox => {
            checkbox.addEventListener('change', () => {
                this.updateDocumentHighlights();
            });
        });
    },

    renderTeacherView() {
        this.renderDocument();
        this.renderTimeline();
        this.updateDocumentHighlights();
        
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    },

    renderDocument() {
        const documentContent = document.getElementById('documentContent');
        if (!documentContent) return;

        // Get final version
        const finalVersion = this.state.versions.length > 0 ? 
            this.state.versions[this.state.versions.length - 1] : null;

        if (!finalVersion) {
            documentContent.innerHTML = '<p style="color: #8B8B8B;">No content yet.</p>';
            return;
        }

        // Mock AI detection - analyze paragraphs
        const doc = new DOMParser().parseFromString(finalVersion.content, 'text/html');
        const paragraphs = Array.from(doc.body.querySelectorAll('p'));
        
        let html = '';
        paragraphs.forEach((p, index) => {
            const text = p.textContent;
            const aiScore = this.detectAI(text);
            const indicator = aiScore > 60 ? 
                `<span class="paragraph-indicator">🤖 ${aiScore}% AI</span>` : '';
            
            html += `<p data-ai-score="${aiScore}">${text}${indicator}</p>`;
        });

        documentContent.innerHTML = html || finalVersion.content;
    },

    detectAI(text) {
        let score = 0;
        
        // Check for AI-typical phrases
        const aiPhrases = [
            'it is important to note',
            'in conclusion',
            'furthermore',
            'it should be emphasized',
            'it can be said that',
            'it is worth noting'
        ];
        
        const lower = text.toLowerCase();
        aiPhrases.forEach(phrase => {
            if (lower.includes(phrase)) score += 15;
        });
        
        // Check sentence complexity
        const sentences = text.split(/[.!?]+/).filter(s => s.trim());
        if (sentences.length > 0) {
            const avgLength = text.split(/\s+/).length / sentences.length;
            if (avgLength > 25) score += 20;
        }
        
        // Check vocabulary
        const complexWords = text.split(/\s+/).filter(word => 
            word.length > 10 || /^[A-Z]/.test(word)
        );
        if (complexWords.length / text.split(/\s+/).length > 0.25) {
            score += 15;
        }
        
        return Math.min(Math.max(score, 0), 100);
    },

    updateDocumentHighlights() {
        const showAI = document.getElementById('toggleAiHighlight')?.checked;
        const showPaste = document.getElementById('togglePasteHighlight')?.checked;
        const showOriginal = document.getElementById('toggleOriginalHighlight')?.checked;
        
        document.querySelectorAll('#documentContent p').forEach(p => {
            const aiScore = parseInt(p.dataset.aiScore || 0);
            
            // Remove all highlights
            p.classList.remove('highlight-ai', 'highlight-paste', 'highlight-original');
            
            // Apply highlights based on toggles
            if (showAI && aiScore > 60) {
                p.classList.add('highlight-ai');
            } else if (showOriginal && aiScore < 30) {
                p.classList.add('highlight-original');
            }
        });
    },

    renderTimeline() {
    const container = document.getElementById('heatmapChart');
    if (!container) return;
    
    // Clear existing content
    container.innerHTML = '';
    
    if (this.state.versions.length === 0) return;
    
    // Get activity data grouped by date and hour
    const activityByDateTime = this.getActivityByDateTime();
    
    // Generate last 30 days with 24 hours each
    const days = 30;
    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - days);
    
    // Create hour labels (Y axis)
    const hourLabels = document.createElement('div');
    hourLabels.className = 'heatmap-hour-labels';
    for (let hour = 0; hour < 24; hour++) {
        const label = document.createElement('div');
        label.className = 'hour-label';
        label.textContent = `${hour}:00`;
        hourLabels.appendChild(label);
    }
    container.appendChild(hourLabels);
    
    // Create grid container
    const gridWrapper = document.createElement('div');
    gridWrapper.className = 'heatmap-grid-wrapper';
    
    // Create date labels (X axis)
    const dateLabels = document.createElement('div');
    dateLabels.className = 'heatmap-date-labels';
    
    // Create grid
    const grid = document.createElement('div');
    grid.className = 'heatmap-grid';
    
    // Create cells for each hour of each day
    for (let day = 0; day < days; day++) {
        const currentDate = new Date(startDate);
        currentDate.setDate(startDate.getDate() + day);
        
        // Add date label every 3 days
        if (day % 3 === 0) {
            const dateLabel = document.createElement('div');
            dateLabel.className = 'date-label';
            dateLabel.textContent = currentDate.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric'
            });
            dateLabel.style.gridColumn = `${day + 1}`;
            dateLabels.appendChild(dateLabel);
        }
        
        for (let hour = 0; hour < 24; hour++) {
            const cellDate = new Date(currentDate);
            cellDate.setHours(hour, 0, 0, 0);
            
            const dateTimeStr = this.formatDateTime(cellDate);
            const activity = activityByDateTime[dateTimeStr] || 0;
            const level = this.getActivityLevel(activity);
            
            const cell = document.createElement('div');
            cell.className = 'heatmap-cell';
            cell.setAttribute('data-level', level);
            cell.setAttribute('data-datetime', dateTimeStr);
            cell.setAttribute('data-words', activity);
            
            // Tooltip on hover
            cell.addEventListener('mouseenter', (e) => this.showTooltip(e, cellDate, activity));
            cell.addEventListener('mouseleave', () => this.hideTooltip());
            
            grid.appendChild(cell);
        }
    }
    
    gridWrapper.appendChild(dateLabels);
    gridWrapper.appendChild(grid);
    container.appendChild(gridWrapper);
},

formatDateTime(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    return `${year}-${month}-${day}T${hour}`;
},

getActivityByDateTime() {
    const activityMap = {};
    
    this.state.versions.forEach(version => {
        const date = new Date(version.timestamp);
        const dateTimeStr = this.formatDateTime(date);
        
        if (!activityMap[dateTimeStr]) {
            activityMap[dateTimeStr] = 0;
        }
        activityMap[dateTimeStr] += version.wordCount || 0;
    });
    
    return activityMap;
},

getActivityLevel(wordCount) {
    if (wordCount === 0) return 0;
    if (wordCount < 50) return 1;
    if (wordCount < 150) return 2;
    if (wordCount < 300) return 3;
    return 4;
},

showTooltip(event, date, words) {
    const tooltip = document.getElementById('heatmapTooltip');
    if (!tooltip) return;
    
    const formattedDate = date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
    
    const formattedTime = date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    });
    
    tooltip.textContent = `${words} words on ${formattedDate} at ${formattedTime}`;
    tooltip.classList.add('visible');
    
    const rect = event.target.getBoundingClientRect();
    tooltip.style.left = `${rect.left + window.scrollX}px`;
    tooltip.style.top = `${rect.top + window.scrollY - 35}px`;
},

hideTooltip() {
    const tooltip = document.getElementById('heatmapTooltip');
    if (tooltip) {
        tooltip.classList.remove('visible');
    }
},

    renderTimeline2() {
        const canvas = document.getElementById('timelineChart');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        
        // Clear canvas
        ctx.clearRect(0, 0, width, height);
        
        if (this.state.versions.length === 0) return;

        // Prepare data points
        const dataPoints = this.state.versions.map(v => ({
            time: v.timestamp,
            words: v.wordCount
        }));

        // Find min/max
        const minTime = dataPoints[0].time;
        const maxTime = dataPoints[dataPoints.length - 1].time;
        const maxWords = Math.max(...dataPoints.map(d => d.words));

        // Draw axes
        ctx.strokeStyle = '#E4E4E7';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(50, height - 50);
        ctx.lineTo(width - 20, height - 50);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(50, 20);
        ctx.lineTo(50, height - 50);
        ctx.stroke();

        // Draw line
        ctx.strokeStyle = '#7C3AED';
        ctx.lineWidth = 3;
        ctx.beginPath();

        dataPoints.forEach((point, index) => {
            const x = 50 + ((point.time - minTime) / (maxTime - minTime)) * (width - 70);
            const y = height - 50 - (point.words / maxWords) * (height - 70);
            
            if (index === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });

        ctx.stroke();

        // Draw points
        dataPoints.forEach(point => {
            const x = 50 + ((point.time - minTime) / (maxTime - minTime)) * (width - 70);
            const y = height - 50 - (point.words / maxWords) * (height - 70);
            
            ctx.fillStyle = '#7C3AED';
            ctx.beginPath();
            ctx.arc(x, y, 5, 0, Math.PI * 2);
            ctx.fill();
        });

        // Add labels
        ctx.fillStyle = '#555555';
        ctx.font = '12px Inter';
        ctx.fillText('0', 20, height - 45);
        ctx.fillText(maxWords.toString(), 10, 25);
        ctx.fillText('Words', 15, height / 2);
        ctx.fillText('Time', width / 2, height - 20);
    },

    setupReplayPlayer() {
        const playBtn = document.getElementById('replayPlay');
        const pauseBtn = document.getElementById('replayPause');
        const prevBtn = document.getElementById('replayPrev');
        const nextBtn = document.getElementById('replayNext');
        const slider = document.getElementById('replaySlider');
        const speedSelect = document.getElementById('replaySpeed');
        
        if (!playBtn) return;

        let currentIndex = 0;
        let isPlaying = false;
        let playInterval;

        const updateReplay = (index) => {
            if (index < 0 || index >= this.state.versions.length) return;
            
            currentIndex = index;
            const version = this.state.versions[index];
            const viewer = document.getElementById('replayViewer');
            
            if (viewer) {
                viewer.innerHTML = version.content || '<p>No content</p>';
            }
            
            slider.value = (index / (this.state.versions.length - 1)) * 100;
            document.getElementById('replayTime').textContent = 
                `Version ${index + 1} of ${this.state.versions.length}`;
        };

        playBtn.addEventListener('click', () => {
            isPlaying = true;
            playBtn.style.display = 'none';
            pauseBtn.style.display = 'flex';
            
            const speed = parseInt(speedSelect.value);
            playInterval = setInterval(() => {
                currentIndex++;
                if (currentIndex >= this.state.versions.length) {
                    currentIndex = 0;
                }
                updateReplay(currentIndex);
            }, 1000 / speed);
        });

        pauseBtn.addEventListener('click', () => {
            isPlaying = false;
            clearInterval(playInterval);
            playBtn.style.display = 'flex';
            pauseBtn.style.display = 'none';
        });

        prevBtn.addEventListener('click', () => {
            updateReplay(Math.max(0, currentIndex - 1));
        });

        nextBtn.addEventListener('click', () => {
            updateReplay(Math.min(this.state.versions.length - 1, currentIndex + 1));
        });

        slider.addEventListener('input', () => {
            const index = Math.floor((slider.value / 100) * (this.state.versions.length - 1));
            updateReplay(index);
        });

        // Initialize
        if (this.state.versions.length > 0) {
            slider.max = 100;
            updateReplay(0);
        }
    },

    
    // ===============================================================
    // MOCK DATA GENERATION (for demo)
    // ===============================================================
    generateMockData() {
        // Generate some sample versions
        const baseText = `Don Quixote de la Mancha, written by Miguel de Cervantes in the 17th century, represents one of the most important works of Spanish literature. The novel narrates the adventures of a nobleman from La Mancha who loses his sanity after reading too many chivalric novels.

It is important to note that the literary significance of Don Quixote extends far beyond its entertainment value. Furthermore, it should be emphasized that this masterpiece fundamentally challenged the conventions of its time. The protagonist's journey serves as a metaphor for the human condition, exploring themes of reality versus illusion, idealism versus pragmatism, and the nature of heroism in a changing world.

The character of Don Quixote himself embodies the conflict between romantic idealism and harsh reality. His delusions, while comical, also reveal a deeper truth about the human need for meaning and purpose. Through his misadventures with his loyal squire Sancho Panza, Cervantes crafts a narrative that is both humorous and profound.

The novel's influence on subsequent literature cannot be overstated. Many scholars consider it the first modern novel, pioneering techniques of characterization and narrative structure that would influence countless writers. The work's exploration of metafiction, with its play between reality and fiction, was revolutionary for its time.

In conclusion, Don Quixote remains a timeless masterpiece that continues to resonate with readers across cultures and centuries. Its themes of idealism, identity, and the power of imagination speak to fundamental aspects of the human experience that transcend temporal and cultural boundaries.`;

        // Set document content
        const editor = document.getElementById('editor');
        if (editor) {
            editor.innerHTML = baseText.split('\n\n').map(p => `<p>${p}</p>`).join('');
            this.state.documentContent = editor.innerHTML;
        }

        // Generate versions simulating writing process
        const paragraphs = baseText.split('\n\n');
        let accumulatedText = '';
        
        paragraphs.forEach((para, index) => {
            accumulatedText += (index > 0 ? '\n\n' : '') + para;
            
            this.state.versions.push({
                id: `v_${Date.now() + index * 100000}`,
                timestamp: Date.now() - (paragraphs.length - index) * 3600000,
                content: accumulatedText.split('\n\n').map(p => `<p>${p}</p>`).join(''),
                text: accumulatedText,
                wordCount: accumulatedText.split(/\s+/).length,
                sessionId: 'session_1',
                type: 'auto'
            });
        });

        // Add some AI interactions
        this.state.aiInteractions = [
            {
                timestamp: Date.now() - 7200000,
                question: "How can I improve this introduction?",
                response: "Your introduction presents the topic clearly. Consider adding a stronger hook in the first sentence.",
                appropriate: true
            },
            {
                timestamp: Date.now() - 3600000,
                question: "Can you write a paragraph about the themes?",
                response: "I can't write the content for you, but I can suggest a structure for discussing themes.",
                appropriate: false
            }
        ];

        // Add paste event
        this.state.pasteEvents.push({
            timestamp: Date.now() - 5400000,
            wordsAdded: 347,
            text: paragraphs[1].substring(0, 100)
        });

        this.state.wordCount = baseText.split(/\s+/).length;
        this.state.activeTime = 11520000; // 3h 12m
        
        this.updateStats();
        this.updateVersionList();
        this.saveState();
    }

    
};

// ===================================================================
// MARKTRACK MODAL SYSTEM - JavaScript
// All modal functionality and handlers
// ===================================================================

const ModalSystem = {
    // Store currently active modal
    activeModal: null,

    // ===============================================================
    // INITIALIZATION
    // ===============================================================
    init() {
        this.setupModalTriggers();
        this.setupModalClosers();
        this.setupKeyboardShortcuts();
        this.setupModalHandlers();
        console.log('Modal system initialized');
    },

    // ===============================================================
    // MODAL CORE FUNCTIONALITY
    // ===============================================================
    openModal(modalId) {
        const modal = document.getElementById(modalId);
        if (!modal) return;

        // Close any open modal first
        if (this.activeModal) {
            this.closeModal(this.activeModal);
        }

        modal.classList.add('active');
        this.activeModal = modalId;
        document.body.style.overflow = 'hidden'; // Prevent background scroll
    },

    closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (!modal) return;

        modal.classList.remove('active');
        if (this.activeModal === modalId) {
            this.activeModal = null;
        }
        document.body.style.overflow = ''; // Restore scroll
    },

    // ===============================================================
    // SETUP EVENT LISTENERS
    // ===============================================================
    setupModalTriggers() {
        // Add triggers for each modal
        const triggers = {
            'newDocumentBtn': 'newDocumentModal',
            'openFileBtn': 'openFileModal',
            'saveAsBtn': 'saveAsModal',
            'versionHistoryBtn': 'versionHistoryModal',
            'historyBtn': 'versionHistoryModal',
            'exportBtn': 'exportModal',
            'spellCheckBtn': 'spellCheckModal',
            'styleBtn': 'styleImprovementModal',
            'transformBtn': 'textTransformModal',
            'vocabularyBtn': 'vocabularyModal',
            'stylometryBtn': 'stylometryModal',
            'readabilityBtn': 'readabilityModal',
            'statsBtn': 'statsModal',
            'docInfoBtn': 'docInfoModal',
            'findReplaceBtn': 'findReplaceModal',
            'compareBtn': 'compareDocsModal',
            'addNoteBtn': 'addNoteModal',
            'citationBtn': 'citationModal',
            'settingsBtn': 'settingsModal',
            'shortcutsBtn': 'shortcutsModal',
            'helpBtn': 'helpModal',
            'aiSummaryBtn': 'aiSummaryModal',
            'coherenceBtn': 'coherenceModal',
            'examModeBtn': 'examModeModal',
            'shareBtn': 'shareModal'
        };

        Object.entries(triggers).forEach(([btnId, modalId]) => {
            const btn = document.getElementById(btnId);
            if (btn) {
                btn.addEventListener('click', () => this.openModal(modalId));
            }
        });
    },

    setupModalClosers() {
        // Close buttons
        document.querySelectorAll('.btn-close, [data-modal]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const modalId = btn.getAttribute('data-modal');
                if (modalId) {
                    this.closeModal(modalId);
                }
            });
        });

        // Overlay clicks
        document.querySelectorAll('.modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', (e) => {
                const modal = overlay.closest('.modal');
                if (modal) {
                    this.closeModal(modal.id);
                }
            });
        });
    },

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // ESC to close modal
            if (e.key === 'Escape' && this.activeModal) {
                this.closeModal(this.activeModal);
            }

            // Ctrl+F for find/replace
            if (e.ctrlKey && e.key === 'f') {
                e.preventDefault();
                this.openModal('findReplaceModal');
            }

            // Ctrl+, for settings
            if (e.ctrlKey && e.key === ',') {
                e.preventDefault();
                this.openModal('settingsModal');
            }

            // F1 for help
            if (e.key === 'F1') {
                e.preventDefault();
                this.openModal('helpModal');
            }
        });
    },

    // ===============================================================
    // MODAL SPECIFIC HANDLERS
    // ===============================================================
    setupModalHandlers() {
        this.setupNewDocumentModal();
        this.setupOpenFileModal();
        this.setupSaveAsModal();
        this.setupExportModal();
        this.setupTextTransformModal();
        this.setupFindReplaceModal();
        this.setupCitationModal();
        this.setupSettingsModal();
        this.setupStatsModal();
        // setupShareModal is handled by ModalSystem already
    },

    // ===============================================================
    // NEW DOCUMENT MODAL
    // ===============================================================
    setupNewDocumentModal() {
        const createBtn = document.getElementById('createNewDocBtn');
        if (createBtn) {
            createBtn.addEventListener('click', () => {
                const docName = document.getElementById('newDocName').value || 'Untitled Document';
                const assignmentType = document.getElementById('assignmentType').value;
                
                // Clear editor
                const editor = document.getElementById('editor');
                if (editor) {
                    editor.innerHTML = '';
                }
                
                // Reset state
                if (typeof MarkTrack !== 'undefined') {
                    MarkTrack.state.documentContent = '';
                    MarkTrack.state.wordCount = 0;
                    MarkTrack.updateStats();
                }
                
                this.closeModal('newDocumentModal');
                this.showToast('New document created');
            });
        }
    },

    // ===============================================================
    // OPEN FILE MODAL
    // ===============================================================
    setupOpenFileModal() {
        const fileInput = document.getElementById('fileInput');
        const dropZone = document.getElementById('fileDropZone');
        
        if (fileInput && dropZone) {
            // File input change
            fileInput.addEventListener('change', (e) => {
                this.handleFileUpload(e.target.files[0]);
            });

            // Drag and drop
            dropZone.addEventListener('dragover', (e) => {
                e.preventDefault();
                dropZone.classList.add('drag-over');
            });

            dropZone.addEventListener('dragleave', () => {
                dropZone.classList.remove('drag-over');
            });

            dropZone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropZone.classList.remove('drag-over');
                this.handleFileUpload(e.dataTransfer.files[0]);
            });
        }
    },

    handleFileUpload(file) {
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const content = e.target.result;
            const editor = document.getElementById('editor');
            if (editor) {
                editor.innerHTML = content;
                if (typeof MarkTrack !== 'undefined') {
                    MarkTrack.updateStats();
                }
            }
            this.closeModal('openFileModal');
            this.showToast('File loaded successfully');
        };
        reader.readAsText(file);
    },

    // ===============================================================
    // SAVE AS MODAL
    // ===============================================================
    setupSaveAsModal() {
        const saveBtn = document.getElementById('saveAsBtn');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                const fileName = document.getElementById('saveAsFileName').value || 'document';
                const format = document.querySelector('input[name="saveFormat"]:checked').value;
                
                this.downloadDocument(fileName, format);
                this.closeModal('saveAsModal');
            });
        }
    },

    downloadDocument(fileName, format) {
        const editor = document.getElementById('editor');
        if (!editor) return;

        let content = editor.innerHTML;
        let mimeType = 'text/html';
        let extension = '.html';

        if (format === 'txt') {
            content = editor.innerText;
            mimeType = 'text/plain';
            extension = '.txt';
        } else if (format === 'md') {
            content = this.htmlToMarkdown(editor.innerHTML);
            mimeType = 'text/markdown';
            extension = '.md';
        }

        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName + extension;
        a.click();
        URL.revokeObjectURL(url);

        this.showToast('Document downloaded');
    },

    htmlToMarkdown(html) {
        // Simple HTML to Markdown conversion
        let md = html;
        md = md.replace(/<h1>(.*?)<\/h1>/g, '# $1\n');
        md = md.replace(/<h2>(.*?)<\/h2>/g, '## $1\n');
        md = md.replace(/<h3>(.*?)<\/h3>/g, '### $1\n');
        md = md.replace(/<strong>(.*?)<\/strong>/g, '**$1**');
        md = md.replace(/<em>(.*?)<\/em>/g, '*$1*');
        md = md.replace(/<p>(.*?)<\/p>/g, '$1\n\n');
        md = md.replace(/<br>/g, '\n');
        md = md.replace(/<[^>]+>/g, ''); // Remove remaining tags
        return md;
    },

    // ===============================================================
    // EXPORT MODAL
    // ===============================================================
    setupExportModal() {
        document.querySelectorAll('.export-option').forEach(btn => {
            btn.addEventListener('click', () => {
                const format = btn.getAttribute('data-format');
                const includeComments = document.getElementById('includeComments')?.checked || false;
                
                this.exportDocument(format, includeComments);
                this.closeModal('exportModal');
            });
        });
    },

    exportDocument(format, includeComments) {
        // Use the same download logic
        this.downloadDocument('document', format);
    },

    // ===============================================================
    // TEXT TRANSFORM MODAL
    // ===============================================================
    setupTextTransformModal() {
        const transformSelect = document.getElementById('transformType');
        const applyBtn = document.getElementById('applyTransformBtn');

        if (transformSelect) {
            transformSelect.addEventListener('change', () => {
                this.generateTransformation();
            });
        }

        if (applyBtn) {
            applyBtn.addEventListener('click', () => {
                const transformedText = document.getElementById('transformedText').innerText;
                // Apply to selected text or whole document
                this.closeModal('textTransformModal');
                this.showToast('Text transformed');
            });
        }
    },

    generateTransformation() {
        const type = document.getElementById('transformType').value;
        const originalText = document.getElementById('originalText').innerText;
        
        // Simulate AI transformation
        const transformedDiv = document.getElementById('transformedText');
        transformedDiv.innerHTML = '<div class="loading-state"><i data-lucide="loader" class="spin"></i><span>Processing...</span></div>';
        
        setTimeout(() => {
            let transformed = originalText;
            
            // Simple transformations (in real app, use AI)
            if (type === 'simplify') {
                transformed = originalText.replace(/utilize/g, 'use').replace(/implement/g, 'do');
            } else if (type === 'formal') {
                transformed = originalText.replace(/get/g, 'obtain').replace(/do/g, 'perform');
            }
            
            transformedDiv.textContent = transformed;
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }, 1500);
    },

    // ===============================================================
    // FIND & REPLACE MODAL
    // ===============================================================
    setupFindReplaceModal() {
        const findInput = document.getElementById('findText');
        const replaceAllBtn = document.getElementById('replaceAllBtnFind');
        
        if (findInput) {
            findInput.addEventListener('input', () => {
                this.updateMatchCount();
            });
        }

        if (replaceAllBtn) {
            replaceAllBtn.addEventListener('click', () => {
                this.performReplaceAll();
            });
        }
    },

    updateMatchCount() {
        const findText = document.getElementById('findText').value;
        const editor = document.getElementById('editor');
        
        if (!findText || !editor) {
            document.getElementById('matchCount').textContent = '0';
            return;
        }

        const content = editor.innerText;
        const matches = (content.match(new RegExp(findText, 'gi')) || []).length;
        document.getElementById('matchCount').textContent = matches;
    },

    performReplaceAll() {
        const findText = document.getElementById('findText').value;
        const replaceText = document.getElementById('replaceText').value;
        const editor = document.getElementById('editor');
        
        if (!findText || !editor) return;

        const content = editor.innerHTML;
        editor.innerHTML = content.replace(new RegExp(findText, 'gi'), replaceText);
        
        this.showToast('All instances replaced');
        this.updateMatchCount();
    },

    // ===============================================================
    // CITATION MODAL
    // ===============================================================
    setupCitationModal() {
        const styleSelect = document.getElementById('citationStyle');
        const sourceSelect = document.getElementById('sourceType');
        const insertBtn = document.getElementById('insertCitationBtn');
        
        if (styleSelect && sourceSelect) {
            [styleSelect, sourceSelect].forEach(select => {
                select.addEventListener('change', () => {
                    this.updateCitationFields();
                    this.generateCitation();
                });
            });
        }

        if (insertBtn) {
            insertBtn.addEventListener('click', () => {
                const citation = document.getElementById('citationOutput').textContent;
                // Insert citation at cursor position
                document.execCommand('insertText', false, citation);
                this.closeModal('citationModal');
            });
        }
    },

    updateCitationFields() {
        const sourceType = document.getElementById('sourceType').value;
        const fieldsDiv = document.getElementById('citationFields');
        
        let fields = '';
        if (sourceType === 'book') {
            fields = `
                <div class="form-group">
                    <label>Author(s)</label>
                    <input type="text" class="form-input citation-field" placeholder="Last, First">
                </div>
                <div class="form-group">
                    <label>Title</label>
                    <input type="text" class="form-input citation-field" placeholder="Book title">
                </div>
                <div class="form-group">
                    <label>Year</label>
                    <input type="text" class="form-input citation-field" placeholder="2024">
                </div>
                <div class="form-group">
                    <label>Publisher</label>
                    <input type="text" class="form-input citation-field" placeholder="Publisher name">
                </div>
            `;
        } else if (sourceType === 'website') {
            fields = `
                <div class="form-group">
                    <label>Website Name</label>
                    <input type="text" class="form-input citation-field" placeholder="Site name">
                </div>
                <div class="form-group">
                    <label>URL</label>
                    <input type="text" class="form-input citation-field" placeholder="https://">
                </div>
                <div class="form-group">
                    <label>Access Date</label>
                    <input type="date" class="form-input citation-field">
                </div>
            `;
        }
        
        fieldsDiv.innerHTML = fields;
        
        // Add listeners to new fields
        document.querySelectorAll('.citation-field').forEach(field => {
            field.addEventListener('input', () => this.generateCitation());
        });
    },

    generateCitation() {
        const style = document.getElementById('citationStyle').value;
        const sourceType = document.getElementById('sourceType').value;
        const outputDiv = document.getElementById('citationOutput');
        
        // Simple citation generation (in real app, use proper library)
        outputDiv.textContent = `[${style.toUpperCase()}] Citation for ${sourceType} will be generated here...`;
    },

    // ===============================================================
    // SETTINGS MODAL
    // ===============================================================
    setupSettingsModal() {
        // Theme selector
        document.querySelectorAll('.theme-option').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.theme-option').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                const theme = btn.getAttribute('data-theme');
                document.body.setAttribute('data-theme', theme);
            });
        });

        // Font size slider
        const fontSizeSlider = document.getElementById('fontSize');
        const fontSizeValue = document.getElementById('fontSizeValue');
        
        if (fontSizeSlider && fontSizeValue) {
            fontSizeSlider.addEventListener('input', () => {
                const size = fontSizeSlider.value;
                fontSizeValue.textContent = size + 'px';
                
                const editor = document.getElementById('editor');
                if (editor) {
                    editor.style.fontSize = size + 'px';
                }
            });
        }

        // Settings tabs
        document.querySelectorAll('.settings-tabs .tab-btn').forEach(tab => {
            tab.addEventListener('click', () => {
                const tabName = tab.getAttribute('data-tab');
                
                // Update active tab
                document.querySelectorAll('.settings-tabs .tab-btn').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                
                // Show corresponding panel
                document.querySelectorAll('.settings-panel').forEach(panel => {
                    panel.style.display = 'none';
                });
                
                const targetPanel = document.getElementById(tabName);
                if (targetPanel) {
                    targetPanel.style.display = 'block';
                }
            });
        });

        // Save settings
        const saveBtn = document.getElementById('saveSettingsBtn');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                // Save all settings to localStorage
                this.saveSettings();
                this.closeModal('settingsModal');
                this.showToast('Settings saved');
            });
        }
    },

    saveSettings() {
        const settings = {
            theme: document.querySelector('.theme-option.active')?.getAttribute('data-theme') || 'light',
            fontSize: document.getElementById('fontSize')?.value || 16,
            fontFamily: document.getElementById('fontFamily')?.value || 'inter',
            lineSpacing: document.getElementById('lineSpacing')?.value || '1.5',
            autoSave: document.getElementById('autoSave')?.checked || true,
            spellCheck: document.getElementById('spellCheckAuto')?.checked || true,
            grammarCheck: document.getElementById('grammarCheck')?.checked || true
        };
        
        localStorage.setItem('marktrack_settings', JSON.stringify(settings));
    },

    loadSettings() {
        const saved = localStorage.getItem('marktrack_settings');
        if (!saved) return;
        
        const settings = JSON.parse(saved);
        
        // Apply settings
        if (settings.theme) {
            document.body.setAttribute('data-theme', settings.theme);
        }
        if (settings.fontSize) {
            const editor = document.getElementById('editor');
            if (editor) editor.style.fontSize = settings.fontSize + 'px';
        }
    },

    // ===============================================================
    // STATS MODAL
    // ===============================================================
    setupStatsModal() {
        // Stats are updated whenever modal opens
        const statsBtn = document.getElementById('statsBtn');
        if (statsBtn) {
            statsBtn.addEventListener('click', () => {
                this.updateStatsModal();
            });
        }
    },

    updateStatsModal() {
        const editor = document.getElementById('editor');
        if (!editor) return;

        const text = editor.innerText;
        const words = text.trim() ? text.trim().split(/\s+/).length : 0;
        const sentences = (text.match(/[.!?]+/g) || []).length;
        const paragraphs = editor.querySelectorAll('p').length || text.split('\n\n').filter(p => p.trim()).length;
        const chars = text.length;
        const pages = Math.ceil(words / 250); // Approx 250 words per page
        const readTime = Math.ceil(words / 200); // Approx 200 words per minute

        // Update modal
        document.getElementById('statsWords').textContent = words;
        document.getElementById('statsSentences').textContent = sentences;
        document.getElementById('statsParagraphs').textContent = paragraphs;
        document.getElementById('statsPages').textContent = pages;
        document.getElementById('statsReadTime').textContent = readTime + ' min';
        document.getElementById('statsChars').textContent = chars;

        // Generate keyword tags
        this.generateKeywords(text);
    },

    generateKeywords(text) {
        // Simple keyword extraction (in real app, use NLP)
        const words = text.toLowerCase().split(/\s+/);
        const wordFreq = {};
        
        words.forEach(word => {
            word = word.replace(/[^a-z]/g, '');
            if (word.length > 4) {
                wordFreq[word] = (wordFreq[word] || 0) + 1;
            }
        });

        const sorted = Object.entries(wordFreq)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);

        const tagsDiv = document.getElementById('keywordTags');
        if (tagsDiv) {
            tagsDiv.innerHTML = sorted.map(([word]) => 
                `<span class="keyword-tag">${word}</span>`
            ).join('');
        }
    },

    // ===============================================================
    // UTILITY FUNCTIONS
    // ===============================================================
    showToast(message, duration = 3000) {
        // Create toast notification
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: #111;
            color: white;
            padding: 12px 24px;
            border-radius: 8px;
            z-index: 10000;
            animation: slideIn 0.3s ease;
        `;
        
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }
};

// Initialize modal system when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ModalSystem.init());
} else {
    ModalSystem.init();
}

// Add to window for external access
window.ModalSystem = ModalSystem;
// ===================================================================
// INITIALIZE ON PAGE LOAD
// ===================================================================
document.addEventListener('DOMContentLoaded', () => {
    MarkTrack.init();
    
    // Generate mock data for demo (remove in production)
    if (MarkTrack.state.versions.length === 0) {
        MarkTrack.generateMockData();
    }
});


class SignatureModal {
    constructor() {
        this.canvas = document.getElementById('signatureCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.isDrawing = false;
        this.currentColor = '#000000';
        this.hasSignature = false;
        this.signatureMode = 'draw'; // 'draw' or 'upload'
        this.uploadData = null;
        
        this.init();
    }
    
    init() {
        // Set up canvas
        const rect = this.canvas.getBoundingClientRect();
        this.canvas.width = rect.width * 2;
        this.canvas.height = rect.height * 2;
        this.ctx.scale(2, 2);
        this.ctx.lineWidth = 2;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        
        // Drawing events
        this.canvas.addEventListener('mousedown', (e) => this.startDrawing(e));
        this.canvas.addEventListener('mousemove', (e) => this.draw(e));
        this.canvas.addEventListener('mouseup', () => this.stopDrawing());
        this.canvas.addEventListener('mouseout', () => this.stopDrawing());
        
        // Touch events
        this.canvas.addEventListener('touchstart', (e) => this.startDrawing(e));
        this.canvas.addEventListener('touchmove', (e) => this.draw(e));
        this.canvas.addEventListener('touchend', () => this.stopDrawing());
        
        // Color buttons
        document.querySelectorAll('[data-color]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('[data-color]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.currentColor = btn.dataset.color;
            });
        });
        
        // Clear button
        document.getElementById('clearSignature').addEventListener('click', () => {
            this.clear();
        });

        // Tabs Logic
        const tabDraw = document.getElementById('tabDraw');
        const tabUpload = document.getElementById('tabUpload');
        const areaDraw = document.getElementById('areaDraw');
        const areaUpload = document.getElementById('areaUpload');
        const fileUpload = document.getElementById('signatureUpload');
        const previewImg = document.getElementById('uploadPreviewImg');
        const previewDiv = document.getElementById('uploadPreview');

        if (tabDraw && tabUpload) {
            tabDraw.addEventListener('click', () => {
                this.signatureMode = 'draw';
                tabDraw.classList.add('active');
                tabUpload.classList.remove('active');
                areaDraw.style.display = 'block';
                areaUpload.style.display = 'none';
                this.updateSubmitButton();
            });

            tabUpload.addEventListener('click', () => {
                this.signatureMode = 'upload';
                tabUpload.classList.add('active');
                tabDraw.classList.remove('active');
                areaDraw.style.display = 'none';
                areaUpload.style.display = 'block';
                this.updateSubmitButton();
            });
        }

        if (fileUpload) {
            fileUpload.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        this.uploadData = event.target.result;
                        previewImg.src = this.uploadData;
                        previewDiv.style.display = 'block';
                        this.updateSubmitButton();
                    };
                    reader.readAsDataURL(file);
                }
            });
        }
        
        // Integrity checkbox
        const checkbox = document.getElementById('integrityCheckbox');
        const submitBtn = document.getElementById('submitWithSignature');
        
        checkbox.addEventListener('change', () => {
            this.updateSubmitButton();
        });
        
        // Submit button
        submitBtn.addEventListener('click', () => {
            this.submit();
        });
    }
    
    getCoordinates(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = (e.clientX || e.touches && e.touches[0].clientX) - rect.left;
        const y = (e.clientY || e.touches && e.touches[0].clientY) - rect.top;
        return { x, y };
    }
    
    startDrawing(e) {
        e.preventDefault();
        this.isDrawing = true;
        const { x, y } = this.getCoordinates(e);
        this.ctx.beginPath();
        this.ctx.moveTo(x, y);
        this.hasSignature = true;
        this.updateSubmitButton();
    }
    
    draw(e) {
        if (!this.isDrawing) return;
        e.preventDefault();
        
        const { x, y } = this.getCoordinates(e);
        this.ctx.strokeStyle = this.currentColor;
        this.ctx.lineTo(x, y);
        this.ctx.stroke();
    }
    
    stopDrawing() {
        this.isDrawing = false;
    }
    
    clear() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.hasSignature = false;
        this.updateSubmitButton();
    }
    
    updateSubmitButton() {
        const checkbox = document.getElementById('integrityCheckbox');
        const submitBtn = document.getElementById('submitWithSignature');
        const error = document.getElementById('signatureError');
        
        let validSignature = false;
        if (this.signatureMode === 'draw') {
            validSignature = this.hasSignature;
        } else {
            validSignature = (this.uploadData !== null);
        }

        const canSubmit = validSignature && checkbox.checked;
        submitBtn.disabled = !canSubmit;
        
        if (!canSubmit && (checkbox.checked || validSignature)) {
            error.style.display = 'flex';
        } else {
            error.style.display = 'none';
        }
    }
    
    async submit() {
        let signatureData = null;
        if (this.signatureMode === 'draw') {
            if (!this.hasSignature) {
                document.getElementById('signatureError').style.display = 'flex';
                return;
            }
            signatureData = this.canvas.toDataURL('image/png');
        } else {
            if (!this.uploadData) {
                document.getElementById('signatureError').style.display = 'flex';
                return;
            }
            signatureData = this.uploadData;
        }
        
        const submitBtn = document.getElementById('submitWithSignature');
        submitBtn.innerText = 'Submitting...';
        submitBtn.disabled = true;

        // NEW: Submit using window.typingMetrics if available
        if (window.typingMetrics) {
            const success = await window.typingMetrics.sendToServer(signatureData, true);
            if (success) {
                // Also trigger document physical save to be safe
                if (window.inviteEditorIntegration) {
                    window.inviteEditorIntegration.forceSave();
                }
                document.getElementById('signatureModal').classList.remove('active');
                
                // Show closing state
                document.body.innerHTML = '<div style="display:flex; height:100vh; align-items:center; justify-content:center; flex-direction:column; font-family:Inter,sans-serif;"><div style="font-size:48px; color:#50c88c;">✓</div><h2 style="margin-top:20px;">Ensayo finalizado y entregado</h2><p style="color:#666;">Ya puedes cerrar esta ventana.</p></div>';
            } else {
                alert('Hubo un error al guardar tu envío. Inténtalo de nuevo.');
                submitBtn.innerText = 'Finalize & Submit';
                submitBtn.disabled = false;
            }
        } else {
            console.log('Fallback: Submitting just signature', signatureData);
            document.getElementById('signatureModal').classList.remove('active');
        }
    }
}

// Initialize when modal opens
document.addEventListener('DOMContentLoaded', () => {
    // We can also bind the "Finalize" button in invite.html to open signature modal
    // let's reuse a button or add one
    const signatureTrigger = document.querySelector('[data-modal="signatureModal"]');
    if (signatureTrigger) {
        signatureTrigger.addEventListener('click', () => {
            document.getElementById('signatureModal').classList.add('active');
            if (!window.signatureModal) {
                window.signatureModal = new SignatureModal();
            }
        });
    }

    // Bind custom finalize button if exists
    const finalizeBtn = document.getElementById('finalizeAssignmentBtn');
    if (finalizeBtn) {
        finalizeBtn.addEventListener('click', () => {
            document.getElementById('signatureModal').classList.add('active');
            if (!window.signatureModal) window.signatureModal = new SignatureModal();
        });
    }
});

// Save state before page unload
window.addEventListener('beforeunload', () => {
    MarkTrack.saveState();
});

// ===================================================================
// FOOTER DUPLICATION PREVENTION
// Remove any duplicate footers that might be created
// ===================================================================
function removeDuplicateFooters() {
    const footers = document.querySelectorAll('.app-footer');
    if (footers.length > 1) {
        console.warn(`Found ${footers.length} footers, removing duplicates...`);
        // Keep only the first one, remove the rest
        for (let i = 1; i < footers.length; i++) {
            footers[i].remove();
        }
    }
}

// Run on load
document.addEventListener('DOMContentLoaded', () => {
    removeDuplicateFooters();
    
    // Also check periodically (in case paste creates duplicates)
    setInterval(removeDuplicateFooters, 2000);
});

// Run after any paste event
document.addEventListener('paste', () => {
    setTimeout(removeDuplicateFooters, 100);
});

// Also check when content changes in editor
if (document.getElementById('editor-pages')) {
    const observer = new MutationObserver(() => {
        removeDuplicateFooters();
    });
    
    observer.observe(document.getElementById('editor-pages'), {
        childList: true,
        subtree: true
    });
}

// ===================================================================
// TOOLBAR DUPLICATION PREVENTION
// Remove any duplicate toolbars (only first page should have toolbar)
// ===================================================================
function removeDuplicateToolbars() {
    const toolbars = document.querySelectorAll('.ql-toolbar');
    if (toolbars.length > 1) {
        console.warn(`Found ${toolbars.length} toolbars, removing duplicates...`);
        // Keep only the first one, remove the rest
        for (let i = 1; i < toolbars.length; i++) {
            toolbars[i].remove();
        }
    }
}

// Run on load
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(removeDuplicateToolbars, 500);
    
    // Also check periodically
    setInterval(removeDuplicateToolbars, 3000);
});

// Run after paste events
document.addEventListener('paste', () => {
    setTimeout(removeDuplicateToolbars, 200);
});
