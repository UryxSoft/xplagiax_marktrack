/**
 * editor.js - Funcionalidad para el Editor de Texto Inteligente
 * Maneja la interfaz, comunicación con el servidor y visualización de sugerencias
 * Versión mejorada con animaciones y efectos visuales
 */

// Variables globales
let editor;                     // Instancia de CKEditor
let socket;                     // Conexión WebSocket
let currentDocId = null;        // ID del documento actual
let analysisEnabled = {
    spelling: true,
    grammar: true,
    style: true,
    coherence: true,
    plagiarism: true
};
let realTimeAnalysis = true;    // Estado del análisis en tiempo real
let analysisTimeout;            // Timeout para análisis en tiempo real
let currentSuggestions = {};    // Almacena sugerencias actuales
let paragraphAnalysisQueue = new Set(); // Cola de párrafos para analizar
let saveToast;                  // Referencia al toast de guardado
let animationsEnabled = true;   // Habilitar/deshabilitar animaciones

// Inicialización cuando el DOM está listo
document.addEventListener('DOMContentLoaded', function() {
    initializeEditor();
    setupSocketConnection();
    setupEventListeners();
    initializeUIComponents();
    
    // Iniciar con una animación de fade-in
    animatePageLoad();
});

// Animación inicial de carga de página
function animatePageLoad() {
    document.querySelector('.container-fluid').style.opacity = '0';
    
    setTimeout(() => {
        document.querySelector('.container-fluid').style.opacity = '1';
        document.querySelector('.container-fluid').style.transition = 'opacity 0.5s ease-out';
    }, 100);
}

// Inicializar componentes de UI
function initializeUIComponents() {
    // Inicializar toast de guardado
    saveToast = new bootstrap.Toast(document.getElementById('saveToast'), {
        delay: 3000
    });
    
    // Inicializar tooltips
    const tooltips = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    tooltips.map(function (tooltip) {
        return new bootstrap.Tooltip(tooltip);
    });
    
    // Ocultar badge de notificaciones inicialmente
    document.getElementById('notificationBadge').style.display = 'none';
    
    // Aplicar estilos iniciales
    updateStatistics();
    updateWordCount();
}

// Inicializar el editor CKEditor
function initializeEditor() {
    ClassicEditor
        .create(document.querySelector('#editor'), {
            toolbar: [
                'heading', '|', 
                'bold', 'italic', 'link', 'bulletedList', 'numberedList', '|',
                'outdent', 'indent', '|', 
                'blockQuote', 'insertTable', 'undo', 'redo'
            ]
        })
        .then(newEditor => {
            editor = newEditor;
            
            // Añadir clases de animación al contenedor del editor
            const editorElement = document.querySelector('.ck-editor');
            if (editorElement) {
                editorElement.classList.add('animate__animated', 'animate__fadeIn');
            }
            
            // Escuchar cambios en el editor
            editor.model.document.on('change:data', () => {
                updateWordCount();
                updateStatistics();
                
                // Animar la barra de progreso del análisis
                if (realTimeAnalysis) {
                    // Cancelar análisis previo si existe
                    clearTimeout(analysisTimeout);
                    
                    // Mostrar que está analizando
                    const editorContainer = document.getElementById('editorContainer');
                    editorContainer.classList.add('editor-analyzing');
                    
                    // Programar nuevo análisis después de 1 segundo de inactividad
                    analysisTimeout = setTimeout(() => {
                        const editorData = editor.getData();
                        queueParagraphsForAnalysis(editorData);
                        processAnalysisQueue();
                    }, 1000);
                }
            });
            
            console.log('Editor initialized successfully');
            
            // Animar el contenedor del editor una vez cargado
            animateElement(document.querySelector('.ck-editor'), 'fadeInUp');
        })
        .catch(error => {
            console.error('Editor initialization failed:', error);
        });
}

// Configurar conexión WebSocket
function setupSocketConnection() {
    socket = io();
    
    // Escuchar resultados de análisis
    socket.on('analysis_results', (data) => {
        handleAnalysisResults(data);
    });
    
    // Escuchar conexión establecida
    socket.on('connect', () => {
        updateStatus('connected');
    });
    
    // Escuchar desconexión
    socket.on('disconnect', () => {
        updateStatus('disconnected');
    });
}

