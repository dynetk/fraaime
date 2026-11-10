import { z } from "zod";
import { EstimateSettingsSchema } from "./estimate-settings";
const id = z.string().min(1).max(160);
const coord = z.number().finite().min(-1e7).max(1e7);
export const Point = z.array(coord).length(2);
export const Evidence = z.object({
  planId: z.string(),
  page: z.number().int().positive(),
  sheet: z.string(),
  region: z.array(z.number().min(0).max(1)).length(4).nullable(),
  note: z.string(),
});
const base = {
  id,
  label: z.string().max(240),
  evidence: z.array(Evidence),
  inferred: z.boolean(),
};
export const Level = z.object({
  ...base,
  elevation: coord,
  height: z.number().positive().max(30000),
  outline: z.array(Point).max(500),
  voids: z.array(z.array(Point).max(500)).max(50),
});
export const Wall = z.object({
  ...base,
  levelId: id,
  start: Point,
  end: Point,
  height: z.number().positive().max(30000),
  thickness: z.number().positive().max(2000),
});
export const Opening = z.object({
  ...base,
  kind: z.enum(["door", "window"]),
  tag: z.string(),
  wallId: id.nullable(),
  levelId: id.nullable(),
  offset: z.number().nonnegative(),
  width: z.number().positive().max(50000),
  height: z.number().positive().max(30000),
  sill: z.number().nonnegative().max(30000),
  operation: z.string(),
});
export const Roof = z.object({
  ...base,
  levelId: id,
  vertices: z.array(z.array(coord).length(3)).min(3).max(100),
});
export const Component = z.object({
  ...base,
  levelId: id,
  kind: z.enum(["stud", "track", "header", "joist", "box"]),
  center: Point,
  elevation: coord,
  length: z.number().positive().max(100000),
  depth: z.number().positive().max(30000),
  height: z.number().positive().max(30000),
  rotation: z.number().finite(),
});
export const Issue = z.object({
  id,
  elementId: z.string().nullable(),
  severity: z.enum(["warning", "error"]),
  message: z.string(),
  resolved: z.boolean(),
  resolution: z.string(),
});
export const Calibration = z.object({
  page: z.number().int().positive(),
  region: z.array(z.number().min(0).max(1)).length(4),
  mmPerPoint: z.number().positive().nullable(),
  dimensionText: z.string(),
  confirmed: z.boolean(),
});
// Schedule rows describe a type or an identified instance, never implied placements.
export const ScheduleEntry = z.object({
  ...base,
  kind: z.enum(["door", "window"]),
  tag: z.string(),
  tagRole: z.enum(["type", "instance", "unknown"]),
  quantity: z.number().int().positive().max(10000).nullable(),
  width: z.number().positive().max(50000).nullable(),
  height: z.number().positive().max(30000).nullable(),
  sill: z.number().nonnegative().max(30000).nullable(),
  operation: z.string(),
});
export const UnresolvedObservation = z.object({
  id,
  kind: z.string(),
  label: z.string(),
  reason: z.string(),
  evidence: z.array(Evidence),
  raw: z.string(),
});
export const ExtractionModelSchema = z.object({
  schemaVersion: z.literal(1),
  units: z.literal("mm"),
  name: z.string().max(240),
  levels: z.array(Level).max(30),
  walls: z.array(Wall).max(3000),
  openings: z.array(Opening).max(3000),
  roofs: z.array(Roof).max(500),
  components: z.array(Component).max(3000),
  calibrations: z.array(Calibration).max(500),
  issues: z.array(Issue).max(5000),
});
// Editor-only metadata is separate from the AI's strictly required output schema.
export const ModelSchema = ExtractionModelSchema.extend({
  estimate: EstimateSettingsSchema.optional(),
  panelQuantities: z
    .array(
      z.object({
        wallId: z.string(),
        label: z.string(),
        source: z.string(),
        studLinearFeet: z.number().nonnegative(),
        trackLinearFeet: z.number().nonnegative(),
        totalLinearFeet: z.number().nonnegative(),
        openingSizesToVerify: z.number().int().nonnegative(),
        headersToReview: z.number().int().nonnegative(),
      }),
    )
    .max(3000)
    .optional(),
  openings: z
    .array(
      Opening.extend({
        dimensionBasis: z.enum(["rough-opening", "unit", "unknown"]).optional(),
      }),
    )
    .max(5000),
  components: z
    .array(Component.extend({ pitch: z.number().min(-90).max(90).optional() }))
    .max(3000),
  walls: z
    .array(
      Wall.extend({
        role: z.enum(["exterior", "courtyard", "interior"]).optional(),
        topProfile: z
          .array(
            z.tuple([
              z.number().min(0).max(1),
              z.number().positive().max(30000),
            ]),
          )
          .min(2)
          .max(20)
          .refine(
            (p) =>
              p[0][0] === 0 &&
              p[p.length - 1][0] === 1 &&
              p.every((v, i) => i === 0 || v[0] > p[i - 1][0]),
            "Wall top must have increasing fractions from 0 to 1",
          )
          .optional(),
      }),
    )
    .max(3000),
  roofs: z
    .array(
      Roof.extend({
        voids: z
          .array(z.array(z.array(coord).length(3)).min(3).max(100))
          .max(50)
          .optional(),
        surface: z.enum(["roof", "roof-deck"]).optional(),
        approximation: z.string().optional(),
      }),
    )
    .max(500),
  detailProvenance: z
    .object({
      version: z.literal(1),
      sourcePages: z.array(z.number().int().positive()),
      roofCoverage: z.number().min(0).max(1),
    })
    .optional(),
  shellProvenance: z
    .object({
      version: z.literal(1),
      datum: z.string(),
      sourcePages: z.array(z.number().int().positive()),
    })
    .optional(),
  scheduleEntries: z.array(ScheduleEntry).max(3000).optional(),
  unresolvedObservations: z.array(UnresolvedObservation).max(10000).optional(),
  framingAssemblies: z
    .array(
      z.object({
        wallId: id,
        spacing: z.number().positive(),
        componentIds: z.array(id).max(3000),
      }),
    )
    .max(3000)
    .optional(),
});
export type BuildingModel = z.infer<typeof ModelSchema>;
export type WallData = BuildingModel["walls"][number];
export type OpeningData = z.infer<typeof Opening>;
export type ModelIssue = z.infer<typeof Issue>;
export function blankModel(name = "Untitled project"): BuildingModel {
  return {
    schemaVersion: 1,
    units: "mm",
    name,
    levels: [],
    walls: [],
    openings: [],
    roofs: [],
    components: [],
    calibrations: [],
    issues: [],
  };
}
export const length = (w: WallData) =>
  Math.hypot(w.end[0] - w.start[0], w.end[1] - w.start[1]);
