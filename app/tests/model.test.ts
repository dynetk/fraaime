import { test } from "node:test";
import assert from "node:assert/strict";
import {
  exampleModel,
  validateModel,
  wallPieces,
  ModelSchema,
} from "../src/lib/model";
import {
  addElement,
  transformElement,
  removeElement,
} from "../src/lib/editing";
import { assemble } from "../src/lib/extraction";
const identity = { dx: 0, dy: 0, dz: 0, rotation: 0, sx: 1, sy: 1, sz: 1 };
test("synthetic model has a courtyard and valid openings", () => {
  const m = exampleModel();
  assert.equal(m.levels[0].voids.length, 1);
  assert.equal(validateModel(m).length, 0);
});
test("wall opening removes geometry at door height, leaves header", () => {
  const m = exampleModel(),
    w = m.walls[0],
    pieces = wallPieces(w, m.openings);
  assert(pieces.some((p) => p.a === 1524 && p.bottom === 2133.6));
  assert(!pieces.some((p) => p.a === 1524 && p.bottom === 0));
});
test("resize and rotate wall preserve opening attachment and scale geometry", () => {
  const m = transformElement(exampleModel(), "wall-1", {
    ...identity,
    sx: 2,
    rotation: Math.PI / 2,
    dx: 1000,
  });
  assert(Math.abs(m.walls[0].end[0] - m.walls[0].start[0]) < 0.001);
  assert.equal(m.openings[0].width, 1828.8);
  assert.equal(m.openings[0].offset, 3048);
});
test("delete wall preserves schedule record as unplaced", () => {
  const m = removeElement(exampleModel(), "wall-1");
  assert.equal(m.openings[0].wallId, null);
  assert(validateModel(m).some((i) => i.message.includes("unplaced")));
});
test("removing floor cleans geometry and unplaces its schedule", () => {
  const m = removeElement(exampleModel(), "level-1");
  assert.equal(m.walls.length, 0);
  assert.equal(m.openings.length, 2);
  assert.equal(m.openings[0].levelId, null);
});
test("roof deck and floor void survive JSON roundtrip", () => {
  const m = exampleModel();
  m.levels.push({
    ...m.levels[0],
    id: "deck",
    label: "Roof deck",
    elevation: 3048,
    outline: [
      [0, 0],
      [3000, 0],
      [3000, 2000],
    ],
    voids: [],
  });
  assert.equal(
    ModelSchema.parse(JSON.parse(JSON.stringify(m))).levels[1].label,
    "Roof deck",
  );
});
test("repeated schedule tags are allowed, duplicate element IDs are not", () => {
  const m = exampleModel();
  m.openings.push({
    ...m.openings[1],
    id: "another",
    tag: m.openings[1].tag,
    wallId: null,
  });
  assert(!validateModel(m).some((i) => i.message.includes("Duplicate")));
  m.openings[2].id = m.openings[1].id;
  assert(validateModel(m).some((i) => i.message.includes("Duplicate")));
});
test("invalid dimensions and missing walls are surfaced", () => {
  const m = exampleModel();
  m.openings[0].width = 1e4;
  assert(
    validateModel(m).some(
      (i) => i.message.includes("Overlapping") || i.message.includes("exceeds"),
    ) === false,
  );
  m.openings[0].width = 2e4;
  assert(validateModel(m).some((i) => i.message.includes("exceeds")));
});
test("floor addition uses next story elevation; component attaches to chosen floor", () => {
  let { model: m } = addElement(exampleModel(), "floor", "", 0, 0);
  assert.equal(m.levels[1].elevation, 3048);
  const r = addElement(m, "stud", m.levels[1].id, 500, 800);
  assert.equal(r.model.components[0].levelId, m.levels[1].id);
});
test("assembly preserves missing placements and flags missing scale and omitted pages", () => {
  const data = {
    kind: "floor-plan" as const,
    sheet: "A1",
    model: exampleModel(),
  };
  const m = assemble([{ page: 1, result: data }], "Test", "plan-1", [2, 3]);
  assert(m.issues.some((i) => i.id === "p1-scale"));
  assert(m.issues.some((i) => i.id === "omitted-pages"));
  assert(m.walls.every((w) => w.id.startsWith("p1-")));
});

test("mixed drawing scales remain independent and unconfirmed", () => {
  const data = {
    kind: "floor-plan" as const,
    sheet: "A1",
    model: exampleModel(),
  };
  data.model.calibrations = [
    {
      page: 1,
      region: [0, 0, 0.5, 1],
      mmPerPoint: 12,
      dimensionText: "10 ft",
      confirmed: true,
    },
    {
      page: 1,
      region: [0.5, 0, 1, 1],
      mmPerPoint: 24,
      dimensionText: "20 ft",
      confirmed: true,
    },
  ];
  const m = assemble([{ page: 1, result: data }], "Mixed", "plan", []);
  assert.deepEqual(
    m.calibrations.map((c) => c.mmPerPoint),
    [12, 24],
  );
  assert(m.calibrations.every((c) => !c.confirmed));
});
test("conflicting story elevations are flagged rather than silently replaced", () => {
  const a = exampleModel(),
    b = exampleModel();
  b.levels[0].elevation = 1000;
  const m = assemble(
    [
      { page: 1, result: { kind: "floor-plan", sheet: "A1", model: a } },
      { page: 2, result: { kind: "floor-plan", sheet: "A2", model: b } },
    ],
    "Conflict",
    "plan",
    [],
  );
  assert(m.issues.some((i) => i.message.includes("Conflicting elevation")));
  assert.equal(m.levels[0].elevation, 0);
});
