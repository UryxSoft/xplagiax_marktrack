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
```mermaid
graph TD
    A[Incoming Request] --> B{Is Authenticated?}
    B -- No --> C[Redirect to /login]
    B -- Yes --> D{Session Token Valid?}
    D -- No --> E[Clear Session & Force Logout]
    D -- Yes --> F{CSRF Header Present?}
    F -- No --> G[Reject 403 Forbidden]
    F -- Yes --> H["Proceed to Route Logic"]
    H --> I["Execute Blueprint Logic"]
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
    A[Collaborator A] -->|Update| B("Socket.IO")
    C[Collaborator B] -->|Update| B
    B -->|Broadcast| A
    B -->|Broadcast| C
    B -->|RPUSH| D[Redis yjs:state:id]
    B -->|INCR| E[Redis yjs:dirty:id]
    E -->|Threshold = 50| F{Sync Worker}
    F -->|Merge Deltas| G[Yjs Engine]
    G -->|Commit| H["(MySQL BLOB)"]
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
    F -- Yes --> G["Merge Incremental ABM via max()"]
    F -- No --> H[Create new Forensic Record]
    G --> I["Update Totals (WPM, Ks, Backspaces)"]
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

### 3.8 Workspace Invitation & Admission Flow
```mermaid
graph TD
    A[Professor: Create Workspace] --> B[Generate 32-char Secure Token]
    B --> C["Store Invitation Record (status=pending)"]
    C --> D["Dispatch Professional Email via Flask-Mail"]
    D --> E["Student: Clicks link /invite/{token}"]
    E --> F{Is Student Logged in?}
    F -- No --> G["Redirect to /homework Login/Register"]
    F -- Yes --> H{Is email match?}
    H -- No --> I[Show Authorization Error]
    H -- Yes --> J[Grant Access to Workspace Document]
    J --> K["Mark Invitation status=active"]
```

### 3.9 Recursive Folder Deletion Logic
```mermaid
graph TD
    A[User: Delete Folder] --> B{Is Folder Empty?}
    B -- No --> C[Recursive traversal of Subfolders]
    B -- Yes --> D[Flag Documents for Batch Deletion]
    C --> D
    D --> E[Check SeaweedFS for S3-linked assets]
    E --> F[Remove Metadata from MySQL]
    F --> G[Invalidate Folder Cache Keys]
    G --> H[Return Success]
```

### 3.10 Socket.IO Awareness (Cursor Tracking)
```mermaid
sequenceDiagram
    participant C as Client A
    participant S as Socket.IO Server
    participant R as Redis (Ephemeral)
    participant O as Client B (Peer)

    C->>S: doc:cursor (x, y, color)
    S->>R: SET awareness:{doc_id}:{user_id} TTL 30s
    S->>O: doc:awareness_update (Peer Data)
    O->>O: Render remote cursor bubble
```

---

## 🛡️ 4. Security & Forensic Architecture / Seguridad y Arquitectura Forense

### 4.1 Academic Integrity Telemetry
**[EN]** MarkTrack analyzes the "Cognitive Rhythm" of writing using high-fidelity metrics:
*   **WPM Analysis**: Detects content bursts indicative of unauthorized copy-pasting.
*   **Keystroke Dynamics**: Tracks `avg_hold_ms` and `avg_interkey_ms` to verify authorship.
*   **Incremental Ingestion**: Uses `max()` merging for activity-by-minute data from fragmented sessions.

---

## ⚙️ 5. Settings & Configuration Matrix / Matriz de Configuración

### 5.1 Redis Partitioning Strategy
| DB Index | Component | Responsibility |
| :--- | :--- | :--- |
| `0` | **Flask-Caching** | Hot cache for metadata and templates. |
| `1` | **App Logic** | Rate limiting, distributed locks, and session tokens. |
| `2` | **SocketIO** | Async message queue for Eventlet workers. |
| `3` | **Dogpile** | Result-set caching for ORM layer. |

---

## 🛠️ 6. Maintenance & Production Ops / Mantenimiento y Operaciones

### 6.1 Gunicorn + Eventlet Formulas
**[EN]** Recommended configuration for 1,000+ concurrent users:
```bash
gunicorn -k eventlet -w 9 --threads 2 --bind 0.0.0.0:5002 app:app
```

### 6.2 Docker Deployment Guide / Guía de Despliegue en Docker

This section describes how to compile, configure, and launch the enterprise-grade production container under the custom Docker bridged network `xplagiax-net` on your Debian host server.
*Esta sección detalla cómo compilar, configurar y lanzar el contenedor de producción de grado empresarial bajo la red Docker personalizada `xplagiax-net` en tu servidor Debian.*

---

#### 🐳 6.2.1 Building the Docker Image / Construcción de la Imagen
**[EN]** Build the runtime image from the root workspace directory:
```bash
docker build -t xplagiax/marktrack:latest .
```
**[ES]** Construye la imagen de producción desde el directorio raíz del proyecto:
```bash
docker build -t xplagiax/marktrack:latest .
```

---

#### 📄 6.2.2 The Environment Configuration Template (.env) / Configuración del Entorno (.env)
**[EN]** Create a plain text file named `.env` in your project root on the production server (this file is excluded from Git to prevent exposing credentials).
**[ES]** Crea un archivo de texto plano llamado `.env` en la raíz de tu proyecto en el servidor de producción (este archivo se encuentra en `.gitignore` para salvaguardar contraseñas y claves).

```env
# ── CONFIGURACIÓN DE LA APLICACIÓN ──────────────────────────────────────
FLASK_ENV=production
SECRET_KEY=1112821092c444e178ebb4fc5ce9f0245e29ee656b5284db3613cf6941ac447c
SECURITY_PASSWORD_SALT=1c3485c42a4e751ea2e4c48db6687f9a6d5e5c7b40f145b215b8bd8c5db806c3

