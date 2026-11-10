import test from "node:test";
import assert from "node:assert/strict";
import {
  exampleModel,
  ModelSchema,
  wallPieces,
  wallTop,
  minimumWallTop,
  wallArea,
  validateModel,
} from "../src/lib/model";
import { wallFraming, editWallMember } from "../src/lib/framing";
import { transformElement } from "../src/lib/editing";

test("sloped wall geometry, studs, tracks, editable members and quantities agree", () => {
  const m = exampleModel(),
    w = m.walls[0];
  m.openings = [];
  w.start = [0, 0];
  w.end = [4000, 0];
  w.height = 4000;
  w.topProfile = [
    [0, 3000],
    [1, 4000],
  ];
  assert.equal(wallTop(w, 2000), 3500);
  assert.equal(wallArea(w), 14000000);
  const pieces = wallPieces(w, []);
  assert.equal(pieces.length, 1);
  assert.equal((pieces[0] as any).topA, 3000);
  assert.equal((pieces[0] as any).topB, 4000);
  const frame = wallFraming(w, [], 406.4);
  const trackIndex = frame.findIndex((p) => p.kind === "track" && p.pitch);
  assert(trackIndex >= 0);
  assert(Math.abs(frame[trackIndex].width - Math.hypot(4000, 1000)) < 0.001);
  for (const stud of frame.filter((p) => p.kind === "stud"))
    assert(stud.y + stud.height / 2 <= wallTop(w, stud.x));
  const editable = editWallMember(m, w.id, trackIndex, 406.4);
  const track = editable.model.components.find((c) => c.id === editable.id)!;
  assert(
    Math.abs(track.pitch! - (Math.atan2(1000, 4000) * 180) / Math.PI) < 0.001,
  );
  const transformed = transformElement(editable.model, w.id, {
    dx: 0,
    dz: 0,
    dy: 0,
    rotation: 0,
    sx: 2,
    sy: 1,
    sz: 1,
  });
  assert(
    Math.abs(
      transformed.components.find((c) => c.id === track.id)!.length -
        Math.hypot(8000, 1000),
    ) < 0.001,
  );
  assert.deepEqual(ModelSchema.parse(transformed).walls[0].topProfile, [
    [0, 3000],
    [1, 4000],
  ]);
  m.openings = [
    {
      id: "bad",
      label: "Too high",
      kind: "window",
      tag: "W",
      operation: "Fixed",
      wallId: w.id,
      levelId: w.levelId,
      offset: 0,
      width: 900,
      height: 1000,
      sill: 2500,
      evidence: [],
      inferred: true,
    },
  ];
  assert(validateModel(m).some((i) => /exceeds wall height/.test(i.message)));
});

test("an opening cannot bridge a low wall-top valley", () => {
  const m = exampleModel(),
    w = m.walls[0];
  w.start = [0, 0];
  w.end = [4000, 0];
  w.height = 4000;
  w.topProfile = [
    [0, 4000],
    [0.5, 2000],
    [1, 4000],
  ];
  assert.equal(minimumWallTop(w, 1000, 3000), 2000);
});
