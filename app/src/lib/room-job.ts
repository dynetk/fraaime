import { z } from "zod";
import { type Database, uid, now, audit } from "./db";
import { ModelSchema } from "./model";
import { HttpError } from "./access";
import { limit } from "./config";
import type { ShellResult } from "./shell-results";
import type { Manifest } from "./worker";
import { MAX_SHELL_PAGES } from "./shell-provider";
const Request = z.object({
  revisionId: z.string().min(1),
  pages: z.array(z.number().int().positive()).min(2).max(MAX_SHELL_PAGES),
});
/** Caller checks edit permission. Revision and calibration are re-scoped here too. */
export async function createRoomJob(
  db: Database,
  projectId: string,
  planId: string,
  email: string,
  input: unknown,
) {
  const b = Request.parse(input);
  return db.transaction(async (tx) => {
    await tx.query("SELECT id FROM spend_lock WHERE id=1 FOR UPDATE");
    const p = (
      await tx.query<{ manifest: Manifest }>(
        "SELECT manifest FROM plans WHERE id=$1 AND project_id=$2",
        [planId, projectId],
      )
    ).rows[0];
    const revision = (
      await tx.query<{ model: unknown }>(
        "SELECT model FROM revisions WHERE id=$1 AND project_id=$2",
        [b.revisionId, projectId],
      )
    ).rows[0];
    if (!p || !revision)
      throw new HttpError(404, "Saved model or PDF missing from this project.");
    if (
      !p.manifest ||
      p.manifest.indexingComplete === false ||
      b.pages.some((n) => n > p.manifest.pageCount)
    )
      throw new HttpError(
        409,
        "Finish indexing and choose valid source sheets first.",
      );
    const active = (
      await tx.query<{ count: string }>(
        "SELECT COUNT(*) AS count FROM jobs WHERE state IN ('preparing','extracting')",
      )
    ).rows[0];
    if (Number(active.count) >= limit("MAX_ACTIVE_JOBS", 2))
      throw new HttpError(
        429,
        "Processing capacity is busy. Try again shortly.",
      );
    if (
      (
        await tx.query(
          "SELECT id FROM jobs WHERE plan_id=$1 AND state IN ('preparing','extracting')",
          [planId],
        )
      ).rows.length
    )
      throw new HttpError(409, "This PDF is already being processed.");
    const base = ModelSchema.parse(revision.model);
    if (
      ![...base.levels, ...base.walls, ...base.openings, ...base.roofs].some(
        (e) => e.evidence.some((source) => source.planId === planId),
      )
    )
      throw new HttpError(
        409,
        "This saved model does not reference this PDF. Select its source plan before extracting rooms.",
      );
    const frame = (model: typeof base) =>
      JSON.stringify(
        model.calibrations
          .map(({ page, region, mmPerPoint }) => ({ page, region, mmPerPoint }))
          .sort(
            (a, b) =>
              a.page - b.page ||
              JSON.stringify(a.region).localeCompare(JSON.stringify(b.region)),
          ),
      );
    const candidates = await tx.query<{ result: ShellResult }>(
      "SELECT c.result FROM ai_calls c JOIN jobs j ON j.id=c.job_id WHERE j.plan_id=$1 AND j.project_id=$2 AND c.page=0 AND c.state='complete' ORDER BY c.created_at DESC",
      [planId, projectId],
    );
    const source = candidates.rows.find(
      (c) =>
        c.result?.kind === "project-shell" &&
        frame(c.result.model) === frame(base) &&
        c.result.draft.levels.every((l) =>
          base.levels.some((v) => v.id === l.id),
        ),
    );
    if (!source)
      throw new HttpError(
        409,
        "This saved model has no matching PDF calibration checkpoint. Select its original plan/model revision; a room pass cannot guess a changed scale.",
      );
    if (source.result.draft.levels.some((l) => !b.pages.includes(l.planPage)))
      throw new HttpError(
        400,
        "Include the floor-plan sheet for every model level.",
      );
    const id = uid(),
      stamp = now();
    await tx.query(
      "INSERT INTO jobs(id,project_id,plan_id,state,phase,pages,budget_usd,base_head,created_at,updated_at) VALUES($1,$2,$3,'extracting','Queued · rooms on saved model',$4,$5,$6,$7,$7)",
      [
        id,
        projectId,
        planId,
        JSON.stringify([...new Set(b.pages)]),
        limit("JOB_BUDGET_USD", 10),
        b.revisionId,
        stamp,
      ],
    );
    const seed: ShellResult = {
      kind: "project-shell",
      model: base,
      draft: source.result.draft,
      sourcePages: b.pages,
      roomsOnly: true,
      roomsRequested: true,
    };
    await tx.query(
      "INSERT INTO ai_calls(id,job_id,page,state,reserved_usd,cost_usd,input_tokens,output_tokens,model,result,created_at) VALUES($1,$2,0,'complete',0,0,0,0,'saved-model',$3,$4)",
      [uid(), id, JSON.stringify(seed), stamp],
    );
    await audit(tx, email, "job.rooms", projectId, {
      jobId: id,
      planId,
      revisionId: b.revisionId,
    });
    return id;
  });
}
