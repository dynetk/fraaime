import test from "node:test";
import assert from "node:assert/strict";
import { currentModelSnapshot } from "../src/lib/model-snapshot";
import { exampleModel, ModelSchema } from "../src/lib/model";
import { buildEstimate } from "../src/lib/estimate";
import { editWallMember } from "../src/lib/framing";
import { removeElement, transformElement } from "../src/lib/editing";

test("export replaces historical quantities and reflects unsaved wall edits without mutating input", () => {
  const model = exampleModel();
  model.walls = [{ ...model.walls[0], start: [0, 0], end: [6000, 0] }];
  model.openings = [];
  model.panelQuantities = buildEstimate(model).wallPanels.map((p) => ({
    ...p,
    source: "lorenzo-panel-connections-v2",
    studLinearFeet: 99999,
  }));
  const original = JSON.stringify(model);
  const exported = ModelSchema.parse(
    JSON.parse(JSON.stringify(currentModelSnapshot(model))),
  );
  assert.equal(JSON.stringify(model), original);
  assert.equal(
    exported.panelQuantities![0].source,
    "lorenzo-panel-connections-v3",
  );
  assert.equal(
    buildEstimate(exported).quantities.filter((q) => q.kind === "stud").length,
    16,
  );
  assert.deepEqual(exported.panelQuantities, buildEstimate(model).wallPanels);
  model.walls[0].end = [9000, 0]; // Editing has not refreshed the cached snapshot.
  const changed = currentModelSnapshot(model);
  assert(
    changed.panelQuantities![0].studLinearFeet >
      exported.panelQuantities![0].studLinearFeet,
  );
});

test("export retains customized, moved and deleted members and the chosen pricing scope", () => {
  const edit = editWallMember(exampleModel(), "wall-1", 0, 406.4);
  let model = transformElement(edit.model, edit.id, {
    dx: 100,
    dy: 0,
    dz: 0,
    rotation: 0,
    sx: 1.5,
    sy: 1,
    sz: 1,
  });
  model = removeElement(model, model.framingAssemblies![0].componentIds[1]);
  model.estimate = buildEstimate(model).settings;
  model.estimate.rates.stud = 7;
  model.estimate.includeRoofFraming = false;
  const original = JSON.stringify(model),
    exported = currentModelSnapshot(model);
  assert.equal(JSON.stringify(model), original);
  assert.deepEqual(exported.components, model.components);
  assert.deepEqual(exported.framingAssemblies, model.framingAssemblies);
  assert.deepEqual(exported.walls, model.walls);
  assert.equal(exported.estimate!.rates.stud, 7);
  assert.equal(exported.estimate!.includeRoofFraming, false);
  assert.equal(
    exported.panelQuantities!.find((p) => p.wallId === "wall-1")!.source,
    "saved custom members",
  );
  assert.deepEqual(exported.panelQuantities, buildEstimate(model).wallPanels);
});
