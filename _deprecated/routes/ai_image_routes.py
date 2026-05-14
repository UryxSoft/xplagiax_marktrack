"""
Sistema Avanzado de Detección y Búsqueda de Imágenes con IA

Este módulo combina tres capacidades principales:

1. DETECCIÓN AI vs HUMANO (SigLIP)
   - Clasifica si una imagen fue generada por IA o creada por humanos
   - Modelo: Ateeqq/ai-vs-human-image-detector
   - Retorna confianza y scores detallados

2. BÚSQUEDA POR SIMILITUD VISUAL (CLIP)
   - Codificación con CLIP (OpenAI): clip-ViT-B-32
   - Cada imagen → vector de 512 números (embedding)
   - Captura colores, formas, texturas y contenido semántico
   
   Cómo funciona la búsqueda:
   * Distancia coseno entre vectores
   * Similitud 100% (score ~1.0): imagen idéntica
   * Similitud 85-95% (score 0.85-0.95): imagen editada, recortada, con cambios de color
   * Similitud 70-85%: imágenes relacionadas o con elementos similares
   * Umbral recomendado: 0.90 (90% para detectar copias y derivadas)

3. BÚSQUEDA INVERSA DE IMÁGENES (API Rotation)
   - Busca imágenes similares en la web usando múltiples APIs
   - Rotación automática entre SerpApi, Zenserp
   - Respeta límites de tier gratuito
   - Búsqueda de patentes por imagen o texto

Storage: Qdrant (base de datos vectorial)
"""

import os
import glob
import io
import uuid
import base64
import torch
import requests
import json
import datetime
from flask import Flask, request, jsonify, Blueprint, send_file
from serpapi import GoogleSearch
import tempfile
# import tempfile
from settings.extensions import csrf
from services.search_service import search_service

# from qdrant_client import QdrantClient
# from qdrant_client.http.models import (
#     VectorParams, Distance, PointStruct, PointIdsList, Filter, FieldCondition, MatchValue
# )
from transformers import AutoImageProcessor, AutoModelForImageClassification
from sentence_transformers import SentenceTransformer
from PIL import Image, UnidentifiedImageError
import numpy as np
import warnings
from typing import Optional, Dict, List, Any
from pathlib import Path

# Suprimir warnings específicos
warnings.filterwarnings("ignore", message="Possibly corrupt EXIF data.")
warnings.filterwarnings("ignore", message=".*You are using the default legacy behaviour.*")

x_image = Blueprint('x_image', __name__)

# -------------------
# Configuration Constants
# -------------------
DEVICE = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
MODEL_IDENTIFIER = "Ateeqq/ai-vs-human-image-detector"
CLIP_MODEL = "clip-ViT-B-32"


# -------------------
# Initialize SearchService (Imported from services)
# -------------------
# search_service is imported directly

# -------------------
# Configuración del sistema de archivos
# -------------------
IMAGE_BASE_PATH = "/mnt/user-data/uploads"

# Qdrant References Removed


# -------------------
# Cargar modelo y procesador al iniciar
# -------------------
# Initialize variables
model = None
processor = None
clip_model = None

print(f"Usando dispositivo: {DEVICE}")
print(f"Cargando modelo AI/Human: {MODEL_IDENTIFIER}")
print(f"Cargando modelo CLIP: {CLIP_MODEL}")

try:
    processor = AutoImageProcessor.from_pretrained(MODEL_IDENTIFIER, use_fast=True)
    model = AutoModelForImageClassification.from_pretrained(MODEL_IDENTIFIER)
    model.to(DEVICE)
    model.eval()
    print("✓ Modelo SigLIP cargado exitosamente")
    
    clip_model = SentenceTransformer(CLIP_MODEL, device=str(DEVICE))
    print("✓ Modelo CLIP cargado exitosamente")
    
except Exception as e:
    print(f"ERROR FATAL: No se pudo cargar los modelos: {e}")
    raise

