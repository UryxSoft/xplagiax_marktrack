# Walkthrough — Flask Routes + CSS Extraction

## Changes Made

### 1. CSS Extracted → [static/css/home_base.css](file:///Users/user/Documents/xplagiax_marktrack/static/css/home_base.css)
2,737 lines of inline CSS moved from `<style>` in [home_base.html](file:///Users/user/Documents/xplagiax_marktrack/templates/home_base.html) to [home_base.css](file:///Users/user/Documents/xplagiax_marktrack/static/css/home_base.css). Loaded via:
```html
<link rel="stylesheet" href="{{ url_for('static', filename='css/home_base.css') }}">
```

### 2. Base Template — `{% block view_content %}`
[home_base.html](file:///Users/user/Documents/xplagiax_marktrack/templates/home_base.html) (2,403 lines) now has a single `{% block view_content %}{% endblock %}` at line 105 where child templates inject their content.

### 3. Section Files → `{% extends %}`
Each section wraps its content with template inheritance:

| File | Route | Template |
|---|---|---|
| [home.html](file:///Users/user/Documents/xplagiax_marktrack/templates/sections/home.html) | `/` , `/home` | `{% extends 'home_base.html' %}` |
| [analytics.html](file:///Users/user/Documents/xplagiax_marktrack/templates/sections/analytics.html) | `/analytics` | `{% extends 'home_base.html' %}` |
| [almacenamiento.html](file:///Users/user/Documents/xplagiax_marktrack/templates/sections/almacenamiento.html) | `/almacenamiento` | `{% extends 'home_base.html' %}` |
| [workspace.html](file:///Users/user/Documents/xplagiax_marktrack/templates/sections/workspace.html) | `/workspace` | `{% extends 'home_base.html' %}` |

### 4. Flask Routes Added
[users_routes.py](file:///Users/user/Documents/xplagiax_marktrack/routes/users_routes.py) — 4 routes, all `@login_required`:

```python
@users_bp.route('/')
@users_bp.route('/home')     → sections/home.html
@users_bp.route('/analytics')     → sections/analytics.html
@users_bp.route('/almacenamiento') → sections/almacenamiento.html
@users_bp.route('/workspace')     → sections/workspace.html
```

## Verification
- ✅ All 4 section files have `{% extends %}` at top and `{% endblock %}` at bottom
- ✅ `home_base.html` has `<link>` to CSS and `{% block view_content %}`
- ✅ CSS file exists at `static/css/home_base.css` (2,737 lines)

> [!TIP]
> Reinicia Flask para que tome los cambios. Visita `/`, `/analytics`, `/almacenamiento`, `/workspace`.
