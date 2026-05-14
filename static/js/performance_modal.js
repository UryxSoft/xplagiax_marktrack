/**
 * performance_modal.js
 * ─────────────────────────────────────────────────────────────────
 * SaaS-grade Performance Insights Modal for Redis cache observability.
 * Singleton pattern – one modal instance shared across the app.
 * ─────────────────────────────────────────────────────────────────
 */

(function (global) {
    'use strict';

    // ── ApexCharts instance reference ──────────────────────────── //
    let _chart = null;
    let _refreshTimer = null;
    const REFRESH_INTERVAL_MS = 15000; // 15 s

    // ── DOM builder ───────────────────────────────────────────── //
    function _buildModalHTML() {
        return `
        <div id="perfInsightsOverlay">
          <div id="perfInsightsModal" role="dialog" aria-modal="true" aria-labelledby="piTitle">

            <!-- Header -->
            <div class="pi-header">
              <div class="pi-header-left">
                <div class="pi-header-icon">
                  <svg width="20" height="20" fill="none" stroke="#818cf8" stroke-width="2"
                       stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                  </svg>
                </div>
                <div>
                  <h3 class="pi-title" id="piTitle">Performance Insights</h3>
                  <p class="pi-subtitle">Real-time cache efficiency metrics</p>
                </div>
              </div>
              <button class="pi-close-btn" id="piCloseBtn" aria-label="Close">
                <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            <!-- Status bar -->
            <div class="pi-status-bar">
              <div class="pi-status-dot" id="piStatusDot"></div>
              <span id="piStatusLabel" class="pi-status-label">—</span>
              <span id="piPingLatency"></span>
              <span style="margin-left:auto;font-size:11px;" id="piLastUpdated"></span>
            </div>

            <!-- Body -->
            <div class="pi-body">

              <!-- Offline Warning (hidden by default) -->
              <div class="pi-warning" id="piWarning" style="display:none">
                <svg width="16" height="16" fill="none" stroke="#fbbf24" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
                  <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <span id="piWarningText">Cache is currently unavailable. Metrics may be limited.</span>
              </div>

              <!-- KPI Cards -->
              <div class="pi-cards" style="margin-top:16px;">

                <!-- Card 1 – Hit Ratio -->
                <div class="pi-card">
                  <p class="pi-card-label">Cache Hit Ratio</p>
                  <div class="pi-card-value" id="piHitRatio">—</div>
                  <div class="pi-progress-track">
                    <div class="pi-progress-fill" id="piHitFill"></div>
                  </div>
                  <p class="pi-card-sub" id="piHitSub">— hits · — misses</p>
                </div>

                <!-- Card 2 – System Status -->
                <div class="pi-card">
                  <p class="pi-card-label">System Status</p>
                  <div id="piSysStatus" style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
                    <div class="pi-status-dot" id="piCardStatusDot" style="width:12px;height:12px;"></div>
                    <span id="piCardStatusText" style="font-size:20px;font-weight:700;color:#f1f5f9;">—</span>
                  </div>
                  <p class="pi-card-sub" id="piPingText">Ping latency: —</p>
                  <p class="pi-card-sub" id="piReqCount">Total requests tracked: —</p>
                </div>

              </div><!-- /pi-cards -->

              <!-- Latency Comparison -->
              <div style="margin-bottom:20px;">
                <p class="pi-section-title">Latency Comparison</p>
                <div class="pi-latency-row">
                  <div class="pi-latency-box">
                    <div class="lbl">Cached Avg</div>
                    <div class="val" id="piLatCached">—</div>
                  </div>
                  <div class="pi-latency-box">
                    <div class="lbl">Uncached Est.</div>
                    <div class="val" id="piLatUncached">—</div>
                  </div>
                </div>
                <div style="text-align:center;">
                  <span class="pi-speed-badge" id="piSpeedBadge">
                    <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"
                         stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
                      <line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>
                    </svg>
                    Computing…
                  </span>
                </div>
              </div>

              <!-- DB Load Reduction -->
              <div style="margin-bottom:20px;">
                <p class="pi-section-title">Database Load Reduction</p>
                <div class="pi-card" style="display:flex;align-items:center;gap:20px;">
                  <div class="pi-db-pct" id="piDbPct">—%</div>
                  <div>
                    <div style="font-size:14px;font-weight:600;color:#c7d2fe;" id="piDbText">
                      — DB queries avoided
                    </div>
                    <div class="pi-card-sub">Each cache hit skips one or more SQL round-trips.</div>
                  </div>
                </div>
              </div>

              <!-- Hit Ratio History Chart -->
              <div class="pi-chart-section">
                <p class="pi-section-title">Hit Ratio — Last 10 snapshots</p>
                <div id="piHitRatioChart"></div>
              </div>

              <!-- Smart Recommendation -->
              <div class="pi-rec-box" id="piRecBox">
                <svg width="16" height="16" fill="none" stroke="#818cf8" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/>
                  <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <p class="pi-rec-text"><strong>Recommendation:</strong> <span id="piRec">Loading…</span></p>
              </div>

            </div><!-- /pi-body -->

            <!-- Footer -->
            <div class="pi-footer">
              <span class="pi-footer-note">Auto-refreshes every 15 s · Data stored in Redis</span>
              <button class="pi-btn-close" id="piFooterClose">Close</button>
            </div>

          </div>
        </div>
        `;
    }

    // ── Inject DOM on first call ─────────────────────────────── //
    function _ensureDOM() {
        if (document.getElementById('perfInsightsOverlay')) return;
        const wrapper = document.createElement('div');
        wrapper.innerHTML = _buildModalHTML();
        document.body.appendChild(wrapper.firstElementChild);

        // Wire static close events
        document.getElementById('piCloseBtn').addEventListener('click', PerformanceModalService.close);
        document.getElementById('piFooterClose').addEventListener('click', PerformanceModalService.close);
        document.getElementById('perfInsightsOverlay').addEventListener('click', function (e) {
            if (e.target === this) PerformanceModalService.close();
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') PerformanceModalService.close();
        });
    }

    // ── Render chart ─────────────────────────────────────────── //
    function _renderChart(history) {
        const el = document.getElementById('piHitRatioChart');
        if (!el) return;

        // Flatten history to series data
        const labels = history.map((_, i) => `T-${history.length - 1 - i}`);
        const series = history.map(h => h.hr || 0);

        const options = {
            chart: {
                type: 'area',
                height: 140,
                background: 'transparent',
                toolbar: { show: false },
                sparkline: { enabled: false },
                animations: { enabled: true, speed: 600 },
            },
            grid: {
                borderColor: 'rgba(255,255,255,.06)',
                strokeDashArray: 4,
                padding: { left: 0, right: 0, top: 0, bottom: 0 },
            },
            stroke: { curve: 'smooth', width: 2, colors: ['#818cf8'] },
            fill: {
                type: 'gradient',
                gradient: {
                    shadeIntensity: 1,
                    opacityFrom: 0.35,
                    opacityTo: 0.02,
                    stops: [0, 100],
                    colorStops: [
                        { offset: 0, color: '#818cf8', opacity: 0.35 },
                        { offset: 100, color: '#818cf8', opacity: 0.02 },
                    ],
                },
            },
            series: [{ name: 'Hit Ratio %', data: series }],
            xaxis: {
                categories: labels,
                labels: { style: { colors: 'rgba(255,255,255,.25)', fontSize: '10px' } },
                axisBorder: { show: false },
                axisTicks: { show: false },
            },
            yaxis: {
                min: 0, max: 100,
                labels: {
                    style: { colors: 'rgba(255,255,255,.25)', fontSize: '10px' },
                    formatter: v => v + '%',
                },
            },
            tooltip: {
                theme: 'dark',
                y: { formatter: v => v.toFixed(1) + '%' },
            },
            markers: { size: 3, colors: ['#818cf8'], strokeWidth: 0 },
        };

        if (_chart) {
            _chart.updateOptions(options, true, true);
        } else {
            _chart = new ApexCharts(el, options);
            _chart.render();
        }
    }

    // ── Populate modal with fetched data ─────────────────────── //
    function _populate(data) {
        const up = data.systemStatus === 'up';
        const now = new Date().toLocaleTimeString();

        // Status bar
        const dot = document.getElementById('piStatusDot');
        const lbl = document.getElementById('piStatusLabel');
        dot.className = 'pi-status-dot ' + (up ? 'up' : 'down');
        lbl.textContent = up ? 'Cache Online' : 'Cache Offline';
        document.getElementById('piPingLatency').textContent =
            data.pingLatencyMs >= 0 ? `· ${data.pingLatencyMs} ms ping` : '';
        document.getElementById('piLastUpdated').textContent = `Updated ${now}`;

        // Warning banner
        const warn = document.getElementById('piWarning');
        const warnTxt = document.getElementById('piWarningText');
        if (!up) {
            warn.style.display = 'flex';
            warnTxt.textContent = data.totalHits === 0
                ? 'Cache is currently unavailable. Metrics may be limited.'
                : 'Cache is currently unavailable. Showing last recorded metrics.';
        } else if (data.totalHits === 0 && data.totalMisses === 0) {
            warn.style.display = 'flex';
            warnTxt.textContent = 'No cache activity detected yet.';
        } else {
            warn.style.display = 'none';
        }

        // Hit Ratio card
        const hr = data.hitRatio;
        document.getElementById('piHitRatio').textContent = hr.toFixed(1) + '%';
        document.getElementById('piHitSub').textContent =
            `${data.totalHits.toLocaleString()} hits · ${data.totalMisses.toLocaleString()} misses`;

        const fill = document.getElementById('piHitFill');
        fill.className = 'pi-progress-fill ' + (hr < 50 ? 'red' : hr < 70 ? 'yellow' : 'green');
        // Trigger CSS transition
        requestAnimationFrame(() => { fill.style.width = Math.min(hr, 100) + '%'; });

        // System Status card
        const cardDot = document.getElementById('piCardStatusDot');
        cardDot.className = 'pi-status-dot ' + (up ? 'up' : 'down');
        cardDot.style.width = '12px'; cardDot.style.height = '12px';
        document.getElementById('piCardStatusText').textContent = up ? 'Online' : 'Offline';
        document.getElementById('piPingText').textContent =
            data.pingLatencyMs >= 0 ? `Ping latency: ${data.pingLatencyMs} ms` : 'Ping: unavailable';
        document.getElementById('piReqCount').textContent =
            `Total requests tracked: ${(data.totalHits + data.totalMisses).toLocaleString()}`;

        // Latency
        document.getElementById('piLatCached').textContent =
            data.latencyCachedMs > 0 ? `${data.latencyCachedMs} ms` : '< 1 ms';
        document.getElementById('piLatUncached').textContent = `~${data.latencyUncachedEstMs} ms`;

        const uncached = data.latencyUncachedEstMs;
        const cached = data.latencyCachedMs || 1;
        const speedup = uncached > cached ? Math.round((1 - cached / uncached) * 100) : 0;
        document.getElementById('piSpeedBadge').innerHTML = `
          <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"
               stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
            <line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>
          </svg>
          ${speedup > 0 ? `↓ ${speedup}% faster` : 'Measuring…'}
        `;

        // DB Load
        const total = data.totalHits + data.totalMisses;
        const dbPct = total > 0 ? Math.round((data.dbQueriesAvoided / total) * 100) : 0;
        document.getElementById('piDbPct').textContent = dbPct + '%';
        document.getElementById('piDbText').textContent =
            `${data.dbQueriesAvoided.toLocaleString()} DB queries avoided`;

        // Recommendation
        document.getElementById('piRec').textContent = data.recommendation;

        // Chart
        if (data.history && data.history.length > 0) {
            _renderChart(data.history);
        }
    }

    // ── Fetch metrics ─────────────────────────────────────────── //
    async function _fetchAndRender() {
        try {
            const res = await fetch('/api/cache/metrics');
            if (!res.ok) throw new Error('non-ok response');
            const data = await res.json();
            _populate(data);
        } catch (err) {
            console.debug('[PerformanceModal] Fetch failed:', err);
            // Show minimal offline state
            _populate({
                systemStatus: 'down', hitRatio: 0, totalHits: 0, totalMisses: 0,
                latencyCachedMs: 0, latencyUncachedEstMs: 150,
                dbQueriesAvoided: 0, pingLatencyMs: -1,
                recommendation: 'Unable to fetch metrics. Please check connection.',
                history: [],
            });
        }
    }

    // ── Public API ────────────────────────────────────────────── //
    const PerformanceModalService = {
        open() {
            _ensureDOM();
            const overlay = document.getElementById('perfInsightsOverlay');
            overlay.classList.add('pi-open');
            document.body.style.overflow = 'hidden';

            // Reset progress bars to 0 before animating
            const fill = document.getElementById('piHitFill');
            if (fill) fill.style.width = '0%';

            _fetchAndRender();
            _refreshTimer = setInterval(_fetchAndRender, REFRESH_INTERVAL_MS);
        },

        close() {
            const overlay = document.getElementById('perfInsightsOverlay');
            if (!overlay) return;
            overlay.classList.remove('pi-open');
            document.body.style.overflow = '';
            clearInterval(_refreshTimer);
            _refreshTimer = null;
        },
    };

    global.PerformanceModalService = PerformanceModalService;
})(window);