// Configurar event listeners para UI
function setupEventListeners() {
    // Botones de la barra de navegación
    document.getElementById('newDocBtn').addEventListener('click', createNewDocument);
    document.getElementById('openDocBtn').addEventListener('click', showOpenFileModal);
    document.getElementById('saveDocBtn').addEventListener('click', saveCurrentDocument);
    
    // Toggle switches para análisis
    document.getElementById('toggleSpelling').addEventListener('click', () => toggleAnalysisFeature('spelling'));
    document.getElementById('toggleGrammar').addEventListener('click', () => toggleAnalysisFeature('grammar'));
    document.getElementById('toggleStyle').addEventListener('click', () => toggleAnalysisFeature('style'));
    document.getElementById('toggleCoherence').addEventListener('click', () => toggleAnalysisFeature('coherence'));
    document.getElementById('togglePlagiarism').addEventListener('click', () => toggleAnalysisFeature('plagiarism'));
    
    // Botón de analizar todo
    document.getElementById('analyzeAll').addEventListener('click', analyzeAllContent);
    
    // Switch de análisis en tiempo real
    document.getElementById('realtimeSwitch').addEventListener('change', toggleRealTimeAnalysis);
    
    // Botón de subir archivo
    document.getElementById('uploadBtn').addEventListener('click', uploadFile);
    
    // Botón de aplicar sugerencia
    document.getElementById('applySuggestion').addEventListener('click', applySuggestion);
    
    // Botón para limpiar todas las sugerencias
    if (document.getElementById('clearAllSuggestions')) {
        document.getElementById('clearAllSuggestions').addEventListener('click', clearSuggestions);
    }
    
    // Escuchar cuando se cierra el modal de sugerencias
    const suggestionModal = document.getElementById('suggestionDetailModal');
    suggestionModal.addEventListener('hidden.bs.modal', () => {
        // Quitar animación al cerrar
        setTimeout(() => {
            suggestionModal.querySelector('.modal-content').classList.remove('animate__zoomIn');
        }, 200);
    });
    
    // Agregar evento antes de mostrar el modal de sugerencia
    suggestionModal.addEventListener('show.bs.modal', () => {
        // Añadir animación al abrir
        suggestionModal.querySelector('.modal-content').classList.add('animate__zoomIn');
    });
    
    // Lo mismo para el modal de abrir archivo
    const openFileModal = document.getElementById('openFileModal');
    openFileModal.addEventListener('hidden.bs.modal', () => {
        setTimeout(() => {
            openFileModal.querySelector('.modal-content').classList.remove('animate__fadeInUp');
        }, 200);
    });
    
    openFileModal.addEventListener('show.bs.modal', () => {
        openFileModal.querySelector('.modal-content').classList.add('animate__fadeInUp');
    });
    
    // Configurar filtrado de sugerencias
    const filterButtons = document.querySelectorAll('.suggestion-filters button[data-filter]');
    filterButtons.forEach(button => {
        button.addEventListener('click', () => {
            // Remover clase active de todos los botones
            filterButtons.forEach(btn => btn.classList.remove('active'));
            
            // Añadir clase active al botón clickeado
            button.classList.add('active');
            
            // Filtrar sugerencias
            const filter = button.dataset.filter;
            filterSuggestions(filter);
        });
    });
}

// Filtrar sugerencias por tipo
function filterSuggestions(filter) {
    const suggestionItems = document.querySelectorAll('#suggestionsList .suggestion-item');
    
    suggestionItems.forEach(item => {
        if (filter === 'all' || item.dataset.type === filter) {
            // Mostrar con animación
            item.style.display = '';
            animateElement(item, 'fadeIn');
        } else {
            // Ocultar
            item.style.display = 'none';
        }
    });
}

// Crear nuevo documento
function createNewDocument() {
    if (confirmUnsavedChanges()) {
        editor.setData('<p>Comienza a escribir aquí...</p>');
        currentDocId = null;
        document.getElementById('docTitle').textContent = 'Documento sin título';
        
        // Animación al crear nuevo documento
        animateElement(document.querySelector('.card'), 'pulse');
        
        updateWordCount();
        updateStatistics();
        clearSuggestions();
    }
}

// Mostrar modal para abrir archivo
function showOpenFileModal() {
    if (confirmUnsavedChanges()) {
        // Reiniciar formulario
        document.getElementById('uploadForm').reset();
        document.getElementById('uploadProgress').classList.add('d-none');
        
        const modal = new bootstrap.Modal(document.getElementById('openFileModal'));
        modal.show();
    }
}

// Subir y abrir archivo
function uploadFile() {
    const fileInput = document.getElementById('fileInput');
    if (!fileInput.files || fileInput.files.length === 0) {
        showAlert('Por favor selecciona un archivo', 'warning');
        return;
    }
    
    const file = fileInput.files[0];
    const formData = new FormData();
    formData.append('file', file);
    
    // Actualizar UI para mostrar carga
    document.getElementById('uploadProgress').classList.remove('d-none');
    document.getElementById('uploadBtn').disabled = true;
    updateStatus('loading', 'Cargando documento...');
    
    // Animación de barra de progreso
    animateProgressBar();
    
    fetch('/upload', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            // Cargar contenido en el editor
            editor.setData(data.content.html);
            
            // Actualizar información del documento
            currentDocId = data.doc_id;
            document.getElementById('docTitle').textContent = file.name;
            document.getElementById('docType').textContent = file.name.split('.').pop().toUpperCase();
            
            // Cerrar modal
            bootstrap.Modal.getInstance(document.getElementById('openFileModal')).hide();
            
            // Actualizar estadísticas
            updateWordCount();
            updateStatistics();
            clearSuggestions();
            
            // Analizar documento completo
            analyzeAllContent();
            
            updateStatus('ready');
            
            // Animación de éxito
            animateElement(document.querySelector('.card'), 'fadeIn');
            showAlert(`Documento "${file.name}" cargado correctamente`, 'success');
        } else {
            showAlert('Error al cargar el documento: ' + data.error, 'danger');
            updateStatus('error', 'Error al cargar el documento');
        }
        
        // Restablecer estado UI
        document.getElementById('uploadProgress').classList.add('d-none');
        document.getElementById('uploadBtn').disabled = false;
    })
    .catch(error => {
        console.error('Error al subir el archivo:', error);
        showAlert('Error al subir el archivo', 'danger');
        updateStatus('error', 'Error al cargar el documento');
        
        // Restablecer estado UI
        document.getElementById('uploadProgress').classList.add('d-none');
        document.getElementById('uploadBtn').disabled = false;
    });
}

// Animar barra de progreso durante carga
function animateProgressBar() {
    const progressBar = document.getElementById('analysisProgressBar');
    progressBar.style.width = '0%';
    progressBar.classList.add('analysis-active');
    
    let width = 0;
    const interval = setInterval(() => {
        if (width >= 90) {
            clearInterval(interval);
        } else {
            width += Math.random() * 10;
            width = Math.min(width, 90);
            progressBar.style.width = width + '%';
        }
    }, 300);
    
    // Listener para cuando se complete la carga
    window.addEventListener('load', () => {
        progressBar.style.width = '100%';
        setTimeout(() => {
            progressBar.style.width = '0%';
            progressBar.classList.remove('analysis-active');
        }, 500);
        clearInterval(interval);
    }, { once: true });
    
    // Si no se dispara el evento load (por ejemplo, si hay un error)
    setTimeout(() => {
        if (parseFloat(progressBar.style.width) < 100) {
            progressBar.style.width = '0%';
            progressBar.classList.remove('analysis-active');
            clearInterval(interval);
        }
    }, 10000);
}

