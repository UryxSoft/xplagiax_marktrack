# multilang_quill.py
from gramformer import Gramformer
from transformers import T5ForConditionalGeneration, T5Tokenizer
from langdetect import detect, DetectorFactory
from typing import List, Dict, Any, Optional
import logging

# Fijar semilla para detección de idioma
DetectorFactory.seed = 0

class MultiLanguageQuillAnalyzer:
    """
    Soporta: INGLÉS (Gramformer) + FRANCÉS (T5-fr)
    API idéntica a GramformerQuillAnalyzer
    """
    
    def __init__(self, cache_size: int = 100):
        self.cache = {}
        self.cache_size = cache_size
        self.logger = logging.getLogger(__name__)
        
        # Modelos
        self.english_model = Gramformer(models=1, use_gpu=False)
        self.french_model = T5ForConditionalGeneration.from_pretrained(
            "olix3000/french-grammar-correction"
        )
        self.french_tokenizer = T5Tokenizer.from_pretrained(
            "olix3000/french-grammar-correction"
        )

    def detect_language(self, text: str) -> str:
        """Detecta idioma: 'en' o 'fr'"""
        try:
            lang = detect(text)
            return 'en' if lang.startswith('en') else 'fr'
        except:
            return 'en'  # fallback

    def correct_english(self, text: str) -> str:
        try:
            return list(self.english_model.correct(text))[0]
        except:
            return text

    def correct_french(self, text: str) -> str:
        try:
            inputs = self.french_tokenizer(
                f"corriger: {text}", return_tensors="pt", max_length=512, truncation=True
            )
            outputs = self.french_model.generate(
                **inputs, max_length=512, num_beams=4, early_stopping=True
            )
            return self.french_tokenizer.decode(outputs[0], skip_special_tokens=True)
        except Exception as e:
            self.logger.error(f"Error francés: {e}")
            return text

    def highlight_english(self, original: str, corrected: str) -> str:
        try:
            return self.english_model.highlight(original, corrected)
        except:
            return original

    def get_edits_english(self, original: str, corrected: str) -> List[Dict]:
        try:
            edits = self.english_model.get_edits(original, corrected)
            return [
                {
                    "type": e.get("type", "UNKNOWN"),
                    "original": e.get("original", ""),
                    "corrected": e.get("corrected", ""),
                    "start": e.get("start", 0),
                    "end": e.get("end", 0),
                    "explanation": self._explain_en(e.get("type", ""))
                }
                for e in edits
            ]
        except:
            return []

    def _explain_en(self, error_type: str) -> str:
        explanations = {
            "VERB:SVA": "Subject-verb agreement error",
            "VERB:TENSE": "Wrong verb tense",
            "PREP": "Wrong preposition",
            "NOUN:NUM": "Singular/plural mismatch",
            "ORTH": "Spelling error",
            "PUNCT": "Punctuation error"
        }
        return explanations.get(error_type, "Grammar issue")

    def _explain_fr(self, error_type: str) -> str:
        explanations = {
            "acc": "Accord sujet-verbe",
            "temps": "Temps verbal incorrect",
            "prep": "Préposition incorrecte",
            "genre": "Erreur de genre",
            "orth": "Faute d'orthographe",
            "ponct": "Erreur de ponctuation"
        }
        return explanations.get(error_type.lower(), "Erreur grammaticale")

    def analyze(self, text: str) -> Dict[str, Any]:
        if not text.strip():
            return self._empty_result()

        cache_key = hash(text)
        if cache_key in self.cache:
            return self.cache[cache_key]

        lang = self.detect_language(text)
        original = text

        if lang == 'en':
            corrected = self.correct_english(text)
            html = self.highlight_english(original, corrected)
            edits = self.get_edits_english(original, corrected)
            model_name = "Gramformer (EN)"
        else:
            corrected = self.correct_french(text)
            html = self._highlight_french_simple(original, corrected)
            edits = self._get_edits_french_simple(original, corrected)
            model_name = "T5-French (FR)"

        stats = self._compute_stats(edits, lang)
        
        result = {
            "original": original,
            "corrected": corrected,
            "html": html,
            "edits": edits,
            "stats": stats,
            "language": lang,
            "model": model_name
        }

        if len(self.cache) >= self.cache_size:
            self.cache.pop(next(iter(self.cache)))
        self.cache[cache_key] = result
        
        return result

    def _highlight_french_simple(self, original: str, corrected: str) -> str:
        # Resaltado básico (palabras cambiadas)
        import difflib
        diff = difflib.ndiff(original.split(), corrected.split())
        highlighted = []
        for word in diff:
            if word.startswith('- '):
                highlighted.append(f'<c class="error">{word[2:]}</c>')
            elif word.startswith('+ '):
                highlighted.append(f'<span class="correction">{word[2:]}</span>')
            elif not word.startswith('? '):
                highlighted.append(word[2:] if word.startswith('  ') else word)
        return ' '.join(highlighted)

    def _get_edits_french_simple(self, original: str, corrected: str) -> List[Dict]:
        # Ediciones básicas
        import difflib
        edits = []
        matcher = difflib.SequenceMatcher(None, original.split(), corrected.split())
        for tag, i1, i2, j1, j2 in matcher.get_opcodes():
            if tag == 'replace':
                for a, b in zip(original.split()[i1:i2], corrected.split()[j1:j2]):
                    edits.append({
                        "type": "MOD",
                        "original": a,
                        "corrected": b,
                        "start": original.find(a),
                        "explanation": "Modification suggérée"
                    })
        return edits

    def _compute_stats(self, edits: List[Dict], lang: str) -> Dict:
        total = len(edits)
        severity = "excellent" if total == 0 else "bon" if total <= 2 else "moyen" if total <= 5 else "à améliorer"
        if lang == 'en':
            severity = {"excellent": "excellent", "bon": "good", "moyen": "fair", "à améliorer": "needs work"}.get(severity, severity)
        return {
            "total_errors": total,
            "severity": severity,
            "language_detected": lang
        }

    def _empty_result(self):
        return {
            "original": "", "corrected": "", "html": "", "edits": [], "stats": {}, "language": "", "model": ""
        }