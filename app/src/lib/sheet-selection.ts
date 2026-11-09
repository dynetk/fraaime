import type { Manifest } from "./worker";

/** Manual choices (including clearing everything) take precedence over defaults. */
export function selectedPlanPages(
  manifest: Manifest | null,
  manual: number[] | undefined,
  previousPages: number[] = [],
): number[] {
  if (manual !== undefined) return manual;
  if (previousPages.length) return previousPages;
  return (
    manifest?.sheets
      .filter((sheet) => sheet.kind === "floor-plan")
      .map((sheet) => sheet.page) ?? []
  );
}
