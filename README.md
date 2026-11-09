# Fraaime — PDF-to-model pilot and concept editor

Reusable application and framing editor source for Fraaime: **https://github.com/dynetk/fraaime**.

The new **[PDF-to-model pilot application](app/README.md)** lives in `app/`. It includes private uploads, background PDF preparation, an OpenAI extraction adapter, project permissions, and a data-driven 3D editor with server-saved revisions. Its README covers local development and Clerk, Neon, Blob, OpenAI, and Vercel setup. The static editor below remains available independently.

For the hosted pilot, follow the **[Vercel launch checklist](app/SETUP.md)**. Use `app` as the web project's root directory and `app/worker` for the separate PDF service. The repository root is not the Next.js application.

This public repository contains a working **blank, project-neutral editor**. Customer plan images, PDFs, addresses, building models, opening schedules and project-specific application snapshots are excluded. The separate project demos remain outside this repository.

## Run locally

```sh
git clone https://github.com/dynetk/fraaime.git
cd fraaime
python3 -m http.server 5185 --directory dist --bind 127.0.0.1
```

Open http://127.0.0.1:5185/. You can also choose **Code → Download ZIP** on GitHub, extract it, and run the server command from that folder. No build, package installation or API keys are required. Use HTTP hosting rather than opening index.html directly from disk.

## Features

- Add framed wall panels, studs, tracks, beams/headers, posts, joists and slabs.
- Drag components from the palette onto the working floor and drag them to move.
- Use length, depth and height handles to resize; rotate in the floor plane.
- Numeric fields, keyboard handles, six-inch/15-degree snapping and free adjustment.
- Add a floor using a generic 20 × 20 ft slab, with optional perimeter panels.
- Duplicate/remove, undo/redo, browser-local autosave and JSON import/export.
- Framing/solid views, floor isolation, orbit, zoom, top and reset views.

The initial scene is empty with one ground floor. Default sizes are generic demonstration values, not a real building. Imported designs stay in the browser; they are not uploaded or automatically committed to GitHub. Export before changing browsers or site URLs.

## Deploy

For Netlify Drop, upload **dist**, with index.html at its root. For a connected GitHub deployment, leave the build command empty and publish **dist**; netlify.toml is included. No environment variables are needed. The GitHub repository shares source, not a hosted website.

## Development

The JavaScript files in dist are both editable source and deployable modules. Three.js 0.180.0 and OrbitControls are vendored; their MIT license is in dist/vendor/THREE-LICENSE.txt. With Node.js 22 or newer:

```sh
node --test tests/*.test.mjs
```

| Module | Role |
| --- | --- |
| dist/model.js | Blank scene, camera, picking and editor integration |
| dist/editor.js | Editing UI, floor controls, persistence and import/export |
| dist/editor-state.js | Generic component state, validation and history |
| dist/editor-geometry.js | Component geometry and optional source-assembly support without any source dataset |
| dist/model-manipulator.js | Drag/drop, move, resize, rotate and mouse handles |
| dist/manipulator-math.js | Pure transform math |
| dist/app.js / index.html / style.css | Application entry point, layout and visual system |

## Scope and privacy

The static `dist/` application is a concept editor, not engineering, fabrication, CAD/BIM, PDF analysis or estimating software. It has no AI/OCR API, server storage, authentication, pricing or commercial workflow. Members use simplified shapes. The separate `app/` pilot adds the services described in its own README.

The public schema is `fraaime-public-concept`, version 1, with feet for geometry, inches for spacing and degrees for rotation. It intentionally does not accept project-demo exports. The ground-floor datum stays at zero. Undo history is session-only. Storage uses `fraaime-public-editor-v1`, separate from project demos.

Use synthetic fixtures for tests. Keep customer documents, their derived geometry/schedules, private hosting metadata, secrets and personal exports outside this repository and its history. Review commits for sensitive material before pushing; ignore rules alone cannot detect customer data embedded in source code.

The shared MVP and business reference is maintained in the team's Notion workspace. This public repository does not publish that private workspace or the project-specific demos. Future shared-code changes should be made in a checkout of this repository; other local demo folders do not automatically sync with it.
