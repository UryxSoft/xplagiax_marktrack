/**
 * cache_dashboard.js
 * Logic for fetching and rendering Cache Performance Insights.
 */

class CacheDashboard {
    constructor() {
        this.overlayId = 'cacheInsightsModal';
        this.pollingInterval = 5000; // 5 seconds
        this.timerId = null;
        this.isOpen = false;
        
        // Chart instances
        this.hitRatioChart = null;
        this.volumeChart = null;

        // Ensure DOM loaded
        document.addEventListener('DOMContentLoaded', () => this.init());
    }

    init() {
        this.overlay = document.getElementById(this.overlayId);
        if (!this.overlay) return;
        
        // Close buttons bind
        const closeBtns = this.overlay.querySelectorAll('[data-cd-close]');
        closeBtns.forEach(btn => btn.addEventListener('click', () => this.close()));
        
        // Sub-elements cache for fast DOM updates
        this.dom = {
            statusBadge: document.getElementById('cd-status-badge'),
            statusText: document.getElementById('cd-status-text'),
            lastUpdated: document.getElementById('cd-last-updated'),
            bodyContent: document.getElementById('cd-body-content'),
            loader: document.getElementById('cd-loader'),
            
            // KPIs
            valHitRatio: document.getElementById('cd-val-hit-ratio'),
            valTotalHits: document.getElementById('cd-val-total-hits'),
            valTotalMisses: document.getElementById('cd-val-total-misses'),
            valLatencyCached: document.getElementById('cd-val-latency-cached'),
            valLatencyUncached: document.getElementById('cd-val-latency-uncached'),
            valQueriesAvoided: document.getElementById('cd-val-queries-avoided'),
            
            // Recommendation
            recBox: document.getElementById('cd-recommendation-box'),
            recTitle: document.getElementById('cd-rec-title'),
            recText: document.getElementById('cd-rec-text')
        };
    }

    open() {
        if (!this.overlay) return;
        this.isOpen = true;
        this.overlay.classList.add('cd-open');
        
        // Initial Fetch
        this.showLoader(true);
        this.fetchData().then(() => {
            this.showLoader(false);
            // Re-trigger chart update once visible to ensure correct sizing
            if (this.lastData && this.lastData.history) {
                this.updateCharts(this.lastData.history);
            }
        });

        // Start Polling loop
        this.timerId = setInterval(() => {
            if (this.isOpen) this.fetchData();
        }, this.pollingInterval);
    }

    close() {
        if (!this.overlay) return;
        this.isOpen = false;
        this.overlay.classList.remove('cd-open');
        
        // Stop Polling
        if (this.timerId) {
            clearInterval(this.timerId);
            this.timerId = null;
        }
    }

    showLoader(show) {
        if (!this.dom.loader || !this.dom.bodyContent) return;
        if (show) {
            this.dom.loader.style.display = 'flex';
            this.dom.bodyContent.style.display = 'none';
        } else {
            this.dom.loader.style.display = 'none';
            this.dom.bodyContent.style.display = 'flex';
        }
    }

    async fetchData() {
        try {
            const res = await fetch('/api/cache/metrics');
            if (!res.ok) throw new Error("HTTP " + res.status);
            
            const data = await res.json();
            this.lastData = data;
            this.updateUI(data);
            
        } catch (err) {
            console.error("[CacheDashboard] Fetch failed:", err);
            // Fallback UI to offline state
            const fallbackData = {
                systemStatus: 'down',
                hitRatio: 0,
                totalHits: 0,
                totalMisses: 0,
                latencyCachedMs: 0,
                latencyUncachedEstMs: 0,
                dbQueriesAvoided: 0,
                pingLatencyMs: -1,
                recommendation: 'Connection to endpoint failed.',
                history: []
            };
            this.lastData = fallbackData;
            this.updateUI(fallbackData);
        }
    }

