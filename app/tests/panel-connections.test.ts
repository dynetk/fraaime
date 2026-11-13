import { test } from "node:test";
import assert from "node:assert/strict";
import {
  exampleModel,
  ModelSchema,
  type BuildingModel,
  type WallData,
} from "../src/lib/model";
import { panelConnections, framingPanel } from "../src/lib/panel-connections";
import {
  modelWallFraming,
  wallFraming,
  editWallMember,
  MEMBER_FACE,
} from "../src/lib/framing";
import { buildEstimate, estimateCsv } from "../src/lib/estimate";
import { removeElement } from "../src/lib/editing";
function fixture(tee = false) {
  const m = exampleModel(),
    base = m.walls[0];
  m.walls = [
    {
      ...base,
      id: "host",
      label: "WP-1",
      start: [0, 0],
      end: [4000, 0],
      height: 3000,
      thickness: 152.4,
      framingWebDepthMm: 152.4,
    },
    {
      ...base,
      id: "branch",
      label: "WP-2",
      start: [tee ? 2000 : 0, 0],
      end: [tee ? 2000 : 0, 3000],
      height: 3000,
      thickness: 152.4,
      framingWebDepthMm: 152.4,
    },
  ];
  m.openings = [];
  m.components = [];
  m.framingAssemblies = [];
  return m;
}
const close = (a: number, b: number) =>
  assert(Math.abs(a - b) < 0.001, `${a} != ${b}`);