// Mostrar alerta con Bootstrap
function showAlert(message, type = 'info') {
    // Crear o obtener contenedor de alertas
    let alertContainer = document.getElementById('alertContainer');
    if (!alertContainer) {
        alertContainer = document.createElement('div');
        alertContainer.id = 'alertContainer';
        alertContainer.className = 'alert-container position-fixed bottom-0 end-0 p-3';
        alertContainer.style.zIndex = '1050';
        document.body.appendChild(alertContainer);
    }
    
    // Crear alerta
    const alertId = 'alert-' + Date.now();
    const alertHTML = `
        <div id="${alertId}" class="alert alert-${type} alert-dismissible fade show animate__animated animate__fadeInUp" role="alert">
            <i class="fas ${getAlertIcon(type)} me-2"></i>
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
        </div>
    `;
    
    alertContainer.insertAdjacentHTML('beforeend', alertHTML);
    
    // Auto cerrar después de 4 segundos
    setTimeout(() => {
        const alertElement = document.getElementById(alertId);
        if (alertElement) {
            alertElement.classList.add('animate__fadeOutDown');
            setTimeout(() => {
                alertElement.remove();
            }, 500);
        }
    }, 4000);
}

// Obtener icono para alerta según tipo
function getAlertIcon(type) {
    switch (type) {
        case 'success': return 'fa-check-circle';
        case 'danger': return 'fa-exclamation-circle';
        case 'warning': return 'fa-exclamation-triangle';
        case 'info': return 'fa-info-circle';
        default: return 'fa-info-circle';
    }
}

// Guardar documento actual
function saveCurrentDocument() {
    if (!currentDocId) {
        showAlert('Crea un nuevo documento o abre uno existente primero', 'warning');
        return;
    }
    
    const content = editor.getData();
    
    updateStatus('loading', 'Guardando documento...');
    
    // Animar barra de progreso
    const progressBar = document.getElementById('analysisProgressBar');
    progressBar.style.width = '0%';
    progressBar.classList.add('analysis-active');
    
    fetch('/save', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            doc_id: currentDocId,
            content: content
        })
    })
    .then(response => response.json())
    .then(data => {
        // Completar barra de progreso
        progressBar.style.width = '100%';
        
        if (data.success) {
            updateStatus('saved', 'Documento guardado');
            
            // Animación de guardado
            animateElement(document.getElementById('saveDocBtn'), 'rubberBand');
            
            // Mostrar toast
            saveToast.show();
            
            // Volver al estado "ready" después de 2 segundos
            setTimeout(() => {
                updateStatus('ready');
                progressBar.style.width = '0%';
                progressBar.classList.remove('analysis-active');
            }, 2000);
        } else {
            showAlert('Error al guardar el documento: ' + data.error, 'danger');
            updateStatus('error', 'Error al guardar');
            progressBar.style.width = '0%';
            progressBar.classList.remove('analysis-active');
        }
    })
    .catch(error => {
        console.error('Error al guardar el documento:', error);
        showAlert('Error al guardar el documento', 'danger');
        updateStatus('error', 'Error al guardar');
        progressBar.style.width = '0%';
        progressBar.classList.remove('analysis-active');
    });
}

// Activar/desactivar característica de análisis
function toggleAnalysisFeature(feature) {
    analysisEnabled[feature] = !analysisEnabled[feature];
    
    // Actualizar UI
    const toggleElement = document.getElementById(`toggle${feature.charAt(0).toUpperCase() + feature.slice(1)}`);
    const iconElement = toggleElement.querySelector('.fa-toggle-on, .fa-toggle-off');
    
    if (analysisEnabled[feature]) {
        iconElement.className = 'fas fa-toggle-on text-primary float-end';
        animateElement(iconElement, 'flipInY');
    } else {
        iconElement.className = 'fas fa-toggle-off text-secondary float-end';
        animateElement(iconElement, 'flipInY');
    }
    
    // Si la característica está habilitada y hay contenido, analizar
    if (analysisEnabled[feature] && editor.getData()) {
        analyzeAllContent();
    } else if (!analysisEnabled[feature]) {
        // Eliminar sugerencias de este tipo
        removeSuggestionsByType(feature);
    }
}

// Activar/desactivar análisis en tiempo real
function toggleRealTimeAnalysis() {
    realTimeAnalysis = document.getElementById('realtimeSwitch').checked;
    
    // Animación del switch
    animateElement(document.getElementById('realtimeSwitch').parentElement, 'pulse');
    
    // Si se activa y hay contenido, analizar
    if (realTimeAnalysis && editor.getData()) {
        analyzeAllContent();
    }
}

// Analizar todo el contenido
function analyzeAllContent() {
    const editorData = editor.getData();
    if (!editorData) return;
    
    updateStatus('analyzing', 'Analizando documento...');
    
    // Animación de análisis
    const progressBar = document.getElementById('analysisProgressBar');
    progressBar.style.width = '0%';
    progressBar.classList.add('analysis-active');
    
    // Dividir el contenido en párrafos y enviar para análisis
    queueParagraphsForAnalysis(editorData, true);
    
    // Actualizar barra de progreso
    let progress = 0;
    const totalParagraphs = paragraphAnalysisQueue.size;
    const progressInterval = setInterval(() => {
        const remaining = paragraphAnalysisQueue.size;
        progress = totalParagraphs > 0 ? ((totalParagraphs - remaining) / totalParagraphs) * 100 : 100;
        progressBar.style.width = Math.min(progress, 98) + '%';
        
        if (progress >= 98) {
            clearInterval(progressInterval);
        }
    }, 200);
    
    // Añadir clase de análisis al editor
    document.getElementById('editorContainer').classList.add('editor-analyzing');
    
    processAnalysisQueue();
}

