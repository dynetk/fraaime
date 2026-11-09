import { test } from "node:test";
import assert from "node:assert/strict";
import { PageObservations, compileObservations } from "../src/lib/observations";
import { exampleModel, ModelSchema } from "../src/lib/model";
import { assemble } from "../src/lib/extraction";
import { MODEL_PRICING, usageCost, aiSettings } from "../src/lib/ai-config";
const source = {
  planId: "test",
  page: 1,
  sheet: "TEST",
  region: [0, 0, 1, 1],
  note: "Synthetic",
};
function observations() {
  const model = exampleModel();
  for (const e of [...model.levels, ...model.walls, ...model.openings])
    e.evidence = [source];
  model.calibrations = [
    {
      page: 1,
      region: [0, 0, 1, 1],
      mmPerPoint: 48,
      dimensionText: "Verified dimension",
      confirmed: false,
    },
  ];
  return PageObservations.parse({
    kind: "floor-plan",
    sheet: "TEST",
    model: { ...model, scheduleEntries: [] },
  });
}
test("unknown dimensions remain observations, not placeholder geometry, through assembly and saved JSON", () => {
  const p = observations();
  p.model.walls[0].thickness = null;
  p.model.openings[0].width = null;
  const r = compileObservations(p, "test", 1);
  assert(!r.model.walls.some((w) => w.id === "wall-1"));
  assert(!r.model.openings.some((o) => o.id === "door-1"));
  assert.equal(r.model.unresolvedObservations?.length, 2);
  const saved = ModelSchema.parse(
    JSON.parse(
      JSON.stringify(assemble([{ page: 1, result: r }], "Sample", "test", [])),
    ),
  );
  assert.equal(saved.unresolvedObservations?.length, 2);
  assert.equal(
    JSON.parse(saved.unresolvedObservations![0].raw).thickness,
    null,
  );
});
test("unscaled or implausibly small geometry is withheld while supported geometry survives", () => {
  const p = observations();
  assert.equal(compileObservations(p, "test", 1).model.walls.length, 8);
  p.model.walls[0].height = 0.0023;
  assert.equal(compileObservations(p, "test", 1).model.walls.length, 7);
  p.model.calibrations = [];
  assert.equal(compileObservations(p, "test", 1).model.walls.length, 0);
});
test("schedule quantities and unknown sizes survive without fabricating placements", () => {
  const p = observations();
  p.kind = "schedule";
  p.model.levels = [];
  p.model.walls = [];
  p.model.openings = [];
  p.model.scheduleEntries = [
    {
      id: "type1",
      label: "Window type",
      kind: "window",
      tag: "W2",
      tagRole: "type",
      quantity: 5,
      width: 762,
      height: null,
      sill: null,
      operation: "",
      evidence: [source],
      inferred: true,
    },
  ];
  const m = compileObservations(p, "test", 1).model;
  assert.equal(m.openings.length, 0);
  assert.equal(m.scheduleEntries![0].quantity, 5);
  assert.equal(
    ModelSchema.parse(JSON.parse(JSON.stringify(m))).scheduleEntries![0].height,
    null,
  );
});
test("wrong source references are not promoted to trusted drawable geometry", () => {
  const p = observations();
  p.model.levels[0].evidence[0].planId = "different";
  assert.equal(compileObservations(p, "test", 1).model.levels.length, 0);
});
test("Terra and Astra use explicit medium reasoning and cache-aware standard pricing", () => {
  for (const model of ["gpt-6.1-terra", "gpt-6-astra"])
    assert.deepEqual(aiSettings({ OPENAI_MODEL: model }).reasoning, {
      effort: "medium",
    });
  assert.equal(usageCost(100000, 10000, 0, "gpt-6.1-terra"), 0.15);
  assert.equal(usageCost(100000, 10000, 0, "gpt-6.1-sol"), 0.3);
  assert.equal(usageCost(100000, 10000, 0, "gpt-6-astra"), 1.5);
  assert.equal(usageCost(100000, 10000, 100000, "gpt-6-astra"), 0.6);
  assert.equal(MODEL_PRICING["gpt-6.1-terra"].cached, 0.05);
});
