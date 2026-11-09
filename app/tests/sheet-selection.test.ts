import assert from "node:assert/strict";
import test from "node:test";
import { selectedPlanPages } from "../src/lib/sheet-selection";
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

test("floor plans become selected when indexing finishes, excluding other sheet types", () => {
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
    [2, 3, 8, 9],
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
