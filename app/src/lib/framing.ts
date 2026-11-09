import {
  length,
  type WallData,
  type OpeningData,
  type BuildingModel,
} from "./model";

export function editWallMember(
  input: BuildingModel,
  wallId: string,
  memberIndex: number,
  spacing: number,
) {
  const wall = input.walls.find((w) => w.id === wallId);
  if (!wall) throw new Error("Wall no longer exists.");
  const existing = input.framingAssemblies?.find((a) => a.wallId === wallId);
  if (existing)
    return { model: input, id: existing.componentIds[memberIndex] ?? null };
  const pieces = wallFraming(wall, input.openings, spacing);
  if (!pieces[memberIndex]) throw new Error("Select a framing member again.");
  if (input.components.length + pieces.length > 3000)
    throw new Error(
      "This model has reached its 3,000 editable-component limit.",
    );
  const model = structuredClone(input);
  const angle = Math.atan2(
    wall.end[1] - wall.start[1],
    wall.end[0] - wall.start[0],
  );
  const components = pieces.map((p, i) => ({
    id: crypto.randomUUID(),
    label: `${wall.label} · ${p.kind} ${i + 1}`,
    evidence: structuredClone(wall.evidence),
    inferred: true,
    levelId: wall.levelId,
    kind: p.kind,
    center: [
      wall.start[0] + Math.cos(angle) * p.x,
      wall.start[1] + Math.sin(angle) * p.x,
    ],
    elevation: p.y - p.height / 2,
    length: p.width,
    depth: wall.thickness,
    height: p.height,
    rotation: (angle * 180) / Math.PI,
  }));
  model.components.push(...components);
  model.framingAssemblies = [
    ...(model.framingAssemblies ?? []),
    { wallId, spacing, componentIds: components.map((c) => c.id) },
  ];
  return { model, id: components[memberIndex].id };
}

export function resetWallFraming(
  input: BuildingModel,
  wallId: string,
): BuildingModel {
  const model = structuredClone(input),
    assembly = model.framingAssemblies?.find((a) => a.wallId === wallId);
  const ids = new Set(assembly?.componentIds ?? []);
  model.components = model.components.filter((c) => !ids.has(c.id));
  model.framingAssemblies = model.framingAssemblies?.filter(
    (a) => a.wallId !== wallId,
  );
  return model;
}

// Display geometry only. These dimensions are visualization assumptions, not
// member sizing, load paths, fabrication information, or a material takeoff.
export type FramePiece = {
  x: number;
  y: number;
  width: number;
  height: number;
  kind: "stud" | "track" | "header";
};
export const MEMBER_FACE = 38;

export function wallFraming(
  wall: WallData,
  openings: OpeningData[],
  spacing: number,
): FramePiece[] {
  const span = length(wall),
    face = MEMBER_FACE;
  const holes = openings
    .filter((o) => o.wallId === wall.id)
    .map((o) => ({
      left: Math.max(0, o.offset),
      right: Math.min(span, o.offset + o.width),
      bottom: Math.max(0, o.sill),
      top: Math.min(wall.height, o.sill + o.height),
    }))
    .filter((o) => o.right > o.left && o.top > o.bottom);
  const result: FramePiece[] = [];
  // Clip every member against every opening, including overlapping/stacked ones.
  const add = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    kind: FramePiece["kind"],
  ) => {
    let rectangles = [
      {
        a: Math.max(0, x0),
        b: Math.min(span, x1),
        c: Math.max(0, y0),
        d: Math.min(wall.height, y1),
      },
    ];
    for (const hole of holes) {
      rectangles = rectangles.flatMap((r) => {
        const a = Math.max(r.a, hole.left),
          b = Math.min(r.b, hole.right);
        const c = Math.max(r.c, hole.bottom),
          d = Math.min(r.d, hole.top);
        if (a >= b || c >= d) return [r];
        return [
          { a: r.a, b: a, c: r.c, d: r.d },
          { a: b, b: r.b, c: r.c, d: r.d },
          { a, b, c: r.c, d: c },
          { a, b, c: d, d: r.d },
        ].filter((v) => v.b - v.a > 0.1 && v.d - v.c > 0.1);
      });
    }
    for (const r of rectangles)
      if (r.b > r.a && r.d > r.c)
        result.push({
          x: (r.a + r.b) / 2,
          y: (r.c + r.d) / 2,
          width: r.b - r.a,
          height: r.d - r.c,
          kind,
        });
  };
  add(0, 0, span, face, "track");
  add(0, wall.height - face, span, wall.height, "track");
  const positions = new Set([face / 2, span - face / 2]);
  // Bound pathological imported geometry; never silently change the spacing.
  if (span / spacing > 5000 || spacing < 100)
    throw new Error(
      "Wall is too large for the framing preview. Reduce its length first.",
    );
  for (let x = spacing; x < span - face / 2; x += spacing) positions.add(x);
  for (const h of holes) {
    positions.add(h.left - face / 2);
    positions.add(h.right + face / 2);
    add(h.left - face, h.top, h.right + face, h.top + face * 2, "header");
    if (h.bottom > face)
      add(h.left, h.bottom - face, h.right, h.bottom, "track");
  }
  for (const x of positions)
    add(x - face / 2, face, x + face / 2, wall.height - face, "stud");
  return result;
}

type Point = number[];
export type FrameLine = { start: Point; end: Point };
// Even/odd scan conversion clips joists to concave outlines and subtracts voids.
export function polygonFraming(
  outline: Point[],
  voids: Point[][],
  spacing: number,
): FrameLine[] {
  if (outline.length < 3) return [];
  const rings = [outline, ...voids.filter((v) => v.length >= 3)];
  const lines: FrameLine[] = rings.flatMap((r) =>
    r.map((p, i) => ({ start: p, end: r[(i + 1) % r.length] })),
  );
  const min = Math.min(...outline.map((p) => p[0])),
    max = Math.max(...outline.map((p) => p[0]));
  if ((max - min) / spacing > 5000 || spacing < 100)
    throw new Error("Floor or roof is too large for the framing preview.");
  for (let x = min + spacing; x < max; x += spacing) {
    const hits: number[] = [];
    for (const ring of rings)
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i],
          b = ring[(i + 1) % ring.length];
        if ((a[0] <= x && b[0] > x) || (b[0] <= x && a[0] > x))
          hits.push(a[1] + ((x - a[0]) / (b[0] - a[0])) * (b[1] - a[1]));
      }
    hits.sort((a, b) => a - b);
    for (let i = 0; i + 1 < hits.length; i += 2)
      if (hits[i + 1] - hits[i] > 0.1)
        lines.push({ start: [x, hits[i]], end: [x, hits[i + 1]] });
  }
  return lines;
}

export function roofHeight(vertices: Point[], x: number, z: number): number {
  const a = vertices[0];
  for (let i = 1; i + 1 < vertices.length; i++) {
    const b = vertices[i],
      c = vertices[i + 1];
    const denominator =
      (b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2]);
    if (Math.abs(denominator) < 0.01) continue;
    const u =
      ((x - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (z - a[2])) / denominator;
    const v =
      ((b[0] - a[0]) * (z - a[2]) - (x - a[0]) * (b[2] - a[2])) / denominator;
    return a[1] + u * (b[1] - a[1]) + v * (c[1] - a[1]);
  }
  return a?.[1] ?? 0;
}