# -------------------
# Función de clasificación AI vs Human
# -------------------
def classify_ai_human(image_bytes: bytes) -> Optional[Dict[str, Any]]:
    """
    Clasifica una imagen como AI-generada o creada por humano
    usando el modelo SigLIP moderno (2024).
    """
    if not image_bytes:
        return None
    
    try:
        image = Image.open(io.BytesIO(image_bytes))
        image = image.convert("RGB")
        
        # FIX: Manual tensor conversion using numpy to avoid transformers bug
        encoding = processor(images=[image], return_tensors="np")
        # Ensure it is a numpy array of float32
        np_pixels = np.array(encoding["pixel_values"], dtype=np.float32)
        pixel_values = torch.from_numpy(np_pixels).to(DEVICE)
        inputs = {"pixel_values": pixel_values}
        
        with torch.no_grad():
            outputs = model(**inputs)
            logits = outputs.logits
        
        probabilities = torch.softmax(logits, dim=-1)[0]
        
        results = {
            model.config.id2label[i]: float(prob.item())
            for i, prob in enumerate(probabilities)
        }
        
        top_label = max(results, key=results.get)
        top_confidence = results[top_label]
        
        # Normalize label
        is_human = top_label.lower() in ["human", "hum", "real"]
        is_ai = top_label.lower() in ["ai", "fake", "generated"]
        
        return {
            "is_human": is_human,
            "is_ai": is_ai,
            "label": top_label,
            "confidence": top_confidence,
            "human_score": results.get("human", 0.0),
            "ai_score": results.get("ai", 0.0),
            "all_scores": results,
            "model": MODEL_IDENTIFIER,
            "device": str(DEVICE)
        }
        
    except Exception as e:
        # DEBUG: Return error details
        return {"error": f"Exception in classify_ai_human: {str(e)}"}

# -------------------
# Función para extraer embedding
# -------------------
def extract_vector(file_bytes: bytes) -> List[float]:
    """
    Extrae vector de embedding de una imagen usando CLIP.
    """
    try:
        image = Image.open(io.BytesIO(file_bytes)).convert("RGB")
        embedding = clip_model.encode(image, convert_to_numpy=True)
        vec = np.array(embedding).flatten().astype('float32')
        
        norm = np.linalg.norm(vec)
        if norm > 0:
            vec = vec / norm
        
        return vec.tolist()
        
    except Exception as e:
        print(f"Error extrayendo vector CLIP: {e}")
        return [0.0] * 512

# -------------------
# Función auxiliar para buscar archivos
# -------------------
def find_image_file(filename: str, group_id: Optional[str] = None) -> Optional[str]:
    """Busca un archivo de imagen en diferentes ubicaciones posibles"""
    search_paths = [
        IMAGE_BASE_PATH,
        os.path.join(IMAGE_BASE_PATH, "images"),
        os.path.join(IMAGE_BASE_PATH, "uploads"),
        os.path.join(IMAGE_BASE_PATH, "documents"),
    ]
    
    if group_id:
        search_paths.extend([
            os.path.join(IMAGE_BASE_PATH, group_id),
            os.path.join(IMAGE_BASE_PATH, "images", group_id),
            os.path.join(IMAGE_BASE_PATH, "uploads", group_id),
        ])
    
    for search_path in search_paths:
        full_path = os.path.join(search_path, filename)
        if os.path.exists(full_path):
            return full_path
    
    for search_path in search_paths:
        if os.path.exists(search_path):
            pattern = os.path.join(search_path, "**", filename)
            matches = glob.glob(pattern, recursive=True)
            if matches:
                return matches[0]
    
    return None

# -------------------
# NUEVOS ENDPOINTS - API ROTATOR
# -------------------

