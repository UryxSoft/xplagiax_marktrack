// Analysis Tracker Manager
class AnalysisTracker {
    constructor() {
        this.stats = null;
        this.countdownInterval = null;
        this.updateInterval = null;
        this.init();
    }

    async init() {
        // Asegurar que el modal esté oculto al iniciar
        const modal = document.getElementById('upgradeModal');
        if (modal) {
            modal.classList.remove('active');
            document.body.style.overflow = '';
        }
        
        await this.loadStats();
        this.updateProgressBar();
        this.startCountdown();
        this.startAutoUpdate();
        this.attachEventListeners();
        
        // Mostrar modal si el usuario tiene 0 análisis restantes
        if (this.stats && this.stats.remaining === 0) {
            this.showUpgradeModal();
        }
    }

    async loadStats() {
        try {
            const response = await fetch('/x_analysiscounter/api/analysis/stats');
            const data = await response.json();
            
            if (data.success) {
                this.stats = data.data;
                return true;
            } else {
                console.error('Error loading stats:', data.error);
                return false;
            }
        } catch (error) {
            console.error('Error fetching stats:', error);
            return false;
        }
    }

    updateProgressBar() {
        if (!this.stats) return;

        const { used, limit, remaining, percentage } = this.stats;
        
        // Actualizar número
        const numberEl = document.getElementById('miniProgressNumber');
        if (numberEl) {
            numberEl.textContent = `${remaining}/${limit}`;
        }

        // Actualizar barra circular
        const progressBar = document.getElementById('miniProgressBar');
        if (progressBar) {
            const circumference = 125.66; // 2 * PI * 20
            
            // CORREGIDO: Calcular porcentaje de RESTANTES (no usados)
            const remainingPercentage = (remaining / limit) * 100;
            const offset = circumference - (remainingPercentage / 100 * circumference);
            progressBar.style.strokeDashoffset = offset;

            // Cambiar color según el porcentaje RESTANTE (4 niveles)
            progressBar.classList.remove('blue', 'green', 'red', 'orange');
            if (remainingPercentage > 50) {
                // Más del 50% restante = verde (todo bien)
                progressBar.classList.add('green');
            } else if (remainingPercentage > 30) {
                // Entre 30% y 50% restante = azul (atención)
                progressBar.classList.add('blue');
            } else if (remainingPercentage > 10) {
                // Entre 10% y 30% restante = naranja (advertencia)
                progressBar.classList.add('orange');
            } else {
                // Menos del 10% restante = rojo (crítico)
                progressBar.classList.add('red');
            }
        }

        // Mostrar badge según estado (crítico o advertencia)
        const badge = document.getElementById('criticalBadge');
        if (badge) {
            // Remover todas las clases primero
            badge.classList.remove('show', 'critical-badge', 'warning-badge');
            
            const remainingPercentage = (remaining / limit) * 100;
            
            if (remaining === 0) {
                // Estado crítico (rojo) - agotado
                badge.classList.add('critical-badge', 'show');
                badge.textContent = '!';
            } else if (remainingPercentage <= 20) {
                // Estado advertencia (naranja) - 20% o menos
                badge.classList.add('warning-badge', 'show');
                badge.textContent = '⚠';
            }
            // Si está por encima del 20%, no se muestra el badge
        }
        
        // Actualizar tooltip
        this.updateTooltip();
    }
    
    updateTooltip() {
        if (!this.stats) return;
        
        const { remaining, limit } = this.stats;
        
        const tooltipRemaining = document.getElementById('tooltipRemaining');
        const tooltipLimit = document.getElementById('tooltipLimit');
        
        if (tooltipRemaining) tooltipRemaining.textContent = remaining;
        if (tooltipLimit) tooltipLimit.textContent = limit;
    }

