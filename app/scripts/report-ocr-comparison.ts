import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  sheetKind,
  needsTitleOcr,
  suggestedPlanPages,
  SHELL_SHEET_KINDS,
} from "../src/lib/sheet-selection";
import type { Sheet, Manifest } from "../src/lib/worker";
const [runPath, referencePath, textReferencePath] = process.argv.slice(2);
if (!runPath || !referencePath || !textReferencePath)
  throw Error(
    "Usage: node --import tsx scripts/report-ocr-comparison.ts <run-directory> <reference.json> <text-reference.json>",
  );
const root = resolve(runPath);
const read = async (p: string) => JSON.parse(await readFile(p, "utf8"));
const native = await read(root + "/native.json");
const reference = await read(referencePath),
  textRef = await read(textReferencePath);
const run = await read(root + "/run.json");
function normalized(s: string) {
  return s
    .toUpperCase()
    .replace(/[‘’′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/½/g, "1/2")
    .replace(/¼/g, "1/4")
    .replace(/¾/g, "3/4")
    .replace(/⅛/g, "1/8")
    .replace(/⅜/g, "3/8")
    .replace(/⅝/g, "5/8")
    .replace(/⅞/g, "7/8")
    .replace(/[\s.\-–—]/g, "");
}
function present(raw: string, expected: string) {
  const text = normalized(raw),
    needle = normalized(expected);
  let i = -1;
  while ((i = text.indexOf(needle, i + 1)) >= 0) {
    if (!/\d/.test(needle[0]) || i === 0 || !/[\d/]/.test(text[i - 1]))
      return true;
  }
  return false;
}
const results = [];
for (const c of native) {
  const ref = reference.cases.find((x: any) => x.name === c.name);
  if (!ref || ref.sha256 !== c.sha256)
    throw Error("Reference PDF hash mismatch: " + c.name);
  const rows = await Promise.all(
    c.manifest.sheets.map(async (s: Sheet) => ({
      ...s,
      benchmark: await read(`${root}/${c.name}-${s.page}.json`),
    })),
  );
  for (const r of rows)
    if (
      r.benchmark.sha256 !== c.sha256 ||
      r.benchmark.fingerprint !== run.fingerprint
    )
      throw Error("Stale OCR checkpoint");
  const variants: Record<string, Sheet[]> = {
    native: rows.map((s: any) => ({ ...s, ocr: undefined })),
    hybrid: rows.map((s: any) => ({
      ...s,
      ocr: needsTitleOcr({ ...s, ocr: undefined })
        ? s.benchmark.title
        : undefined,
    })),
    titleOcrOnly: rows.map((s: any) => ({
      ...s,
      text: "",
      kind: "unclassified",
      ocr: s.benchmark.title,
    })),
    fullPageOcrOnly: rows.map((s: any) => ({
      ...s,
      text: s.benchmark.full.text,
      kind: "unclassified",
      ocr: undefined,
    })),
  };
  const core = Object.keys(ref.core).map(Number);
  const modes: Record<string, unknown> = {};
  for (const [name, sheets] of Object.entries(variants)) {
    const eligible = sheets
      .filter((s) => SHELL_SHEET_KINDS.includes(sheetKind(s) as any))
      .map((s) => s.page);
    const selected = suggestedPlanPages({ ...c.manifest, sheets } as Manifest);
    const correct = eligible.filter((p) => core.includes(p));
    const wrongKind = correct.filter(
      (p) => sheetKind(sheets.find((s) => s.page === p)!) !== ref.core[p],
    );
    modes[name] = {
      eligible,
      selected,
      coreFound: correct.length,
      coreTotal: core.length,
      coreMissed: core.filter((p) => !eligible.includes(p)),
      nonCoreCandidates: eligible.filter((p) => !core.includes(p)),
      wrongKind,
      selectedCore: selected.filter((p) => core.includes(p)).length,
      selectedNonCore: selected.filter((p) => !core.includes(p)),
      omittedByCap: correct.filter((p) => !selected.includes(p)),
    };
  }
  const eligibleRows = rows.filter((s: any) =>
    needsTitleOcr({ ...s, ocr: undefined }),
  );
  const totals = (rs: any[]) => ({
    pages: rs.length,
    seconds: Math.round(rs.reduce((n, s) => n + s.benchmark.titleSeconds, 0)),
    complete: rs.filter((s) => s.benchmark.title.status === "complete").length,
    unreadable: rs.filter((s) => s.benchmark.title.status === "unreadable")
      .length,
    failed: rs.filter((s) => s.benchmark.title.status === "failed").length,
  });
  const sample = textRef.cases.find((x: any) => x.name === c.name);
  const row = rows.find((s: any) => s.page === sample.page);
  const facts = sample.facts.map((f: any) => ({
    ...f,
    native: present(row.text, f.text),
    ocr: present(row.benchmark.full.text, f.text),
  }));
  results.push({
    name: c.name,
    pageCount: c.manifest.pageCount,
    nativeSeconds: c.nativeSeconds,
    modes,
    selectiveOcr: totals(eligibleRows),
    allPageTitleOcr: totals(rows),
    fullPageOcr: {
      complete: rows.filter((s: any) => s.benchmark.full.status === "complete")
        .length,
      failed: rows.filter((s: any) => s.benchmark.full.status === "failed")
        .length,
      seconds: Math.round(
        rows.reduce((n: number, s: any) => n + s.benchmark.full.seconds, 0),
      ),
    },
    textSample: {
      page: sample.page,
      facts,
      nativeHits: facts.filter((f: any) => f.native).length,
      ocrHits: facts.filter((f: any) => f.ocr).length,
      byKind: Object.fromEntries(
        ["label", "dimension"].map((kind) => {
          const group = facts.filter((f: any) => f.kind === kind);
          return [
            kind,
            {
              total: group.length,
              nativeHits: group.filter((f: any) => f.native).length,
              ocrHits: group.filter((f: any) => f.ocr).length,
            },
          ];
        }),
      ),
    },
    pages: rows.map((s: any) => ({
      page: s.page,
      native: sheetKind(variants.native[s.page - 1]),
      hybrid: sheetKind(variants.hybrid[s.page - 1]),
      titleOnly: sheetKind(variants.titleOcrOnly[s.page - 1]),
      fullOnly: sheetKind(variants.fullPageOcrOnly[s.page - 1]),
      core: ref.core[s.page] ?? null,
      titleStatus: s.benchmark.title.status,
      fullStatus: s.benchmark.full.status,
      titleSeconds: s.benchmark.titleSeconds,
      fullSeconds: s.benchmark.full.seconds,
      notes: ref.notes[s.page] ?? "",
    })),
  });
}
const hashFile = async (path: string | URL) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
const report = {
  version: 1,
  generatedAt: new Date().toISOString(),
  provenance: {
    selectorSha256: await hashFile(
      new URL("../src/lib/sheet-selection.ts", import.meta.url),
    ),
    nativeInspectorSha256: await hashFile(
      new URL("../worker/main.py", import.meta.url),
    ),
    reportScriptSha256: await hashFile(fileURLToPath(import.meta.url)),
    referenceSha256: await hashFile(referencePath),
    textReferenceSha256: await hashFile(textReferencePath),
    nodeVersion: process.version,
  },
  run,
  referenceScope: reference.scope,
  referenceReview: reference.review,
  textMethod: textRef.method,
  results,
};
await writeFile(root + "/comparison.json", JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    results.map(({ pages, ...rest }) => rest),
    null,
    2,
  ),
);