@x_image.route("/analyze_batch_images", methods=["POST"])
def analyze_batch_images():
    """
    Analiza un lote de imágenes (AI Detection + Reverse Search).
    
    Método: POST (JSON)
    Body: {
        "images": [
            {"id": "img1", "src": "data:image/jpeg;base64,..."}
        ]
    }
    
    Retorna:
    {
        "results": [
            {
                "id": "img1",
                "ai_detection": {...},
                "reverse_search": {...}
            }
        ]
    }
    """
    data = request.get_json()
    if not data or "images" not in data:
        return jsonify({"error": "No se enviaron imágenes"}), 400

    results = []
    
    for img_data in data.get("images", []):
        img_id = img_data.get("id")
        src = img_data.get("src")
        
        result_item = {"id": img_id, "status": "processed"}
        
        try:
            image_bytes = None
            
            # 1. Obtener bytes de imagen
            if src.startswith("data:image"):
                # Base64
                header, encoded = src.split(",", 1)
                image_bytes = base64.b64decode(encoded)
            elif src.startswith("http"):
                # URL
                resp = requests.get(src, timeout=10)
                if resp.status_code == 200:
                    image_bytes = resp.content
            
            if image_bytes:
                # 2. AI Detection
                ai_result = classify_ai_human(image_bytes)
                if ai_result:
                    result_item["ai_detection"] = ai_result
                
                # 3. Reverse Search (Si ApiRotator está disponible)
                # NOTA: Limitamos a 1 resultado para ahorrar cuota en batch
                if search_service:
                    try:
                        # Para reverse search necesitamos URL pública o subir la imagen
                        # Como aquí tenemos bytes, si era URL usamos esa URL
                        # Si era base64, APIs como SerpApi requieren URL pública generalmente
                        # O upload. Zenserp acepta URL.
                        # Para este MVP, solo ejecutamos reverse search si tenemos URL original
                        # O si implementamos un upload temporal (fuera del scope actual)
                        
                        search_url = src if src.startswith("http") else None
                        
                        # Si es base64, podríamos intentar búsqueda si el API lo soporta o saltar
                        # SerpApi soporta upload pero es más lento.
                        
                        if search_url:
                            rev_result = search_service.reverse_image_search(search_url, num_results=1)
                            result_item["reverse_search"] = rev_result
                        else:
                            # Try upload if no URL
                            try:
                                rev_result = search_service.reverse_image_upload(image_bytes, num_results=1)
                                result_item["reverse_search"] = rev_result
                            except Exception as e:
                                result_item["reverse_search"] = {"error": f"Upload search failed: {str(e)}"}
                            
                    except Exception as e:
                        result_item["reverse_search"] = {"error": str(e)}
            else:
                result_item["status"] = "failed"
                result_item["error"] = "No se pudo cargar la imagen"
                
        except Exception as e:
            result_item["status"] = "error"
            result_item["error"] = str(e)
            
        results.append(result_item)
        
    return jsonify({"results": results}), 200

@x_image.route("/reverse_image_search", methods=["POST"])
# @csrf.exempt
def reverse_image_search_endpoint():
    """
    Busca imágenes similares en la web usando reverse image search.
    
    Método: POST (multipart/form-data)
    
    Parámetros:
        - file (archivo): Imagen subida para buscar
        - image_url (str): URL de imagen alternativa
        - num_results (int): Cantidad de resultados (default 10)
    
    Retorna:
        - status: Estado de la operación
        - results: Lista de imágenes similares encontradas en la web
        - usage: Estado de uso actual de APIs
    
    Errores:
        - 400: No se proporcionó file ni image_url
        - 500: Error interno
        - 503: ApiRotator no disponible
    """
    if not search_service:
        return jsonify({
            "error": "search_service no disponible. Configura SERPAPI_KEY y ZENSERP_KEY"
        }), 503
    
    try:
        image_url = None
        
        # Opción 1: URL directa
        if request.form.get("image_url"):
            image_url = request.form.get("image_url")
        
        # Opción 2: Archivo subido (convertir a base64 data URL)
        elif "file" in request.files:
            file = request.files["file"]
            file_bytes = file.read()
            b64 = base64.b64encode(file_bytes).decode()
            
            # Detectar tipo de imagen
            try:
                img = Image.open(io.BytesIO(file_bytes))
                fmt = img.format.lower()
            except:
                fmt = "jpeg"
            
            image_url = f"data:image/{fmt};base64,{b64}"
        
        else:
            return jsonify({"error": "Se requiere 'file' o 'image_url'"}), 400
        
        num_results = int(request.form.get("num_results", 10))
        
        # Check if URL is local (localhost/127.0.0.1) which external APIs can't access
        is_local_url = image_url and ('localhost' in image_url or '127.0.0.1' in image_url)
        
        if is_local_url:
            # Download local image and upload to API
            try:
                resp = requests.get(image_url, timeout=5)
                if resp.status_code == 200:
                    results = search_service.reverse_image_upload(resp.content, num_results)
                else:
                    return jsonify({"error": f"No se pudo acceder a imagen local: {resp.status_code}"}), 400
            except Exception as locals_err:
                 return jsonify({"error": f"Error descargando imagen local: {str(locals_err)}"}), 400
        else:
            # Normal flow
            results = search_service.reverse_image_search(image_url, num_results)
        
        return jsonify({
            "status": "success",
            "results": results,
            "usage": search_service.get_usage_status()
        }), 200
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# -------------------
# ENDPOINTS DE DETECCIÓN Y BÚSQUEDA DE IMÁGENES
# Los endpoints de patentes fueron movidos a:
# services/genuine_service/genuine_detector_router.py
# -------------------