export function wallTop(w: WallData, offset: number) {
  const profile = w.topProfile ?? [
    [0, w.height],
    [1, w.height],
  ];
  const f = Math.max(0, Math.min(1, offset / (length(w) || 1)));
  for (let i = 1; i < profile.length; i++)
    if (f <= profile[i][0]) {
      const a = profile[i - 1],
        b = profile[i];
      return a[1] + ((b[1] - a[1]) * (f - a[0])) / (b[0] - a[0]);
    }
  return profile[profile.length - 1][1];
}
export function minimumWallTop(w: WallData, start: number, end: number) {
  return Math.min(
    wallTop(w, start),
    wallTop(w, end),
    ...(w.topProfile ?? [])
      .filter(([f]) => f * length(w) > start && f * length(w) < end)
      .map(([, h]) => h),
  );
}
export function wallArea(w: WallData) {
  const p = w.topProfile ?? [
    [0, w.height],
    [1, w.height],
  ];
  return (
    length(w) *
    p
      .slice(1)
      .reduce((n, b, i) => n + ((b[0] - p[i][0]) * (b[1] + p[i][1])) / 2, 0)
  );
}
export function validateModel(model: BuildingModel): ModelIssue[] {
  const issues: ModelIssue[] = [];
  const add = (
    elementId: string | null,
    message: string,
    severity: "error" | "warning" = "error",
  ) =>
    issues.push({
      id: `validation-${issues.length}`,
      elementId,
      severity,
      message,
      resolved: false,
      resolution: "",
    });
  const ids = new Set<string>();
  for (const e of [
    ...model.levels,
    ...model.walls,
    ...model.openings,
    ...model.roofs,
    ...model.components,
  ]) {
    if (ids.has(e.id)) add(e.id, "Duplicate element ID.");
    ids.add(e.id);
  }
  const levels = new Set(model.levels.map((l) => l.id));
  for (const e of [...model.walls, ...model.roofs, ...model.components])
    if (!levels.has(e.levelId)) add(e.id, "Missing level.");
  for (const l of model.levels) {
    if (l.outline.length > 0 && l.outline.length < 3)
      add(l.id, "Floor outline requires at least three points.");
    for (const hole of l.voids)
      if (hole.length < 3)
        add(l.id, "Floor void requires at least three points.");
  }
  for (const l of model.levels)
    if (l.height < 100)
      add(l.id, "Floor height is implausibly small; verify units.");
  for (const w of model.walls) {
    if (w.height < 100 || w.thickness < 10)
      add(w.id, "Wall dimensions are implausibly small; verify units.");
  }
  for (const w of model.walls)
    if (length(w) < 10) add(w.id, "Wall is shorter than 10 mm.");
  for (const o of model.openings) {
    if (o.width < 25 || o.height < 25)
      add(o.id, "Opening dimensions are implausibly small; verify units.");
    if (!o.wallId) {
      add(o.id, "Opening is unplaced; preserved in the schedule.", "warning");
      continue;
    }
    const w = model.walls.find((w) => w.id === o.wallId);
    if (!w) {
      add(o.id, "Opening references a missing wall.");
      continue;
    }
    if (o.levelId !== w.levelId) add(o.id, "Opening and wall levels disagree.");
    if (o.offset + o.width > length(w) + 1)
      add(o.id, "Opening exceeds wall length.");
    if (o.sill + o.height > minimumWallTop(w, o.offset, o.offset + o.width) + 1)
      add(o.id, "Opening exceeds wall height.");
  }
  for (const w of model.walls) {
    const os = model.openings
      .filter((o) => o.wallId === w.id)
      .sort((a, b) => a.offset - b.offset);
    for (let i = 0; i < os.length; i++)
      for (let j = i + 1; j < os.length; j++) {
        const a = os[i],
          b = os[j];
        if (
          b.offset < a.offset + a.width - 1 &&
          b.sill < a.sill + a.height - 1 &&
          a.sill < b.sill + b.height - 1
        )
          add(b.id, "Overlapping openings need review.");
      }
  }
  const framedWalls = new Set<string>(),
    framedMembers = new Set<string>();
  for (const assembly of model.framingAssemblies ?? []) {
    const wall = model.walls.find((w) => w.id === assembly.wallId);
    if (!wall || framedWalls.has(assembly.wallId))
      add(assembly.wallId, "Custom framing needs a unique existing wall.");
    framedWalls.add(assembly.wallId);
    for (const id of assembly.componentIds) {
      const component = model.components.find((c) => c.id === id);
      if (
        !component ||
        component.levelId !== wall?.levelId ||
        framedMembers.has(id)
      )
        add(id, "Custom framing member has an invalid assembly reference.");
      framedMembers.add(id);
    }
  }
  return issues;
}
export function feet(value: number) {
  return value / 304.8;
}
export function formatFeet(mm: number) {
  const inches = Math.round((mm / 25.4) * 8) / 8;
  return `${Math.floor(inches / 12)}′ ${Math.round((inches % 12) * 100) / 100}″`;
}
export function wallPieces(w: WallData, openings: OpeningData[]) {
  // Slice at every opening edge, then subtract vertical intervals. Handles clerestories.
  const len = length(w),
    os = openings.filter((o) => o.wallId === w.id);
  const cuts = [
    ...new Set([
      0,
      len,
      ...(w.topProfile ?? []).map((p) => p[0] * len),
      ...os.flatMap((o) => [
        Math.max(0, Math.min(len, o.offset)),
        Math.max(0, Math.min(len, o.offset + o.width)),
      ]),
    ]),
  ].sort((a, b) => a - b);
  const pieces: { a: number; b: number; bottom: number; top: number }[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i],
      b = cuts[i + 1],
      mid = (a + b) / 2;
    let bottom = 0;
    for (const o of os
      .filter((o) => mid > o.offset && mid < o.offset + o.width)
      .sort((a, b) => a.sill - b.sill)) {
      if (o.sill > bottom)
        pieces.push({ a, b, bottom, top: Math.min(w.height, o.sill) });
      bottom = Math.max(bottom, o.sill + o.height);
    }
    if (bottom < w.height) pieces.push({ a, b, bottom, top: w.height });
  }
  return pieces
    .flatMap((p) => {
      if (!w.topProfile) return [p];
      // Split where a sloped top crosses the horizontal bottom/top of this piece.
      const ha = wallTop(w, p.a),
        hb = wallTop(w, p.b),
        split = [p.a, p.b];
      for (const y of [p.bottom, p.top])
        if (ha !== hb) {
          const x = p.a + ((p.b - p.a) * (y - ha)) / (hb - ha);
          if (x > p.a && x < p.b) split.push(x);
        }
      split.sort((a, b) => a - b);
      return split.slice(1).map((b, i) => ({
        ...p,
        a: split[i],
        b,
        topA: Math.max(p.bottom, Math.min(p.top, wallTop(w, split[i]))),
        topB: Math.max(p.bottom, Math.min(p.top, wallTop(w, b))),
      }));
    })
    .filter(
      (p) =>
        p.b - p.a > 1 &&
        ("topA" in p
          ? Math.max(
              p.topA as number,
              ("topB" in p ? p.topB : p.topA) as number,
            )
          : p.top) -
          p.bottom >
          1,
    );
}
export function exampleModel(): BuildingModel {
  const m = blankModel("Sample courtyard house");
  m.levels = [
    {
      id: "level-1",
      label: "Ground floor",
      elevation: 0,
      height: 2743.2,
      outline: [
        [0, 0],
        [12192, 0],
        [12192, 9144],
        [0, 9144],
      ],
      voids: [
        [
          [4572, 3048],
          [7620, 3048],
          [7620, 6096],
          [4572, 6096],
        ],
      ],
      evidence: [],
      inferred: true,
    },
  ];
  const lines = [
    [0, 0, 12192, 0],
    [12192, 0, 12192, 9144],
    [12192, 9144, 0, 9144],
    [0, 9144, 0, 0],
    [4572, 3048, 7620, 3048],
    [7620, 3048, 7620, 6096],
    [7620, 6096, 4572, 6096],
    [4572, 6096, 4572, 3048],
  ];
  m.walls = lines.map((v, i) => ({
    id: `wall-${i + 1}`,
    label: `Wall ${i + 1}`,
    levelId: "level-1",
    start: [v[0], v[1]],
    end: [v[2], v[3]],
    height: 2743.2,
    thickness: 152.4,
    evidence: [],
    inferred: true,
  }));
  m.openings = [
    {
      id: "door-1",
      label: "Entry",
      kind: "door",
      tag: "D01",
      wallId: "wall-1",
      levelId: "level-1",
      offset: 1524,
      width: 914.4,
      height: 2133.6,
      sill: 0,
      operation: "Hinged",
      evidence: [],
      inferred: true,
    },
    {
      id: "window-1",
      label: "Living window",
      kind: "window",
      tag: "W01",
      wallId: "wall-2",
      levelId: "level-1",
      offset: 3048,
      width: 1828.8,
      height: 1219.2,
      sill: 914.4,
      operation: "Fixed",
      evidence: [],
      inferred: true,
    },
  ];
  m.issues = [
    {
      id: "sample",
      elementId: null,
      severity: "warning",
      message:
        "Synthetic example for testing the editor. Not extracted from a customer plan.",
      resolved: false,
      resolution: "",
    },
  ];
  return m;
}
