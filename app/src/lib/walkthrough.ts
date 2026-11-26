import { type BuildingModel, length } from "./model";
import { FURNITURE, type Furniture } from "./furniture";

export type Position = [number, number];
export type Rect = {
  center: Position;
  width: number;
  depth: number;
  angle: number;
};
export const WALK_RADIUS = 220;
export const EYE_HEIGHT = 1650;
export const BODY_HEIGHT = 1800;
export type Navigation = {
  level: BuildingModel["levels"][number];
  walls: Rect[];
  furniture: Rect[];
};
export function insidePolygon(p: number[], polygon: number[][]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}
function segmentDistance(p: number[], a: number[], b: number[]) {
  const dx = b[0] - a[0],
    dz = b[1] - a[1];
  const t = Math.max(
    0,
    Math.min(
      1,
      ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1),
    ),
  );
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
}
function edgeDistance(p: number[], polygon: number[][]) {
  let distance = Infinity;
  for (let i = 0; i < polygon.length; i++)
    distance = Math.min(
      distance,
      segmentDistance(p, polygon[i], polygon[(i + 1) % polygon.length]),
    );
  return distance;
}
export function floorSupports(
  level: Navigation["level"],
  p: Position,
  radius = WALK_RADIUS,
) {
  return (
    level.outline.length >= 3 &&
    insidePolygon(p, level.outline) &&
    edgeDistance(p, level.outline) >= radius &&
    level.voids.every(
      (h) => !insidePolygon(p, h) && edgeDistance(p, h) >= radius,
    )
  );
}
export function furnitureRect(f: Furniture): Rect {
  return {
    center: f.center,
    width: FURNITURE[f.kind].width,
    depth: FURNITURE[f.kind].depth,
    angle: (f.rotation * Math.PI) / 180,
  };
}
export function rectCorners(r: Rect): Position[] {
  const c = Math.cos(r.angle),
    s = Math.sin(r.angle);
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([x, z]) => [
    r.center[0] + ((x * r.width) / 2) * c - ((z * r.depth) / 2) * s,
    r.center[1] + ((x * r.width) / 2) * s + ((z * r.depth) / 2) * c,
  ]);
}
function circleHitsRect(p: Position, radius: number, r: Rect) {
  const dx = p[0] - r.center[0],
    dz = p[1] - r.center[1];
  const x = dx * Math.cos(r.angle) + dz * Math.sin(r.angle);
  const z = -dx * Math.sin(r.angle) + dz * Math.cos(r.angle);
  return (
    Math.hypot(
      Math.max(0, Math.abs(x) - r.width / 2),
      Math.max(0, Math.abs(z) - r.depth / 2),
    ) <= radius
  );
}
function rectsOverlap(a: Rect, b: Rect) {
  const aa = rectCorners(a),
    bb = rectCorners(b);
  return [a.angle, a.angle + Math.PI / 2, b.angle, b.angle + Math.PI / 2].every(
    (angle) => {
      const axis = [Math.cos(angle), Math.sin(angle)];
      const pa = aa.map((p) => p[0] * axis[0] + p[1] * axis[1]);
      const pb = bb.map((p) => p[0] * axis[0] + p[1] * axis[1]);
      return (
        Math.max(...pa) > Math.min(...pb) && Math.max(...pb) > Math.min(...pa)
      );
    },
  );
}
function wallRect(
  w: BuildingModel["walls"][number],
  a: number,
  b: number,
): Rect {
  const angle = Math.atan2(w.end[1] - w.start[1], w.end[0] - w.start[0]);
  return {
    center: [
      w.start[0] + (Math.cos(angle) * (a + b)) / 2,
      w.start[1] + (Math.sin(angle) * (a + b)) / 2,
    ],
    width: b - a,
    depth: w.thickness,
    angle,
  };
}
export function navigationFor(
  model: BuildingModel,
  levelId: string,
): Navigation | null {
  const level = model.levels.find((l) => l.id === levelId);
  if (!level) return null;
  const walls: Rect[] = [];
  for (const w of model.walls.filter((w) => w.levelId === levelId)) {
    const len = length(w);
    if (len < 1) continue;
    // Windows always block walking; only full-height doorways are traversable.
    const doors = model.openings
      .filter(
        (o) =>
          o.wallId === w.id &&
          o.kind === "door" &&
          o.sill <= 200 &&
          o.sill + o.height >= BODY_HEIGHT,
      )
      .map((o) => [Math.max(0, o.offset), Math.min(len, o.offset + o.width)])
      .filter(([a, b]) => b > a)
      .sort((a, b) => a[0] - b[0]);
    let cursor = 0;
    for (const [a, b] of doors) {
      if (a > cursor) walls.push(wallRect(w, cursor, a));
      cursor = Math.max(cursor, b);
    }
    if (cursor < len) walls.push(wallRect(w, cursor, len));
  }
  return {
    level,
    walls,
    furniture: (model.furniture ?? [])
      .filter((f) => f.levelId === levelId)
      .map(furnitureRect),
  };
}
export function canStand(nav: Navigation, p: Position, radius = WALK_RADIUS) {
  return (
    nav.level.height >= BODY_HEIGHT &&
    floorSupports(nav.level, p, radius) &&
    !nav.walls.some((r) => circleHitsRect(p, radius, r)) &&
    !nav.furniture.some((r) => circleHitsRect(p, radius, r))
  );
}
export function floorBounds(level: Navigation["level"]) {
  const xs = level.outline.map((p) => p[0]),
    zs = level.outline.map((p) => p[1]);
  const minX = xs.length ? Math.min(...xs) : 0,
    minZ = zs.length ? Math.min(...zs) : 0;
  const width = Math.max(1000, xs.length ? Math.max(...xs) - minX : 1000);
  const depth = Math.max(1000, zs.length ? Math.max(...zs) - minZ : 1000);
  return { minX, minZ, width, depth };
}
export function findSpawn(nav: Navigation): Position | null {
  if (nav.level.outline.length < 3 || nav.level.height < BODY_HEIGHT)
    return null;
  const b = floorBounds(nav.level);
  const center: Position = [b.minX + b.width / 2, b.minZ + b.depth / 2];
  // Bounded search handles concave footprints, courtyards and disconnected rooms.
  const nx = Math.min(100, Math.ceil(b.width / 350)),
    nz = Math.min(100, Math.ceil(b.depth / 350));
  const candidates: Position[] = [center];
  for (let x = 0; x < nx; x++)
    for (let z = 0; z < nz; z++)
      candidates.push([
        b.minX + ((x + 0.5) * b.width) / nx,
        b.minZ + ((z + 0.5) * b.depth) / nz,
      ]);
  candidates.sort(
    (a, b) =>
      Math.hypot(a[0] - center[0], a[1] - center[1]) -
      Math.hypot(b[0] - center[0], b[1] - center[1]),
  );
  // Prefer a little breathing room, then relax clearance for narrow plans.
  for (const radius of [1200, 800, 450, WALK_RADIUS]) {
    const p = candidates.find((p) => canStand(nav, p, radius));
    if (p) return p;
  }
  return null;
}
/** Face the longest clear sightline instead of starting against a nearby wall. */
export function initialYaw(nav: Navigation, position: Position) {
  let bestYaw = 0,
    bestDistance = -1;
  for (let i = 0; i < 32; i++) {
    const yaw = (i * Math.PI) / 16;
    let distance = 0;
    for (let d = 200; d <= 8000; d += 200) {
      if (
        !canStand(nav, [
          position[0] - Math.sin(yaw) * d,
          position[1] - Math.cos(yaw) * d,
        ])
      )
        break;
      distance = d;
    }
    if (distance > bestDistance) {
      bestDistance = distance;
      bestYaw = yaw;
    }
  }
  return bestYaw;
}
export function moveWalker(
  nav: Navigation,
  from: Position,
  dx: number,
  dz: number,
): Position {
  if (!Number.isFinite(dx) || !Number.isFinite(dz) || !canStand(nav, from))
    return from;
  // Substeps prevent crossing thin walls when a frame stalls. Cap untrusted input.
  const distance = Math.hypot(dx, dz),
    factor = Math.min(1, 2000 / (distance || 1));
  dx *= factor;
  dz *= factor;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 80));
  let p: Position = [...from];
  for (let i = 0; i < steps; i++) {
    const next: Position = [p[0] + dx / steps, p[1] + dz / steps];
    if (canStand(nav, next)) p = next;
    else {
      const x: Position = [p[0] + dx / steps, p[1]],
        z: Position = [p[0], p[1] + dz / steps];
      if (canStand(nav, x)) p = x;
      else if (canStand(nav, z)) p = z;
    }
  }
  return p;
}
export function placementError(
  model: BuildingModel,
  f: Furniture,
): string | null {
  const level = model.levels.find((l) => l.id === f.levelId);
  if (!level) return "Choose a modeled floor first.";
  const rect = furnitureRect(f),
    corners = rectCorners(rect);
  if (
    !corners.every((p) => floorSupports(level, p, 5)) ||
    !floorSupports(level, f.center, 5) ||
    level.voids.some((h) => h.some((p) => insidePolygon(p, corners)))
  )
    return "Place the whole item on the floor, away from openings and edges.";
  // A concave notch can cross an edge despite all four corners being inside.
  for (let i = 0; i < 4; i++) {
    const a = corners[i],
      b = corners[(i + 1) % 4],
      count = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 50);
    for (let n = 1; n < count; n++)
      if (
        !floorSupports(
          level,
          [
            a[0] + ((b[0] - a[0]) * n) / count,
            a[1] + ((b[1] - a[1]) * n) / count,
          ],
          5,
        )
      )
        return "Keep furniture clear of floor openings and edges.";
  }
  if (
    model.walls.some(
      (w) =>
        w.levelId === f.levelId &&
        rectsOverlap(rect, wallRect(w, 0, length(w))),
    )
  )
    return "That item overlaps a wall or doorway. Choose more open space.";
  if (
    (model.furniture ?? []).some(
      (other) =>
        other.id !== f.id &&
        other.levelId === f.levelId &&
        rectsOverlap(rect, furnitureRect(other)),
    )
  )
    return "That item overlaps another piece of furniture.";
  if (FURNITURE[f.kind].height > level.height)
    return "That item is taller than this floor.";
  return null;
}
