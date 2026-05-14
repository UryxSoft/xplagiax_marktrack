"""
AI Writing Assistant Routes
- POST /analyze: LanguageTool + Gemini analysis with standardized suggestion format
- POST /rewrite: Gemini-powered text rewriting
- POST /gemini-action: Specific AI actions (clarity, concise, vocabulary, tone, etc.)
"""

from flask import Blueprint, request, jsonify, current_app
import google.generativeai as genai
import language_tool_python
import time
import threading
import json
import logging
import uuid
import re
from flask_login import current_user

ai_writing_bp = Blueprint('ai_writing_bp', __name__)
from settings.extensions import csrf
from services.search_service import search_service
csrf.exempt(ai_writing_bp)
logger = logging.getLogger(__name__)

# --- Initialization ---
# Initialize LanguageTool (downloads if needed, or uses local if available)
try:
    tool = language_tool_python.LanguageTool('en-US')
    logger.info("LanguageTool initialized.")
except Exception as e:
    logger.error(f"Failed to initialize LanguageTool: {e}")
    tool = None

# Gemini Rate Limiting & Configuration
GEMINI_RPM_LIMIT = 15  # Conservative limit (Paid tier is higher, but start safe)
gemini_request_count = 0
gemini_window_start = time.time()
gemini_enabled = True
gemini_lock = threading.Lock()

# --- Spelling ruleIds for type classification ---
SPELLING_RULE_IDS = {
    'MORFOLOGIK_RULE_EN_US',
    'MORFOLOGIK_RULE_EN_GB',
    'MORFOLOGIK_RULE_EN',
    'HUNSPELL_RULE',
    'HUNSPELL_NO_SUGGEST_RULE',
}
SPELLING_CATEGORIES = {'Typos', 'TYPOS'}

# --- Valid Gemini suggestion types ---
VALID_GEMINI_TYPES = {'clarity', 'coherence', 'word_choice', 'style', 'conciseness'}


def truncate_message(msg, max_words=20):
    """Truncate a message to max_words, appending '...' if truncated."""
    if not msg:
        return ""
    words = msg.split()
    if len(words) <= max_words:
        return msg
    return ' '.join(words[:max_words]) + '...'


def configure_gemini(api_key):
    """Configure Gemini API with the provided key."""
    try:
        genai.configure(api_key=api_key)
        return True
    except Exception as e:
        logger.error(f"Failed to configure Gemini: {e}")
        return False


def check_gemini_rate_limit():
    """Check and update Gemini rate limiter. Returns True if under limit."""
    global gemini_request_count, gemini_window_start, gemini_enabled

    with gemini_lock:
        current_time = time.time()
        # Reset window if > 60 seconds
        if current_time - gemini_window_start > 60:
            gemini_request_count = 0
            gemini_window_start = current_time
            gemini_enabled = True

        if gemini_request_count >= GEMINI_RPM_LIMIT:
            gemini_enabled = False
            return False

        gemini_request_count += 1
        return True


def get_gemini_suggestions(text):
    """Call Gemini API with the exact required prompt and return standardized suggestions."""
    if not current_app.config.get('GEMINI_API_KEY'):
        return []

    try:
        # Map user creativity setting to temperature
        temperature = 0.7
        try:
            if current_user and current_user.is_authenticated:
                level = current_user.get_settings().get('ai', {}).get('creativity_level', 'balanced')
                if level == 'precise': temperature = 0.3
                elif level == 'creative': temperature = 1.0
        except Exception:
            pass

        model = genai.GenerativeModel('gemini-1.5-flash')
        generation_config = genai.types.GenerationConfig(temperature=temperature)

        # EXACT PROMPT FROM REQUIREMENT (verbatim)
        prompt = f"""You are an expert English writing coach. Analyze the text and return ONLY a valid JSON array (no markdown, no extra text) of maximum 12 meaningful suggestions. Each must have: start (offset), end (offset), type (one of: clarity, coherence, word_choice, style, conciseness), message (max 20 words), replacements (1-5 strings, first is primary), reason (max 20 words explaining why). Focus on high-impact improvements only.

   Text: {text}"""

        response = model.generate_content(prompt, generation_config=generation_config)

        # Clean response (remove markdown code blocks if present)
        content = response.text.replace('```json', '').replace('```', '').strip()

        try:
            suggestions = json.loads(content)
            valid_suggestions = []
            for s in suggestions:
                # Basic validation: must have start, end, message
                if 'start' in s and 'end' in s and 'message' in s:
                    s['id'] = str(uuid.uuid4())
                    s['source'] = 'gemini'
                    # Validate type against allowed values
                    if s.get('type') not in VALID_GEMINI_TYPES:
                        s['type'] = 'style'  # Default fallback
                    # Ensure replacements is a list
                    if not isinstance(s.get('replacements'), list):
                        s['replacements'] = []
                    # Truncate message and reason to 20 words
                    s['message'] = truncate_message(s.get('message', ''), 20)
                    s['reason'] = truncate_message(s.get('reason', ''), 20)
                    valid_suggestions.append(s)
            return valid_suggestions
        except json.JSONDecodeError:
            logger.error(f"Gemini returned invalid JSON: {content[:200]}")
            return []

    except Exception as e:
        logger.error(f"Gemini API error: {e}")
        return []


