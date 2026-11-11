import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { openLocal, uid, now } from "../src/lib/db";
import { blankModel } from "../src/lib/model";
import {
  isOutputLimitedOpening,
  resumeCompletedStages,
} from "../src/lib/extraction-recovery";
import { processPlan } from "../src/workflows/process-plan";
import { writeArtifact } from "../src/lib/storage";
import type { PageEvidence } from "../src/lib/worker";
const failed = {
  id: "call",
  page: -2,
  state: "uncertain",
  error: "Detail response incomplete.",
  response_id: "response",
  output_tokens: 24000,
  cost_usd: "0.7",
  reserved_usd: "0.8",
  result: null,
};
test("only confirmed terminal opening truncations qualify, including legacy records", () => {
  assert(isOutputLimitedOpening(failed));
  assert(
    isOutputLimitedOpening({
      ...failed,
      state: "failed",
      output_tokens: 48000,
      result: {
        failure: { status: "incomplete", reason: "max_output_tokens" },
      },
    }),
  );
  for (const change of [
    { response_id: null },
    { cost_usd: null },
    { output_tokens: 23000 },
    { page: -1 },
    { state: "started" },
    { error: "Detail stream interrupted; usage is unknown." },
    {
      result: { failure: { status: "unknown", reason: "stream_interrupted" } },
    },
  ])
    assert.equal(isOutputLimitedOpening({ ...failed, ...change }), false);
});
test("manual resume reuses completed stages, keeps costs and human edits, and bills only one new opening call", async () => {
  const db = await openLocal(),
    folder = await mkdtemp(path.join(tmpdir(), "fraaime-recovery-")),
    cwd = process.cwd();
  const g = globalThis as any,
    oldDb = g.fraaimeDb,
    oldFetch = globalThis.fetch;
  const keys = [
    "FRAAIME_LOCAL_MODE",
    "FRAAIME_SHELL_FUSION",
    "FRAAIME_SHELL_DETAILS",
    "OPENAI_API_KEY",
    "APP_ORIGIN",
  ];
  const env = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    process.chdir(folder);
    g.fraaimeDb = Promise.resolve(db);
    Object.assign(process.env, {
      FRAAIME_LOCAL_MODE: "1",
      FRAAIME_SHELL_FUSION: "1",
      FRAAIME_SHELL_DETAILS: "1",
      OPENAI_API_KEY: "synthetic",
      APP_ORIGIN: "http://127.0.0.1:5193",
    });
    const project = uid(),
      plan = uid(),
      job = uid(),
      head = uid(),
      stamp = now(),
      model = blankModel("Synthetic");
    await db.query(
      "INSERT INTO projects(id,name,owner_email,head_id,created_at) VALUES($1,'Synthetic','owner',$2,$3)",
      [project, head, stamp],
    );
    await db.query(
      "INSERT INTO plans(id,project_id,filename,storage_key,size_bytes,manifest,created_at) VALUES($1,$2,'synthetic.pdf','synthetic',1,$3,$4)",
      [
        plan,
        project,
        JSON.stringify({
          pageCount: 2,
          sheets: [
            { page: 1, kind: "floor-plan" },
            { page: 2, kind: "section" },
          ],
        }),
        stamp,
      ],
    );
    await db.query(
      "INSERT INTO revisions(id,project_id,kind,model,author,created_at) VALUES($1,$2,'human',$3,'owner',$4)",
      [head, project, JSON.stringify(model), stamp],
    );
    await db.query(
      "INSERT INTO jobs(id,project_id,plan_id,state,phase,pages,completed_pages,budget_usd,base_head,created_at,updated_at) VALUES($1,$2,$3,'failed','Stopped','[1,2]','[1,2]',10,$4,$5,$5)",
      [job, project, plan, head, stamp],
    );
    const draft = {
      version: 1,
      datum: "zero",
      levels: [],
      openings: [],
      roofs: [],
      scheduleEntries: [],
      issues: [],
      sheets: [
        { page: 1, sheet: "A1", kind: "floor-plan" },
        { page: 2, sheet: "A2", kind: "section" },
      ],
    };
    const detail = {
      version: 1,
      wallRemovals: [],
      wallTypes: [],
      partitions: [],
      exteriorWalls: [],
      wallTops: [],
      roofOpenings: [],
      openings: [],
      roofs: [],
      issues: [],
    };
    for (const page of [0, -1])
      await db.query(
        "INSERT INTO ai_calls(id,job_id,page,state,reserved_usd,cost_usd,input_tokens,output_tokens,model,result,response_id,created_at) VALUES($1,$2,$3,'complete',0.6,0.5,1000,100,'gpt-6.1-sol',$4,$5,$6)",
        [
          uid(),
          job,
          page,
          JSON.stringify({
            kind: "project-shell",
            model,
            draft,
            sourcePages: [1, 2],
            detailRequested: true,
            openingsRequested: true,
            ...(page === -1 ? { detailDraft: detail } : {}),
          }),
          "saved-" + page,
          stamp,
        ],
      );
    await db.query(
      "INSERT INTO ai_calls(id,job_id,page,state,reserved_usd,cost_usd,output_tokens,model,error,response_id,created_at) VALUES($1,$2,-2,'uncertain',0.8,0.7,24000,'gpt-6.1-sol','Detail response incomplete.','failed-response',$3)",
      [uid(), job, stamp],
    );
    const evidence = [1, 2].map((page) => ({
      page,
      width: 1000,
      height: 1000,
      evidenceVersion: 2,
      coordinateSpace: "displayed-crop-points",
      rotation: 0,
      text: "Synthetic",
      lines: [],
      images: [],
    })) as PageEvidence[];
    for (const e of evidence) {
      const key = `artifacts/${plan}/page-${e.page}-v2.json`;
      await writeArtifact(key, e);
      await db.query(
        "INSERT INTO page_artifacts(plan_id,page,data) VALUES($1,$2,$3)",
        [plan, e.page, JSON.stringify({ storageKey: key })],
      );
    }
    const resumed = await db.transaction((tx) =>
      resumeCompletedStages(tx, job, "owner"),
    );
    assert(resumed);
    assert.equal(
      Number(
        (
          await db.query<any>("SELECT budget_usd FROM jobs WHERE id=$1", [
            resumed,
          ])
        ).rows[0].budget_usd,
      ),
      8.3,
    );
    await assert.rejects(
      () => db.transaction((tx) => resumeCompletedStages(tx, job, "owner")),
      /already has a resumed/,
    );
    assert.equal((await db.query("SELECT id FROM jobs")).rows.length, 2);
    let calls = 0,
      truncate = false;
    globalThis.fetch = async (url, init) => {
      const b = JSON.parse(init!.body as string);
      if (String(url).endsWith("/responses/input_tokens"))
        return Response.json({
          object: "response.input_tokens",
          input_tokens: 1000,
        });
      assert(String(url).endsWith("/responses"));
      calls++;
      assert.equal(b.text.format.name, "shell_openings");
      assert.equal(b.max_output_tokens, 48000);
      assert.equal(b.model, "gpt-6.1-sol");
      assert.equal(b.reasoning.effort, "medium");
      const response = {
        id: "completed-response",
        status: truncate ? "incomplete" : "completed",
        incomplete_details: truncate ? { reason: "max_output_tokens" } : null,
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: JSON.stringify(detail) }],
          },
        ],
        usage: {
          input_tokens: 1000,
          output_tokens: truncate ? 48000 : 200,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens_details: { reasoning_tokens: 20 },
        },
      };
      return new Response(
        `data: ${JSON.stringify({ type: truncate ? "response.incomplete" : "response.completed", response })}\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      );
    };
    await processPlan(resumed, "extract");
    assert.equal(calls, 1);
    assert.equal(
      (await db.query<any>("SELECT state FROM jobs WHERE id=$1", [resumed]))
        .rows[0].state,
      "needs_review",
    );
    assert.equal(
      (
        await db.query<any>("SELECT head_id FROM projects WHERE id=$1", [
          project,
        ])
      ).rows[0].head_id,
      head,
    );
    const ledger = (
      await db.query<any>(
        "SELECT page,cost_usd FROM ai_calls WHERE job_id=$1 ORDER BY page",
        [resumed],
      )
    ).rows;
    assert.equal(ledger.length, 3);
    assert.equal(Number(ledger[1].cost_usd), 0);
    assert.equal(Number(ledger[2].cost_usd), 0);
    assert(Number(ledger[0].cost_usd) > 0);
    assert.equal(
      Number(
        (
          await db.query<any>(
            "SELECT sum(cost_usd) AS cost FROM ai_calls WHERE job_id=$1",
            [job],
          )
        ).rows[0].cost,
      ),
      1.7,
    );
    await processPlan(resumed, "extract");
    assert.equal(calls, 1);
    assert.equal(
      (await db.query("SELECT id FROM revisions WHERE job_id=$1", [resumed]))
        .rows.length,
      1,
    );
    await db.query("DELETE FROM audit WHERE action='job.resumed'");
    const truncatedJob = await db.transaction((tx) =>
      resumeCompletedStages(tx, job, "owner"),
    );
    assert(truncatedJob);
    truncate = true;
    await processPlan(truncatedJob, "extract");
    assert.equal(calls, 2);
    const stopped = (
      await db.query<any>("SELECT state,error FROM jobs WHERE id=$1", [
        truncatedJob,
      ])
    ).rows[0];
    assert.equal(stopped.state, "failed");
    assert.match(
      stopped.error,
      /Door\/window placement reached the AI output limit \(48000 tokens\)/,
    );
    const stoppedCall = (
      await db.query<any>(
        "SELECT * FROM ai_calls WHERE job_id=$1 AND page=-2",
        [truncatedJob],
      )
    ).rows[0];
    assert.equal(stoppedCall.state, "failed");
    assert.equal(stoppedCall.result.failure.reason, "max_output_tokens");
    assert(isOutputLimitedOpening(stoppedCall));
    assert(Number(stoppedCall.cost_usd) > 0);
    await processPlan(truncatedJob, "extract");
    assert.equal(
      calls,
      2,
      "workflow retry must not automatically repeat a paid truncated call",
    );
    const next = await db.transaction((tx) =>
      resumeCompletedStages(tx, truncatedJob, "owner"),
    );
    assert(next);
    assert.equal(
      Number(
        (await db.query<any>("SELECT budget_usd FROM jobs WHERE id=$1", [next]))
          .rows[0].budget_usd,
      ),
      8.3 - Number(stoppedCall.cost_usd),
    );
    await db.query("DELETE FROM audit WHERE action='job.resumed'");
    await db.query(
      "UPDATE ai_calls SET cost_usd=NULL,error='Detail stream interrupted; usage is unknown.' WHERE job_id=$1 AND page=-2",
      [job],
    );
    await assert.rejects(
      () => db.transaction((tx) => resumeCompletedStages(tx, job, "owner")),
      /unknown or non-recoverable/,
    );
    await db.query(
      "UPDATE ai_calls SET cost_usd=0.7,error='Detail response incomplete.' WHERE job_id=$1 AND page=-2",
      [job],
    );
    await db.query("UPDATE jobs SET budget_usd=1 WHERE id=$1", [job]);
    await assert.rejects(
      () => db.transaction((tx) => resumeCompletedStages(tx, job, "owner")),
      /no remaining budget/,
    );
  } finally {
    globalThis.fetch = oldFetch;
    g.fraaimeDb = oldDb;
    process.chdir(cwd);
    for (const k of keys) {
      if (env[k] === undefined) delete process.env[k];
      else process.env[k] = env[k];
    }
    await db.close?.();
    await rm(folder, { recursive: true, force: true });
  }
});
