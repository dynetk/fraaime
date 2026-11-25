import { test } from "node:test";
import assert from "node:assert/strict";
import { blankModel, ModelSchema, type BuildingModel } from "../src/lib/model";
import { horizontalBracing, HB_SPACING } from "../src/lib/horizontal-bracing";
import {
  wallFraming,
  modelWallFraming,
  editWallMember,
} from "../src/lib/framing";
import {
  generateTrusses,
  modelTrusses,
  memberLength,
  withoutTrussCoverage,
  zoneFitsFloor,
  type Zone,
  TRUSS_DEPTH,
  TRUSS_SPACING,
  TRUSS_WIDTH,
  zoneLocal,
  fitZoneToWallFaces,
  unsupportedTrussEnds,
} from "../src/lib/trusses";
import { buildEstimate, estimateCsv } from "../src/lib/estimate";
import { currentModelSnapshot } from "../src/lib/model-snapshot";
import { transformElement, removeElement } from "../src/lib/editing";
import {
  previewRoomTrusses,
  individualHeightNeeded,
} from "../src/lib/truss-review";
import { reviewRoomHeights } from "../src/lib/truss-height-review";
const base = { evidence: [], inferred: true };
function fixture(): BuildingModel {
  return {
    ...blankModel(),
    levels: [
      {
        ...base,
        id: "L1",
        label: "Ground",
        elevation: 0,
        height: 3048,
        outline: [
          [-10000, -10000],
          [10000, -10000],
          [10000, 10000],
          [-10000, 10000],
        ],
        voids: [],
      },
    ],
    walls: [
      {
        ...base,
        id: "W",
        label: "Wall",
        levelId: "L1",
        start: [-5000, -5000],
        end: [5000, -5000],
        height: 3048,
        thickness: 152.4,
      },
    ],
  };
}
function zone(p: Partial<Zone> = {}): Zone {
  return {
    ...base,
    id: "Z",
    roomId: "R",
    label: "Room",
    levelId: "L1",
    center: [0, 0],
    width: 3048,
    depth: 3657.6,
    rotation: 0,
    ceilingHeight: 2743.2,
    kind: "ceiling",
    upperLevelId: null,
    confirmed: true,
    ...p,
  };
}
function support(m: BuildingModel, z: Zone) {
  const alongX =
    z.spanAxis === "width" || (z.spanAxis !== "depth" && z.width <= z.depth);
  const span = alongX ? z.width : z.depth,
    across = alongX ? z.depth : z.width;
  for (const side of [-1, 1]) {
    const angle = (z.rotation * Math.PI) / 180 + (alongX ? 0 : Math.PI / 2);
    const at = (u: number, v: number): [number, number] => [
      z.center[0] + u * Math.cos(angle) - v * Math.sin(angle),
      z.center[1] + u * Math.sin(angle) + v * Math.cos(angle),
    ];
    m.walls.push({
      ...base,
      id: `support-${side}`,
      label: "Supporting face",
      levelId: z.levelId,
      start: at(side * (span / 2 + 50), -across / 2 - 100),
      end: at(side * (span / 2 + 50), across / 2 + 100),
      height: 4000,
      thickness: 100,
    });
  }
}
const transform = { dx: 0, dy: 0, dz: 0, rotation: 0, sx: 1, sy: 1, sz: 1 };
test("HB continuous at 4-foot centerline increments, only below top track; vertical grid unchanged", () => {
  for (const height of [1000, 1219.2, 2438.4, 3657.6, 4000]) {
    const m = fixture(),
      w = { ...m.walls[0], height },
      original = wallFraming(w, [], 406.4),
      hb = horizontalBracing(w, [], original);
    for (const p of hb) {
      assert.equal(p.kind, "brace");
      assert.equal(p.width, 10000);
      assert(p.y + 19 < height - 38 + 1e-6);
      assert(
        Math.abs(
          (p.y - 19) / HB_SPACING - Math.round((p.y - 19) / HB_SPACING),
        ) < 1e-6,
      );
    }
    m.walls = [w];
    const all = modelWallFraming(m, 406.4).get("W")!;
    assert.deepEqual(
      all.filter((p) => p.kind === "stud").map((p) => p.x),
      original.filter((p) => p.kind === "stud").map((p) => p.x),
    );
  }
});
test("HB clips doors, window sills and full header envelope; no moved rows or stud cuts", () => {
  const m = fixture(),
    w = m.walls[0];
  w.start = [0, 0];
  w.end = [5000, 0];
  w.height = 4000;
  m.openings = [
    {
      ...base,
      id: "D",
      label: "Door",
      kind: "door",
      tag: "D",
      wallId: "W",
      levelId: "L1",
      offset: 1000,
      width: 900,
      height: 2440,
      sill: 0,
      operation: "",
    },
    {
      ...base,
      id: "N",
      label: "Window",
      kind: "window",
      tag: "N",
      wallId: "W",
      levelId: "L1",
      offset: 3000,
      width: 1000,
      height: 800,
      sill: 1250,
      operation: "",
    },
  ];
  const hb = horizontalBracing(
    w,
    m.openings,
    wallFraming(w, m.openings, 406.4),
  );
  const first = hb.filter((p) => Math.abs(p.y - 1238.2) < 0.001);
  assert.deepEqual(
    first.map((p) => [p.x - p.width / 2, p.x + p.width / 2]),
    [
      [0, 1000],
      [1900, 3000],
      [4000, 5000],
    ],
  );
  const second = hb.filter((p) => Math.abs(p.y - 2457.4) < 0.001);
  assert(
    second.every((p) => p.x + p.width / 2 <= 1000 || p.x - p.width / 2 >= 1900),
  );
});
test("HB clips sloping top track instead of resizing wall or shifting rows", () => {
  const w = {
    ...fixture().walls[0],
    start: [0, 0],
    end: [5000, 0],
    height: 4000,
    topProfile: [
      [0, 1500],
      [1, 4000],
    ] as [number, number][],
  };
  const pieces = horizontalBracing(w, [], wallFraming(w, [], 406.4));
  assert(pieces.some((p) => p.width < 5000));
  assert(pieces.every((p) => p.height === 38));
});
test("trusses use exact depth, shorter span, 24-inch grid plus final gap and all web lengths", () => {
  for (const rotation of [0, 35, 90])
    for (const width of [3048, 4200]) {
      const z = zone({ rotation, width }),
        members = generateTrusses(z),
        groups = [...new Set(members.map((m) => m.trussId))];
      const bottoms = groups.map((id) =>
        members.find((m) => m.trussId === id && m.role === "bottom chord")!,
      );
      assert(
        bottoms.every(
          (m) => Math.abs(memberLength(m) - Math.min(z.width, z.depth)) < 1e-6,
        ),
      );
      const heights = members.flatMap((m) => [m.start[1], m.end[1]]);
      assert.equal(Math.min(...heights) - 19, z.ceilingHeight);
      assert.equal(Math.max(...heights) + 19, z.ceilingHeight + TRUSS_DEPTH);
      for (let i = 1; i < bottoms.length; i++) {
        const distance = Math.hypot(
          ...bottoms[i].start.map((v, k) => v - bottoms[i - 1].start[k]),
        );
        assert(distance <= TRUSS_SPACING + 1e-6);
        if (i < bottoms.length - 1)
          assert(Math.abs(distance - TRUSS_SPACING) < 1e-6);
      }
      for (const m of members) {
        assert(memberLength(m) > 0);
        assert(
          ["top chord", "bottom chord", "diagonal", "vertical"].includes(
            m.role,
          ),
        );
      }
    }
});
test("shared assemblies counted once, slab and unconfirmed zones excluded, overlaps surfaced", () => {
  const m = fixture();
  m.levels.push({ ...m.levels[0], id: "L2", elevation: 3149.6 });
  m.trussZones = [
    zone({ kind: "shared-floor-ceiling", upperLevelId: "L2" }),
    zone({ id: "duplicate" }),
  ];
  support(m, m.trussZones[0]);
  const result = modelTrusses(m);
  assert.equal(result.members.length, generateTrusses(m.trussZones[0]).length);
  assert.match(result.warnings.join(" "), /double counting/);
  m.trussZones = [
    zone({ kind: "slab-on-grade" }),
    zone({ id: "draft", confirmed: false }),
  ];
  assert.equal(modelTrusses(m).members.length, 0);
});
test("voids, nonrectangular footprint crossings and wall collisions cannot create trusses", () => {
  const m = fixture();
  m.trussZones = [zone()];
  m.levels[0].voids = [
    [
      [-100, -100],
      [100, -100],
      [100, 100],
      [-100, 100],
    ],
  ];
  assert(!zoneFitsFloor(m.trussZones[0], m.levels[0]));
  assert.equal(modelTrusses(m).members.length, 0);
  m.levels[0].voids = [];
  m.walls[0].start = [0, -5000];
  m.walls[0].end = [0, 5000];
  assert.match(modelTrusses(m).warnings.join(" "), /intersects wall/);
});
test("legacy members clipped spatially only where replaced; pitched roofs above remain", () => {
  const m = fixture();
  m.trussZones = [zone({ width: 2000, depth: 2000 })];
  support(m, m.trussZones[0]);
  const lines = [{ start: [-3000, 2800, 0], end: [3000, 2800, 0] }];
  assert.deepEqual(
    withoutTrussCoverage(m, lines).map((l) => [l.start[0], l.end[0]]),
    [
      [-3000, -1000],
      [1000, 3000],
    ],
  );
  const high = [{ start: [-3000, 5000, 0], end: [3000, 5000, 0] }];
  assert.deepEqual(withoutTrussCoverage(m, high), high);
  m.trussZones = [zone({ kind: "slab-on-grade", width: 2000, depth: 2000 })];
  assert.equal(
    withoutTrussCoverage(m, [{ start: [-500, 0, 0], end: [500, 0, 0] }]).length,
    0,
  );
});
test("editing truss members and whole assemblies survives reload and export; deletes stay deleted", () => {
  let m = fixture();
  m.trussZones = [zone()];
  support(m, m.trussZones[0]);
  const before = modelTrusses(m).members,
    member = before.find((m) => m.role === "diagonal")!;
  m = transformElement(m, member.id, { ...transform, dx: 20, sx: 1.2 });
  const changed = modelTrusses(m).members.find((v) => v.id === member.id)!;
  assert(Math.abs(memberLength(changed) / memberLength(member) - 1.2) < 1e-6);
  const group = before[0].trussId;
  m = transformElement(m, group, { ...transform, dy: 20 });
  m = removeElement(m, member.id);
  m = ModelSchema.parse(JSON.parse(JSON.stringify(currentModelSnapshot(m))));
  assert(!modelTrusses(m).members.some((v) => v.id === member.id));
  assert.equal(m.framingQuantities!.trussMemberCount, before.length - 1);
  assert.equal(
    m.framingQuantities!.trussLinearFeet,
    buildEstimate(m).framingQuantities.trussLinearFeet,
  );
  for (const id of [...new Set(modelTrusses(m).members.map((v) => v.trussId))])
    m = removeElement(m, id);
  assert.equal(
    modelTrusses(ModelSchema.parse(JSON.parse(JSON.stringify(m)))).members
      .length,
    0,
  );
});
test("HB edits retain correct length and panel totals, new quantities are not priced", () => {
  const m = fixture(),
    before = buildEstimate(m),
    pieces = modelWallFraming(m, 406.4).get("W")!,
    i = pieces.findIndex((p) => p.kind === "brace");
  let edit = editWallMember(m, "W", i, 406.4);
  assert.equal(
    buildEstimate(edit.model).wallPanels[0].totalLinearFeet,
    before.wallPanels[0].totalLinearFeet,
  );
  const changed = transformElement(edit.model, edit.id, {
    ...transform,
    sx: 0.5,
  });
  const after = buildEstimate(changed);
  assert(
    after.framingQuantities.bracingLinearFeet <
      before.framingQuantities.bracingLinearFeet,
  );
  assert.equal(after.total, before.total);
  changed.trussZones = [zone()];
  support(changed, changed.trussZones[0]);
  const withWalls = buildEstimate({ ...changed, trussZones: [] });
  const final = buildEstimate(changed);
  assert.equal(final.total, withWalls.total);
  assert(final.framingQuantities.trussLinearFeet > 0);
  assert.match(
    estimateCsv(final, null, true),
    /Quantity only - pricing pending/,
  );
});