// Poner párrafos en cola para análisis
function queueParagraphsForAnalysis(htmlContent, forceAll = false) {
    // Extraer párrafos del HTML (simplificado)
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = htmlContent;
    
    const paragraphs = tempDiv.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li');
    
    paragraphs.forEach((paragraph, index) => {
        const text = paragraph.textContent.trim();
        
        // Ignorar párrafos vacíos o muy cortos a menos que se fuerce el análisis completo
        if (text.length < 5 && !forceAll) return;
        
        // Crear un ID único para este párrafo
        const paragraphId = `paragraph-${index}`;
        
        // Añadir a la cola de análisis
        paragraphAnalysisQueue.add({
            text: text,
            paragraph_id: paragraphId,
            doc_id: currentDocId || 'temp'
        });
    });
}

// Procesar cola de análisis
function processAnalysisQueue() {
    if (paragraphAnalysisQueue.size === 0) {
        updateStatus('ready');
        
        // Completar la barra de progreso
        const progressBar = document.getElementById('analysisProgressBar');
        progressBar.style.width = '100%';
        
        // Quitar clase de análisis del editor
        document.getElementById('editorContainer').classList.remove('editor-analyzing');
        
        // Ocultar la barra después de un tiempo
        setTimeout(() => {
            progressBar.style.width = '0%';
            progressBar.classList.remove('analysis-active');
        }, 500);
        
        return;
    }
    
    updateStatus('analyzing', `Analizando (${paragraphAnalysisQueue.size} pendientes)...`);
    
    // Tomar el primer elemento de la cola
    const paragraph = paragraphAnalysisQueue.values().next().value;
    paragraphAnalysisQueue.delete(paragraph);
    
    // Enviar para análisis
    socket.emit('analyze_text', paragraph);
}

// Manejar resultados de análisis
function handleAnalysisResults(data) {
    const results = data.results;
    
    // Procesar cada tipo de análisis si está habilitado
    if (analysisEnabled.spelling && results.ortografia) {
        processSpellingResults(results.ortografia, data.paragraph_id);
    }
    
    if (analysisEnabled.grammar && results.gramatica) {
        processGrammarResults(results.gramatica, data.paragraph_id);
    }
    
    if (analysisEnabled.style && results.estilo) {
        processStyleResults(results.estilo, data.paragraph_id);
    }
    
    if (analysisEnabled.coherence && results.coherencia) {
        processCoherenceResults(results.coherencia, data.paragraph_id);
    }
    
    if (analysisEnabled.plagiarism && results.plagio) {
        processPlagiarismResults(results.plagio, data.paragraph_id);
    }
    
    // Actualizar contador de sugerencias
    updateSuggestionCount();
    
    // Actualizar barra de originalidad basada en detección de plagio
    updateOriginalityBar(results.plagio);
    
    // Mostrar badge de notificaciones si hay sugerencias
    const suggestionCount = Object.keys(currentSuggestions).length;
    const notificationBadge = document.getElementById('notificationBadge');
    notificationBadge.textContent = suggestionCount;
    notificationBadge.style.display = suggestionCount > 0 ? 'flex' : 'none';
    
    // Procesar siguiente elemento en la cola
    processAnalysisQueue();
}

// Procesar resultados de ortografía
function processSpellingResults(results, paragraphId) {
    results.forEach(result => {
        const suggestionId = `spell-${paragraphId}-${result.position}`;
        
        currentSuggestions[suggestionId] = {
            type: 'spelling',
            original: result.word,
            suggestion: result.suggestion,
            severity: result.severity,
            explanation: `"${result.word}" tiene un error ortográfico. Se sugiere usar "${result.suggestion}".`
        };
        
        // Añadir a la lista de sugerencias con animación
        addSuggestionToList(suggestionId, 'Corrección ortográfica', result.word, result.suggestion, 'spelling', result.severity);
    });
}

// Procesar resultados de gramática
function processGrammarResults(results, paragraphId) {
    results.forEach((result, index) => {
        const suggestionId = `grammar-${paragraphId}-${index}`;
        
        currentSuggestions[suggestionId] = {
            type: 'grammar',
            original: result.original,
            suggestion: result.suggestion,
            severity: result.severity,
            explanation: result.explanation || 'Se ha detectado un error gramatical.'
        };
        
        // Añadir a la lista de sugerencias
        addSuggestionToList(suggestionId, 'Mejora gramatical', 
            truncateText(result.original, 30), 
            truncateText(result.suggestion, 30), 
            'grammar', result.severity);
    });
}

// Procesar resultados de estilo
function processStyleResults(results, paragraphId) {
    results.forEach((result, index) => {
        const suggestionId = `style-${paragraphId}-${index}`;
        
        // Manejar diferentes tipos de sugerencias de estilo
        if (result.type === 'style_long_sentence') {
            currentSuggestions[suggestionId] = {
                type: 'style',
                original: result.original,
                suggestion: result.suggestion,
                severity: result.severity,
                explanation: 'Oración demasiado larga. Considera dividirla para mejorar la legibilidad.'
            };
            
            addSuggestionToList(suggestionId, 'Oración muy larga', 
                truncateText(result.original, 30), 
                result.suggestion, 
                'style', result.severity);
        } 
        else if (result.type === 'style_repetition') {
            currentSuggestions[suggestionId] = {
                type: 'style',
                original: 'Palabras repetitivas: ' + result.repetitive_words.join(', '),
                suggestion: result.suggestion,
                severity: result.severity,
                explanation: 'Se han detectado palabras que se repiten con frecuencia en el texto.'
            };
            
            addSuggestionToList(suggestionId, 'Repetición de palabras', 
                'Palabras repetitivas', 
                result.suggestion, 
                'style', result.severity);
        }
    });
}

