# Plano a Plano Studio V4 — Sección Viajes

Versión de trabajo de Plano a Plano Studio (React, TypeScript y Vite) con los guiones y audios originales de «Sección Viajes».

## Contenido

- `src/`: aplicación V4. Permite cargar guiones Markdown o TXT, editar planos, trabajar con audio y usar funciones de IA.
- `guiones/`: 14 guiones actuales en Markdown.
- `audios/`: 29 MP3 originales, incluido el montaje completo. Se almacenan mediante Git LFS.

## Arranque

Instala Node.js compatible con el `package-lock.json`, Git LFS y ejecuta:

```bash
npm ci
npm run dev
```

Abre la dirección local que muestre Vite. Para usar funciones de IA, pulsa **Claves API** (icono de llave) y escribe tus claves de OpenRouter, Groq o Google Gemini. Se guardan en `localStorage` del navegador actual, en texto legible para ese perfil, y no forman parte del repositorio ni del guion exportado. No uses esta función en un navegador compartido. Puedes borrar cada clave dejando su campo vacío y guardando.

La versión publicada en GitHub Pages se abre en `https://erlpruebas.github.io/plano-a-plano-studio-viajes/` cuando la publicación de Pages está habilitada. Las claves se configuran por separado en cada navegador. Los MP3 y guiones son públicos en este repositorio y puedes descargarlos y cargarlos en la aplicación; la web no los descarga automáticamente.

Las llamadas a proveedores de IA salen directamente del navegador. El proveedor correspondiente recibirá el contenido enviado para esa función. Las funciones de edición y carga local siguen disponibles sin claves.

Para obtener los MP3 al clonar:

```bash
git lfs install
git clone https://github.com/erlpruebas/plano-a-plano-studio-viajes.git
```

## Seguridad

No hay archivos `.env` ni claves API en este repositorio. No pongas claves en variables `VITE_*`: Vite las puede incluir en el paquete del navegador. Los guiones y audios son públicos por decisión del propietario.
