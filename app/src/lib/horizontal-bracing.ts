import { length, wallTop, type WallData, type OpeningData } from "./model";
import type { FramePiece } from "./framing";
import { MEMBER_FACE } from "./framing-constants";
export const HB_SPACING = 1219.2;
/** Continuous through studs; subtract openings, headers and tracks without moving rows. */
export function horizontalBracing(
  wall: WallData,
  openings: OpeningData[],
  pieces: FramePiece[],
): FramePiece[] {
  const span = length(wall),
    face = MEMBER_FACE,
    result: FramePiece[] = [];
  const top = wall.topProfile ?? [
    [0, wall.height],
    [1, wall.height],
  ];
  for (
    let y = face / 2 + HB_SPACING;
    y + face / 2 < Math.max(...top.map((p) => p[1]));
    y += HB_SPACING
  ) {
    let runs: [number, number][] = [];
    // The full brace cross section must remain below the sloping top-track underside.
    for (let i = 1; i < top.length; i++) {
      let a = top[i - 1][0] * span,
        b = top[i][0] * span;
      const ha = wallTop(wall, a),
        hb = wallTop(wall, b),
        threshold = y + face / 2 + face;
      if (ha <= threshold && hb <= threshold) continue;
      if (ha <= threshold) a += ((b - a) * (threshold - ha)) / (hb - ha);
      else if (hb <= threshold)
        b = a + ((b - a) * (threshold - ha)) / (hb - ha);
      if (b - a > 0.1) runs.push([a, b]);
    }
    const cuts: [number, number][] = [];
    for (const o of openings.filter((o) => o.wallId === wall.id))
      if (
        y + face / 2 > o.sill + 0.001 &&
        y - face / 2 < o.sill + o.height - 0.001
      )
        cuts.push([o.offset, o.offset + o.width]);
    for (const p of pieces)
      if (
        (p.kind === "track" || p.kind === "header") &&
        !p.pitch &&
        y + face / 2 > p.y - p.height / 2 + 0.001 &&
        y - face / 2 < p.y + p.height / 2 - 0.001
      )
        cuts.push([p.x - p.width / 2, p.x + p.width / 2]);
    for (const [a, b] of cuts)
      runs = runs.flatMap(([x, z]) =>
        b <= x || a >= z
          ? [[x, z]]
          : (
              [
                [x, Math.min(z, a)],
                [Math.max(x, b), z],
              ] as [number, number][]
            ).filter(([u, v]) => v - u > 0.1),
      );
    // Join contiguous profile sections; no extra cuts at vertical studs or roof-profile vertices.
    const merged: [number, number][] = [];
    for (const run of runs.sort((a, b) => a[0] - b[0])) {
      const prev = merged.at(-1);
      if (prev && run[0] <= prev[1] + 0.001)
        prev[1] = Math.max(prev[1], run[1]);
      else merged.push([...run]);
    }
    for (const [a, b] of merged)
      result.push({
        x: (a + b) / 2,
        y,
        width: b - a,
        height: face,
        kind: "brace",
        role: "horizontal bracing",
      });
  }
  return result;
}
