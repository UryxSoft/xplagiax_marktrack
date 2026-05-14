# XplagiaX MarkTrack
> **The Enterprise Ecosystem for Collaborative Academic Integrity** | **El Ecosistema Empresarial para la Integridad Académica Colaborativa**

[![Python 3.12](https://img.shields.io/badge/Python-3.12-blue.svg)](https://www.python.org/)
[![Flask 3.0](https://img.shields.io/badge/Flask-3.0-green.svg)](https://flask.palletsprojects.com/)
[![License MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Docker Ready](https://img.shields.io/badge/Docker-Ready-blue.svg)](#)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-RealTime-orange.svg)](#)

---

## 🌍 1. Executive Summary / Resumen Ejecutivo

**[EN]** XplagiaX MarkTrack is a PhD-grade collaborative document platform engineered for the intersection of high-stakes academia and enterprise-level security. It provides a real-time, conflict-free editing environment (powered by CRDTs) paired with a robust "Dark Glass" UI. Designed for extreme scalability, it leverages an asynchronous Eventlet-based architecture to handle thousands of concurrent state updates with sub-millisecond latency.

**[ES]** XplagiaX MarkTrack es una plataforma de documentos colaborativos de nivel PhD diseñada para la intersección de la academia de alto nivel y la seguridad de nivel empresarial. Proporciona un entorno de edición en tiempo real sin conflictos (basado en CRDT) junto con una robusta interfaz "Dark Glass". Diseñada para una escalabilidad extrema, aprovecha una arquitectura asíncrona basada en Eventlet para manejar miles de actualizaciones de estado concurrentes con latencia de submilisegundos.

---

## 🏗️ 2. Architectural Philosophy / Filosofía Arquitectónica

### 2.1 Technical Topology / Topología Técnica
```mermaid
graph TD
    subgraph "Frontend Layer (Dark Glass V3)"
        UI[Quill.js v2 / Custom JS]
        WS_Client[Socket.IO Client]
        Yjs[Yjs CRDT Engine]
    end

    subgraph "Ingress & Concurrency"
        LB[Nginx / Reverse Proxy]
        Gunicorn[Gunicorn + Eventlet Workers]
    end

    subgraph "Application Logic (Blueprints)"
        Auth[Auth / Identity Service]
        Doc[Document Engine]
        Metrics[AI Integrity Analytics]
        Sync[Storage Sync Worker]
    end

    subgraph "Scalable Persistence"
        ProxySQL[ProxySQL / Conn Pool]
        MySQL[(MySQL 8.0 Primary)]
        Redis[(Redis 7.2 Hot Cache)]
        SFS[(SeaweedFS / S3 Storage)]
    end

    UI <-->|HTTPS| LB
    WS_Client <-->|WSS| LB
    LB <--> Gunicorn
    Gunicorn <--> Auth
    Gunicorn <--> Doc
    
    Doc <--> Redis
    Doc --> ProxySQL
    ProxySQL --> MySQL
    Sync --> SFS
```

---

## 🔄 3. Detailed Service Lifecycles / Ciclos de Vida de Servicios

### 3.1 Global Security Middleware Flow
**[EN]** Every incoming request undergoes a strict security audit before reaching the route logic.
**[ES]** Cada solicitud entrante se somete a una auditoría de seguridad estricta antes de llegar a la lógica de la ruta.

```mermaid
graph TD
    A[Incoming Request] --> B{Is Authenticated?}
    B -- No --> C[Redirect to /login]
    B -- Yes --> D{Session Token Valid?}
    D -- No --> E[Clear Session & Force Logout]
    D -- Yes --> F{CSRF Header Present?}
    F -- No --> G[Reject 403 Forbidden]
    F -- Yes --> H[Proceed to Route Logic]
    H --> I[Execute Blueprint Logic]
```

### 3.2 Authentication Lifecycle (OAuth2/OIDC)
```mermaid
sequenceDiagram
    participant User as End User
    participant App as MarkTrack (Flask)
    participant Provider as Google/Microsoft IDP
    participant DB as MySQL User Store

    User->>App: Click "Login with Google"
    App->>App: Generate State Token & Store in Session
    App->>Provider: Redirect to Auth URL (with state)
    Provider->>User: Consent Screen
    User->>Provider: Authorize
    Provider->>App: Callback with Code & State
    App->>App: Validate State against Session
    App->>Provider: Exchange Code for Access Token
    Provider->>App: User Profile Data
    App->>DB: Find/Create User record
    App->>App: Initialize Flask-Login Session
    App->>User: Redirect to /home
```

### 3.3 Real-Time Notification Dispatch Engine
```mermaid
sequenceDiagram
    participant S as Trigger Service (Comments/Docs)
    participant NS as NotificationService (Core)
    participant DB as MySQL Persistent Store
    participant SIO as Socket.IO (Real-Time)
    participant M as Flask-Mail (Async)

    S->>NS: Trigger Event (e.g., CommentAdded)
    NS->>DB: Store Notification Object
    par Real-Time Broadcast
        NS->>SIO: Emit to user_{id} or student_{id} room
    and Email Dispatch
        NS->>M: Send Template-based HTML Email
    end
    SIO-->>NS: Deliver Confirmation
```

### 3.4 Document Export & Hybrid Storage Flow
```mermaid
graph LR
    A[Export Request] --> B{Format: PDF/DOCX?}
    B --> C[Fetch authoritative Delta from DB]
    C --> D[Render HTML Template via Jinja2]
    D --> E[WeasyPrint PDF Engine]
    E --> F[Generate Binary Stream]
    F --> G{File Size > 1MB?}
    G -- Yes --> H[Stream to SeaweedFS S3]
    G -- No --> I[Store as MySQL BLOB]
    H --> J[Return Signed Link]
    I --> J
```

### 3.5 Real-Time CRDT Pipeline (Redis-to-MySQL)
```mermaid
graph LR
    A[Collaborator A] -->|Update| B(Socket.IO)
    C[Collaborator B] -->|Update| B
    B -->|Broadcast| A
    B -->|Broadcast| C
    B -->|RPUSH| D[Redis yjs:state:id]
    B -->|INCR| E[Redis yjs:dirty:id]
    E -->|Threshold = 50| F{Sync Worker}
    F -->|Merge Deltas| G[Yjs Engine]
    G -->|Commit| H[(MySQL BLOB)]
    H -->|Clear| D
```

### 3.6 Forensic Metrics Ingestion Pipeline
```mermaid
graph TD
    A[Frontend: typing-metrics.js] -->|Debounced POST| B[metrics_bp API]
    B --> C{Invitation Token Valid?}
    C -- No --> D[Log Security Incident & Reject]
    C -- Yes --> E[Fetch existing record in MySQL]
    E --> F{Record exists?}
    F -- Yes --> G[Merge Incremental ABM via max()]
    F -- No --> H[Create new Forensic Record]
    G --> I[Update Totals (WPM, Ks, Backspaces)]
    H --> I
    I --> J[Invalidate Redis Detail Cache]
    J --> K[Return Success]
```

### 3.7 Extension Request Workflow (Prórroga)
```mermaid
stateDiagram-v2
    [*] --> Active: Assignment Published
    Active --> Overdue: Deadline Reached
    Active --> ExtensionRequested: Student submits request
    ExtensionRequested --> Approved: Professor Accepts
    ExtensionRequested --> Rejected: Professor Denies
    Approved --> Active: New Deadline Set
    Rejected --> Overdue: Original Deadline Kept
    Active --> Submitted: Student submits document
    Submitted --> [*]
```

---

## 🛣️ 4. Exhaustive Blueprint Ecosystem / Ecosistema Detallado

### 4.1 Core Blueprints / Blueprints Principales
| Blueprint | Domain | Responsibility (EN) | Responsabilidad (ES) |
| :--- | :--- | :--- | :--- |
| `auth_bp` | Identity | OAuth2 (Google/Microsoft), session logic. | Identidad OAuth2, lógica de sesión. |
| `document_bp`| Documents | CRUD operations, hybrid persistence. | Operaciones CRUD, persistencia híbrida. |
| `share_bp` | Sharing | Permission management, UUID sharing. | Gestión de permisos, compartición UUID. |
| `workspace_bp`| Workspace | Professor-student relationship. | Relación profesor-estudiante. |

### 4.2 Collaborative & Social Blueprints
| Blueprint | Domain | Responsibility (EN) | Responsabilidad (ES) |
| :--- | :--- | :--- | :--- |
| `collaborators`| Real-time | Socket.IO room management & Yjs sync. | Gestión de salas Socket.IO y sincronización. |
| `comments_bp` | Interaction | Inline comments and thread notifications. | Comentarios inline y notificaciones. |
| `notifications`| Feedback | In-app alerts and activity tracking. | Alertas in-app y seguimiento. |

---

## 🛡️ 5. Security & Forensic Architecture / Seguridad y Arquitectura Forense

### 5.1 Academic Integrity Telemetry
**[EN]** MarkTrack analyzes the "Cognitive Rhythm" of writing using high-fidelity metrics:
*   **WPM Analysis**: Detects content bursts indicative of unauthorized copy-pasting.
*   **Keystroke Dynamics**: Tracks `avg_hold_ms` and `avg_interkey_ms` to verify authorship.
*   **Incremental Ingestion**: Uses `max()` merging for activity-by-minute data from fragmented sessions.

### 5.2 Anti-IDOR & Token Protection
**[EN]** Secure review views are protected via **Secure Token Wrapping** (`itsdangerous`). Direct resource IDs are never exposed; a signed payload with a 24h TTL is validated upon every request.

---

## 📊 6. Database Schema & Persistence / Esquema de Datos

### 6.1 Authoritative Entities
*   **`users`**: Identity provider status, active session tokens, and account tier limits.
*   **`documents`**: Central asset. Stores Quill Delta (JSON), Yjs State (BLOB), and Storage Type metadata.
*   **`document_share`**: Permission matrix (Viewer, Editor, Admin) with TTL logic.
*   **`essay_submission_metrics`**: Forensic audit logs, typing bursts, and digital signature.

---

## ⚙️ 7. Settings & Configuration Matrix / Matriz de Configuración

### 7.1 Redis Partitioning Strategy
| DB Index | Component | Responsibility |
| :--- | :--- | :--- |
| `0` | **Flask-Caching** | Hot cache for metadata and templates. |
| `1` | **App Logic** | Rate limiting, distributed locks, and session tokens. |
| `2` | **SocketIO** | Async message queue for Eventlet workers. |
| `3` | **Dogpile** | Result-set caching for ORM layer. |

---

## 🚀 8. Setup & Operations / Instalación y Operaciones

**[EN]**
```bash
# 1. Environment
cp .env.example .env
docker compose up -d

# 2. Virtualenv
python3.12 -m venv venv && source venv/bin/activate
pip install -r requirements.txt

# 3. Initialization
flask db upgrade
python app.py
```

---

## 🗺️ 9. Roadmap / Hoja de Ruta

*   **Q3 2026**: Integration with Gemini Pro for pedagogical feedback.
*   **Q4 2026**: High-fidelity PDF annotations and peer-review workflows.
*   **Q1 2027**: Enterprise SAML/SSO for global university clusters.

---

## ⚖️ 10. License & Credits / Licencia y Créditos

© 2026 UryxSoft. MIT Licensed.
*Special thanks to the open-source communities behind Yjs, Quill, and Flask.*