   startCountdown() {
        const countdownEl = document.getElementById('countdownTimer');
        const tooltipReset = document.getElementById('tooltipReset');
        
        if (!this.stats) return;

        // Limpiar intervalo anterior si existe
        if (this.countdownInterval) {
            clearInterval(this.countdownInterval);
        }

        // ✅ USAR reset_in_seconds del servidor (calculado desde limit_reached_at)
        let secondsRemaining = this.stats.reset_in_seconds || 0;
        
        console.log('⏱️ Countdown iniciado:', {
            secondsRemaining,
            reset_at: this.stats.reset_at,
            limit_reached_at: this.stats.limit_reached_at
        });

        const updateCountdown = () => {
            // ✅ Cuando llega a 0, recargar la página
            if (secondsRemaining <= 0) {
                console.log('✅ Countdown completado, recargando...');
                
                // Mostrar mensaje de "reseteando"
                if (countdownEl) {
                    countdownEl.innerHTML = '<span style="color: #28a745;">✓ Resetting...</span>';
                }
                if (tooltipReset) {
                    tooltipReset.innerHTML = '<span style="color: #28a745;">✓ Resetting...</span>';
                }
                
                // Recargar después de 2 segundos
                setTimeout(() => {
                    location.reload();
                }, 2000);
                
                return;
            }

            const hours = Math.floor(secondsRemaining / 3600);
            const minutes = Math.floor((secondsRemaining % 3600) / 60);
            const seconds = secondsRemaining % 60;

            const timeString = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
            
            // Actualizar countdown del modal
            if (countdownEl) {
                countdownEl.textContent = timeString;
                
                // ✅ Cambiar color según tiempo restante
                if (hours < 1) {
                    countdownEl.style.color = '#d9534f'; // Rojo si queda menos de 1 hora
                } else if (hours < 6) {
                    countdownEl.style.color = '#f0ad4e'; // Naranja si quedan menos de 6 horas
                } else {
                    countdownEl.style.color = '#5bc0de'; // Azul normal
                }
            }
            
            // Actualizar countdown del tooltip
            if (tooltipReset) {
                tooltipReset.textContent = timeString;
            }

            secondsRemaining--;
        };

        updateCountdown(); // Ejecutar inmediatamente
        this.countdownInterval = setInterval(updateCountdown, 1000);
    }

    startAutoUpdate() {
        // Actualizar stats cada 5 minutos
        this.updateInterval = setInterval(async () => {
            const loaded = await this.loadStats();
            if (loaded) {
                this.updateProgressBar();
                // ✅ Reiniciar countdown con nuevos datos
                this.startCountdown();
            }
        }, 5 * 60 * 1000);
    }

