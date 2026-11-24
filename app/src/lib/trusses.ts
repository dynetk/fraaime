import type { BuildingModel } from "./model";
import type { Transform } from "./editing";
import { MEMBER_FACE } from "./framing-constants";
export type Zone = NonNullable<BuildingModel["trussZones"]>[number];
export type Member = NonNullable<Zone["members"]>[number];
export const TRUSS_DEPTH = 406.4,
  TRUSS_WIDTH = 88.9,
  TRUSS_SPACING = 609.6,
  WEB_BAY = 914.4;
const EPS = 1e-6;
export const memberLength = (m: Member) =>
  Math.hypot(...m.end.map((v, i) => v - m.start[i]));
export function zonePoint(z: Zone, x: number, y: number): [number, number] {
  const a = (z.rotation * Math.PI) / 180;
  return [
    z.center[0] + x * Math.cos(a) - y * Math.sin(a),
    z.center[1] + x * Math.sin(a) + y * Math.cos(a),
  ];
}
export function zoneLocal(z: Zone, p: number[]) {
  const a = (z.rotation * Math.PI) / 180,
    x = p[0] - z.center[0],
    y = p[1] - z.center[1];
  return [
    x * Math.cos(a) + y * Math.sin(a),
    -x * Math.sin(a) + y * Math.cos(a),
  ];
}
export const zoneOutline = (z: Zone) =>
  [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([x, y]) => zonePoint(z, (x * z.width) / 2, (y * z.depth) / 2));
