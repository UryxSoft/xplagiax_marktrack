#@app.route("/")
#def index():
#    return send_file('src/index.html')
"""
Editor de Texto Inteligente con Flask, BLOOMZ-1.7B-4bit y procesamiento avanzado de texto.
El editor permite trabajar con archivos DOCX/DOC y ofrece análisis en tiempo real de:
- Ortografía y gramática
- Estilo y coherencia
- Detección de plagio
- Sugerencias de mejora

Incluye interfaz similar a Word con múltiples funcionalidades.
"""

# app.py - Archivo principal de la aplicación Flask

from flask import Flask, render_template, request, jsonify, session
from flask_socketio import SocketIO, emit
import os
import uuid
import json
import hashlib
from werkzeug.utils import secure_filename
from datetime import datetime
import threading
import queue

# Importaciones para procesamiento de documentos
import docx
from docx2python import docx2python
import mammoth

# Importaciones para IA y NLP
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
import nltk
from nltk.tokenize import sent_tokenize, word_tokenize
from nltk.corpus import stopwords
import blingfire as bf  # Para tokenización rápida

# Inicializar NLTK (descargar recursos necesarios)
nltk.download('punkt')
nltk.download('stopwords')

# Configuración de la aplicación
app = Flask(__name__)
app.config['SECRET_KEY'] = os.urandom(24)
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16 MB max
#socketio = SocketIO(app, cors_allowed_origins="*")

socketio = SocketIO(app, 
    cors_allowed_origins="*",
    async_mode='eventlet',  # o 'gevent' o 'threading'
    logger=True,
    engineio_logger=True
)


# Asegurar que existe la carpeta de subidas
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

# Cola de tareas para análisis asíncrono
analysis_queue = queue.Queue()

# Base de datos simple para fingerprints (en producción usaría una DB real)
text_fingerprints = {}

# Cargar modelo BLOOMZ-1.7B-4bit (solo se carga una vez al iniciar la app)
#@app.before_first_request
def load_models():
    global tokenizer, model
    #ll
    
    print("Cargando modelo BLOOMZ-1.7B...")
    
    model_name = "bigscience/bloomz-1b7"
    
    tokenizer = AutoTokenizer.from_pretrained(model_name)
    
    # Detectar si estamos usando CPU o GPU
    import torch
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    print(f"Usando dispositivo: {device}")
    
    if device == 'cuda':
        try:
            # Intentar cargar en 4-bit si tenemos GPU
            model = AutoModelForCausalLM.from_pretrained(
                model_name, 
                device_map="auto",
                load_in_4bit=True,
                low_cpu_mem_usage=True
            )
            print("Modelo cargado en 4-bit")
        except ImportError:
            # Fallback a 8-bit
            try:
                model = AutoModelForCausalLM.from_pretrained(
                    model_name, 
                    device_map="auto",
                    load_in_8bit=True,
                    low_cpu_mem_usage=True
                )
                print("Modelo cargado en 8-bit")
            except ImportError:
                # Cargar en precisión completa
                model = AutoModelForCausalLM.from_pretrained(
                    model_name,
                    device_map="auto",
                    low_cpu_mem_usage=True
                )
                print("Modelo cargado en precisión completa")
    else:
        # Si estamos en CPU, cargar en precisión completa
        model = AutoModelForCausalLM.from_pretrained(
            model_name,
            low_cpu_mem_usage=True
        )
        print("Modelo cargado en CPU (precisión completa)")
    
    print("Modelo cargado correctamente")
    
    # Iniciar el worker para procesamiento asíncrono
    threading.Thread(target=process_analysis_queue, daemon=True).start()

