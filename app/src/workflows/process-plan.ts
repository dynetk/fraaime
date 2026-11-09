import { FatalError, RetryableError } from "workflow";
import { database, now, uid, audit } from "../lib/db";
import {
  worker,
  pageEvidence,
  type Manifest,
  type PageEvidence,
} from "../lib/worker";
import {
  assemble,
  openAIProvider,
  pricing,
  reserveCost,
  type ExtractedPage,
} from "../lib/extraction";
import { limit } from "../lib/config";
import { saveCandidate } from "../lib/revisions";

type Job = {
  id: string;
  project_id: string;
  plan_id: string;
  state: string;
  pages: number[];
  base_head: string | null;
  budget_usd: number;
};
async function getJob(id: string) {
  const db = await database();
  const { rows } = await db.query<Job & Record<string, unknown>>(
    "SELECT j.* FROM jobs j JOIN projects p ON p.id=j.project_id WHERE j.id=$1 AND p.deleted_at IS NULL",
    [id],
  );
  const j = rows[0];
  if (!j || j.state === "cancelled")
    throw new FatalError("Job cancelled or project deleted");
  return j;
}
async function phase(id: string, value: string) {
  await (
    await database()
  ).query("UPDATE jobs SET phase=$1,updated_at=$2 WHERE id=$3 AND state<>$4", [
    value,
    now(),
    id,
    "cancelled",
  ]);
}
async function inspect(jobId: string) {
  "use step";
  const j = await getJob(jobId);
  await phase(jobId, "Inspecting PDF sheets");
  const manifest = await worker<Manifest>("/inspect", j.plan_id);
  await (
    await database()
  ).transaction(async (tx) => {
    await tx.query("UPDATE plans SET manifest=$1,sha256=$2 WHERE id=$3", [
      JSON.stringify(manifest),
      manifest.sha256,
      j.plan_id,
    ]);
    await tx.query(
      "UPDATE jobs SET state='needs_selection',phase='Choose source sheets',updated_at=$1 WHERE id=$2 AND state<>'cancelled'",
      [now(), jobId],
    );
  });
}
async function prepare(jobId: string) {
  "use step";
  const j = await getJob(jobId);
  const db = await database();
  const plan = await db.query<{ manifest: Manifest; name: string }>(
    "SELECT p.manifest,pr.name FROM plans p JOIN projects pr ON pr.id=p.project_id WHERE p.id=$1",
    [j.plan_id],
  );
  return { job: j, manifest: plan.rows[0].manifest, name: plan.rows[0].name };
}
async function extractPage(jobId: string, page: number, context: string) {
  "use step";
  const j = await getJob(jobId);
  const db = await database();
  const old = await db.query<{ state: string; result: ExtractedPage }>(
    "SELECT state,result FROM ai_calls WHERE job_id=$1 AND page=$2",
    [jobId, page],
  );
  if (old.rows[0]?.state === "complete") return old.rows[0].result;
  if (old.rows[0])
    throw new FatalError(
      `Page ${page} has an uncertain previous API call. It will not be charged again automatically. Review the run before starting a new job.`,
    );
  await phase(jobId, `Reading page ${page}`);
  const evidence = await pageEvidence(j.plan_id, page);
  const reserved = reserveCost(evidence, context);
  const callId = uid(),
    model = process.env.OPENAI_MODEL || "gpt-4.1";
  await db.transaction(async (tx) => {
    await tx.query("SELECT id FROM spend_lock WHERE id=1 FOR UPDATE");
    const current = await tx.query<{ state: string }>(
      "SELECT state FROM jobs WHERE id=$1",
      [jobId],
    );
    if (current.rows[0].state === "cancelled")
      throw new FatalError("Job cancelled");
    const monthly = await tx.query<{ total: string }>(
      "SELECT COALESCE(SUM(COALESCE(cost_usd,reserved_usd)),0) AS total FROM ai_calls WHERE created_at >= $1",
      [new Date().toISOString().slice(0, 7) + "-01"],
    );
    const spend = await tx.query<{ total: string }>(
      "SELECT COALESCE(SUM(COALESCE(cost_usd,reserved_usd)),0) AS total FROM ai_calls WHERE job_id=$1",
      [jobId],
    );
    if (
      Number(monthly.rows[0].total) + reserved >
        limit("MONTHLY_BUDGET_USD", 100) ||
      Number(spend.rows[0].total) + reserved > Number(j.budget_usd)
    )
      throw new FatalError(
        `Budget limit reached before page ${page}. Completed pages remain available.`,
      );
    await tx.query(
      "INSERT INTO ai_calls(id,job_id,page,state,reserved_usd,model,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [callId, jobId, page, "started", reserved, model, now()],
    );
  });
  try {
    const result = await openAIProvider().extract(evidence, j.plan_id, context);
    const rates = pricing();
    const cost =
      (result.inputTokens * rates.input + result.outputTokens * rates.output) /
      1e6;
    await db.transaction(async (tx) => {
      await tx.query(
        "UPDATE ai_calls SET state='complete',result=$1,cost_usd=$2,input_tokens=$3,output_tokens=$4,response_id=$5 WHERE id=$6",
        [
          JSON.stringify(result.data),
          cost,
          result.inputTokens,
          result.outputTokens,
          result.responseId,
          callId,
        ],
      );
      await tx.query(
        "UPDATE jobs SET completed_pages=completed_pages || $1::jsonb,updated_at=$2 WHERE id=$3",
        [JSON.stringify([page]), now(), jobId],
      );
    });
    return result.data;
  } catch (error) {
    await db.query(
      "UPDATE ai_calls SET state='uncertain',error=$1 WHERE id=$2",
      [error instanceof Error ? error.message : "Extraction failed", callId],
    );
    throw new FatalError(
      `Page ${page} extraction failed. No automatic duplicate API call will be made.`,
    );
  }
}
extractPage.maxRetries = 2;
async function finish(jobId: string) {
  "use step";
  const j = await getJob(jobId),
    db = await database();
  const { rows } = await db.query<{ page: number; result: ExtractedPage }>(
    "SELECT page,result FROM ai_calls WHERE job_id=$1 AND state='complete' ORDER BY page",
    [jobId],
  );
  const p = await db.query<{ manifest: Manifest; name: string }>(
    "SELECT p.manifest,pr.name FROM plans p JOIN projects pr ON pr.id=p.project_id WHERE p.id=$1",
    [j.plan_id],
  );
  if (!rows.length)
    throw new FatalError("No usable page results were returned.");
  await phase(jobId, "Validating model");
  const all = p.rows[0].manifest.sheets.map((s) => s.page),
    done = new Set(rows.map((r) => r.page));
  const model = assemble(
    rows,
    p.rows[0].name,
    j.plan_id,
    all.filter((n) => !done.has(n)),
  );
  await saveCandidate(db, j.project_id, jobId, j.base_head, model);
  await db.query(
    "UPDATE jobs SET state='needs_review',phase='Draft ready for review',updated_at=$1 WHERE id=$2 AND state<>'cancelled'",
    [now(), jobId],
  );
}
async function fail(jobId: string, message: string) {
  "use step";
  const db = await database();
  await db.query(
    "UPDATE jobs SET state='failed',phase='Processing stopped',error=$1,updated_at=$2 WHERE id=$3 AND state<>'cancelled'",
    [message.slice(0, 1500), now(), jobId],
  );
  // Preserve partial schedules and geometry if later pages failed.
  const j = await db.query<{
    project_id: string;
    plan_id: string;
    base_head: string | null;
    state: string;
  }>("SELECT * FROM jobs WHERE id=$1", [jobId]);
  if (!j.rows[0] || j.rows[0].state === "cancelled") return;
  const { rows } = await db.query<{ page: number; result: ExtractedPage }>(
    "SELECT page,result FROM ai_calls WHERE job_id=$1 AND state='complete' ORDER BY page",
    [jobId],
  );
  if (rows.length) {
    const p = await db.query<{ manifest: Manifest; name: string }>(
      "SELECT p.manifest,pr.name FROM plans p JOIN projects pr ON pr.id=p.project_id WHERE p.id=$1",
      [j.rows[0].plan_id],
    );
    const m = assemble(
      rows,
      p.rows[0].name,
      j.rows[0].plan_id,
      p.rows[0].manifest.sheets
        .map((s) => s.page)
        .filter((n) => !rows.some((r) => r.page === n)),
    );
    m.issues.push({
      id: "partial-run",
      elementId: null,
      severity: "error",
      message: "Processing stopped early: " + message,
      resolved: false,
      resolution: "",
    });
    await saveCandidate(
      db,
      j.rows[0].project_id,
      jobId,
      j.rows[0].base_head,
      m,
      true,
    );
  }
}
export async function processPlan(jobId: string, mode: "inspect" | "extract") {
  "use workflow";
  try {
    if (mode === "inspect") {
      await inspect(jobId);
      return;
    }
    const prepared = await prepare(jobId);
    let context = "";
    for (const page of prepared.job.pages) {
      const result = await extractPage(jobId, page, context);
      context = JSON.stringify({
        levels: result.model.levels.map((l) => ({
          id: l.id,
          label: l.label,
          elevation: l.elevation,
        })),
        sheet: result.sheet,
      }).slice(0, 20000);
    }
    await finish(jobId);
  } catch (e) {
    await fail(jobId, e instanceof Error ? e.message : "Processing failed");
  }
}