export function zonesOverlap(a: Zone, b: Zone) {
  const pa = zoneOutline(a),
    pb = zoneOutline(b);
  for (const z of [a, b])
    for (const theta of [z.rotation, z.rotation + 90]) {
      const x = Math.cos((theta * Math.PI) / 180),
        y = Math.sin((theta * Math.PI) / 180);
      const p = pa.map((v) => v[0] * x + v[1] * y),
        q = pb.map((v) => v[0] * x + v[1] * y);
      if (
        Math.min(Math.max(...p), Math.max(...q)) -
          Math.max(Math.min(...p), Math.min(...q)) <=
        EPS
      )
        return false;
    }
  return true;
}
function insideRing(p: number[], ring: number[][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j],
      b = ring[i],
      dx = b[0] - a[0],
      dy = b[1] - a[1];
    const cross = (p[0] - a[0]) * dy - (p[1] - a[1]) * dx;
    if (
      Math.abs(cross) < 0.01 &&
      p[0] >= Math.min(a[0], b[0]) - EPS &&
      p[0] <= Math.max(a[0], b[0]) + EPS &&
      p[1] >= Math.min(a[1], b[1]) - EPS &&
      p[1] <= Math.max(a[1], b[1]) + EPS
    )
      return true;
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}
export function zoneFitsFloor(z: Zone, level: BuildingModel["levels"][number]) {
  const ring = zoneOutline(z);
  if (level.outline.length < 3) return false;
  // Check each edge between all footprint/void intersections, not just its corners.
  for (let i = 0; i < 4; i++) {
    const a = ring[i],
      b = ring[(i + 1) % 4],
      dx = b[0] - a[0],
      dy = b[1] - a[1],
      cuts = [0, 1];
    for (const boundary of [level.outline, ...level.voids])
      for (let k = 0; k < boundary.length; k++) {
        const c = boundary[k],
          d = boundary[(k + 1) % boundary.length],
          ex = d[0] - c[0],
          ey = d[1] - c[1],
          den = dx * ey - dy * ex;
        if (Math.abs(den) < EPS) continue;
        const t = ((c[0] - a[0]) * ey - (c[1] - a[1]) * ex) / den,
          u = ((c[0] - a[0]) * dy - (c[1] - a[1]) * dx) / den;
        if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t);
      }
    cuts.sort((a, b) => a - b);
    for (const t of [
      ...cuts,
      ...cuts.slice(1).map((v, k) => (v + cuts[k]) / 2),
    ]) {
      const p = [a[0] + dx * t, a[1] + dy * t];
      if (
        !insideRing(p, level.outline) ||
        level.voids.some((h) => insideRing(p, h))
      )
        return false;
    }
  }
  return !level.voids.some((h) => h.some((p) => insideRing(p, ring)));
}
/** A zone is one physical assembly. Shared floor/ceiling is never generated twice. */
export function generateTrusses(z: Zone): Member[] {
  if (z.kind === "slab-on-grade" || !z.confirmed || z.heightUnresolved)
    return [];
  if (z.members) return z.members;
  const alongX =
      z.spanAxis === "width" || (z.spanAxis !== "depth" && z.width <= z.depth),
    span = alongX ? z.width : z.depth,
    across = alongX ? z.depth : z.width;
  const members: Member[] = [];
  // Keep the entire 3.5-inch width inside the room; regular 24-inch bays plus final gap.
  const first = -across / 2 + TRUSS_WIDTH / 2,
    last = across / 2 - TRUSS_WIDTH / 2;
  if (last < first) return [];
  const positions = [first];
  for (let n = 1; first + n * TRUSS_SPACING < last - EPS; n++)
    positions.push(first + n * TRUSS_SPACING);
  // Do not add an edge truss if it overlaps the last regular 24-inch station.
  // In that case the remaining clear edge gap is already well below 24 inches.
  if (last - positions[positions.length - 1] >= TRUSS_WIDTH - EPS)
    positions.push(last);
  if (positions.length * Math.ceil(span / WEB_BAY) * 4 > 10000)
    throw new Error(
      "Truss zone exceeds 10,000 members. Divide it into smaller zones.",
    );
  positions.forEach((acrossValue, index) => {
    const trussId = `${z.id}:truss:${index}`;
    let serial = 0;
    const point = (u: number, v: number): [number, number, number] => {
      const p = zonePoint(
        z,
        alongX ? u : acrossValue,
        alongX ? acrossValue : u,
      );
      return [p[0], z.ceilingHeight + v, p[1]];
    };
    const add = (
      role: Member["role"],
      a: number,
      b: number,
      c: number,
      d: number,
    ) =>
      members.push({
        id: `${trussId}:${serial++}`,
        trussId,
        role,
        start: point(a, b),
        end: point(c, d),
      });
    const x0 = -span / 2,
      x1 = span / 2,
      low = MEMBER_FACE / 2,
      high = TRUSS_DEPTH - MEMBER_FACE / 2;
    add("bottom chord", x0, low, x1, low);
    add("top chord", x0, high, x1, high);
    const inner0 = x0 + MEMBER_FACE / 2,
      inner1 = x1 - MEMBER_FACE / 2;
    add("vertical", inner0, low, inner0, high);
    // Full 3-foot V bays; shortened final bay adjusts its diagonals, not the truss depth.
    for (let a = inner0; a < inner1 - EPS; a += WEB_BAY) {
      const b = Math.min(a + WEB_BAY, inner1),
        mid = (a + b) / 2;
      add("diagonal", a, high, mid, low);
      add("diagonal", mid, low, b, high);
      add("vertical", b, low, b, high);
    }
  });
  return members;
}
/** Geometry tolerance only (1 mm), not an engineering bearing allowance. */
export const WALL_FACE_TOLERANCE = 1;
function faceDistance(
  model: BuildingModel,
  z: Zone,
  point: readonly number[],
  toward: readonly number[],
) {
  const level = model.levels.find((l) => l.id === z.levelId);
  if (!level) return [];
  const y = level.elevation + point[1] - MEMBER_FACE / 2;
  const result: number[] = [];
  for (const w of model.walls) {
    if (w.levelId !== z.levelId) continue;
    const dx = w.end[0] - w.start[0],
      dz = w.end[1] - w.start[1],
      length = Math.hypot(dx, dz);
    if (length < EPS) continue;
    const tx = dx / length,
      tz = dz / length,
      nx = -tz,
      nz = tx;
    // Only an opposing wall face, never the end cap of a parallel wall.
    const projection = toward[0] * nx + toward[1] * nz;
    if (Math.abs(projection) < 0.99) continue;
    const along = (point[0] - w.start[0]) * tx + (point[2] - w.start[1]) * tz;
    if (along < -WALL_FACE_TOLERANCE || along > length + WALL_FACE_TOLERANCE)
      continue;
    const profile = w.topProfile;
    let top = w.height;
    if (profile?.length) {
      const f = Math.max(0, Math.min(1, along / length));
      const k = profile.findIndex((p) => p[0] >= f);
      const b = profile[Math.max(0, k)],
        a = profile[Math.max(0, k - 1)];
      top =
        a[1] + (b[1] - a[1]) * (b[0] === a[0] ? 0 : (f - a[0]) / (b[0] - a[0]));
    }
    if (
      y < level.elevation - WALL_FACE_TOLERANCE ||
      y > level.elevation + top + WALL_FACE_TOLERANCE
    )
      continue;
    if (
      model.openings.some(
        (o) =>
          o.wallId === w.id &&
          along > o.offset &&
          along < o.offset + o.width &&
          y < level.elevation + o.sill + o.height - WALL_FACE_TOLERANCE &&
          y > level.elevation + o.sill + WALL_FACE_TOLERANCE,
      )
    )
      continue;
    const signed = (point[0] - w.start[0]) * nx + (point[2] - w.start[1]) * nz;
    // toward points from chord endpoint into the room; choose that side's face.
    result.push(
      ((Math.sign(projection) * w.thickness) / 2 - signed) / projection,
    );
  }
  return result;
}
export function unsupportedTrussEnds(
  model: BuildingModel,
  z: Zone,
  members = generateTrusses(z),
) {
  let count = 0;
  for (const chord of members.filter(
    (m) => m.role === "bottom chord" || m.role === "top chord",
  )) {
    const dx = chord.end[0] - chord.start[0],
      dz = chord.end[2] - chord.start[2],
      length = Math.hypot(dx, dz);
    if (length < EPS) {
      count += 2;
      continue;
    }
    for (const [p, dir] of [
      [chord.start, [dx / length, dz / length]],
      [chord.end, [-dx / length, -dz / length]],
    ] as const)
      if (
        !faceDistance(
          model,
          z,
          chord.role === "top chord"
            ? [p[0], z.ceilingHeight + MEMBER_FACE / 2, p[2]]
            : p,
          dir,
        ).some((d) => Math.abs(d) <= WALL_FACE_TOLERANCE)
      )
        count++;
  }
  // An edited assembly missing its bottom chord cannot establish a full span.
  const groups = new Set(members.map((m) => m.trussId));
  const chords = new Set(
    members.filter((m) => m.role === "bottom chord").map((m) => m.trussId),
  );
  return count + 2 * [...groups].filter((id) => !chords.has(id)).length;
}
/** Explicit reviewer action, limited to nearby parallel faces. Never alters walls. */
export function fitZoneToWallFaces(model: BuildingModel, input: Zone): Zone {
  if (input.heightUnresolved)
    throw Error("Enter the source ceiling height before fitting the span.");
  if (input.members)
    throw Error(
      "This zone has saved member edits. Rebuild its layout before fitting the room.",
    );
  const z = { ...input, confirmed: true },
    chords = generateTrusses(z).filter((m) => m.role === "bottom chord");
  if (!chords.length) throw Error("No truss stations available for this zone.");
  const shifts = [0, 1].map((end) => {
    const options = chords.map((c) => {
      const other = end === 0 ? c.end : c.start,
        p = end === 0 ? c.start : c.end;
      const length = Math.hypot(other[0] - p[0], other[2] - p[2]);
      return faceDistance(model, z, p, [
        (other[0] - p[0]) / length,
        (other[2] - p[2]) / length,
      ])
        .filter((d) => Math.abs(d) <= 304.8)
        .sort((a, b) => Math.abs(a) - Math.abs(b))[0];
    });
    if (
      options.some((v) => v === undefined) ||
      Math.max(...options) - Math.min(...options) > WALL_FACE_TOLERANCE
    )
      throw Error(
        "No continuous opposing wall face within 12 inches at every station. Check the source; expand/merge the room or correct the wall geometry first.",
      );
    return options.reduce((a, b) => a + b, 0) / options.length;
  });
  const alongX =
      z.spanAxis === "width" || (z.spanAxis !== "depth" && z.width <= z.depth),
    angle = (z.rotation * Math.PI) / 180 + (alongX ? 0 : Math.PI / 2);
  const delta = (shifts[0] - shifts[1]) / 2;
  return {
    ...input,
    center: [
      input.center[0] + Math.cos(angle) * delta,
      input.center[1] + Math.sin(angle) * delta,
    ],
    ...(alongX
      ? { width: input.width - shifts[0] - shifts[1] }
      : { depth: input.depth - shifts[0] - shifts[1] }),
    confirmed: false,
  };
}

