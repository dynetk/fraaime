import { z } from "zod";

// Presentation-only metadata. Never part of extraction or structural quantities.
export const FurnitureSchema = z.object({
  id: z.string().min(1).max(160),
  levelId: z.string().min(1).max(160),
  kind: z.enum(["sofa", "bed", "table", "chair", "lamp"]),
  center: z.tuple([
    z.number().finite().min(-1e7).max(1e7),
    z.number().finite().min(-1e7).max(1e7),
  ]),
  rotation: z.number().finite().min(-360).max(360),
});
export type Furniture = z.infer<typeof FurnitureSchema>;
export type FurnitureKind = Furniture["kind"];
export const FURNITURE: Record<
  FurnitureKind,
  { label: string; width: number; depth: number; height: number; color: string }
> = {
  sofa: {
    label: "Sofa",
    width: 2100,
    depth: 900,
    height: 850,
    color: "#6e8584",
  },
  bed: {
    label: "Queen bed",
    width: 1600,
    depth: 2150,
    height: 950,
    color: "#b4a38b",
  },
  table: {
    label: "Dining table",
    width: 1600,
    depth: 900,
    height: 750,
    color: "#98714e",
  },
  chair: {
    label: "Chair",
    width: 500,
    depth: 550,
    height: 850,
    color: "#677587",
  },
  lamp: {
    label: "Floor lamp",
    width: 420,
    depth: 420,
    height: 1600,
    color: "#e4c98d",
  },
};
