import { test } from "node:test";
import assert from "node:assert/strict";
import { openLocal, uid, now } from "../src/lib/db";
import { processPlan } from "../src/workflows/process-plan";
import type { Manifest } from "../src/lib/worker";
import { sheetKind } from "../src/lib/sheet-selection";

test("title indexing resumes checkpoints, finishes without AI, and respects cancellation", async () => {
  const db = await openLocal(),
    globals = globalThis as any,
    oldDb = globals.fraaimeDb,
    oldFetch = globalThis.fetch;
  const keys = ["PDF_WORKER_URL", "PDF_WORKER_TOKEN", "APP_ORIGIN"];
  const oldEnv = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  let inspections = 0,
    reads = 0,
    fail = true,
    cancelDuringOcr = false;
  const project = uid(),
    plan = uid(),
    job = uid();
  try {
    globals.fraaimeDb = Promise.resolve(db);
    Object.assign(process.env, {
      PDF_WORKER_URL: "https://worker.example.com",
      PDF_WORKER_TOKEN: "synthetic",
      APP_ORIGIN: "https://example.com",
    });
    await db.query(
      "INSERT INTO projects(id,name,owner_email,created_at) VALUES($1,$2,$3,$4)",
      [project, "Synthetic OCR", "test", now()],
    );
    await db.query(
      "INSERT INTO plans(id,project_id,filename,storage_key,size_bytes,created_at) VALUES($1,$2,$3,$4,1,$5)",
      [plan, project, "synthetic.pdf", "synthetic", now()],
    );
    await db.query(
      "INSERT INTO jobs(id,project_id,plan_id,state,phase,budget_usd,created_at,updated_at) VALUES($1,$2,$3,'preparing','Queued',10,$4,$4)",
      [job, project, plan, now()],
    );
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/inspect")) {
        inspections++;
        return Response.json({
          sha256: "synthetic",
          pageCount: 3,
          warnings: [],
          sheets: ["FIRST FLOOR PLAN", "Copyright only", "GENERAL NOTES"].map(
            (text, i) => ({
              page: i + 1,
              text,
              kind: "unclassified",
              sheet: "",
              width: 100,
              height: 100,
              rotation: 0,
              revision: "",
              scanned: false,
            }),
          ),
        });
      }
      assert.ok(
        url.endsWith("/ocr"),
        "No AI endpoint may be called while indexing",
      );
      reads++;
      if (cancelDuringOcr)
        await db.query("UPDATE jobs SET state='cancelled' WHERE id=$1", [job]);
      assert.equal(JSON.parse(String(init?.body)).page, 2);
      if (fail)
        return Response.json(
          { detail: "Temporary worker failure" },
          { status: 503 },
        );
      return Response.json({
        version: 1,
        engine: "tesseract",
        status: "complete",
        text: "EXTERIOR ELEVATIONS",
        lines: [
          {
            text: "EXTERIOR ELEVATIONS",
            confidence: 95,
            region: [0.7, 0.8, 0.9, 0.9],
          },
        ],
      });
    };
    await processPlan(job, "inspect");
    assert.equal(
      (await db.query("SELECT state FROM jobs WHERE id=$1", [job])).rows[0]
        .state,
      "failed",
    );
    assert.equal(
      (
        await db.query<{ manifest: Manifest }>(
          "SELECT manifest FROM plans WHERE id=$1",
          [plan],
        )
      ).rows[0].manifest.indexingComplete,
      false,
    );
    fail = false;
    await db.query("UPDATE jobs SET state='preparing' WHERE id=$1", [job]);
    await processPlan(job, "inspect");
    let m = (
      await db.query<{ manifest: Manifest }>(
        "SELECT manifest FROM plans WHERE id=$1",
        [plan],
      )
    ).rows[0].manifest;
    assert.equal(m.indexingComplete, true);
    assert.equal(sheetKind(m.sheets[1]), "elevation");
    assert.equal(m.sheets[1].text, "Copyright only");
    assert.equal(
      (await db.query("SELECT state FROM jobs WHERE id=$1", [job])).rows[0]
        .state,
      "needs_selection",
    );
    await db.query("UPDATE jobs SET state='preparing' WHERE id=$1", [job]);
    await processPlan(job, "inspect");
    assert.equal(inspections, 1);
    assert.equal(reads, 2, "Completed OCR must not repeat");
    assert.equal(
      (await db.query("SELECT count(*) AS count FROM revisions")).rows[0].count,
      0,
    );
    await db.query("UPDATE jobs SET state='cancelled' WHERE id=$1", [job]);
    await processPlan(job, "inspect");
    assert.equal(
      (await db.query("SELECT state FROM jobs WHERE id=$1", [job])).rows[0]
        .state,
      "cancelled",
    );
    assert.equal(reads, 2);
    // A cancellation while the worker is responding must not save late results.
    delete m.sheets[1].ocr;
    m.indexingComplete = false;
    await db.query("UPDATE plans SET manifest=$1 WHERE id=$2", [
      JSON.stringify(m),
      plan,
    ]);
    await db.query("UPDATE jobs SET state='preparing' WHERE id=$1", [job]);
    cancelDuringOcr = true;
    await processPlan(job, "inspect");
    assert.equal(
      (await db.query("SELECT state FROM jobs WHERE id=$1", [job])).rows[0]
        .state,
      "cancelled",
    );
    assert.equal(
      (
        await db.query<{ manifest: Manifest }>(
          "SELECT manifest FROM plans WHERE id=$1",
          [plan],
        )
      ).rows[0].manifest.sheets[1].ocr,
      undefined,
    );
  } finally {
    globalThis.fetch = oldFetch;
    globals.fraaimeDb = oldDb;
    for (const k of keys) {
      if (oldEnv[k] === undefined) delete process.env[k];
      else process.env[k] = oldEnv[k];
    }
  }
});
