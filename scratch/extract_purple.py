import os
import re
import colorsys

def hex_to_rgb(h):
    h = h.lstrip('#')
    if len(h) == 3:
        h = ''.join([c*2 for c in h])
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

def rgb_to_hsl(r, g, b):
    h, l, s = colorsys.rgb_to_hls(r/255.0, g/255.0, b/255.0)
    return (h*360, s*100, l*100)

def is_purple(h, s, l):
    # Purple/violet hue is roughly between 250 and 320
    # Also ignore very low saturation (grays) and extreme lightness (black/white)
    if 250 <= h <= 320 and s > 15 and 5 < l < 95:
        return True
    return False

css_files = []
for root, dirs, files in os.walk('static/css'):
    for f in files:
        if f.endswith('.css'):
            css_files.append(os.path.join(root, f))

# Regex for hex colors
hex_pattern = re.compile(r'#(?:[0-9a-fA-F]{3}){1,2}\b')
rgb_pattern = re.compile(r'rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)')

found_purples = set()

for path in css_files:
    with open(path, 'r', encoding='utf-8') as file:
        lines = file.readlines()
        for i, line in enumerate(lines):
            # Check Hex
            for hx in hex_pattern.findall(line):
                r, g, b = hex_to_rgb(hx)
                h, s, l = rgb_to_hsl(r, g, b)
                if is_purple(h, s, l):
                    found_purples.add((hx.lower(), f"rgb({r},{g},{b})", round(h), path.replace('static/css/', ''), i+1, line.strip()))
            
            # Check RGB/A
            for m in rgb_pattern.findall(line):
                r, g, b = map(int, m)
                h, s, l = rgb_to_hsl(r, g, b)
                if is_purple(h, s, l):
                    found_purples.add((f"rgb({r},{g},{b})", f"rgb({r},{g},{b})", round(h), path.replace('static/css/', ''), i+1, line.strip()))

# Output results grouped by color
color_map = {}
for p in found_purples:
    color = p[0]
    if color not in color_map:
        color_map[color] = []
    color_map[color].append(p)

for c in sorted(color_map.keys()):
    print(f"\nColor: {c}")
    for p in color_map[c]:
         print(f"  - {p[3]}:{p[4]}")