/** Refuse overlapping physical zones, even when represented from different stories. */
export function modelTrusses(model: BuildingModel) {
  const members: (Member & { zoneId: string; levelId: string })[] = [],
    warnings: string[] = [],
    accepted: Zone[] = [];
  for (const z of model.trussZones ?? []) {
    const level = model.levels.find((l) => l.id === z.levelId);
    if (!level) {
      warnings.push(`${z.label}: missing level.`);
      continue;
    }
    if (z.kind === "slab-on-grade") continue;
    if (z.heightUnresolved) {
      warnings.push(
        `${z.label}: ceiling height required. Review the local floor datum and enter a source-backed height.`,
      );
      continue;
    }
    if (!z.confirmed) {
      warnings.push(
        `${z.label}: confirm room boundaries and ceiling height to generate trusses.`,
      );
      continue;
    }
    if (
      z.kind === "shared-floor-ceiling" &&
      (!z.upperLevelId ||
        z.upperLevelId === z.levelId ||
        !model.levels.some((l) => l.id === z.upperLevelId))
    ) {
      warnings.push(
        `${z.label}: select the upper floor for the shared assembly.`,
      );
      continue;
    }
    if (!zoneFitsFloor(z, level)) {
      warnings.push(
        `${z.label}: zone crosses the floor boundary or an open void; adjust its inside-face boundaries.`,
      );
      continue;
    }
    const y = level.elevation + z.ceilingHeight;
    if (
      accepted.some((a) => {
        const ay =
          model.levels.find((l) => l.id === a.levelId)!.elevation +
          a.ceilingHeight;
        return Math.abs(ay - y) < TRUSS_DEPTH - EPS && zonesOverlap(a, z);
      })
    ) {
      warnings.push(
        `${z.label}: overlaps another physical truss zone; excluded to prevent double counting.`,
      );
      continue;
    }
    const collision = model.walls.find((w) => {
      const base = model.levels.find((l) => l.id === w.levelId)?.elevation;
      if (
        base === undefined ||
        base >= y + TRUSS_DEPTH - EPS ||
        base + Math.max(w.height, ...(w.topProfile ?? []).map((p) => p[1])) <=
          y + EPS
      )
        return false;
      const dx = w.end[0] - w.start[0],
        dy = w.end[1] - w.start[1];
      const wallZone = {
        ...z,
        center: [(w.start[0] + w.end[0]) / 2, (w.start[1] + w.end[1]) / 2] as [
          number,
          number,
        ],
        width: Math.hypot(dx, dy),
        depth: w.thickness,
        rotation: (Math.atan2(dy, dx) * 180) / Math.PI,
      };
      return zonesOverlap(z, wallZone);
    });
    if (collision) {
      warnings.push(
        `${z.label}: intersects wall ${collision.label}; adjust the zone to the inside wall faces.`,
      );
      continue;
    }
    const generated = generateTrusses(z);
    const unsupported = unsupportedTrussEnds(model, z, generated);
    if (unsupported) {
      warnings.push(
        `${z.label}: ${unsupported} truss ends do not meet opposing wall faces at ceiling height. An open room/zone seam is not a support. Adjust or merge the room, or correct its walls. This zone is excluded from quantities.`,
      );
      continue;
    }
    if (members.length + generated.length > 50000)
      throw new Error(
        "This model exceeds the 50,000-truss-member limit. Divide the project.",
      );
    accepted.push(z);
    members.push(
      ...generated.map((m) => ({ ...m, zoneId: z.id, levelId: z.levelId })),
    );
  }
  return { members, warnings, zones: accepted };
}
/** Subtract only the covered spatial volume from legacy floor/roof members. */
export function withoutTrussCoverage(
  model: BuildingModel,
  lines: { start: number[]; end: number[] }[],
) {
  const zones = [
    ...modelTrusses(model).zones,
    ...(model.trussZones ?? []).filter(
      (z) =>
        z.kind === "slab-on-grade" &&
        z.confirmed &&
        model.levels.some((l) => l.id === z.levelId),
    ),
  ];
  return lines.flatMap((line) => {
    let intervals: [number, number][] = [[0, 1]];
    for (const z of zones) {
      const p = zoneLocal(z, [line.start[0], line.start[2]]),
        q = zoneLocal(z, [line.end[0], line.end[2]]);
      const y =
        model.levels.find((l) => l.id === z.levelId)!.elevation +
        (z.kind === "slab-on-grade" ? 0 : z.ceilingHeight);
      let lo = 0,
        hi = 1;
      const a = [p[0], line.start[1], p[1]],
        b = [q[0], line.end[1], q[1]],
        mins = [-z.width / 2, y, -z.depth / 2],
        maxs = [z.width / 2, y + TRUSS_DEPTH, z.depth / 2];
      for (let k = 0; k < 3; k++) {
        const d = b[k] - a[k];
        if (Math.abs(d) < EPS) {
          if (a[k] < mins[k] - EPS || a[k] > maxs[k] + EPS) {
            hi = -1;
            break;
          }
        } else {
          const t = (mins[k] - a[k]) / d,
            u = (maxs[k] - a[k]) / d;
          lo = Math.max(lo, Math.min(t, u));
          hi = Math.min(hi, Math.max(t, u));
        }
      }
      if (hi <= lo + EPS) continue;
      intervals = intervals.flatMap(([a, b]) =>
        hi <= a || lo >= b
          ? [[a, b]]
          : (
              [
                [a, Math.min(b, lo)],
                [Math.max(a, hi), b],
              ] as [number, number][]
            ).filter(([u, v]) => v - u > EPS),
      );
    }
    const at = (t: number) =>
      line.start.map((v, i) => v + (line.end[i] - v) * t);
    return intervals.map(([a, b]) => ({ start: at(a), end: at(b) }));
  });
}
export function transformTrussElement(
  input: BuildingModel,
  id: string,
  t: Transform,
): BuildingModel | null {
  const zone = input.trussZones?.find(
    (z) =>
      z.id === id ||
      generateTrusses(z).some((m) => m.id === id || m.trussId === id),
  );
  if (!zone) return null;
  const model = structuredClone(input),
    z = model.trussZones!.find((z) => z.id === zone.id)!;
  const all = generateTrusses(z),
    selected = all.filter(
      (m) => z.id === id || m.id === id || m.trussId === id,
    );
  const points = selected.flatMap((m) => [m.start, m.end]);
  const cx =
    z.id === id
      ? z.center[0]
      : (Math.min(...points.map((p) => p[0])) +
          Math.max(...points.map((p) => p[0]))) /
        2;
  const cz =
    z.id === id
      ? z.center[1]
      : (Math.min(...points.map((p) => p[2])) +
          Math.max(...points.map((p) => p[2]))) /
        2;
  // Truss/zone resize is in its local room axes; member resize uses its own endpoint axis.
  if (z.id === id && !z.members) {
    z.center = [cx + t.dx, cz + t.dz];
    z.rotation += (t.rotation * 180) / Math.PI;
    z.width *= t.sx;
    z.depth *= t.sz;
    z.ceilingHeight += t.dy;
    return model;
  }
  const ids = new Set(selected.map((m) => m.id)),
    angle = (z.rotation * Math.PI) / 180;
  z.members = all.map((m) => {
    if (!ids.has(m.id)) return m;
    if (m.id === id) {
      const mid = m.start.map((v, i) => (v + m.end[i]) / 2),
        delta = m.end.map((v, i) => ((v - m.start[i]) * t.sx) / 2);
      const rotate = (v: number[]) => [
        v[0] * Math.cos(t.rotation) - v[2] * Math.sin(t.rotation),
        v[1],
        v[0] * Math.sin(t.rotation) + v[2] * Math.cos(t.rotation),
      ];
      const d = rotate(delta),
        move = [t.dx, t.dy, t.dz];
      return {
        ...m,
        start: mid.map((v, i) => v + move[i] - d[i]) as Member["start"],
        end: mid.map((v, i) => v + move[i] + d[i]) as Member["end"],
      };
    }
    const point = (p: number[]): Member["start"] => {
      const x =
        ((p[0] - cx) * Math.cos(angle) + (p[2] - cz) * Math.sin(angle)) * t.sx;
      const y =
        (-(p[0] - cx) * Math.sin(angle) + (p[2] - cz) * Math.cos(angle)) * t.sz;
      return [
        cx +
          t.dx +
          x * Math.cos(angle + t.rotation) -
          y * Math.sin(angle + t.rotation),
        p[1] + t.dy,
        cz +
          t.dz +
          x * Math.sin(angle + t.rotation) +
          y * Math.cos(angle + t.rotation),
      ];
    };
    return { ...m, start: point(m.start), end: point(m.end) };
  });
  if (z.id === id) {
    z.center = [cx + t.dx, cz + t.dz];
    z.rotation += (t.rotation * 180) / Math.PI;
    z.width *= t.sx;
    z.depth *= t.sz;
    z.ceilingHeight += t.dy;
  }
  return model;
}
export function removeTrussElement(
  input: BuildingModel,
  id: string,
): BuildingModel | null {
  const zone = input.trussZones?.find(
    (z) =>
      z.id === id ||
      generateTrusses(z).some((m) => m.id === id || m.trussId === id),
  );
  if (!zone) return null;
  const model = structuredClone(input);
  if (zone.id === id)
    model.trussZones = model.trussZones!.filter((z) => z.id !== id);
  else
    model.trussZones = model.trussZones!.map((z) =>
      z.id !== zone.id
        ? z
        : {
            ...z,
            members: generateTrusses(z).filter(
              (m) => m.id !== id && m.trussId !== id,
            ),
          },
    );
  return model;
}