test("legacy material AND labor scope is replaced inside a truss zone", async () => {
  const { legacyFramingArea } = await import("../src/lib/trusses");
  const m = fixture();
  m.trussZones = [zone({ width: 2000, depth: 2000 })];
  support(m, m.trussZones[0]);
  const surface = [
    [-2000, 2800, -2000],
    [2000, 2800, -2000],
    [2000, 2800, 2000],
    [-2000, 2800, 2000],
  ];
  assert.equal(legacyFramingArea(m, surface), 12000000);
  assert.equal(
    legacyFramingArea(
      m,
      surface.map((p) => [p[0], 5000, p[2]]),
    ),
    16000000,
  );
});
test("older custom wall upgrade adds only HB, is idempotent, and respects intentional deletion", async () => {
  const { addBracingToCustomWalls } = await import("../src/lib/framing");
  const frozen = editWallMember(fixture(), "W", 0, 406.4).model;
  const old = structuredClone(frozen);
  old.components = old.components.filter((c) => c.kind !== "brace");
  old.framingAssemblies![0].componentIds = old.components.map((c) => c.id);
  delete old.framingAssemblies![0].bracingVersion;
  const updated = addBracingToCustomWalls(old);
  assert.deepEqual(
    updated.components.filter((c) => c.kind !== "brace"),
    old.components,
  );
  assert(updated.components.some((c) => c.kind === "brace"));
  assert.deepEqual(addBracingToCustomWalls(updated), updated);
  const brace = updated.components.find((c) => c.kind === "brace")!;
  const deleted = removeElement(updated, brace.id);
  assert.deepEqual(addBracingToCustomWalls(deleted), deleted);
});

