import { test } from "node:test";
import assert from "node:assert/strict";
import { exampleModel, ModelSchema } from "../src/lib/model";
import {
  wallFraming,
  editWallMember,
  BOX_HEADER_WEB,
} from "../src/lib/framing";
import { buildEstimate, estimateCsv } from "../src/lib/estimate";
import { removeElement, transformElement } from "../src/lib/editing";
function fixture(sill = 900) {
  const m = exampleModel();
  m.walls = [
    {
      ...m.walls[0],
      start: [0, 0],
      end: [5000, 0],
      height: 3200,
      thickness: 152.4,
    },
  ];
  m.openings = [
    {
      ...m.openings[0],
      wallId: m.walls[0].id,
      kind: sill ? "window" : "door",
      offset: 1100,
      width: 1800,
      height: 1500,
      sill,
      dimensionBasis: "rough-opening",
    },
  ];
  return m;
}
test("centered cripple grid aligns above and below windows with maximum 16 inch gaps", () => {
  const m = fixture(),
    p = wallFraming(m.walls[0], m.openings, 406.4);
  const upper = p
      .filter((x) => x.role === "upper cripple stud")
      .map((x) => x.x)
      .sort((a, b) => a - b),
    lower = p
      .filter((x) => x.role === "lower cripple stud")
      .map((x) => x.x)
      .sort((a, b) => a - b);
  assert.deepEqual(upper, lower);
  assert(upper.includes(2000));
  assert.equal(upper.length, 5);
  for (let i = 1; i < upper.length; i++)
    assert(upper[i] - upper[i - 1] <= 406.4 + 0.001);
  assert.equal(
    p.filter((x) => x.kind === "stud" && x.x > 1100 && x.x < 2900).length,
    10,
  );
  const header = p.filter((x) => x.role === "box header C stud");
  assert.equal(header.length, 2);
  assert(
    header.every(
      (x) => Math.abs(x.height - BOX_HEADER_WEB) < 1e-8 && x.width === 1800,
    ),
  );
  assert(header[0].depthOffset! < 0 && header[1].depthOffset! > 0);
  assert.equal(p.filter((x) => x.role?.startsWith("box header")).length, 4);
});
test("door opening stays clear and has no bottom cripple studs", () => {
  const m = fixture(0),
    p = wallFraming(m.walls[0], m.openings, 406.4);
  assert(!p.some((x) => x.role === "lower cripple stud"));
  for (const x of p)
    assert(
      !(
        x.x + x.width / 2 > 1100 &&
        x.x - x.width / 2 < 2900 &&
        x.y - x.height / 2 < 1500 &&
        x.y + x.height / 2 > 0
      ),
    );
});
test("box-header members persist independently; editing and deletion update panel lengths exactly once", () => {
  const m = fixture(),
    pieces = wallFraming(m.walls[0], m.openings, 406.4),
    idx = pieces.findIndex((p) => p.role === "box header C stud");
  const before = buildEstimate(m).wallPanels[0];
  const edit = editWallMember(m, m.walls[0].id, idx, 406.4);
  const saved = ModelSchema.parse(JSON.parse(JSON.stringify(edit.model)));
  assert.deepEqual(buildEstimate(saved).wallPanels[0], {
    ...before,
    source: "saved custom members",
  });
  const header = saved.components.find((c) => c.id === edit.id)!;
  assert.equal(header.depth, 38);
  assert.notEqual(header.center[1], 0);
  const changed = transformElement(saved, header.id, {
    dx: 50,
    dy: 0,
    dz: 0,
    rotation: 0,
    sx: 2,
    sy: 1,
    sz: 1,
  });
  assert(
    Math.abs(
      buildEstimate(changed).wallPanels[0].studLinearFeet -
        before.studLinearFeet -
        1800 / 304.8,
    ) < 0.011,
  );
  const removed = removeElement(saved, header.id);
  assert(
    Math.abs(
      before.totalLinearFeet -
        buildEstimate(removed).wallPanels[0].totalLinearFeet -
        1800 / 304.8,
    ) < 0.011,
  );
  assert.match(
    estimateCsv(buildEstimate(saved), "test", false),
    /Wall panel linear feet/,
  );
});
test("unknown and unit dimensions remain reviewable without invented clearances; low headers flagged", () => {
  const m = fixture();
  m.openings[0].dimensionBasis = "unit";
  m.walls[0].height = 2500;
  const e = buildEstimate(m);
  assert.equal(e.openingSizesToVerify, 0);
  assert.equal(e.headersToReview, 1);
  assert.equal(m.openings[0].width, 1800);
  delete m.openings[0].dimensionBasis;
  assert.equal(buildEstimate(m).openingSizesToVerify, 1);
});
