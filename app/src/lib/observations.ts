import { z } from "zod";
import {
  ExtractionModelSchema,
  ModelSchema,
  Level,
  Wall,
  Opening,
  Roof,
  Component,
  ScheduleEntry,
  blankModel,
  length,
  type BuildingModel,
} from "./model";

// Unknown is a first-class extraction value, never a tiny number or an assumed zero.
export const ObservationModel = ExtractionModelSchema.extend({
  levels: z
    .array(
      Level.extend({
        elevation: Level.shape.elevation.nullable(),
        height: Level.shape.height.nullable(),
        outline: Level.shape.outline.nullable(),
        voids: Level.shape.voids.nullable(),
      }),
    )
    .max(30),
  walls: z
    .array(
      Wall.extend({
        levelId: Wall.shape.levelId.nullable(),
        start: Wall.shape.start.nullable(),
        end: Wall.shape.end.nullable(),
        height: Wall.shape.height.nullable(),
        thickness: Wall.shape.thickness.nullable(),
      }),
    )
    .max(3000),
  openings: z
    .array(
      Opening.extend({
        offset: Opening.shape.offset.nullable(),
        width: Opening.shape.width.nullable(),
        height: Opening.shape.height.nullable(),
        sill: Opening.shape.sill.nullable(),
      }),
    )
    .max(3000),
  roofs: z
    .array(
      Roof.extend({
        levelId: Roof.shape.levelId.nullable(),
        vertices: Roof.shape.vertices.nullable(),
      }),
    )
    .max(500),
  components: z
    .array(
      Component.extend({
        levelId: Component.shape.levelId.nullable(),
        center: Component.shape.center.nullable(),
        elevation: Component.shape.elevation.nullable(),
        length: Component.shape.length.nullable(),
        depth: Component.shape.depth.nullable(),
        height: Component.shape.height.nullable(),
        rotation: Component.shape.rotation.nullable(),
      }),
    )
    .max(3000),
  scheduleEntries: z.array(ScheduleEntry).max(3000),
});
export const PageObservations = z.object({
  kind: z.enum([
    "floor-plan",
    "elevation",
    "section",
    "schedule",
    "roof-plan",
    "other",
  ]),
  sheet: z.string(),
  model: ObservationModel,
});
export type ObservedPage = z.infer<typeof PageObservations>;
export type CompiledPage = {
  kind: ObservedPage["kind"];
  sheet: string;
  model: BuildingModel;
};

