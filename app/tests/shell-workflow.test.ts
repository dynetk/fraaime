import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { openLocal, uid, now } from "../src/lib/db";
import { writeArtifact } from "../src/lib/storage";
import { processPlan } from "../src/workflows/process-plan";
import { saveRevision } from "../src/lib/revisions";
test("joint workflow checkpoints once, preserves multi-sheet evidence and human edits, and prevents uncertain-call retries", async () => {
  const db = await openLocal(),
    folder = await mkdtemp(path.join(tmpdir(), "fraaime-shell-workflow-"));
  const globals = globalThis as any,
    oldDb = globals.fraaimeDb,
    oldFetch = globalThis.fetch,
    cwd = process.cwd();
  const keys = [
    "FRAAIME_LOCAL_MODE",
    "FRAAIME_SHELL_FUSION",
    "FRAAIME_SHELL_DETAILS",
    "OPENAI_API_KEY",
    "APP_ORIGIN",
  ];
  const oldEnv = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  let calls = 0,
    valid = true;
  try {
    process.chdir(folder);
    Object.assign(process.env, {
      FRAAIME_LOCAL_MODE: "1",
      FRAAIME_SHELL_FUSION: "1",
      FRAAIME_SHELL_DETAILS: "0",
      OPENAI_API_KEY: "sk-synthetic",
      APP_ORIGIN: "http://127.0.0.1:5193",
    });
    globals.fraaimeDb = Promise.resolve(db);
    await assert.rejects(
      () => writeArtifact("artifacts/../escape.json", {}),
      /Invalid artifact key/,
    );
    const project = uid(),
      plan = uid();
    await db.query(
      "INSERT INTO projects(id,name,owner_email,created_at) VALUES($1,$2,$3,$4)",
      [project, "Synthetic shell", "owner", now()],
    );
    await db.query(
      "INSERT INTO plans(id,project_id,filename,storage_key,size_bytes,manifest,created_at) VALUES($1,$2,$3,$4,1,$5,$6)",
      [
        plan,
        project,
        "synthetic.pdf",
        "synthetic",
        JSON.stringify({ sheets: [{ page: 1 }, { page: 2 }, { page: 3 }] }),
        now(),
      ],
    );
    for (const page of [1, 2]) {
      const key = `artifacts/${plan}/page-${page}-v2.json`;
      await writeArtifact(key, {
        page,
        width: 1000,
        height: 1000,
        evidenceVersion: 2,
        coordinateSpace: "displayed-crop-points",
        rotation: 0,
        text: "Synthetic",
        lines: [],
        images: [],
      });
      await db.query(
        "INSERT INTO page_artifacts(plan_id,page,data) VALUES($1,$2,$3)",
        [plan, page, JSON.stringify({ storageKey: key })],
      );
    }
    const ev = (page: number) => ({
      planId: plan,
      page,
      sheet: "Synthetic",
      region: [0, 0, 1, 1],
      note: "Synthetic reference",
    });
    const m = (valueMm: number) => ({
      readings: [{ valueMm, evidence: [ev(2)] }],
      estimated: false,
    });
    const draft = {
      version: 1,
      datum: "Ground zero",
      sheets: [
        { page: 1, sheet: "P1", kind: "floor-plan" },
        { page: 2, sheet: "S1", kind: "section" },
      ],
      levels: [
        {
          id: "L1",
          label: "Ground",
          planPage: 1,
          planRegion: [0, 0, 1, 1],
          anchor: [0.1, 0.1],
          anchorLabel: "A1",
          rotationDegrees: 0,
          scale: {
            dimensionText: "10m",
            lengthMm: 10000,
            start: [0.1, 0.1],
            end: [0.9, 0.1],
          },
          outline: [
            [0.1, 0.1],
            [0.9, 0.1],
            [0.9, 0.9],
            [0.1, 0.9],
          ],
          voids: [],
          elevation: m(0),
          wallHeight: m(3000),
          wallThickness: m(150),
          evidence: [ev(1)],
        },
      ],
      openings: [],
      roofs: [],
      scheduleEntries: [],
      issues: [],
    };
    let detailValid = true,
      interruptDetail = false,
      interruptOpenings = false;
    const detailDraft = {
      version: 1,
      wallTypes: [
        {
          id: "T",
          label: "Partition",
          thickness: { valueMm: 100, estimated: true, evidence: [ev(1)] },
        },
      ],
      partitions: [
        {
          id: "P",
          label: "Hall",
          levelId: "L1",
          typeId: "T",
          start: [0.1, 0.5],
          end: [0.9, 0.5],
          height: null,
          evidence: [ev(1)],
        },
      ],
      openings: [],
      roofs: [],
      issues: [],
    };
    globalThis.fetch = async (url, init) => {
      const request = JSON.parse(init!.body as string);
      const isDetail = ["shell_details", "shell_openings"].includes(
        request.text.format.name,
      );
      assert.equal(request.model, "gpt-6.1-sol");
      assert.equal(request.reasoning.effort, "medium");
      if (isDetail)
        assert.match(request.input[0].content[0].text, /BASE MODEL/);
      assert(
        String(url).endsWith("/responses"),
        "Only mock provider call is allowed",
      );
      calls++;
      const payload = JSON.stringify({
        id: "resp-" + calls,
        object: "response",
        created_at: 0,
        status: "completed",
        output: [
          {
            id: "msg",
            type: "message",
            role: "assistant",
            status: "completed",
            content: [
              {
                type: "output_text",
                text: isDetail
                  ? detailValid
                    ? JSON.stringify(detailDraft)
                    : "{}"
                  : valid
                    ? JSON.stringify(draft)
                    : "{}",
                annotations: [],
              },
            ],
          },
        ],
        usage: {
          input_tokens: 1000,
          output_tokens: 200,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens_details: { reasoning_tokens: 50 },
        },
      });
      if (isDetail) {
        assert.equal(request.stream, true);
        const result = JSON.parse(payload);
        const events = [
          {
            type: "response.created",
            response: {
              ...result,
              output: [],
              usage: null,
              status: "in_progress",
            },
            sequence_number: 0,
          },
          {
            type: "response.completed",
            response: result,
            sequence_number: 1,
          },
        ];
        return new Response(
          (interruptDetail ||
          (interruptOpenings && request.text.format.name === "shell_openings")
            ? events.slice(0, 1)
            : events
          )
            .map((e) => `data: ${JSON.stringify(e)}\n\n`)
            .join(""),
          { headers: { "content-type": "text/event-stream" } },
        );
      }
      return new Response(payload, {
        headers: { "content-type": "application/json" },
      });
    };
    const job = async (budget = 10) => {
      const id = uid();
      await db.query(
        "INSERT INTO jobs(id,project_id,plan_id,state,phase,pages,budget_usd,created_at,updated_at) VALUES($1,$2,$3,'extracting','Test',$4,$5,$6,$6)",
        [id, project, plan, JSON.stringify([1, 2]), budget, now()],
      );
      return id;
    };
    const first = await job();
    await processPlan(first, "extract");
    assert.equal(calls, 1);
    const state = await db.query<any>(
      "SELECT state,completed_pages FROM jobs WHERE id=$1",
      [first],
    );
    assert.equal(state.rows[0].state, "needs_review");
    assert.deepEqual(state.rows[0].completed_pages, [1, 2]);
    const revisions = await db.query<any>(
      "SELECT * FROM revisions WHERE job_id=$1",
      [first],
    );
    assert.equal(revisions.rows.length, 1);
    assert.deepEqual(
      revisions.rows[0].model.levels[0].evidence.map((e: any) => e.page),
      [1, 2, 2, 2],
    );
    assert(
      revisions.rows[0].model.issues.some(
        (i: any) => i.id === "shell-unread-sheets",
      ),
    );
    await processPlan(first, "extract");
    assert.equal(calls, 1);
    assert.equal(
      (await db.query("SELECT id FROM revisions WHERE job_id=$1", [first])).rows
        .length,
      1,
    );
    const edited = structuredClone(revisions.rows[0].model);
    edited.walls[0].height = 3200;
    const human = await saveRevision(
      db,
      project,
      revisions.rows[0].id,
      edited,
      "owner",
    );
    const rerun = await job();
    await processPlan(rerun, "extract");
    assert.equal(calls, 2);
    assert.equal(
      (
        await db.query<any>("SELECT head_id FROM projects WHERE id=$1", [
          project,
        ])
      ).rows[0].head_id,
      human,
    );
    const limited = await job(0.01);
    await processPlan(limited, "extract");
    assert.equal(calls, 2);
    assert.equal(
      (await db.query<any>("SELECT state FROM jobs WHERE id=$1", [limited]))
        .rows[0].state,
      "failed",
    );
    valid = false;
    const bad = await job();
    await processPlan(bad, "extract");
    assert.equal(calls, 3);
    const uncertain = await db.query<any>(
      "SELECT state,cost_usd FROM ai_calls WHERE job_id=$1",
      [bad],
    );
    assert.equal(uncertain.rows[0].state, "uncertain");
    assert(Number(uncertain.rows[0].cost_usd) > 0);
    await processPlan(bad, "extract");
    assert.equal(calls, 3);
    const cancelled = await job();
    await db.query("UPDATE jobs SET state='cancelled' WHERE id=$1", [
      cancelled,
    ]);
    await processPlan(cancelled, "extract");
    assert.equal(calls, 3);
    assert.equal(
      (await db.query<any>("SELECT state FROM jobs WHERE id=$1", [cancelled]))
        .rows[0].state,
      "cancelled",
    );
    valid = true;
    process.env.FRAAIME_SHELL_DETAILS = "1";
    await processPlan(first, "extract");
    assert.equal(
      calls,
      3,
      "old base-only checkpoints stay pinned after flag change",
    );
    const detailed = await job();
    await processPlan(detailed, "extract");
    assert.equal(calls, 6);
    const checkpoints = await db.query<any>(
      "SELECT page,state,result FROM ai_calls WHERE job_id=$1 ORDER BY page",
      [detailed],
    );
    assert.deepEqual(
      checkpoints.rows.map((r) => r.page),
      [-2, -1, 0],
    );
    assert.equal(
      checkpoints.rows[0].result.model.walls.filter(
        (w: any) => w.role === "interior",
      ).length,
      1,
    );
    assert.equal(
      (
        await db.query<any>("SELECT head_id FROM projects WHERE id=$1", [
          project,
        ])
      ).rows[0].head_id,
      human,
    );
    process.env.FRAAIME_SHELL_DETAILS = "0";
    await processPlan(detailed, "extract");
    assert.equal(calls, 6);
    assert.equal(
      (await db.query("SELECT id FROM revisions WHERE job_id=$1", [detailed]))
        .rows.length,
      1,
    );
    process.env.FRAAIME_SHELL_DETAILS = "1";
    detailValid = false;
    const broken = await job();
    await processPlan(broken, "extract");
    assert.equal(calls, 8);
    const partial = await db.query<any>(
      "SELECT model FROM revisions WHERE job_id=$1",
      [broken],
    );
    assert.equal(partial.rows[0].model.levels.length, 1);
    assert(
      partial.rows[0].model.issues.some((i: any) => i.id === "partial-run"),
    );
    await processPlan(broken, "extract");
    assert.equal(
      calls,
      8,
      "failed detail call is never billed automatically again",
    );
    const limitedDetail = await job(0.28);
    await processPlan(limitedDetail, "extract");
    assert.equal(
      calls,
      9,
      "budget permits base call but blocks detail reservation",
    );
    assert.equal(
      (
        await db.query<any>("SELECT state FROM jobs WHERE id=$1", [
          limitedDetail,
        ])
      ).rows[0].state,
      "failed",
    );
    detailValid = true;
    interruptDetail = true;
    const interrupted = await job();
    await processPlan(interrupted, "extract");
    assert.equal(calls, 11);
    const interruptedCall = (
      await db.query<any>(
        "SELECT state,cost_usd,response_id FROM ai_calls WHERE job_id=$1 AND page=-1",
        [interrupted],
      )
    ).rows[0];
    assert.equal(interruptedCall.state, "uncertain");
    assert.equal(interruptedCall.cost_usd, null);
    assert.equal(interruptedCall.response_id, "resp-11");
    await processPlan(interrupted, "extract");
    assert.equal(calls, 11);
    interruptDetail = false;
    interruptOpenings = true;
    const openingInterrupted = await job();
    await processPlan(openingInterrupted, "extract");
    assert.equal(calls, 14);
    const openingPartial = (
      await db.query<any>("SELECT model FROM revisions WHERE job_id=$1", [
        openingInterrupted,
      ])
    ).rows[0].model;
    assert.equal(
      openingPartial.walls.filter((w: any) => w.role === "interior").length,
      1,
    );
    assert(
      openingPartial.issues.some((i: any) => i.id === "coverage-opening-stage"),
    );
    await processPlan(openingInterrupted, "extract");
    assert.equal(
      calls,
      14,
      "uncertain opening calls are not billed again on retry",
    );
  } finally {
    process.chdir(cwd);
    globalThis.fetch = oldFetch;
    globals.fraaimeDb = oldDb;
    for (const k of keys) {
      if (oldEnv[k] === undefined) delete process.env[k];
      else process.env[k] = oldEnv[k];
    }
    await db.close?.();
    await rm(folder, { recursive: true, force: true });
  }
});
