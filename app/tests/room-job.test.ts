import test from "node:test";
import assert from "node:assert/strict";
import { openLocal, uid, now } from "../src/lib/db";
import { blankModel } from "../src/lib/model";
import { createRoomJob } from "../src/lib/room-job";
import {
  assembleStoredResults,
  type ShellResult,
} from "../src/lib/shell-results";

test("room job scopes revision to project, pins immutable model and copies calibration without charging", async () => {
  const db = await openLocal();
  try {
    const project = uid(),
      other = uid(),
      plan = uid(),
      revision = uid(),
      foreign = uid(),
      job = uid(),
      stamp = now();
    const model = blankModel("Saved human model");
    model.levels = [
      {
        id: "L1",
        label: "Ground",
        height: 3000,
        elevation: 0,
        outline: [
          [0, 0],
          [1000, 0],
          [1000, 1000],
          [0, 1000],
        ],
        voids: [],
        inferred: true,
        evidence: [
          {
            planId: plan,
            page: 1,
            sheet: "A1",
            region: [0, 0, 1, 1],
            note: "Synthetic plan",
          },
        ],
      },
    ];
    model.calibrations = [
      {
        page: 1,
        region: [0, 0, 1, 1],
        mmPerPoint: 10,
        dimensionText: "10 m",
        confirmed: true,
      },
    ];
    for (const id of [project, other])
      await db.query(
        "INSERT INTO projects(id,name,owner_email,created_at) VALUES($1,'Sample','owner',$2)",
        [id, stamp],
      );
    await db.query(
      "INSERT INTO plans(id,project_id,filename,storage_key,size_bytes,manifest,created_at) VALUES($1,$2,'sample.pdf','private',1,$3,$4)",
      [
        plan,
        project,
        JSON.stringify({ pageCount: 2, sheets: [], indexingComplete: true }),
        stamp,
      ],
    );
    for (const [id, pr] of [
      [revision, project],
      [foreign, other],
    ])
      await db.query(
        "INSERT INTO revisions(id,project_id,kind,model,author,created_at) VALUES($1,$2,'human',$3,'owner',$4)",
        [id, pr, JSON.stringify(model), stamp],
      );
    await db.query(
      "INSERT INTO jobs(id,project_id,plan_id,state,phase,pages,budget_usd,created_at,updated_at) VALUES($1,$2,$3,'needs_review','Done','[1,2]',10,$4,$4)",
      [job, project, plan, stamp],
    );
    const result = {
      kind: "project-shell",
      model,
      draft: {
        version: 1,
        datum: "0",
        levels: [],
        sheets: [],
        issues: [],
        openings: [],
        roofs: [],
        scheduleEntries: [],
      },
      sourcePages: [1, 2],
    } as ShellResult;
    await db.query(
      "INSERT INTO ai_calls(id,job_id,page,state,reserved_usd,cost_usd,model,result,created_at) VALUES($1,$2,0,'complete',0,0,'test',$3,$4)",
      [
        uid(),
        job,
        JSON.stringify({
          ...result,
          model: {
            ...model,
            calibrations: model.calibrations.map((c) => ({
              ...c,
              confirmed: false,
            })),
          },
        }),
        stamp,
      ],
    );
    await assert.rejects(
      () =>
        createRoomJob(db, project, plan, "owner", {
          revisionId: foreign,
          pages: [1, 2],
        }),
      /missing from this project/,
    );
    await assert.rejects(
      () =>
        createRoomJob(db, other, plan, "owner", {
          revisionId: foreign,
          pages: [1, 2],
        }),
      /missing from this project/,
    );
    const id = await createRoomJob(db, project, plan, "owner", {
      revisionId: revision,
      pages: [1, 2],
    });
    const rows = (
      await db.query<any>(
        "SELECT page,result,cost_usd FROM ai_calls WHERE job_id=$1",
        [id],
      )
    ).rows;
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].cost_usd), 0);
    assert.equal(rows[0].result.roomsOnly, true);
    assert.deepEqual(rows[0].result.model, model);
    await assert.rejects(
      () =>
        createRoomJob(db, project, plan, "owner", {
          revisionId: revision,
          pages: [1, 2],
        }),
      /already being processed|capacity/,
    );
    const roomed = { ...rows[0].result, roomsComplete: true };
    const assembled = assembleStoredResults(
      [...rows, { page: -3, result: roomed }],
      "sample",
      plan,
      [1, 2],
    );
    assert.deepEqual(assembled.walls, model.walls);
    assert(!assembled.issues.some((i) => i.id === "coverage-room-stage"));
    assert(
      assembleStoredResults(rows, "sample", plan, [1, 2]).issues.some(
        (i) => i.id === "coverage-room-stage",
      ),
    );
  } finally {
    await db.close!();
  }
});

