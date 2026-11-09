import assert from "node:assert/strict";
import test from "node:test";
import { selectedPlanPages, sheetKind } from "../src/lib/sheet-selection";
import type { Manifest } from "../src/lib/worker";

function manifest(kinds: string[]): Manifest {
  return {
    sha256: "test",
    pageCount: kinds.length,
    warnings: [],
    sheets: kinds.map((kind, i) => ({
      page: i + 1,
      kind,
      sheet: "",
      text: "",
      width: 100,
      height: 100,
      rotation: 0,
      revision: "",
      scanned: false,
    })),
  };
}

test("all four shell drawing types become selected when indexing finishes, excluding schedules and unknown sheets", () => {
  assert.deepEqual(selectedPlanPages(null, undefined), []);
  assert.deepEqual(
    selectedPlanPages(
      manifest([
        "unclassified",
        "floor-plan",
        "floor-plan",
        "roof-plan",
        "section",
        "elevation",
        "schedule",
        "floor-plan",
        "floor-plan",
      ]),
      undefined,
    ),
    [2, 3, 4, 5, 6, 8, 9],
  );
});

test("polling and indexing preserve manual additions, removals, and clearing all sheets", () => {
  const indexed = manifest(["floor-plan", "floor-plan", "section"]);
  assert.deepEqual(selectedPlanPages(indexed, [2, 3]), [2, 3]);
  assert.deepEqual(selectedPlanPages(indexed, [], [1, 2]), []);
  assert.deepEqual(selectedPlanPages(indexed, [3], [1, 2]), [3]);
});

test("existing extraction selections survive reopening a project", () => {
  assert.deepEqual(
    selectedPlanPages(manifest(["floor-plan", "section"]), undefined, [1, 2]),
    [1, 2],
  );
});

test("unknown or scanned sheets are not guessed and large floor sets are not silently truncated", () => {
  assert.deepEqual(
    selectedPlanPages(manifest(["unclassified"]), undefined),
    [],
  );
  assert.equal(
    selectedPlanPages(manifest(Array(10).fill("floor-plan")), undefined).length,
    10,
  );
});

test("large sets retain every floor and balance support types within the shell limit", () => {
  const sheets = manifest([
    "floor-plan",
    "floor-plan",
    "floor-plan",
    "floor-plan",
    "section",
    "section",
    "section",
    "elevation",
    "elevation",
    "roof-plan",
    "roof-plan",
  ]);
  assert.deepEqual(
    selectedPlanPages(sheets, undefined),
    [1, 2, 3, 4, 5, 6, 8, 10],
  );
  assert.equal(selectedPlanPages(sheets, undefined, [], 30).length, 11);
});

test("support-only sets are suggested without inventing a floor plan", () => {
  assert.deepEqual(
    selectedPlanPages(
      manifest(["section", "elevation", "roof-plan"]),
      undefined,
    ),
    [1, 2, 3],
  );
});

test("drawing titles override incidental floor references on vertical sheets", () => {
  assert.equal(
    sheetKind({
      kind: "floor-plan",
      text: "FLOOR PLAN - T.O.F.F. - COURT\nEXTERIOR ELEVATIONS",
    }),
    "elevation",
  );
  assert.equal(
    sheetKind({
      kind: "floor-plan",
      text: "FLOOR PLAN - T.O.F.F. - COURT\nLONG SECTIONS",
    }),
    "section",
  );
  assert.equal(
    sheetKind({ kind: "unclassified", text: "ROOF DECK\nPLAN" }),
    "roof-plan",
  );
  assert.equal(
    sheetKind({
      kind: "schedule",
      text: "BUILDING SECTION\n2ND FLOOR PLAN\nWindow schedule reference",
    }),
    "floor-plan",
  );
  assert.equal(
    sheetKind({ kind: "unclassified", text: "SECTIONS\nSection 1" }),
    "section",
  );
});

test("sheet indexes, notes, electrical sheets, and unreadable titles are not shell suggestions", () => {
  for (const text of [
    "SHEET INDEX\nFLOOR PLAN\nELEVATIONS",
    "Contractor shall not scale the floor plans",
    "ELEVATION REFERENCE\nBUILDING SECTION\nELECTRICAL PLAN NOTES",
    "INTERIOR ELEVATIONS",
    "Copyright notice only",
  ]) {
    assert.equal(sheetKind({ kind: "floor-plan", text }), "unclassified");
  }
});