function checkStuds(m: BuildingModel) {
  for (const pieces of modelWallFraming(m, 609.6).values()) {
    const studs = pieces
      .filter((p) => p.kind === "stud")
      .sort((a, b) => a.x - b.x);
    for (let i = 1; i < studs.length; i++) {
      assert(studs[i].x - studs[i - 1].x <= 406.4 + 0.001);
      assert(studs[i].x - studs[i - 1].x >= MEMBER_FACE - 0.001);
    }
  }
}
test("L joint creates a continuous panel and face-terminated branch without moving source geometry", () => {
  const m = fixture(),
    original = JSON.stringify(m),
    layout = panelConnections(m);
  assert.equal(layout.connections.length, 1);
  const c = layout.connections[0];
  assert.equal(c.kind, "corner");
  assert(c.applied);
  assert.equal(c.throughWallId, "host");
  const h = layout.panels.get("host")!,
    b = layout.panels.get("branch")!;
  close(h.startOffset, -76.2);
  close(b.startOffset, 76.2);
  assert.deepEqual(framingPanel(h).start, [-76.2, 0]);
  assert.deepEqual(framingPanel(b).start, [0, 76.2]);
  const pieces = modelWallFraming(m, 406.4).get("host")!;
  const plain = wallFraming(framingPanel(h), [], 406.4);
  assert.equal(
    pieces.filter((p) => p.kind === "stud").length,
    plain.filter((p) => p.kind === "stud").length + 1,
  );
  const studs = pieces.filter((p) => p.role === "panel connection stud");
  assert.equal(studs.length, 2);
  close(studs[1].x - studs[0].x + MEMBER_FACE, 152.4);
  checkStuds(m);
  assert.equal(JSON.stringify(m), original);
});
test("T joint preserves one continuous host, adds a pair aligned to branch web and supports unequal depths", () => {
  const m = fixture(true);
  m.walls[0].framingWebDepthMm = 92.075;
  const l = panelConnections(m);
  assert.equal(l.connections[0].kind, "tee");
  assert(l.connections[0].applied);
  close(l.panels.get("host")!.startOffset, 0);
  close(l.panels.get("host")!.endOffset, 4000);
  close(l.panels.get("branch")!.startOffset, 46.0375);
  const targets = l.panels.get("host")!.connectionStuds.sort((a, b) => a - b);
  close(targets[0] - MEMBER_FACE / 2, 2000 - 76.2);
  close(targets[1] + MEMBER_FACE / 2, 2000 + 76.2);
  checkStuds(m);
});
test("an already aligned host stud is reused; nearby grid studs never overlap connection studs", () => {
  const m = fixture(true);
  m.walls[1].start[0] = 463.6;
  m.walls[1].end[0] = 463.6;
  const pieces = modelWallFraming(m, 406.4).get("host")!;
  assert.equal(
    pieces.filter((p) => p.kind === "stud" && Math.abs(p.x - 406.4) < 0.001)
      .length,
    1,
  );
  assert.equal(
    pieces.filter((p) => p.role === "panel connection stud").length,
    2,
  );
  checkStuds(m);
});
test("reversed and rotated wall directions preserve the joint, including endpoints already at a face", () => {
  const m = fixture(true);
  m.walls[1].start = [2000, 76.2];
  let l = panelConnections(m);
  assert(l.connections[0].applied);
  close(l.panels.get("branch")!.startOffset, 0);
  for (const w of m.walls) {
    [w.start, w.end] = [w.end, w.start];
    const rot = (p: number[]) => [
      p[0] * Math.cos(0.63) - p[1] * Math.sin(0.63) + 500,
      p[0] * Math.sin(0.63) + p[1] * Math.cos(0.63) - 800,
    ];
    w.start = rot(w.start);
    w.end = rot(w.end);
  }
  l = panelConnections(m);
  assert(l.connections[0].applied);
  assert.equal(l.connections[0].kind, "tee");
  checkStuds(m);
});
test("corner choice persists and flips which panel continues, without changing source areas or opening coordinates", () => {
  const m = fixture();
  const c = panelConnections(m).connections[0];
  m.panelConnectionChoices = [{ connectionId: c.id, throughWallId: "branch" }];
  const saved = ModelSchema.parse(JSON.parse(JSON.stringify(m))),
    l = panelConnections(saved);
  assert.equal(l.connections[0].throughWallId, "branch");
  close(l.panels.get("host")!.startOffset, 76.2);
  assert.deepEqual(saved.levels, m.levels);
  assert.deepEqual(saved.walls, m.walls);
});
test("opening conflict blocks the connection rather than clipping an opening or adding overlapping studs", () => {
  const m = fixture(true),
    original = exampleModel().openings[0];
  m.openings = [
    {
      ...original,
      id: "door",
      wallId: "host",
      levelId: m.walls[0].levelId,
      offset: 1900,
      width: 600,
      height: 2100,
      sill: 0,
    },
  ];
  const l = panelConnections(m);
  assert(!l.connections[0].applied);
  assert.match(l.connections[0].messages.join(" "), /conflict/);
  close(l.panels.get("branch")!.startOffset, 0);
  for (const p of modelWallFraming(m, 406.4).get("host")!)
    assert(
      !(
        p.x + p.width / 2 > 1900 + 0.001 &&
        p.x - p.width / 2 < 2500 - 0.001 &&
        p.y - p.height / 2 < 2100 - 0.001 &&
        p.y + p.height / 2 > 0
      ),
    );
});
test("separate stories and disconnected walls do not acquire connections; angled joints remain reviewable", () => {
  const m = fixture();
  m.walls[1].levelId = "different";
  assert.equal(panelConnections(m).connections.length, 0);
  m.walls[1].levelId = m.walls[0].levelId;
  m.walls[1].start = [0, 200];
  assert.equal(panelConnections(m).connections.length, 0);
  m.walls[1].start = [0, 0];
  m.walls[1].end = [2000, 2000];
  const c = panelConnections(m).connections[0];
  assert.equal(c.kind, "unsupported");
  assert(!c.applied);
});
test("connection members remain editable, persisted and counted once in panel linear feet", () => {
  const m = fixture(true),
    before = buildEstimate(m),
    pieces = modelWallFraming(m, 406.4).get("host")!;
  const index = pieces.findIndex((p) => p.role === "panel connection stud");
  const edit = editWallMember(m, "host", index, 406.4),
    saved = ModelSchema.parse(JSON.parse(JSON.stringify(edit.model)));
  const after = buildEstimate(saved);
  for (const id of ["host", "branch"]) {
    const a = before.wallPanels.find((p) => p.wallId === id)!,
      b = after.wallPanels.find((p) => p.wallId === id)!;
    close(a.studLinearFeet, b.studLinearFeet);
    close(a.trackLinearFeet, b.trackLinearFeet);
    close(a.connectionStudLinearFeet, b.connectionStudLinearFeet);
  }
  const member = saved.components.find((c) => c.id === edit.id)!;
  assert.equal(member.framingRole, "panel connection stud");
  const removed = buildEstimate(removeElement(saved, edit.id!));
  // Subtract from unrounded quantities: panel display totals are rounded to
  // hundredths of a foot and cannot be used as an exact arithmetic baseline.
  const originalStudFeet = before.quantities
    .filter((q) => q.elementId === "host" && ["stud", "header"].includes(q.kind))
    .reduce((sum, q) => sum + q.lengthFt, 0);
  close(
    Math.round(
      (originalStudFeet - member.height / 304.8) * 100,
    ) / 100,
    removed.wallPanels.find((p) => p.wallId === "host")!.studLinearFeet,
  );
  assert.match(estimateCsv(after, null, false), /Connection stud LF/);
});
test("trimmed profiles retain source heights and all default wall spacings stay at most 16 inches", () => {
  const m = fixture(true);
  m.walls[1].topProfile = [
    [0, 2800],
    [0.5, 3200],
    [1, 3000],
  ];
  m.walls[1].height = 3200;
  const p = panelConnections(m).panels.get("branch")!,
    w = framingPanel(p);
  close(w.topProfile![0][1], 2800 + (76.2 / 1500) * 400);
  assert.equal(w.topProfile!.at(-1)![0], 1);
  const single = fixture().walls[0];
  assert.deepEqual(
    wallFraming(single, [], 406.4),
    wallFraming(single, [], 609.6),
  );
  assert.throws(() => wallFraming(single, [], NaN), /finite/);
});
test("modeled wall thickness is the accepted default and follows model size without a review warning", () => {
  const m = fixture();
  delete m.walls[0].framingWebDepthMm;
  delete m.walls[1].framingWebDepthMm;
  const parsed = ModelSchema.parse(JSON.parse(JSON.stringify(m))),
    c = panelConnections(parsed).connections[0];
  assert.equal(c.webDepthBasis, "modeled wall thickness");
  assert.equal(c.webDepthMm, parsed.walls[1].thickness);
  assert.deepEqual(c.messages, []);
  assert.equal(buildEstimate(parsed).connectionReviewCount, 0);
  parsed.walls[1].thickness = 100;
  assert.equal(panelConnections(parsed).connections[0].webDepthMm, 100);
  parsed.walls[1].framingWebDepthMm = 92.075;
  const override = panelConnections(parsed).connections[0];
  assert.equal(override.webDepthMm, 92.075);
  assert.equal(override.webDepthBasis, "wall override");
});

