# Separación de Entornos: DocumentEdit y DocumentView

Este plan detalla los pasos para cumplir con la petición de añadir dos nuevas pantallas dedicadas al creador de los documentos en el Home (`Folders` y `Independent documents`).

## User Review Required
> [!IMPORTANT]
> **Definición de DocumentEdit**: Has indicado que *DocumentEdit* combinará las funciones de edición (de `invite`) y de análisis extensivo (de `review`). Dado que el usuario será el mismo creador del documento, él podrá escribir texto (editor) y a la vez consultar las métricas impulsadas por IA, historial de revisiones y el panel de autenticidad sobre el mismo documento que edita. 
> Por favor, confirma si apruebas la creación y fusión de esta pantalla bajo este enfoque.

## Proposed Changes

### Frontend (Acciones Home)

#### [MODIFY] [home-inline.js](file:///Users/user/Documents/xplagiax_marktrack/static/js/home-inline.js)
- Modificaremos las funciones `loadDocument(docId)` y `editDocument(docId)` para que detecten el tipo de archivo (extensión).
- **Ruteo dinámico:** 
  - Si el documento es un PDF, redirigir a `/documentview/<docId>`.
  - Si es `.doc`, `.docx` o un formato editable embebido, redirigir a `/documentedit/<docId>`.
  - Retirar el ruteo genérico obsoleto a `/editor`.

---

### Backend (Nuevas Rutas)

#### [MODIFY] [users_routes.py](file:///Users/user/Documents/xplagiax_marktrack/routes/users_routes.py)
- **[NEW] Endpoint `/documentedit/<int:doc_id>`**: 
  1. Validará que el usuario autenticado (`current_user.id`) sea exactamente el dueño (`owner_id`) del documento.
  2. Reunirá los datos base de historial/métricas si el documento ya ha sido trabajado o si se le aplicó tracking previamente.
  3. Desplegará la nueva plantilla `documentedit.html`.
  
- **[NEW] Endpoint `/documentview/<int:doc_id>`**:
  1. Proveerá acceso seguro al documento PDF del usuario.
  2. Desplegará la nueva plantilla `documentview.html` para vista de solo lectura mediante `iframe` o API de visor.

---

### UI / Plantillas (Nuevas Pantallas)

#### [NEW] `templates/documentedit.html`
- Servirá como la interfaz estrella de creadores híbrida ("centro de mando").
- Heredará la capa de *layout* Premium "Dark Glass" vista en `review` y `invite`.
- **Lado Izquierdo/Centro:** Integrará el editor `Quill.js` interactivo con capacidad total de escritura y la lógica de autoguardado (atributos heredados de `invite`).
- **Lado Derecho / Offcanvas (550px):** Incorporará el Panel Analítico de `review`, las gráficas de validación BLOOMZ, ortografía y seguimiento de "OpenRecall", alimentándose dinámicamente de la actividad del creador y de las mediciones del documento.

#### [NEW] `templates/documentview.html`
- Una pantalla limpia dedicada exclusivamente a presentar documentos PDF a pantalla completa.
- Incluirá un botón para "volver al home" y un menú de descarga seguro, manteniendo la estética sin componentes de edición.

## Open Questions
> [!WARNING]
> ¿Deseas que en `documentview.html` haya habilitada una barrera u offcanvas con información o debe ser 100% pantalla de lectura tipo Google Drive PDF?

## Verification Plan
### Automated Tests
- Simular flujos de usuario subiendo un PDF y un `.docx` e intentando abrirlos.
- Validar mediante Javascript Execution / Network que el `.doc` sea despachado a `/documentedit/` y que la plantilla levante el Canvas de métricas lateral con éxito.

### Manual Verification
- Clicar el *dropdown* en la lista en `home` y verificar el enrutado dependiendo del tipo mime.
- Validar que al escribir en `documentedit.html` y luego invocar el panel lateral, las métricas no entren en conflicto con el modo editable del profesor.
