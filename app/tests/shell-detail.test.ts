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
test("source-backed wall correction removes the duplicate host and defers its openings without touching human walls", () => {
  const b = baseDraft(),
    base = compile(),
    d = details();
  d.partitions = [];
  d.openings = [];
  d.roofs = [];
  d.wallRemovals = [
    {
      wallId: "detail-p",
      reason: "Incorrect duplicated host",
      evidence: [ev()],
    },
  ];
  const corrected = compileShellDetail(d, base, b, pages, "test");
  assert(!corrected.walls.some((w) => w.id === "detail-p"));
  assert.equal(corrected.openings.length, 0);
  assert(
    corrected.unresolvedObservations?.some((o) =>
      /Host wall corrected/.test(o.reason),
    ),
  );
  assert.deepEqual(corrected.levels, base.levels);
  const recovery = details();
  recovery.partitions[0].id = "new-host";
  recovery.openings[0].wallId = "new-host";
  recovery.openings[0].replacesOpeningId = "detail-d";
  recovery.openings[0].evidence.push(ev(2));
  recovery.openings[0].width.evidence = [];
  recovery.openings[0].height.evidence = [];
  recovery.openings[0].sill.evidence = [];
  recovery.roofs = [];
  const recovered = compileShellDetail(recovery, corrected, b, pages, "test");
  assert.equal(recovered.openings.length, 1);
  assert.equal(recovered.openings[0].id, "detail-d");
  assert.equal(recovered.openings[0].wallId, "detail-new-host");
  assert(!recovered.unresolvedObservations?.some((o) => o.id === "detail-d"));
  base.walls.find((w) => w.id === "detail-p")!.inferred = false;
  const retained = compileShellDetail(d, base, b, pages, "test");
  assert(retained.walls.some((w) => w.id === "detail-p"));
  assert.equal(retained.openings.length, 1);
});
test("opening reconciliation replaces the same instance atomically and retains operation and provisional threshold evidence", () => {
  const b = baseDraft(),
    base = compile(),
    d = details();
  d.partitions = [];
  d.roofs = [];
  d.openings[0].replacesOpeningId = "detail-d";
  d.openings[0].center = [0.7, 0.3];
  d.openings[0].operation = "Left hinged";
  d.openings[0].sill.estimated = true;
  const corrected = compileShellDetail(d, base, b, pages, "test", true);
  assert.equal(corrected.openings.length, 1);
  assert.equal(corrected.openings[0].id, "detail-d");
  assert.equal(corrected.openings[0].operation, "Left hinged");
  assert.equal(corrected.openings[0].offset, 7050);
  assert(
    corrected.issues.some((i) =>
      /threshold\/sill is provisional/.test(i.message),
    ),
  );
  d.openings[0].center = [0.7, 0.7];
  const rejected = compileShellDetail(d, base, b, pages, "test", true);
  assert.deepEqual(rejected.openings, base.openings);
  d.openings[0].center = [0.7, 0.3];
  base.openings[0].inferred = false;
  assert.deepEqual(
    compileShellDetail(d, base, b, pages, "test", true).openings,
    base.openings,
  );
});
test("a supported below-datum door threshold survives compilation, horizontal editing and serialization", () => {
  const d = details();
  d.openings[0].sill = dim(-15.875);
  const model = compile(d);
  assert.equal(model.openings.length, 1);
  assert.equal(model.openings[0].sill, -15.875);
  assert.equal(model.openings[0].height, 2100);
  assert(
    model.issues.some((i) => /verify the local wall base/.test(i.message)),
  );
  const moved = transformElement(model, model.openings[0].id, {
    dx: 50,
    dy: 0,
    dz: 0,
    rotation: 0,
    sx: 1,
    sy: 1,
    sz: 1,
  });
  assert.equal(
    ModelSchema.parse(JSON.parse(JSON.stringify(moved))).openings[0].sill,
    -15.875,
  );
  assert.deepEqual(validateModel(moved), []);
  d.openings[0].sill.evidence = [ev(1)];
  assert.equal(compile(d).openings.length, 0);
  d.openings[0].sill = { ...dim(-15.875), estimated: true };
  assert.equal(compile(d).openings.length, 0);
  d.openings[0].sill = dim(-301);
  assert.equal(compile(d).openings.length, 0);
  d.openings[0].sill = dim(-15.875);
  d.openings[0].kind = "window";
  assert.equal(compile(d).openings.length, 0);
});
test("roof-plan void may differ from the floor void but cannot erase the courtyard or rely on floor-only evidence", () => {
  const b = baseDraft();
  b.sheets[2].kind = "roof-plan";
  const base = compileShell(b, pages, "test", "Synthetic"),
    d = details();
  const roofVoid = [
    [0.42, 0.48],
    [0.58, 0.48],
    [0.58, 0.6],
    [0.42, 0.6],
  ];
  d.roofOpenings = [
    { levelId: "L1", outlines: [roofVoid], evidence: [ev(1), ev(3)] },
  ];
  d.roofs[0].voids = [roofVoid];
  const result = compileShellDetail(d, base, b, pages, "test");
  assert.equal(result.roofs.length, 1);
  assert.deepEqual(result.levels, base.levels);
  d.roofs[0].voids = [];
  assert.equal(compileShellDetail(d, base, b, pages, "test").roofs.length, 0);
  d.roofs[0].voids = [roofVoid];
  d.roofOpenings[0].evidence = [ev(1), ev(2)];
  assert.equal(compileShellDetail(d, base, b, pages, "test").roofs.length, 0);
});
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

