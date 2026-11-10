import { FatalError } from "workflow";
import {
  countRequestReservation,
  budgetLimitMessage,
} from "../lib/request-budget";
import { processingErrorMessage } from "../lib/processing-error";
import { database, now, uid } from "../lib/db";
import {
  worker,
  pageEvidence,
  type Manifest,
  type PageEvidence,
  TitleOcrSchema,
} from "../lib/worker";
import {
  openAIProvider,
  pricing,
  reserveCost,
  type ExtractedPage,
  ExtractionFailure,
} from "../lib/extraction";
import { limit } from "../lib/config";
import { aiSettings, tokenCost } from "../lib/ai-config";
import {
  extractShell,
  buildShellRequest,
  MAX_SHELL_PAGES,
} from "../lib/shell-provider";
import { SOL_MODEL, usageCost } from "../lib/ai-config";
import {
  assembleStoredResults,
  type ShellResult,
  type StoredResult,
} from "../lib/shell-results";
import {
  extractShellDetail,
  buildShellDetailRequest,
} from "../lib/shell-detail-provider";
import { saveCandidate } from "../lib/revisions";
import { needsTitleOcr, selectionWarnings } from "../lib/sheet-selection";

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
async function updateIndex(
  jobId: string,
  update: (manifest: Manifest | null) => Manifest,
) {
  const db = await database();
  return db.transaction(async (tx) => {
    const current = await tx.query<{ state: string; plan_id: string }>(
      "SELECT j.state,j.plan_id FROM jobs j JOIN projects p ON p.id=j.project_id WHERE j.id=$1 AND p.deleted_at IS NULL FOR UPDATE OF j,p",
      [jobId],
    );
    if (!current.rows[0] || current.rows[0].state === "cancelled")
      throw new FatalError("Job cancelled or project deleted");
    const planId = current.rows[0].plan_id;
    const plan = await tx.query<{ manifest: Manifest | null }>(
      "SELECT manifest FROM plans WHERE id=$1 FOR UPDATE",
      [planId],
    );
    const manifest = update(plan.rows[0].manifest);
    await tx.query("UPDATE plans SET manifest=$1,sha256=$2 WHERE id=$3", [
      JSON.stringify(manifest),
      manifest.sha256,
      planId,
    ]);
    return manifest;
  });
}
async function inspect(jobId: string) {
  "use step";
  const j = await getJob(jobId);
  await phase(jobId, "Inspecting PDF sheets");
  const db = await database();
  const old = await db.query<{ manifest: Manifest | null }>(
    "SELECT manifest FROM plans WHERE id=$1",
    [j.plan_id],
  );
  const native =
    old.rows[0].manifest?.indexingVersion === 1
      ? old.rows[0].manifest
      : await worker<Manifest>("/inspect", j.plan_id);
  const manifest = await updateIndex(jobId, () => ({
    ...native,
    indexingVersion: 1,
    indexingComplete: false,
  }));
  const pages = manifest.sheets
    .filter(needsTitleOcr)
    .map((sheet) => sheet.page);
  console.log("Title indexing", { jobId, ocrPages: pages.length });
  return pages;
}
async function readSheetTitle(
  jobId: string,
  page: number,
  position: number,
  count: number,
) {
  "use step";
  const j = await getJob(jobId);
  const db = await database();
  const result = await db.query<{ manifest: Manifest }>(
    "SELECT manifest FROM plans WHERE id=$1",
    [j.plan_id],
  );
  const sheet = result.rows[0].manifest.sheets.find((s) => s.page === page);
  if (!sheet || !needsTitleOcr(sheet)) return;
  await phase(
    jobId,
    `Reading drawing titles with OCR · ${position}/${count} · page ${page}`,
  );
  console.log("Title OCR", { jobId, page });
  const ocr = TitleOcrSchema.parse(await worker("/ocr", j.plan_id, page));
  await updateIndex(jobId, (current) => ({
    ...current!,
    sheets: current!.sheets.map((s) => (s.page === page ? { ...s, ocr } : s)),
  }));
}
async function finishIndex(jobId: string) {
  "use step";
  await getJob(jobId);
  const manifest = await updateIndex(jobId, (current) => ({
    ...current!,
    indexingComplete: true,
  }));
  const unresolved = manifest.sheets.filter(
    (s) => s.ocr && s.ocr.status !== "complete",
  ).length;
  await (
    await database()
  ).query(
    "UPDATE jobs SET state='needs_selection',phase=$1,error=NULL,updated_at=$2 WHERE id=$3 AND state<>'cancelled'",
    [
      unresolved
        ? `Sheets ready · ${unresolved} OCR titles need review`
        : "Sheets ready · review suggested selection",
      now(),
      jobId,
    ],
  );
}
async function prepare(jobId: string) {
  "use step";
  const j = await getJob(jobId);
  const db = await database();
  const plan = await db.query<{ manifest: Manifest; name: string }>(
    "SELECT p.manifest,pr.name FROM plans p JOIN projects pr ON pr.id=p.project_id WHERE p.id=$1",
    [j.plan_id],
  );
  const calls = await db.query<{ page: number; result: ShellResult | null }>(
    "SELECT page,result FROM ai_calls WHERE job_id=$1",
    [jobId],
  );
  // Existing checkpoints pin the processing mode across retries/config changes.
  const fusion = calls.rows.length
    ? calls.rows.some((c) => c.page === 0)
    : process.env.FRAAIME_SHELL_FUSION === "1";
  if (fusion && (j.pages.length < 2 || j.pages.length > MAX_SHELL_PAGES))
    throw new FatalError(
      `Cross-sheet shell requires 2–${MAX_SHELL_PAGES} selected sheets.`,
    );
  return {
    job: j,
    manifest: plan.rows[0].manifest,
    name: plan.rows[0].name,
    fusion,
    openings:
      fusion &&
      (calls.rows.length
        ? calls.rows.some((c) => c.result?.openingsRequested)
        : process.env.FRAAIME_SHELL_DETAILS === "1"),
    details:
      fusion &&
      (calls.rows.length
        ? calls.rows.some((c) => c.page === -1 || c.result?.detailRequested)
        : process.env.FRAAIME_SHELL_DETAILS === "1"),
  };
}
async function prepareShellPage(jobId: string, page: number) {
  "use step";
  const j = await getJob(jobId);
  await phase(jobId, `Preparing source page ${page}`);
  await pageEvidence(j.plan_id, page);
  // Large image payloads stay in private artifact storage, outside workflow history.
}
async function extractProjectShell(
  jobId: string,
  name: string,
  detailRequested = false,
  detailStage = false,
  openingStage = false,
  openingsRequested = false,
) {
  "use step";
  const j = await getJob(jobId),
    db = await database();
  const checkpoint = openingStage ? -2 : detailStage ? -1 : 0;
  const old = await db.query<{ state: string; result: ShellResult }>(
    "SELECT state,result FROM ai_calls WHERE job_id=$1 AND page=$2",
    [jobId, checkpoint],
  );
  if (old.rows[0]?.state === "complete") return;
  if (old.rows[0])
    throw new FatalError(
      "Previous shell API call has uncertain status. No automatic duplicate charge; review before starting a new job.",
    );
  const pages: PageEvidence[] = [];
  for (const page of j.pages) pages.push(await pageEvidence(j.plan_id, page));
  const base = detailStage
    ? (
        await db.query<{ result: ShellResult }>(
          "SELECT result FROM ai_calls WHERE job_id=$1 AND page=$2 AND state='complete'",
          [jobId, openingStage ? -1 : 0],
        )
      ).rows[0]?.result
    : undefined;
  if (detailStage && (!base || base.kind !== "project-shell"))
    throw new FatalError("Completed base shell required before details.");
  await phase(jobId, "Checking AI input size and budget");
  const estimate = await countRequestReservation(
    detailStage
      ? buildShellDetailRequest(
          pages,
          j.plan_id,
          base!.model,
          base!.draft,
          openingStage,
        )
      : buildShellRequest(pages, j.plan_id, name),
  );
  const reserved = estimate.reservedUsd,
    callId = uid();
  console.log("Shell budget preflight", { jobId, checkpoint, ...estimate });
  await db.transaction(async (tx) => {
    await tx.query("SELECT id FROM spend_lock WHERE id=1 FOR UPDATE");
    const current = await tx.query<{ state: string }>(
      "SELECT state FROM jobs WHERE id=$1",
      [jobId],
    );
    if (current.rows[0]?.state === "cancelled")
      throw new FatalError("Job cancelled");
    const prior = await tx.query(
      "SELECT id FROM ai_calls WHERE job_id=$1 AND page=$2",
      [jobId, checkpoint],
    );
    if (prior.rows.length)
      throw new FatalError(
        "Job already has API checkpoints; no duplicate request made.",
      );
    const monthly = await tx.query<{ total: string }>(
      "SELECT COALESCE(SUM(COALESCE(cost_usd,reserved_usd)),0) AS total FROM ai_calls WHERE created_at >= $1",
      [new Date().toISOString().slice(0, 7) + "-01"],
    );
    const spent = await tx.query<{ total: string }>(
      "SELECT COALESCE(SUM(COALESCE(cost_usd,reserved_usd)),0) AS total FROM ai_calls WHERE job_id=$1",
      [jobId],
    );
    const budgetError = budgetLimitMessage({
      reserved,
      jobSpent: Number(spent.rows[0].total),
      jobBudget: Number(j.budget_usd),
      monthlySpent: Number(monthly.rows[0].total),
      monthlyBudget: limit("MONTHLY_BUDGET_USD", 100),
    });
    if (budgetError) throw new FatalError(budgetError);
    await tx.query(
      "INSERT INTO ai_calls(id,job_id,page,state,reserved_usd,model,created_at) VALUES($1,$2,$3,'started',$4,$5,$6)",
      [callId, jobId, checkpoint, reserved, SOL_MODEL, now()],
    );
  });
  await phase(
    jobId,
    openingStage
      ? "Matching door/window schedules and placing openings"
      : detailStage
        ? "Adding interior/exterior walls and roof surfaces"
        : "Reconciling floor plans, elevations, and sections",
  );
  try {
    const result = detailStage
      ? await extractShellDetail(
          pages,
          j.plan_id,
          base!.model,
          base!.draft,
          openingStage,
        )
      : await extractShell(pages, j.plan_id, name);
    const stored: ShellResult = {
      kind: "project-shell",
      model: result.model,
      draft: detailStage ? base!.draft : (result.draft as ShellResult["draft"]),
      sourcePages: j.pages,
      detailRequested,
      openingsRequested,
      ...(openingStage ? { openingsComplete: true } : {}),
      ...(detailStage
        ? {
            detailDraft: (openingStage
              ? base!.detailDraft
              : result.draft) as NonNullable<ShellResult["detailDraft"]>,
          }
        : {}),
    };
    await db.transaction(async (tx) => {
      await tx.query(
        "UPDATE ai_calls SET state='complete',result=$1,cost_usd=$2,input_tokens=$3,output_tokens=$4,response_id=$5 WHERE id=$6",
        [
          JSON.stringify(stored),
          usageCost(
            result.inputTokens,
            result.outputTokens,
            result.cachedInputTokens,
            SOL_MODEL,
          ),
          result.inputTokens,
          result.outputTokens,
          result.responseId,
          callId,
        ],
      );
      await tx.query(
        "UPDATE jobs SET completed_pages=$1,updated_at=$2 WHERE id=$3",
        [JSON.stringify(j.pages), now(), jobId],
      );
    });
  } catch (error) {
    const details = error instanceof ExtractionFailure ? error.details : null,
      u = details?.usage;
    await db.query(
      "UPDATE ai_calls SET state='uncertain',error=$1,cost_usd=$2,input_tokens=$3,output_tokens=$4,response_id=$5 WHERE id=$6 AND state<>'complete'",
      [
        error instanceof Error ? error.message : "Shell extraction failed",
        u
          ? usageCost(
              u.inputTokens,
              u.outputTokens,
              u.cachedInputTokens,
              SOL_MODEL,
            )
          : null,
        u?.inputTokens ?? null,
        u?.outputTokens ?? null,
        details?.responseId ?? null,
        callId,
      ],
    );
    throw new FatalError(
      "Shell extraction stopped; no automatic duplicate API call will be made.",
    );
  }
}
extractProjectShell.maxRetries = 0;
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
    model = aiSettings().model;
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
    const cost = tokenCost(
      result.inputTokens,
      result.outputTokens,
      rates,
      model,
    );
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
    const usage =
      error instanceof ExtractionFailure ? error.details.usage : null;
    await db.query(
      "UPDATE ai_calls SET state='uncertain',error=$1,cost_usd=$3,input_tokens=$4,output_tokens=$5,response_id=$6 WHERE id=$2",
      [
        error instanceof Error ? error.message : "Extraction failed",
        callId,
        usage
          ? tokenCost(usage.inputTokens, usage.outputTokens, pricing(), model)
          : null,
        usage?.inputTokens ?? null,
        usage?.outputTokens ?? null,
        error instanceof ExtractionFailure ? error.details.responseId : null,
      ],
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
  const { rows } = await db.query<StoredResult>(
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
  const all = p.rows[0].manifest.sheets.map((s) => s.page);
  const model = assembleStoredResults(rows, p.rows[0].name, j.plan_id, all);
  for (const message of selectionWarnings(p.rows[0].manifest, j.pages))
    model.issues.push({
      id: "coverage-missing-sheets",
      elementId: null,
      severity: "error",
      message,
      resolved: false,
      resolution: "",
    });
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
  const { rows } = await db.query<StoredResult>(
    "SELECT page,result FROM ai_calls WHERE job_id=$1 AND state='complete' ORDER BY page",
    [jobId],
  );
  if (rows.length) {
    const p = await db.query<{ manifest: Manifest; name: string }>(
      "SELECT p.manifest,pr.name FROM plans p JOIN projects pr ON pr.id=p.project_id WHERE p.id=$1",
      [j.rows[0].plan_id],
    );
    const m = assembleStoredResults(
      rows,
      p.rows[0].name,
      j.rows[0].plan_id,
      p.rows[0].manifest.sheets.map((s) => s.page),
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
      const pages = await inspect(jobId);
      for (let i = 0; i < pages.length; i++)
        await readSheetTitle(jobId, pages[i], i + 1, pages.length);
      await finishIndex(jobId);
      return;
    }
    const prepared = await prepare(jobId);
    if (prepared.fusion) {
      for (const page of prepared.job.pages)
        await prepareShellPage(jobId, page);
      await extractProjectShell(
        jobId,
        prepared.name,
        prepared.details,
        false,
        false,
        prepared.openings,
      );
      if (prepared.details)
        await extractProjectShell(
          jobId,
          prepared.name,
          true,
          true,
          false,
          prepared.openings,
        );
      if (prepared.openings)
        await extractProjectShell(jobId, prepared.name, true, true, true, true);
      await finish(jobId);
      return;
    }
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
    await fail(jobId, processingErrorMessage(e));
  }
}
