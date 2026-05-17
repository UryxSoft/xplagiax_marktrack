# Internet Paste Detection System — Implementation Plan

## Overview

A production-ready, stealth paste-detection pipeline that silently captures clipboard events in the student editor (`invite.html`), scores the content against an internet-origin heuristic, persists evidence in MySQL, and surfaces rich forensic evidence in the professor's `review.html` panel under the existing **Plagiarism** tab — all without touching any currently-working feature.

---

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────┐
│   invite.html / Quill Editor (Student View)              │
│                                                          │
│  InternetPasteDetector (paste_detector.js)               │
│  ├── 6 intercept layers (Quill module, ClipboardEvent,   │
│  │   beforeinput, document-level, dragdrop, focus-blur)  │
│  ├── HeuristicScorer → internet_copy_score (0–100)       │
│  ├── DocumentSyncWatcher (debounced diff, marks inactive) │
│  └── POST /api/plagiarism/register-paste  ──────────────┐│
└──────────────────────────────────────────────────────────┘│
                                                            │ JSON
┌──────────────────────────────────────────────────────────┐│
│  Backend (Flask)                                         ││
│                                                          ││
│  routes/plagiarism_routes.py                             ││
│  ├── POST /api/plagiarism/register-paste  ←──────────────┘│
│  ├── GET  /api/plagiarism/document/<id>                   │
│  └── POST /api/plagiarism/revalidate                      │
│                                                          │
│  models/paste_evidence.py (PastedInternetContent)        │
│  services/paste_scorer.py                                │
└────────────────────────────────────────────────────────┬─┘
                                                         │ SQL
┌────────────────────────────────────────────────────────▼─┐
│  MySQL — table: pasted_internet_content                  │
│  (id, document_id, user_id, paste_uuid,                  │
│   pasted_text, source_url, source_domain,                │
│   clipboard_html, internet_copy_score, is_active …)      │
└──────────────────────────────────────────────────────────┘
                     ↑ GET evidence
┌──────────────────────────────────────────────────────────┐
│  review.html — Plagiarism tab                            │
│                                                          │
│  review_paste_intel.js                                   │
│  ├── Renders ai-probability gauge (% score)              │
│  ├── Fragment cards (domain, timestamp, score, snippet)  │
│  ├── "Highlight in Document" → temp orange glow 4s       │
│  ├── "Show All" → mass highlight + auto-clear            │
│  └── Glassmorphism tooltip on hover (Floating UI)        │
└──────────────────────────────────────────────────────────┘
```

---

## User Review Required

> [!IMPORTANT]
> **Stealth mode in `invite.html`** — The detector runs silently. No UI badge, alert, or indicator is shown to the student at any point. All detection is invisible.

> [!IMPORTANT]
> **SQLite vs MySQL** — The DB file `instance/documents.db` is a SQLite database (confirmed from the directory listing). The models use `db.create_all()` style. I will add the new model to `models/models.py` and rely on `db.create_all()` to create the table. No Alembic migration file will be generated unless you have Alembic configured. Please confirm if you need a migration script.

> [!WARNING]
> **No external API calls** — The internet-copy score is fully heuristic (clipboard HTML analysis, URL presence, length, formatting patterns). This avoids latency and cost. Real similarity search (e.g., Google SERP API) can be added later as an optional layer.

---

## Open Questions

> [!NOTE]
> 1. Do you want the `PastedInternetContent` table created via `db.create_all()` (automatic on server restart) or a manual `flask db migrate` Alembic migration?
> 2. Should the "Highlight in Document" feature scroll to the text in the read-only Quill editor on `review.html`, or only highlight?
> 3. Is Floating UI (npm) available, or should I use a pure vanilla tooltip implementation (no CDN dependency)?

---

## Proposed Changes

### Backend — New Model

#### [MODIFY] [models.py](file:///Users/user/Documents/xplagiax_marktrack/models/models.py)

Add `PastedInternetContent` model at the bottom of `models/models.py`:

```python
class PastedInternetContent(db.Model):
    __tablename__ = 'pasted_internet_content'
    id = db.Column(db.Integer, primary_key=True)
    document_id = db.Column(db.Integer, db.ForeignKey('marktrack_documents.id'), nullable=False, index=True)
    user_id     = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    student_id  = db.Column(db.Integer, db.ForeignKey('student_workspace_users.id'), nullable=True)
    paste_uuid  = db.Column(db.String(36), unique=True, nullable=False)
    pasted_text = db.Column(db.Text, nullable=False)
    source_url  = db.Column(db.String(2048), nullable=True)
    source_domain = db.Column(db.String(255), nullable=True)
    clipboard_html = db.Column(db.Text, nullable=True)    # Sanitized HTML from clipboard
    internet_copy_score = db.Column(db.Integer, default=0)  # 0–100
    char_count  = db.Column(db.Integer, default=0)
    is_active   = db.Column(db.Boolean, default=True)     # False if text removed from doc
    is_removed  = db.Column(db.Boolean, default=False)
    created_at  = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at  = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    # Indexes
    __table_args__ = (
        Index('idx_pic_document', 'document_id'),
        Index('idx_pic_student',  'student_id'),
        Index('idx_pic_active',   'is_active'),
    )