# ── URLS DE PRODUCCIÓN ──────────────────────────────────────────────────
APP_BASE_URL=https://marktrack.xplagiax.ca
GOOGLE_REDIRECT_URI=https://marktrack.xplagiax.ca/auth_bp/google/callbackx
MICROSOFT_REDIRECT_URI=https://marktrack.xplagiax.ca/auth_bp/microsoft/callback

# ── APIS DE TERCEROS ────────────────────────────────────────────────────
GEMINI_API_KEY=tu_api_key_real_aqui_para_deteccion_de_plagio
XPLAGIAX_URL=http://xplagiax-xota:5006/analyze_document
IMAGE_SVC_URL=http://xplagiax_image_service:5010

# ── SERVIDOR DE CORREO (SMTP) ───────────────────────────────────────────
MAIL_USERNAME=noreply@XplagiaX.ca
MAIL_PASSWORD=MYR1xkd2kqc_gat2hem

# ── BASE DE DATOS (mysql/proxysql) ──────────────────────────────────────
MYSQL_ROOT_PASSWORD=xplagiax001
MYSQL_DATABASE=xplagiax_db
MYSQL_USER=marktrack
MYSQL_PASSWORD=xplagiax001
DATABASE_URL=mysql+mysqldb://xplagiaxadminuser:xplagiax001@mysql-container:3306/xplagiax_db?charset=utf8mb4

# ── CACHÉ Y COLAS (redis) ────────────────────────────────────────────────
REDIS_URL=redis://redis:6379

# ── ALMACENAMIENTO DE ARCHIVOS (seaweedfs) ──────────────────────────────
SEAWEEDFS_FILER_URL=seaweedfs-filer:8888
SEAWEEDFS_MASTER_URL=seaweedfs-master:9333
SEAWEEDFS_SECURE=false
```

---

#### 🏃‍♂️ 6.2.3 Running the Container / Ejecución del Contenedor (docker run)
**[EN]** Launch the container on the custom `xplagiax-net` network with all environment variables fully inline:
**[ES]** Lanza el contenedor de producción en la red virtual `xplagiax-net` con todas las variables de entorno especificadas:

```bash
docker run -d \
  --name marktrack_app \
  --network xplagiax-net \
  --restart unless-stopped \
  -p 5002:5002 \
  -e FLASK_ENV="production" \
  -e SECRET_KEY="1112821092c444e178ebb4fc5ce9f0245e29ee656b5284db3613cf6941ac447c" \
  -e SECURITY_PASSWORD_SALT="1c3485c42a4e751ea2e4c48db6687f9a6d5e5c7b40f145b215b8bd8c5db806c3" \
  -e APP_BASE_URL="https://marktrack.xplagiax.ca" \
  -e GOOGLE_REDIRECT_URI="https://marktrack.xplagiax.ca/auth_bp/google/callbackx" \
  -e MICROSOFT_REDIRECT_URI="https://marktrack.xplagiax.ca/auth_bp/microsoft/callback" \
  -e GEMINI_API_KEY="tu_api_key_real_aqui_para_deteccion_de_plagio" \
  -e XPLAGIAX_URL="http://xplagiax-xota:5006/analyze_document" \
  -e IMAGE_SVC_URL="http://xplagiax_image_service:5010" \
  -e MAIL_USERNAME="noreply@XplagiaX.ca" \
  -e MAIL_PASSWORD="MYR1xkd2kqc_gat2hem" \
  -e MYSQL_ROOT_PASSWORD="xplagiax001" \
  -e MYSQL_DATABASE="xplagiax_db" \
  -e MYSQL_USER="marktrack" \
  -e MYSQL_PASSWORD="xplagiax001" \
  -e DATABASE_URL="mysql+mysqldb://xplagiaxadminuser:xplagiax001@mysql-container:3306/xplagiax_db?charset=utf8mb4" \
  -e REDIS_URL="redis://redis:6379" \
  -e SEAWEEDFS_FILER_URL="seaweedfs-filer:8888" \
  -e SEAWEEDFS_MASTER_URL="seaweedfs-master:9333" \
  -e SEAWEEDFS_SECURE="false" \
  xplagiax/marktrack:latest
