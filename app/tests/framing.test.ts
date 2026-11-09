import { test } from "node:test";
import assert from "node:assert/strict";
import { exampleModel, ModelSchema, validateModel } from "../src/lib/model";
import { wallFraming, polygonFraming, roofHeight } from "../src/lib/framing";
import { transformElement, removeElement } from "../src/lib/editing";
import { editWallMember, resetWallFraming } from "../src/lib/framing";

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
  assert.equal(
    transformed.components[0].center[0],
    model.components[0].center[0] + 200,
  );
  assert.equal(
    transformed.components[0].center[1],
    model.components[0].center[1] + 500,
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
test("framing follows resized walls and spacing without mutating the model", () => {
  const m = exampleModel(),
    before = JSON.stringify(m),
    w = m.walls[0];
  assert(wallFraming(w, [], 406.4).length > wallFraming(w, [], 609.6).length);
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
