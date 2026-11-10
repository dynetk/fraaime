# Fraaime Project Studio pilot

One private application for uploaded plan sets, source review, and editable 3D building shells. This pilot includes editable, preliminary framing estimates with fictional demonstration prices; it is not an engineered takeoff or supplier quotation.

Brand implementation: [BRAND.md](BRAND.md). Estimate scope, calculations, and limits: [ESTIMATING.md](ESTIMATING.md).

## What is implemented

- Next.js dashboard with Clerk authentication, an invitation allowlist, per-project memberships, and admin/reviewer/customer roles.
- Private direct-to-Blob PDF upload (120 MiB default), local development upload, immutable plan records, and a Python PDF preparation service.
- Durable Vercel Workflow: inspect → choose sheets → extract selected pages → validate → save AI candidate. Jobs continue after navigation. Inspect/extract stages have persisted status, errors, and page checkpoints.
- OpenAI Responses structured extraction behind a provider interface, native text/vector hints plus page/crop images, source evidence, scale records, usage accounting, conservative reservations against per-job/monthly budgets, and a concurrency cap.
- A common millimeter model rendered with Three.js; walls with openings, floor outlines/voids, roof surfaces, and manual framing placeholders. Add via drag/drop or click, move/rotate/resize with mouse handles, edit numeric dimensions in feet, undo/redo, add floors, import/export JSON.
- Framing view (default) hides solid surfaces and generates illustrative studs, tracks, opening headers, floor joists, and optional roof members. Switch to Building shell for the solid model. Choose 16- or 24-inch preview spacing; initial framing respects floor voids and wall openings. Clicking a generated stud, track, or header converts that wall's current layout into individually editable components. Move, resize, rotate, duplicate, or remove a member using mouse handles and the inspector; Save persists the layout, edits, and deletions in revisions/JSON. Custom wall framing no longer regenerates when spacing/openings change. Parent wall transforms carry custom members with them; opening changes require manual adjustment or **Reset wall framing** (undoable). Floor/roof framing still selects its parent assembly. `framingAssemblies` is optional editor metadata, keeping old models compatible and separate from the AI extraction schema. At most 3,000 editable components are supported per model; preview-only members do not count. Member sizes, joist direction, ground-floor framing, connections, and spans are not structurally designed.
- Server-saved revisions with optimistic concurrency. Reruns become separate candidates. Viewing a previous revision does not restore it until Save is clicked. Human corrections are never automatically overwritten.
- Source-sheet viewer, opening schedule, issue resolution notes, scale confirmation, explicit reviewed revisions, deletion, and audit events.
- Local PGlite database for development; the same SQL schema runs on Neon Postgres. Synthetic sample data is clearly labeled. No fake AI results are substituted when credentials are missing.

## Quick local start

Requirements: Node 24+, Python 3.12+, and Poppler (`pdftoppm` on PATH).

```sh
npm ci
cp .env.example .env.local
python3 -m venv worker/.venv
worker/.venv/bin/python -m pip install -r worker/requirements.txt
```

Set a random `PDF_WORKER_TOKEN` in `.env.local` (for example, generate one with `openssl rand -hex 32`). Keep `FRAAIME_LOCAL_MODE=1`. Do not paste API keys into chats or commit them.

In two terminals, from this directory:

```sh
worker/.venv/bin/python scripts/worker-dev.py
npm run dev
```

Open http://127.0.0.1:5190. The local identity is deliberately restricted to loopback development, and cannot activate in production or on Vercel. Local data resides in ignored `.local/`; it is not served as static content. A service configuration check is available with `npm run check:setup`.

Without OpenAI credentials you can create projects, upload/index PDFs, review sheets, and edit/save sample or imported models. Extraction fails with a configuration message; it does not fabricate geometry. Local mode can use OpenAI when explicitly configured; paid calls then use the same budgets as hosted mode.

## Configure and deploy to Vercel

Follow the step-by-step [launch checklist](SETUP.md), including GitHub access, database initialization, environment isolation, and deployment protection.

Use two Vercel projects: the Next.js app with this directory as its root, and the portable PDF worker with `worker/` as its root. The worker's Dockerfile uses the Vercel Container runtime (currently beta). This keeps PDF system dependencies out of the Next.js bundle. The app's `vercel.json` selects the Next.js build and `sfo1` region. Do not deploy the workspace root or local project files.

