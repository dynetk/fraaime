import { countRequestReservation } from "../src/lib/request-budget";
/** Joint-sheet evaluation. Private artifacts only; never writes production or project revisions. */
import OpenAI from "openai";
import {
  readFile,
  writeFile,
  mkdir,
  readdir,
  open,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  extractShell,
  buildShellRequest,
  MAX_SHELL_PAGES,
  reserveShellCost,
  SHELL_PROMPT_VERSION,
} from "../src/lib/shell-provider";
import {
  extractShellDetail,
  buildShellDetailRequest,
  reserveDetailCost,
  DETAIL_PROMPT_VERSION,
} from "../src/lib/shell-detail-provider";
import { roofCoverage } from "../src/lib/shell-detail";
import { ExtractionFailure } from "../src/lib/extraction";
import { SOL_MODEL, usageCost } from "../src/lib/ai-config";
import { validateModel } from "../src/lib/model";
import type { PageEvidence } from "../src/lib/worker";
const [manifestArg, outputArg, ...flags] = process.argv.slice(2);
if (!manifestArg || !outputArg)
  throw Error(
    "Usage: npm run evaluate:shells -- manifest.json private/results [--run] [--budget=20]",
  );
const manifestFile = path.resolve(manifestArg),
  out = path.resolve(outputArg),
  live = flags.includes("--run"),
  details = flags.includes("--details");
const budget = Number(
  flags.find((f) => f.startsWith("--budget="))?.split("=")[1] ?? 20,
);
if (!Number.isFinite(budget) || budget <= 0) throw Error("Invalid budget");
const manifest = z
  .object({
    projects: z
      .array(
        z.object({
          id: z.string().regex(/^[a-z0-9-]+$/),
          pages: z.array(z.string()).min(2).max(MAX_SHELL_PAGES),
          baseModel: z.string().optional(),
          baseResult: z.string().optional(),
        }),
      )
      .min(1),
  })
  .parse(JSON.parse(await readFile(manifestFile, "utf8")));
if (
  new Set(manifest.projects.map((p) => p.id)).size !== manifest.projects.length
)
  throw Error("Duplicate project IDs");
