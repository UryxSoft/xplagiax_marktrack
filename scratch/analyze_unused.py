import os
import ast
import re

IGNORE_DIRS = {'venv_py311', '.git', '__pycache__', 'scratch', 'tmp', 'docker', 'instance', '.pytest_cache', '.vscode', '.claude'}
ROOT_DIR = '.'

def scan_files():
    py_files = []
    html_files = []
    static_files = []
    for dirpath, dirnames, filenames in os.walk(ROOT_DIR):
        dirnames[:] = [d for d in dirnames if d not in IGNORE_DIRS]
        for f in filenames:
            full_path = os.path.join(dirpath, f)
            if f.endswith('.py'):
                py_files.append(full_path)
            elif f.endswith('.html'):
                html_files.append(full_path)
            elif 'static' in dirpath and not f.startswith('.'):
                static_files.append(full_path)
    return py_files, html_files, static_files

def get_py_module_name(filepath):
    # e.g. ./routes/auth.py -> routes.auth
    rel_path = os.path.relpath(filepath, ROOT_DIR)
    if rel_path.endswith('.py'):
        rel_path = rel_path[:-3]
    if rel_path.endswith('/__init__'):
        rel_path = rel_path[:-9]
    return rel_path.replace(os.sep, '.')

def get_imported_modules(py_files):
    imported = set()
    for fp in py_files:
        try:
            with open(fp, 'r', encoding='utf-8') as f:
                content = f.read()
            tree = ast.parse(content)
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    for alias in node.names:
                        imported.add(alias.name.split('.')[0])
                elif isinstance(node, ast.ImportFrom):
                    if node.module:
                        imported.add(node.module.split('.')[0])
                        # Also add full path like routes.auth
                        imported.add(node.module)
        except Exception as e:
            # Maybe syntax error or similar, fallback to regex
            pass
    return imported

def get_rendered_templates(py_files, html_files):
    templates = set()
    # Find render_template in py
    for fp in py_files:
        try:
            with open(fp, 'r', encoding='utf-8') as f:
                content = f.read()
            # Simple regex for render_template('something.html')
            matches = re.findall(r"""render_template\(['"]([^'"]+)['"]""", content)
            templates.update(matches)
        except:
            pass
            
    # Find {% include '...' %} and {% extends '...' %} in html apps
    for fp in html_files:
        try:
            with open(fp, 'r', encoding='utf-8') as f:
                content = f.read()
            matches = re.findall(r"""\{%\s*(?:include|extends)\s+['"]([^'"]+)['"]\s*%\}""", content)
            templates.update(matches)
        except:
            pass
    return templates

def get_referenced_static(py_files, html_files):
    static_refs = set()
    regexes = [
        r"""url_for\(['"]static['"]\s*,\s*filename=['"]([^'"]+)['"]""",
        r"""src=['"](/static/[^'"]+)['"]""",
        r"""href=['"](/static/[^'"]+)['"]"""
    ]
    
    for fp in (py_files + html_files):
        try:
            with open(fp, 'r', encoding='utf-8') as f:
                content = f.read()
            for r in regexes:
                matches = re.findall(r, content)
                for m in matches:
                    if m.startswith('/static/'):
                        static_refs.add(m.replace('/static/', '', 1))
                    else:
                        static_refs.add(m)
        except:
            pass
    return static_refs
    
def main():
    py_files, html_files, static_files = scan_files()
    
    imported_modules = get_imported_modules(py_files)
    
    print("--- UNUSED PYTHON FILES (Approx) ---")
    entry_points = ['app.py', 'main.py', 'run.py', 'manage.py']
    for fp in py_files:
        basename = os.path.basename(fp)
        if basename in entry_points or basename == '__init__.py' or 'tests' in fp:
            continue
        mod_name = get_py_module_name(fp)
        # Check if the module or its top-level package is imported
        top_pkg = mod_name.split('.')[0]
        if mod_name not in imported_modules and top_pkg not in imported_modules:
            print(f"Potentially Unused: {fp} (Module: {mod_name})")
            
    print("\n--- UNUSED TEMPLATES (Approx) ---")
    rendered = get_rendered_templates(py_files, html_files)
    for fp in html_files:
        rel_path = os.path.relpath(fp, os.path.join(ROOT_DIR, 'templates'))
        if rel_path.startswith('..'): 
            continue # not in templates directory
        if rel_path not in rendered:
            print(f"Potentially Unused Template: {rel_path} ({fp})")

    print("\n--- UNUSED STATIC FILES (Approx) ---")
    refs = get_referenced_static(py_files, html_files)
    for fp in static_files:
        if '/static/libs/' in fp or '/static/vendor/' in fp:
             continue # Ignore third party libs
        rel_path = os.path.relpath(fp, os.path.join(ROOT_DIR, 'static'))
        if rel_path.startswith('..'):
            continue
        if rel_path not in refs:
            print(f"Potentially Unused Static: {rel_path} ({fp})")

if __name__ == '__main__':
    main()
