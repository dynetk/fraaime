import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sheetKind,
  needsTitleOcr,
  suggestedPlanPages,
} from "../src/lib/sheet-selection";
import { TitleOcrSchema, type Sheet } from "../src/lib/worker";
const ocr = (text: string, confidence = 90) =>
  TitleOcrSchema.parse({
    version: 2,
    engine: "tesseract",
    status: "complete",
    text,
    lines: text
      .split("\n")
      .map((text) => ({ text, confidence, region: [0, 0, 1, 1] })),
  });
const sheet = (text: string, kind = "unclassified"): Sheet => ({
  page: 1,
  text,
  kind,
  rotation: 0,
  width: 100,
  height: 100,
  sheet: "",
  revision: "",
  scanned: false,
});
test("native boilerplate does not hide missing titles; readable headings avoid OCR", () => {
  assert.equal(
    needsTitleOcr(sheet("Copyright. All drawings are reserved.")),
    true,
  );
  assert.equal(needsTitleOcr(sheet("FIRST FLOOR PLAN")), false);
  assert.equal(needsTitleOcr(sheet("GENERAL NOTES")), false);
  assert.equal(needsTitleOcr(sheet("SHEET INDEX")), false);
  assert.equal(needsTitleOcr(sheet("")), true);
});
test("OCR recovers shell titles with punctuation and preserves native titles", () => {
  for (const [text, kind] of [
    ["FIRST FLOOR PLAN", "floor-plan"],
    ["EXTERIOR ELEVATIONS,", "elevation"],
    ["CROSS-SECTIONS &\nFRAMING DETAILS", "section"],
    ["PARTIAL SECTIONS &", "section"],
    ["ROOF PLAN", "roof-plan"],
  ]) {
    assert.equal(sheetKind({ ...sheet("Copyright."), ocr: ocr(text) }), kind);
  }
  assert.equal(
    sheetKind({ ...sheet("ROOF PLAN"), ocr: ocr("FLOOR PLAN") }),
    "roof-plan",
  );
  assert.equal(
    sheetKind({ ...sheet("Copyright."), ocr: ocr("FLOOR PLAN", 40) }),
    "unclassified",
  );
});
test("OCR failures remain retryable while successful or unreadable checkpoints are retained", () => {
  const failed = { ...ocr(""), status: "failed" as const };
  assert.equal(needsTitleOcr({ ...sheet("Copyright."), ocr: failed }), true);
  assert.equal(
    needsTitleOcr({
      ...sheet("Copyright."),
      ocr: { ...failed, status: "unreadable" },
    }),
    false,
  );
  assert.equal(
    needsTitleOcr({ ...sheet("Copyright."), ocr: ocr("FLOOR PLAN") }),
    false,
  );
  assert.throws(() =>
    TitleOcrSchema.parse({
      ...ocr("Title"),
      lines: [{ text: "Title", confidence: 200, region: [0, 0, 1, 1] }],
    }),
  );
});
test("OCR feeds automatic selection without overwriting source text", () => {
  const source = sheet("Copyright.");
  const sheets = [
    "FIRST FLOOR PLAN",
    "SECOND FLOOR PLAN",
    "ROOF PLAN",
    "EXTERIOR ELEVATIONS",
    "CROSS SECTIONS",
  ].map((text, i) => ({ ...source, page: i + 1, ocr: ocr(text) }));
  assert.deepEqual(
    suggestedPlanPages({
      sha256: "synthetic",
      pageCount: 5,
      sheets,
      warnings: [],
    }),
    [1, 2, 3, 4, 5],
  );
  assert.ok(sheets.every((s) => s.text === "Copyright."));
});

test("floor plans with embedded opening schedules remain floor-plan suggestions", () => {
  assert.equal(
    sheetKind({ ...sheet("2ND FLOOR PLAN\nWINDOW SCHEDULE", "schedule") }),
    "floor-plan",
  );
});
