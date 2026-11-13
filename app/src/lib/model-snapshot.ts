import { ModelSchema, type BuildingModel } from "./model";
import { buildEstimate } from "./estimate";

/** Refresh derived quantities without changing source geometry, custom members,
 * or the saved revision. Used for reading, saving and exporting model data. */
export function currentModelSnapshot(input: BuildingModel): BuildingModel {
  const model = ModelSchema.parse(input);
  const estimate = buildEstimate(model);
  return {
    ...model,
    estimate: estimate.settings,
    panelQuantities: estimate.wallPanels,
  };
}
