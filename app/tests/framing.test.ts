import { test } from "node:test";
import assert from "node:assert/strict";
import { exampleModel, ModelSchema, validateModel } from "../src/lib/model";
import { wallFraming, polygonFraming, roofHeight } from "../src/lib/framing";
import { transformElement, removeElement } from "../src/lib/editing";
import { editWallMember, resetWallFraming } from "../src/lib/framing";

test("uninterrupted walls keep the requested stud grid without rounding-induced midpoint studs", () => {
  const base = exampleModel().walls[0];
  for (const spacing of [406.4, 304.8, 254]) {
    for (const span of [3000, 6000, 12000, 30050]) {
      const wall = { ...base, start: [0, 0], end: [span, 0] };
      const actual = wallFraming(wall, [], spacing)
        .filter((p) => p.kind === "stud")
        .map((p) => p.x)
        .sort((a, b) => a - b);
      const expected = [19];
      for (let n = 1; n * spacing < span - 19; n++)
        expected.push(n * spacing);
      expected.push(span - 19);
      assert.equal(actual.length, expected.length, `${span} mm / ${spacing} mm`);
      actual.forEach((x, i) => assert(Math.abs(x - expected[i]) < 0.000001));
    }
  }
});

test("a genuinely oversized bay beside a required stud still receives infill", () => {
  const wall = { ...exampleModel().walls[0], start: [0, 0], end: [6000, 0] };
  // This connection replaces the nearby 406.4 mm grid stud, leaving a real
  // 416.4 mm bay to the next grid stud. Only that bay needs an extra member.
  const studs = wallFraming(wall, [], 406.4, [396.4])
    .filter((p) => p.kind === "stud")
    .sort((a, b) => a.x - b.x);
  assert.equal(studs.length, 17);
  assert(studs.some((p) => Math.abs(p.x - 604.6) < 0.000001));
  assert(studs.some((p) => p.x === 396.4 && p.role === "panel connection stud"));
  for (let i = 1; i < studs.length; i++)
    assert(studs[i].x - studs[i - 1].x <= 406.4 + 0.000001);
});

test("generated studs, tracks and headers become independent persisted components", () => {
  const original = exampleModel(),
    wall = original.walls[0];
  const pieces = wallFraming(wall, original.openings, 406.4);
  for (const kind of ["stud", "track", "header"]) {
    const index = pieces.findIndex((p) => p.kind === kind);
    assert(index >= 0);
    const editable = editWallMember(original, wall.id, index, 406.4);
    const component = editable.model.components.find(
      (c) => c.id === editable.id,
    )!;
    const edited = transformElement(editable.model, component.id, {
      dx: 200,
      dy: 100,
      dz: 300,
      rotation: Math.PI / 4,
      sx: 2,
      sy: 0.8,
      sz: 1,
    });
    const saved = ModelSchema.parse(JSON.parse(JSON.stringify(edited)));
    const changed = saved.components.find((c) => c.id === component.id)!;
    assert.equal(changed.center[0], component.center[0] + 200);
    assert.equal(changed.height, component.height * 0.8);
    assert.equal(changed.length, component.length * 2);
    assert.equal(changed.rotation, component.rotation + 45);
    assert.deepEqual(saved.walls, original.walls);
    assert.equal(validateModel(saved).length, 0);
    const removed = removeElement(saved, component.id);
    assert(!removed.components.some((c) => c.id === component.id));
    assert(removed.framingAssemblies?.some((a) => a.wallId === wall.id));
    assert.equal(
      removed.components.length,
      editable.model.components.length - 1,
    );
  }
  assert.equal(original.components.length, 0);
});
test("deleting all customized framing keeps it empty across spacing changes and reload", () => {
  let { model } = editWallMember(exampleModel(), "wall-1", 0, 406.4);
  for (const id of [...model.framingAssemblies![0].componentIds])
    model = removeElement(model, id);
  model = ModelSchema.parse(JSON.parse(JSON.stringify(model)));
  assert.equal(model.framingAssemblies![0].componentIds.length, 0);
  assert.equal(
    editWallMember(model, "wall-1", 0, 609.6).model.components.length,
    0,
  );
  assert.equal(resetWallFraming(model, "wall-1").framingAssemblies!.length, 0);
});
test("wall transforms carry custom framing and wall deletion removes its members", () => {
  const { model } = editWallMember(exampleModel(), "wall-1", 0, 406.4);
  const transformed = transformElement(model, "wall-1", {
    dx: 200,
    dy: 0,
    dz: 500,
    rotation: 0,
    sx: 1,
    sy: 1,
    sz: 1,
  });
  assert(
    Math.abs(
      transformed.components[0].center[0] - model.components[0].center[0] - 200,
    ) < 0.001,
  );
  assert(
    Math.abs(
      transformed.components[0].center[1] - model.components[0].center[1] - 500,
    ) < 0.001,
  );
  assert.equal(removeElement(model, "wall-1").components.length, 0);
  assert.equal(removeElement(model, "level-1").framingAssemblies!.length, 0);
  assert.equal(resetWallFraming(model, "wall-1").components.length, 0);
});