test("a short final edge gap never adds an overlapping extra truss", () => {
  for (const rotation of [0, 35, 90]) {
    const z = zone({
      width: 3000,
      depth: 5 * TRUSS_SPACING + TRUSS_WIDTH + 20,
      rotation,
    });
    const chords = generateTrusses(z).filter((m) => m.role === "bottom chord");
    const stations = chords
      .map((m) => zoneLocal(z, [m.start[0], m.start[2]])[1])
      .sort((a, b) => a - b);
    assert.equal(stations.length, 6);
    for (let i = 1; i < stations.length; i++)
      assert(Math.abs(stations[i] - stations[i - 1] - TRUSS_SPACING) < 1e-6);
    assert(z.depth / 2 - stations.at(-1)! <= TRUSS_SPACING);
    assert(stations[0] + z.depth / 2 <= TRUSS_SPACING);
  }
  // A narrow zone fits one member, not two overlapping edge members.
  assert.equal(
    generateTrusses(zone({ width: 100, depth: 120 })).filter(
      (m) => m.role === "bottom chord",
    ).length,
    1,
  );
});

test("floating full-room spans and open subdivision seams are excluded; fitting never invents support", () => {
  const m = fixture(),
    z = zone();
  m.trussZones = [z];
  assert.equal(modelTrusses(m).members.length, 0);
  assert.match(modelTrusses(m).warnings.join(" "), /open room\/zone seam/);
  assert.throws(() => fitZoneToWallFaces(m, z), /No continuous/);
  support(m, z);
  assert.equal(unsupportedTrussEnds(m, z), 0);
  assert(modelTrusses(m).members.length > 0);
  const small = { ...z, width: z.width - 200 };
  m.trussZones = [small];
  assert.equal(modelTrusses(m).members.length, 0);
  const fitted = fitZoneToWallFaces(m, small);
  assert.equal(fitted.confirmed, false);
  assert(Math.abs(fitted.width - z.width) < 1e-6);
  assert.deepEqual(fitted.center, z.center);
  assert.equal(unsupportedTrussEnds(m, { ...fitted, confirmed: true }), 0);
  m.trussZones = [
    { ...z, width: z.width / 2, center: [-z.width / 4, 0] },
    { ...z, id: "other-half", width: z.width / 2, center: [z.width / 4, 0] },
  ];
  assert.equal(modelTrusses(m).members.length, 0);
});
test("moved custom chord cannot keep stale quantity approval; full geometry edits persist", () => {
  const m = fixture(),
    z = zone();
  m.trussZones = [z];
  support(m, z);
  const first = generateTrusses(z)[0];
  const edited = transformElement(m, first.id, { ...transform, dx: 25 });
  assert(edited.trussZones![0].members?.length);
  assert.equal(modelTrusses(edited).members.length, 0);
  assert.equal(
    currentModelSnapshot(edited).framingQuantities!.trussLinearFeet,
    0,
  );
  assert.deepEqual(
    ModelSchema.parse(JSON.parse(JSON.stringify(edited))).trussZones,
    edited.trussZones,
  );
});

