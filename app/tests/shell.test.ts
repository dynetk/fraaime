import { test } from "node:test";
import assert from "node:assert/strict";
import { ShellDraft, compileShell, overlapsInterior } from "../src/lib/shell";
import { checkShellPages } from "../src/lib/shell-provider";
import type { PageEvidence } from "../src/lib/worker";
const pages = [1, 2, 3].map((page) => ({
  page,
  width: 1000,
  height: 1000,
  evidenceVersion: 2,
  coordinateSpace: "displayed-crop-points",
  rotation: 0,
  text: "",
  lines: [],
  images: [],
})) as PageEvidence[];
const ev = (page = 1) => ({
  planId: "test",
  page,
  sheet: `A${page}`,
  region: [0, 0, 1, 1],
  note: "Synthetic source",
});
const measure = (valueMm: number, page = 2) => ({
  readings: [{ valueMm, evidence: [ev(page)] }],
  estimated: false,
});
function draft() {
  return ShellDraft.parse({
    version: 1,
    datum: "First finished floor 0",
    sheets: [
      { page: 1, sheet: "A1", kind: "floor-plan" },
      { page: 2, sheet: "A2", kind: "section" },
      { page: 3, sheet: "A3", kind: "floor-plan" },
    ],
    levels: [
      {
        id: "L1",
        label: "Ground",
        planPage: 1,
        planRegion: [0, 0, 1, 1],
        anchor: [0.1, 0.1],
        anchorLabel: "grid A1",
        rotationDegrees: 0,
        scale: {
          dimensionText: "10 m",
          lengthMm: 10000,
          start: [0.1, 0.1],
          end: [0.9, 0.1],
        },
        outline: [
          [0.1, 0.1],
          [0.9, 0.1],
          [0.9, 0.9],
          [0.1, 0.9],
        ],
        voids: [
          [
            [0.4, 0.4],
            [0.6, 0.4],
            [0.6, 0.6],
            [0.4, 0.6],
          ],
        ],
        elevation: measure(0),
        wallHeight: measure(3000),
        wallThickness: measure(150, 1),
        evidence: [ev()],
      },
    ],
    openings: [],
    roofs: [],
    scheduleEntries: [],
    issues: [],
  });
}
test("cross-sheet shell converts traced plans to mm, retains voids and vertical evidence", () => {
  const d = draft();
  const m = compileShell(d, pages, "test", "Synthetic");
  assert.equal(m.levels.length, 1);
  assert.equal(m.walls.length, 8);
  assert.deepEqual(m.levels[0].outline[1], [10000, 0]);
  assert.equal(m.levels[0].voids.length, 1);
  assert.equal(m.walls[0].height, 3000);
  assert(m.walls[0].evidence.some((e) => e.page === 2));
  assert.deepEqual(m.shellProvenance?.sourcePages, [1, 2, 3]);
});
test("upper story uses common anchor, not independently centered outlines", () => {
  const d = draft();
  const l = structuredClone(d.levels[0]);
  l.id = "L2";
  l.planPage = 3;
  l.evidence = [ev(3)];
  l.elevation = measure(3300);
  l.anchor = [0.2, 0.2];
  l.outline = l.outline.map((p) => p.map((n) => n + 0.05));
  l.voids = [];
  d.levels.push(l);
  const m = compileShell(d, pages, "test", "Synthetic");
  assert.equal(m.levels.length, 2);
  assert.deepEqual(m.levels[1].outline[0], [-625, -625]);
});
test("conflicting, estimated or floor-plan-only heights are withheld with observations", () => {
  for (const mode of ["conflict", "estimated", "wrong-source"]) {
    const d = draft();
    if (mode === "conflict")
      d.levels[0].wallHeight.readings.push({
        valueMm: 3300,
        evidence: [ev(2)],
      });
    if (mode === "estimated") d.levels[0].wallHeight.estimated = true;
    if (mode === "wrong-source") d.levels[0].wallHeight = measure(3000, 1);
    const m = compileShell(d, pages, "test", "Synthetic");
    assert.equal(m.levels.length, 0);
    assert.equal(m.unresolvedObservations?.length, 1);
  }
});
test("self-intersecting outlines and voids outside a floor are withheld", () => {
  for (const mode of ["bowtie", "outside"]) {
    const d = draft();
    if (mode === "bowtie")
      d.levels[0].outline = [
        [0.1, 0.1],
        [0.9, 0.9],
        [0.1, 0.9],
        [0.9, 0.1],
      ];
    else d.levels[0].voids[0][0] = [0, 0];
    assert.equal(compileShell(d, pages, "test", "Synthetic").levels.length, 0);
  }
});
test("roof planes preserve courtyard holes and roof deck does not create an enclosed story", () => {
  const d = draft();
  d.roofs = [
    {
      id: "deck",
      label: "Roof deck",
      levelId: "L1",
      vertices: [
        [0.1, 0.1],
        [0.4, 0.1],
        [0.4, 0.9],
        [0.1, 0.9],
      ].map((point) => ({ point, elevation: measure(3200) })),
      evidence: [ev(2)],
    },
  ];
  let m = compileShell(d, pages, "test", "Synthetic");
  assert.equal(m.roofs.length, 1);
  assert.equal(m.levels.length, 1);
  d.roofs[0].vertices = d.levels[0].outline.map((point) => ({
    point,
    elevation: measure(3200),
  }));
  m = compileShell(d, pages, "test", "Synthetic");
  assert.equal(m.roofs.length, 0);
  assert.equal(m.unresolvedObservations?.length, 1);
  assert(
    overlapsInterior(
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
    ),
  );
});
test("placed opening must fit the cited perimeter segment", () => {
  const d = draft();
  d.openings = [
    {
      id: "door",
      tag: "D1",
      kind: "door",
      levelId: "L1",
      ring: 0,
      wallIndex: 0,
      offsetFraction: 0.2,
      width: measure(900, 1),
      height: measure(2100, 2),
      sill: measure(0, 1),
      evidence: [ev()],
    },
  ];
  assert.equal(
    compileShell(d, pages, "test", "Synthetic").openings[0].offset,
    2000,
  );
  d.openings[0].offsetFraction = 0.99;
  assert.equal(compileShell(d, pages, "test", "Synthetic").openings.length, 0);
});
test("fusion requires multiple distinct normalized source pages", () => {
  assert.throws(() => checkShellPages([pages[0]]));
  assert.throws(() => checkShellPages([pages[0], pages[0]]));
  assert.throws(() =>
    checkShellPages([{ ...pages[0], evidenceVersion: 1 }, pages[1]]),
  );
  checkShellPages(pages);
});
test("mixed-use plan/schedule sheet retains all roles instead of overwriting geometry eligibility", () => {
  const d = draft();
  d.sheets.push({ page: 1, sheet: "A1 schedule", kind: "schedule" });
  assert.equal(compileShell(d, pages, "test", "Synthetic").levels.length, 1);
});
test("plan corroboration can support a section-backed height but cannot replace its vertical evidence", () => {
  const d = draft();
  d.levels[0].wallHeight.readings.unshift({ valueMm: 3019, evidence: [ev(1)] });
  assert.equal(
    compileShell(d, pages, "test", "Synthetic").levels[0].height,
    3000,
  );
  d.levels[0].wallHeight.readings[0].valueMm = 3100;
  assert.equal(compileShell(d, pages, "test", "Synthetic").levels.length, 0);
});
