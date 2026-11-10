import assert from "node:assert/strict";
import { test } from "node:test";
import { blankModel, ModelSchema } from "../src/lib/model";
import { MOCK_ESTIMATE_SETTINGS } from "../src/lib/estimate-settings";
import { buildEstimate, estimateCsv } from "../src/lib/estimate";
import { editWallMember } from "../src/lib/framing";
import { removeElement } from "../src/lib/editing";
import { openLocal, uid, now } from "../src/lib/db";
import { saveRevision } from "../src/lib/revisions";
const FT = 304.8;
function model() {
  const m = blankModel("Synthetic estimate");
  m.levels.push({
    id: "l",
    label: "Floor",
    elevation: 0,
    height: 10 * FT,
    outline: [
      [0, 0],
      [10 * FT, 0],
      [10 * FT, 10 * FT],
      [0, 10 * FT],
    ],
    voids: [],
    inferred: true,
    evidence: [],
  });
  return m;
}
function settings() {
  return {
    ...structuredClone(MOCK_ESTIMATE_SETTINGS),
    includeFloorFraming: false,
    includeRoofFraming: false,
    includeLabor: false,
  };
}
test("mock estimate reconciles rounded line costs, waste, contingency and markup", () => {
  const m = model();
  m.components.push(
    {
      id: "s",
      label: "Stud",
      levelId: "l",
      kind: "stud",
      center: [0, 0],
      elevation: 0,
      length: 38,
      depth: 100,
      height: 10 * FT,
      rotation: 0,
      evidence: [],
      inferred: true,
    },
    {
      id: "t",
      label: "Track",
      levelId: "l",
      kind: "track",
      center: [0, 0],
      elevation: 0,
      length: 10 * FT,
      depth: 100,
      height: 38,
      rotation: 0,
      evidence: [],
      inferred: true,
    },
  );
  const s = settings();
  s.rates.stud = 2;
  s.rates.track = 1;
  s.delivery = 100;
  s.wastePercent = 10;
  s.contingencyPercent = 10;
  s.markupPercent = 20;
  const e = buildEstimate(m, s);
  assert.equal(e.materials, 44);
  assert.equal(e.settings.rates.track, 2);
  assert.equal(e.settings.rates.header, 2);
  assert.equal(s.rates.track, 1, "legacy settings are not mutated");
  assert.equal(e.direct, 144);
  assert.equal(e.contingency, 14.4);
  assert.equal(e.markup, 31.68);
  assert.equal(e.total, 190.08);
  assert.equal(e.labor, 0);
  const midpoint = structuredClone(m);
  midpoint.components = [
    { ...m.components[1], kind: "header", length: 10.45 * FT },
  ];
  assert.equal(
    buildEstimate(midpoint, {
      ...s,
      wastePercent: 0,
      rates: { ...s.rates, stud: 5.5 },
    }).materials,
    57.48,
  );
  assert.equal(buildEstimate(blankModel(), s).total, 0);
});
test("customizing, resizing and deleting wall members updates quantities without double counting", () => {
  const m = model();
  m.walls.push({
    id: "w",
    label: "Wall",
    levelId: "l",
    start: [0, 0],
    end: [10 * FT, 0],
    height: 10 * FT,
    thickness: 100,
    evidence: [],
    inferred: true,
  });
  const s = { ...settings(), includeLabor: true };
  const before = buildEstimate(m, s);
  assert.equal(before.lines.find((l) => l.id === "track")!.quantity, 20);
  assert.equal(before.wallArea, 100);
  const edited = editWallMember(m, "w", 0, s.spacingMm).model;
  assert.equal(buildEstimate(edited, s).total, before.total);
  const stud = edited.components.find((c) => c.kind === "stud")!;
  const old = buildEstimate(edited, s).quantities.reduce(
    (n, q) => n + q.lengthFt,
    0,
  );
  stud.height += FT;
  assert.ok(
    Math.abs(
      buildEstimate(edited, s).quantities.reduce((n, q) => n + q.lengthFt, 0) -
        old -
        1,
    ) < 1e-8,
  );
  let deleted = edited;
  for (const c of [...edited.components])
    deleted = removeElement(deleted, c.id);
  assert.equal(
    buildEstimate(deleted, s).total,
    0,
    "An empty custom layout must not regenerate or charge its wall",
  );
});
test("floor voids and sloped roof voids use net area; scope excludes roof decks", () => {
  const m = model();
  m.levels[0].voids = [
    [
      [3 * FT, 3 * FT],
      [7 * FT, 3 * FT],
      [7 * FT, 7 * FT],
      [3 * FT, 7 * FT],
    ],
  ];
  const s = { ...settings(), includeFloorFraming: true, includeLabor: true };
  const e = buildEstimate(m, s);
  assert.equal(e.floorArea, 84);
  assert.equal(e.lines.find((l) => l.id === "joist")!.quantity, 114);
  m.roofs.push({
    id: "r",
    label: "Sloped roof",
    levelId: "l",
    evidence: [],
    inferred: true,
    vertices: m.levels[0].outline.map(([x, z]) => [x, x, z]),
    voids: m.levels[0].voids.map((h) => h.map(([x, z]) => [x, x, z])),
  });
  const roofSettings = {
    ...s,
    includeFloorFraming: false,
    includeRoofFraming: true,
  };
  assert.equal(buildEstimate(m, roofSettings).roofArea, 118.79);
  m.roofs[0].surface = "roof-deck";
  assert.equal(buildEstimate(m, roofSettings).total, 0);
});
test("estimates retain omissions and block invalid inputs; exports carry mock status and resist formulas", () => {
  const m = model();
  m.name = '=HYPERLINK("https://example.com")';
  m.components.push({
    id: "box",
    label: "Unpriced",
    kind: "box",
    levelId: "l",
    center: [0, 0],
    elevation: 0,
    length: 1000,
    depth: 1000,
    height: 1000,
    rotation: 0,
    evidence: [],
    inferred: true,
  });
  const e = buildEstimate(m);
  assert.equal(e.unpricedBoxes, 1);
  assert.equal(e.total, 0);
  assert.throws(() => buildEstimate(m, { ...settings(), delivery: -1 }));
  assert.throws(() => buildEstimate(m, { ...settings(), markupPercent: NaN }));
  const csv = estimateCsv(e, "revision-1", true);
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.ok(csv.includes("MOCK PRICING"));
  assert.ok(csv.includes("revision-1"));
  assert.ok(csv.includes("tax excluded"));
});
test("server revisions snapshot rates and scope and restore the same estimate on reload", async () => {
  const db = await openLocal(),
    project = uid();
  await db.query(
    "INSERT INTO projects(id,name,owner_email,created_at) VALUES($1,$2,$3,$4)",
    [project, "Synthetic", "test", now()],
  );
  const m = model();
  const id = await saveRevision(db, project, null, m, "test");
  const stored = (
    await db.query<{ model: unknown }>(
      "SELECT model FROM revisions WHERE id=$1",
      [id],
    )
  ).rows[0].model;
  const restored = ModelSchema.parse(stored);
  assert.deepEqual(restored.estimate, MOCK_ESTIMATE_SETTINGS);
  restored.estimate!.rates.stud = 7.25;
  restored.estimate!.includeFloorFraming = true;
  const next = await saveRevision(db, project, id, restored, "test");
  const reopened = ModelSchema.parse(
    (
      await db.query<{ model: unknown }>(
        "SELECT model FROM revisions WHERE id=$1",
        [next],
      )
    ).rows[0].model,
  );
  assert.equal(reopened.estimate!.rates.stud, 7.25);
  assert.equal(buildEstimate(reopened).total, buildEstimate(restored).total);
});
