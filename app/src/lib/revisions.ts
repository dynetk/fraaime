import { BuildingModel, ModelSchema, validateModel } from "./model";
import { Database, uid, now, audit } from "./db";
import { HttpError } from "./access";
import { buildEstimate } from "./estimate";
import { MOCK_ESTIMATE_SETTINGS } from "./estimate-settings";
export async function saveRevision(
  db: Database,
  projectId: string,
  baseId: string | null,
  input: unknown,
  email: string,
  reviewed = false,
) {
  const model = ModelSchema.parse(input);
  model.estimate ??= structuredClone(MOCK_ESTIMATE_SETTINGS);
  const estimate = buildEstimate(model);
  model.estimate = estimate.settings;
  model.panelQuantities = estimate.wallPanels;
  if (
    reviewed &&
    (validateModel(model).some((i) => i.severity === "error") ||
      model.issues.some((i) => !i.resolved) ||
      model.calibrations.some((c) => !c.confirmed))
  )
    throw new HttpError(
      409,
      "Resolve issues and confirm drawing scales before marking reviewed.",
    );
  return db.transaction(async (tx) => {
    const { rows } = await tx.query<{ head_id: string | null }>(
      "SELECT head_id FROM projects WHERE id=$1 AND deleted_at IS NULL FOR UPDATE",
      [projectId],
    );
    if (!rows[0]) throw new HttpError(404, "Project missing");
    if (rows[0].head_id !== baseId)
      throw new HttpError(
        409,
        "Another revision was saved. Reload the latest model before saving.",
      );
    const id = uid();
    await tx.query(
      "INSERT INTO revisions(id,project_id,parent_id,kind,model,reviewed,author,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        id,
        projectId,
        baseId,
        "human",
        JSON.stringify(model),
        reviewed,
        email,
        now(),
      ],
    );
    await tx.query("UPDATE projects SET head_id=$1 WHERE id=$2", [
      id,
      projectId,
    ]);
    await audit(
      tx,
      email,
      reviewed ? "model.reviewed" : "model.saved",
      projectId,
      { revisionId: id },
    );
    return id;
  });
}
export async function saveCandidate(
  db: Database,
  projectId: string,
  jobId: string,
  baseHead: string | null,
  model: BuildingModel,
  partial = false,
) {
  model = ModelSchema.parse(model);
  const estimate = buildEstimate(model);
  model.estimate = estimate.settings;
  model.panelQuantities = estimate.wallPanels;
  return db.transaction(async (tx) => {
    const existing = await tx.query<{ id: string }>(
      "SELECT id FROM revisions WHERE job_id=$1 AND kind=$2",
      [jobId, partial ? "ai_partial" : "ai"],
    );
    if (existing.rows[0]) return existing.rows[0].id;
    const p = await tx.query<{ head_id: string | null }>(
      "SELECT head_id FROM projects WHERE id=$1 AND deleted_at IS NULL FOR UPDATE",
      [projectId],
    );
    if (!p.rows[0]) throw new Error("Project deleted");
    const job = await tx.query<{ state: string }>(
      "SELECT state FROM jobs WHERE id=$1 FOR UPDATE",
      [jobId],
    );
    if (job.rows[0]?.state === "cancelled") throw new Error("Job cancelled");
    const id = uid();
    await tx.query(
      "INSERT INTO revisions(id,project_id,parent_id,job_id,kind,model,author,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        id,
        projectId,
        baseHead,
        jobId,
        partial ? "ai_partial" : "ai",
        JSON.stringify(model),
        "openai",
        now(),
      ],
    );
    // Reruns are always separate candidates once a head exists. Never replace human edits.
    if (p.rows[0].head_id === null)
      await tx.query("UPDATE projects SET head_id=$1 WHERE id=$2", [
        id,
        projectId,
      ]);
    await audit(tx, "worker", "model.candidate", projectId, {
      revisionId: id,
      jobId,
    });
    return id;
  });
}
