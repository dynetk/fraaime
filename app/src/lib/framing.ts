import {
  length,
  wallTop,
  type WallData,
  type OpeningData,
  type BuildingModel,
} from "./model";
import { framingPanel, panelConnections } from "./panel-connections";
import {
  MEMBER_FACE,
  STANDARD_SPACING,
  BOX_HEADER_WEB,
} from "./framing-constants";
export {
  MEMBER_FACE,
  STANDARD_SPACING,
  BOX_HEADER_WEB,
  FRAMING_TEMPLATE_VERSION,
} from "./framing-constants";

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
  const pieces = modelWallFraming(input, spacing).get(wallId) ?? [];
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
    label: `${wall.label} · ${p.role ?? p.kind} ${i + 1}`,
    evidence: structuredClone(wall.evidence),
    inferred: true,
    levelId: wall.levelId,
    kind: p.kind,
    ...(p.role ? { framingRole: p.role } : {}),
    center: [
      wall.start[0] +
        Math.cos(angle) * p.x -
        Math.sin(angle) * (p.depthOffset ?? 0),
      wall.start[1] +
        Math.sin(angle) * p.x +
        Math.cos(angle) * (p.depthOffset ?? 0),
    ],
    elevation: p.y - p.height / 2,
    length: p.width,
    depth: p.depth ?? wall.thickness,
    height: p.height,
    rotation: (angle * 180) / Math.PI,
    ...(p.pitch ? { pitch: (p.pitch * 180) / Math.PI } : {}),
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
// member sizing, load paths, fabrication information, or an engineered takeoff.
export type FramePiece = {
  x: number;
  y: number;
  width: number;
  height: number;
  kind: "stud" | "track" | "header";
  pitch?: number;
  depth?: number;
  depthOffset?: number;
  role?: string;
};
/** Same derived members for viewing, editing and estimating. Coordinates remain
 * relative to the original architectural wall, including extended panel ends. */
export function modelWallFraming(model: BuildingModel, spacing: number) {
  const { panels } = panelConnections(model);
  const custom = new Set(model.framingAssemblies?.map((a) => a.wallId));
  return new Map(
    [...panels].map(([id, p]) => {
      if (custom.has(id)) return [id, [] as FramePiece[]];
      const panel = framingPanel(p);
      const openings = model.openings
        .filter((o) => o.wallId === id)
        .map((o) => ({ ...o, offset: o.offset - p.startOffset }));
      const pieces = wallFraming(
        panel,
        openings,
        spacing,
        p.connectionStuds.map((x) => x - p.startOffset),
      );
      return [
        id,
        pieces.map((v) => ({
          ...v,
          x: v.x + p.startOffset,
          depth: v.depth ?? panel.thickness,
        })),
      ];
    }),
  );
}