1. **Neon:** create a Postgres database near the app region; configure its pooled connection string as `DATABASE_URL`. Run `npm run db:migrate` with hosted configuration (`FRAAIME_LOCAL_MODE=0`). Migrations do not run on production requests. Enable the database provider's backup/PITR retention and test a restore before inviting customers.
2. **Clerk:** create the application, enable Google as the sign-in provider, disable unwanted providers, and configure production Google OAuth client credentials and redirect URI in Clerk. Add `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in`. Set `ADMIN_EMAILS` to the initial verified admin email(s). An authenticated but uninvited user cannot access project data. Use Grant pilot access, then Manage access on a project. These actions do not send email.
3. **Blob:** create a **private** store and connect it to the app. Set `BLOB_READ_WRITE_TOKEN` server-side. Browser uploads get short-lived scoped tokens after project authorization; original PDFs and derived page artifacts stay private. Do not use a public store.
4. **Worker:** deploy `worker/` using Container Runtime. Configure the same strong `PDF_WORKER_TOKEN` in both services, and `APP_ORIGIN` as the app's exact HTTPS origin. Set app `PDF_WORKER_URL` to the worker origin. Worker requests are authenticated and can fetch source files only from the configured app origin/path. Source URLs cannot be supplied by end users. Rendering runs with a timeout/pixel limit; temporary files are deleted after each request.
5. **OpenAI:** add a project-scoped `OPENAI_API_KEY` on the server. `OPENAI_MODEL=gpt-6.1-sol` with `OPENAI_REASONING_EFFORT=medium` is the candidate configuration. Use standard-tier rates `OPENAI_INPUT_USD_PER_MILLION=2` and `OPENAI_OUTPUT_USD_PER_MILLION=10` (verified 2026-11-09). Revalidate prices when changing models; processing stays disabled without valid rates. Run the private plan evaluation described in `EVALUATION.md` before promoting this candidate. Set provider-side spend limits too. The code uses `store:false`, not a claim of zero provider retention; confirm provider data terms before customer launch.
6. **Limits:** defaults are $10/job, $100/calendar month, 2 active jobs, 120 MiB/PDF, 150 pages/PDF, and 30 selected pages/extraction. These are pilot defaults, not expected cost estimates. Source sheets use checkbox selection. Increase limits only after measuring actual usage. Costs shown are calculated from configured rates, with uncertain calls conservatively retaining their reservations.
7. **Deploy:** set `FRAAIME_LOCAL_MODE=0`; ensure `APP_ORIGIN` matches the final app URL. Keep Workflow's `/.well-known/workflow/` paths excluded from Clerk proxy interception. Test upload, worker retrieval, and workflow dispatch on the deployed environment. A local build does not establish hosted readiness.