```

---

### Backend — New Blueprint

#### [NEW] [plagiarism_routes.py](file:///Users/user/Documents/xplagiax_marktrack/routes/plagiarism_routes.py)

Three endpoints:

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/plagiarism/register-paste` | Accept paste evidence from student editor |
| `GET`  | `/api/plagiarism/document/<doc_id>` | Fetch all active evidence for professor |
| `POST` | `/api/plagiarism/revalidate` | Mark fragments inactive if text is gone |

---

### Backend — Heuristic Scorer Service

#### [NEW] [services/paste_scorer.py](file:///Users/user/Documents/xplagiax_marktrack/services/paste_scorer.py)

Pure Python, no external calls. Scores clipboard data on signals:

| Signal | Weight | Description |
|--------|--------|-------------|
| `text/html` present | +25 | Browser-formatted HTML in clipboard |
| `<a href>` tags | +20 | Hyperlinks = from web page |
| Source URLs detected | +25 | `http://` in HTML |
| `<cite>`, `<blockquote>` | +10 | Citation markup |
| Length > 300 chars | +10 | Unlikely manual typing burst |
| Tracking params (`utm_`, `ref=`) | +10 | Web article URL params |

Score capped at 100. Threshold: `< 30` skips recording.

---

### Frontend — invite.html Paste Detector

#### [NEW] [static/js/paste_detector.js](file:///Users/user/Documents/xplagiax_marktrack/static/js/paste_detector.js)

Module: `InternetPasteDetector`

**6-layer intercept system:**
1. `Quill.imports['modules/clipboard']` override — highest priority, sees raw clipboard before Quill processing
2. `quill.root.addEventListener('paste', ...)` — catches standard paste
3. `document.addEventListener('paste', ...)` — fallback for all events
4. `document.addEventListener('beforeinput', e => e.inputType === 'insertFromPaste')` — anti-bypass
5. `quill.on('text-change', ...)` — delta analysis: single large insert = likely paste
6. `dragstart`/`drop` monitoring on editor root

**DocumentSyncWatcher:**
- After each `text-change` event (debounced 3s), diffs current text against stored paste snippets
- If a stored snippet no longer appears in the document text: `POST /api/plagiarism/revalidate` → marks `is_active = false`
- Uses `String.includes()` check — efficient, no regex overhead for large docs

**Stealth policy:** No console logs with user-visible strings, no UI changes. Uses `console.debug` only.

---

### Frontend — invite.html Integration

#### [MODIFY] [templates/invite.html](file:///Users/user/Documents/xplagiax_marktrack/templates/invite.html)

