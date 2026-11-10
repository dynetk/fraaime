import test from "node:test";
import assert from "node:assert/strict";
import { openLocal, uid, now } from "../src/lib/db";
import { POST } from "../src/app/api/[...path]/route";
test("API blocks unreviewed extraction before creating jobs or calling AI", async () => {
  const db = await openLocal(),
    g = globalThis as any,
    old = g.fraaimeDb;
  const oldLocal = process.env.FRAAIME_LOCAL_MODE,
    oldOrigin = process.env.APP_ORIGIN;
  g.fraaimeDb = Promise.resolve(db);
  process.env.FRAAIME_LOCAL_MODE = "1";
  process.env.APP_ORIGIN = "http://localhost:5190";
  const project = uid(),
    plan = uid(),
    job = uid();
  try {
    await db.query(
      "INSERT INTO projects(id,name,owner_email,created_at) VALUES($1,'Synthetic review','owner',$2)",
      [project, now()],
    );
    await db.query(
      "INSERT INTO plans(id,project_id,filename,storage_key,size_bytes,manifest,created_at) VALUES($1,$2,'synthetic.pdf','synthetic',1,$3,$4)",
      [
        plan,
        project,
        JSON.stringify({
          pageCount: 2,
          sha256: "synthetic",
          indexingComplete: true,
          sheets: [
            { page: 1, text: "FLOOR PLAN", kind: "floor-plan" },
            { page: 2, text: "Unknown", kind: "unclassified" },
          ],
          warnings: [],
        }),
        now(),
      ],
    );
    await db.query(
      "INSERT INTO jobs(id,project_id,plan_id,state,phase,budget_usd,created_at,updated_at) VALUES($1,$2,$3,'needs_review','Ready',10,$4,$4)",
      [job, project, plan, now()],
    );
    const post = (path: string, body: unknown) =>
      POST(
        new Request(`http://localhost:5190/api/${path}`, {
          method: "POST",
          headers: {
            origin: "http://localhost:5190",
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        }),
      );
    const blocked = await post(`jobs/${job}/new`, { pages: [1] });
    assert.equal(blocked.status, 409);
    assert.match(JSON.stringify(await blocked.json()), /Review 1 unclassified/);
    assert.equal((await db.query("SELECT id FROM jobs")).rows.length, 1);
    const saved = await post(`plans/${plan}/review`, {
      page: 2,
      decision: "exclude",
      reason: "Reviewed notes sheet",
    });
    assert.equal(saved.status, 200);
    assert.equal(
      (
        await db.query<{ manifest: any }>(
          "SELECT manifest FROM plans WHERE id=$1",
          [plan],
        )
      ).rows[0].manifest.sheets[1].review.decision,
      "exclude",
    );
    assert.equal((await db.query("SELECT id FROM ai_calls")).rows.length, 0);
  } finally {
    g.fraaimeDb = old;
    if (oldLocal === undefined) delete process.env.FRAAIME_LOCAL_MODE;
    else process.env.FRAAIME_LOCAL_MODE = oldLocal;
    if (oldOrigin === undefined) delete process.env.APP_ORIGIN;
    else process.env.APP_ORIGIN = oldOrigin;
    await db.close?.();
  }
});
