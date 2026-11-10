import type { Manifest, Sheet } from "./worker";

// Shared with the extraction provider so automatic selection respects its limit.
export const MAX_SHELL_PAGES = 24;
export const SHELL_SHEET_KINDS = [
  "floor-plan",
  "section",
  "elevation",
  "roof-plan",
  "schedule",
  "roof-framing",
  "support",
] as const;

/** Prefer standalone drawing titles over incidental words in notes and legends. */
function titleKind(rawText: string): string {
  const text = rawText
    .replace(/\b(interior|wall)\s*\n\s*(elevations?|sections?)\b/gi, "$1 $2")
    .replace(/\broof\s*\n\s*framing(?:\s*\n\s*plan)?\b/gi, "ROOF FRAMING PLAN")
    .replace(/\b(roof(?:\s+deck)?|floor)\s*\n\s*plan\b/gi, "$1 plan");
  const lines = text.split(/\r?\n/).map((line) =>
    line
      .trim()
      .replace(/\s+/g, " ")
      .replace(/[,&:]+$/, "")
      .trim(),
  );
  if (lines.some((line) => /^(?:COVER|TITLE) SHEET$/i.test(line)))
    return "support";
  if (/\bcivil\b/i.test(text) && lines.some((line) => /COVER$/i.test(line)))
    return "excluded";
  if (
    lines.some((line) =>
      /^(?:sheet index|drawing index|index of drawings|drawing list)$/i.test(
        line,
      ),
    )
  )
    return "unclassified";
  if (
    lines.some((line) =>
      /^(?:NOT USED|VOID|SUPERSEDED|INTERIOR ELEVATIONS?|WALL SECTIONS?|TYPICAL\s*CONCRETE\s*DETAILS)$/i.test(
        line,
      ),
    )
  )
    return "excluded";
  if (lines.some((line) => /^(?:COVER|TITLE) SHEET$/i.test(line)))
    return "support";
  if (
    lines.some((line) => /^(?:ROOF FRAMING(?: PLAN)?|SLAB PLAN)$/i.test(line))
  )
    return lines.some((line) => /^ROOF FRAMING/i.test(line))
      ? "roof-framing"
      : "support";
  let kind = "unclassified";
  for (const line of lines) {
    if (
      /^(?:(?:proposed|new|existing)\s+)?(?:(?:\d+(?:st|nd|rd|th)?|first|second|third|ground|main|upper|lower|basement)\s+)?(?:floor|level)\s+plans?(?:\s*[-–]\s*(?!t\.?o\.?\s*f).*)?$/i.test(
        line,
      )
    )
      kind = "floor-plan";
    else if (
      /^(?:(?:door|window|door\s*&\s*window)\s+)?schedules?(?:\s*&\s*details)?$/i.test(
        line,
      )
    ) {
      if (kind === "unclassified") kind = "schedule";
    } else if (/^roof(?:\s+deck)?\s+plans?$/i.test(line)) kind = "roof-plan";
    else if (/^(?:exterior\s+|building\s+)?elevations?$/i.test(line))
      kind = "elevation";
    else if (
      /^(?:(?:building|long|short|cross|partial|longitudinal|transverse)[ -]+)?sections?$/i.test(
        line,
      )
    )
      kind = "section";
    else if (
      /^(?:(?:site|electrical|power|lighting|foundation|framing|landscape)\s+plans?(?:\s+notes)?|(?:interior\s+elevations?|wall\s+sections?|general\s+notes|.*\s+details))$/i.test(
        line,
      )
    ) {
      if (!(kind === "section" && /details$/i.test(line)))
        kind = "unclassified";
    }
  }
  return kind;
}