Add at bottom, after all existing scripts:
```html
<script src="{{ url_for('static', filename='js/paste_detector.js') }}"></script>
```

One script tag. No other HTML changes. No student-visible UI.

---

### Frontend — review.html Plagiarism Tab

#### [MODIFY] [templates/review.html](file:///Users/user/Documents/xplagiax_marktrack/templates/review.html)

Replace the placeholder Plagiarism tab content (lines 494–512) with:
- Dynamic `ai-probability` gauge showing aggregate internet-copy score
- Fragment list container `#pasteFragmentsList`
- "Show All Pasted Content" button

#### [NEW] [static/js/pages/review_paste_intel.js](file:///Users/user/Documents/xplagiax_marktrack/static/js/pages/review_paste_intel.js)

Loaded in `review.html`. Responsibilities:
- `loadPasteEvidence(documentId)` — called when **Plagiarism** tab is clicked
- Renders score gauge using existing `.ai-probability` + `.circular-progress` SVG pattern
- Renders fragment cards with domain, timestamp, snippet, score badge
- `highlightFragment(text, duration=4000)` — finds text in Quill pages, wraps in temporary `<span>` with orange glow, auto-removes after timeout
- `showAllFragments()` — calls `highlightFragment` on each with 200ms stagger
- Vanilla glassmorphism tooltip on fragment card hover (no external library)

---

### Register Blueprint

#### [MODIFY] [app.py](file:///Users/user/Documents/xplagiax_marktrack/app.py)

Add 3 lines:
```python
from routes.plagiarism_routes import plagiarism_bp
app.register_blueprint(plagiarism_bp)
csrf.exempt(plagiarism_bp)
```

---

## File Delivery Order

1. `models/models.py` — add model (+ `db.create_all()` trigger)
2. `services/paste_scorer.py` — pure Python scorer
3. `routes/plagiarism_routes.py` — Flask blueprint
4. `app.py` — register blueprint
5. `static/js/paste_detector.js` — 6-layer frontend detector
6. `templates/invite.html` — add script tag
7. `templates/review.html` — replace plagiarism tab HTML
8. `static/js/pages/review_paste_intel.js` — review panel logic
9. `static/css/paste_intel.css` — styles for fragment cards + tooltip

---

## Verification Plan

### Automated checks
- `python -m py_compile routes/plagiarism_routes.py` — syntax check
- `python -m py_compile models/models.py` — model syntax
- `curl` test on `/api/plagiarism/document/<id>` — returns 200 with correct JSON structure

### Manual Verification
1. Open `invite.html` for a real workspace invitation
2. Copy a block of text from a web browser (e.g. Wikipedia)
3. Paste into the editor — verify no student-visible change occurs
4. Check DB: `SELECT * FROM pasted_internet_content ORDER BY created_at DESC LIMIT 5;`
5. Open professor `review.html` for that document
6. Click Plagiarism tab → verify gauge + fragment cards load
7. Click "Highlight in Document" → verify temporary orange highlight appears and fades

---

## Edge Cases Handled

| Scenario | Handling |
|----------|----------|
| Score < 30 (low-risk) | Not persisted, silently discarded |
| Student deletes pasted text | `DocumentSyncWatcher` marks `is_active=False` |
| Duplicate pastes of same text | `paste_uuid` (uuid4) prevents true duplicates at row level; dedup by text hash at service layer |
| OAuth/non-logged user (student) | Uses `student_id` FK instead of `user_id` |
| Empty clipboard | Guard check before scoring |
| Malicious HTML in clipboard | `bleach`-style tag whitelist sanitizer before storage |
| XSS in fragment display | `textContent` rendering in JS, never `innerHTML` for untrusted content |
| Rate abuse | Route limited to 20 req/min per IP |
| Very large paste (>50KB) | Truncated to 10,000 chars before storage |
