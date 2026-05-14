import os
import re

CSS_DIR = '/Users/user/Documents/xplagiax_marktrack/static/css'

hex_replacements = {
    '#3b2e6e': '#1e3a8a',
    '#6d28d9': '#1d4ed8',
    '#764ba2': '#2563eb',
    '#7a5af8': '#3b82f6',
    '#7c3aed': '#2563eb',
    '#8b5cf6': '#3b82f6',
    '#9b66e5': '#60a5fa',
    '#9c27b0': '#3b82f6',
    '#a78bfa': '#60a5fa',
    '#a855f7': '#60a5fa',
    '#c084fc': '#93c5fd',
    '#c4b5fd': '#93c5fd',
    '#d8b4fe': '#bfdbfe',
    '#e9d5ff': '#dbeafe',
    '#f3e5f5': '#eff6ff',
}

# Add uppercase variants for safety just in case
hex_cases = {}
for k, v in hex_replacements.items():
    hex_cases[k.upper()] = v
    hex_cases[k.lower()] = v
hex_replacements = hex_cases

rgb_replacements = {
    '109,40,217': '29, 78, 216',
    '113,4,255': '37, 99, 235',
    '118,75,162': '37, 99, 235',
    '124,58,237': '37, 99, 235',
    '139,92,246': '59, 130, 246',
    '155,102,229': '96, 165, 250',
    '156,39,176': '59, 130, 246',
    '167,139,250': '96, 165, 250',
    '168,85,247': '96, 165, 250',
    '190,100,220': '147, 197, 253',
    '220,160,255': '191, 219, 254',
    '223,113,255': '96, 165, 250'
}

rgb_patterns = []
for k, v in rgb_replacements.items():
    r,g,b = k.split(',')
    pattern = re.compile(rf'(rgba?\(\s*{r}\s*,\s*{g}\s*,\s*{b})', re.IGNORECASE)
    def make_repl_func(new_rgb):
        # Closure helper to bind new_rgb properly
        def repl_func(match):
            prefix = match.group(1).split('(')[0]
            return f"{prefix}({new_rgb}"
        return repl_func
    rgb_patterns.append((pattern, make_repl_func(v)))

hex_patterns = []
for hx, tgt in hex_replacements.items():
    pattern = re.compile(rf'(?<![0-9a-fA-F]){hx}(?![0-9a-fA-F])')
    hex_patterns.append((pattern, tgt))

files_changed = 0
total_changes = 0

for root, _, files in os.walk(CSS_DIR):
    for filename in files:
        if filename.endswith('.css'):
            path = os.path.join(root, filename)
            with open(path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            orig_content = content
            
            for pat, tgt in hex_patterns:
                content, count = pat.subn(tgt, content)
                total_changes += count
                
            for pat, func in rgb_patterns:
                content, count = pat.subn(func, content)
                total_changes += count
                
            if content != orig_content:
                files_changed += 1
                with open(path, 'w', encoding='utf-8') as f:
                    f.write(content)

print(f"Refactor complete! Modified {files_changed} files with {total_changes} color replacements.")