test("continuous room merge removes an unsupported seam but cannot fill an L-shaped gap", async () => {
  const { mergeRoomZones } = await import("../src/lib/trusses");
  const m = fixture(),
    z = zone();
  support(m, z);
  m.trussZones = [
    { ...z, width: z.width / 2, center: [-z.width / 4, 0] },
    { ...z, id: "right", width: z.width / 2, center: [z.width / 4, 0] },
  ];
  const merged = mergeRoomZones(m, z.id, "right");
  assert.equal(merged.trussZones!.length, 1);
  assert.equal(merged.trussZones![0].width, z.width);
  assert.equal(merged.trussZones![0].confirmed, false);
  merged.trussZones![0].confirmed = true;
  assert(modelTrusses(merged).members.length > 0);
  m.trussZones[1].depth /= 2;
  assert.throws(() => mergeRoomZones(m, z.id, "right"), /full rectangle/);
});

test("unknown ceiling height retains an editable outline but never generates quantities even if confirmed", () => {
  const m = fixture();
  m.trussZones = [
    zone({ heightUnresolved: true, ceilingHeight: 0, confirmed: true }),
  ];
  assert.equal(generateTrusses(m.trussZones[0]).length, 0);
  assert.equal(modelTrusses(m).members.length, 0);
  assert.match(modelTrusses(m).warnings.join(" "), /ceiling height required/);
  assert.equal(currentModelSnapshot(m).framingQuantities!.trussLinearFeet, 0);
});

