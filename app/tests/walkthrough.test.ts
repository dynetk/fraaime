import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  exampleModel,
  ModelSchema,
  blankModel,
  type BuildingModel,
} from "../src/lib/model";
import { FURNITURE, type Furniture } from "../src/lib/furniture";
import {
  canStand,
  findSpawn,
  floorSupports,
  moveWalker,
  navigationFor,
  placementError,
  type Position,
} from "../src/lib/walkthrough";
import {
  buildWalkthroughScene,
  disposeScene,
} from "../src/lib/walkthrough-scene";
import { currentModelSnapshot } from "../src/lib/model-snapshot";
import { buildEstimate } from "../src/lib/estimate";
import { removeElement } from "../src/lib/editing";
import { openLocal, now, uid } from "../src/lib/db";
import { saveRevision } from "../src/lib/revisions";

function room(): BuildingModel {
  const m = blankModel("Synthetic walkthrough fixture");
  m.levels = [
    {
      id: "floor",
      label: "Ground",
      elevation: 0,
      height: 2800,
      outline: [
        [0, 0],
        [8000, 0],
        [8000, 6000],
        [0, 6000],
      ],
      voids: [],
      evidence: [],
      inferred: false,
    },
  ];
  m.walls = [
    {
      id: "partition",
      label: "Partition",
      levelId: "floor",
      start: [4000, 0],
      end: [4000, 6000],
      height: 2800,
      thickness: 100,
      evidence: [],
      inferred: false,
    },
  ];
  return m;
}
const item = (
  kind: Furniture["kind"] = "chair",
  center: Position = [1500, 1500],
): Furniture => ({
  id: "furniture-1",
  kind,
  center,
  levelId: "floor",
  rotation: 0,
});
test("spawn stays on a concave floor and avoids courtyard, walls and furniture", () => {
  const m = room();
  m.levels[0].outline = [
    [0, 0],
    [8000, 0],
    [8000, 2000],
    [3000, 2000],
    [3000, 6000],
    [0, 6000],
  ];
  m.levels[0].voids = [
    [
      [500, 500],
      [2000, 500],
      [2000, 1800],
      [500, 1800],
    ],
  ];
  m.furniture = [item("sofa", [1500, 3500])];
  const nav = navigationFor(m, "floor")!,
    spawn = findSpawn(nav);
  assert.ok(spawn);
  assert.ok(canStand(nav, spawn));
  assert.equal(canStand(nav, [6000, 4000]), false);
  assert.equal(canStand(nav, [1000, 1000]), false);
  assert.equal(canStand(nav, [1500, 3500]), false);
  assert.equal(canStand(nav, [100, 4000]), false);
});
test("movement cannot tunnel through thin walls or leave a floor after a stalled frame", () => {
  const nav = navigationFor(room(), "floor")!;
  const p = moveWalker(nav, [3500, 3000], 20000, 0);
  assert.ok(p[0] < 4000 - 220 - 50);
  assert.ok(canStand(nav, p));
  assert.ok(moveWalker(nav, [1000, 3000], -20000, 0)[0] >= 220);
  assert.deepEqual(moveWalker(nav, [1000, 3000], Infinity, 0), [1000, 3000]);
});
test("full-height doorways are traversable while windows, high thresholds and short doors block walking", () => {
  const m = room();
  m.openings = [
    {
      id: "opening",
      label: "Door",
      tag: "",
      kind: "door",
      wallId: "partition",
      levelId: "floor",
      offset: 2400,
      width: 1200,
      height: 2200,
      sill: 0,
      operation: "",
      evidence: [],
      inferred: false,
    },
  ];
  assert.ok(
    moveWalker(navigationFor(m, "floor")!, [3500, 3000], 1000, 0)[0] > 4000,
  );
  for (const changes of [
    { kind: "window" as const },
    { sill: 500 },
    { height: 1600 },
  ]) {
    const copy = structuredClone(m);
    Object.assign(copy.openings[0], changes);
    assert.ok(
      moveWalker(navigationFor(copy, "floor")!, [3500, 3000], 1000, 0)[0] <
        4000,
    );
  }
  m.openings[0].width = 300;
  assert.equal(canStand(navigationFor(m, "floor")!, [4000, 2550]), false);
});
test("floor voids remain barriers, including when walking diagonally", () => {
  const m = room();
  m.walls = [];
  m.levels[0].voids = [
    [
      [3000, 2000],
      [5000, 2000],
      [5000, 4000],
      [3000, 4000],
    ],
  ];
  const nav = navigationFor(m, "floor")!;
  let p: Position = [2000, 3000];
  for (let i = 0; i < 80; i++) {
    p = moveWalker(nav, p, 200, 25);
    assert.ok(canStand(nav, p));
  }
  assert.equal(floorSupports(m.levels[0], [2900, 3000]), false);
});
test("missing, empty, too low and fully obstructed floors fail gracefully", () => {
  const m = room();
  assert.equal(navigationFor(m, "missing"), null);
  m.levels[0].outline = [];
  assert.equal(findSpawn(navigationFor(m, "floor")!), null);
  m.levels[0].outline = [
    [0, 0],
    [300, 0],
    [300, 300],
    [0, 300],
  ];
  assert.equal(findSpawn(navigationFor(m, "floor")!), null);
  m.levels[0].height = 1000;
  assert.equal(findSpawn(navigationFor(m, "floor")!), null);
});
test("furniture placement checks rotation, walls, other items, floor holes and bounds", () => {
  const m = room();
  assert.equal(placementError(m, item("sofa")), null);
  assert.match(placementError(m, item("sofa", [3900, 2000]))!, /wall/);
  assert.match(placementError(m, item("bed", [300, 300]))!, /floor/);
  const sofa = item("sofa", [1500, 3000]);
  sofa.rotation = 45;
  assert.equal(placementError(m, sofa), null);
  m.furniture = [sofa];
  assert.match(
    placementError(m, { ...item("chair", [1500, 3000]), id: "second" })!,
    /another/,
  );
  assert.equal(placementError(m, sofa), null);
  m.furniture = [];
  m.levels[0].voids = [
    [
      [1400, 1400],
      [1500, 1400],
      [1500, 1500],
      [1400, 1500],
    ],
  ];
  assert.match(placementError(m, item("bed"))!, /floor/);
});
test("legacy schemas remain compatible; furniture is bounded and excluded from extraction and estimates", () => {
  const m = exampleModel();
  assert.equal(ModelSchema.parse(m).furniture, undefined);
  const f = { ...item(), levelId: m.levels[0].id };
  const furnished = ModelSchema.parse({ ...m, furniture: [f] });
  assert.deepEqual(buildEstimate(furnished), buildEstimate(m));
  assert.deepEqual(currentModelSnapshot(furnished).furniture, [f]);
  assert.equal(
    ModelSchema.safeParse({ ...m, furniture: Array(201).fill(f) }).success,
    false,
  );
  assert.equal(
    ModelSchema.safeParse({ ...m, furniture: [{ ...f, center: [NaN, 0] }] })
      .success,
    false,
  );
  assert.equal(
    ModelSchema.safeParse({ ...m, furniture: [{ ...f, kind: "remote-url" }] })
      .success,
    false,
  );
  assert.deepEqual(removeElement(furnished, m.levels[0].id).furniture, []);
});
test("furniture survives revision saves/reloads; stale saves cannot overwrite a layout", async () => {
  const db = await openLocal(),
    project = uid();
  try {
    await db.query(
      "INSERT INTO projects(id,name,owner_email,created_at) VALUES($1,$2,$3,$4)",
      [project, "Tour test", "test@example.com", now()],
    );
    const m = room();
    m.furniture = [item("table")];
    const revision = await saveRevision(
      db,
      project,
      null,
      m,
      "test@example.com",
    );
    const saved = await db.query<{ model: BuildingModel }>(
      "SELECT model FROM revisions WHERE id=$1",
      [revision],
    );
    assert.deepEqual(saved.rows[0].model.furniture, m.furniture);
    await assert.rejects(
      () =>
        saveRevision(
          db,
          project,
          null,
          { ...m, furniture: [] },
          "test@example.com",
        ),
      /Another revision/,
    );
    const next = await saveRevision(
      db,
      project,
      revision,
      { ...m, furniture: [] },
      "test@example.com",
    );
    const deleted = await db.query<{ model: BuildingModel }>(
      "SELECT model FROM revisions WHERE id=$1",
      [next],
    );
    assert.deepEqual(deleted.rows[0].model.furniture, []);
  } finally {
    await db.close?.();
  }
});
test("tour rendering and all lighting presets preserve source geometry and quantities", () => {
  const m = room();
  m.furniture = (Object.keys(FURNITURE) as Furniture["kind"][]).map(
    (kind, i) => ({ ...item(kind), id: `f${i}` }),
  );
  const before = JSON.stringify(m),
    estimate = buildEstimate(m);
  for (const ceiling of [true, false]) {
    const view = buildWalkthroughScene(m, "floor", ceiling);
    for (const preset of ["day", "sunset", "night"] as const)
      for (const lights of [true, false]) view.lighting(preset, lights);
    view.scene.traverse((o) => {
      assert.ok(o.position.toArray().every(Number.isFinite));
    });
    disposeScene(view.scene);
  }
  assert.equal(JSON.stringify(m), before);
  assert.deepEqual(buildEstimate(m), estimate);
});

test("tour rebuild releases shared surface textures exactly once", () => {
  const m = room();
  m.furniture = (Object.keys(FURNITURE) as Furniture["kind"][]).map(
    (kind, i) => ({ ...item(kind), id: `finish-${i}` }),
  );
  const view = buildWalkthroughScene(m, "floor", true);
  const textures = new Map<THREE.Texture, number>();
  view.scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(o.material)
      ? o.material
      : [o.material]) {
      for (const value of Object.values(material)) {
        if (!(value instanceof THREE.Texture) || textures.has(value)) continue;
        textures.set(value, 0);
        value.addEventListener("dispose", () =>
          textures.set(value, textures.get(value)! + 1),
        );
      }
    }
  });
  assert.ok(textures.size > 0, "furnished scenes have surface textures");
  disposeScene(view.scene);
  for (const count of textures.values()) assert.equal(count, 1);
  assert.equal(view.scene.children.length, 0);
});
