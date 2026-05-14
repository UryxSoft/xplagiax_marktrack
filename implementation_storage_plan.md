# Plan de Mejora: Dashboard de Almacenamiento (Data & Aesthetics)

Este plan aborda la discrepancia entre los valores "reales" de almacenamiento y los gráficos mostrados, además de elevar la calidad visual de las gráficas basándose en el estándar "Dark Glass" premium.

## User Review Required

> [!IMPORTANT]
> **Consistencia de Datos:** Actualmente los gráficos de crecimiento y categorías solo cuentan documentos base, ignorando versiones anteriores y archivos subidos manualmente. Esto causa que el gráfico de "Crecimiento" no coincida con el total de "Espacio Usado". Mi plan incluye unificar estas métricas.

> [!TIP]
> **Estética Visual:** Implementaré gradientes dinámicos y sombras suaves en ApexCharts para replicar el diseño "Sample" que mencionas, asegurando que la transición de datos estáticos a reales no degrade la experiencia visual.

## Proposed Changes

### 1. Backend: Consistencia de Métricas [ routes/storage_routes.py ]
- **Crecimiento Real:** Modificar `get_growth_chart` para que consulte no solo `Document`, sino también `DocumentVersion` y la tabla `File` en cada punto del tiempo.
- **Distribución por Categorías:** Actualizar `get_category_distribution` para incluir archivos de la tabla `File` (mapeando sus tipos MIME al sistema de categorías).
- **KPI Matching:** Asegurar que `_calculate_real_usage` sea la fuente de verdad única para todas las rutas.

### 2. Frontend: Refactorización Estética [ templates/sections/almacenamiento.html ]
- **ApexCharts Global Config:** Definir un objeto de configuración base con:
    - Fuentes: 'Inter', sans-serif.
    - Colores: Paleta Dark Glass (Azul #007AFF, Ámbar #f59e0b, Esmeralda #10b981).
    - Grid: Líneas de cuadrícula sutiles (`rgba(255,255,255,0.05)`).
- **Chart-Specific Enhancements:**
    - **Donut:** Incrementar el `hollow size` y añadir sombras internas.
    - **Area (Growth):** Usar gradientes lineales con opacidad descendente.
    - **Bar (Type):** Añadir bordes redondeados y efectos de hover.

### 3. Sincronización de UI
- **Sync Subtitle:** Corregir la estampa de tiempo manual hardcodeada para que use el valor real retornado por la API (`syncAt`).
- **KPI Units:** Asegurar que las unidades (GB, MB) se rendericen con la tipografía pequeña correcta definida en el CSS.

## Verification Plan

### Automated Verification
- Ejecutar el servidor y verificar vía logs que las consultas SQL incluyan las tres tablas (docs, versions, files).
- Validar que el JSON de `/api/storage/summary` coincida exactamente con la suma de `/api/storage/charts/usage`.

### Manual Verification
- Cargar un archivo pesado y verificar que tanto el KPI Card como la gráfica de crecimiento reflejen el incremento de inmediato.
- Comprobar que el diseño visual en modo "Dark" no tenga problemas de contraste con el nuevo esquema de colores de ApexCharts.
