import type { Manifest, Sheet } from "./worker";

// Shared with the extraction provider so automatic selection respects its limit.
export const MAX_SHELL_PAGES = 8;
export const SHELL_SHEET_KINDS = [
  "floor-plan",
  "section",
  "elevation",
  "roof-plan",
] as const;

/** Prefer standalone drawing titles over incidental words in notes and legends. */
export function sheetKind(sheet: Pick<Sheet, "text" | "kind">): string {
  if (!sheet.text.trim()) return sheet.kind;
  const text = sheet.text.replace(
    /\b(roof(?:\s+deck)?|floor)\s*\n\s*plan\b/gi,
    "$1 plan",
  );
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\s+/g, " "));
  if (
    lines.some((line) =>
      /^(?:sheet index|drawing index|index of drawings|drawing list)$/i.test(
        line,
      ),
    )
  )
    return "unclassified";
  let kind = "unclassified";
  for (const line of lines) {
    if (
      /^(?:(?:proposed|new|existing)\s+)?(?:(?:\d+(?:st|nd|rd|th)?|first|second|third|ground|main|upper|lower|basement)\s+)?(?:floor|level)\s+plans?(?:\s*[-–]\s*(?!t\.?o\.?\s*f).*)?$/i.test(
        line,
      )
    )
      kind = "floor-plan";
    else if (/^roof(?:\s+deck)?\s+plans?$/i.test(line)) kind = "roof-plan";
    else if (/^(?:exterior\s+|building\s+)?elevations?$/i.test(line))
      kind = "elevation";
    else if (
      /^(?:(?:building|long|short|cross|longitudinal|transverse)\s+)?sections?$/i.test(
        line,
      )
    )
      kind = "section";
    else if (
      /^(?:(?:site|electrical|power|lighting|foundation|framing|landscape)\s+plans?(?:\s+notes)?|(?:interior\s+elevations?|wall\s+sections?|general\s+notes|.*\s+details))$/i.test(
        line,
      )
    )
      kind = "unclassified";
  }
  return kind === "unclassified" && sheet.kind === "schedule" ? "schedule" : kind;
}

export function suggestedPlanPages(
  manifest: Manifest | null,
  maxPages = MAX_SHELL_PAGES,
): number[] {
  const sheets = manifest?.sheets ?? [];
  const floors = sheets
    .filter((s) => sheetKind(s) === "floor-plan")
    .map((s) => s.page);
  // Never silently remove an enclosed floor to make space for supporting sheets.
  const selected = new Set(floors);
  const groups = SHELL_SHEET_KINDS.slice(1).map((kind) =>
    sheets.filter((s) => sheetKind(s) === kind).map((s) => s.page),
  );
  // Round-robin gives each available drawing type coverage before taking extras.
  for (
    let i = 0;
    groups.some((group) => i < group.length) && selected.size < maxPages;
    i++
  ) {
    for (const group of groups) {
      if (group[i] !== undefined && selected.size < maxPages)
        selected.add(group[i]);
    }
  }
  return [...selected].sort((a, b) => a - b);
}

/** Manual choices (including clearing everything) take precedence over defaults. */
export function selectedPlanPages(
  manifest: Manifest | null,
  manual: number[] | undefined,
  previousPages: number[] = [],
  maxPages = MAX_SHELL_PAGES,
): number[] {
  if (manual !== undefined) return manual;
  if (previousPages.length) return previousPages;
  return suggestedPlanPages(manifest, maxPages);
}
