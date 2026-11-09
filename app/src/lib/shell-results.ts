import { assemble, type ExtractedPage } from "./extraction";
import { ModelSchema, type BuildingModel } from "./model";
import type { ShellDetailData } from "./shell-detail";
import type { ShellDraftData } from "./shell";
export type ShellResult = {
  kind: "project-shell";
  model: BuildingModel;
  draft: ShellDraftData;
  sourcePages: number[];
  detailRequested?: boolean;
  detailDraft?: ShellDetailData;
};
export type StoredResult = {
  page: number;
  result: ExtractedPage | ShellResult;
};
/** Page zero is a job-level checkpoint. Never scope its evidence to a single sheet. */
export function assembleStoredResults(
  rows: StoredResult[],
  name: string,
  planId: string,
  allPages: number[],
) {
  const joint = rows.find((r) => r.page === 0);
  if (!joint && rows.some((r) => r.page < 0))
    throw Error("Detail checkpoint has no base shell.");
  if (!joint)
    return assemble(
      rows as { page: number; result: ExtractedPage }[],
      name,
      planId,
      allPages.filter((n) => !rows.some((r) => r.page === n)),
    );
  const detailed = rows.find((r) => r.page === -1);
  if (
    rows.length !== (detailed ? 2 : 1) ||
    joint.result.kind !== "project-shell" ||
    (detailed &&
      (detailed.result.kind !== "project-shell" ||
        !detailed.result.detailDraft))
  )
    throw Error("Mixed or invalid extraction checkpoints; start a fresh job.");
  const model = ModelSchema.parse((detailed ?? joint).result.model);
  const sourcePages = joint.result.sourcePages;
  const skipped = allPages.filter((n) => !sourcePages.includes(n));
  if (skipped.length)
    model.issues.push({
      id: "shell-unread-sheets",
      elementId: null,
      severity: "warning",
      message: `Only selected sheets were reconciled. ${skipped.length} other sheets remain unread: ${skipped.join(", ")}.`,
      resolved: false,
      resolution: "",
    });
  return model;
}