/** Preserve observations, but admit only drawable, supported geometry to the viewer. */
export function compileObservations(
  page: ObservedPage,
  planId: string,
  pageNumber: number,
): CompiledPage {
  const input = page.model,
    model = blankModel(input.name);
  model.scheduleEntries = [];
  model.unresolvedObservations = [];
  model.calibrations = input.calibrations
    .filter((c) => c.page === pageNumber)
    .map((c) => ({ ...c, confirmed: false }));
  model.issues = input.issues.map((i) => ({
    ...i,
    resolved: false,
    resolution: "",
  }));
  const validSource = (e: {
    evidence: BuildingModel["walls"][number]["evidence"];
  }) =>
    e.evidence.some(
      (s) =>
        s.page === pageNumber &&
        s.planId === planId &&
        s.region &&
        s.region[0] < s.region[2] &&
        s.region[1] < s.region[3],
    );
  const calibrated = (e: {
    evidence: BuildingModel["walls"][number]["evidence"];
  }) =>
    e.evidence.some(
      (s) =>
        s.page === pageNumber &&
        s.planId === planId &&
        s.region &&
        model.calibrations.some(
          (c) =>
            c.mmPerPoint !== null &&
            c.dimensionText.trim() &&
            s.region![0] >= c.region[0] &&
            s.region![1] >= c.region[1] &&
            s.region![2] <= c.region[2] &&
            s.region![3] <= c.region[3],
        ),
    );
  const reject = (
    kind: string,
    e: {
      id: string;
      label: string;
      evidence: BuildingModel["walls"][number]["evidence"];
    },
    reason: string,
  ) => {
    model.unresolvedObservations!.push({
      id: e.id,
      kind,
      label: e.label,
      evidence: e.evidence,
      reason,
      raw: JSON.stringify(e),
    });
    model.issues.push({
      id: `unresolved-${kind}-${e.id}`,
      elementId: null,
      severity: "warning",
      message: `${e.label || e.id}: ${reason} Observation retained for review; no geometry created.`,
      resolved: false,
      resolution: "",
    });
  };
  const accepted = <T extends { inferred: boolean }>(e: T): T => ({
    ...e,
    inferred: true,
  });
  for (const e of input.scheduleEntries) {
    if (!validSource(e)) {
      reject("schedule", e, "Missing source region");
      continue;
    }
    const entry = accepted({ ...e });
    if (
      (entry.width !== null && entry.width < 25) ||
      (entry.height !== null && entry.height < 25)
    ) {
      reject("schedule", e, "Implausible dimensions; verify units");
      if (entry.width !== null && entry.width < 25) entry.width = null;
      if (entry.height !== null && entry.height < 25) entry.height = null;
    }
    model.scheduleEntries.push(entry);
    if (
      entry.width === null ||
      entry.height === null ||
      entry.quantity === null ||
      entry.tagRole === "unknown"
    )
      model.issues.push({
        id: `schedule-review-${entry.id}`,
        elementId: null,
        severity: "warning",
        message: `${entry.tag}: schedule dimensions, quantity, or tag meaning needs review. Missing values remain unknown.`,
        resolved: false,
        resolution: "",
      });
  }
  for (const e of input.levels) {
    const parsed = Level.safeParse(e);
    if (
      page.kind !== "floor-plan" ||
      !parsed.success ||
      e.height! < 100 ||
      !e.outline ||
      e.outline.length < 3 ||
      e.voids === null ||
      !validSource(e) ||
      !calibrated(e)
    ) {
      reject(
        "level",
        e,
        "Floor geometry, elevation, height, source, or drawing scale is unresolved",
      );
      continue;
    }
    model.levels.push(accepted(parsed.data));
  }
  for (const e of input.walls) {
    const parsed = Wall.safeParse(e);
    if (
      page.kind !== "floor-plan" ||
      !parsed.success ||
      e.height! < 100 ||
      e.thickness! < 10 ||
      length(parsed.data) < 10 ||
      !model.levels.some((l) => l.id === e.levelId) ||
      !validSource(e) ||
      !calibrated(e)
    ) {
      reject(
        "wall",
        e,
        "Wall dimensions, level, source, or drawing scale is unresolved",
      );
      continue;
    }
    model.walls.push(accepted(parsed.data));
  }
  for (const e of input.openings) {
    const parsed = Opening.safeParse(e);
    const wall = model.walls.find((w) => w.id === e.wallId);
    if (
      page.kind !== "floor-plan" ||
      !parsed.success ||
      e.width! < 25 ||
      e.height! < 25 ||
      !wall ||
      wall.levelId !== e.levelId ||
      e.offset! + e.width! > length(wall) + 1 ||
      e.sill! + e.height! > wall.height + 1 ||
      !validSource(e)
    ) {
      reject(
        "opening",
        e,
        "Opening dimensions or supported placement is unresolved; schedule rows belong in scheduleEntries",
      );
      continue;
    }
    model.openings.push(accepted(parsed.data));
  }
  for (const e of input.roofs) {
    const parsed = Roof.safeParse(e);
    if (
      !parsed.success ||
      !model.levels.some((l) => l.id === e.levelId) ||
      !validSource(e) ||
      !calibrated(e)
    ) {
      reject(
        "roof",
        e,
        "Roof placement, level, source, or scale is unresolved",
      );
      continue;
    }
    model.roofs.push(accepted(parsed.data));
  }
  for (const e of input.components) {
    const parsed = Component.safeParse(e);
    if (
      !parsed.success ||
      Math.min(e.length!, e.depth!, e.height!) < 1 ||
      !model.levels.some((l) => l.id === e.levelId) ||
      !validSource(e) ||
      !calibrated(e)
    ) {
      reject(
        "component",
        e,
        "Component dimensions, placement, source, or scale is unresolved",
      );
      continue;
    }
    model.components.push(accepted(parsed.data));
  }
  return {
    kind: page.kind,
    sheet: page.sheet,
    model: ModelSchema.parse(model),
  };
}
