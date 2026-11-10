import { z } from "zod";
import {
  ModelSchema,
  minimumWallTop,
  type BuildingModel,
  type Evidence,
} from "./model";
import {
  inside,
  simplePolygon,
  polygonArea,
  overlapsInterior,
  type ShellDraftData,
} from "./shell";
import type { PageEvidence } from "./worker";
import { roofHeight } from "./framing";
const point = z.array(z.number().min(0).max(1)).length(2);
const source = z.object({
  page: z.number().int().positive(),
  region: z.array(z.number().min(0).max(1)).length(4),
  note: z.string(),
});
const dimension = z.object({
  valueMm: z.number().finite().nullable(),
  estimated: z.boolean(),
  evidence: z.array(source).max(8),
});
export const ShellDetailDraft = z.object({
  version: z.literal(1),
  wallRemovals: z
    .array(
      z.object({
        wallId: z.string(),
        reason: z.string().min(1),
        evidence: z.array(source).min(1).max(8),
      }),
    )
    .max(100)
    .default([]),
  roofOpenings: z
    .array(
      z.object({
        levelId: z.string(),
        outlines: z.array(z.array(point).min(3).max(100)).min(1).max(20),
        evidence: z.array(source).min(2).max(8),
      }),
    )
    .max(30)
    .default([]),
  wallTypes: z
    .array(
      z.object({ id: z.string(), label: z.string(), thickness: dimension }),
    )
    .max(30),
  partitions: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        levelId: z.string(),
        typeId: z.string(),
        start: point,
        end: point,
        height: dimension.nullable(),
        evidence: z.array(source).min(1).max(5),
      }),
    )
    .max(400),
  openings: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        tag: z.string(),
        kind: z.enum(["door", "window"]),
        wallId: z.string(),
        replacesOpeningId: z.string().nullable().default(null),
        operation: z.string().default(""),
        dimensionBasis: z
          .enum(["rough-opening", "unit", "unknown"])
          .default("unknown"),
        center: point,
        width: dimension,
        height: dimension,
        sill: dimension,
        evidence: z.array(source).min(1).max(5),
      }),
    )
    .max(250),
  roofs: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        levelId: z.string(),
        surface: z.enum(["roof", "roof-deck"]),
        outline: z.array(point).min(3).max(100),
        voids: z.array(z.array(point).min(3).max(100)).max(20),
        anchor: point,
        elevation: dimension,
        pitchRisePer12: z.number().min(0).max(24),
        uphill: z.array(z.number().min(-1).max(1)).length(2),
        quality: z.enum(["supported", "approximate"]),
        approximation: z.string(),
        evidence: z.array(source).min(1).max(8),
      }),
    )
    .max(80),
  exteriorWalls: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        levelId: z.string(),
        typeId: z.string(),
        start: point,
        end: point,
        height: dimension,
        evidence: z.array(source).min(1).max(8),
      }),
    )
    .max(100)
    .default([]),
  wallTops: z
    .array(
      z.object({
        wallId: z.string(),
        profile: z
          .array(
            z.object({ fraction: z.number().min(0).max(1), height: dimension }),
          )
          .min(2)
          .max(20),
        evidence: z.array(source).min(1).max(8),
      }),
    )
    .max(400)
    .default([]),
  issues: z.array(z.object({ id: z.string(), message: z.string() })).max(100),
});
// Strict API schema requires new fields; stored v1 checkpoints can omit them.
const StrictOpenings = ShellDetailDraft.shape.openings.element
  .extend({
    replacesOpeningId:
      ShellDetailDraft.shape.openings.element.shape.replacesOpeningId.removeDefault(),
    operation:
      ShellDetailDraft.shape.openings.element.shape.operation.removeDefault(),
    dimensionBasis:
      ShellDetailDraft.shape.openings.element.shape.dimensionBasis.removeDefault(),
  })
  .array()
  .max(250);
