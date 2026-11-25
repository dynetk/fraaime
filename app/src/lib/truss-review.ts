import type { BuildingModel } from "./model";
import { reviewRoomHeights } from "./truss-height-review";
import { memberLength, modelTrusses, type Zone } from "./trusses";

export const roomName = (label: string) =>
  label
    .replace(
      /\s*[—–;]\s*(unconfirmed|height unresolved|height required|needs review).*$/i,
      "",
    )
    .trim();
export function individualHeightNeeded(z: Zone) {
  return (
    !!z.heightUnresolved &&
    /garage|mechanical|step[- ]down|vault|pitched|dropped ceiling|sloped ceiling|conflicting.*height|height.*conflict/i.test(
      [z.label, ...z.evidence.map((e) => e.note)].join(" "),
    )
  );
}
export function feetInches(mm: number) {
  const inches = Math.round((mm / 25.4) * 8) / 8;
  return `${Math.floor(inches / 12)}′ ${+(inches % 12).toFixed(3)}″`;
}
export type RoomPreview = {
  id: string;
  name: string;
  status: "ready" | "height-needed" | "geometry-needed";
  heightMm: number | null;
  origin: "detected" | "entered" | "suggested" | "missing";
  message: string;
};
/** Pure preview: no saved edits or approvals are made until the user applies it. */
export function previewRoomTrusses(
  input: BuildingModel,
  options: {
    levelId: string;
    zoneIds: string[];
    suggestedHeightMm: number | null;
    overrides: Record<string, number>;
    note?: string;
    suggestedBasis?: "floor-model" | "reviewer-entered";
  },
) {
  let model = input;
  const rooms: RoomPreview[] = [];
  const pending = (input.trussZones ?? []).filter(
    (z) =>
      z.levelId === options.levelId &&
      !z.confirmed &&
      z.members === undefined &&
      z.kind !== "slab-on-grade" &&
      options.zoneIds.includes(z.id),
  );
  for (const zone of pending) {
    const override = options.overrides[zone.id];
    const entered = override !== undefined;
    const height = zone.heightUnresolved
      ? entered
        ? override
        : individualHeightNeeded(zone)
          ? null
          : options.suggestedHeightMm
      : zone.ceilingHeight;
    const origin: RoomPreview["origin"] = zone.heightUnresolved
      ? entered
        ? "entered"
        : height === null
          ? "missing"
          : options.suggestedBasis === "reviewer-entered"
            ? "entered"
            : "suggested"
      : zone.heightReview
        ? "entered"
        : "detected";
    const row = {
      id: zone.id,
      name: roomName(zone.label),
      heightMm: height,
      origin,
    };
    if (
      height === null ||
      !Number.isFinite(height) ||
      height <= 0 ||
      height > 30000
    ) {
      rooms.push({
        ...row,
        status: "height-needed",
        message: "Enter this room’s ceiling height from its drawing.",
      });
      continue;
    }
    const note =
      options.note?.trim() ||
      (origin === "suggested"
        ? "User accepted the floor-model height suggestion for this room; room-specific ceiling measurement was not established by extraction."
        : "Ceiling height entered by user during truss review.");
    try {
      const result = reviewRoomHeights(model, {
        levelId: options.levelId,
        zoneIds: [zone.id],
        heightMm: height,
        basis: origin === "suggested" ? "floor-model" : "reviewer-entered",
        note,
        generate: true,
      });
      // Failed rooms keep their original state. A preview must not silently save
      // a height suggestion to a room the user is not adding to the model.
      if (result.generatedRooms) {
        model = result.model;
        rooms.push({
          ...row,
          status: "ready",
          message: "Fits the modeled walls.",
        });
      } else
        rooms.push({
          ...row,
          status: "geometry-needed",
          message: result.messages[0] ?? "Room boundaries need adjustment.",
        });
    } catch (e) {
      rooms.push({
        ...row,
        status: "geometry-needed",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }
  const addedIds = new Set(
    rooms.filter((r) => r.status === "ready").map((r) => r.id),
  );
  const members = modelTrusses(model).members.filter((m) =>
    addedIds.has(m.zoneId),
  );
  return {
    model,
    rooms,
    ready: addedIds.size,
    memberCount: members.length,
    linearFeet: members.reduce((n, m) => n + memberLength(m), 0) / 304.8,
  };
}