```

##### 🔍 Parameter Breakdown / Desglose de Parámetros:
*   `-d` / `--detach`: Runs the container in background daemon mode. / *Ejecuta en segundo plano.*
*   `--name marktrack_app`: Sets the readable container identifier. / *Nombra la instancia.*
*   `--network xplagiax-net`: Joins the microservices virtual bridge network for seamless hostname DNS resolution. / *Conecta el contenedor a la red virtual del ecosistema.*
*   `--restart unless-stopped`: Standard high-availability process management policy. / *Reinicia el contenedor si falla o si el servidor Debian se reinicia.*
*   `-p 5002:5002`: Binds physical port `5002` to container port `5002`. / *Mapea el puerto host al del contenedor.*

---

#### 📄 6.2.4 Running with the Environment File / Despliegue Simplificado (.env)
**[EN]** For professional environments, place your variables inside `.env` in the active path and run:
**[ES]** Para mayor simplicidad y orden, guarda tus variables en un archivo `.env` en la raíz y ejecuta:

```bash
docker run -d \
  --name marktrack_app \
  --network xplagiax-net \
  --restart unless-stopped \
  -p 5002:5002 \
  --env-file .env \
  xplagiax/marktrack:latest
```

---

#### 📤 6.2.5 Uploading Secrets to Debian (SCP) / Subida de Secretos a Debian (SCP)
**[EN]** Since `.env` is ignored by Git for security, copy it from your local macOS machine to your Debian host:
**[ES]** Dado que `.env` está excluido de Git, súbelo desde tu Mac de desarrollo al servidor de producción:

```bash
# Upload ONLY .env / Subir ÚNICAMENTE .env
scp /Users/user/Documents/xplagiax_marktrack/.env usuario@ip_de_tu_servidor:/ruta/de/despliegue/xplagiax_marktrack/

# Upload entire directory / Subir TODO el directorio
scp -r /Users/user/Documents/xplagiax_marktrack usuario@ip_de_tu_servidor:/ruta/de/despliegue/
```

---

#### 🗄️ 6.2.6 Manual Database Initialization Query / Query Manual de Inicialización MySQL
**[EN]** Run this DDL query inside your `mysql-container` to manually initialize the forensic internet paste tracking table `pasted_internet_content` if needed:
**[ES]** Ejecuta este query DDL dentro de tu contenedor `mysql-container` para inicializar manualmente la tabla de auditoría forense de copiado `pasted_internet_content` si es requerido:

```sql
CREATE TABLE IF NOT EXISTS `pasted_internet_content` (
    `id`                  INT           NOT NULL AUTO_INCREMENT,
    `document_id`         INT           NOT NULL,
    `user_id`             INT           DEFAULT NULL,
    `student_id`          INT           DEFAULT NULL,
    `paste_uuid`          VARCHAR(36)   NOT NULL,
    `pasted_text`         TEXT          NOT NULL,
    `source_url`          VARCHAR(2048) DEFAULT NULL,
    `source_domain`       VARCHAR(255)  DEFAULT NULL,
    `clipboard_html`      TEXT          DEFAULT NULL,
    `internet_copy_score` SMALLINT      NOT NULL DEFAULT 0,
    `char_count`          INT           NOT NULL DEFAULT 0,
    `is_active`           TINYINT(1)    NOT NULL DEFAULT 1,
    `is_removed`          TINYINT(1)    NOT NULL DEFAULT 0,
    `created_at`          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_pic_paste_uuid` (`paste_uuid`),
    KEY `idx_pic_document` (`document_id`),
    KEY `idx_pic_student`  (`student_id`),
    KEY `idx_pic_active`   (`is_active`),
    CONSTRAINT `fk_pic_document` FOREIGN KEY (`document_id`) REFERENCES `marktrack_documents` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_pic_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_pic_student` FOREIGN KEY (`student_id`) REFERENCES `student_workspace_users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

---

## ⚖️ 7. License & Credits / Licencia y Créditos

© 2026 UryxSoft. MIT Licensed.
*Special thanks to the open-source communities behind Yjs, Quill, and Flask.*