@x_image.route("/analyze_ai_detection", methods=["POST"])
# @csrf.exempt
def analyze_ai_detection():
    """
    Analiza si una imagen fue generada por IA o creada por humanos.
    
    Método: POST (multipart/form-data)
    Modelo: SigLIP (Ateeqq/ai-vs-human-image-detector)
    
    Parámetros:
        - file (archivo): Imagen a analizar
        - image_url (str): URL de imagen a analizar
    
    Retorna:
        - is_human (bool): True si la imagen es de origen humano
        - is_ai (bool): True si la imagen fue generada por IA
        - label (str): Etiqueta de clasificación
        - confidence (float): Nivel de confianza (0-1)
        - human_score, ai_score (float): Scores individuales
    """
    file_bytes = None

    try:
        # Opción 1: Archivo subido
        if "file" in request.files:
            file = request.files["file"]
            file_bytes = file.read()
            
        # Opción 2: URL directa
        elif request.form.get("image_url"):
            image_url = request.form.get("image_url")
            # Descargar imagen
            resp = requests.get(image_url, timeout=10)
            if resp.status_code == 200:
                file_bytes = resp.content
            else:
                return jsonify({"error": f"No se pudo descargar la imagen desde URL: {resp.status_code}"}), 400
        
        else:
            return jsonify({"error": "Se requiere 'file' o 'image_url'"}), 400
        
        if not file_bytes:
            return jsonify({"error": "No se pudo leer la imagen"}), 500

        result = classify_ai_human(file_bytes)
        
        if result is None:
            return jsonify({"error": "No se pudo procesar la imagen (formato no soportado o corrupta)"}), 500
        
        return jsonify(result), 200
        
    except Exception as e:
        return jsonify({"error": f"Error en análisis: {str(e)}"}), 500


# Qdrant Routes (upload_and_index, search_similar, get_image) Removed



# Qdrant Routes (get_image_base64, delete_image, etc.) Removed



@x_image.route("/ai_model_info", methods=["GET"])
def ai_model_info():
    """
    Retorna información sobre los modelos cargados.
    """
    return jsonify({
        "ai_detection_model": {
            "name": MODEL_IDENTIFIER,
            "available": model is not None,
            "labels": list(model.config.id2label.values()) if model else [],
            "description": "SigLIP fine-tuned para detectar imágenes AI vs Humanas (2024)"
        },
        "search_model": {
            "name": CLIP_MODEL,
            "available": clip_model is not None,
            "dimensions": 512,
            "description": "CLIP para embeddings y búsqueda por similitud visual"
        },
        "api_rotator": {
            "available": search_service is not None,
            "description": "Búsqueda inversa de imágenes y patentes en la web"
        },
        "device": str(DEVICE)
    }), 200

@x_image.route("/health", methods=["GET"])
def health():
    """
    Verifica el estado del servicio.
    """
    return jsonify({
        "status": "healthy",
        "siglip_model_loaded": model is not None,
        "clip_model_loaded": clip_model is not None,
        "api_rotator_available": search_service is not None,
        "device": str(DEVICE)
    }), 200

# Analyze plagiarism removed
# Qdrant Logic Removed