# Mejor carga condicional del modelo
def load_model():
    global tokenizer, model
    
    model_name = "bigscience/bloomz-1b7"
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    logger.info(f"Usando dispositivo: {device}")
    
    # Almacenar modelos en caché
    cache_dir = os.path.join(os.path.dirname(__file__), "model_cache")
    os.makedirs(cache_dir, exist_ok=True)
    
    # Implementar carga estratégica basada en recursos disponibles
    try:
        precision = "4bit" if device == 'cuda' else "full"
        memory_tracking = psutil.virtual_memory()
        available_ram = memory_tracking.available / (1024 ** 3)  # GB
        
        if device == 'cuda':
            if torch.cuda.get_device_properties(0).total_memory > 8 * (1024 ** 3):  # > 8GB VRAM
                tokenizer = AutoTokenizer.from_pretrained(model_name, cache_dir=cache_dir)
                model = AutoModelForCausalLM.from_pretrained(
                    model_name, 
                    device_map="auto",
                    load_in_4bit=True,
                    low_cpu_mem_usage=True,
                    cache_dir=cache_dir
                )
                logger.info(f"Modelo cargado en 4-bit con GPU")
            else:
                # Para GPU con poca memoria
                tokenizer = AutoTokenizer.from_pretrained(model_name, cache_dir=cache_dir)
                model = AutoModelForCausalLM.from_pretrained(
                    model_name, 
                    device_map="auto",
                    load_in_8bit=True,
                    low_cpu_mem_usage=True,
                    cache_dir=cache_dir
                )
                logger.info(f"Modelo cargado en 8-bit con GPU limitada")
        else:
            # Para CPU, usar modelo más pequeño si hay poca RAM
            if available_ram < 8:  # Menos de 8GB disponible
                # Usar un modelo más pequeño compatible
                model_name = "bigscience/bloomz-560m"  
            
            tokenizer = AutoTokenizer.from_pretrained(model_name, cache_dir=cache_dir)
            model = AutoModelForCausalLM.from_pretrained(
                model_name,
                low_cpu_mem_usage=True,
                cache_dir=cache_dir
            )
            logger.info(f"Modelo {model_name} cargado en CPU")
    except Exception as e:
        logger.error(f"Error al cargar modelo: {e}")
        # Cargar modelo de respaldo más pequeño
        model_name = "bigscience/bloomz-560m" 
        tokenizer = AutoTokenizer.from_pretrained(model_name, cache_dir=cache_dir)
        model = AutoModelForCausalLM.from_pretrained(model_name, cache_dir=cache_dir)
        logger.error(f"Cargado modelo de respaldo {model_name}")

load_model()

# Función para el worker de análisis
def process_analysis_queue():
    while True:
        try:
            task = analysis_queue.get()
            if task:
                text = task['text']
                paragraph_id = task['paragraph_id']
                doc_id = task['doc_id']
                
                # Realizar análisis completo
                analysis_results = analyze_text(text)
                
                # Enviar resultados mediante WebSocket
                socketio.emit('analysis_results', {
                    'paragraph_id': paragraph_id,
                    'doc_id': doc_id,
                    'results': analysis_results
                })
                
            analysis_queue.task_done()
        except Exception as e:
            print(f"Error en worker de análisis: {e}")

# Rutas de la aplicación
@app.route('/')
def index():
    return render_template('index.html')

def secure_filename_validation(filename):
    """Validación mejorada de nombres de archivo"""
    # Eliminar caracteres peligrosos y paths
    base_filename = os.path.basename(filename)
    # Eliminar caracteres no alfanuméricos excepto algunos seguros
    cleaned_filename = re.sub(r'[^\w\.-]', '_', base_filename)
    return cleaned_filename

@app.route('/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    
    file = request.files['file']
    
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
    
    # Validar tamaño
    if len(file.read()) > app.config['MAX_CONTENT_LENGTH']:
        return jsonify({'error': 'File too large'}), 413
    file.seek(0)  # Reset cursor after reading
    
    # Validar tipo MIME
    file_content = file.read(512)  # Leer primeros bytes para detectar tipo
    file.seek(0)  # Reset cursor
    
    mime_type = magic.from_buffer(file_content, mime=True)
    if mime_type not in ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 
                          'application/msword']:
        return jsonify({'error': 'Invalid file type'}), 415
    
    # Procesar archivo seguro
    if file:
        # Generar un ID único para el documento
        doc_id = str(uuid.uuid4())
        secure_name = secure_filename_validation(file.filename)
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], f"{doc_id}_{secure_name}")
        file.save(file_path)
        
        # Procesar el archivo según su tipo
        file_content = {}
        if filename.endswith('.docx'):
            file_content = process_docx(file_path)
        elif filename.endswith('.doc'):
            file_content = process_doc(file_path)
        else:
            return jsonify({'error': 'Formato de archivo no soportado'}), 400
        
        # Guardar información del documento en sesión
        if 'documents' not in session:
            session['documents'] = {}
        
        session['documents'][doc_id] = {
            'filename': filename,
            'path': file_path,
            'created_at': datetime.now().isoformat()
        }
        
        return jsonify({
            'success': True,
            'doc_id': doc_id,
            'content': file_content
        })

