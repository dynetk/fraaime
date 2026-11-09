import { BuildingModel, type WallData, length } from "./model";
import { resetWallFraming } from "./framing";
export type Transform = {
  dx: number;
  dz: number;
  dy: number;
  rotation: number;
  sx: number;
  sy: number;
  sz: number;
};
export function transformElement(
  input: BuildingModel,
  id: string,
  t: Transform,
): BuildingModel {
  const m = structuredClone(input),
    w = m.walls.find((e) => e.id === id),
    c = m.components.find((e) => e.id === id),
    l = m.levels.find((e) => e.id === id),
    r = m.roofs.find((e) => e.id === id),
    o = m.openings.find((e) => e.id === id);
  if (w) {
    const cx = (w.start[0] + w.end[0]) / 2,
      cz = (w.start[1] + w.end[1]) / 2,
      a = Math.atan2(w.end[1] - w.start[1], w.end[0] - w.start[0]) + t.rotation,
      half = (length(w) * t.sx) / 2;
    const oldAngle = Math.atan2(w.end[1] - w.start[1], w.end[0] - w.start[0]);
    const memberIds = new Set(
      m.framingAssemblies?.find((a) => a.wallId === id)?.componentIds ?? [],
    );
    for (const member of m.components.filter((c) => memberIds.has(c.id))) {
      const x = member.center[0] - cx,
        z = member.center[1] - cz;
      const along = (x * Math.cos(oldAngle) + z * Math.sin(oldAngle)) * t.sx;
      const across = (-x * Math.sin(oldAngle) + z * Math.cos(oldAngle)) * t.sz;
      member.center = [
        cx + t.dx + along * Math.cos(a) - across * Math.sin(a),
        cz + t.dz + along * Math.sin(a) + across * Math.cos(a),
      ];
      member.elevation *= t.sy;
      member.height *= t.sy;
      member.length *= t.sx;
      member.depth *= t.sz;
      member.rotation += (t.rotation * 180) / Math.PI;
    }
    w.start = [cx + t.dx - Math.cos(a) * half, cz + t.dz - Math.sin(a) * half];
    w.end = [cx + t.dx + Math.cos(a) * half, cz + t.dz + Math.sin(a) * half];
    w.height *= t.sy;
    w.thickness *= t.sz;
    w.inferred = true;
    for (const op of m.openings.filter((o) => o.wallId === id)) {
      op.offset *= t.sx;
      op.width *= t.sx;
      op.sill *= t.sy;
      op.height *= t.sy;
      op.inferred = true;
    }
  }
  if (c) {
    c.center = [c.center[0] + t.dx, c.center[1] + t.dz];
    // TransformControls scales about the member center, not its bottom face.
    c.elevation += t.dy + (c.height - c.height * t.sy) / 2;
    c.rotation += (t.rotation * 180) / Math.PI;
    c.length *= t.sx;
    c.depth *= t.sz;
    c.height *= t.sy;
  }
  if (l || r) {
    const points = l ? l.outline : r!.vertices.map((v) => [v[0], v[2]]);
    const cx =
        points.reduce((a, p) => a + p[0], 0) / Math.max(points.length, 1),
      cz = points.reduce((a, p) => a + p[1], 0) / Math.max(points.length, 1);
    const change = (p: number[]) => {
      const x = (p[0] - cx) * t.sx,
        z = (p[1] - cz) * t.sz;
      return [
        cx + t.dx + x * Math.cos(t.rotation) - z * Math.sin(t.rotation),
        cz + t.dz + x * Math.sin(t.rotation) + z * Math.cos(t.rotation),
      ] as [number, number];
    };
    if (l) {
      l.outline = l.outline.map(change);
      l.voids = l.voids.map((v) => v.map(change));
      l.elevation += t.dy;
    }
    if (r) {
      const changeRoofPoint = (p: number[]) => {
        const v = change([p[0], p[2]]);
        return [v[0], p[1] + t.dy, v[1]];
      };
      r.vertices = r.vertices.map(changeRoofPoint);
      r.voids = r.voids?.map((h) => h.map(changeRoofPoint));
    }
  }
  if (o && o.wallId) {
    const wall = m.walls.find((w) => w.id === o.wallId);
    if (wall) {
      const a = Math.atan2(
        wall.end[1] - wall.start[1],
        wall.end[0] - wall.start[0],
      );
      o.offset = Math.max(
        0,
        Math.min(
          length(wall) - o.width,
          o.offset + t.dx * Math.cos(a) + t.dz * Math.sin(a),
        ),
      );
      o.sill = Math.max(0, o.sill + t.dy);
      o.width *= t.sx;
      o.height *= t.sy;
    }
  }
  return m;
}
export function removeElement(input: BuildingModel, id: string) {
  const m = input.walls.some((w) => w.id === id)
    ? resetWallFraming(input, id)
    : structuredClone(input);
  if (m.levels.some((l) => l.id === id)) {
    const walls = new Set(
      m.walls.filter((w) => w.levelId === id).map((w) => w.id),
    );
    m.walls = m.walls.filter((w) => w.levelId !== id);
    m.openings = m.openings.map((o) =>
      o.levelId === id || walls.has(o.wallId ?? "")
        ? { ...o, wallId: null, levelId: null }
        : o,
    );
    m.components = m.components.filter((c) => c.levelId !== id);
    m.roofs = m.roofs.filter((r) => r.levelId !== id);
    m.levels = m.levels.filter((l) => l.id !== id);
    m.framingAssemblies = m.framingAssemblies?.filter(
      (a) => !walls.has(a.wallId),
    );
  } else {
    m.walls = m.walls.filter((w) => w.id !== id);
    m.openings = m.openings
      .filter((o) => o.id !== id)
      .map((o) => (o.wallId === id ? { ...o, wallId: null } : o));
    m.roofs = m.roofs.filter((r) => r.id !== id);
    m.components = m.components.filter((c) => c.id !== id);
    // Keep the assembly even when its final member is removed: deleted members
    // must not reappear on reload or when the preview spacing changes.
    m.framingAssemblies = m.framingAssemblies?.map((a) => ({
      ...a,
      componentIds: a.componentIds.filter((c) => c !== id),
    }));
  }
  return m;
}
export function addElement(
  input: BuildingModel,
  kind: string,
  levelId: string,
  x: number,
  z: number,
): { model: BuildingModel; id: string } {
  const m = structuredClone(input),
    id = crypto.randomUUID(),
    base = {
      id,
      label: kind[0].toUpperCase() + kind.slice(1),
      evidence: [],
      inferred: true,
    };
  if (kind === "floor") {
    const top = Math.max(0, ...m.levels.map((l) => l.elevation + l.height));
    m.levels.push({
      ...base,
      elevation: m.levels.length ? top + 304.8 : 0,
      height: 2743.2,
      outline: [
        [x, z],
        [x + 6096, z],
        [x + 6096, z + 6096],
        [x, z + 6096],
      ],
      voids: [],
    });
  } else if (kind === "wall")
    m.walls.push({
      ...base,
      levelId,
      start: [x, z],
      end: [x + 3048, z],
      height: m.levels.find((l) => l.id === levelId)?.height ?? 2743.2,
      thickness: 152.4,
    });
  else if (kind === "door" || kind === "window") {
    const candidates = m.walls
        .filter((w) => w.levelId === levelId)
        .map((w) => {
          const len = length(w),
            ux = (w.end[0] - w.start[0]) / len,
            uz = (w.end[1] - w.start[1]) / len,
            t = Math.max(
              0,
              Math.min(len, (x - w.start[0]) * ux + (z - w.start[1]) * uz),
            );
          return {
            w,
            t,
            d: Math.hypot(x - w.start[0] - t * ux, z - w.start[1] - t * uz),
          };
        })
        .sort((a, b) => a.d - b.d),
      closest = candidates[0];
    const width = kind === "door" ? 914.4 : 1219.2;
    m.openings.push({
      ...base,
      kind,
      tag: kind === "door" ? "D-new" : "W-new",
      wallId: closest && closest.d < 2000 ? closest.w.id : null,
      levelId,
      offset: closest
        ? Math.max(
            0,
            Math.min(length(closest.w) - width, closest.t - width / 2),
          )
        : 0,
      width,
      height: kind === "door" ? 2133.6 : 1219.2,
      sill: kind === "door" ? 0 : 914.4,
      operation: "Unspecified",
    });
  } else if (kind === "roof") {
    const y =
      (m.levels.find((l) => l.id === levelId)?.elevation ?? 0) +
      (m.levels.find((l) => l.id === levelId)?.height ?? 2743.2);
    m.roofs.push({
      ...base,
      levelId,
      vertices: [
        [x, y, z],
        [x + 6096, y, z],
        [x + 6096, y, z + 6096],
        [x, y, z + 6096],
      ],
    });
  } else
    m.components.push({
      ...base,
      levelId,
      kind: kind as "stud" | "track" | "header" | "joist" | "box",
      center: [x, z],
      elevation: 0,
      length: kind === "stud" ? 41.3 : 3048,
      depth: 152.4,
      height: kind === "stud" ? 2743.2 : 41.3,
      rotation: 0,
    });
  return { model: m, id };
}