/** Remaining legacy surface area for labor, after replacing a truss-covered volume. */
export function legacyFramingArea(
  model: BuildingModel,
  vertices: number[][],
  holes: number[][][] = [],
): number {
  const area = (ps: number[][]) => {
    const n = [0, 0, 0];
    for (let i = 0; i < ps.length; i++) {
      const a = ps[i],
        b = ps[(i + 1) % ps.length];
      n[0] += (a[1] - b[1]) * (a[2] + b[2]);
      n[1] += (a[2] - b[2]) * (a[0] + b[0]);
      n[2] += (a[0] - b[0]) * (a[1] + b[1]);
    }
    return Math.hypot(...n) / 2;
  };
  let remaining = area(vertices) - holes.reduce((s, h) => s + area(h), 0);
  const zones = [
    ...modelTrusses(model).zones,
    ...(model.trussZones ?? []).filter(
      (z) => z.kind === "slab-on-grade" && z.confirmed,
    ),
  ];
  for (const z of zones) {
    const level = model.levels.find((l) => l.id === z.levelId);
    if (!level) continue;
    const y =
      level.elevation + (z.kind === "slab-on-grade" ? 0 : z.ceilingHeight);
    const clip = (ring: number[][]) => {
      let ps = ring.map((p) => {
        const v = zoneLocal(z, [p[0], p[2]]);
        return [v[0], p[1], v[1]];
      });
      for (const [axis, edge, sign] of [
        [0, -z.width / 2, 1],
        [0, z.width / 2, -1],
        [1, y, 1],
        [1, y + TRUSS_DEPTH, -1],
        [2, -z.depth / 2, 1],
        [2, z.depth / 2, -1],
      ]) {
        const next: number[][] = [];
        for (let i = 0; i < ps.length; i++) {
          const a = ps[i],
            b = ps[(i + 1) % ps.length],
            da = (a[axis] - edge) * sign,
            db = (b[axis] - edge) * sign;
          if (da >= -EPS) next.push(a);
          if (da >= -EPS !== db >= -EPS) {
            const t = (edge - a[axis]) / (b[axis] - a[axis]);
            next.push(a.map((v, k) => v + t * (b[k] - v)));
          }
        }
        ps = next;
      }
      return area(ps);
    };
    remaining -= Math.max(
      0,
      clip(vertices) - holes.reduce((s, h) => s + clip(h), 0),
    );
  }
  return Math.max(0, remaining);
}