await mkdir(out, { recursive: true });
const lockFile = path.join(out, ".running");
const lock = live ? await open(lockFile, "wx", 0o600) : undefined;
const code = await Promise.all(
  [
    "../src/lib/shell.ts",
    "../src/lib/shell-provider.ts",
    "../src/lib/shell-detail.ts",
    "../src/lib/shell-detail-provider.ts",
    "../src/lib/model.ts",
  ].map((f) => readFile(new URL(f, import.meta.url), "utf8")),
);
try {
  if (live) {
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      maxRetries: 0,
      timeout: 30000,
    });
    await client.models.retrieve(SOL_MODEL);
  }
  let committed = 0;
  const costDirectories = [
    ...new Set([
      out,
      ...flags
        .filter((f) => f.startsWith("--prior-results="))
        .map((f) => path.resolve(f.slice("--prior-results=".length))),
    ]),
  ];
  for (const dir of costDirectories)
    for (const file of await readdir(dir)) {
      if (!file.endsWith(".json")) continue;
      const r = JSON.parse(await readFile(path.join(dir, file), "utf8"));
      const cost = r.costUsd ?? r.reservedUsd;
      if (!Number.isFinite(cost) || cost < 0)
        throw Error("Invalid checkpoint cost");
      committed += cost;
    }
  for (const project of manifest.projects) {
    const texts = await Promise.all(
      project.pages.map((f) =>
        readFile(path.resolve(path.dirname(manifestFile), f), "utf8"),
      ),
    );
    const base = details
      ? JSON.parse(
          await readFile(
            path.resolve(path.dirname(manifestFile), project.baseModel!),
            "utf8",
          ),
        )
      : null;
    const baseDraft = details
      ? JSON.parse(
          await readFile(
            path.resolve(path.dirname(manifestFile), project.baseResult!),
            "utf8",
          ),
        ).draft
      : null;
    const promptVersion = details
      ? DETAIL_PROMPT_VERSION
      : SHELL_PROMPT_VERSION;
    const pages = texts.map((t) => JSON.parse(t) as PageEvidence);
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          texts,
          base,
          baseDraft,
          code,
          model: SOL_MODEL,
          reasoning: "medium",
          prompt: promptVersion,
        }),
      )
      .digest("hex");
    const file = path.join(out, project.id + ".json");
    let previous: any;
    try {
      previous = JSON.parse(await readFile(file, "utf8"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        throw Error("Inputs/code changed; use a new output directory");
      console.log(
        JSON.stringify({
          project: project.id,
          status: previous.status,
          resumed: true,
          costUsd: previous.costUsd,
        }),
      );
      continue;
    }
    const preflight = live
      ? await countRequestReservation(
          details
            ? buildShellDetailRequest(
                pages,
                "evaluation-" + project.id,
                base,
                baseDraft,
              )
            : buildShellRequest(pages, "evaluation-" + project.id, project.id),
        )
      : null;
    const reserved =
      preflight?.reservedUsd ??
      (details
        ? reserveDetailCost(pages, base, baseDraft)
        : reserveShellCost(pages));
    const record: any = {
      project: project.id,
      model: SOL_MODEL,
      reasoning: "medium",
      fingerprint,
      promptVersion,
      sourcePages: pages.map((p) => p.page),
      reservedUsd: reserved,
      reservationMethod: live
        ? "provider-token-count"
        : "offline-conservative-upper-bound",
      preflight,
      status: live ? "started" : "dry-run",
    };
    if (!live) {
      console.log(JSON.stringify(record));
      continue;
    }
    if (committed + reserved > budget)
      throw Error(
        `Budget would exceed $${budget} before ${project.id}; existing results preserved.`,
      );
    await writeFile(file, JSON.stringify(record, null, 2), { mode: 0o600 });
    committed += reserved;
    console.log(
      JSON.stringify({
        project: project.id,
        status: "started",
        reservedUsd: reserved,
      }),
    );
    const start = Date.now();
    try {
      const result = details
        ? await extractShellDetail(
            pages,
            "evaluation-" + project.id,
            base,
            baseDraft,
          )
        : await extractShell(pages, "evaluation-" + project.id, project.id);
      Object.assign(record, {
        status: "complete",
        ...result,
        costUsd: usageCost(
          result.inputTokens,
          result.outputTokens,
          result.cachedInputTokens,
          SOL_MODEL,
        ),
        validation: validateModel(result.model),
        counts: {
          levels: result.model.levels.length,
          interiorWalls: result.model.walls.filter((w) => w.role === "interior")
            .length,
          roofCoverage: roofCoverage(result.model),
          walls: result.model.walls.length,
          voids: result.model.levels.reduce((n, l) => n + l.voids.length, 0),
          openings: result.model.openings.length,
          roofs: result.model.roofs.length,
          scheduleEntries: result.model.scheduleEntries?.length ?? 0,
          unresolved: result.model.unresolvedObservations?.length ?? 0,
        },
      });
    } catch (error) {
      const details = error instanceof ExtractionFailure ? error.details : null;
      Object.assign(record, {
        status: "failed",
        error: {
          message:
            error instanceof ExtractionFailure
              ? error.message
              : "Provider call failed; inspect status/code, no automatic retry.",
          status: (error as any)?.status ?? null,
          code: (error as any)?.code ?? null,
          details,
        },
        costUsd: details?.usage
          ? usageCost(
              details.usage.inputTokens,
              details.usage.outputTokens,
              details.usage.cachedInputTokens,
              SOL_MODEL,
            )
          : null,
      });
    }
    record.elapsedSeconds = (Date.now() - start) / 1000;
    await writeFile(file, JSON.stringify(record, null, 2), { mode: 0o600 });
    committed += (record.costUsd ?? reserved) - reserved;
    console.log(
      JSON.stringify({
        project: project.id,
        status: record.status,
        costUsd: record.costUsd,
        elapsedSeconds: record.elapsedSeconds,
        counts: record.counts,
        error: record.error,
      }),
    );
  }
} finally {
  if (lock) {
    await lock.close();
    await unlink(lockFile);
  }
}