// Procesar resultados de coherencia
function processCoherenceResults(results, paragraphId) {
    results.forEach((result, index) => {
        const suggestionId = `coherence-${paragraphId}-${index}`;
        
        currentSuggestions[suggestionId] = {
            type: 'coherence',
            original: truncateText(result.text, 100),
            suggestion: result.suggestion,
            severity: result.severity,
            explanation: 'Se han detectado problemas de coherencia en el texto.'
        };
        
        addSuggestionToList(suggestionId, 'Mejora de coherencia', 
            'Problema de coherencia en el texto', 
            truncateText(result.suggestion, 40), 
            'coherence', result.severity);
    });
}

// Procesar resultados de plagio
function processPlagiarismResults(results, paragraphId) {
    results.forEach((result, index) => {
        if (result.matches && result.matches.length > 0) {
            const suggestionId = `plagiarism-${paragraphId}-${index}`;
            
            // Tomar el match con mayor similitud
            const bestMatch = result.matches.reduce((prev, current) => 
                (prev.similarity > current.similarity) ? prev : current
            );
            
            currentSuggestions[suggestionId] = {
                type: 'plagiarism',
                original: result.text,
                suggestion: `Este texto tiene una similitud del ${bestMatch.similarity}% con contenido de "${bestMatch.source}".`,
                severity: result.severity,
                explanation: `Se ha detectado posible plagio. El texto tiene similitud con: "${bestMatch.text}"`,
                matches: result.matches
            };
            
            addSuggestionToList(suggestionId, 'Posible plagio', 
                truncateText(result.text, 30), 
                `Similitud: ${bestMatch.similarity}%`, 
                'plagiarism', 'high');
        }
    });
}

// Añadir sugerencia a la lista
function addSuggestionToList(id, title, original, suggestion, type, severity) {
    const suggestionsList = document.getElementById('suggestionsList');
    
    // Eliminar mensaje de "no hay sugerencias" si existe
    const noSuggestions = suggestionsList.querySelector('.text-muted');
    if (noSuggestions) {
        suggestionsList.innerHTML = '';
    }
    
    // Crear elemento de sugerencia
    const suggestionElement = document.createElement('div');
    suggestionElement.className = 'list-group-item suggestion-item animate__animated animate__fadeInRight';
    suggestionElement.id = id;
    suggestionElement.dataset.type = type;
    suggestionElement.dataset.severity = severity;
    
    // Aplicar retardo a la animación basado en cuántas sugerencias ya existen
    const existingSuggestions = suggestionsList.querySelectorAll('.suggestion-item').length;
    suggestionElement.style.animationDelay = `${existingSuggestions * 0.05}s`;
    
    // Determinar icono según tipo
    let icon = '';
    let iconClass = '';
    switch (type) {
        case 'spelling':
            icon = '<i class="fas fa-spell-check text-danger"></i>';
            iconClass = 'bg-danger bg-opacity-10';
            break;
        case 'grammar':
            icon = '<i class="fas fa-language text-warning"></i>';
            iconClass = 'bg-warning bg-opacity-10';
            break;
        case 'style':
            icon = '<i class="fas fa-feather-alt text-primary"></i>';
            iconClass = 'bg-primary bg-opacity-10';
            break;
        case 'coherence':
            icon = '<i class="fas fa-link text-info"></i>';
            iconClass = 'bg-info bg-opacity-10';
            break;
        case 'plagiarism':
            icon = '<i class="fas fa-copy text-danger"></i>';
            iconClass = 'bg-danger bg-opacity-10';
            break;
    }

    // Aplicar clase según severidad
    let severityClass = '';
    let severityBadge = '';
    switch (severity) {
        case 'high':
            severityClass = 'border-severity-high';
            severityBadge = '<span class="badge rounded-pill bg-danger ms-2">Alta</span>';
            break;
        case 'medium':
            severityClass = 'border-severity-medium';
            severityBadge = '<span class="badge rounded-pill bg-warning text-dark ms-2">Media</span>';
            break;
        case 'low':
            severityClass = 'border-severity-low';
            severityBadge = '<span class="badge rounded-pill bg-info text-dark ms-2">Baja</span>';
            break;
    }
    
    suggestionElement.classList.add(severityClass);
    
    // Construir HTML
    suggestionElement.innerHTML = `
        <div class="d-flex align-items-center">
            <div class="suggestion-icon rounded-circle p-2 me-3 ${iconClass}">${icon}</div>
            <div class="flex-grow-1">
                <h6 class="mb-0 d-flex align-items-center">
                    ${title}
                    ${severityBadge}
                </h6>
                <small class="text-muted d-block mt-1">${suggestion}</small>
            </div>
            <div class="ms-2">
                <i class="fas fa-chevron-right text-muted"></i>
            </div>
        </div>
    `;
    
    // Agregar evento para ver detalles
    suggestionElement.addEventListener('click', () => {
        // Efecto de pulsación al hacer clic
        suggestionElement.classList.add('animate__pulse');
        setTimeout(() => {
            suggestionElement.classList.remove('animate__pulse');
            showSuggestionDetail(id);
        }, 300);
    });
    
    // Añadir a la lista
    suggestionsList.appendChild(suggestionElement);
}

