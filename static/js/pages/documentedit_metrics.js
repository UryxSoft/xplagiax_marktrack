/**
 * documentedit_metrics.js
 * Handles timeline events and Chart.js metrics for the document review dashboard.
 */

(function() {
    'use strict';

    let reviewChartInstance = null;

    /**
     * Renders integrity-critical events in the Timeline tab.
     */
    function renderTimelineEvents(logs) {
        const container = document.getElementById('timelineEventsContainer');
        if (!container) return;

        if (!logs || logs.length === 0) {
            container.innerHTML = '<div style="opacity:0.3;text-align:center;padding:20px;color:#fff;">No integrity-critical events detected.</div>';
            return;
        }

        let html = '';
        logs.forEach(lg => {
            const dateObj = lg.timestamp ? new Date(lg.timestamp) : null;
            const timeStr = (dateObj && !isNaN(dateObj)) 
                ? dateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) 
                : (lg.ms ? `T+${Math.round(lg.ms/1000)}s` : 'Event');
            
            const type = lg.event_type || lg.t;
            let styleConfig = null;

            if (type === 'pause' || type === 'pause-long') {
                 const dur = lg.details?.durationSeconds || Math.round(lg.duration / 1000) || '?';
                 styleConfig = { 
                    icon: '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>', 
                    color: '#fbbf24', bg: 'rgba(245, 158, 11, 0.1)', border: 'rgba(245, 158, 11, 0.2)',
                    title: `${dur}s pause detected`
                 };
            }
            else if (type === 'paste') {
                const chars = lg.details?.length || lg.length || 0;
                styleConfig = {
                    icon: '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>',
                    color: '#ef4444', bg: 'rgba(239, 68, 68, 0.1)', border: 'rgba(239, 68, 68, 0.2)',
                    title: `${chars} characters pasted`
                };
            }
            else if (type === 'visibility-hidden') {
                styleConfig = {
                    icon: '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>',
                    color: '#f87171', bg: 'rgba(239, 68, 68, 0.05)', border: 'rgba(239, 68, 68, 0.1)',
                    title: `Left the assignment tab`
                };
            }
            else if (type === 'visibility-visible') {
                styleConfig = {
                    icon: '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>',
                    color: '#34d399', bg: 'rgba(52, 211, 153, 0.1)', border: 'rgba(52, 211, 153, 0.2)',
                    title: `Returned to assignment`
                };
            }
            else if (type === 'large-deletion') {
                styleConfig = {
                    icon: '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M3 6h18"></path><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg>',
                    color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.1)', border: 'rgba(245, 158, 11, 0.2)',
                    title: `Significant text removed`
                };
            }

            if (styleConfig) {
                html += `
                <div class="event-item" style="background:${styleConfig.bg}; border:1px solid ${styleConfig.border}; padding:12px; border-radius:10px; display:flex; gap:12px;">
                    <div style="color:${styleConfig.color}; width:18px;">${styleConfig.icon}</div>
                    <div class="event-content">
                        <strong style="display:block; font-size:13px; color:#fff;">${styleConfig.title}</strong>
                        <span style="font-size:11px; color:rgba(255,255,255,0.4);">${timeStr}</span>
                    </div>
                </div>`;
            }
        });

        if (!html) html = '<div style="opacity:0.3;text-align:center;padding:20px;color:#fff;">No major timeline anomalies.</div>';
        container.innerHTML = html;
    }

    /**
     * Renders the activity chart using Chart.js.
     */
    function renderReviewMetricsChart(activityMap) {
        const ctxEl = document.getElementById('reviewMetricsChart');
        if (!ctxEl) return;

        if (typeof Chart === 'undefined') {
            console.warn("[Review] Chart.js not loaded.");
            return;
        }

        try {
            let labels = [];
            let dps = [];
            let keys = Object.keys(activityMap).map(Number).filter(n => !isNaN(n)).sort((a,b)=>a-b);

            if (keys.length > 0) {
                const minMin = 0;
                const maxMin = Math.max(...keys);

                function getActivityVal(map, minute) {
                    const byNum = map[minute];
                    if (byNum !== undefined && byNum !== null) return Math.max(0, Number(byNum) || 0);
                    const byStr = map[String(minute)];
                    if (byStr !== undefined && byStr !== null) return Math.max(0, Number(byStr) || 0);
                    return 0;
                }

                for (let m = minMin; m <= maxMin; m++) {
                    labels.push('Min ' + (m + 1));
                    dps.push(getActivityVal(activityMap, m));
                }
            } else {
                labels = ['No activity'];
                dps = [0];
            }

            if (reviewChartInstance) {
                reviewChartInstance.destroy();
            }

            const ctx = ctxEl.getContext('2d');
            reviewChartInstance = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Keystrokes per minute',
                        data: dps,
                        borderColor: '#8b5cf6',
                        backgroundColor: 'rgba(139,92,246,0.12)',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.4,
                        pointRadius: dps.length > 30 ? 0 : 3,
                        pointHoverRadius: 5,
                        pointBackgroundColor: '#8b5cf6'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    scales: {
                        y: {
                            beginAtZero: true,
                            grid: { color: 'rgba(255,255,255,0.05)' },
                            ticks: { color: 'rgba(255,255,255,0.5)', font: { size: 10 } }
                        },
                        x: {
                            grid: { color: 'rgba(255,255,255,0.05)' },
                            ticks: { color: 'rgba(255,255,255,0.5)', font: { size: 10 }, maxTicksLimit: 15 }
                        }
                    },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: 'rgba(17,24,39,0.95)',
                            titleColor: '#a78bfa',
                            bodyColor: '#e5e7eb',
                            borderColor: 'rgba(139,92,246,0.3)',
                            borderWidth: 1
                        }
                    }
                }
            });
        } catch (err) {
            console.error("Chart.js error:", err);
        }
    }

    /**
     * Initializes real-time session metrics tracking for the current editor.
     */
    function initRealTimeMetrics() {
        if (!window.QuillTypingMetrics) {
            console.warn("[ReviewMetrics] QuillTypingMetrics class not found.");
            return;
        }

        const interval = setInterval(() => {
            const quill = window.quill; // In documentedit_core.js
            if (quill) {
                clearInterval(interval);
                
                // Initialize metric engine
                const configElement = document.getElementById('documentedit-config');
                const config = configElement ? JSON.parse(configElement.textContent || '{}') : {};
                const initialMetrics = config.metrics || {};

                const typingMetrics = new window.QuillTypingMetrics(window.quillPagination || quill, {
                    documentId: config.id || window.MT_DATA?.id,
                    initialMetrics: initialMetrics
                });
                typingMetrics.attachListeners();
                window.typingMetrics = typingMetrics;

                // Sync UI every second
                setInterval(() => {
                    const stats = typingMetrics.getMetrics();
                    _updateQuickStatsUI(stats);
                }, 1000);

                // Immediate update on text change for word count
                quill.on('text-change', () => {
                    const stats = typingMetrics.getMetrics();
                    _updateQuickStatsUI(stats);
                });
            }
        }, 500);
    }

    /**
     * Updates the Quick Statistics sidebar grid with session-specific values.
     */
    function _updateQuickStatsUI(stats) {
        if (!stats) return;

        // IDs from the sidebar grid in documentedit.html
        const mappings = {
            'val-total-words':   _countWords(window.quill.getText()),
            'val-writing-time':  _formatDuration(stats.effectiveTypingSeconds),
            'val-paste-events':  stats.pasteCount,
            'val-focus-time':    _formatDuration(stats.totalFocusSeconds),
            'val-keystrokes':    stats.totalKeystrokes,
            'val-backspaces':    stats.backspacesCount,
            'val-long-pauses':   stats.longPausesCount,
            'val-bulk-deletions':stats.largeDeletionsCount,
            'val-longest-burst': stats.longestBurst,
            'val-wpm':           stats.approxWPM
        };

        Object.entries(mappings).forEach(([id, val]) => {
            const el = document.getElementById(id);
            if (!el) return;

            let finalVal = val;
            if (id === 'val-wpm') finalVal = `${val} <small>WPM</small>`;
            if (id === 'val-longest-burst') finalVal = `${val} <small>chars</small>`;
            if (id === 'val-paste-events') finalVal = `${val} <small>events</small>`;

            if (el.innerHTML !== String(finalVal)) {
                el.innerHTML = finalVal;
            }
        });
    }

    function _countWords(text) {
        if (!text) return 0;
        return text.trim().split(/\s+/).filter(w => w.length > 0).length;
    }

    function _formatDuration(s) {
        const m = Math.floor(s / 60);
        const rs = s % 60;
        return `${m}m ${rs}s`;
    }

    // Initialize with Global Data Manager
    document.addEventListener('DOMContentLoaded', () => {
        const interval = setInterval(() => {
            if (window.MT_DATA) {
                clearInterval(interval);
                const mData = window.MT_DATA.metrics || {};
                renderTimelineEvents(mData.raw_logs || []);
                renderReviewMetricsChart(mData.activity_by_minute || {});
                
                // Also start tracking THIS session's metrics for the professor
                initRealTimeMetrics();
            }
        }, 100);
    });

})();
