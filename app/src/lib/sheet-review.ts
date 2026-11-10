import { z } from "zod";
import { audit, now, type Database } from "./db";
import { HttpError } from "./access";
import type { Manifest } from "./worker";
export const SheetReviewInput = z.object({
  page: z.number().int().positive(),
  decision: z.enum(["include", "exclude", "reset"]),
  reason: z.string().trim().min(3).max(300),
});
// Caller enforces project edit permission. Lock against concurrent OCR manifest updates.
export async function saveSheetReview(
  db: Database,
  planId: string,
  actor: string,
  input: unknown,
) {
  const b = SheetReviewInput.parse(input);
  return db.transaction(async (tx) => {
    const row = (
      await tx.query<{ manifest: Manifest; project_id: string }>(
        "SELECT manifest,project_id FROM plans WHERE id=$1 FOR UPDATE",
        [planId],
      )
    ).rows[0];
    if (!row?.manifest) throw new HttpError(404, "Indexed plan missing");
    if (row.manifest.indexingComplete === false)
      throw new HttpError(
        409,
        "Wait for title indexing to finish before reviewing sheets.",
      );
    const sheet = row.manifest.sheets.find((s) => s.page === b.page);
    if (!sheet) throw new HttpError(400, "Sheet is outside this plan");
    if (b.decision === "reset") delete sheet.review;
    else
      sheet.review = {
        decision: b.decision,
        reason: b.reason,
        by: actor,
        at: now(),
      };
    await tx.query("UPDATE plans SET manifest=$1 WHERE id=$2", [
      JSON.stringify(row.manifest),
      planId,
    ]);
    await audit(tx, actor, "sheet.reviewed", row.project_id, { planId, ...b });
    return { ok: true };
  });
}
