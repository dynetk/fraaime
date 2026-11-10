/** Offline comparison of title OCR checkpoints. All inputs/results remain private. */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { TitleOcrSchema } from "../src/lib/worker";
import {
  sheetKind,
  needsTitleOcr,
  suggestedPlanPages,
  pendingSheetReview,
} from "../src/lib/sheet-selection";
const [baseline, updated, reference] = process.argv.slice(2);
if (!reference)
  throw Error(
    "Usage: compare-title-ocr.ts baseline-dir updated-dir private-reference.json",
  );
const read = async (file: string) => JSON.parse(await readFile(file, "utf8"));
const oldNative = await read(path.join(baseline, "native.json"));
const native = await read(path.join(updated, "native.json"));
const refs = await read(reference),
  results = [];
for (const c of native) {
  const ref = refs.cases.find((r: any) => r.name === c.name),
    prior = oldNative.find((r: any) => r.name === c.name);
  if (!ref || ref.sha256 !== c.sha256 || prior?.sha256 !== c.sha256)
    throw Error("Source hashes do not match reference");
  const versions = [];
  for (const folder of [baseline, updated]) {
    const rows = await Promise.all(
      c.manifest.sheets.map((s: any) =>
        read(path.join(folder, `${c.name}-${s.page}.json`)),
      ),
    );
    if (
      rows.some((r: any) => r.sha256 !== c.sha256) ||
      new Set(rows.map((r: any) => r.fingerprint)).size !== 1
    )
      throw Error("Incomplete or mixed-code benchmark");
    for (const row of rows) TitleOcrSchema.parse(row.title);
    const sheets = c.manifest.sheets.map((s: any, i: number) => ({
      ...s,
      ocr: needsTitleOcr(s) ? rows[i].title : undefined,
    }));
    const manifest = { ...c.manifest, sheets };
    const selected = suggestedPlanPages(manifest);
    versions.push({
      pages: rows.length,
      complete: rows.filter((r: any) => r.title.status === "complete").length,
      failed: rows.filter((r: any) => r.title.status === "failed").length,
      unreadable: rows.filter((r: any) => r.title.status === "unreadable")
        .length,
      titleSeconds: Math.round(
        rows.reduce((n: number, r: any) => n + r.titleSeconds, 0),
      ),
      selected,
      coreCount: Object.keys(ref.core).length,
      coreSelected: Object.keys(ref.core)
        .map(Number)
        .filter((p) => selected.includes(p)).length,
      missedCore: Object.keys(ref.core)
        .map(Number)
        .filter((p) => !selected.includes(p)),
      wrongCoreKinds: Object.entries(ref.core)
        .filter(([p, k]) => sheetKind(sheets[Number(p) - 1]) !== k)
        .map(([p]) => Number(p)),
      unclassifiedReviewCount: pendingSheetReview(manifest, selected).length,
      selectedKinds: selected.map((page) => ({
        page,
        kind: sheetKind(sheets[page - 1]),
      })),
    });
  }
  results.push({ name: c.name, baseline: versions[0], updated: versions[1] });
}
const output = {
  scope: "Title OCR and sheet selection, not model geometry",
  aiCalls: 0,
  aiCostUsd: 0,
  results,
};
await writeFile(
  path.join(updated, "title-comparison.json"),
  JSON.stringify(output, null, 2) + "\n",
);
console.log(JSON.stringify(output, null, 2));