export function sheetKind(sheet: Pick<Sheet, "text" | "kind" | "ocr">): string {
  const native = titleKind(sheet.text ?? "");
  if (native !== "unclassified")
    return native === "excluded" ? "unclassified" : native;
  if (sheet.ocr?.status === "complete") {
    // Use only confidence-filtered OCR lines, never a freeform guessed title.
    const detected = titleKind(
      sheet.ocr.lines
        .filter((line) => line.confidence >= 60)
        .map((line) => line.text)
        .join("\n"),
    );
    if (detected !== "unclassified")
      return detected === "excluded" ? "unclassified" : detected;
  }
  if (!(sheet.text ?? "").trim() && !sheet.ocr)
    return sheet.kind || "unclassified";
  return "unclassified";
}

export function needsTitleOcr(
  sheet: Pick<Sheet, "text" | "kind" | "ocr">,
): boolean {
  if (sheet.ocr?.status === "complete") return false;
  if (sheet.ocr?.version === 2 && sheet.ocr.status === "unreadable")
    return false;
  if (titleKind(sheet.text ?? "") !== "unclassified") return false;
  // Readable non-shell titles need no OCR. Boilerplate alone does not count.
  return !(sheet.text ?? "")
    .split(/\r?\n/)
    .some((line) =>
      /^(?:sheet index|drawing index|index of drawings|drawing list|general notes|(?:site|electrical|power|lighting|foundation|framing|landscape) plans?(?: notes)?|interior elevations?|wall sections?|.* details)$/i.test(
        line.trim(),
      ),
    );
}

export function suggestedPlanPages(
  manifest: Manifest | null,
  maxPages = MAX_SHELL_PAGES,
): number[] {
  const sheets = manifest?.sheets ?? [];
  // Architectural geometry and schedules are dependencies, not optional fillers.
  // Keep all of them even over the limit so the UI can require an explicit choice.
  const core = ["floor-plan", "roof-plan", "elevation", "section", "schedule"];
  const selected = new Set(
    sheets
      .filter(
        (s) =>
          s.review?.decision !== "exclude" &&
          (core.includes(sheetKind(s)) || s.review?.decision === "include"),
      )
      .map((s) => s.page),
  );
  for (const sheet of sheets) {
    if (selected.size >= maxPages) break;
    if (
      sheet.review?.decision !== "exclude" &&
      ["roof-framing", "support"].includes(sheetKind(sheet))
    )
      selected.add(sheet.page);
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
  if (previousPages.length)
    return [
      ...new Set([
        ...previousPages.filter(
          (p) =>
            manifest?.sheets.find((s) => s.page === p)?.review?.decision !==
            "exclude",
        ),
        ...(manifest?.sheets
          .filter((s) => s.review?.decision === "include")
          .map((s) => s.page) ?? []),
      ]),
    ].sort((a, b) => a - b);
  return suggestedPlanPages(manifest, maxPages);
}

/** Known dependencies omitted from a manual or older selection stay visible. */
export function selectionWarnings(manifest: Manifest | null, pages: number[]) {
  const selected = new Set(pages);
  const critical = [
    "floor-plan",
    "roof-plan",
    "section",
    "elevation",
    "schedule",
  ];
  const missing = (manifest?.sheets ?? []).filter(
    (s) => critical.includes(sheetKind(s)) && !selected.has(s.page),
  );
  return missing.length
    ? [
        `Recognized drawings are not selected: ${missing.map((s) => `${s.sheet || `PDF ${s.page}`} (page ${s.page}, ${sheetKind(s)})`).join(", ")}. Use suggested sheets or review these omissions.`,
      ]
    : [];
}

export function isUnclassifiedSheet(sheet: Sheet) {
  return !SHELL_SHEET_KINDS.some((kind) => kind === sheetKind(sheet));
}
/** Unselected unknown pages are optional evidence, never a processing gate. */
export function optionalSheetPages(
  manifest: Manifest | null,
  selected: number[],
) {
  return (manifest?.sheets ?? []).filter(
    (s) => isUnclassifiedSheet(s) && !selected.includes(s.page),
  );
}