# =============================================================================
# ROUTES
# =============================================================================

@ai_writing_bp.route('/analyze', methods=['POST'])
def analyze_text():
    """
    POST /analyze
    Body: { "text": string, "html": string (optional) }
    Returns: { "suggestions": [...], "gemini_enabled": boolean }
    """
    data = request.get_json()
    text = data.get('text', '')

    if not text or len(text.strip()) < 3:
        return jsonify({"suggestions": [], "gemini_enabled": gemini_enabled})

    suggestions = []

    # 1. LanguageTool Analysis (Always run)
    if tool:
        try:
            matches = tool.check(text)
            for match in matches:
                # Classify type: spelling or grammar
                item_type = 'grammar'
                if (match.ruleId in SPELLING_RULE_IDS or
                        match.category in SPELLING_CATEGORIES or
                        'spell' in match.ruleId.lower()):
                    item_type = 'spelling'

                # Build reason from LT shortMessage or ruleId
                reason = ''
                if hasattr(match, 'shortMessage') and match.shortMessage:
                    reason = truncate_message(match.shortMessage, 20)
                elif match.ruleId:
                    # Convert ruleId to readable form: COMMA_COMPOUND_SENTENCE → Comma compound sentence
                    reason = match.ruleId.replace('_', ' ').capitalize()
                    reason = truncate_message(reason, 20)

                suggestions.append({
                    "id": str(uuid.uuid4()),
                    "type": item_type,
                    "start": match.offset,
                    "end": match.offset + match.errorLength,
                    "message": truncate_message(match.message, 20),
                    "replacements": match.replacements[:5],
                    "reason": reason,
                    "source": "languagetool"
                })
        except Exception as e:
            logger.error(f"LanguageTool error: {e}")

    # 2. Gemini Analysis (Conditional: requires API key + rate limit)
    api_key = current_app.config.get('GEMINI_API_KEY')
    is_gemini_active = False

    if api_key:
        configure_gemini(api_key)

        if check_gemini_rate_limit():
            gemini_suggestions = get_gemini_suggestions(text)
            suggestions.extend(gemini_suggestions)
            is_gemini_active = True
        else:
            logger.warning("Gemini rate limit reached.")

    return jsonify({
        "suggestions": suggestions,
        "gemini_enabled": is_gemini_active
    })


@ai_writing_bp.route('/rewrite', methods=['POST'])
def rewrite_text():
    """Rewrite selected text using Gemini with a target tone."""
    data = request.get_json()
    text = data.get('text', '')
    tone = data.get('tone', 'Neutral')

    if not text:
        return jsonify({"rewritten_text": ""})

    api_key = current_app.config.get('GEMINI_API_KEY')
    if not api_key:
        return jsonify({"error": "Gemini API key not configured"}), 500

    if not check_gemini_rate_limit():
        return jsonify({"error": "Rate limit reached. Try again later."}), 429

    try:
        configure_gemini(api_key)
        
        temperature = 0.7
        try:
            if current_user and current_user.is_authenticated:
                level = current_user.get_settings().get('ai', {}).get('creativity_level', 'balanced')
                if level == 'precise': temperature = 0.3
                elif level == 'creative': temperature = 1.0
        except Exception:
            pass

        model = genai.GenerativeModel('gemini-1.5-flash')
        generation_config = genai.types.GenerationConfig(temperature=temperature)
        prompt = f"Rewrite the selected text to be clearer and more engaging while keeping exact meaning. Return only the rewritten text. Target tone: {tone}.\n\nText: {text}"

        response = model.generate_content(prompt, generation_config=generation_config)
        return jsonify({"rewritten_text": response.text.strip()})

    except Exception as e:
        logger.error(f"Gemini Rewrite error: {e}")
        return jsonify({"error": str(e)}), 500


