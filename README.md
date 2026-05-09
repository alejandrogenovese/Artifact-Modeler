# IDP Artifact Modeler

App estática React (Bronze/Silver/Gold modeler + generador dbt) para deploy en **Render Static Site**.

Genera artefactos dbt (`_sources.yml`, `_models.yml`, `.sql`) que respetan la _Nomenclatura de Objetos – Data Mesh_ (Banco Galicia).

## Qué incluye esta versión

- **Panel "Identidad del Data Product"** colapsable — captura `data_product`, `sigla_aplicativa`, `logical_name`, tipo de Gold (dim/fact), uso fact (snap/trx/agr) y frecuencia. Muestra en vivo los nombres calculados (`stg_<sigla>_<logical>`, `<dp>_inter_<logical>`, etc.).
- **Linter de sufijos** según el Anexo del documento de Nomenclatura. Cualquier `target_name` que no termine en uno de `_id _cd _fc _fl _hr _nu _pc _pr _rt _sc _ts _tx _vl` queda marcado, y si termina en uno pero el `target_type` no matchea (ej. `nacimiento_fc` con `VARCHAR`), se marca como error.
- **Tests automáticos por sufijo** — el generador inyecta tests dbt según el sufijo del campo:
  - `_id`: `not_null + unique`
  - `_pc`, `_pr`: `dbt_utils.expression_is_true: '>= 0 and <= 1'`
  - `is_key=true`: `not_null + unique`
  - `nullable=false`: `not_null`
  - `val_codigo_valido` con valores: `accepted_values`
- **Preview con tabs dbt** — ves en vivo `bronze _sources.yml`, `silver _models.yml`, `silver .sql`, `gold _models.yml`, `gold .sql` mientras editás.
- **Export ZIP completo** — botón **📦 ZIP dbt** en topbar. Descarga la estructura `models/{bronze,silver,gold}/` lista para mergear contra un proyecto dbt existente, más README contextual y backup del state del modeler.
- **Auto-inyección de campos de auditoría** — `audit_created_ts_local` (Bronze), `audit_created_ts` + `audit_data_source_tx` (Silver/Gold). Los timestamps usan `convert_timezone('America/Argentina/Buenos_Aires', getdate())` según el documento.
- **Surrogate key automática en Gold** — cuando hay PK compuesta (más de un `is_key`), se genera la columna `<concept1>_<concept2>_id` con `md5(coalesce(...) || '-' || coalesce(...))::varchar(100)`.
- **Editor de COMMENTs** — modal accesible desde **💬 Comments** en topbar. Por capa (Bronze/Silver/Gold):
  - Override del COMMENT de tabla
  - Override del COMMENT de cada columna del modelado, con la `description` del modelado mostrada como hint
  - Override de COMMENTs de **audit fields** y **surrogate key** (que no están en el modelado pero sí aparecen en la base)
  - Sección de **comments huérfanos** cuando renombrás/eliminás una columna del modelado pero el override quedó (con botón para borrar)
  - Los overrides también se sincronizan al `description` del YAML, así `persist_docs` aplica la versión editada
  - Escape SQL automático de comillas simples
- **COMMENTs de Redshift** — los descriptions del modelado se persisten en el catálogo de Redshift por dos vías:
  - **Silver/Gold**: vía `persist_docs={'relation': True, 'columns': True}` en el `{{ config() }}` de cada modelo. Cada `dbt run` reemite los COMMENTs. Sin acción manual.
  - **Bronze**: como source no se ejecuta vía dbt, el ZIP incluye `models/bronze/_comments.sql` con los `COMMENT ON TABLE`/`COMMENT ON COLUMN` ejecutables directo en Redshift.
  - Silver y Gold también incluyen su `_comments.sql` como **fallback idempotente** para entornos sin `persist_docs` o para repoblar sin `dbt run` completo.

## Arquitectura técnica

- **Sin build step.** React 18 + JSZip vía CDN, JSX transpilado en el browser con `@babel/standalone`.
- **Estado:** `localStorage` bajo `artifact_modeler_v2`. Migración automática para projects guardados sin `meta` (parsea schemas viejos para deducir `sigla`, `data_product`, `logical_name`).
- **Estructura:**
  ```
  public/
  ├── index.html             ← entry point
  ├── app.jsx                ← componente principal multi-stage
  ├── helpers.js             ← utilidades existentes (positions, suggest, toYaml)
  ├── seed.js                ← datos seed para los 3 stages
  ├── dbt-generator.js       ← (NUEVO) name builders + suffix rules + linter + YAML/SQL/ZIP
  ├── styles.css
  └── favicon.svg
  ```

## Convención implementada (resumen)

Todos los nombres se derivan automáticamente del panel de metadata del DP:

| Capa | Schema | Tabla |
|---|---|---|
| Bronze | `stg_<sigla>_<logical>` | `<interface_name>` (tal cual del origen) |
| Silver | `<dp>_inter_<logical>` | `<silver_table_name>` |
| Gold (dim) | `<dp>_mart_<logical>` | `dim_<content>` |
| Gold (fact trx) | `<dp>_mart_<logical>` | `fact_trx_<content>` |
| Gold (fact snap) | `<dp>_mart_<logical>` | `fact_snap_<content>_<freq>` |
| Gold (fact agr) | `<dp>_mart_<logical>` | `fact_agr_<content>_<freq>` |
| Gold views | `<dp>_martviews_<logical>` | `vw_<...>` |

## Deploy en Render

### Opción A — Blueprint (recomendado)

1. Pushear este repo a GitHub/GitLab.
2. En Render: **New → Blueprint** y apuntar al repo.
3. Render detecta `render.yaml` y crea el Static Site automáticamente.

### Opción B — Manual

1. **New → Static Site** en Render dashboard.
2. Conectar el repo.
3. **Build Command:** *(vacío)* · **Publish Directory:** `public`
4. Deploy.

## Dev local

No hace falta `npm install`. Cualquier server estático sirve:

```bash
cd public && python3 -m http.server 8080
# o
npx serve public
```

Abrir `http://localhost:8080`.

## Próximos pasos planeados

- (4) Backend Supabase + auth + versionado (cuando lo de generación esté validado en uso real).
- (5) Edge Function que regenera el ZIP en Storage como trigger del `update`, así el equipo puede hacer `dbt-poller` o `git sync` sin pasar por la UI.
