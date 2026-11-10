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
  openingsRequested?: boolean;
  openingsComplete?: boolean;
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
  const opened = rows.find((r) => r.page === -2);
  if (
    rows.length !== 1 + (detailed ? 1 : 0) + (opened ? 1 : 0) ||
    (opened &&
      (!detailed ||
        opened.result.kind !== "project-shell" ||
        !opened.result.openingsComplete)) ||
    joint.result.kind !== "project-shell" ||
    (detailed &&
      (detailed.result.kind !== "project-shell" ||
        !detailed.result.detailDraft))
  )
    throw Error("Mixed or invalid extraction checkpoints; start a fresh job.");
  const model = ModelSchema.parse((opened ?? detailed ?? joint).result.model);
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
  const hasTags = (model.scheduleEntries?.length ?? 0) > 0;
  if (hasTags && !model.openings.length)
    model.issues.push({
      id: "coverage-no-openings",
      elementId: null,
      severity: "error",
      message:
        "Opening tags/schedules were found but no openings were placed. This framing model is incomplete; review schedules and wall matching before estimating.",
      resolved: false,
      resolution: "",
    });
  const unmatched = (model.scheduleEntries ?? []).filter((entry) => {
    const count = model.openings.filter(
      (o) =>
        o.kind === entry.kind &&
        o.tag.trim().toUpperCase() === entry.tag.trim().toUpperCase(),
    ).length;
    return count < (entry.quantity ?? 1);
  });
  if (unmatched.length && model.openings.length)
    model.issues.push({
      id: "coverage-unmatched-openings",
      elementId: null,
      severity: "warning",
      message: `Schedule entries remain unmatched or under-counted: ${unmatched.map((e) => e.tag).join(", ")}. Check repeated types and intentionally unplaced gates before estimating.`,
      resolved: false,
      resolution: "",
    });
  if (joint.result.openingsRequested && !opened)
    model.issues.push({
      id: "coverage-opening-stage",
      elementId: null,
      severity: "error",
      message:
        "Focused opening reconciliation did not complete. This is a partial model.",
      resolved: false,
      resolution: "",
    });
  return model;
}