// Mostrar detalle de sugerencia
function showSuggestionDetail(suggestionId) {
    const suggestion = currentSuggestions[suggestionId];
    if (!suggestion) return;
    
    // Añadir clases de animación según el tipo de sugerencia
    const suggestionType = suggestion.type;
    const titleElement = document.getElementById('suggestionTitle');
    const titleIconClass = getSuggestionIconClass(suggestionType);
    
    // Llenar modal
    titleElement.innerHTML = `<i class="${titleIconClass} me-2"></i>${getSuggestionTitle(suggestion.type)}`;
    
    // Animar los contenedores de texto
    const originalTextEl = document.getElementById('originalText');
    const suggestionTextEl = document.getElementById('suggestionText');
    const explanationTextEl = document.getElementById('explanationText');
    
    // Establecer contenido con efecto de escritura
    typeText(originalTextEl, suggestion.original, 10);
    setTimeout(() => {
        typeText(suggestionTextEl, suggestion.suggestion, 10);
    }, 300);
    setTimeout(() => {
        typeText(explanationTextEl, suggestion.explanation, 5);
    }, 600);
    
    // Guardar ID de sugerencia actual
    document.getElementById('applySuggestion').dataset.suggestionId = suggestionId;
    
    // Mostrar modal
    const modal = new bootstrap.Modal(document.getElementById('suggestionDetailModal'));
    modal.show();
}

// Función para efecto de escritura
function typeText(element, text, speed = 10) {
    // Si el texto es muy largo, simplemente lo mostramos sin animación
    if (text.length > 200) {
        element.textContent = text;
        return;
    }
    
    element.textContent = '';
    let i = 0;
    
    function type() {
        if (i < text.length) {
            element.textContent += text.charAt(i);
            i++;
            setTimeout(type, speed);
        }
    }
    
    type();
}

// Obtener clase de icono según tipo de sugerencia
function getSuggestionIconClass(type) {
    switch (type) {
        case 'spelling': return 'fas fa-spell-check text-danger';
        case 'grammar': return 'fas fa-language text-warning';
        case 'style': return 'fas fa-feather-alt text-primary';
        case 'coherence': return 'fas fa-link text-info';
        case 'plagiarism': return 'fas fa-copy text-danger';
        default: return 'fas fa-lightbulb text-primary';
    }
}

// Obtener título según tipo de sugerencia
function getSuggestionTitle(type) {
    switch (type) {
        case 'spelling': return 'Corrección ortográfica';
        case 'grammar': return 'Mejora gramatical';
        case 'style': return 'Mejora de estilo';
        case 'coherence': return 'Mejora de coherencia';
        case 'plagiarism': return 'Alerta de plagio';
        default: return 'Sugerencia';
    }
}

// Aplicar sugerencia con animación
function applySuggestion() {
    const suggestionId = document.getElementById('applySuggestion').dataset.suggestionId;
    const suggestion = currentSuggestions[suggestionId];
    
    if (!suggestion) return;
    
    // Animar botón de aplicar
    animateElement(document.getElementById('applySuggestion'), 'pulse');
    
    // Este es un ejemplo simplificado. En una implementación real,
    // necesitaríamos encontrar la ubicación exacta del texto en el editor
    // y reemplazarlo, lo cual es más complejo.
    
    // Cerrar modal con animación
    const modal = document.getElementById('suggestionDetailModal');
    modal.querySelector('.modal-content').classList.remove('animate__zoomIn');
    modal.querySelector('.modal-content').classList.add('animate__zoomOut');
    
    setTimeout(() => {
        bootstrap.Modal.getInstance(modal).hide();
        modal.querySelector('.modal-content').classList.remove('animate__zoomOut');
        
        // Mostrar notificación elegante
        showAlert(`Sugerencia aplicada: ${getSuggestionTitle(suggestion.type)}`, 'success');
        
        // Eliminar sugerencia de la lista con animación
        const suggestionElement = document.getElementById(suggestionId);
        if (suggestionElement) {
            suggestionElement.classList.remove('animate__fadeInRight');
            suggestionElement.classList.add('animate__fadeOutRight');
            
            setTimeout(() => {
                suggestionElement.remove();
                
                // Si no hay más sugerencias, mostrar mensaje
                if (Object.keys(currentSuggestions).length <= 1) {
                    showNoSuggestionsMessage();
                }
            }, 500);
        }
        
        // Eliminar de sugerencias actuales
        delete currentSuggestions[suggestionId];
        
        // Actualizar contador
        updateSuggestionCount();
    }, 300);
}

// Eliminar sugerencias por tipo
function removeSuggestionsByType(type) {
    // Eliminar de la lista visual con animación
    const suggestionItems = document.querySelectorAll(`.suggestion-item[data-type="${type}"]`);
    
    // Si no hay elementos, no hacer nada
    if (suggestionItems.length === 0) return;
    
    // Añadir animación a cada elemento
    suggestionItems.forEach((item, index) => {
        // Aplicar retardo según el índice
        setTimeout(() => {
            item.classList.add('animate__animated', 'animate__fadeOutRight');
            
            // Eliminar después de completar la animación
            setTimeout(() => {
                item.remove();
                
                // Comprobar si quedan sugerencias
                if (document.querySelectorAll('.suggestion-item').length === 0) {
                    showNoSuggestionsMessage();
                }
            }, 500);
        }, index * 100); // Retardo escalonado
    });
    
    // Eliminar de las sugerencias actuales
    for (const id in currentSuggestions) {
        if (currentSuggestions[id].type === type) {
            delete currentSuggestions[id];
        }
    }
    
    // Actualizar contador
    updateSuggestionCount();
}

// Mostrar mensaje de "no hay sugerencias" con animación
function showNoSuggestionsMessage() {
    const suggestionsList = document.getElementById('suggestionsList');
    
    // Si ya existe el mensaje, no hacer nada
    if (suggestionsList.querySelector('.text-muted')) return;
    
    // Crear elemento de mensaje
    const messageElement = document.createElement('div');
    messageElement.className = 'list-group-item text-center text-muted animate__animated animate__fadeIn';
    messageElement.innerHTML = `
        <p class="mb-0">No hay sugerencias disponibles</p>
        <small>Comienza a escribir para recibir análisis</small>
    `;
    
    // Añadir al contenedor
    suggestionsList.appendChild(messageElement);
}