export const DetailResponseSchema = ShellDetailDraft.extend({
  wallRemovals: ShellDetailDraft.shape.wallRemovals.removeDefault(),
  roofOpenings: ShellDetailDraft.shape.roofOpenings.removeDefault(),
  openings: StrictOpenings,
  exteriorWalls: ShellDetailDraft.shape.exteriorWalls.removeDefault(),
  wallTops: ShellDetailDraft.shape.wallTops.removeDefault(),
});
export const OpeningResponseSchema = ShellDetailDraft.pick({
  version: true,
  wallTypes: true,
  partitions: true,
  wallRemovals: true,
  exteriorWalls: true,
  wallTops: true,
  openings: true,
  issues: true,
}).extend({
  openings: StrictOpenings,
  wallRemovals: ShellDetailDraft.shape.wallRemovals.removeDefault(),
  exteriorWalls: ShellDetailDraft.shape.exteriorWalls.removeDefault(),
  wallTops: ShellDetailDraft.shape.wallTops.removeDefault(),
});
export type ShellDetailData = z.infer<typeof ShellDetailDraft>;
type P = number[];
const distance = (a: P, b: P) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function closest(p: P, a: P, b: P) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    t = Math.max(
      0,
      Math.min(
        1,
        ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1),
      ),
    );
  return [a[0] + t * dx, a[1] + t * dy];
}
function overlapsWall(a: P, b: P, c: P, d: P) {
  const len = distance(c, d),
    other = distance(a, b);
  if (!len || !other) return false;
  const ux = (d[0] - c[0]) / len,
    uz = (d[1] - c[1]) / len;
  if (Math.abs(((b[0] - a[0]) * uz - (b[1] - a[1]) * ux) / other) > 0.01)
    return false;
  if (Math.abs((a[0] - c[0]) * uz - (a[1] - c[1]) * ux) > 50) return false;
  const ends = [
    (a[0] - c[0]) * ux + (a[1] - c[1]) * uz,
    (b[0] - c[0]) * ux + (b[1] - c[1]) * uz,
  ].sort((x, y) => x - y);
  return Math.min(len, ends[1]) - Math.max(0, ends[0]) > 50;
}
export const withinRing = (p: P, r: P[], tolerance = 0.01) =>
  inside(p, r) ||
  r.some(
    (a, i) => distance(p, closest(p, a, r[(i + 1) % r.length])) <= tolerance,
  );
const strictlyInside = (p: P, ring: P[]) =>
  inside(p, ring) &&
  !ring.some(
    (a, i) => distance(p, closest(p, a, ring[(i + 1) % ring.length])) <= 0.01,
  );
/** Check every interval cut by a polygon boundary, not just a segment's midpoint. */
export function segmentInFloor(a: P, b: P, outline: P[], voids: P[][]) {
  const ts = [0, 1],
    dx = b[0] - a[0],
    dy = b[1] - a[1];
  for (const ring of [outline, ...voids])
    for (let i = 0; i < ring.length; i++) {
      const c = ring[i],
        d = ring[(i + 1) % ring.length],
        ex = d[0] - c[0],
        ey = d[1] - c[1],
        den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((c[0] - a[0]) * ey - (c[1] - a[1]) * ex) / den,
        u = ((c[0] - a[0]) * dy - (c[1] - a[1]) * dx) / den;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
    }
  ts.sort((x, y) => x - y);
  const valid = (t: number) => {
    const p = [a[0] + t * dx, a[1] + t * dy];
    return withinRing(p, outline) && !voids.some((h) => strictlyInside(p, h));
  };
  return (
    valid(0) && valid(1) && ts.slice(1).every((t, i) => valid((t + ts[i]) / 2))
  );
}
export function planTransform(
  l: ShellDraftData["levels"][number],
  page: PageEvidence,
) {
  if (!l.scale) throw Error("Missing base calibration");
  const scale =
    l.scale.lengthMm /
    Math.hypot(
      (l.scale.end[0] - l.scale.start[0]) * page.width,
      (l.scale.end[1] - l.scale.start[1]) * page.height,
    );
  const angle = (l.rotationDegrees * Math.PI) / 180;
  return (p: P) => {
    const x = (p[0] - l.anchor[0]) * page.width * scale,
      z = (p[1] - l.anchor[1]) * page.height * scale;
    return [
      x * Math.cos(angle) - z * Math.sin(angle),
      x * Math.sin(angle) + z * Math.cos(angle),
    ].map((n) => Math.round(n * 100) / 100);
  };
}
const roofRing = (r: BuildingModel["roofs"][number]) =>
  r.vertices.map((p) => [p[0], p[2]]);
