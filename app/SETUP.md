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
| Function duration | 300 seconds | 300 seconds |

Do not select the FastAPI preset for the worker: the Dockerfile installs Poppler. Confirm Container Runtime availability in the target account. Keep the same worker portable if another container host is needed.

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
| `OPENAI_MODEL` | Web | `gpt-4.1` baseline, configurable |
| `OPENAI_INPUT_USD_PER_MILLION` | Web | Verified current model input token price |
| `OPENAI_OUTPUT_USD_PER_MILLION` | Web | Verified current model output token price |
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