@ai_writing_bp.route('/gemini-action', methods=['POST'])
def gemini_action():
    """Handle specific AI actions from context menu."""
    data = request.get_json()
    text = data.get('text', '')
    action = data.get('action', '')
    tone = data.get('tone', 'Neutral')

    if not text:
        return jsonify({"result": ""})

    api_key = current_app.config.get('GEMINI_API_KEY')
    if not api_key:
        return jsonify({"error": "Gemini API key not configured"}), 500

    if not check_gemini_rate_limit():
        return jsonify({"error": "Rate limit reached. Try again later."}), 429

    try:
        configure_gemini(api_key)
        
        temperature = 0.7
        try:
            if current_user and current_user.is_authenticated:
                level = current_user.get_settings().get('ai', {}).get('creativity_level', 'balanced')
                if level == 'precise': temperature = 0.3
                elif level == 'creative': temperature = 1.0
        except Exception:
            pass

        model = genai.GenerativeModel('gemini-1.5-flash')
        generation_config = genai.types.GenerationConfig(temperature=temperature)

        prompts = {
            'rewrite': f"Rewrite the following text to be better, maintaining the original meaning. Target tone: {tone}. Return ONLY the rewritten text.\n\nText: {text}",
            'clarity': f"Rewrite the following text to be clearer and easier to understand. Return ONLY the rewritten text.\n\nText: {text}",
            'concise': f"Rewrite the following text to be more concise without losing key information. Return ONLY the rewritten text.\n\nText: {text}",
            'vocabulary': f"Rewrite the following text using more precise and varied vocabulary. Return ONLY the rewritten text.\n\nText: {text}",
            'tone': f"Rewrite the following text to match a {tone} tone. Return ONLY the rewritten text.\n\nText: {text}",
            'explain': f"Explain the meaning and context of the following text in 1-2 sentences. Return ONLY the explanation.\n\nText: {text}",
            'alternatives': f"Provide 3 alternative ways to phrase the following text. Return them as a bulleted list.\n\nText: {text}"
        }

        prompt = prompts.get(action, prompts['rewrite'])

        response = model.generate_content(prompt, generation_config=generation_config)
        return jsonify({"result": response.text.strip()})

    except Exception as e:
        logger.error(f"Gemini Action error: {e}")
        return jsonify({"error": str(e)}), 500


@ai_writing_bp.route('/check_plagiarism', methods=['POST'])
def check_plagiarism():
    """
    Check text for plagiarism using SerpApi (Google Search).
    Accepts 'text' or 'paragraphs' (list of strings).
    Returns exact matches found on the web.
    """
    data = request.get_json()
    text = data.get('text', '')
    paragraphs = data.get('paragraphs', [])

    if not paragraphs and text:
        # Naive split by double newline if paragraphs not provided
        paragraphs = [p.strip() for p in text.split('\n\n') if p.strip()]

    if not paragraphs:
        return jsonify({"results": []})

    results = []
    
    # Limit paragraphs to check to avoid draining quota rapidly
    # For now, check first 5 non-empty paragraphs or all if small
    # check_limit = 5 
    # paragraphs = paragraphs[:check_limit]

    for i, paragraph in enumerate(paragraphs):
        if len(paragraph) < 50: # Skip very short snippets
            continue
            
        # Use a distinctive snippet (first 200 chars or middle?)
        # Searching the whole paragraph might be too long for Google query limit (32 words approx for exact match?)
        # Google exact match limit is around 32 words.
        # Let's take the first 30 words.
        words = paragraph.split()
        search_query = ' '.join(words[:30])
        
        if len(search_query) < 20:
            continue

        search_result = search_service.text_search(search_query)
        
        matches = []
        if "organic_results" in search_result:
            for item in search_result["organic_results"]:
                matches.append({
                    "title": item.get("title"),
                    "link": item.get("link"),
                    "snippet": item.get("snippet")
                })
        
        if matches:
            results.append({
                "paragraph_index": i,
                "text": paragraph, # Return full text for highlighting
                "matches": matches
            })
            
    return jsonify({"results": results})
