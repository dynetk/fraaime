import { z } from "zod";
import {
  Evidence,
  ScheduleEntry,
  Issue,
  blankModel,
  ModelSchema,
  validateModel,
  type BuildingModel,
} from "./model";
import type { PageEvidence } from "./worker";
const point = z.array(z.number().min(0).max(1)).length(2);
const region = z.array(z.number().min(0).max(1)).length(4);
const reading = z.object({
  valueMm: z.number().finite().min(-1e6).max(1e6),
  evidence: z.array(Evidence).min(1),
});
const measurement = z.object({
  readings: z.array(reading).max(8),
  estimated: z.boolean(),
});
export const ShellDraft = z.object({
  version: z.literal(1),
  datum: z.string(),
  sheets: z
    .array(
      z.object({
        page: z.number().int().positive(),
        sheet: z.string(),
        kind: z.enum([
          "floor-plan",
          "section",
          "elevation",
          "roof-plan",
          "schedule",
          "other",
        ]),
      }),
    )
    .max(32),
  levels: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string(),
        planPage: z.number().int().positive(),
        planRegion: region,
        anchor: point,
        anchorLabel: z.string(),
        rotationDegrees: z.number().min(-180).max(180),
        scale: z
          .object({
            dimensionText: z.string(),
            lengthMm: z.number().positive(),
            start: point,
            end: point,
          })
          .nullable(),
        outline: z.array(point).min(3).max(100),
        voids: z.array(z.array(point).min(3).max(100)).max(20),
        elevation: measurement,
        wallHeight: measurement,
        wallThickness: measurement,
        evidence: z.array(Evidence).min(1),
      }),
    )
    .max(12),
  openings: z
    .array(
      z.object({
        id: z.string().min(1),
        levelId: z.string(),
        ring: z.number().int().min(0).max(20),
        wallIndex: z.number().int().nonnegative(),
        tag: z.string(),
        kind: z.enum(["door", "window"]),
        dimensionBasis: z
          .enum(["rough-opening", "unit", "unknown"])
          .default("unknown"),
        offsetFraction: z.number().min(0).max(1),
        width: measurement,
        height: measurement,
        sill: measurement,
        evidence: z.array(Evidence).min(1),
      }),
    )
    .max(300),
  roofs: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string(),
        levelId: z.string(),
        vertices: z
          .array(z.object({ point, elevation: measurement }))
          .min(3)
          .max(30),
        evidence: z.array(Evidence).min(1),
      }),
    )
    .max(50),
  scheduleEntries: z.array(ScheduleEntry).max(1000),
  issues: z.array(Issue).max(1000),
});
export type ShellDraftData = z.infer<typeof ShellDraft>;
type P = number[];
export const polygonArea = (p: P[]) =>
  Math.abs(
    p.reduce((s, a, i) => {
      const b = p[(i + 1) % p.length];
      return s + a[0] * b[1] - b[0] * a[1];
    }, 0) / 2,
  );
const cross = (a: P, b: P, c: P) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const on = (a: P, b: P, p: P) =>
  Math.abs(cross(a, b, p)) < 1e-7 &&
  p[0] >= Math.min(a[0], b[0]) - 1e-7 &&
  p[0] <= Math.max(a[0], b[0]) + 1e-7 &&
  p[1] >= Math.min(a[1], b[1]) - 1e-7 &&
  p[1] <= Math.max(a[1], b[1]) + 1e-7;
function intersect(a: P, b: P, c: P, d: P) {
  const x = cross(a, b, c),
    y = cross(a, b, d),
    v = cross(c, d, a),
    w = cross(c, d, b);
  return (
    (x * y < 0 && v * w < 0) ||
    on(a, b, c) ||
    on(a, b, d) ||
    on(c, d, a) ||
    on(c, d, b)
  );
}
export function simplePolygon(p: P[]) {
  if (p.length < 3 || polygonArea(p) < 1e-8) return false;
  for (let i = 0; i < p.length; i++) {
    if (
      Math.hypot(
        p[i][0] - p[(i + 1) % p.length][0],
        p[i][1] - p[(i + 1) % p.length][1],
      ) < 1e-8
    )
      return false;
    for (let j = i + 1; j < p.length; j++)
      if (
        j !== i + 1 &&
        !(i === 0 && j === p.length - 1) &&
        intersect(p[i], p[(i + 1) % p.length], p[j], p[(j + 1) % p.length])
      )
        return false;
  }
  return true;
}
export function inside(p: P, ring: P[]) {
  let yes = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (on(a, b, p)) return false;
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      yes = !yes;
  }
  return yes;
}
const ringsCross = (a: P[], b: P[]) =>
  a.some((p, i) =>
    b.some((q, j) =>
      intersect(p, a[(i + 1) % a.length], q, b[(j + 1) % b.length]),
    ),
  );
