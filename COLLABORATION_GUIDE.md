# Guía de Uso: Edición Colaborativa en MarkTrack

Este documento detalla cómo utilizar las nuevas funciones de colaboración en tiempo real integradas con **Yjs** y **Quill.js**.

## 🚀 Cómo empezar

El modo colaborativo se activa automáticamente cuando un documento tiene un equipo de trabajo activo.

### 1. Formar el equipo
- Dirígete a la pantalla de edición (`invite.html`).
- En la barra lateral derecha, abre el panel **"Team"** (Equipo).
- Invita a tus colaboradores usando su correo electrónico.
- **Límites:** Mínimo 2 colaboradores (incluyendo al dueño) y máximo 3.

### 2. Aceptación (Requisito Crítico)
- Los colaboradores invitados deben revisar su correo y hacer clic en **"Accept Invitation"**.
- El modo en tiempo real (Yjs) **solo se activará** cuando el sistema detecte al menos 2 usuarios con estado "Aceptado".

### 3. Identificación del estado "Live"
- Sabrás que la edición colaborativa está activa cuando veas el distintivo **`● Live`** en la barra de presencia (esquina superior derecha).
- Si solo hay un usuario aceptado, el sistema funcionará en modo estándar sin sincronización CRDT para ahorrar recursos.

## ✍️ Funciones en tiempo real

### Cursores Remotos
- Verás los cursores de tus compañeros moviéndose por el documento.
- Cada cursor incluye una etiqueta con el **nombre del usuario** y un **color único** asignado automáticamente.

### Sincronización CRDT
- No hay conflictos de guardado. Si dos personas escriben en la misma palabra, Yjs fusiona los cambios de forma inteligente (CRDT).
- Los cambios se guardan automáticamente en un caché de alta velocidad (Redis) y se consolidan en la base de datos cada 50 actualizaciones o al cerrar la pestaña.

### Panel de Aportes (%)
- En el panel de "Team", puedes ver en tiempo real qué porcentaje del documento ha escrito cada integrante.
- Estos datos también están disponibles para el profesor en el panel de revisión.

## 🛠️ Resolución de Problemas

- **No veo los cursores:** Asegúrate de que el otro usuario haya aceptado la invitación y que ambos vean el indicador `● Live`.
- **Límite excedido:** Si intentas agregar a un 4to integrante, el sistema bloqueará la invitación para mantener el rendimiento y los límites del servidor.
- **Conexión perdida:** Si el indicador `● Live` desaparece, verifica tu conexión a internet; el sistema intentará reconectarse automáticamente en 3 intentos.

---
*Documentación generada para MarkTrack Collaboration Update v1.0*
