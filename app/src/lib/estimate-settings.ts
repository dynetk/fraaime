import { z } from "zod";
const rate = z.number().finite().min(0).max(100000);
const percent = z.number().finite().min(0).max(100);
export const EstimateSettingsSchema = z.object({
  version: z.literal(1),
  spacingMm: z.union([z.literal(406.4), z.literal(609.6)]),
  includeFloorFraming: z.boolean(),
  includeRoofFraming: z.boolean(),
  includeLabor: z.boolean(),
  rates: z.object({
    stud: rate,
    track: rate,
    header: rate,
    joist: rate,
    wallLabor: rate,
    floorLabor: rate,
    roofLabor: rate,
  }),
  wastePercent: percent,
  contingencyPercent: percent,
  markupPercent: percent,
  delivery: rate,
});
export type EstimateSettings = z.infer<typeof EstimateSettingsSchema>;
// Fictional demonstration prices, not supplier quotes or market-rate research.
export const MOCK_ESTIMATE_SETTINGS: EstimateSettings = {
  version: 1,
  spacingMm: 406.4,
  includeFloorFraming: false,
  includeRoofFraming: true,
  includeLabor: true,
  rates: {
    stud: 2.4,
    track: 1.65,
    header: 5.5,
    joist: 4.2,
    wallLabor: 1.25,
    floorLabor: 1.5,
    roofLabor: 2,
  },
  wastePercent: 10,
  contingencyPercent: 10,
  markupPercent: 15,
  delivery: 450,
};