test("framing leaves door/window apertures clear, including stacked openings", () => {
  const m = exampleModel(),
    w = m.walls[0];
  m.openings = [
    {
      ...m.openings[0],
      wallId: w.id,
      offset: 700,
      width: 950,
      height: 1400,
      sill: 0,
    },
    {
      ...m.openings[0],
      id: "stacked",
      wallId: w.id,
      offset: 800,
      width: 500,
      height: 300,
      sill: 1700,
    },
  ];
  const members = wallFraming(w, m.openings, 406.4);
  assert(members.some((v) => v.kind === "header"));
  assert(members.some((v) => v.kind === "stud"));
  for (const v of members)
    for (const o of m.openings) {
      const overlapX =
        Math.min(v.x + v.width / 2, o.offset + o.width) -
        Math.max(v.x - v.width / 2, o.offset);
      const overlapY =
        Math.min(v.y + v.height / 2, o.sill + o.height) -
        Math.max(v.y - v.height / 2, o.sill);
      assert(
        !(overlapX > 0.001 && overlapY > 0.001),
        "member intersects clear opening",
      );
    }
});
test("below-datum thresholds keep the scheduled header elevation and clear the base track", () => {
  const m = exampleModel(),
    w = m.walls[0];
  const door = {
    ...m.openings[0],
    kind: "door" as const,
    wallId: w.id,
    sill: -15.875,
  };
  const members = wallFraming(w, [door], 406.4);
  const headers = members.filter((p) => p.role === "box header C stud");
  assert.equal(headers.length, 2);
  for (const header of headers) {
    assert(
      Math.abs(header.y - header.height / 2 - door.sill - door.height) < 0.001,
    );
    assert(Math.abs(header.width - door.width) < 0.001);
  }
  for (const p of members) {
    assert(p.y - p.height / 2 >= 0);
    const overlapX =
      Math.min(p.x + p.width / 2, door.offset + door.width) -
      Math.max(p.x - p.width / 2, door.offset);
    const overlapY =
      Math.min(p.y + p.height / 2, door.sill + door.height) -
      Math.max(p.y - p.height / 2, door.sill);
    assert(!(overlapX > 0.001 && overlapY > 0.001));
  }
});
test("framing follows resized walls and spacing without mutating the model", () => {
  const m = exampleModel(),
    before = JSON.stringify(m),
    w = m.walls[0];
  assert.deepEqual(wallFraming(w, [], 406.4), wallFraming(w, [], 609.6));
  const resized = transformElement(m, w.id, {
    dx: 0,
    dy: 0,
    dz: 0,
    rotation: 0,
    sx: 2,
    sy: 1,
    sz: 1,
  });
  assert(
    wallFraming(resized.walls[0], [], 406.4).length >
      wallFraming(w, [], 406.4).length,
  );
  assert.equal(JSON.stringify(m), before);
});
test("floor framing clips joists around courtyard and concave perimeter", () => {
  const outline = [
    [0, 0],
    [4000, 0],
    [4000, 2000],
    [2000, 2000],
    [2000, 4000],
    [0, 4000],
  ];
  const hole = [
    [500, 500],
    [1500, 500],
    [1500, 1500],
    [500, 1500],
  ];
  const lines = polygonFraming(outline, [hole], 1000);
  const joists = lines.slice(outline.length + hole.length);
  assert.deepEqual(
    joists
      .filter((l) => l.start[0] === 1000)
      .map((l) => [l.start[1], l.end[1]]),
    [
      [0, 500],
      [1500, 4000],
    ],
  );
  assert.deepEqual(
    joists
      .filter((l) => l.start[0] === 3000)
      .map((l) => [l.start[1], l.end[1]]),
    [[0, 2000]],
  );
});
test("roof members follow the roof slope", () => {
  assert.equal(
    roofHeight(
      [
        [0, 3000, 0],
        [4000, 5000, 0],
        [4000, 5000, 6000],
        [0, 3000, 6000],
      ],
      2000,
      3000,
    ),
    4000,
  );
});
