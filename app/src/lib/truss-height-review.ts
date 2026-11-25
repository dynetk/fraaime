import { ModelSchema, type BuildingModel } from "./model";
import { fitZoneToWallFaces, modelTrusses, type Zone } from "./trusses";

/** Explicit reviewer action; never treats the level's wall height as a measured room ceiling. */
export function reviewRoomHeights(
  input: BuildingModel,
  options: {
    levelId: string;
    zoneIds: string[];
    heightMm: number;
    basis: "floor-model" | "reviewer-entered";
    note: string;
    generate: boolean;
  },
) {
  if (
    !Number.isFinite(options.heightMm) ||
    options.heightMm <= 0 ||
    options.heightMm > 30000
  )
    throw new Error(
      "Enter a ceiling height greater than zero and no more than 98.42 ft.",
    );
  if (!options.note.trim())
    throw new Error("Describe the drawing or height basis you reviewed.");
  let model = ModelSchema.parse(input);
  const level = model.levels.find((l) => l.id === options.levelId);
  if (!level) throw new Error("Choose a floor.");
  const ids = new Set(options.zoneIds);
  const eligible = (z: Zone) =>
    ids.has(z.id) &&
    z.levelId === level.id &&
    !z.confirmed &&
    z.members === undefined &&
    z.kind !== "slab-on-grade";
  if (!model.trussZones?.some(eligible))
    throw new Error("Select an unreviewed room on this floor.");
  const messages: string[] = [];
  const updatedIds = new Set<string>();
  let heightsApplied = 0,
    generatedRooms = 0;
  model.trussZones = model.trussZones!.map((z) => {
    if (!eligible(z) || !z.heightUnresolved) return z;
    heightsApplied++;
    updatedIds.add(z.id);
    return {
      ...z,
      ceilingHeight: options.heightMm,
      heightUnresolved: false,
      confirmed: false,
      heightReview: { basis: options.basis, note: options.note.trim() },
    };
  });
  model.issues = model.issues.map((i) =>
    i.elementId &&
    updatedIds.has(i.elementId) &&
    i.message.includes(": ceiling height required.")
      ? {
          ...i,
          resolved: true,
          resolution: `Reviewer entered ${options.heightMm / 304.8} ft: ${options.note.trim()}`,
        }
      : i,
  );
  if (options.generate)
    for (const id of ids) {
      const zone = model.trussZones!.find((z) => z.id === id);
      if (!zone || !eligible(zone)) continue;
      // Preserve already accepted assemblies, even when a newly selected zone occurs
      // earlier in the saved array and would otherwise take precedence on overlap.
      const retained = modelTrusses(model).zones.map((z) => z.id);
      try {
        const fitted = { ...fitZoneToWallFaces(model, zone), confirmed: true };
        const proposed = {
          ...model,
          trussZones: model.trussZones!.map((z) => (z.id === id ? fitted : z)),
        };
        const result = modelTrusses(proposed);
        if (!result.zones.some((z) => z.id === id))
          throw new Error(
            result.warnings.find((w) => w.startsWith(`${zone.label}:`)) ??
              "Room geometry needs review.",
          );
        if (retained.some((id) => !result.zones.some((z) => z.id === id)))
          throw new Error(
            "This room overlaps an already accepted assembly. Existing quantities were preserved.",
          );
        model = proposed;
        generatedRooms++;
      } catch (e) {
        messages.push(
          `${zone.label}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  return {
    model: ModelSchema.parse(model),
    heightsApplied,
    generatedRooms,
    messages,
  };
}