const roofHas = (r: BuildingModel["roofs"][number], p: P) =>
  withinRing(p, roofRing(r)) &&
  !(r.voids ?? []).some((h) =>
    inside(
      p,
      h.map((v) => [v[0], v[2]]),
    ),
  );
/** Sampled projected coverage, not roof dimensional accuracy or watertightness. */
export function roofCoverage(model: BuildingModel, resolution = 120) {
  const pts = model.levels.flatMap((l) => l.outline);
  if (!pts.length) return 0;
  const minX = Math.min(...pts.map((p) => p[0])),
    maxX = Math.max(...pts.map((p) => p[0])),
    minZ = Math.min(...pts.map((p) => p[1])),
    maxZ = Math.max(...pts.map((p) => p[1]));
  let total = 0,
    covered = 0;
  for (let x = 0; x < resolution; x++)
    for (let z = 0; z < resolution; z++) {
      const p = [
        minX + ((x + 0.5) * (maxX - minX)) / resolution,
        minZ + ((z + 0.5) * (maxZ - minZ)) / resolution,
      ];
      const levels = model.levels.filter(
        (l) => inside(p, l.outline) && !l.voids.some((h) => inside(p, h)),
      );
      if (!levels.length) continue;
      total++;
      const top = Math.max(...levels.map((l) => l.elevation + l.height));
      if (
        model.roofs.some(
          (r) =>
            roofHas(r, p) &&
            roofHeight(r.vertices as [number, number, number][], p[0], p[1]) >=
              top - 50,
        )
      )
        covered++;
    }
  return total ? covered / total : 0;
}
export function compileShellDetail(
  draft: ShellDetailData,
  base: BuildingModel,
  baseDraft: ShellDraftData,
  pages: PageEvidence[],
  planId: string,
  openingStage = false,
) {
  const m = ModelSchema.parse(base),
    available = new Map(pages.map((p) => [p.page, p]));
  m.unresolvedObservations ??= [];
  const id = (raw: string) => "detail-" + raw;
  const ev = (sources: z.infer<typeof source>[]): z.infer<typeof Evidence>[] =>
    sources
      .filter(
        (e) =>
          available.has(e.page) &&
          e.region[0] < e.region[2] &&
          e.region[1] < e.region[3],
      )
      .map((e) => ({
        ...e,
        planId,
        sheet:
          baseDraft.sheets.find((s) => s.page === e.page)?.sheet ??
          `PDF ${e.page}`,
      }));
  let serial = 0;
  const issue = (
    message: string,
    elementId: string | null = null,
    severity: "warning" | "error" = "warning",
  ) =>
    m.issues.push({
      id: `${openingStage ? "opening" : "detail"}-review-${serial++}`,
      elementId,
      severity,
      message,
      resolved: false,
      resolution: "",
    });
  const reject = (raw: any, kind: string, reason: string) => {
    m.unresolvedObservations!.push({
      id: id(raw.id),
      kind,
      label: raw.label ?? raw.tag ?? raw.id,
      reason,
      raw: JSON.stringify(raw),
      evidence: ev(raw.evidence ?? []),
    });
    issue(`${raw.label ?? raw.id}: ${reason}`, null, "error");
  };
  const dim = (d: z.infer<typeof dimension>) =>
    d.valueMm !== null && ev(d.evidence).length ? d.valueMm : null;
  const transforms = new Map<string, ReturnType<typeof planTransform>>();
  for (const l of baseDraft.levels) {
    const p = available.get(l.planPage);
    if (p && l.scale && m.levels.some((x) => x.id === l.id))
      transforms.set(l.id, planTransform(l, p));
  }
  const used = new Set(
    [...m.levels, ...m.walls, ...m.openings, ...m.roofs, ...m.components].map(
      (e) => e.id,
    ),
  );
  for (const w of m.walls)
    w.role ??= w.id.includes("-r0-")
      ? "exterior"
      : w.id.includes("-r")
        ? "courtyard"
        : undefined;
  // Only source-backed inferred geometry can be replaced. Non-inferred
  // elements and saved custom assemblies are protected here; the workflow
  // separately saves reruns as candidates instead of replacing human revisions.
  for (const removal of draft.wallRemovals) {
    const wall = m.walls.find((w) => w.id === removal.wallId);
    const level = baseDraft.levels.find((l) => l.id === wall?.levelId);
    if (
      !wall ||
      !wall.inferred ||
      !level ||
      m.framingAssemblies?.some((a) => a.wallId === wall.id) ||
      !ev(removal.evidence).some((e) => e.page === level.planPage) ||
      m.openings.some((o) => o.wallId === wall.id && !o.inferred)
    ) {
      reject(
        { ...removal, id: removal.wallId },
        "wall-correction",
        "Wall correction lacks plan evidence or would overwrite reviewed geometry.",
      );
      continue;
    }
    for (const o of m.openings.filter((o) => o.wallId === wall.id)) {
      m.unresolvedObservations.push({
        id: o.id,
        kind: "opening",
        label: o.tag,
        reason:
          "Host wall corrected; opening must be reconciled on the replacement wall.",
        raw: JSON.stringify(o),
        evidence: o.evidence,
      });
    }
    m.openings = m.openings.filter((o) => o.wallId !== wall.id);
    m.walls = m.walls.filter((w) => w.id !== wall.id);
    issue(`${wall.label}: source-backed wall correction — ${removal.reason}`);
  }
  const partitionWalls = new Map<string, BuildingModel["walls"]>();
  for (const p of draft.partitions) {
    const l = m.levels.find((l) => l.id === p.levelId),
      t = transforms.get(p.levelId),
      type = draft.wallTypes.find((t) => t.id === p.typeId),
      thickness = type ? dim(type.thickness) : null;
    const evidence = ev([
        ...p.evidence,
        ...(type?.thickness.evidence ?? []),
        ...(p.height?.evidence ?? []),
      ]),
      height = p.height ? dim(p.height) : (l?.height ?? null);
    const sourceLevel = baseDraft.levels.find((l) => l.id === p.levelId);
    if (
      !l ||
      !t ||
      !sourceLevel ||
      !ev(p.evidence).some((e) => e.page === sourceLevel.planPage) ||
      thickness === null ||
      thickness < 50 ||
      thickness > 600 ||
      height === null ||
      height < 500 ||
      height > 10000 ||
      used.has(id(p.id))
    ) {
      reject(
        p,
        "interior-wall",
        "Missing or invalid level, calibrated plan evidence, wall type or height.",
      );
      continue;
    }
    const snap = (point: P) => {
      let best = point,
        dist = 120;
      for (const ring of [l.outline, ...l.voids])
        for (let i = 0; i < ring.length; i++) {
          const q = closest(point, ring[i], ring[(i + 1) % ring.length]),
            d = distance(point, q);
          if (d < dist) {
            dist = d;
            best = q;
          }
        }
      return best;
    };
    const a = snap(t(p.start)),
      b = snap(t(p.end));
    if (distance(a, b) < 100 || !segmentInFloor(a, b, l.outline, l.voids)) {
      reject(
        p,
        "interior-wall",
        "Partition is too short, outside the enclosed floor or crosses an open void.",
      );
      continue;
    }
    const length = distance(a, b),
      ux = (b[0] - a[0]) / length,
      uz = (b[1] - a[1]) / length;
    let intervals = [[0, length]];
    for (const w of m.walls.filter(
      (w) => w.levelId === l.id && overlapsWall(a, b, w.start, w.end),
    )) {
      const ends = [w.start, w.end]
        .map((q) => (q[0] - a[0]) * ux + (q[1] - a[1]) * uz)
        .sort((x, y) => x - y);
      intervals = intervals.flatMap(([lo, hi]) =>
        ends[1] <= lo || ends[0] >= hi
          ? [[lo, hi]]
          : [
              [lo, Math.min(hi, ends[0])],
              [Math.max(lo, ends[1]), hi],
            ].filter(([x, y]) => y - x >= 100),
      );
    }
    if (!intervals.length) {
      reject(p, "interior-wall", "Duplicate existing wall run.");
      continue;
    }
    const parts: BuildingModel["walls"] = intervals.map(([lo, hi], i) => ({
      id: id(p.id) + (i ? `-segment-${i + 1}` : ""),
      label: p.label + (i ? ` (segment ${i + 1})` : ""),
      levelId: l.id,
      start: [a[0] + lo * ux, a[1] + lo * uz],
      end: [a[0] + hi * ux, a[1] + hi * uz],
      height,
      thickness,
      evidence: [
        ...evidence,
        ...(!p.height
          ? l.evidence.filter((e) => e.page !== sourceLevel.planPage)
          : []),
      ],
      inferred: true,
      role: "interior",
    }));
    if (parts.some((w) => used.has(w.id))) {
      reject(p, "interior-wall", "Duplicate derived segment ID.");
      continue;
    }
    for (const w of parts) {
      used.add(w.id);
      m.walls.push(w);
    }
    partitionWalls.set(p.id, parts);
    if (
      intervals.length !== 1 ||
      intervals[0][0] > 0 ||
      intervals[0][1] < length
    )
      issue(
        `${p.label}: overlapping existing wall portions were trimmed; review the retained junctions.`,
        parts[0].id,
      );
  }
  // Garden/screen walls do not define occupied floor area and must not be
  // rejected by the interior partition containment check.
  for (const p of draft.exteriorWalls) {
    const l = m.levels.find((l) => l.id === p.levelId),
      t = transforms.get(p.levelId);
    const sourceLevel = baseDraft.levels.find((l) => l.id === p.levelId);
    const type = draft.wallTypes.find((w) => w.id === p.typeId);
    const height = dim(p.height),
      thickness = type ? dim(type.thickness) : null;
    const evidence = ev([
      ...p.evidence,
      ...p.height.evidence,
      ...(type?.thickness.evidence ?? []),
    ]);
    if (
      !l ||
      !t ||
      !sourceLevel ||
      !ev(p.evidence).some((e) => e.page === sourceLevel.planPage) ||
      !ev(p.height.evidence).some((e) => e.page !== sourceLevel.planPage) ||
      height === null ||
      height < 500 ||
      height > 10000 ||
      thickness === null ||
      thickness < 50 ||
      thickness > 1000 ||
      used.has(id(p.id))
    ) {
      reject(
        p,
        "exterior-wall",
        "Exterior enclosure needs calibrated plan placement and a supported vertical height.",
      );
      continue;
    }
    const a = t(p.start),
      b = t(p.end);
    if (
      distance(a, b) < 100 ||
      m.walls.some(
        (w) => w.levelId === l.id && overlapsWall(a, b, w.start, w.end),
      )
    ) {
      reject(p, "exterior-wall", "Invalid or overlapping exterior enclosure.");
      continue;
    }
    const wall = {
      id: id(p.id),
      label: p.label,
      levelId: l.id,
      start: a,
      end: b,
      height,
      thickness,
      evidence,
      inferred: true,
      role: "courtyard" as const,
    };
    m.walls.push(wall);
    used.add(wall.id);
    partitionWalls.set(p.id, [wall]);
  }
  for (const top of draft.wallTops) {
    const wall = m.walls.find(
      (w) => w.id === top.wallId || w.id === id(top.wallId),
    );
    // A single elevation may support the whole profile. Accept that shared
    // citation when a vertex omits its own, but do not override a conflicting
    // explicit vertex citation (for example a floor plan without heights).
    const measurements = top.profile.map((p) => ({
      ...p.height,
      evidence: p.height.evidence.length ? p.height.evidence : top.evidence,
    }));
    const values = top.profile.map((p, i) => [
      p.fraction,
      dim(measurements[i]),
    ]);
    if (
      !wall ||
      !ev(top.evidence).length ||
      values[0][0] !== 0 ||
      values.at(-1)![0] !== 1 ||
      values.some(
        (p, i) =>
          p[1] === null ||
          p[1]! < 500 ||
          p[1]! > 10000 ||
          (i > 0 && p[0]! <= values[i - 1][0]!),
      ) ||
      measurements.some(
        (p) =>
          !ev(p.evidence).some((e) =>
            baseDraft.sheets.some(
              (s) =>
                s.page === e.page && ["section", "elevation"].includes(s.kind),
            ),
          ),
      )
    ) {
      issue(
        "Wall-top profile omitted: needs ordered endpoints and section/elevation evidence.",
        wall?.id ?? null,
      );
      continue;
    }
    wall.topProfile = values as [number, number][];
    wall.height = Math.max(...values.map((p) => p[1]!));
    wall.evidence.push(
      ...ev([
        ...top.evidence,
        ...top.profile.flatMap((p) => p.height.evidence),
      ]),
    );
  }
  for (const o of draft.openings) {
    let replacement = o.replacesOpeningId
      ? m.openings.find((x) => x.id === o.replacesOpeningId)
      : undefined;
    if (o.replacesOpeningId && !replacement) {
      const orphan = m.unresolvedObservations.find(
        (x) =>
          x.id === o.replacesOpeningId &&
          x.kind === "opening" &&
          x.reason ===
            "Host wall corrected; opening must be reconciled on the replacement wall.",
      );
      if (orphan) {
        try {
          const parsed = ModelSchema.shape.openings.element.safeParse(
            JSON.parse(orphan.raw),
          );
          if (parsed.success) replacement = parsed.data;
        } catch {
          /* Invalid retained observation must not authorize a replacement. */
        }
      }
    }
    if (
      o.replacesOpeningId &&
      (!replacement ||
        !replacement.inferred ||
        replacement.tag !== o.tag ||
        replacement.kind !== o.kind ||
        m.framingAssemblies?.some((a) => a.wallId === replacement.wallId))
    ) {
      reject(
        o,
        "opening",
        "Opening correction does not identify an editable existing instance of the same tag and kind.",
      );
      continue;
    }
    // Schedule rows commonly cite width, height and sill together. Preserve
    // that shared citation instead of discarding otherwise supported values.
    const measured = (d: z.infer<typeof dimension>) =>
      dim({
        ...d,
        evidence: d.evidence.length ? d.evidence : o.evidence,
      });
    const width = measured(o.width),
      height = measured(o.height),
      sill = measured(o.sill);
    const candidates =
      partitionWalls.get(o.wallId) ??
      m.walls.filter((w) => w.id === id(o.wallId) || w.id === o.wallId);
    const w =
      candidates.find((w) => {
        const t = transforms.get(w.levelId);
        if (!t || width === null) return false;
        const c = t(o.center),
          p = closest(c, w.start, w.end),
          offset = distance(w.start, p) - width / 2;
        return (
          distance(c, p) <= Math.max(150, w.thickness) &&
          offset >= -25 &&
          offset + width <= distance(w.start, w.end) + 25
        );
      }) ?? candidates[0];
    const t = w ? transforms.get(w.levelId) : undefined;
    const evidence = ev([
      ...o.evidence,
      ...o.width.evidence,
      ...o.height.evidence,
      ...o.sill.evidence,
    ]);
    if (
      !w ||
      !t ||
      width === null ||
      height === null ||
      sill === null ||
      width < 100 ||
      height < 100 ||
      (sill < 0 &&
        (o.kind !== "door" ||
          sill < -300 ||
          o.sill.estimated ||
          !ev(o.sill.evidence).some((e) =>
            baseDraft.sheets.some(
              (s) =>
                s.page === e.page && ["section", "elevation"].includes(s.kind),
            ),
          ))) ||
      height + sill > w.height + 1 ||
      (used.has(id(o.id)) && replacement?.id !== id(o.id)) ||
      !ev(o.evidence).some(
        (e) =>
          e.page === baseDraft.levels.find((l) => l.id === w.levelId)?.planPage,
      )
    ) {
      reject(
        o,
        "opening",
        "Opening has no supported wall or valid dimensions below its wall top.",
      );
      continue;
    }
    const c = t(o.center),
      length = distance(w.start, w.end),
      projected = closest(c, w.start, w.end),
      offset = distance(w.start, projected) - width / 2;
    if (
      distance(c, projected) > Math.max(150, w.thickness) ||
      sill + height > minimumWallTop(w, offset, offset + width) + 1 ||
      width > length ||
      offset < -25 ||
      offset + width > length + 25 ||
      m.openings.some(
        (x) =>
          x.id !== replacement?.id &&
          x.wallId === w.id &&
          sill < x.sill + x.height &&
          sill + height > x.sill &&
          offset < x.offset + x.width - 1 &&
          offset + width > x.offset + 1,
      )
    ) {
      reject(
        o,
        "opening",
        "Opening is off its wall, overlaps another opening or extends past a jamb.",
      );
      continue;
    }
    used.add(id(o.id));
    if (replacement)
      m.openings = m.openings.filter((x) => x.id !== replacement.id);
    // A new host may resolve a previously withheld schedule instance.
    m.unresolvedObservations = m.unresolvedObservations.filter(
      (x) =>
        !(
          x.kind === "opening" &&
          (x.id === replacement?.id || x.id === id(o.id))
        ),
    );
    m.openings.push({
      id: replacement?.id ?? id(o.id),
      label: o.label,
      tag: o.tag,
      kind: o.kind,
      wallId: w.id,
      levelId: w.levelId,
      offset: Math.max(0, Math.min(offset, length - width)),
      width,
      height,
      sill,
      operation:
        o.operation ||
        m.scheduleEntries?.find((s) => s.tag === o.tag && s.kind === o.kind)
          ?.operation ||
        "",
      dimensionBasis: o.dimensionBasis,
      inferred: true,
      evidence,
    });
    if (sill < 0)
      issue(
        `${o.tag}: threshold is ${sill} mm relative to the level datum. Scheduled unit height is retained. Preview framing stops at the level base; verify the local wall base and threshold detail before fabrication.`,
        replacement?.id ?? id(o.id),
      );
    if (o.sill.estimated)
      issue(
        `${o.tag}: threshold/sill is provisional (${sill} mm). ${o.sill.evidence.map((e) => e.note).join(" ")}`,
        replacement?.id ?? id(o.id),
      );
  }
  // A floor void can include a roofed outdoor approach. Only an explicitly
  // sourced roof-plan opening can refine it; legacy drafts retain the guard.
  const roofOpenings = new Map<string, P[][]>();
  for (const opening of draft.roofOpenings) {
    const l = m.levels.find((l) => l.id === opening.levelId);
    const t = transforms.get(opening.levelId);
    const sourceLevel = baseDraft.levels.find((l) => l.id === opening.levelId);
    const evidence = ev(opening.evidence);
    const outlines = t ? opening.outlines.map((r) => r.map(t)) : [];
    if (
      !l ||
      !t ||
      !sourceLevel ||
      roofOpenings.has(l.id) ||
      !evidence.some((e) => e.page === sourceLevel.planPage) ||
      !evidence.some((e) =>
        baseDraft.sheets.some(
          (s) => s.page === e.page && s.kind === "roof-plan",
        ),
      ) ||
      outlines.some(
        (r) =>
          !simplePolygon(r) ||
          polygonArea(r) < 10000 ||
          !r.every((p, i) =>
            segmentInFloor(p, r[(i + 1) % r.length], l.outline, []),
          ),
      ) ||
      l.voids.some((v) => !outlines.some((r) => overlapsInterior(r, v)))
    ) {
      reject(
        { ...opening, id: opening.levelId },
        "roof-opening",
        "Roof opening needs valid floor/roof-plan evidence and must preserve each courtyard.",
      );
      continue;
    }
    roofOpenings.set(l.id, outlines);
  }
  const roofs: BuildingModel["roofs"] = [];
  for (const r of draft.roofs) {
    const l = m.levels.find((l) => l.id === r.levelId),
      t = transforms.get(r.levelId),
      elevation = dim(r.elevation),
      evidence = ev([...r.evidence, ...r.elevation.evidence]);
    if (
      !l ||
      !t ||
      elevation === null ||
      !evidence.length ||
      used.has(id(r.id)) ||
      !simplePolygon(r.outline) ||
      r.voids.some(
        (h) =>
          !simplePolygon(h) ||
          h.some(
            (p, i) => !segmentInFloor(p, h[(i + 1) % h.length], r.outline, []),
          ),
      ) ||
      ((r.elevation.estimated || r.quality === "approximate") &&
        !r.approximation.trim())
    ) {
      reject(
        r,
        "roof",
        "Roof plane, elevation, void or approximation evidence is incomplete.",
      );
      continue;
    }
    const outline = r.outline.map(t),
      holes = r.voids.map((h) => h.map(t)),
      anchor = t(r.anchor),
      direction = t([
        r.anchor[0] + r.uphill[0] * 0.01,
        r.anchor[1] + r.uphill[1] * 0.01,
      ]);
    const len = distance(direction, anchor);
    const vertex = (p: P) => [
      p[0],
      Math.round(
        (elevation +
          (len
            ? ((((p[0] - anchor[0]) * (direction[0] - anchor[0]) +
                (p[1] - anchor[1]) * (direction[1] - anchor[1])) /
                len) *
                r.pitchRisePer12) /
              12
            : 0)) *
          100,
      ) / 100,
      p[1],
    ];
    const vertices = outline.map(vertex),
      voids = holes.map((h) => h.map(vertex));
    const courtyardFilled = (roofOpenings.get(l.id) ?? l.voids).some(
      (h) =>
        overlapsInterior(outline, h) &&
        !holes.some((hole) =>
          h.every((p, i) => segmentInFloor(p, h[(i + 1) % h.length], hole, [])),
        ),
    );
    if (
      (r.pitchRisePer12 > 0 && len < 1) ||
      vertices.some(
        (v) => v[1] < l.elevation - 50 || v[1] > l.elevation + 25000,
      ) ||
      polygonArea(outline) < 10000 ||
      courtyardFilled ||
      holes.some((h, i) =>
        holes.slice(i + 1).some((b) => overlapsInterior(h, b)),
      )
    ) {
      reject(
        r,
        "roof",
        "Invalid pitch/elevations or roof surface covers a courtyard opening.",
      );
      continue;
    }
    roofs.push({
      id: id(r.id),
      label: r.label,
      levelId: l.id,
      vertices,
      voids,
      evidence,
      inferred: true,
      surface: r.surface,
      approximation: r.approximation,
    });
    used.add(id(r.id));
    if (r.quality === "approximate" || r.elevation.estimated)
      issue(`${r.label}: ${r.approximation}`, id(r.id));
  }
  if (roofs.length) {
    const before = roofCoverage(m),
      candidate = { ...m, roofs };
    if (roofCoverage(candidate) + 0.02 >= before) {
      m.roofs = roofs;
      const baseIds = new Set(base.issues.map((i) => i.id));
      m.issues = m.issues.map((i) =>
        baseIds.has(i.id) &&
        /roof|deck/i.test(i.message) &&
        /omitted|incomplete|only|unresolved/i.test(i.message)
          ? {
              ...i,
              severity: "warning" as const,
              message:
                "Earlier shell-stage observation (roof set has since been replaced; review current surfaces): " +
                i.message,
            }
          : i,
      );
      m.unresolvedObservations = m.unresolvedObservations.map((o) =>
        o.kind === "roof"
          ? {
              ...o,
              reason:
                "Earlier shell-stage roof proposal, superseded by the current roof set. Original reason: " +
                o.reason,
            }
          : o,
      );
    } else
      issue(
        "New roof set would reduce existing projected coverage. Original roofs retained; inspect the detailed roof observations before replacement.",
        null,
        "error",
      );
  }
  if (openingStage) {
    for (const i of draft.issues) issue(i.message);
    const missing: string[] = [];
    for (const s of m.scheduleEntries ?? []) {
      const expected = s.quantity ?? (s.tagRole === "instance" ? 1 : null);
      const actual = m.openings.filter(
        (o) => o.kind === s.kind && o.tag === s.tag,
      ).length;
      if (expected !== null && actual < expected)
        missing.push(`${s.tag}: ${actual}/${expected}`);
    }
    issue(
      `Current opening reconciliation: ${m.openings.filter((o) => o.kind === "door").length} doors and ${m.openings.filter((o) => o.kind === "window").length} windows placed. ${missing.length ? "Unplaced schedule instances: " + missing.join(", ") : "No missing instances in schedule rows with known quantities."} Placement, operation and threshold review is still required.`,
      null,
      missing.length ? "error" : "warning",
    );
    return ModelSchema.parse(m);
  }
  const coverage = roofCoverage(m);
  m.detailProvenance = {
    version: 1,
    sourcePages: pages.map((p) => p.page),
    roofCoverage: coverage,
  };
  for (const i of draft.issues) issue(i.message);
  issue(
    `Interior partitions are traced and use the primary story height where no local height was supplied. Verify junctions, door locations, wall types and local ceiling/plate changes.`,
    null,
  );
  issue(
    `Projected roof coverage is approximately ${(coverage * 100).toFixed(1)}% of enclosed floor footprints. Coverage is not a test of slope accuracy, drainage, wall-to-roof closure or engineering.`,
    null,
    coverage < 0.95 ? "error" : "warning",
  );
  return ModelSchema.parse(m);
}