@app.route('/save', methods=['POST'])
def save_document():
    data = request.json
    doc_id = data.get('doc_id')
    content = data.get('content')
    
    if not doc_id or not content:
        return jsonify({'error': 'Missing document ID or content'}), 400
    
    if 'documents' not in session or doc_id not in session['documents']:
        return jsonify({'error': 'Document not found'}), 404
    
    file_path = session['documents'][doc_id]['path']
    
    # Guardar el contenido según el tipo de archivo
    if file_path.endswith('.docx'):
        save_as_docx(content, file_path)
    elif file_path.endswith('.doc'):
        save_as_doc(content, file_path)
    
    return jsonify({'success': True})

# WebSockets para análisis en tiempo real
@socketio.on('analyze_text')
def handle_analysis(data):
    text = data.get('text', '')
    paragraph_id = data.get('paragraph_id')
    doc_id = data.get('doc_id')
    
    if not text:
        return
    
    # Añadir a la cola para procesamiento asíncrono
    analysis_queue.put({
        'text': text,
        'paragraph_id': paragraph_id,
        'doc_id': doc_id
    })

# Funciones de procesamiento de documentos
def process_docx(file_path):
    """Convierte un archivo DOCX a formato HTML para edición"""
    try:
        with open(file_path, "rb") as docx_file:
            result = mammoth.convert_to_html(docx_file)
            html = result.value
            return {'html': html}
    except Exception as e:
        print(f"Error al procesar DOCX: {e}")
        return {'html': '<p>Error al procesar el documento</p>'}

def process_doc(file_path):
    """Procesa archivos DOC (formato antiguo)"""
    # En un entorno real, podrías usar una librería como antiword o convertir a DOCX primero
    # Esta es una implementación simplificada
    try:
        # Simulación de conversión de DOC (en producción usaría una librería específica)
        return {'html': '<p>Contenido del documento DOC (implementación básica)</p>'}
    except Exception as e:
        print(f"Error al procesar DOC: {e}")
        return {'html': '<p>Error al procesar el documento</p>'}

def save_as_docx(html_content, file_path):
    """Guarda el contenido HTML como un archivo DOCX"""
    try:
        # Aquí implementaríamos la conversión de HTML a DOCX
        # En producción usaríamos python-docx con un parser HTML
        doc = docx.Document()
        # Implementación simplificada - añadir contenido como texto plano
        doc.add_paragraph("Contenido del documento")
        doc.save(file_path)
        return True
    except Exception as e:
        print(f"Error al guardar DOCX: {e}")
        return False

def save_as_doc(html_content, file_path):
    """Guarda el contenido como DOC (formato antiguo)"""
    # Implementación simplificada - en producción usaríamos una librería específica
    try:
        with open(file_path, 'w') as f:
            f.write("Contenido del documento DOC")
        return True
    except Exception as e:
        print(f"Error al guardar DOC: {e}")
        return False

# Funciones de análisis de texto con BLOOMZ
def analyze_text(text):
    """Analiza el texto y devuelve sugerencias en diferentes categorías"""
    if not text or len(text.strip()) < 5:
        return {}
    
    results = {
        'ortografia': check_spelling(text),
        'gramatica': check_grammar(text),
        'estilo': check_style(text),
        'coherencia': check_coherence(text),
        'plagio': check_plagiarism(text)
    }
    
    return results

def check_spelling(text):
    """Verifica la ortografía del texto"""
    # Implementación simplificada - en producción usaríamos un verificador específico
    # o APIs especializadas junto con BLOOMZ
    words = word_tokenize(text.lower())
    
    # Ejemplo de detección básica de errores (simulada)
    errors = []
    common_misspellings = {
        'hola': 'ola',
        'hacer': 'aser',
        'había': 'habia',
        'también': 'tambien'
    }
    
    for i, word in enumerate(words):
        for correct, misspelled in common_misspellings.items():
            if word == misspelled:
                errors.append({
                    'position': i,
                    'word': word,
                    'suggestion': correct,
                    'type': 'spelling',
                    'severity': 'high'
                })
    
    return errors

