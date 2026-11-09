import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { blankModel } from "../src/lib/model";

test("private evaluation resumes without repeated charges and reserves earlier uncertain calls before reordered cases", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "fraaime-eval-test-"));
  try {
    const evidence = path.join(folder, "evidence.json"),
      manifest = path.join(folder, "manifest.json"),
      out = path.join(folder, "results"),
      log = path.join(folder, "calls.txt"),
      mock = path.join(folder, "mock.mjs");
    await writeFile(
      evidence,
      JSON.stringify({
        evidenceVersion: 2,
        coordinateSpace: "displayed-crop-points",
        page: 1,
        width: 100,
        height: 100,
        rotation: 0,
        text: "synthetic",
        lines: [],
        images: [],
      }),
    );
    const sample = {
      id: "sample",
      evidence,
      expectedKind: ["schedule"],
      facts: [],
    };
    await writeFile(manifest, JSON.stringify({ cases: [sample] }));
    await writeFile(
      mock,
      `
      import {appendFileSync} from 'node:fs';
      globalThis.fetch=async (url,init)=>{
        if(String(url).includes('/models/'))return new Response(JSON.stringify({id:'test',object:'model'}),{headers:{'content-type':'application/json'}});
        if(!String(url).endsWith('/responses'))throw new Error('Unexpected mocked endpoint');
        appendFileSync(${JSON.stringify(log)},'call\\n');
        const body=JSON.parse(init.body);
        return new Response(JSON.stringify({id:'resp-test',object:'response',created_at:0,status:'completed',model:body.model,
          output:[{id:'msg-test',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:${JSON.stringify(JSON.stringify({ kind: "schedule", sheet: "TEST", model: { ...blankModel("Synthetic"), scheduleEntries: [] } }))},annotations:[]}]}],
          usage:{input_tokens:100,output_tokens:100,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:30}}
        }),{headers:{'content-type':'application/json'}});
      };
    `,
    );
    const run = (budget: string) =>
      promisify(execFile)(
        process.execPath,
        [
          "--import",
          "tsx",
          "--import",
          mock,
          "scripts/evaluate-models.ts",
          manifest,
          out,
          "--run",
          `--budget=${budget}`,
        ],
        {
          cwd: process.cwd(),
          env: { ...process.env, OPENAI_API_KEY: "sk-synthetic-test" },
        },
      );
    await run("1");
    assert.equal((await readFile(log, "utf8")).trim().split("\n").length, 2);
    await run("1");
    assert.equal((await readFile(log, "utf8")).trim().split("\n").length, 2);
    const savedFile = path.join(out, "sample-gpt-6.1-sol.json");
    const saved = JSON.parse(await readFile(savedFile, "utf8"));
    delete saved.costUpperBoundUsd;
    saved.reservedUsd = 0.8;
    saved.status = "started";
    await writeFile(savedFile, JSON.stringify(saved));
    await writeFile(
      manifest,
      JSON.stringify({ cases: [{ ...sample, id: "new" }, sample] }),
    );
    await assert.rejects(run("0.8"));
    assert.equal((await readFile(log, "utf8")).trim().split("\n").length, 2);
    const report = JSON.parse(
      await readFile(path.join(out, "report.json"), "utf8"),
    );
    assert(report.spentOrReservedUsd > 0.8);
    assert.equal(
      report.records.filter((r: any) => r.status === "budget-skipped").length,
      2,
    );
    assert.equal(
      report.records.filter((r: any) => r.status === "started").length,
      1,
    );
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
