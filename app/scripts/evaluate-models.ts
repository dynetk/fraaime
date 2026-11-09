/** Private, resumable comparison. No database or production writes. */
import OpenAI from "openai";
import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  readdir,
  open,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  openAIProvider,
  reserveCost,
  PROMPT_VERSION,
  ExtractionFailure,
} from "../src/lib/extraction";
import { tokenCost, usageCost, MODEL_PRICING } from "../src/lib/ai-config";
import { validateModel } from "../src/lib/model";
import type { PageEvidence } from "../src/lib/worker";

const Fact = z.object({
  kind: z.enum(["door", "window"]),
  tag: z.string(),
  width: z.number(),
  height: z.number(),
  count: z.number().int().positive().optional(),
});
const Manifest = z.object({
  cases: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9-]+$/),
        evidence: z.string(),
        expectedKind: z
          .array(
            z.enum([
              "floor-plan",
              "schedule",
              "roof-plan",
              "section",
              "elevation",
              "other",
            ]),
          )
          .min(1),
        facts: z.array(Fact).default([]),
        models: z.array(z.string()).optional(),
      }),
    )
    .min(1),
});
const [manifestArg, outputArg, ...flags] = process.argv.slice(2);
if (!manifestArg || !outputArg)
  throw new Error(
    "Usage: npm run evaluate:models -- private/prepared.json private/results [--run] [--budget=10]",
  );
const manifestFile = path.resolve(manifestArg),
  outputDir = path.resolve(outputArg);
const manifest = Manifest.parse(
  JSON.parse(await readFile(manifestFile, "utf8")),
);
const live = flags.includes("--run");
const budget = Number(
  flags.find((f) => f.startsWith("--budget="))?.split("=")[1] || 10,
);
if (!Number.isFinite(budget) || budget <= 0) throw new Error("Invalid budget");
if (new Set(manifest.cases.map((c) => c.id)).size !== manifest.cases.length)
  throw new Error("Duplicate case IDs");
await mkdir(outputDir, { recursive: true });
const availableVariants = Object.entries(MODEL_PRICING).map(
  ([model, rates]) => ({ model, ...rates }),
);
const requestedModels = flags
  .find((f) => f.startsWith("--models="))
  ?.slice("--models=".length)
  .split(",");
if (
  requestedModels?.some(
    (model) => !availableVariants.some((v) => v.model === model),
  )
)
  throw new Error("Unsupported evaluation model selection");
const variants = requestedModels
  ? availableVariants.filter((v) => requestedModels.includes(v.model))
  : availableVariants.filter((v) =>
      ["gpt-4.1", "gpt-6.1-sol"].includes(v.model),
    );