// Boundary contact is permitted, but no roof plane may occupy a courtyard interior.
export function overlapsInterior(a: P[], b: P[]) {
  const samples = (r: P[]) =>
    r.flatMap((p, i) => {
      const q = r[(i + 1) % r.length],
        prev = r[(i + r.length - 1) % r.length];
      return [
        p,
        [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2],
        [(prev[0] + p[0] + q[0]) / 3, (prev[1] + p[1] + q[1]) / 3],
      ];
    });
  return (
    samples(a).some(
      (p) =>
        inside(p, b) &&
        (inside(p, a) || a.some((q, i) => on(q, a[(i + 1) % a.length], p))),
    ) ||
    samples(b).some(
      (p) =>
        inside(p, a) &&
        (inside(p, b) || b.some((q, i) => on(q, b[(i + 1) % b.length], p))),
    ) ||
    a.some((p, i) =>
      b.some((q, j) => {
        const p2 = a[(i + 1) % a.length],
          q2 = b[(j + 1) % b.length];
        return (
          cross(p, p2, q) * cross(p, p2, q2) < 0 &&
          cross(q, q2, p) * cross(q, q2, p2) < 0
        );
      }),
    )
  );
}
const unclose = (p: P[]) =>
  p.length > 3 &&
  Math.hypot(p[0][0] - p.at(-1)![0], p[0][1] - p.at(-1)![1]) < 1e-8
    ? p.slice(0, -1)
    : p;