export function wallFraming(
  wall: WallData,
  openings: OpeningData[],
  spacing: number,
  connectionStuds: number[] = [],
): FramePiece[] {
  if (!Number.isFinite(spacing) || spacing < 100)
    throw new Error(
      "Wall stud spacing must be a finite value of at least 100 mm.",
    );
  spacing = Math.min(spacing, STANDARD_SPACING);
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
    metadata: Pick<FramePiece, "depth" | "depthOffset" | "role"> = {},
  ) => {
    let rectangles = [
      {
        a: Math.max(0, x0),
        b: Math.min(span, x1),
        c: Math.max(0, y0),
        d: Math.min(
          wallTop(wall, Math.max(0, x0)),
          wallTop(wall, Math.min(span, x1)),
          y1,
        ),
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
          ...metadata,
        });
  };
  add(0, 0, span, face, "track");
  if (wall.topProfile) {
    for (let i = 1; i < wall.topProfile.length; i++) {
      const a = wall.topProfile[i - 1],
        b = wall.topProfile[i],
        dx = (b[0] - a[0]) * span,
        dy = b[1] - a[1];
      result.push({
        x: ((a[0] + b[0]) * span) / 2,
        y: (a[1] + b[1]) / 2 - face / 2,
        width: Math.hypot(dx, dy),
        height: face,
        kind: "track",
        pitch: Math.atan2(dy, dx),
      });
    }
  } else add(0, wall.height - face, span, wall.height, "track");
  const positions = new Set([face / 2, span - face / 2, ...connectionStuds]);
  // Bound pathological imported geometry; never silently change the spacing.
  if (span / spacing > 5000 || spacing < 100)
    throw new Error(
      "Wall is too large for the framing preview. Reduce its length first.",
    );
  for (const h of holes) {
    positions.add(h.left - face / 2);
    positions.add(h.right + face / 2);
    // Four individually editable lengths: two C webs and two U tracks.
    // C-section flanges/gauge and connection details remain schematic.
    const depth = Math.min(face, wall.thickness / 2);
    const headerTop = h.top + BOX_HEADER_WEB;
    for (const side of [-1, 1])
      add(h.left, h.top, h.right, headerTop, "header", {
        depth,
        depthOffset: (side * (wall.thickness - depth)) / 2,
        role: "box header C stud",
      });
    add(h.left, h.top, h.right, h.top + face, "track", {
      role: "box header bottom U track",
    });
    add(h.left, headerTop - face, h.right, headerTop, "track", {
      role: "box header top U track",
    });
    if (h.bottom > face)
      add(h.left, h.bottom - face, h.right, h.bottom, "track", {
        role: "window sill U track",
      });
    // A center-out grid replaces the wall grid over and below each opening.
    // Both window bands share the same centers; never exceed 16 inches.
    const step = Math.min(spacing, STANDARD_SPACING),
      center = (h.left + h.right) / 2;
    const centers = [center];
    for (let d = step; center - d - face / 2 >= h.left; d += step)
      centers.push(center - d);
    for (let d = step; center + d + face / 2 <= h.right; d += step)
      centers.push(center + d);
    for (const x of centers) {
      add(
        x - face / 2,
        headerTop,
        x + face / 2,
        Math.min(wallTop(wall, x - face / 2), wallTop(wall, x + face / 2)) -
          face,
        "stud",
        { role: "upper cripple stud" },
      );
      if (h.bottom > face)
        add(x - face / 2, face, x + face / 2, h.bottom - face, "stud", {
          role: "lower cripple stud",
        });
    }
  }
  // Mandatory jamb/connection studs take priority over the regular grid.
  // Reuse coincident studs and avoid placing a grid stud on top of them.
  const anchors = [...positions]
    .sort((a, b) => a - b)
    .filter((x, i, all) => i === 0 || x - all[i - 1] > 1);
  positions.clear();
  for (const x of anchors) positions.add(x);
  for (let n = 1; n * spacing < span - face / 2; n++) {
    const x = n * spacing;
    if (!anchors.some((a) => Math.abs(a - x) < face - 0.1)) positions.add(x);
  }
  // Moving a grid stud aside must not create a gap greater than 16 inches.
  // Decimal millimetres (16 in = 406.4 mm) have binary rounding noise. Without
  // this numerical tolerance, ceil(406.4000000000001 / 406.4) inserts an extra
  // midpoint stud into an already correct bay. This is not a layout allowance.
  const spacingTolerance = 1e-6; // mm
  const ordered = [...positions].sort((a, b) => a - b);
  for (let i = 1; i < ordered.length; i++) {
    const a = ordered[i - 1],
      b = ordered[i],
      count = Math.ceil((b - a - spacingTolerance) / spacing);
    for (let k = 1; k < count; k++) positions.add(a + ((b - a) * k) / count);
  }
  for (const x of positions) {
    // Skip full studs that enter an opening's horizontal band; its centered
    // cripple grid supplies the material above/below instead of doubling it.
    if (
      holes.some(
        (h) => x + face / 2 > h.left + 0.1 && x - face / 2 < h.right - 0.1,
      )
    )
      continue;
    add(
      x - face / 2,
      face,
      x + face / 2,
      Math.min(wallTop(wall, x - face / 2), wallTop(wall, x + face / 2)) - face,
      "stud",
      connectionStuds.some((c) => Math.abs(c - x) <= 1)
        ? { role: "panel connection stud" }
        : {},
    );
  }
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
