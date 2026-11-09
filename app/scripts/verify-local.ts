/** Local-only API smoke test. Supply a private PDF path; it is never uploaded off this computer. */
import { readFile, stat } from "node:fs/promises";
import assert from "node:assert/strict";
import { exampleModel } from "../src/lib/model";
const origin = "http://127.0.0.1:5190";
async function request(path: string, method = "GET", body?: unknown) {
  return fetch(origin + "/api/" + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}
async function data(path: string, method = "GET", body?: unknown) {
  const r = await request(path, method, body);
  const b = await r.json();
  assert(r.ok, JSON.stringify(b));
  return b;
}
const session = await data("session");
assert(session.local, "Refusing non-local smoke test");
const pdf = process.argv[2];
if (!pdf) throw new Error("Supply a local PDF path");
const p = await data("projects", "POST", { name: "Local upload verification" });
try {
  const size = (await stat(pdf)).size;
  const registration = await data("uploads", "POST", {
    projectId: p.id,
    filename: "verification.pdf",
    size,
  });
  const uploaded = await fetch(
    origin + `/api/plans/${registration.planId}/local`,
    { method: "PUT", body: await readFile(pdf) },
  );
  assert.equal(uploaded.status, 200, await uploaded.text());
  const completions = await Promise.all([
    data(`plans/${registration.planId}/complete`, "POST", {}),
    data(`plans/${registration.planId}/complete`, "POST", {}),
  ]);
  assert.equal(
    completions[0].jobId,
    completions[1].jobId,
    "Duplicate completion must reuse job",
  );
  let detail: any;
  for (let i = 0; i < 80; i++) {
    detail = await data("projects/" + p.id);
    const j = detail.jobs[0];
    if (j.state === "needs_selection") break;
    if (j.state === "failed") throw new Error(j.error);
    await new Promise((r) => setTimeout(r, 1000));
  }
  assert.equal(detail.jobs[0].state, "needs_selection");
  assert(detail.plans[0].manifest.pageCount > 0);
  const rendered = await request(`plans/${registration.planId}/page?page=1`);
  assert.equal(rendered.status, 200);
  assert.equal(rendered.headers.get("content-type"), "image/jpeg");
  assert((await rendered.arrayBuffer()).byteLength > 100);
  const noAI = await request(`jobs/${detail.jobs[0].id}/run`, "POST", {
    pages: [1],
  });
  assert.equal(noAI.status, 503, "Missing key must fail explicitly");
  const model = exampleModel(),
    saved = await data("projects/" + p.id + "/model", "POST", {
      baseId: null,
      model,
    });
  const retrieved = await data("projects/" + p.id + "/model");
  assert.deepEqual(retrieved.model, model);
  const stale = await request("projects/" + p.id + "/model", "POST", {
    baseId: null,
    model,
  });
  assert.equal(stale.status, 409);
  const invalid = await request("uploads", "POST", {
    projectId: p.id,
    filename: "oversized.pdf",
    size: 999999999,
  });
  assert.equal(invalid.status, 400);
  const missing = await request(
    "projects/00000000-0000-0000-0000-000000000000",
  );
  assert.equal(missing.status, 404);
  console.log(
    JSON.stringify({
      uploadBytes: size,
      pageCount: detail.plans[0].manifest.pageCount,
      duplicateJobPrevented: true,
      renderedSource: true,
      missingAIFailsClosed: true,
      persistedModel: true,
      staleSaveRejected: true,
      uploadLimitEnforced: true,
    }),
  );
} finally {
  await data("projects/" + p.id, "DELETE");
  console.log("Temporary verification project deleted.");
}