    updateUI(data) {
        // 1. Update Header Status
        const up = data.systemStatus === 'up';
        
        this.dom.statusBadge.className = `cd-status-badge ${up ? 'cd-up' : 'cd-down'}`;
        this.dom.statusText.textContent = up ? `Online (${data.pingLatencyMs || 0}ms)` : 'Offline';
        
        const now = new Date();
        this.dom.lastUpdated.textContent = `Last check: ${now.toLocaleTimeString()}`;

        // 2. Update KPIs
        const hr = data.hitRatio || 0;
        this.dom.valHitRatio.textContent = hr;
        this.dom.valHitRatio.className = `cd-kpi-value ${hr > 70 ? 'cd-val-good' : (hr > 50 ? 'cd-val-warn' : 'cd-val-danger')}`;
        
        this.dom.valTotalHits.textContent = this.formatNumber(data.totalHits || 0);
        this.dom.valTotalMisses.textContent = this.formatNumber(data.totalMisses || 0);
        this.dom.valLatencyCached.textContent = (data.latencyCachedMs || 0) + 'ms';
        this.dom.valLatencyUncached.textContent = (data.latencyUncachedEstMs || 250) + 'ms';
        this.dom.valQueriesAvoided.textContent = this.formatNumber(data.dbQueriesAvoided || 0);

        // 3. Update Recommendation Box
        this.dom.recText.textContent = data.recommendation || 'No recommendations at this time.';
        
        if (!up) {
            this.setRecommendationStyle('danger', 'System Unreachable');
        } else if (data.hitRatio < 50) {
            this.setRecommendationStyle('danger', 'Action Required');
        } else if (data.hitRatio < 70) {
            this.setRecommendationStyle('warn', 'Optimization Suggested');
        } else {
            this.setRecommendationStyle('good', 'System Optimal');
        }

        // 4. Render / Update Charts
        this.updateCharts(data.history);
    }

    setRecommendationStyle(level, title) {
        const icons = {
            'good': `<svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
            'warn': `<svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
            'danger': `<svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`
        };
        
        this.dom.recBox.className = `cd-recommendation cd-rec-${level}`;
        document.getElementById('cd-rec-icon-wrapper').innerHTML = icons[level];
        this.dom.recTitle.textContent = title;
    }

    updateCharts(history) {
        if (!window.ApexCharts) {
            console.warn("[CacheDashboard] ApexCharts not loaded.");
            return;
        }

        if (!history || history.length === 0) return;

        // Parse history
        // Data format: {t: timestamp, hr: hitRatio, h: hits, m: misses}
        const categories = history.map(h => {
            const d = new Date(h.t * 1000);
            return `${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
        });
        
        const hrData = history.map(h => h.hr);
        const hitsData = history.map(h => h.h);
        const missesData = history.map(h => h.m);

        // 1. Hit Ratio Chart (Area)
        if (!this.hitRatioChart) {
            const optionsHR = {
                series: [{ name: 'Hit Ratio %', data: hrData }],
                chart: { type: 'area', height: 260, toolbar: { show: false }, background: 'transparent', animations: { enabled: false } },
                colors: ['#3b82f6'],
                fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.4, opacityTo: 0.05, stops: [0, 100] } },
                dataLabels: { enabled: false },
                stroke: { curve: 'smooth', width: 2 },
                xaxis: { categories: categories, labels: { style: { colors: '#9ca3af' } }, tooltip: { enabled: false } },
                yaxis: { min: 0, max: 100, labels: { style: { colors: '#9ca3af' } } },
                grid: { borderColor: 'rgba(255,255,255,0.05)', strokeDashArray: 4 },
                theme: { mode: 'dark' }
            };
            this.hitRatioChart = new ApexCharts(document.querySelector("#cd-chart-hitratio"), optionsHR);
            this.hitRatioChart.render();
        } else {
            this.hitRatioChart.updateOptions({ xaxis: { categories: categories } });
            this.hitRatioChart.updateSeries([{ data: hrData }]);
        }

        // 2. Volume Chart (Bar)
        if (!this.volumeChart) {
            const optionsVol = {
                series: [
                    { name: 'Hits', data: hitsData },
                    { name: 'Misses', data: missesData }
                ],
                chart: { type: 'bar', height: 260, stacked: true, toolbar: { show: false }, background: 'transparent', animations: { enabled: false } },
                colors: ['#10b981', '#f59e0b'],
                plotOptions: { bar: { horizontal: false, columnWidth: '50%', borderRadius: 2 } },
                dataLabels: { enabled: false },
                stroke: { width: 0 },
                xaxis: { categories: categories, labels: { show: false } },
                yaxis: { labels: { style: { colors: '#9ca3af' } } },
                grid: { borderColor: 'rgba(255,255,255,0.05)', strokeDashArray: 4 },
                theme: { mode: 'dark' },
                legend: { position: 'top', horizontalAlign: 'right', labels: { colors: '#d1d5db' } }
            };
            this.volumeChart = new ApexCharts(document.querySelector("#cd-chart-volume"), optionsVol);
            this.volumeChart.render();
        } else {
            this.volumeChart.updateOptions({ xaxis: { categories: categories } });
            this.volumeChart.updateSeries([
                { data: hitsData },
                { data: missesData }
            ]);
        }
    }

    formatNumber(num) {
        if (num === undefined || num === null) return '0';
        if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
        if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
        return num.toString();
    }
}

// Global exposure
window.cacheDashboard = new CacheDashboard();
