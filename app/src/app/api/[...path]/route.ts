import { z } from "zod";
import { timingSafeEqual } from "node:crypto";
import { actor, projectAccess } from "@/lib/auth";
import { HttpError } from "@/lib/access";
import { route, json } from "@/lib/http";
import { database, audit, uid, now } from "@/lib/db";
import { localMode, limit, required } from "@/lib/config";
import { exampleModel, ModelSchema, validateModel } from "@/lib/model";
import { saveRevision } from "@/lib/revisions";
import {
  readSource,
  writeLocal,
  deleteSource,
  deleteArtifacts,
} from "@/lib/storage";
import {
  worker,
  pageEvidence,
  type Manifest,
  type PageEvidence,
} from "@/lib/worker";
import { pricing } from "@/lib/extraction";
import { processPlan } from "@/workflows/process-plan";
export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";
const terminal = ["failed", "cancelled", "needs_review", "needs_selection"];
const handler = route(async (r) => {
  const parts = new URL(r.url).pathname.replace(/^\/api\//, "").split("/");
  const [resource, id, action] = parts;
  const db = await database();
  if (resource === "worker-source" && r.method === "GET") {
    const expected = process.env.PDF_WORKER_TOKEN,
      actual = r.headers.get("authorization")?.replace(/^Bearer /, "");
    if (
      !expected ||
      !actual ||
      Buffer.byteLength(expected) !== Buffer.byteLength(actual) ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(actual))
    )
      throw new HttpError(401, "Unauthorized worker");
    const p = await db.query<{ storage_key: string }>(
      "SELECT pl.storage_key FROM plans pl JOIN projects p ON p.id=pl.project_id WHERE pl.id=$1 AND p.deleted_at IS NULL",
      [id],
    );
    if (!p.rows[0]) throw new HttpError(404, "Plan missing");
    return readSource(p.rows[0].storage_key);
  }
  const user = await actor();
  if (resource === "session")
    return Response.json({
      user,
      local: localMode(),
      aiConfigured:
        !!process.env.OPENAI_API_KEY &&
        !!process.env.OPENAI_INPUT_USD_PER_MILLION &&
        !!process.env.OPENAI_OUTPUT_USD_PER_MILLION,
      workerConfigured: !!process.env.PDF_WORKER_TOKEN,
    });
  if (resource === "invitations") {
    if (user.role !== "admin")
      throw new HttpError(403, "Administrator required");
    if (r.method === "GET")
      return Response.json(
        (await db.query("SELECT * FROM invitations ORDER BY created_at DESC"))
          .rows,
      );
    const b = z
      .object({
        email: z.email(),
        role: z.enum(["admin", "reviewer", "customer"]),
      })
      .parse(await json(r));
    await db.query(
      "INSERT INTO invitations(email,role,created_at) VALUES($1,$2,$3) ON CONFLICT(email) DO UPDATE SET role=$2",
      [b.email.toLowerCase(), b.role, now()],
    );
    await audit(db, user.email, "pilot.invited", null, {
      email: b.email,
      role: b.role,
    });
    return Response.json({ ok: true });
  }
  if (resource === "projects" && !id) {
    if (r.method === "GET")
      return Response.json(
        (
          await db.query(
            "SELECT p.* FROM projects p WHERE deleted_at IS NULL AND ($1='admin' OR owner_email=$2 OR EXISTS(SELECT 1 FROM memberships m WHERE m.project_id=p.id AND m.email=$2)) ORDER BY created_at DESC",
            [user.role, user.email],
          )
        ).rows,
      );
    if (r.method === "POST") {
      const b = z
        .object({
          name: z.string().trim().min(1).max(120),
          sample: z.boolean().optional(),
        })
        .parse(await json(r));
      const projectId = uid();
      await db.query(
        "INSERT INTO projects(id,name,owner_email,created_at) VALUES($1,$2,$3,$4)",
        [projectId, b.name, user.email, now()],
      );
      await audit(db, user.email, "project.created", projectId);
      if (b.sample)
        await saveRevision(
          db,
          projectId,
          null,
          { ...exampleModel(), name: b.name },
          user.email,
        );
      return Response.json({ id: projectId }, { status: 201 });
    }
  }
  if (resource === "projects" && id) {
    const project =
      r.method === "DELETE"
        ? await (async () => {
            const q = await db.query<{
              id: string;
              name: string;
              owner_email: string;
              head_id: string | null;
            }>("SELECT * FROM projects WHERE id=$1", [id]);
            const p = q.rows[0];
            if (!p || (user.role !== "admin" && p.owner_email !== user.email))
              throw new HttpError(404, "Project not found");
            return p;
          })()
        : await projectAccess(
            id,
            user,
            r.method === "GET"
              ? "read"
              : action === "review"
                ? "review"
                : action === "members" || r.method === "DELETE"
                  ? "manage"
                  : "edit",
          );
    if (r.method === "DELETE") {
      await db.transaction(async (tx) => {
        await tx.query("UPDATE projects SET deleted_at=$1 WHERE id=$2", [
          now(),
          id,
        ]);
        await tx.query(
          "UPDATE jobs SET state='cancelled' WHERE project_id=$1",
          [id],
        );
        await audit(tx, user.email, "project.deleted", id);
      });
      const plans = await db.query<{ id: string; storage_key: string }>(
        "SELECT id,storage_key FROM plans WHERE project_id=$1",
        [id],
      );
      for (const p of plans.rows) {
        await deleteSource(p.storage_key);
        await deleteArtifacts(p.id);
      }
      await db.transaction(async (tx) => {
        await tx.query(
          "DELETE FROM ai_calls WHERE job_id IN(SELECT id FROM jobs WHERE project_id=$1)",
          [id],
        );
        await tx.query("UPDATE projects SET head_id=NULL WHERE id=$1", [id]);
        await tx.query("DELETE FROM revisions WHERE project_id=$1", [id]);
        await tx.query("DELETE FROM jobs WHERE project_id=$1", [id]);
        await tx.query(
          "DELETE FROM page_artifacts WHERE plan_id IN(SELECT id FROM plans WHERE project_id=$1)",
          [id],
        );
        await tx.query("DELETE FROM plans WHERE project_id=$1", [id]);
      });
      return Response.json({ ok: true });
    }
    if (action === "members" && r.method === "POST") {
      const b = z
        .object({ email: z.email(), role: z.enum(["reviewer", "customer"]) })
        .parse(await json(r));
      await db.query(
        "INSERT INTO memberships(project_id,email,role) VALUES($1,$2,$3) ON CONFLICT(project_id,email) DO UPDATE SET role=$3",
        [id, b.email.toLowerCase(), b.role],
      );
      await audit(db, user.email, "project.member", id, b);
      return Response.json({ ok: true });
    }
    if ((action === "model" || action === "review") && r.method === "POST") {
      const b = z
        .object({ baseId: z.string().nullable(), model: ModelSchema })
        .parse(await json(r));
      const revisionId = await saveRevision(
        db,
        id,
        b.baseId,
        b.model,
        user.email,
        action === "review",
      );
      return Response.json({ id: revisionId });
    }
    if (action === "model" && r.method === "GET") {
      const revision =
        new URL(r.url).searchParams.get("revision") || project.head_id;
      if (!revision) return Response.json(null);
      const rows = await db.query(
        "SELECT * FROM revisions WHERE id=$1 AND project_id=$2",
        [revision, id],
      );
      return Response.json(rows.rows[0] ?? null);
    }
    if (r.method === "GET") {
      const [plans, jobs, revisions, members] = await Promise.all([
        db.query(
          "SELECT id,filename,size_bytes,manifest,created_at FROM plans WHERE project_id=$1 ORDER BY created_at DESC",
          [id],
        ),
        db.query(
          "SELECT j.*, (SELECT COALESCE(SUM(COALESCE(cost_usd,reserved_usd)),0) FROM ai_calls c WHERE c.job_id=j.id) AS spend FROM jobs j WHERE project_id=$1 ORDER BY created_at DESC",
          [id],
        ),
        db.query(
          "SELECT id,parent_id,kind,reviewed,author,job_id,created_at FROM revisions WHERE project_id=$1 ORDER BY created_at DESC",
          [id],
        ),
        db.query("SELECT email,role FROM memberships WHERE project_id=$1", [
          id,
        ]),
      ]);
      return Response.json({
        project,
        plans: plans.rows,
        jobs: jobs.rows,
        revisions: revisions.rows,
        members: members.rows,
      });
    }
  }
  if (resource === "uploads" && r.method === "POST") {
    const b = z
      .object({
        projectId: z.string(),
        filename: z
          .string()
          .max(240)
          .regex(/\.pdf$/i),
        size: z
          .number()
          .int()
          .positive()
          .max(limit("MAX_UPLOAD_MB", 120) * 1024 * 1024),
      })
      .parse(await json(r));
    await projectAccess(b.projectId, user, "edit");
    const planId = uid(),
      key = `plans/${planId}/source.pdf`;
    await db.query(
      "INSERT INTO plans(id,project_id,filename,storage_key,size_bytes,created_at) VALUES($1,$2,$3,$4,$5,$6)",
      [planId, b.projectId, b.filename, key, b.size, now()],
    );
    return Response.json({ planId, key, local: localMode() });
  }
  if (resource === "blob-upload" && r.method === "POST") {
    if (localMode()) throw new HttpError(400, "Use local upload endpoint");
    const { handleUpload } = await import("@vercel/blob/client");
    const body = await json(r);
    return Response.json(
      await handleUpload({
        request: r,
        body,
        onBeforeGenerateToken: async (pathname) => {
          const plan = await db.query<{
            id: string;
            project_id: string;
            size_bytes: string;
          }>(
            "SELECT id,project_id,size_bytes FROM plans WHERE storage_key=$1",
            [pathname],
          );
          if (!plan.rows[0]) throw new HttpError(404, "Upload not registered");
          await projectAccess(plan.rows[0].project_id, user, "edit");
          return {
            allowedContentTypes: ["application/pdf"],
            maximumSizeInBytes: Number(plan.rows[0].size_bytes),
            addRandomSuffix: false,
            allowOverwrite: false,
            tokenPayload: JSON.stringify({ planId: plan.rows[0].id }),
          };
        },
      }),
    );
  }
  if (resource === "plans" && id) {
    const p = await db.query<{
      id: string;
      project_id: string;
      storage_key: string;
      size_bytes: string;
      manifest: Manifest;
    }>("SELECT * FROM plans WHERE id=$1", [id]);
    if (!p.rows[0]) throw new HttpError(404, "Plan missing");
    const plan = p.rows[0];
    await projectAccess(
      plan.project_id,
      user,
      r.method === "GET" ? "read" : "edit",
    );
    if (action === "source" && r.method === "GET")
      return readSource(plan.storage_key);
    if (action === "page" && r.method === "GET") {
      const page = z.coerce
        .number()
        .int()
        .positive()
        .max(plan.manifest?.pageCount ?? 0)
        .parse(new URL(r.url).searchParams.get("page"));
      const data = await pageEvidence(id, page);
      return new Response(Buffer.from(data.images[0].base64, "base64"), {
        headers: {
          "Content-Type": "image/jpeg",
          "Cache-Control": "private, no-store",
        },
      });
    }
    if (action === "local" && r.method === "PUT") {
      if (!localMode()) throw new HttpError(403, "Local upload disabled");
      const reader = r.body?.getReader();
      if (!reader) throw new HttpError(400, "Missing PDF");
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (
          size > Number(plan.size_bytes) ||
          size > limit("MAX_UPLOAD_MB", 120) * 1024 * 1024
        ) {
          await reader.cancel();
          throw new HttpError(413, "Upload exceeds limit");
        }
        chunks.push(value);
      }
      const buffer = Buffer.concat(chunks);
      if (
        size !== Number(plan.size_bytes) ||
        buffer.subarray(0, 5).toString() !== "%PDF-"
      )
        throw new HttpError(400, "File is not a valid PDF upload");
      await writeLocal(plan.storage_key, buffer);
      return Response.json({ ok: true });
    }
    if (action === "complete" && r.method === "POST") {
      if (!process.env.PDF_WORKER_TOKEN)
        throw new HttpError(
          503,
          "Configure the PDF worker before processing uploads.",
        );
      if (!localMode()) {
        const { head } = await import("@vercel/blob");
        const blob = await head(plan.storage_key);
        if (blob.size !== Number(plan.size_bytes))
          throw new HttpError(
            400,
            "Uploaded size does not match registered file",
          );
      }
      const project = await projectAccess(plan.project_id, user, "edit");
      const prepared = await db.transaction(async (tx) => {
        await tx.query("SELECT id FROM spend_lock WHERE id=1 FOR UPDATE");
        await tx.query("SELECT id FROM plans WHERE id=$1 FOR UPDATE", [id]);
        const existing = await tx.query<{ id: string }>(
          "SELECT id FROM jobs WHERE plan_id=$1 ORDER BY created_at DESC LIMIT 1",
          [id],
        );
        if (existing.rows[0])
          return { jobId: existing.rows[0].id, existing: true };
        const active = await tx.query<{ count: string }>(
          "SELECT COUNT(*) AS count FROM jobs WHERE state IN ('preparing','extracting')",
        );
        if (Number(active.rows[0].count) >= limit("MAX_ACTIVE_JOBS", 2))
          throw new HttpError(
            429,
            "Processing capacity is busy. Retry indexing shortly.",
          );
        const jobId = uid();
        await tx.query(
          "INSERT INTO jobs(id,project_id,plan_id,state,phase,budget_usd,base_head,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8)",
          [
            jobId,
            plan.project_id,
            id,
            "preparing",
            "Queued for inspection",
            limit("JOB_BUDGET_USD", 10),
            project.head_id,
            now(),
          ],
        );
        return { jobId, existing: false };
      });
      const { jobId } = prepared;
      if (prepared.existing) return Response.json({ jobId });
      const { start } = await import("workflow/api");
      try {
        const run = await start(processPlan, [jobId, "inspect"]);
        await db.query("UPDATE jobs SET run_id=$1 WHERE id=$2", [
          run.runId,
          jobId,
        ]);
      } catch {
        await db.query(
          "UPDATE jobs SET state='failed',error='Could not start inspection workflow' WHERE id=$1",
          [jobId],
        );
        throw new HttpError(
          503,
          "Could not start inspection; retry from the project.",
        );
      }
      await audit(db, user.email, "plan.uploaded", plan.project_id, {
        planId: id,
        jobId,
      });
      return Response.json({ jobId });
    }
  }
  if (resource === "jobs" && id && r.method === "POST") {
    const q = await db.query<{
      id: string;
      project_id: string;
      plan_id: string;
      state: string;
      run_id: string | null;
      pages: number[];
    }>("SELECT * FROM jobs WHERE id=$1", [id]);
    let j = q.rows[0];
    if (!j) throw new HttpError(404, "Job missing");
    await projectAccess(j.project_id, user, "edit");
    if (action === "cancel") {
      await db.query(
        "UPDATE jobs SET state='cancelled',phase='Cancelled',updated_at=$1 WHERE id=$2",
        [now(), id],
      );
      if (j.run_id) {
        const { getRun } = await import("workflow/api");
        await getRun(j.run_id)
          .cancel()
          .catch(() => {});
      }
      return Response.json({ ok: true });
    }
    if (action === "run" || action === "retry" || action === "new") {
      if (j.state === "needs_review" || action === "new") {
        if (!terminal.includes(j.state))
          throw new HttpError(409, "Cancel the active job first.");
        const newId = uid(),
          p = await projectAccess(j.project_id, user, "edit");
        await db.query(
          "INSERT INTO jobs(id,project_id,plan_id,state,phase,budget_usd,base_head,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8)",
          [
            newId,
            j.project_id,
            j.plan_id,
            "needs_selection",
            "Choose source sheets",
            limit("JOB_BUDGET_USD", 10),
            p.head_id,
            now(),
          ],
        );
        j = {
          ...j,
          id: newId,
          state: "needs_selection",
          run_id: null,
          pages: [],
        };
      }
      const targetId = j.id;
      if (!terminal.includes(j.state))
        throw new HttpError(409, "Job is already running");
      const b = z
        .object({
          pages: z
            .array(z.number().int().positive())
            .max(limit("MAX_AI_PAGES", 30))
            .optional(),
        })
        .parse(await json(r));
      const plan = await db.query<{ manifest: Manifest | null }>(
        "SELECT manifest FROM plans WHERE id=$1",
        [j.plan_id],
      );
      const mode = plan.rows[0].manifest ? "extract" : "inspect";
      if (mode === "extract") {
        if (!process.env.OPENAI_API_KEY)
          throw new HttpError(
            503,
            "OpenAI is not configured. Your PDF remains available.",
          );
        pricing();
      }
      const pages = [...new Set(b.pages ?? j.pages)];
      if (
        mode === "extract" &&
        (!pages.length ||
          pages.some((n) => n > (plan.rows[0].manifest?.pageCount ?? 0)))
      )
        throw new HttpError(400, "Choose valid source pages");
      await db.transaction(async (tx) => {
        await tx.query("SELECT id FROM spend_lock WHERE id=1 FOR UPDATE");
        const active = await tx.query<{ count: string }>(
          "SELECT COUNT(*) AS count FROM jobs WHERE state IN ('preparing','extracting')",
        );
        if (Number(active.rows[0].count) >= limit("MAX_ACTIVE_JOBS", 2))
          throw new HttpError(
            429,
            "Processing capacity is busy. Try again shortly.",
          );
        const locked = await tx.query<{ state: string }>(
          "SELECT state FROM jobs WHERE id=$1 FOR UPDATE",
          [targetId],
        );
        if (!terminal.includes(locked.rows[0].state))
          throw new HttpError(409, "Job already running");
        await tx.query(
          "UPDATE jobs SET state=$1,phase=$2,pages=$3,error=NULL,updated_at=$4 WHERE id=$5",
          [
            mode === "extract" ? "extracting" : "preparing",
            "Queued",
            JSON.stringify(pages),
            now(),
            targetId,
          ],
        );
      });
      const { start } = await import("workflow/api");
      try {
        const run = await start(processPlan, [targetId, mode]);
        await db.query("UPDATE jobs SET run_id=$1 WHERE id=$2", [
          run.runId,
          targetId,
        ]);
      } catch {
        await db.query(
          "UPDATE jobs SET state='failed',error='Workflow dispatch failed' WHERE id=$1",
          [targetId],
        );
        throw new HttpError(503, "Workflow dispatch failed; retry this job.");
      }
      return Response.json({ ok: true });
    }
  }
  throw new HttpError(404, "Endpoint not found");
});
export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
