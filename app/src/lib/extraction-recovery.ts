import { audit, now, uid, type Queryable } from "./db";
import { HttpError } from "./access";

type Checkpoint = Record<string, unknown> & {
  id: string;
  page: number;
  state: string;
  error: string | null;
  response_id: string | null;
  output_tokens: number | null;
  cost_usd: string | number | null;
  reserved_usd: string | number;
  result: {
    kind?: string;
    failure?: { status?: string; reason?: string };
  } | null;
};
/** A terminal truncation is recoverable; a dropped stream is not proof it stopped. */
export function isOutputLimitedOpening(call: Checkpoint): boolean {
  if (
    call.page !== -2 ||
    !["failed", "uncertain"].includes(call.state) ||
    !call.response_id ||
    call.cost_usd === null ||
    !Number.isFinite(Number(call.cost_usd))
  )
    return false;
  if (call.result?.failure)
    return (
      call.result.failure.status === "incomplete" &&
      call.result.failure.reason === "max_output_tokens"
    );
  // Compatibility with the release that discarded the provider's failure reason.
  return (
    call.error === "Detail response incomplete." && call.output_tokens === 24000
  );
}

/** Caller holds spend_lock and the source job lock. Keep the original ledger intact. */
export async function resumeCompletedStages(
  tx: Queryable,
  jobId: string,
  email: string,
) {
  const job = (
    await tx.query<{
      id: string;
      project_id: string;
      plan_id: string;
      state: string;
      pages: number[];
      budget_usd: string;
      base_head: string | null;
    }>("SELECT * FROM jobs WHERE id=$1 FOR UPDATE", [jobId])
  ).rows[0];
  if (!job || job.state !== "failed") return null;
  const calls = (
    await tx.query<Checkpoint>(
      "SELECT * FROM ai_calls WHERE job_id=$1 ORDER BY page FOR UPDATE",
      [jobId],
    )
  ).rows;
  const unfinished = calls.filter((c) => c.state !== "complete");
  if (!unfinished.length) return null;
  if (unfinished.length !== 1 || !isOutputLimitedOpening(unfinished[0]))
    throw new HttpError(
      409,
      "The previous AI call has an unknown or non-recoverable result. No duplicate call was made. Review the attempt before starting a separate extraction.",
    );
  const completed = calls.filter((c) => c.state === "complete");
  if (
    completed.length !== 2 ||
    !completed.some((c) => c.page === 0) ||
    !completed.some((c) => c.page === -1) ||
    completed.some((c) => c.result?.kind !== "project-shell")
  )
    throw new HttpError(
      409,
      "The saved shell and wall/roof checkpoints are incomplete; cannot resume only the opening stage.",
    );
  const prior = await tx.query<{ detail: { resumedJobId?: string } }>(
    "SELECT detail FROM audit WHERE action='job.resumed' AND detail->>'sourceJobId'=$1 LIMIT 1",
    [jobId],
  );
  if (prior.rows.length)
    throw new HttpError(
      409,
      "This attempt already has a resumed extraction. Use the latest processing panel.",
    );
  const spent = calls.reduce(
    (sum, c) => sum + Number(c.cost_usd ?? c.reserved_usd),
    0,
  );
  const budget = Number(job.budget_usd) - spent;
  if (!Number.isFinite(budget) || budget <= 0)
    throw new HttpError(
      409,
      "This attempt has no remaining budget for a resumed stage.",
    );
  const id = uid(),
    stamp = now();
  await tx.query(
    "INSERT INTO jobs(id,project_id,plan_id,state,phase,pages,budget_usd,base_head,created_at,updated_at) VALUES($1,$2,$3,'extracting','Queued · reusing saved shell and walls/roofs',$4,$5,$6,$7,$7)",
    [
      id,
      job.project_id,
      job.plan_id,
      JSON.stringify(job.pages),
      budget,
      job.base_head,
      stamp,
    ],
  );
  for (const call of completed)
    await tx.query(
      "INSERT INTO ai_calls(id,job_id,page,state,reserved_usd,cost_usd,input_tokens,output_tokens,model,result,response_id,created_at) SELECT $1,$2,page,'complete',0,0,0,0,model,result,response_id,$3 FROM ai_calls WHERE id=$4",
      [uid(), id, stamp, call.id],
    );
  await audit(tx, email, "job.resumed", job.project_id, {
    sourceJobId: jobId,
    resumedJobId: id,
    reusedCheckpoints: [0, -1],
    previousCostUsd: spent,
    remainingBudgetUsd: budget,
  });
  return id;
}
