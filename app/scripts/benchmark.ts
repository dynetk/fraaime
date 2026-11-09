/** Compare a candidate with independently annotated facts; never treat legacy meshes as truth. */
import { readFile, writeFile } from "node:fs/promises";
import { ModelSchema, validateModel } from "../src/lib/model";
import { z } from "zod";
const Expected = z.object({
  facts: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(["wall", "opening", "level"]),
      field: z.string(),
      expected: z.number(),
      tolerance: z.number().nonnegative(),
    }),
  ),
  expectedCounts: z
    .object({
      walls: z.number().optional(),
      openings: z.number().optional(),
      levels: z.number().optional(),
    })
    .optional(),
  correctionMinutes: z.number().optional(),
  costUsd: z.number().optional(),
});
const [modelFile, truthFile, output] = process.argv.slice(2);
if (!modelFile || !truthFile)
  throw new Error(
    "Usage: npm run benchmark -- candidate.json independent-annotations.json [report.json]",
  );
const model = ModelSchema.parse(JSON.parse(await readFile(modelFile, "utf8"))),
  truth = Expected.parse(JSON.parse(await readFile(truthFile, "utf8")));
const facts = truth.facts.map((f) => {
  const elements =
    f.kind === "wall"
      ? model.walls
      : f.kind === "opening"
        ? model.openings
        : model.levels;
  const element = elements.find((e) => e.id === f.id) as
    Record<string, unknown> | undefined;
  const actual = element?.[f.field],
    error = typeof actual === "number" ? Math.abs(actual - f.expected) : null;
  return {
    ...f,
    actual: actual ?? null,
    error,
    pass: error !== null && error <= f.tolerance,
  };
});
const report = {
  facts,
  passed: facts.filter((f) => f.pass).length,
  total: facts.length,
  counts: {
    walls: model.walls.length,
    openings: model.openings.length,
    levels: model.levels.length,
  },
  expectedCounts: truth.expectedCounts,
  validation: validateModel(model),
  correctionMinutes: truth.correctionMinutes ?? null,
  costUsd: truth.costUsd ?? null,
};
if (output) await writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