/** Join two adjacent rectangular patches across an open seam, without adding area. */
export function mergeRoomZones(
  model: BuildingModel,
  firstId: string,
  secondId: string,
): BuildingModel {
  const a = model.trussZones?.find((z) => z.id === firstId),
    b = model.trussZones?.find((z) => z.id === secondId);
  if (!a || !b || a.id === b.id)
    throw Error("Choose two different room zones.");
  if (a.members || b.members)
    throw Error(
      "Rebuild edited layouts before merging rooms; saved member edits are never discarded automatically.",
    );
  if (
    a.heightUnresolved ||
    b.heightUnresolved ||
    a.levelId !== b.levelId ||
    Math.abs(a.ceilingHeight - b.ceilingHeight) > 1 ||
    a.kind === "slab-on-grade" ||
    b.kind === "slab-on-grade" ||
    (a.upperLevelId && b.upperLevelId && a.upperLevelId !== b.upperLevelId)
  )
    throw Error(
      "Merge requires the same floor and ceiling height and compatible shared-floor references.",
    );
  if (Math.abs(Math.sin(((a.rotation - b.rotation) * Math.PI) / 180)) > 1e-6)
    throw Error("Room axes must align before merging.");
  const points = [...zoneOutline(a), ...zoneOutline(b)].map((p) =>
    zoneLocal(a, p),
  );
  const min = [0, 1].map((i) => Math.min(...points.map((p) => p[i]))),
    max = [0, 1].map((i) => Math.max(...points.map((p) => p[i])));
  const width = max[0] - min[0],
    depth = max[1] - min[1];
  if (
    zonesOverlap(a, b) ||
    Math.abs(width * depth - a.width * a.depth - b.width * b.depth) >
      Math.max(width, depth)
  )
    throw Error(
      "Only touching zones whose union is a full rectangle can merge. L-shaped empty areas must stay open.",
    );
  const merged: Zone = {
    ...a,
    label: `${a.label} + ${b.label}`.slice(0, 240),
    center: zonePoint(a, (min[0] + max[0]) / 2, (min[1] + max[1]) / 2),
    width,
    depth,
    spanAxis: "shorter",
    confirmed: false,
    kind:
      a.kind === "shared-floor-ceiling" || b.kind === "shared-floor-ceiling"
        ? "shared-floor-ceiling"
        : "ceiling",
    upperLevelId: a.upperLevelId ?? b.upperLevelId,
    evidence: [...a.evidence, ...b.evidence],
  };
  return {
    ...model,
    trussZones: model.trussZones!.flatMap((z) =>
      z.id === a.id ? [merged] : z.id === b.id ? [] : [z],
    ),
  };
}