    async performAnalysis() {
        try {
            const response = await fetch('/x_analysiscounter/api/analysis/perform', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            const data = await response.json();

            if (data.success) {
                this.stats = data.stats;
                this.updateProgressBar();
                // ✅ Reiniciar countdown después de un análisis
                this.startCountdown();
                return { success: true, stats: data.stats };
            } else {
                // Si llegó al límite, mostrar modal
                if (response.status === 403) {
                    this.stats = data.stats;
                    this.showUpgradeModal();
                }
                return { success: false, error: data.error };
            }
        } catch (error) {
            console.error('Error performing analysis:', error);
            return { success: false, error: error.message };
        }
    }

    showUpgradeModal() {
        const modal = document.getElementById('upgradeModal');
        if (modal) {
            modal.classList.add('active');
            this.loadPlans();
            this.startCountdown(); // Asegurar que el countdown esté activo en el modal
            document.body.style.overflow = 'hidden'; // Prevenir scroll del body
        }
    }

    hideUpgradeModal() {
        const modal = document.getElementById('upgradeModal');
        if (modal) {
            modal.classList.remove('active');
            document.body.style.overflow = ''; // Restaurar scroll del body
        }
    }

    async loadPlans() {
        try {
            const response = await fetch('/x_analysiscounter/api/analysis/plans');
            const data = await response.json();

            if (data.success) {
                this.renderPlans(data.plans, data.current_plan);
            }
        } catch (error) {
            console.error('Error loading plans:', error);
        }
    }

// ✅ MÉTODO ACTUALIZADO: Renderizar planes con información del temporizador
    renderPlans_original(plans, currentPlan) {
        const container = document.getElementById('pricingCardsContainer');
        if (!container) return;

        // Jerarquía de planes
        const planHierarchy = {
            'Starter': 0,
            'Scholar Suite': 1,
            'Individual': 2,
            'Research Essentials': 3
        };

        const currentPlanLevel = planHierarchy[currentPlan] || 0;

       
        // Filtrar planes según el plan actual
        const planPriority = ['Scholar Suite', 'Individual', 'Research Essentials'];
        const sortedPlans = plans
            .filter(p => {
                if (p.name === 'Starter' || p.name === 'Institutes') return false;
                const planLevel = planHierarchy[p.name] || 0;
                return planLevel > currentPlanLevel; // Solo mostrar upgrades
            })
            .sort((a, b) => planPriority.indexOf(a.name) - planPriority.indexOf(b.name));

        // ✅ Agregar sección de temporizador si el contador está en 0
        let timerHtml = '';
        if (this.stats && this.stats.remaining === 0) {
            timerHtml = `
               
            `;
        }

        container.innerHTML = timerHtml + sortedPlans.map((plan) => {
            const isCurrent = plan.name === currentPlan;
            const isFeatured = plan.name === 'Individual';
            const storageGB = (plan.storage_mb);

            return `
                <div class="pricing-card ${isFeatured ? 'featured' : ''} ${isCurrent ? 'current-plan' : ''}">
                    ${isCurrent ? '<div class="current-plan-badge">Your Current Plan</div>' : ''}
                    <div class="plan-name">${plan.name}</div>
                    <div class="plan-description">${plan.description}</div>
                    <div class="plan-price">$ ${plan.price_monthly}</div>
                    <div class="plan-period">per month</div>
                    
                    <ul class="plan-features">
                        <li><strong>${plan.daily_analysis_limit}</strong> daily analyses</li>
                        <li><strong>${storageGB} GB</strong> storage</li>
                        <li>Advanced plagiarism detection</li>
                        <li>Priority support</li>
                    </ul>
                    
                    <button class="plan-button ${isFeatured ? 'primary' : 'secondary'}" 
                            onclick="analysisTracker.upgradeToPlan('${plan.name}')">
                        Upgrade Now
                    </button>
                </div>
            `;
        }).join('');

        // ✅ Iniciar countdown en el modal si hay temporizador
        if (timerHtml) {
            this.startModalCountdown();
        }
    }

    // ✅ MÉTODO ACTUALIZADO: Renderizar planes con características específicas por plan
renderPlans(plans, currentPlan) {
    const container = document.getElementById('pricingCardsContainer');
    if (!container) return;

    // Jerarquía de planes
    const planHierarchy = {
        'Starter': 0,
        'Scholar Suite': 1,
        'Individual': 2,
        'Research Essentials': 3
    };

    const currentPlanLevel = planHierarchy[currentPlan] || 0;

    // ✅ Características por plan
    const planFeatures = {
        'Starter': [
            'AI-generated text detection',
            'Similarity analysis'
        ],
        'Scholar Suite': [
            'Everything in Starter, plus:',
            'Web plagiarism detection',
            'Wikipedia database comparison',
            'Semantics analysis',
            'Documents storage'
        ],
        'Individual': [
            'Everything in Scholar Suite, plus:',
            'Paraphrasing analysis', 
            'AI-generated images detection',
            'Cloud services(One Drive, Google Drive, DropBox., BOX)'
        ],
        'Research Essentials': [
            'Everything in Individual, plus:',
            'Academic databases comparison'
        ],
        'Institutes': [
            'Patents analysis',
            'Originality scoring'
        ]
    };

    // Filtrar planes según el plan actual
    const planPriority = ['Scholar Suite', 'Individual', 'Research Essentials'];
    const sortedPlans = plans
        .filter(p => {
            if (p.name === 'Starter' || p.name === 'Institutes') return false;
            const planLevel = planHierarchy[p.name] || 0;
            return planLevel > currentPlanLevel; // Solo mostrar upgrades
        })
        .sort((a, b) => planPriority.indexOf(a.name) - planPriority.indexOf(b.name));

    // ✅ Agregar sección de temporizador si el contador está en 0
    let timerHtml = '';
    if (this.stats && this.stats.remaining === 0) {
        timerHtml = `
           
        `;
    }

    container.innerHTML = timerHtml + sortedPlans.map((plan) => {
        const isCurrent = plan.name === currentPlan;
        const isFeatured = plan.name === 'Individual';
        const storageGB = (plan.storage_mb);
        
        // ✅ Obtener características del plan
        const features = planFeatures[plan.name] || [];

        return `
            <div class="pricing-card ${isFeatured ? 'featured' : ''} ${isCurrent ? 'current-plan' : ''}">
                ${isCurrent ? '<div class="current-plan-badge">Your Current Plan</div>' : ''}
                <div class="plan-name">${plan.name}</div>
                <div class="plan-description">${plan.description}</div>
                <div class="plan-price">$ ${plan.price_monthly}</div>
                <div class="plan-period">per month</div>
                <ul class="plan-features">
                    <li><strong>${plan.daily_analysis_limit}</strong> daily analyses</li>
                    <li><strong>${storageGB} GB</strong> storage</li>
                    ${features.map(feature => `<li>${feature}</li>`).join('')}
                </ul>
                
                <button class="plan-button ${isFeatured ? 'primary' : 'secondary'}" 
                        onclick="analysisTracker.upgradeToPlan('${plan.name}')">
                    Upgrade Now
                </button>
            </div>
        `;
    }).join('');

    // ✅ Iniciar countdown en el modal si hay temporizador
    if (timerHtml) {
        this.startModalCountdown();
    }
}
    // ✅ NUEVO MÉTODO: Countdown específico para el modal
    startModalCountdown() {
        const modalTimer = document.getElementById('countdownTimerModal');
        if (!modalTimer || !this.stats) return;

        let secondsRemaining = this.stats.reset_in_seconds || 0;

        const updateModalTimer = () => {
            if (secondsRemaining <= 0) {
                modalTimer.innerHTML = '<span style="color: #28a745;">✓ Resetting...</span>';
                setTimeout(() => location.reload(), 2000);
                return;
            }

            const hours = Math.floor(secondsRemaining / 3600);
            const minutes = Math.floor((secondsRemaining % 3600) / 60);
            const seconds = secondsRemaining % 60;

            const timeString = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
            modalTimer.textContent = timeString;

            // Cambiar color según tiempo restante
            if (hours < 1) {
                modalTimer.style.color = '#d9534f';
            } else if (hours < 6) {
                modalTimer.style.color = '#f0ad4e';
            } else {
                modalTimer.style.color = '#5bc0de';
            }

            secondsRemaining--;
        };

        updateModalTimer();
        // Usar un interval separado para el modal
        setInterval(updateModalTimer, 1000);
    }

    upgradeToPlan(planName) {
        // Aquí implementar la lógica de upgrade (Stripe/PayPal)
        console.log(`Upgrading to ${planName}`);
        // Redirigir a checkout o abrir modal de pago
        window.location.href = `/checkout?plan=${encodeURIComponent(planName)}`;
    }

    attachEventListeners() {
        // Click en el progress bar para ver detalles
        const progressContainer = document.getElementById('miniProgress');
        if (progressContainer) {
            progressContainer.addEventListener('click', () => {
                if (this.stats && this.stats.remaining === 0) {
                    this.showUpgradeModal();
                }
            });
        }

        // Cerrar modal
        const closeBtn = document.getElementById('closeUpgradeModal');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.hideUpgradeModal());
        }