test("reviewed bulk heights fill only selected unresolved rooms and persist their basis in exports", () => {
  const m = fixture(),
    z = zone({ confirmed: false, ceilingHeight: 0, heightUnresolved: true });
  m.trussZones = [
    z,
    zone({ id: "known", confirmed: false, ceilingHeight: 2500 }),
    zone({
      id: "unselected",
      confirmed: false,
      heightUnresolved: true,
      ceilingHeight: 0,
    }),
    zone({
      id: "manual",
      members: [],
      heightUnresolved: true,
      ceilingHeight: 0,
    }),
    zone({ id: "reviewed" }),
    zone({
      id: "other-floor",
      levelId: "L2",
      confirmed: false,
      heightUnresolved: true,
      ceilingHeight: 0,
    }),
  ];
  m.issues.push({
    id: "missing",
    elementId: z.id,
    severity: "warning",
    message: "Room: ceiling height required.",
    resolved: false,
    resolution: "",
  });
  const before = structuredClone(m);
  const r = reviewRoomHeights(m, {
    levelId: "L1",
    zoneIds: ["Z", "known", "manual", "reviewed", "other-floor"],
    heightMm: 2743.2,
    basis: "floor-model",
    note: "Section A4.00 checked",
    generate: false,
  });
  assert.deepEqual(m, before);
  assert.equal(r.heightsApplied, 1);
  assert.equal(r.model.trussZones![0].heightUnresolved, false);
  assert.equal(r.model.trussZones![0].confirmed, false);
  assert.deepEqual(r.model.trussZones!.slice(1), m.trussZones.slice(1));
  assert.equal(r.model.issues.at(-1)!.resolved, true);
  const snapshot = currentModelSnapshot(r.model);
  assert.equal(
    snapshot.trussZones![0].heightReview?.note,
    "Section A4.00 checked",
  );
  assert.deepEqual(
    ModelSchema.parse(JSON.parse(JSON.stringify(snapshot))).trussZones,
    snapshot.trussZones,
  );
});
test("reviewed rooms generate only after fitting real modeled faces; unsupported rooms retain useful heights", () => {
  const m = fixture(),
    z = zone({ confirmed: false, ceilingHeight: 0, heightUnresolved: true });
  support(m, z);
  m.trussZones = [
    { ...z, width: z.width - 200 },
    zone({
      id: "floating",
      label: "Floating",
      confirmed: false,
      center: [7000, 0],
      heightUnresolved: true,
      ceilingHeight: 0,
    }),
  ];
  const r = reviewRoomHeights(m, {
    levelId: "L1",
    zoneIds: ["Z", "floating"],
    heightMm: 2743.2,
    basis: "reviewer-entered",
    note: "Reviewed ceiling section",
    generate: true,
  });
  assert.equal(r.heightsApplied, 2);
  assert.equal(r.generatedRooms, 1);
  assert.equal(r.messages.length, 1);
  assert.equal(r.model.trussZones![0].width, z.width);
  assert.equal(r.model.trussZones![1].ceilingHeight, 2743.2);
  assert.equal(r.model.trussZones![1].confirmed, false);
  assert(modelTrusses(r.model).members.length > 0);
  assert(currentModelSnapshot(r.model).framingQuantities!.trussLinearFeet > 0);
  assert.deepEqual(r.model.walls, m.walls);
  assert.throws(
    () =>
      reviewRoomHeights(m, {
        levelId: "L1",
        zoneIds: ["Z"],
        heightMm: 0,
        basis: "floor-model",
        note: "Test",
        generate: false,
      }),
    /greater than zero/,
  );
});
test("bulk confirmation cannot displace an existing accepted truss assembly on overlap", () => {
  const m = fixture(),
    z = zone();
  support(m, z);
  m.trussZones = [
    {
      ...z,
      id: "candidate",
      confirmed: false,
      heightUnresolved: true,
      ceilingHeight: 0,
    },
    z,
  ];
  const before = modelTrusses(m);
  const r = reviewRoomHeights(m, {
    levelId: "L1",
    zoneIds: ["candidate"],
    heightMm: z.ceilingHeight,
    basis: "reviewer-entered",
    note: "Source reviewed",
    generate: true,
  });
  assert.equal(r.generatedRooms, 0);
  assert.match(r.messages[0], /overlaps/);
  assert.deepEqual(modelTrusses(r.model).members, before.members);
});

