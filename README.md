# IDP Artifact Modeler

App estática React (Bronze/Silver/Gold modeler) para deploy en **Render Static Site**.

## Arquitectura

- **Sin build step.** React 18 cargado vía CDN UMD, JSX transpilado en el browser con `@babel/standalone`.
- **Estado:** todo en `localStorage` bajo la key `artifact_modeler_v2`. No hay backend.
- **Estructura:**
  ```
  public/
  ├── index.html       ← entry point
  ├── app.jsx          ← componente principal (multi-stage)
  ├── helpers.js       ← utilidades (sufijos, sugerencias de tipo, etc.)
  ├── seed.js          ← datos seed para los 3 stages
  ├── styles.css
  └── favicon.svg
  ```

## Deploy en Render

### Opción A — Blueprint (recomendado)

1. Pushear este repo a GitHub/GitLab.
2. En Render: **New → Blueprint** y apuntar al repo.
3. Render detecta `render.yaml` y crea el Static Site automáticamente.
4. Listo. Render asigna `https://idp-artifact-modeler.onrender.com` (o el nombre que pongas).

### Opción B — Configuración manual

1. **New → Static Site** en el dashboard de Render.
2. Conectar el repo.
3. Configuración:
   - **Build Command:** *(dejar vacío)*
   - **Publish Directory:** `public`
4. Deploy.

## Dev local

No hace falta `npm install`. Cualquier server estático sirve:

```bash
# Python
cd public && python3 -m http.server 8080

# Node
npx serve public

# o con caddy
caddy file-server --root public --listen :8080
```

Abrir `http://localhost:8080`.

## Consideraciones

### Performance del Babel en browser

`@babel/standalone` pesa ~3MB y transpila el JSX en cada carga. Para una herramienta interna está bien, pero si en algún momento querés mejorarlo:

1. Instalar Vite: `npm create vite@latest . -- --template react`
2. Mover `app.jsx` a `src/`, importar `helpers.js` y `seed.js` como módulos.
3. Cambiar `render.yaml`:
   ```yaml
   buildCommand: npm ci && npm run build
   staticPublishPath: ./dist
   ```

Eso baja el bundle a ~150KB y elimina el round-trip del CDN.

### Estado en localStorage

Al estar todo en `localStorage`, **el estado vive en cada browser**. Si querés compartir modelos entre el equipo, va a hacer falta un backend (FastAPI BFF + Postgres encajaría bien con tu Arch Manager pattern).

### Edit mode de Claude Design

El archivo original `tweaks-panel.jsx` es infraestructura del editor de Claude Design (escucha postMessages `__activate_edit_mode`, etc.). En producción no se usa — lo descarté del bundle.

## Auth

El código menciona `AUTH_KEY = "artifact_modeler_auth_v1"` en `localStorage`. Si tenés un flow de auth client-side ya implementado, funciona tal cual. Si querés meter SSO de Galicia, tendrías que ir contra un BFF.
# Artifact-Modeler