export function compileShell(
  draft: ShellDraftData,
  pages: PageEvidence[],
  planId: string,
  name: string,
): BuildingModel {
  const m = blankModel(name);
  m.scheduleEntries = [];
  m.unresolvedObservations = [];
  const available = new Map(pages.map((p) => [p.page, p]));
  // A sheet can contain both a plan and schedules (or several drawing kinds).
  const roles = new Map<number, Set<string>>();
  for (const sheet of draft.sheets) {
    if (!available.has(sheet.page)) continue;
    if (!roles.has(sheet.page)) roles.set(sheet.page, new Set());
    roles.get(sheet.page)!.add(sheet.kind);
  }
  const good = (e: z.infer<typeof Evidence>) =>
    e.planId === planId &&
    available.has(e.page) &&
    e.region !== null &&
    e.region[0] < e.region[2] &&
    e.region[1] < e.region[3];
  const sources = (es: z.infer<typeof Evidence>[]) => es.filter(good);
  const issue = (
    id: string,
    message: string,
    severity: "error" | "warning" = "warning",
  ) =>
    m.issues.push({
      id: `shell-${id}`,
      elementId: null,
      severity,
      message,
      resolved: false,
      resolution: "",
    });
  const reject = (
    id: string,
    kind: string,
    label: string,
    reason: string,
    raw: unknown,
    ev: z.infer<typeof Evidence>[],
  ) => {
    m.unresolvedObservations!.push({
      id,
      kind,
      label,
      reason,
      raw: JSON.stringify(raw),
      evidence: sources(ev),
    });
    issue(id, `${label}: ${reason}`, "error");
  };
  let measurementWarning = 0;
  const measure = (
    x: z.infer<typeof measurement>,
    vertical = false,
  ): number | null => {
    if (!x.readings.length) return null;
    if (x.readings.some((r) => !r.evidence.some(good))) return null;
    const hasVertical = (r: z.infer<typeof reading>) =>
      r.evidence.some(
        (e) =>
          good(e) &&
          ["elevation", "section"].some((kind) => roles.get(e.page)?.has(kind)),
      );
    // A corroborating floor-plan reading does not invalidate a section-backed quantity.
    if (vertical && !x.readings.some(hasVertical)) return null;
    const nums = x.readings.map((r) => r.valueMm);
    const difference = Math.max(...nums) - Math.min(...nums);
    if (difference > 25) return null;
    if (difference > 1)
      issue(
        `rounding-${++measurementWarning}`,
        `Source readings differ by ${difference.toFixed(2)} mm (${nums.join(", ")}). The ${vertical ? "section/elevation" : "first"} reading is used; verify rounding and datum differences.`,
      );
    return vertical ? x.readings.find(hasVertical)!.valueMm : nums[0];
  };
  const used = new Set<string>();
  const transforms = new Map<
    string,
    { map: (p: P) => number[]; rings: P[][] }
  >();
  let anchorLabel: string | undefined;
  for (const l of draft.levels) {
    const page = available.get(l.planPage),
      height = measure(l.wallHeight, true),
      elevation = measure(l.elevation, true),
      thickness = measure(l.wallThickness);
    const ev = sources([
      ...l.evidence,
      ...l.wallHeight.readings.flatMap((r) => r.evidence),
      ...l.elevation.readings.flatMap((r) => r.evidence),
      ...l.wallThickness.readings.flatMap((r) => r.evidence),
    ]);
    const ring = unclose(l.outline),
      holes = l.voids.map(unclose);
    const within = (p: P) =>
      p[0] >= l.planRegion[0] &&
      p[0] <= l.planRegion[2] &&
      p[1] >= l.planRegion[1] &&
      p[1] <= l.planRegion[3];
    if (
      used.has(l.id) ||
      !page ||
      !roles.get(l.planPage)?.has("floor-plan") ||
      !l.scale ||
      !l.scale.dimensionText.trim() ||
      height === null ||
      elevation === null ||
      thickness === null ||
      height < 500 ||
      height > 10000 ||
      thickness < 50 ||
      thickness > 1000 ||
      l.wallHeight.estimated ||
      l.elevation.estimated ||
      !ev.some((e) => e.page === l.planPage) ||
      !l.anchorLabel.trim() ||
      (anchorLabel !== undefined &&
        anchorLabel !== l.anchorLabel.trim().toLowerCase())
    ) {
      reject(
        l.id,
        "level",
        l.label,
        "Unresolved/conflicting height, thickness, datum, common anchor, scale, or source sheets.",
        l,
        ev,
      );
      continue;
    }
    if (
      !simplePolygon(ring) ||
      !ring.every(within) ||
      holes.some(
        (h) =>
          !simplePolygon(h) ||
          !h.every((p) => within(p) && inside(p, ring)) ||
          ringsCross(h, ring),
      ) ||
      holes.some((h, i) =>
        holes
          .slice(i + 1)
          .some((b) => ringsCross(h, b) || inside(h[0], b) || inside(b[0], h)),
      )
    ) {
      reject(
        l.id,
        "level",
        l.label,
        "Invalid or overlapping footprint/void geometry. Floor withheld to avoid filling courtyards.",
        l,
        ev,
      );
      continue;
    }
    const span = Math.hypot(
      (l.scale.end[0] - l.scale.start[0]) * page.width,
      (l.scale.end[1] - l.scale.start[1]) * page.height,
    );
    const scale = l.scale.lengthMm / span;
    if (!Number.isFinite(scale) || scale < 0.1 || scale > 1000 || span < 10) {
      reject(l.id, "level", l.label, "Invalid drawing calibration.", l, ev);
      continue;
    }
    const angle = (l.rotationDegrees * Math.PI) / 180;
    const map = (p: P) => {
      const x = (p[0] - l.anchor[0]) * page.width * scale,
        z = (p[1] - l.anchor[1]) * page.height * scale;
      return [
        x * Math.cos(angle) - z * Math.sin(angle),
        x * Math.sin(angle) + z * Math.cos(angle),
      ].map((n) => Math.round(n * 100) / 100);
    };
    const outline = ring.map(map),
      voids = holes.map((h) => h.map(map));
    if (
      polygonArea(outline) < 1e6 ||
      polygonArea(outline) > 1e10 ||
      [outline, ...voids].some((r) =>
        r.some(
          (p, i) =>
            Math.hypot(
              p[0] - r[(i + 1) % r.length][0],
              p[1] - r[(i + 1) % r.length][1],
            ) < 10,
        ),
      )
    ) {
      reject(
        l.id,
        "level",
        l.label,
        "Footprint scale or edge lengths are implausible.",
        l,
        ev,
      );
      continue;
    }
    used.add(l.id);
    anchorLabel ??= l.anchorLabel.trim().toLowerCase();
    m.levels.push({
      id: l.id,
      label: l.label,
      elevation,
      height,
      outline,
      voids,
      evidence: ev,
      inferred: true,
    });
    transforms.set(l.id, { map, rings: [outline, ...voids] });
    m.calibrations.push({
      page: l.planPage,
      region: l.planRegion,
      mmPerPoint: scale,
      dimensionText: l.scale.dimensionText,
      confirmed: false,
    });
    for (const [ri, r] of [outline, ...voids].entries())
      for (let i = 0; i < r.length; i++) {
        used.add(`${l.id}-r${ri}-w${i}`);
        m.walls.push({
          id: `${l.id}-r${ri}-w${i}`,
          label: `${l.label} ${ri ? "courtyard" : "exterior"} wall ${i + 1}`,
          levelId: l.id,
          start: r[i],
          end: r[(i + 1) % r.length],
          height,
          thickness,
          evidence: ev,
          inferred: true,
        });
      }
    issue(
      l.id + "-trace",
      `${l.label}: outline traced from plan imagery and heights reconciled with vertical sheets. Verify shape, alignment, and all dimensions before use.`,
    );
    if (l.wallThickness.estimated)
      issue(
        l.id + "-thickness",
        `${l.label}: wall thickness is a calibrated visual estimate, not a specified framing size.`,
      );
  }
  for (const s of draft.scheduleEntries)
    if (s.evidence.some(good))
      m.scheduleEntries.push({
        ...s,
        evidence: sources(s.evidence),
        inferred: true,
      });
  for (const o of draft.openings) {
    const wall = m.walls.find(
        (w) => w.id === `${o.levelId}-r${o.ring}-w${o.wallIndex}`,
      ),
      width = measure(o.width),
      height = measure(o.height),
      sill = measure(o.sill),
      ev = sources([
        ...o.evidence,
        ...[o.width, o.height, o.sill].flatMap((m) =>
          m.readings.flatMap((r) => r.evidence),
        ),
      ]);
    const len = wall
        ? Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
        : 0,
      offset = o.offsetFraction * len;
    if (
      !wall ||
      !ev.length ||
      width === null ||
      height === null ||
      sill === null ||
      width < 25 ||
      height < 25 ||
      sill < 0 ||
      offset + width > len + 1 ||
      sill + height > wall.height + 1 ||
      used.has(o.id)
    ) {
      reject(
        o.id,
        "opening",
        o.tag,
        "Opening dimensions or placement do not fit a supported wall.",
        o,
        ev,
      );
      continue;
    }
    used.add(o.id);
    m.openings.push({
      id: o.id,
      label: o.tag,
      tag: o.tag,
      kind: o.kind,
      levelId: o.levelId,
      wallId: wall.id,
      offset,
      width,
      height,
      sill,
      operation: "",
      dimensionBasis: o.dimensionBasis,
      evidence: ev,
      inferred: true,
    });
  }
  for (const r of draft.roofs) {
    const t = transforms.get(r.levelId),
      ev = sources([
        ...r.evidence,
        ...r.vertices.flatMap((v) =>
          v.elevation.readings.flatMap((x) => x.evidence),
        ),
      ]),
      heights = r.vertices.map((v) => measure(v.elevation, true));
    const level = m.levels.find((l) => l.id === r.levelId);
    if (
      !t ||
      !level ||
      !ev.length ||
      heights.some((h) => h === null || h < level.elevation) ||
      used.has(r.id) ||
      !simplePolygon(r.vertices.map((v) => v.point)) ||
      r.vertices.some((v) => v.elevation.estimated) ||
      (t &&
        t.rings.slice(1).some((h) =>
          overlapsInterior(
            h,
            r.vertices.map((v) => t.map(v.point)),
          ),
        ))
    ) {
      reject(
        r.id,
        "roof",
        r.label,
        "Roof/deck vertices or vertical sources are unresolved, or the surface covers a courtyard void.",
        r,
        ev,
      );
      continue;
    }
    used.add(r.id);
    m.roofs.push({
      id: r.id,
      label: r.label,
      levelId: r.levelId,
      vertices: r.vertices.map((v, i) => {
        const [x, z] = t.map(v.point);
        return [x, heights[i]!, z];
      }),
      evidence: ev,
      inferred: true,
    });
  }
  m.issues.push(
    ...draft.issues.map((i) => ({
      ...i,
      id: `source-${i.id}`,
      resolved: false,
      resolution: "",
    })),
    ...validateModel(m),
  );
  if (!m.levels.length)
    issue(
      "empty",
      "No supported shell could be compiled; observations are preserved.",
      "error",
    );
  if (!m.roofs.length)
    issue(
      "roof-missing",
      "Roof geometry is incomplete; no unsupported roof cap was invented.",
    );
  issue(
    "review",
    "Draft shell only: interior partitions, detailed framing, and unresolved openings may be omitted. Review against the complete source set.",
  );
  m.shellProvenance = {
    version: 1,
    datum: draft.datum,
    sourcePages: pages.map((p) => p.page),
  };
  return ModelSchema.parse(m);
}
