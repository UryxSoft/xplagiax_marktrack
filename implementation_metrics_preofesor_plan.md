# Plan de Implementación: Vistas de Evaluación Seguras (IDOR) y Métricas Dinámicas

## User Review Required

> [!IMPORTANT]
> El enfoque propuesto utilizará `itsdangerous.URLSafeSerializer` o `URLSafeTimedSerializer` provisto por Flask para firmar criptográficamente el `document_id`. Esto asegura la URL contra IDOR sin necesidad de alterar el esquema de la base de datos (añadiendo columnas UUID). Por favor, aprueba si este patrón coincide con las expectativas de seguridad del proyecto.

## Proposed Changes

### Backend (Python/Flask)

#### [MODIFY] `routes/workspace_routes.py`
Se actualizará el decorador y lógica de la ruta de review:
- Cambiar la ruta original: `@workspace_bp.route('/review/<int:document_id>')` por `@workspace_bp.route('/review/<token>')`.
- Decodificar el `token` usando `itsdangerous.URLSafeTimedSerializer` con la llave secreta del backend para obtener el `document_id`.
- Si la validación falla (ej., token malformado o manipulado), se retornará error `403 Forbidden` o `404 Not Found`.
- Tras validar los permisos del profesor, se cargará la métrica correspondiente (`EssaySubmissionMetrics`).
- Se pasarán las variables solicitadas (como `total_words`, `writing_time_formatted`, `ai_instances`, `paste_events_count`) al contexto del `render_template`.

#### [MODIFY] `routes/metrics_routes.py`
Se modificará el endpoint que alimenta el modal de métricas (`/api/submission-metrics/<int:submission_id>`):
- Al construir el diccionario de la respuesta JSON, se generará la URL segura: `secure_review_url = f"/review/{signed_token}"`.
- El frontend recibirá y utilizará esta URL en lugar de armar estáticamente `/review/{document_id}`.

---

### Frontend (JavaScript & HTML)

#### [MODIFY] `templates/sections/workspace.html`
- **Dashboard Modal (`openMetricsModal`)**: Al recibir el JSON con la analítica, se capturará `met.secure_review_url` enviado desde el backend.
- **Event Listener en `<a id="metDocLink">`**: Se delegará el enlace seguro vía script o se implementará el Event Listener explícito conforme a lo solicitado:
  ```javascript
  const docLink = document.getElementById('metDocLink');
  if (docLink) {
      docLink.href = 'javascript:void(0)';
      // Remover preexistentes para evitar duplicados
      const newLink = docLink.cloneNode(true);
      docLink.parentNode.replaceChild(newLink, docLink);
      newLink.addEventListener('click', (e) => {
          e.preventDefault();
          if (met.secure_review_url) {
              window.open(met.secure_review_url, '_blank');
          }
      });
  }
  ```

#### [MODIFY] `templates/review.html`
- Se reemplazará el código HTML duro estático (`<div class="quick-stats">`) con el fragmento de la especificación, utilizando Jinja (`{{ ... }}`) para realizar el renderizado server-side (DOM Injection desde el backend context):
  ```html
  <div class="quick-stats">
      <h4 style="...;">Quick Statistics</h4>
      <div class="stats-grid">
          <div class="stat-item">
              <span class="stat-label">Total Words</span>
              <span class="stat-value" id="val-total-words">{{ total_words }}</span>
          </div>
          <div class="stat-item">
              <span class="stat-label">Writing Time</span>
              <span class="stat-value" id="val-writing-time">{{ writing_time_formatted }}</span>
          </div>
          ...
      </div>
  </div>
  ```

## Open Questions

- ¿Desea que el link (token) generado expiré luego de algunas horas (ej. usando `max_age` en `itsdangerous`) por seguridad máxima, o debe ser válido estáticamente mientras la sesión del profesor esté activa?
- ¿El cálculo de `writing_time_formatted`, `ai_instances` y `total_words` debe aplicar algún formato en el frontend, u obteniendo su valor absoluto como string desde el backend context es suficiente?

## Verification Plan

### Manual Verification
1. Ingresar como profesor al dashboard (`/workspace`).
2. Abrir el modal de Submission Metrics de algún estudiante.
3. Verificar la consola/red (Network) que el endpoint retorna el nuevo atributo `secure_review_url`.
4. Al hacer click en "View Final Document" (`#metDocLink`), verificar que la nueva pestaña carga `http://localhost:5000/review/eyJkb2...`
5. Revisar la vista `/review` y confirmar que el layout de Quick Statistics refleja valores reales (ej: '34 instances', '22m 14s') en verde y sin depender de hardcoding.
6. Alterar intencionalmente el token en la URL y ratificar que el servidor deniega el acceso (`Forbidden`).
