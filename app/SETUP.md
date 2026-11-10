# Vercel launch checklist

This public repository contains reusable code and synthetic fixtures only. Existing local projects are not transferred by deployment. Never upload the parent workspace, `.local`, environment files, customer plans, model exports, or screenshots as deployment source.

## 1. Connect GitHub and configure two projects

Keep existing Vercel login connections intact while choosing the importing identity. For the personally owned `dynetk/fraaime` repository, the importing Vercel user must be linked to its owner, `dynetk`; collaborator access from another personal GitHub account is insufficient. A separate Vercel user linked to `dynetk` can join the intended Pro team, subject to its membership/billing terms. Alternatively, an explicitly approved move to a GitHub organization permits import by an organization owner or member with the required repository access. Do not transfer the repository merely to complete setup. See [Vercel's repository permission requirements](https://vercel.com/docs/git/vercel-for-github#check-your-repository-permissions).

With the correct identity, open GitHub Settings → Applications → Installed GitHub Apps → Vercel → Configure and grant access to `fraaime`. In each existing Vercel project's Settings → Git, connect `dynetk/fraaime`. Use `main` as the production branch. CLI/API source deployments can be used independently, but do not establish automatic deployments from GitHub pushes.

| Setting | Web application | PDF preparation service |
| --- | --- | --- |
| Suggested project name | `fraaime` | `fraaime-pdf-worker` |
| Root Directory | `app` | `app/worker` |
| Framework | Next.js | Container (explicitly select it) |
| Runtime | Node.js 24.x | Python 3.12 in Dockerfile |
| Install / build | `npm ci` / `npm run build` | Dockerfile |
| Function region | `sfo1` | `sfo1` |
| Function duration | API 300 seconds; Workflow uses host maximum, at least 800 seconds | 300 seconds |

Do not select the FastAPI preset for the worker: the Dockerfile installs Poppler. Confirm Container Runtime availability in the target account. Keep the same worker portable if another container host is needed.

These root directories apply to full-repository Git deployments. For an API/file deployment containing only the contents of `app`, clear the web project's Root Directory and upload those contents at the deployment root. Do not prefix them with `app/` again. The current web release uses this isolated file bundle; the worker uses its `app/worker` root. Before switching to Git-based deployment, restore the web root to `app`. The post-build check refuses a release missing the dashboard, API, or Workflow route.

## 2. Configure storage and identity

- **Neon:** Vercel project → Storage → Create Database → Neon. Choose a region near the app, connect it to the web project, and verify that `DATABASE_URL` contains the pooled PostgreSQL connection string. Review the provider plan before activating it. Use a separate database/branch for previews; do not connect arbitrary preview builds to production customer data.
- **Database schema:** Open the new database's SQL editor and run all of [`db/schema.sql`](db/schema.sql). Alternatively run the migration script below. Do this before the first login. Schema setup is deliberately not part of every build/request.
- **Clerk:** Create an application, enable Google login, configure production OAuth credentials using Clerk's displayed callback URL, and set the web app's two Clerk keys. Production Clerk setup may require a custom application domain and DNS configuration. Add the first administrator's verified Google email to `ADMIN_EMAILS`.
- **Private Blob:** Create/connect a store with **private** access. The current deployment configuration uses the provisioned `BLOB_READ_WRITE_TOKEN`. Confirm the store is attached to the web project. A connected store is not a database.

## 3. Set environment variables

Enter secrets in Vercel Settings → Environment Variables as Secret/Sensitive values. Do not paste secrets into chat or commit them. Set production values first; configure independent preview resources before enabling preview processing. Changes apply on the next deployment.

| Variable | Where | Value/source |
| --- | --- | --- |
| `FRAAIME_LOCAL_MODE` | Web | `0` |
| `DATABASE_URL` | Web | Neon pooled connection string |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Web | Clerk publishable key (public) |
| `CLERK_SECRET_KEY` | Web | Clerk secret key |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | Web | `/sign-in` |
| `ADMIN_EMAILS` | Web | Comma-separated verified administrator email(s) |
| `BLOB_READ_WRITE_TOKEN` | Web | Private store integration |
| `APP_ORIGIN` | Both | Final stable HTTPS web origin, no trailing slash |
| `PDF_WORKER_URL` | Web | Final stable HTTPS worker origin |
| `PDF_WORKER_TOKEN` | Both | The same new strong random secret; different from local development |
| `PORT` | Worker | `8000` |
| `OPENAI_API_KEY` | Web | Project-scoped OpenAI key |
| `OPENAI_MODEL` | Web | Candidate: `gpt-6.1-sol`; promote only after private evaluation |
| `OPENAI_REASONING_EFFORT` | Web | `medium` |
| `OPENAI_INPUT_USD_PER_MILLION` | Web | `2`, Sol standard input price verified 2026-11-09 |
| `OPENAI_OUTPUT_USD_PER_MILLION` | Web | `10`, includes reasoning tokens; verified 2026-11-09 |
| `JOB_BUDGET_USD` / `MONTHLY_BUDGET_USD` | Web | `10` / `100` pilot caps |
| `MAX_ACTIVE_JOBS` | Web | `2` |
| `MAX_UPLOAD_MB` / `MAX_PDF_PAGES` / `MAX_AI_PAGES` | Web | `120` / `150` / `30` |

Generate the worker secret with a secure password manager or `openssl rand -hex 32`. Keep it server-side. The model choice is not a claim of plan-reading accuracy. Paid extraction remains disabled until a key and valid prices are present.

Vercel Deployment Protection is separate from Clerk and worker bearer authentication. Its default login wall can block calls from the app to the worker, the worker back to the app, and Blob callbacks. For production, use reachable stable domains with protection settings appropriate for an invited-user app; retain Clerk, project authorization, and the worker token. If platform protection must remain on those endpoints, implement and test its supported machine-to-machine bypass before processing PDFs. This code does not currently inject Vercel protection-bypass headers. Do not assume a successful build proves these calls work.

## 4. Migrate without replacing local development settings

The SQL editor is the simplest initial path. For a CLI migration, create an ignored `app/.env.hosted.local` containing only `FRAAIME_LOCAL_MODE=0` and the intended `DATABASE_URL`, then run from `app`:

```sh
node --env-file=.env.hosted.local --import tsx scripts/migrate.ts
```

Do not overwrite `.env.local`; it belongs to the existing local demo environment. Vercel's env pull may omit Secret values, so confirm the intended database is configured before running a migration. Never enable local mode to work around hosted authentication setup.

## 5. Deploy and verify

1. Deploy both projects from the same reviewed Git commit; wait for **Ready**.
2. Set both stable origins and redeploy after adding credentials/configuration.
3. Confirm worker `/health` succeeds and unauthenticated `/inspect` is denied.
4. Sign in with the invited admin Google account. Create a **synthetic** sample, edit a stud, save, reload, and verify persistence.
5. Upload a synthetic PDF, inspect its sheets, run extraction with a small budget, review evidence, save an edit, and reopen it.
6. Test cross-project access denial, retries/cancellation, large uploads, and source rendering before uploading customer plans. Confirm backups, restore procedure, and provider data retention.
7. Grant pilot access and project membership to the owners. These actions do not send invitations by email.

A configuration page or a Vercel Ready build is not an operational PDF-to-model pilot. Google sign-in, Neon schema, private storage, service-to-service requests, Workflow dispatch, and AI extraction must all be checked on the deployed environment.

For implementation details, API contracts, evaluation, and remaining limitations, see the [application README](README.md).

### Experimental joint-sheet shell

The reviewed pilot release enables `FRAAIME_SHELL_FUSION=1` for new 2–8-sheet jobs using Sol medium. Select floor plans together with sections/elevations; roof plans and schedules are supporting sheets. This mode uses its own fixed Sol pricing and still honors job/account spending limits. Deploy the version 2 PDF worker and updated private artifact storage code together with the app. See [EVALUATION.md](EVALUATION.md) for the private test runner, limits, and promotion gates. A saved model remains a draft until source geometry, local height variations, roof completeness, and openings have been reviewed.


The reviewed pilot also enables `FRAAIME_SHELL_DETAILS=1` for the interior-wall/roof pass. It adds a second Sol call and an independent budget checkpoint, preserves the base shell on failure, and stores roof holes and approximation notes in editable models. Configure Fluid Compute with an 800-second function default; the generated Workflow handler requests the host maximum, allowing the ten-minute detail API timeout plus persistence overhead. The web route only enqueues jobs. Confirm the built Workflow function's duration before release. See EVALUATION.md for comparison and timeout-cost handling. Set both flags to `0` and redeploy to disable this path for new jobs; existing checkpoints retain their processing mode.

### Workflow deployment compatibility

Set `NEXT_ENABLE_ADAPTER=0` in Vercel Production for this release so the standard Next.js builder consumes function metadata. Hosted builds could not resolve the SDK-generated route source, dropping the queue consumer and causing `WORKFLOW_CONSUMER_NOT_REGISTERED`. The Vercel build command runs `scripts/prepare-workflow-deployment.mjs` after Next compiles. It validates the compiled handler and writes the installed SDK's queue trigger and an 800-second duration into Next's function manifest. It fails closed if the handler or expected manifest format is missing. The Build Output API requires the SDK's `consumer` field; the public `vercel.json` queue v2 schema omits that field. Recheck consumer registration and a complete hosted job before removing this compatibility step or upgrading Next.js/Workflow.


### Automatic source-sheet suggestions

After indexing, new uploads preselect detected floor plans, sections, elevations,
and roof plans. Shell extraction accepts up to eight sheets: suggestions keep all
floor plans, then distribute available slots across the three supporting types.
Large sets show an omission notice; no floor is silently dropped, even if the floor
set itself exceeds the limit. Standalone drawing titles take precedence over incidental keywords in notes and legends. Scanned or unreadable titles may require correction. Local checks selected six shell sheets for Santa Barbara, six for Loma Vista, and eight for Wald. For unreadable native titles, the indexing workflow now runs local Tesseract OCR in the PDF worker before suggesting sheets. Galloway is included in the private OCR evaluation.
Use **Use suggested sheets** to refresh an existing selection. Manual choices and
previous extraction selections take precedence until that button is used.
Suggestions are a starting point, not a guarantee that every necessary drawing is included.

### Inviting addresses from any email provider

Production Clerk has email sign-up, email verification at sign-up, and email-code
sign-in enabled alongside Google. An administrator can use **Grant pilot access**
with any email provider, then share the app URL. This action grants access in the
application; it does not send an invitation email. Users verify the same address
that was granted access. Use project sharing separately for existing projects.
Keep the application invitation check enabled; enabling email sign-in does not
make customer projects public or grant every signed-in user pilot access.


### Title OCR during PDF indexing

The PDF worker image includes Poppler, Tesseract 5, and English language data.
No OpenAI key or third-party OCR account is needed for title recognition. Vercel
worker compute and storage/network usage still apply; this is not a claim of zero
hosting cost. The separate shell-generation step continues to use the configured AI model.

New uploads first inspect native text, then OCR only sheets without a recognizable
drawing title. Each page is a durable Workflow step. OCR starts with the title-block
area, falls back to the page, and tries other orientations within a time limit.
Recognized lines retain confidence, normalized region, and OCR rotation separately
from native PDF text. They help choose sheets; they do not supply verified dimensions
or replace model/source review. Low-confidence results remain unclassified.

Completed OCR is checkpointed in the private plan manifest. Resumes skip completed
pages; failures are visible per sheet. Cancellation and project deletion prevent late
OCR results from being saved. Each request reuses the protected worker-source route;
no OCR route or customer source becomes public. Deploy the updated worker before the
web application. `/health` should report `titleOcrVersion: 1` and
`titleOcrAvailable: true`.

Existing uploads can use **Read unreadable titles (OCR)** in Source sheets. This
starts a fresh indexing job, updates suggested selection, and preserves saved model
revisions. **Use suggested sheets** remains available after manual adjustments.
Unreadable scans can still require manual selection; the eight-sheet shell limit
still applies. No automatic paid extraction is started by indexing or reindexing.

For local development, install `tesseract` and its English language data on PATH, or
set `TESSERACT_CMD` to an executable path. The development launcher also recognizes
an isolated runtime at `app/.local/ocr-runtime/env/bin/tesseract`. Run
`TESSERACT_CMD=/path/to/tesseract worker/.venv/bin/python -m pytest worker/tests -q`
from `app` to include the rotated-scan integration tests. Missing-engine failures
are explicit and manual sheet selection remains available.
