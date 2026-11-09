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
function baseDraft() {
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

import {
  ShellDetailDraft,
  compileShellDetail,
  roofCoverage,
  segmentInFloor,
} from "../src/lib/shell-detail";
import { transformElement } from "../src/lib/editing";
import { ModelSchema, validateModel } from "../src/lib/model";
const dim = (valueMm: number) => ({
  valueMm,
  estimated: false,
  evidence: [ev(2)],
});
function details() {
  const b = baseDraft();
  return ShellDetailDraft.parse({
    version: 1,
    wallTypes: [{ id: "w", label: "Partition", thickness: dim(100) }],
    partitions: [
      {
        id: "p",
        label: "Hall",
        levelId: "L1",
        typeId: "w",
        start: [0.1, 0.3],
        end: [0.9, 0.3],
        height: null,
        evidence: [ev()],
      },
    ],
    openings: [
      {
        id: "d",
        label: "Door",
        tag: "D1",
        kind: "door",
        wallId: "p",
        center: [0.3, 0.3],
        width: dim(900),
        height: dim(2100),
        sill: dim(0),
        evidence: [ev()],
      },
    ],
    roofs: [
      {
        id: "roof",
        label: "Nominal roof",
        levelId: "L1",
        surface: "roof",
        outline: b.levels[0].outline,
        voids: b.levels[0].voids,
        anchor: [0.1, 0.1],
        elevation: dim(3200),
        pitchRisePer12: 0,
        uphill: [0, 0],
        quality: "approximate",
        approximation: "Drainage facets unresolved",
        evidence: [ev(2)],
      },
    ],
    issues: [],
  });
}
function compile(d = details()) {
  const b = baseDraft();
  return compileShellDetail(
    d,
    compileShell(b, pages, "test", "Synthetic"),
    b,
    pages,
    "test",
  );
}
test("details add editable partition/door, preserve floors and courtyard roof hole", () => {
  const m = compile();
  assert.equal(m.walls.filter((w) => w.role === "interior").length, 1);
  assert.equal(m.openings.length, 1);
  assert.equal(m.openings[0].offset, 2050);
  assert.equal(m.roofs.length, 1);
  assert.equal(m.roofs[0].voids?.length, 1);
  assert.equal(roofCoverage(m), 1);
  assert.equal(m.levels.length, 1);
  assert.equal(
    validateModel(m).filter((i) => i.severity === "error").length,
    0,
  );
});
test("reject outside/courtyard partitions and unsupported dimensions", () => {
  for (const mode of ["void", "outside", "dimension", "duplicate"]) {
    const d = details();
    if (mode === "void") {
      d.partitions[0].start = [0.1, 0.5];
      d.partitions[0].end = [0.9, 0.5];
    }
    if (mode === "outside") d.partitions[0].start = [0, 0.3];
    if (mode === "dimension") d.wallTypes[0].thickness.evidence = [];
    if (mode === "duplicate") {
      d.partitions[0].start = [0.1, 0.1];
      d.partitions[0].end = [0.9, 0.1];
    }
    const m = compile(d);
    assert.equal(m.walls.filter((w) => w.role === "interior").length, 0);
    assert.equal(m.openings.length, 0);
    assert(m.unresolvedObservations!.length >= 2);
  }
});
test("concave floor rejects crossing a notch despite endpoints and midpoint inside", () => {
  const ring = [
    [0, 0],
    [10, 0],
    [10, 10],
    [7, 10],
    [7, 3],
    [6, 3],
    [6, 10],
    [0, 10],
  ];
  assert.equal(segmentInFloor([1, 5], [9, 5], ring, []), false);
});
test("roof cannot cap courtyard, and unsupported roof set keeps baseline", () => {
  const d = details();
  d.roofs[0].voids = [];
  const m = compile(d);
  assert.equal(m.roofs.length, 0);
  assert(m.unresolvedObservations!.some((o) => o.kind === "roof"));
});
test("pitched roof uses physical distances and local height for coverage", () => {
  const d = details();
  d.roofs[0].pitchRisePer12 = 3;
  d.roofs[0].uphill = [1, 0];
  d.roofs[0].elevation = dim(2000);
  const m = compile(d);
  assert.equal(m.roofs[0].vertices[1][1], 4500);
  assert(roofCoverage(m) > 0.5 && roofCoverage(m) < 0.8);
});
test("roof hole follows move rotate and resize and survives model serialization", () => {
  const m = compile();
  const changed = transformElement(m, m.roofs[0].id, {
    dx: 100,
    dz: 200,
    dy: 300,
    rotation: Math.PI / 2,
    sx: 2,
    sy: 1,
    sz: 2,
  });
  const parsed = ModelSchema.parse(JSON.parse(JSON.stringify(changed)));
  assert.deepEqual(parsed.roofs[0].voids?.[0][0], [7600, 3500, 2700]);
  assert.deepEqual(m.roofs[0].voids?.[0][0], [3750, 3200, 3750]);
});

test("partition can terminate at courtyard boundary but cannot enter it", () => {
  const outline = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ],
    hole = [
      [4, 4],
      [6, 4],
      [6, 6],
      [4, 6],
    ];
  assert.equal(segmentInFloor([0, 5], [4, 5], outline, [hole]), true);
  assert.equal(segmentInFloor([0, 5], [4.1, 5], outline, [hole]), false);
});

import { ShapeUtils, Vector2 } from "three";
import { polygonFraming } from "../src/lib/framing";
test("solid roof triangulation and framing both preserve courtyard area", () => {
  const roof = compile().roofs[0];
  const outer = roof.vertices.map((v) => new Vector2(v[0], v[2])),
    holes = roof.voids!.map((h) => h.map((v) => new Vector2(v[0], v[2])));
  const points = [...outer, ...holes.flat()],
    triangles = ShapeUtils.triangulateShape(outer, holes);
  const area = triangles.reduce((n, t) => {
    const [a, b, c] = t.map((i) => points[i]);
    return (
      n + Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2
    );
  }, 0);
  assert.equal(area, 100000000 - 6250000);
  const ring = outer.map((p) => [p.x, p.y]),
    voids = holes.map((h) => h.map((p) => [p.x, p.y]));
  for (const line of polygonFraming(ring, voids, 406.4)) {
    assert(segmentInFloor(line.start, line.end, ring, voids));
  }
});

test("partial duplicate runs are clipped without losing new interior segments or door hosts", () => {
  const d = details();
  d.partitions.unshift({
    ...d.partitions[0],
    id: "existing",
    start: [0.4, 0.3],
    end: [0.6, 0.3],
  });
  const m = compile(d),
    parts = m.walls.filter((w) => w.role === "interior");
  assert.equal(parts.length, 3);
  assert.equal(
    parts.reduce(
      (n, w) => n + Math.hypot(w.end[0] - w.start[0], w.end[1] - w.start[1]),
      0,
    ),
    10000,
  );
  assert.equal(m.openings[0].wallId, "detail-p");
  const d2 = details();
  d2.partitions.unshift({
    ...d2.partitions[0],
    id: "existing",
    start: [0.4, 0.3],
    end: [0.6, 0.3],
  });
  d2.openings[0].center = [0.75, 0.3];
  assert.equal(compile(d2).openings[0].wallId, "detail-p-segment-2");
});
