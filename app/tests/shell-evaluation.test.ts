import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
test("joint evaluation resumes without duplicate requests and reserves uncertain prior spend before new cases", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "fraaime-shell-test-"));
  try {
    const manifest = path.join(folder, "manifest.json"),
      out = path.join(folder, "results"),
      log = path.join(folder, "calls.txt"),
      mock = path.join(folder, "mock.mjs");
    const files = [1, 2].map((page) => path.join(folder, `page-${page}.json`));
    for (const [i, file] of files.entries())
      await writeFile(
        file,
        JSON.stringify({
          page: i + 1,
          width: 100,
          height: 100,
          evidenceVersion: 2,
          coordinateSpace: "displayed-crop-points",
          rotation: 0,
          text: "Synthetic",
          lines: [],
          images: [],
        }),
      );
    const sample = { id: "sample", pages: files };
    await writeFile(manifest, JSON.stringify({ projects: [sample] }));
    const draft = {
      version: 1,
      datum: "Synthetic",
      sheets: [],
      levels: [],
      openings: [],
      roofs: [],
      scheduleEntries: [],
      issues: [],
    };
    await writeFile(
      mock,
      `import {appendFileSync} from 'node:fs';globalThis.fetch=async(url,init)=>{if(String(url).includes('/models/'))return new Response(JSON.stringify({id:'gpt-6.1-sol'}),{headers:{'content-type':'application/json'}});if(!String(url).endsWith('/responses'))throw Error('Unexpected URL');appendFileSync(${JSON.stringify(log)},'call\\n');return new Response(JSON.stringify({id:'response-test',object:'response',created_at:0,status:'completed',output:[{id:'msg',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:${JSON.stringify(JSON.stringify(draft))},annotations:[]}]}],usage:{input_tokens:1000,output_tokens:200,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:100}}}),{headers:{'content-type':'application/json'}});};`,
    );
    const run = (budget: string, extra: string[] = []) =>
      promisify(execFile)(
        process.execPath,
        [
          "--import",
          "tsx",
          "--import",
          mock,
          "scripts/evaluate-shells.ts",
          manifest,
          out,
          "--run",
          `--budget=${budget}`,
          ...extra,
        ],
        {
          cwd: process.cwd(),
          env: { ...process.env, OPENAI_API_KEY: "sk-synthetic" },
        },
      );
    await run("2");
    await run("2");
    assert.equal((await readFile(log, "utf8")).trim().split("\n").length, 1);
    const file = path.join(out, "sample.json"),
      record = JSON.parse(await readFile(file, "utf8"));
    record.status = "started";
    delete record.costUsd;
    record.reservedUsd = 1.5;
    await writeFile(file, JSON.stringify(record));
    await writeFile(
      manifest,
      JSON.stringify({ projects: [{ ...sample, id: "new" }, sample] }),
    );
    await assert.rejects(run("1.5"));
    assert.equal((await readFile(log, "utf8")).trim().split("\n").length, 1);
    const earlier = path.join(folder, "earlier");
    await mkdir(earlier);
    await writeFile(
      path.join(earlier, "uncertain.json"),
      JSON.stringify({ costUsd: null, reservedUsd: 10, status: "failed" }),
    );
    await assert.rejects(run("10", [`--prior-results=${earlier}`]));
    assert.equal((await readFile(log, "utf8")).trim().split("\n").length, 1);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