const records: Record<string, any>[] = [];
let committed = 0;
if (live) {
  if (!process.env.OPENAI_API_KEY)
    throw new Error("OPENAI_API_KEY is missing. No calls made.");
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    maxRetries: 0,
    timeout: 30000,
  });
  for (const v of variants) {
    try {
      await client.models.retrieve(v.model);
    } catch (e) {
      console.error(
        JSON.stringify({
          preflight: "failed",
          model: v.model,
          status: (e as any).status,
          code: (e as any).code || "connection_error",
        }),
      );
      process.exit(1);
    }
  }
}
const lockPath = path.join(outputDir, ".running");
const lock = live ? await open(lockPath, "wx", 0o600) : undefined;
try {
  // Count every existing checkpoint before any new charge, regardless of manifest order.
  for (const name of await readdir(outputDir)) {
    if (!name.endsWith(".json") || name === "report.json") continue;
    const record = JSON.parse(
      await readFile(path.join(outputDir, name), "utf8"),
    );
    const charge = record.costUpperBoundUsd ?? record.reservedUsd;
    if (typeof charge !== "number" || !Number.isFinite(charge) || charge < 0)
      throw new Error("Invalid cost checkpoint; review the output directory.");
    committed += charge;
  }
  for (const c of manifest.cases) {
    const evidenceText = await readFile(
      path.resolve(path.dirname(manifestFile), c.evidence),
      "utf8",
    );
    const evidence = JSON.parse(evidenceText) as PageEvidence;
    for (const v of variants) {
      if (c.models && !c.models.includes(v.model)) continue;
      process.env.OPENAI_MODEL = v.model;
      process.env.OPENAI_REASONING_EFFORT = "medium";
      process.env.OPENAI_INPUT_USD_PER_MILLION = String(v.input);
      process.env.OPENAI_OUTPUT_USD_PER_MILLION = String(v.output);
      const fingerprint = createHash("sha256")
        .update(evidenceText)
        .update(
          JSON.stringify({
            v,
            prompt: PROMPT_VERSION,
            effort: v.model === "gpt-4.1" ? null : "medium",
            expectedKind: c.expectedKind,
            facts: c.facts,
          }),
        )
        .digest("hex");
      const file = path.join(outputDir, `${c.id}-${v.model}.json`);
      let saved: Record<string, any> | undefined;
      try {
        saved = JSON.parse(await readFile(file, "utf8"));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      if (saved) {
        if (saved.fingerprint !== fingerprint)
          throw new Error(
            `Inputs changed for ${c.id}; use a fresh output directory.`,
          );
        records.push(saved);
        continue;
      }
      const reserved = reserveCost(evidence, "");
      const record: Record<string, any> = {
        case: c.id,
        model: v.model,
        reasoning: v.model === "gpt-4.1" ? null : "medium",
        fingerprint,
        promptVersion: PROMPT_VERSION,
        reservedUsd: reserved,
        status: "dry-run",
      };
      if (!live) {
        records.push(record);
        continue;
      }
      if (committed + reserved > budget) {
        record.status = "budget-skipped";
        records.push(record);
        continue;
      }
      // Persist before sending. Interrupted/uncertain requests are never silently billed again.
      record.status = "started";
      await writeFile(file, JSON.stringify(record, null, 2), {
        flag: "wx",
        mode: 0o600,
      });
      const started = Date.now();
      try {
        const result = await openAIProvider().extract(
          evidence,
          "evaluation",
          "",
        );
        const model = result.data.model;
        const facts = c.facts.map((f) => {
          const matches = (model.scheduleEntries ?? []).filter(
            (o) =>
              o.kind === f.kind &&
              o.tag.trim().toUpperCase() === f.tag.toUpperCase(),
          );
          const dimensionMatch =
            matches.length > 0 &&
            matches.every(
              (o) =>
                o.width !== null &&
                o.height !== null &&
                Math.abs(o.width - f.width) <= 3 &&
                Math.abs(o.height - f.height) <= 3,
            );
          const quantityMatch =
            f.count === undefined
              ? null
              : matches.length === 1 && matches[0].quantity === f.count;
          return {
            ...f,
            actual: matches.map((o) => ({
              width: o.width,
              height: o.height,
              quantity: o.quantity,
              tagRole: o.tagRole,
            })),
            dimensionPass: dimensionMatch,
            quantityPass: quantityMatch,
            pass: dimensionMatch && quantityMatch !== false,
          };
        });
        Object.assign(record, {
          status: "complete",
          elapsedMs: Date.now() - started,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          reasoningTokens: result.reasoningTokens,
          cachedInputTokens: result.cachedInputTokens,
          costUpperBoundUsd: tokenCost(
            result.inputTokens,
            result.outputTokens,
            v,
            v.model,
          ),
          estimatedCostUsd: usageCost(
            result.inputTokens,
            result.outputTokens,
            result.cachedInputTokens ?? 0,
            v.model,
          ),
          responseId: result.responseId,
          kindPass: c.expectedKind.includes(result.data.kind),
          facts,
          geometry: {
            levels: model.levels.length,
            walls: model.walls.length,
            openings: model.openings.length,
            voids: model.levels.reduce((n, l) => n + l.voids.length, 0),
            calibrations: model.calibrations.length,
            scheduleEntries: model.scheduleEntries?.length ?? 0,
            unresolvedObservations: model.unresolvedObservations?.length ?? 0,
            hasDrawableShell: model.levels.length > 0 && model.walls.length > 0,
          },
          missingEvidence: [
            ...model.levels,
            ...model.walls,
            ...model.openings,
            ...model.roofs,
            ...model.components,
            ...(model.scheduleEntries ?? []),
          ].filter(
            (e) =>
              !e.evidence.some(
                (s) => s.page === evidence.page && s.planId === "evaluation",
              ),
          ).length,
          validation: validateModel(model),
          result: result.data,
        });
      } catch (e) {
        if (e instanceof ExtractionFailure) {
          record.responseId = e.details.responseId;
          record.responseStatus = e.details.status;
          record.incompleteReason = e.details.reason;
          if (e.details.usage) {
            Object.assign(record, e.details.usage);
            record.estimatedCostUsd = usageCost(
              e.details.usage.inputTokens,
              e.details.usage.outputTokens,
              e.details.usage.cachedInputTokens,
              v.model,
            );
            record.costUpperBoundUsd = tokenCost(
              e.details.usage.inputTokens,
              e.details.usage.outputTokens,
              v,
              v.model,
            );
          }
        }
        // Error text may contain provider request details. Keep only safe classification.
        Object.assign(record, {
          status: "failed-or-uncertain",
          elapsedMs: Date.now() - started,
          error: {
            name: (e as Error).name,
            status: (e as any).status,
            code: (e as any).code || "extraction_failed",
          },
        });
      }
      committed += record.costUpperBoundUsd ?? reserved;
      await writeFile(file, JSON.stringify(record, null, 2), { mode: 0o600 });
      records.push(record);
      console.log(
        JSON.stringify({
          case: record.case,
          model: record.model,
          status: record.status,
          elapsedMs: record.elapsedMs,
          costUpperBoundUsd: record.costUpperBoundUsd,
          estimatedCostUsd: record.estimatedCostUsd,
          factsPassed: record.facts?.filter((f: any) => f.pass).length,
          factsTotal: record.facts?.length,
        }),
      );
    }
  }
  const report = {
    createdAt: new Date().toISOString(),
    live,
    budgetUsd: budget,
    spentOrReservedUsd: committed,
    estimatedReservationUsd: records.reduce((sum, r) => sum + r.reservedUsd, 0),
    limitations: [
      "Independent page tests use identical inputs and no prior context; this is not a complete multi-sheet project evaluation.",
      "Sampled schedule facts do not establish complete geometry accuracy. Floor plans require visual review.",
      "estimatedCostUsd includes reported cache discounts; costUpperBoundUsd excludes cache discounts for budget safety. Provider invoices are authoritative.",
      "Model access, schema validity and sampled dimensions alone do not authorize production promotion.",
    ],
    records: records.map(({ result, ...r }) => r),
  };
  await writeFile(
    path.join(outputDir, "report.json"),
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      report: path.join(outputDir, "report.json"),
      live,
      spentOrReservedUsd: committed,
      cases: records.length,
    }),
  );
  if (live && records.some((r) => r.status !== "complete"))
    process.exitCode = 1;
} finally {
  if (lock) {
    await lock.close();
    await unlink(lockPath);
  }
}