test("garden enclosure outside floor remains an editable wall without creating floor area, and can host a door", () => {
  const d = details();
  d.exteriorWalls = [
    {
      id: "garden",
      label: "Garden screen",
      levelId: "L1",
      typeId: "w",
      start: [0.1, 0.95],
      end: [0.9, 0.95],
      height: dim(2400),
      evidence: [ev()],
    },
  ];
  d.openings = [{ ...d.openings[0], wallId: "garden", center: [0.3, 0.95] }];
  const m = compile(d),
    w = m.walls.find((w) => w.id === "detail-garden")!;
  assert.equal(w.role, "courtyard");
  assert.equal(m.openings[0].wallId, w.id);
  assert.deepEqual(m.levels, compile().levels);
  d.exteriorWalls[0].height.evidence = [];
  assert(!compile(d).walls.some((w) => w.id === "detail-garden"));
});

test("wall-top profile needs vertical evidence, persists through edits, and preserves opening limits", () => {
  const d = details();
  d.wallTops = [
    {
      wallId: "L1-r0-w0",
      profile: [
        { fraction: 0, height: dim(3200) },
        { fraction: 0.5, height: dim(4500) },
        { fraction: 1, height: dim(3200) },
      ],
      evidence: [ev(2)],
    },
  ];
  const m = compile(d),
    w = m.walls.find((w) => w.id === "L1-r0-w0")!;
  assert.equal(w.height, 4500);
  assert.equal(w.topProfile?.length, 3);
  const shared = structuredClone(d);
  shared.wallTops[0].profile.forEach((p) => {
    p.height.evidence = [];
  });
  assert.deepEqual(
    compile(shared).walls.find((x) => x.id === w.id)!.topProfile,
    w.topProfile,
  );
  shared.wallTops[0].evidence = [ev(1)];
  assert.equal(
    compile(shared).walls.find((x) => x.id === w.id)!.topProfile,
    undefined,
  );
  const changed = transformElement(m, w.id, {
    dx: 0,
    dz: 0,
    dy: 0,
    rotation: 0,
    sx: 2,
    sy: 2,
    sz: 1,
  });
  assert.equal(
    changed.walls.find((x) => x.id === w.id)!.topProfile![1][1],
    9000,
  );
  d.wallTops[0].profile[0].height.evidence = [ev(1)];
  assert.equal(
    compile(d).walls.find((w) => w.id === "L1-r0-w0")!.topProfile,
    undefined,
  );
});

import sharp from "sharp";
import { planCoordinateCrops } from "../src/lib/plan-crops";
test("coordinate crops preserve full-page bounds and handle odd-sized worker tiles", async () => {
  const raster = await sharp({
    create: { width: 300, height: 201, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  const images = [{ region: [0, 0, 1, 1], base64: raster.toString("base64") }];
  for (const region of [
    [0, 0, 0.5, 0.5],
    [0.5, 0, 1, 0.5],
    [0, 0.5, 0.5, 1],
    [0.5, 0.5, 1, 1],
  ]) {
    const left = Math.floor(region[0] * 300),
      top = Math.floor(region[1] * 201);
    const tile = await sharp(raster)
      .extract({
        left,
        top,
        width: Math.floor(region[2] * 300) - left,
        height: Math.floor(region[3] * 201) - top,
      })
      .png()
      .toBuffer();
    images.push({ region, base64: tile.toString("base64") });
  }
  const result = await planCoordinateCrops(
    { ...pages[0], images },
    baseDraft().levels,
  );
  assert.equal(result.length, 3);
  for (const image of result) {
    assert(image.region.every((n) => n >= 0 && n <= 1));
    assert(
      image.region[2] > image.region[0] && image.region[3] > image.region[1],
    );
    const metadata = await sharp(
      Buffer.from(image.base64, "base64"),
    ).metadata();
    assert(metadata.width! <= 1536 && metadata.height! <= 1536);
    assert.equal(metadata.format, "jpeg");
  }
  assert(result[0].region[3] > result[1].region[1]);
  assert.equal(
    (await planCoordinateCrops(pages[1], baseDraft().levels)).length,
    0,
  );
});