test("room-only durable workflow uses one paid call, retains saved shell, and replays without duplicate calls", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const { processPlan } = await import("../src/workflows/process-plan");
  const { writeArtifact } = await import("../src/lib/storage");
  const db = await openLocal(),
    folder = await mkdtemp(path.join(tmpdir(), "fraaime-rooms-")),
    cwd = process.cwd();
  const g = globalThis as any,
    oldDb = g.fraaimeDb,
    oldFetch = globalThis.fetch;
  const keys = ["FRAAIME_LOCAL_MODE", "OPENAI_API_KEY", "APP_ORIGIN"],
    env = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    process.chdir(folder);
    g.fraaimeDb = Promise.resolve(db);
    Object.assign(process.env, {
      FRAAIME_LOCAL_MODE: "1",
      OPENAI_API_KEY: "synthetic",
      APP_ORIGIN: "http://127.0.0.1:5193",
    });
    const project = uid(),
      plan = uid(),
      job = uid(),
      revision = uid(),
      stamp = now(),
      model = blankModel("Preserve this shell");
    await db.query(
      "INSERT INTO projects(id,name,owner_email,head_id,created_at) VALUES($1,'Sample','owner',$2,$3)",
      [project, revision, stamp],
    );
    await db.query(
      "INSERT INTO plans(id,project_id,filename,storage_key,size_bytes,manifest,created_at) VALUES($1,$2,'sample.pdf','private',1,$3,$4)",
      [
        plan,
        project,
        JSON.stringify({
          pageCount: 2,
          sheets: [
            { page: 1, kind: "floor-plan" },
            { page: 2, kind: "section" },
          ],
          indexingComplete: true,
        }),
        stamp,
      ],
    );
    await db.query(
      "INSERT INTO revisions(id,project_id,kind,model,author,created_at) VALUES($1,$2,'human',$3,'owner',$4)",
      [revision, project, JSON.stringify(model), stamp],
    );
    await db.query(
      "INSERT INTO jobs(id,project_id,plan_id,state,phase,pages,budget_usd,base_head,created_at,updated_at) VALUES($1,$2,$3,'extracting','Rooms','[1,2]',10,$4,$5,$5)",
      [job, project, plan, revision, stamp],
    );
    const seed = {
      kind: "project-shell",
      model,
      draft: {
        version: 1,
        datum: "0",
        levels: [],
        sheets: [],
        issues: [],
        openings: [],
        roofs: [],
        scheduleEntries: [],
      },
      sourcePages: [1, 2],
      roomsOnly: true,
      roomsRequested: true,
    };
    await db.query(
      "INSERT INTO ai_calls(id,job_id,page,state,reserved_usd,cost_usd,model,result,created_at) VALUES($1,$2,0,'complete',0,0,'saved-model',$3,$4)",
      [uid(), job, JSON.stringify(seed), stamp],
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
    let calls = 0;
    globalThis.fetch = async (url, init) => {
      if (String(url).endsWith("/responses/input_tokens"))
        return Response.json({
          object: "response.input_tokens",
          input_tokens: 1000,
        });
      const b = JSON.parse(init!.body as string);
      assert.equal(b.text.format.name, "room_zones");
      assert.equal(b.model, "gpt-6.1-sol");
      calls++;
      const response = {
        id: "room-response",
        status: "completed",
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  version: 1,
                  roomZones: [],
                  issues: [
                    { id: "pitch", message: "Pitched ceiling excluded." },
                  ],
                }),
              },
            ],
          },
        ],
        usage: {
          input_tokens: 1000,
          output_tokens: 100,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens_details: { reasoning_tokens: 20 },
        },
      };
      return new Response(
        `data: ${JSON.stringify({ type: "response.completed", response })}\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      );
    };
    await processPlan(job, "extract");
    assert.equal(calls, 1);
    assert.equal(
      (await db.query<any>("SELECT state FROM jobs WHERE id=$1", [job])).rows[0]
        .state,
      "needs_review",
    );
    const saved = (
      await db.query<any>(
        "SELECT model,parent_id FROM revisions WHERE job_id=$1",
        [job],
      )
    ).rows[0];
    assert.equal(saved.parent_id, revision);
    assert.deepEqual(saved.model.walls, model.walls);
    assert.deepEqual(saved.model.roofs, model.roofs);
    assert.equal(
      (
        await db.query<any>("SELECT head_id FROM projects WHERE id=$1", [
          project,
        ])
      ).rows[0].head_id,
      revision,
    );
    await processPlan(job, "extract");
    assert.equal(calls, 1);
    assert.equal(
      (await db.query("SELECT id FROM revisions WHERE job_id=$1", [job])).rows
        .length,
      1,
    );
  } finally {
    globalThis.fetch = oldFetch;
    g.fraaimeDb = oldDb;
    process.chdir(cwd);
    for (const k of keys) {
      if (env[k] === undefined) delete process.env[k];
      else process.env[k] = env[k];
    }
    await db.close!();
    await rm(folder, { recursive: true, force: true });
  }
});