// Limpiar todas las sugerencias
function clearSuggestions() {
    // Comprobar si hay sugerencias para limpiar
    if (Object.keys(currentSuggestions).length === 0) return;
    
    // Animar la barra antes de limpiar
    animateElement(document.querySelector('.card-header'), 'headShake');
    
    // Aplicar efecto de fade-out a todas las sugerencias
    const suggestionItems = document.querySelectorAll('.suggestion-item');
    suggestionItems.forEach((item, index) => {
        // Aplicar retardo según el índice para efecto de cascada
        setTimeout(() => {
            item.classList.add('animate__animated', 'animate__fadeOut');
        }, index * 50);
    });
    
    // Esperar a que terminen las animaciones antes de limpiar
    setTimeout(() => {
        // Limpiar colección de sugerencias
        currentSuggestions = {};
        
        // Limpiar vista
        const suggestionsList = document.getElementById('suggestionsList');
        suggestionsList.innerHTML = '';
        
        // Mostrar mensaje de "no hay sugerencias"
        showNoSuggestionsMessage();
        
        // Actualizar contador
        updateSuggestionCount();
    }, Math.max(300, suggestionItems.length * 50));
}

// Actualizar contador de sugerencias
function updateSuggestionCount() {
    const count = Object.keys(currentSuggestions).length;
    const countElement = document.getElementById('suggestionCount');
    
    // Animar el contador si cambia
    if (countElement.textContent !== count.toString()) {
        countElement.classList.add('animate__animated', 'animate__bounceIn');
        setTimeout(() => {
            countElement.classList.remove('animate__animated', 'animate__bounceIn');
        }, 1000);
    }
    
    countElement.textContent = count;
    
    // Actualizar badge de notificaciones
    const notificationBadge = document.getElementById('notificationBadge');
    notificationBadge.textContent = count;
    
    if (count > 0) {
        notificationBadge.style.display = 'flex';
        if (notificationBadge.classList.contains('d-none')) {
            notificationBadge.classList.remove('d-none');
            animateElement(notificationBadge, 'bounceIn');
        }
    } else {
        // Ocultar con animación
        if (notificationBadge.style.display !== 'none') {
            animateElement(notificationBadge, 'fadeOut');
            setTimeout(() => {
                notificationBadge.style.display = 'none';
            }, 500);
        }
    }
}

// Actualizar barra de originalidad con animación
function updateOriginalityBar(plagiarismResults) {
    const originalityBar = document.getElementById('originalityBar');
    const originalityPercentage = document.getElementById('originalityPercentage');
    let originalityPercent;
    
    if (!plagiarismResults || plagiarismResults.length === 0) {
        // Si no hay resultados o está vacío, asumimos 100% original
        originalityPercent = 100;
    } else {
        // Calcular índice de originalidad basado en la cantidad de matches
        const totalParagraphs = paragraphAnalysisQueue.size + plagiarismResults.length;
        const suspiciousParagraphs = plagiarismResults.length;
        
        if (totalParagraphs === 0) return;
        
        originalityPercent = Math.max(0, Math.round((totalParagraphs - suspiciousParagraphs) / totalParagraphs * 100));
    }
    
    // Guardar ancho actual para animación
    const currentWidth = originalityBar.style.width;
    const targetWidth = `${originalityPercent}%`;
    
    // Establecer texto
    originalityBar.textContent = `${originalityPercent}% Original`;
    originalityPercentage.textContent = `${originalityPercent}%`;
    
    // Animar cambio de porcentaje
    if (currentWidth !== targetWidth) {
        // Aplicar animación al cambiar
        animateElement(originalityBar.parentElement, 'pulse');
        
        // Animar el contador de porcentaje
        animateElement(originalityPercentage, 'fadeIn');
        
        // Establecer clase de color según porcentaje
        if (originalityPercent > 80) {
            originalityBar.className = 'progress-bar bg-success';
            originalityPercentage.className = 'text-success';
        } else if (originalityPercent > 60) {
            originalityBar.className = 'progress-bar bg-warning';
            originalityPercentage.className = 'text-warning';
        } else {
            originalityBar.className = 'progress-bar bg-danger';
            originalityPercentage.className = 'text-danger';
        }
    }
    
    // Actualizar ancho con efecto de transición suave 
    // (la transición CSS ya está definida en el CSS)
    originalityBar.style.width = targetWidth;
}

// Actualizar contador de palabras
function updateWordCount() {
    const text = editor.getData();
    const textOnly = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const words = textOnly ? textOnly.split(' ').length : 0;
    
    const wordCountElement = document.getElementById('wordCount');
    
    // Aplicar animación solo si el número cambia
    const oldWords = parseInt(wordCountElement.textContent) || 0;
    if (words !== oldWords) {
        animateElement(wordCountElement, 'flash');
    }
    
    wordCountElement.textContent = `${words} palabras`;
    
    // Actualizar también el contador en estadísticas
    const statWordsElement = document.getElementById('statWords');
    animateCounter(statWordsElement, words);
}

// Actualizar estadísticas
function updateStatistics() {
    const text = editor.getData();
    
    // Contar caracteres (excluyendo HTML)
    const textOnly = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const chars = textOnly.length;
    animateCounter(document.getElementById('statChars'), chars);
    
    // Contar párrafos
    const paragraphs = (text.match(/<p>/g) || []).length;
    animateCounter(document.getElementById('statParagraphs'), paragraphs);
    
    // Tiempo estimado de lectura (200 palabras por minuto en promedio)
    const words = textOnly ? textOnly.split(' ').length : 0;
    const readTimeMinutes = Math.max(1, Math.round(words / 200));
    
    // Actualizar el tiempo de lectura con un ligero retardo para efecto visual
    setTimeout(() => {
        document.getElementById('statReadTime').textContent = readTimeMinutes;
    }, 300);
}