def check_grammar(text):
    """Verifica la gramática usando BLOOMZ"""
    results = []
    
    # Dividir en oraciones para un análisis más preciso
    sentences = sent_tokenize(text)
    
    for i, sentence in enumerate(sentences):
        # Solo procesar oraciones con suficiente contenido
        if len(sentence.split()) < 3:
            continue
            
        # Consulta al modelo BLOOMZ (implementación simplificada)
        prompt = f"Verifica si esta oración tiene errores gramaticales: '{sentence}'. Si hay errores, corrígelos."
        
        inputs = tokenizer(prompt, return_tensors="pt")
        with torch.no_grad():
            outputs = model.generate(
                inputs.input_ids.to(model.device),
                max_length=100,
                num_return_sequences=1,
                temperature=0.1  # Baja temperatura para respuestas más deterministas
            )
        
        response = tokenizer.decode(outputs[0], skip_special_tokens=True)
        
        # Procesar la respuesta (simplificado - en producción usaríamos un parser más robusto)
        if "error" in response.lower() or "incorrecto" in response.lower():
            # Extraer la sugerencia (simplificado)
            suggestion = response.split("corrección:")[-1].strip() if "corrección:" in response else sentence
            
            results.append({
                'sentence_index': i,
                'original': sentence,
                'suggestion': suggestion,
                'type': 'grammar',
                'explanation': response,
                'severity': 'medium'
            })
    
    return results

def check_style(text):
    """Analiza el estilo de escritura"""
    results = []
    
    # Análisis básico de estilo
    sentences = sent_tokenize(text)
    
    # Detectar oraciones muy largas
    for i, sentence in enumerate(sentences):
        words = word_tokenize(sentence)
        if len(words) > 30:  # Oraciones muy largas
            results.append({
                'sentence_index': i,
                'original': sentence,
                'suggestion': 'Considera dividir esta oración para mejorar la legibilidad',
                'type': 'style_long_sentence',
                'severity': 'low'
            })
    
    # Detectar repeticiones excesivas (implementación simplificada)
    word_count = {}
    for word in word_tokenize(text.lower()):
        if word not in stopwords.words('spanish') and len(word) > 3:
            word_count[word] = word_count.get(word, 0) + 1
    
    repetitive_words = [word for word, count in word_count.items() if count > 3]
    
    if repetitive_words:
        results.append({
            'repetitive_words': repetitive_words,
            'suggestion': f'Considera usar sinónimos para: {", ".join(repetitive_words)}',
            'type': 'style_repetition',
            'severity': 'medium'
        })
    
    return results

def check_coherence(text):
    """Analiza la coherencia del texto usando BLOOMZ"""
    if len(text.split()) < 20:  # Solo analizar textos con suficiente contenido
        return []
    
    # Consulta a BLOOMZ para evaluar coherencia
    prompt = f"Evalúa la coherencia de este texto y sugiere mejoras si es necesario: '{text[:500]}...'"
    
    inputs = tokenizer(prompt, return_tensors="pt")
    with torch.no_grad():
        outputs = model.generate(
            inputs.input_ids.to(model.device),
            max_length=150,
            num_return_sequences=1,
            temperature=0.2
        )
    
    response = tokenizer.decode(outputs[0], skip_special_tokens=True)
    
    # Procesar la respuesta (simplificado)
    if "incoherente" in response.lower() or "mejorar" in response.lower():
        return [{
            'text': text,
            'suggestion': response,
            'type': 'coherence',
            'severity': 'medium'
        }]
    
    return []

def check_plagiarism(text):
    """Detecta posible plagio mediante fingerprinting y comparación"""
    results = []
    
    # Dividir en párrafos
    paragraphs = text.split('\n\n')
    
    for i, paragraph in enumerate(paragraphs):
        if len(paragraph.split()) < 10:  # Ignorar párrafos cortos
            continue
            
        # Crear fingerprint del párrafo
        fingerprint = create_text_fingerprint(paragraph)
        
        # Comparar con base de datos de fingerprints
        matches = find_similar_fingerprints(fingerprint, paragraph)
        
        if matches:
            results.append({
                'paragraph_index': i,
                'text': paragraph,
                'matches': matches,
                'type': 'plagiarism',
                'severity': 'high'
            })
    
    return results