Current service documentation: [Clerk Google](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/google), [Blob uploads](https://vercel.com/docs/vercel-blob/client-upload), [Vercel Workflow](https://vercel.com/docs/workflows), [Container Runtime](https://vercel.com/docs/functions/runtimes/container), [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

## Data and API contracts

`src/lib/model.ts` is the versioned shared schema. Units are millimeters, with plan X/Z and elevation Y. Openings reference a wall and use distance from its start to the left jamb. Source regions are normalized `[x0,y0,x1,y1]` in displayed page coordinates. Drawing calibrations are per viewport, not per whole sheet. API routes enforce membership on every project, model, PDF, and derived-image read/write.

| Endpoint                           | Purpose                                                  |
| ---------------------------------- | -------------------------------------------------------- |
| `GET/POST /api/projects`           | List permitted projects / create                         |
| `GET/DELETE /api/projects/:id`     | Project state / remove files and records                 |
| `GET/POST /api/projects/:id/model` | Fetch revision / save with `baseId` concurrency check    |
| `POST /api/projects/:id/review`    | Reviewer-only save after validation and issue resolution |
| `POST /api/projects/:id/members`   | Owner/admin membership management                        |
| `GET/POST /api/invitations`        | Admin pilot allowlist                                    |
| `POST /api/uploads`                | Register project-bound upload                            |
| `POST /api/blob-upload`            | Authorized private client upload token                   |
| `POST /api/plans/:id/complete`     | Idempotently enqueue PDF inspection                      |
| `GET /api/plans/:id/source`        | Authorized PDF stream                                    |
| `GET /api/plans/:id/page?page=N`   | Authorized cached source-sheet image                     |
| `POST /api/jobs/:id/run`           | Process chosen sheets; completed runs produce a new job  |
| `POST /api/jobs/:id/retry`         | Resume a stopped job using completed page checkpoints    |
| `POST /api/jobs/:id/new`           | Explicit fresh extraction after an uncertain call        |
| `POST /api/jobs/:id/cancel`        | Stop dispatch and prevent candidate publication          |

`db/schema.sql` contains projects, memberships, plans, jobs, revisions, AI usage/reservations, artifact pointers, and audit records. PDFs/images never enter Git. Page artifacts are private Blob JSON (local files in development), referenced by database records. Revisions/observations live in Postgres. Back up database and file storage together; database backup alone cannot restore source PDFs. Deleted project data may persist in provider backups/workflow logs until their configured retention expires.

A crash after an AI request is sent but before its response is persisted has ambiguous billing. The application stops that page instead of automatically sending another paid request. The user can explicitly start a separate extraction; the UI warns that it may incur another charge. Transient preparation failures can retry safely. Completed page results are reused on resume. Partial runs save an `ai_partial` candidate; completion saves a distinct `ai` revision. Retry dispatch failures from the project; infrastructure failures that prevent the terminal step require operator inspection in Vercel Workflow.

## Existing demos and private migration

The four original demos remain unchanged. This generic importer accepts trusted **local demo source**, never a PDF upload containing code:

```sh
npm run import:legacy -- /absolute/demo-folder 'Project name' /absolute/source.pdf [/absolute/private-profile.json]
```

It converts feet to millimeters and schedule inches to millimeters. Optional private profiles supply `levels` with feet-based `height`, `outline`, `voids`; `wallHeights` keyed by converted wall ID; and `roofs` with `[x,y,z]` vertices in feet. All migrated geometry remains illustrative. Without a profile, unsupported project-specific roof code is not executed, inferred slab/height defaults are flagged, and skylights are retained as review issues. The generic renderer has no customer-specific branches.

Customer sources, profiles, models, rendered pages, local database, backups, screenshots, and benchmark annotations must stay in ignored/private storage. Do not commit `.local/`, `.env.local`, PDFs, or model exports. Public examples use only synthetic data.

## Verification and evaluation

```sh
npm run typecheck
npm test
worker/.venv/bin/python -m pytest worker/tests -q
npm run build
```

Tests cover model units and openings, voids/decks, transformations, orphaned schedule records, duplicate IDs, permissions, stale saves, idempotent AI candidates, review gates, PDF rotation/scans, encrypted/corrupt input, and worker source restrictions.

Local verification on November 9, 2026: 25 TypeScript/Node tests and 4 Python tests passed, along with type checking and a production build. Earlier local integration checks verified the following workflows. A private 103,258,067-byte, 71-page PDF passed upload, workflow indexing, and source rendering. The API smoke test also verified duplicate-job prevention, persisted model retrieval, stale-save rejection, upload limits, and refusal to extract without AI credentials. Browser checks covered drag/drop, mouse resize/rotate, undo, floor creation, save/reload persistence, source-sheet display, and a narrow mobile viewport. These results do not certify hosted integrations or AI extraction accuracy.

Before opening the pilot to customers, use the four private reference sets as a benchmark corpus. Independently annotate source-sheet facts; existing demo geometry is not ground truth. Run multiple providers through `ExtractionProvider` as adapters are added. Local Tesseract assists unreadable sheet titles; [OCR-EVALUATION.md](OCR-EVALUATION.md) describes a zero-LLM native-text/OCR comparison. Specialized paid OCR providers remain a separate evaluation.

```sh
npm run benchmark -- /private/candidate.json /private/annotations.json /private/report.json
```

Annotations contain `facts: [{id,kind,field,expected,tolerance}]`, where kind is `wall`, `opening`, or `level`, and numeric geometry values are millimeters. Optional `expectedCounts`, `correctionMinutes`, and `costUsd` record comparison context. Review the report alongside wall topology, omissions, schedule-instance matching, and source evidence. Do not judge a provider by OCR text accuracy alone.

## Known pilot limits and release gates

- No paid AI accuracy evaluation or hosted Google/Neon/Blob integration is certified until those accounts are configured and end-to-end tests run.
- Automatic geometry is an experimental draft. Scanned/mixed-scale/conflicting drawings may yield incomplete or unplaced elements. Sheet classification and fixed overview/quadrant crops are preprocessing aids, not a trained architectural detector.
- Cross-sheet geometry consolidation is conservative; duplicate layouts, inconsistent levels, and uncertain schedule placements require review. The system deliberately preserves source facts instead of guessing a match.
- The worker streams the source PDF into bounded temporary storage per uncached render. Derived pages are cached, but initial processing of many pages transfers the source repeatedly. Measure worker time/bandwidth on the largest set before raising limits; batch rendering is the next optimization.
- Manual framing placeholders have no structural design or quantity/pricing guarantees. Roof geometry is simple surfaces. Complex roof intersections, BIM/IFC, engineering, estimates, orders, payments, and real-time multi-user editing are outside this pilot.
- Saves are explicit, with unload warnings and revision conflicts. Closing without saving loses pending editor changes. No localStorage is treated as authoritative project data.

An opt-in joint-sheet extraction path combines floor plans, sections, elevations, and roof/schedule evidence into a source-linked editable exterior shell. It is disabled by default (`FRAAIME_SHELL_FUSION=0`); see [EVALUATION.md](EVALUATION.md) for evaluation commands and limitations. Private source PDFs, responses, overlays, and customer models stay outside the repository.

## Unclassified drawing review

Suggested sheets can be processed immediately after indexing finishes. Unclassified pages stay unselected by default and never block generation. Use **Show unselected unclassified pages** to browse optional evidence and select any additional drawings; checking or unchecking an unclassified page saves that choice without a reason prompt. Earlier saved exclusions remain respected. Retry **Read unreadable titles (OCR)** on older uploads to use the v2 title reader, then choose **Use suggested sheets**. Existing model revisions are preserved. See [OCR-EVALUATION.md](OCR-EVALUATION.md) for time limits, test procedure and limitations.

Each PDF shows one latest processing panel. Earlier attempts remain in a collapsed **Processing history** with timestamps, status, progress, cost and errors. Historical attempts cannot start another extraction. If an earlier attempt is still running, history opens to expose its cancel control and the latest run waits for it to finish.