test("four-wall loop closes at every corner for all continuity choices and source orders", () => {
  for (let mask = 0; mask < 16; mask++) {
    const m = fixture(),
      base = m.walls[0];
    m.walls = [
      { ...base, id: "a", start: [0, 0], end: [4000, 0] },
      { ...base, id: "b", start: [4000, 0], end: [4000, 3000] },
      { ...base, id: "c", start: [4000, 3000], end: [0, 3000] },
      { ...base, id: "d", start: [0, 3000], end: [0, 0] },
    ];
    m.panelConnectionChoices = panelConnections(m).connections.map((c, i) => ({
      connectionId: c.id,
      throughWallId: mask & (1 << i) ? c.branchWallId : c.throughWallId,
    }));
    const layout = panelConnections(m);
    assert.equal(layout.connections.length, 4);
    assert(layout.connections.every((c) => c.applied));
    const bounds = [...layout.panels.values()].map((p) => {
      const w = framingPanel(p),
        half = w.thickness / 2;
      const horizontal = Math.abs(w.end[1] - w.start[1]) < 0.001;
      return [
        Math.min(w.start[0], w.end[0]) - (horizontal ? 0 : half),
        Math.max(w.start[0], w.end[0]) + (horizontal ? 0 : half),
        Math.min(w.start[1], w.end[1]) - (horizontal ? half : 0),
        Math.max(w.start[1], w.end[1]) + (horizontal ? half : 0),
      ];
    });
    for (let i = 0; i < bounds.length; i++)
      for (let j = i + 1; j < bounds.length; j++) {
        const a = bounds[i],
          b = bounds[j];
        assert(
          !(
            Math.min(a[1], b[1]) - Math.max(a[0], b[0]) > 0.001 &&
            Math.min(a[3], b[3]) - Math.max(a[2], b[2]) > 0.001
          ),
        );
      }
    checkStuds(m);
    m.walls.reverse();
    assert.deepEqual(panelConnections(m).connections, layout.connections);
  }
});

test("opposing T branches reuse their host pair; nearby conflicting junctions are flagged", () => {
  const m = fixture(true),
    branch = m.walls[1];
  m.walls.push({ ...branch, id: "opposite", end: [2000, -3000] });
  let layout = panelConnections(m);
  assert.equal(layout.connections.filter((c) => c.applied).length, 2);
  assert.equal(layout.panels.get("host")!.connectionStuds.length, 2);
  checkStuds(m);
  m.walls[2].start = [2010, 0];
  m.walls[2].end = [2010, -3000];
  layout = panelConnections(m);
  assert.equal(layout.connections.filter((c) => c.applied).length, 1);
  assert(
    layout.connections.some((c) =>
      c.messages.some((s) => s.includes("conflict")),
    ),
  );
  checkStuds(m);
});

test("a T whose through-wall was split by extraction is flagged instead of treated as two L corners", () => {
  const m = fixture(true),
    host = m.walls[0];
  host.end = [2000, 0];
  m.walls.push({
    ...host,
    id: "host-other-half",
    start: [2000, 0],
    end: [4000, 0],
  });
  const layout = panelConnections(m);
  assert.equal(layout.connections.length, 2);
  assert(
    layout.connections.every((c) => !c.applied && c.kind === "unsupported"),
  );
  assert(
    layout.connections.every((c) =>
      c.messages.some((s) => s.includes("split T")),
    ),
  );
  for (const p of layout.panels.values()) {
    close(p.startOffset, 0);
    assert.equal(p.connectionStuds.length, 0);
  }
});