        // Cerrar modal al hacer click fuera
        const modal = document.getElementById('upgradeModal');
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.hideUpgradeModal();
                }
            });
        }

        // Hook aiAnalyzeBtn si existe en esta página (documentedit / review)
        this.hookAnalyzeButton();
    }

    /**
     * Intercepts #aiAnalyzeBtn to gate on quota.
     * - If 0 remaining → block click, show upgrade modal.
     * - Otherwise, the original handler in review_ai_detection.js runs normally.
     *   After a successful analysis window.analysisTracker.updateAfterAnalysis(stats)
     *   is called from review_ai_detection.js to refresh the bar.
     */
    hookAnalyzeButton() {
        const btn = document.getElementById('aiAnalyzeBtn');
        if (!btn) return;

        // Guard: runs BEFORE the review_ai_detection listener (capture phase)
        btn.addEventListener('click', (e) => {
            if (this.stats && this.stats.remaining === 0) {
                e.stopImmediatePropagation();
                this.showUpgradeModal();
            }
        }, true); // capture = true → fires first

        // Disable button visually if quota exhausted
        this._refreshAnalyzeBtnState();
    }

    _refreshAnalyzeBtnState() {
        const btn = document.getElementById('aiAnalyzeBtn');
        if (!btn) return;
        if (this.stats && this.stats.remaining === 0) {
            btn.title = 'Daily analysis limit reached. Upgrade to continue.';
            btn.style.opacity = '0.5';
            btn.style.cursor = 'not-allowed';
        } else {
            btn.title = '';
            btn.style.opacity = '';
            btn.style.cursor = '';
        }
    }

    /**
     * Called externally by review_ai_detection.js after a successful analysis.
     * Increments the counter via the API and refreshes the progress bar.
     */
    async updateAfterAnalysis() {
        try {
            const resp = await fetch('/x_analysiscounter/api/analysis/perform', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            const data = await resp.json();
            if (data.success) {
                this.stats = data.stats;
            } else if (resp.status === 403) {
                this.stats = data.stats;
            }
        } catch (e) {
            // Fallback: just reload stats
            await this.loadStats();
        }
        this.updateProgressBar();
        this.startCountdown();
        this._refreshAnalyzeBtnState();
    }

    destroy() {
        if (this.countdownInterval) {
            clearInterval(this.countdownInterval);
        }
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }
    }
}

// Inicializar cuando el DOM esté listo
let analysisTracker;
document.addEventListener('DOMContentLoaded', () => {
    analysisTracker = new AnalysisTracker();
});

// Función global para usar en otros scripts
async function checkAndPerformAnalysis() {
    if (!analysisTracker) {
        console.error('Analysis tracker not initialized');
        return { success: false, error: 'Tracker not initialized' };
    }
    
    const result = await analysisTracker.performAnalysis();
    return result;
}