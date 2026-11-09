import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { getWorkflowQueueTrigger } from "@workflow/builders";
import { DETAIL_TIMEOUT_MS } from "../src/lib/shell-detail-provider";

test("hosted queue configuration matches the installed Workflow topic and allows detail persistence", () => {
  const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  const flow = config.functions["src/app/.well-known/workflow/v1/flow/route.js"];
  const { consumer: _legacyConsumer, ...expected } = getWorkflowQueueTrigger();
  assert.deepEqual(flow.experimentalTriggers, [expected]);
  assert.ok(flow.maxDuration * 1000 > DETAIL_TIMEOUT_MS + 60_000);
});

test("deployment preparation registers the compiled queue and preserves other function settings", () => {
  const dir = mkdtempSync(join(tmpdir(), "fraaime-deployment-"));
  try {
    const server = join(dir, ".next/server");
    mkdirSync(server, { recursive: true });
    const manifestPath = join(server, "functions-config-manifest.json");
    const routesPath = join(server, "app-paths-manifest.json");
    writeFileSync(manifestPath, JSON.stringify({ version: 1, functions: { "/api/[...path]": { maxDuration: 300 } } }));
    writeFileSync(routesPath, JSON.stringify({ "/page": "app/page.js", "/api/[...path]/route": "app/api/[...path]/route.js", "/.well-known/workflow/v1/flow/route": "app/.well-known/workflow/v1/flow/route.js" }));
    const script = fileURLToPath(new URL("../scripts/prepare-workflow-deployment.mjs", import.meta.url));
    const run = () => spawnSync(process.execPath, [script], { cwd: dir, encoding: "utf8" });
    assert.equal(run().status, 0);
    const first = readFileSync(manifestPath, "utf8");
    const output = JSON.parse(first);
    assert.deepEqual(output.functions["/api/[...path]"], { maxDuration: 300 });
    assert.equal(output.functions["/.well-known/workflow/v1/flow"].experimentalTriggers[0].topic, "__wkf_workflow_*");
    assert.deepEqual(output.functions["/.well-known/workflow/v1/flow"].experimentalTriggers, [getWorkflowQueueTrigger()]);
    assert.equal(run().status, 0);
    assert.equal(readFileSync(manifestPath, "utf8"), first);
    writeFileSync(routesPath, "{}");
    assert.notEqual(run().status, 0);
    assert.equal(readFileSync(manifestPath, "utf8"), first);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