def create_text_fingerprint(text):
    """Crea una huella digital del texto para comparación"""
    # Simplificado - en producción usaríamos algoritmos más sofisticados
    # como shingling, w-shingling o SimHash
    
    # Normalizar y tokenizar
    words = word_tokenize(text.lower())
    
    # Filtrar stopwords
    filtered_words = [w for w in words if w not in stopwords.words('spanish')]
    
    # Crear n-gramas (trigramas en este caso)
    ngrams = []
    for i in range(len(filtered_words) - 2):
        ngram = ' '.join(filtered_words[i:i+3])
        ngrams.append(ngram)
    
    # Crear hash de cada n-grama
    fingerprint = []
    for ngram in ngrams:
        hash_value = hashlib.md5(ngram.encode()).hexdigest()
        fingerprint.append(hash_value)
    
    return fingerprint

def find_similar_fingerprints(fingerprint, text):
    """Encuentra textos similares basados en fingerprints"""
    # Implementación simplificada - en producción conectaríamos con APIs como
    # Turnitin, Copyscape o usaríamos bases de datos más grandes
    
    matches = []
    similarity_threshold = 0.5  # Umbral de similitud
    
    # Almacenar el fingerprint para futuras comparaciones
    text_id = hashlib.md5(text.encode()).hexdigest()
    text_fingerprints[text_id] = {
        'fingerprint': fingerprint,
        'text': text[:100] + '...',  # Almacenar una versión truncada
        'source': 'Documento actual'  # En producción sería una URL o referencia
    }
    
    # Simular base de datos con algunos ejemplos
    # En producción, esto sería una base de datos real o una API externa
    common_texts = [
        "La inteligencia artificial es un campo de la informática que busca crear sistemas capaces de realizar tareas que normalmente requerirían inteligencia humana.",
        "El calentamiento global es el aumento a largo plazo de la temperatura media del sistema climático de la Tierra.",
        "La pandemia de COVID-19 ha tenido un impacto significativo en la economía mundial y en los sistemas de salud."
    ]
    
    # Añadir textos comunes a nuestra "base de datos" si no existen
    for common_text in common_texts:
        text_id = hashlib.md5(common_text.encode()).hexdigest()
        if text_id not in text_fingerprints:
            fp = create_text_fingerprint(common_text)
            text_fingerprints[text_id] = {
                'fingerprint': fp,
                'text': common_text,
                'source': 'Base de conocimiento general'
            }
    
    # Comparar con fingerprints existentes
    for text_id, data in text_fingerprints.items():
        other_fingerprint = data['fingerprint']
        
        # Calcular similitud (implementación simplificada con coeficiente de Jaccard)
        common_hashes = set(fingerprint).intersection(set(other_fingerprint))
        all_hashes = set(fingerprint).union(set(other_fingerprint))
        
        if not all_hashes:
            continue
            
        similarity = len(common_hashes) / len(all_hashes)
        
        if similarity > similarity_threshold and data['text'] != text[:100] + '...':
            matches.append({
                'similarity': round(similarity * 100, 2),
                'text': data['text'],
                'source': data['source']
            })
    
    return matches

if __name__ == '__main__':
    #socketio.run(app, debug=True)
    #app.run(port=int(os.environ.get('PORT', 5000)), debug=True)
    #socketio.run(port=int(os.environ.get('PORT', 80)), debug=True)

     # Obtener el puerto del entorno o usar 5000 por defecto
    port = int(os.environ.get('PORT', 5001))
    
    # Imprimir información de depuración
    print(f"Iniciando servidor en el puerto {port}")
    print(f"Modo de depuración: {True}")
    
    # Usar socketio.run() en lugar de app.run()
    socketio.run(app, 
        host='0.0.0.0',  # Escuchar en todas las interfaces
        port=port, 
        debug=True,
        use_reloader=True  # Recargar automáticamente cuando cambien los archivos
    )