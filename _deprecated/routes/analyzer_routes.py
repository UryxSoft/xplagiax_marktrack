# app.py
from flask import Blueprint, request, jsonify
from multilang_quill import MultiLanguageQuillAnalyzer
import logging

# Configuración de logging
logging.basicConfig(level=logging.INFO)

# Inicializar Flask
analyzer_bp = Blueprint('document_bp', __name__)

# Inicializar analizador multilingüe
analyzer = MultiLanguageQuillAnalyzer(cache_size=200)

@analyzer_bp.route('/api/analyze', methods=['POST'])
def analyze():
    """
    Endpoint principal
    Entrada: { "text": "Tu texto aquí" }
    Salida: JSON con corrección, HTML, errores, idioma, etc.
    """
    try:
        data = request.get_json()
        if not data or 'text' not in data:
            return jsonify({"error": "Falta el campo 'text'"}), 400

        text = data['text'].strip()
        if not text:
            return jsonify({"error": "El texto está vacío"}), 400

        # Analizar con el modelo correcto
        result = analyzer.analyze(text)

        return jsonify(result)

    except Exception as e:
        logging.error(f"Error en /api/analyze: {e}")
        return jsonify({"error": "Error interno del servidor"}), 500