test("guided preview needs no note, preserves source heights, and makes no changes before apply", () => {
  const m = fixture(),
    z = zone({ confirmed: false });
  support(m, z);
  m.trussZones = [z];
  const before = structuredClone(m);
  const r = previewRoomTrusses(m, {
    levelId: "L1",
    zoneIds: ["Z"],
    suggestedHeightMm: null,
    overrides: { Z: 1000 },
  });
  assert.deepEqual(m, before);
  assert.equal(r.ready, 1);
  assert.equal(r.rooms[0].origin, "detected");
  assert.equal(r.model.trussZones![0].ceilingHeight, z.ceilingHeight);
  assert.equal(r.model.trussZones![0].heightReview, undefined);
  assert(r.memberCount > 0);
  assert.equal(modelTrusses(m).members.length, 0);
  assert.equal(
    currentModelSnapshot(r.model).framingQuantities!.trussMemberCount,
    r.memberCount,
  );
});
test("guided preview records suggested height provenance and leaves failed rooms untouched", () => {
  const m = fixture(),
    z = zone({ confirmed: false, heightUnresolved: true, ceilingHeight: 0 });
  support(m, z);
  m.trussZones = [z, { ...z, id: "floating", center: [7000, 0] }];
  const r = previewRoomTrusses(m, {
    levelId: "L1",
    zoneIds: ["Z", "floating"],
    suggestedHeightMm: 3048,
    overrides: {},
  });
  assert.equal(r.ready, 1);
  assert.equal(r.rooms[0].origin, "suggested");
  assert.equal(r.rooms[1].status, "geometry-needed");
  assert.deepEqual(r.model.trussZones![1], m.trussZones[1]);
  assert.equal(r.model.trussZones![0].heightReview?.basis, "floor-model");
  assert.match(
    r.model.trussZones![0].heightReview!.note,
    /not established by extraction/,
  );
  assert.equal(m.trussZones[0].heightUnresolved, true);
});
test("garages and exceptional ceilings require individual heights, without blocking other rooms", () => {
  const m = fixture(),
    z = zone({
      confirmed: false,
      heightUnresolved: true,
      ceilingHeight: 0,
      label: "Garage — unconfirmed",
    });
  support(m, z);
  m.trussZones = [z];
  assert(individualHeightNeeded(z));
  assert(
    individualHeightNeeded({
      ...z,
      label: "Bedroom",
      evidence: [
        {
          planId: "p",
          page: 1,
          sheet: "A4",
          region: null,
          note: "Dropped ceiling shown in section",
        },
      ],
    }),
  );
  assert(!individualHeightNeeded({ ...z, label: "Bedroom" }));
  const options = {
    levelId: "L1",
    zoneIds: ["Z"],
    suggestedHeightMm: 3048,
    overrides: {},
  };
  const r = previewRoomTrusses(m, options);
  assert.equal(r.ready, 0);
  assert.equal(r.rooms[0].status, "height-needed");
  assert.equal(r.rooms[0].name, "Garage");
  const explicit = previewRoomTrusses(m, {
    ...options,
    overrides: { Z: 2743.2 },
  });
  assert.equal(explicit.ready, 1);
  assert.equal(explicit.rooms[0].origin, "entered");
  assert.equal(
    explicit.model.trussZones![0].heightReview?.basis,
    "reviewer-entered",
  );
});
test("invalid height produces a useful preview result; edited common height is marked user-entered", () => {
  const m = fixture(),
    z = zone({ confirmed: false, heightUnresolved: true, ceilingHeight: 0 });
  support(m, z);
  m.trussZones = [z];
  for (const h of [null, NaN, -1, 0, 30001]) {
    const r = previewRoomTrusses(m, {
      levelId: "L1",
      zoneIds: ["Z"],
      suggestedHeightMm: h,
      overrides: {},
    });
    assert.equal(r.rooms[0].status, "height-needed");
    assert.equal(r.ready, 0);
    assert.deepEqual(r.model, m);
  }
  const r = previewRoomTrusses(m, {
    levelId: "L1",
    zoneIds: ["Z"],
    suggestedHeightMm: 2743.2,
    suggestedBasis: "reviewer-entered",
    overrides: {},
  });
  assert.equal(r.rooms[0].origin, "entered");
  assert.equal(r.model.trussZones![0].heightReview?.basis, "reviewer-entered");
});
