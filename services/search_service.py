
import os
import json
import datetime
import requests
import tempfile
from serpapi import GoogleSearch

class SearchService:
    """
    Manages search operations using SerpApi and Zenserp with rotation and quota management.
    Handles both Image (Reverse Search) and Text (Plagiarism check) searches.
    """
      
    def __init__(self, serpapi_key: str, zenserp_key: str, usage_file: str = 'usage_tracker.json'):
        self.api_keys = {
            'serpapi': serpapi_key,
            'zenserp': zenserp_key
        }
        self.limits = {
            'serpapi': 250,
            'zenserp': 50
        }
        self.usage_file = usage_file
        self.api_order = ['serpapi', 'zenserp']
        self.usage = self._load_usage()
        self._reset_if_new_month()
    
    def _load_usage(self) -> dict:
        if os.path.exists(self.usage_file):
            with open(self.usage_file, 'r') as f:
                return json.load(f)
        return {
            'last_month': datetime.datetime.now().strftime('%Y-%m'),
            'counts': {api: 0 for api in self.api_order}
        }
    
    def _save_usage(self):
        with open(self.usage_file, 'w') as f:
            json.dump(self.usage, f)
            
    def _reset_if_new_month(self):
        current_month = datetime.datetime.now().strftime('%Y-%m')
        if self.usage['last_month'] != current_month:
            self.usage = {
                'last_month': current_month,
                'counts': {api: 0 for api in self.api_order}
            }
            self._save_usage()

    def get_available_api(self):
        for api in self.api_order:
            if self.usage['counts'][api] < self.limits[api] * 0.9:
                return api
        return self.api_order[0] # Fallback to first even if limit reached

    def _increment_usage(self, api):
        self.usage['counts'][api] += 1
        self._save_usage()

    # ---------------------------------------------------------
    # IMAGE SEARCH METHODS
    # ---------------------------------------------------------

    def reverse_image_search(self, image_url, num_results=10):
        """
        Search by Image URL.
        """
        api = self.get_available_api()
        
        if api == 'serpapi':
            params = {
                "engine": "google_reverse_image",
                "image_url": image_url,
                "api_key": self.api_keys['serpapi'],
                "num": num_results
            }
            try:
                search = GoogleSearch(params)
                results = search.get_dict()
                
                # Graceful handling of "no results" error
                if "error" in results:
                     if "hasn't returned any results" in results["error"]:
                         return {"image_results": []}
                     raise Exception(results["error"])
                
                self._increment_usage(api)
                return results
            except Exception as e:
                if "hasn't returned any results" in str(e):
                    return {"image_results": []}
                raise e
            
        elif api == 'zenserp':
            headers = {"apikey": self.api_keys['zenserp']}
            params = {
                "image_url": image_url,
                "num": num_results
            }
            try:
                response = requests.get("https://app.zenserp.com/api/v2/search", headers=headers, params=params)
                if response.status_code == 200:
                    self._increment_usage(api)
                    return response.json()
                else:
                    raise Exception(f"Zenserp error: {response.text}")
            except Exception as e:
                raise Exception(f"Zenserp connection error: {str(e)}")

    def reverse_image_upload(self, image_bytes, num_results=10):
        """
        Search by Uploading Image (for local files).
        """
        api = self.get_available_api()
        
        if api == 'serpapi':
            temp_path = None
            try:
                # Create a temporary file to upload
                with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as temp_file:
                    temp_file.write(image_bytes)
                    temp_path = temp_file.name
                
                params = {
                    "engine": "google_reverse_image",
                    "image_url": temp_path, # SerpApi library handles upload if local path provided
                    "api_key": self.api_keys['serpapi'],
                    "num": num_results
                }
                
                search = GoogleSearch(params)
                results = search.get_dict()
                
                # Cleanup
                if os.path.exists(temp_path):
                    os.unlink(temp_path)
                    
                if "error" in results:
                    # Graceful handling of "no results" error for uploads too
                    if "hasn't returned any results" in results["error"]:
                        return {"image_results": []}
                    raise Exception(results["error"])
                    
                self._increment_usage(api)
                return results
                
            except Exception as e:
                # Cleanup if failed
                if temp_path and os.path.exists(temp_path):
                    os.unlink(temp_path)
                
                if "hasn't returned any results" in str(e):
                    return {"image_results": []}
                raise Exception(f"Error en SerpApi upload: {str(e)}")
        
        else:
             raise Exception("Zenserp no soporta carga de imágenes locales.")

    # ---------------------------------------------------------
    # PATENT SEARCH METHODS
    # ---------------------------------------------------------

    def patent_text_search(self, query: str, num_results: int = 10) -> dict:
        """
        Búsqueda de patentes por texto.
        """
        api = self.get_available_api()
        if api == 'serpapi':
            serpapi_num = max(10, min(100, num_results))
            params = {
                "engine": "google_patents",
                "q": query,
                "api_key": self.api_keys[api],
                "num": serpapi_num
            }
            url = "https://serpapi.com/search.json"
        elif api == 'zenserp':
            params = {
                "apikey": self.api_keys[api],
                "q": query,
                "tbm": "patent",
                "num": num_results
            }
            url = "https://app.zenserp.com/api/v2/search"

        response = requests.get(url, params=params)
        if response.status_code == 200:
            self._increment_usage(api)
            return response.json()
        else:
            raise Exception(f"Error en {api}: {response.text}")
    
    def get_patent_details(self, patent_id: str) -> dict:
        """Obtiene abstract, claims, description completa de una patente"""
        api = self.get_available_api()
        
        if api == 'serpapi':
            params = {
                "engine": "google_patents",
                "id": patent_id,
                "api_key": self.api_keys[api]
            }
            url = "https://serpapi.com/search.json"
            
            response = requests.get(url, params=params)
            if response.status_code == 200:
                self._increment_usage(api)
                return response.json()
            else:
                raise Exception(f"Error en {api}: {response.text}")
    
    def patent_image_search(self, image_url: str, num_results: int = 10) -> dict:
        """
        Búsqueda de patentes por imagen.
        Primero hace reverse image para keywords, luego busca patentes.
        Cuenta como 2 búsquedas.
        """
        reverse_results = self.reverse_image_search(image_url, num_results=3)
        keywords = " ".join([result.get('title', '') for result in reverse_results.get('image_results', [])[:3]])
        return self.patent_text_search(keywords, num_results)

    # ---------------------------------------------------------
    # TEXT SEARCH METHODS (NEW)
    # ---------------------------------------------------------

    def text_search(self, query):
        """
        Perform a standard text search to check for plagiarism/exact matches.
        Returns top results with title and link.
        """
        api = self.get_available_api()
        
        if api == 'serpapi':
            params = {
                "engine": "google",
                "q": f'"{query}"', # Exact match search
                "api_key": self.api_keys['serpapi'],
                "num": 5 # We only need top results for plagiarism check
            }
            
            try:
                search = GoogleSearch(params)
                results = search.get_dict()
                
                if "error" in results:
                     return {"error": results["error"]}
                
                self._increment_usage(api)
                return results
            except Exception as e:
                return {"error": str(e)}
        
        return {"error": "Zenserp not implemented for text search"}

    def get_usage_status(self) -> dict:
        return self.usage['counts']

# -------------------
# Initialize SearchService Singleton
# -------------------
SERPAPI_KEY = '18d0a89227e075bb1903ccf7453caff6205dc390687411edda0319d7066f58d0'
ZENSERP_KEY = 'a9739160-ebe3-11f0-83d4-b9ca31f7dc25'

# Initialize SearchService with hardcoded keys
search_service = SearchService(SERPAPI_KEY, ZENSERP_KEY)