// Actualizar indicador de estado
function updateStatus(status, message = '') {
    const statusIndicator = document.getElementById('statusIndicator');
    
    // Animar cambio de estado
    animateElement(statusIndicator, 'pulse');
    
    switch (status) {
        case 'connected':
            statusIndicator.innerHTML = '<i class="fas fa-circle text-success me-1"></i> Conectado';
            break;
        case 'disconnected':
            statusIndicator.innerHTML = '<i class="fas fa-circle text-danger me-1"></i> Desconectado';
            break;
        case 'loading':
            statusIndicator.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i> ' + (message || 'Cargando...');
            break;
        case 'analyzing':
            statusIndicator.innerHTML = '<i class="fas fa-brain text-primary me-1 fa-pulse"></i> ' + (message || 'Analizando...');
            break;
        case 'ready':
            statusIndicator.innerHTML = '<i class="fas fa-circle text-success me-1"></i> Listo';
            break;
        case 'saved':
            statusIndicator.innerHTML = '<i class="fas fa-check text-success me-1"></i> ' + (message || 'Guardado');
            statusIndicator.classList.add('saved-indicator');
            setTimeout(() => {
                statusIndicator.classList.remove('saved-indicator');
            }, 1000);
            break;
        case 'error':
            statusIndicator.innerHTML = '<i class="fas fa-exclamation-circle text-danger me-1"></i> ' + (message || 'Error');
            animateElement(statusIndicator, 'shakeX');
            break;
    }
}

// Truncar texto para visualización
function truncateText(text, maxLength) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
}

// Funciones de animación y efectos visuales

// Animar un elemento con efecto de Animate.css
function animateElement(element, animationName) {
    if (!element || !animationsEnabled) return;
    
    // Evitar aplicar demasiadas animaciones a la vez
    if (element.classList.contains('animate__animated')) {
        element.classList.remove('animate__animated');
        element.classList.remove('animate__' + element.dataset.currentAnimation);
    }
    
    // Añadir clase de animación
    element.classList.add('animate__animated', 'animate__' + animationName);
    element.dataset.currentAnimation = animationName;
    
    // Quitar la clase después de que termine la animación
    element.addEventListener('animationend', () => {
        element.classList.remove('animate__animated', 'animate__' + animationName);
    }, { once: true });
}

// Animar contador numérico con efecto de conteo
function animateCounter(element, targetValue, duration = 1000) {
    if (!element || !animationsEnabled) {
        element.textContent = targetValue;
        return;
    }
    
    const startValue = parseInt(element.textContent) || 0;
    
    // Si no hay cambio significativo, solo actualizar el valor
    if (Math.abs(targetValue - startValue) < 5) {
        element.textContent = targetValue;
        return;
    }
    
    const startTime = performance.now();
    
    function updateCounter(currentTime) {
        const elapsedTime = currentTime - startTime;
        const progress = Math.min(elapsedTime / duration, 1);
        
        // Función de easing para movimiento más natural
        const easedProgress = 1 - Math.pow(1 - progress, 3); // Ease out cubic
        
        const currentValue = Math.floor(startValue + (targetValue - startValue) * easedProgress);
        element.textContent = currentValue;
        
        if (progress < 1) {
            requestAnimationFrame(updateCounter);
        } else {
            element.textContent = targetValue;
        }
    }
    
    requestAnimationFrame(updateCounter);
}

// Verificar si hay cambios sin guardar antes de realizar ciertas acciones
function confirmUnsavedChanges() {
    // En una implementación real, deberíamos verificar si hay cambios sin guardar
    // y preguntar al usuario si desea continuar
    return true; // Simplificado para este ejemplo
}

// Habilitar/deshabilitar animaciones (para mejorar rendimiento en dispositivos de baja gama)
function toggleAnimations(enabled) {
    animationsEnabled = enabled;
    
    // Actualizar estado en localStorage
    localStorage.setItem('editor_animations_enabled', enabled ? 'true' : 'false');
    
    // Mostrar notificación
    showAlert(`Animaciones ${enabled ? 'habilitadas' : 'deshabilitadas'}`, 'info');
}

// Cambiar tema claro/oscuro
function toggleTheme() {
    const body = document.body;
    const themeIcon = document.querySelector('#themeToggleBtn i');
    
    if (body.classList.contains('dark-theme')) {
        body.classList.remove('dark-theme');
        themeIcon.className = 'fas fa-moon text-white';
        localStorage.setItem('editor_theme', 'light');
    } else {
        body.classList.add('dark-theme');
        themeIcon.className = 'fas fa-sun text-warning';
        localStorage.setItem('editor_theme', 'dark');
    }
    
    // Animar transición
    animateElement(document.getElementById('themeToggleBtn'), 'rubberBand');
}

// Cargar preferencias guardadas del usuario
function loadUserPreferences() {
    // Cargar tema
    const savedTheme = localStorage.getItem('editor_theme');
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-theme');
        document.querySelector('#themeToggleBtn i').className = 'fas fa-sun text-warning';
    }
    
    // Cargar estado de animaciones
    const animationsState = localStorage.getItem('editor_animations_enabled');
    if (animationsState === 'false') {
        animationsEnabled = false;
    }
}

// Inicializar preferencias al cargar la página
document.addEventListener('DOMContentLoaded', loadUserPreferences);

// Exportar funciones públicas para uso en eventos HTML
window.clearSuggestions = clearSuggestions;
window.filterSuggestions = filterSuggestions;
window.toggleTheme = toggleTheme;
window.toggleAnimations = toggleAnimations;