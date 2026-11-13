import test from "node:test";
import assert from "node:assert/strict";
import { GET, POST } from "../src/app/api/[...path]/route";
import { openLocal, uid } from "../src/lib/db";
import { exampleModel } from "../src/lib/model";
import { buildEstimate } from "../src/lib/estimate";

test("model API opens newest revision, refreshes quantities and retains explicit selection and save locking", async () => {
  const db = await openLocal(),
    g = globalThis as any,
    oldDb = g.fraaimeDb;
  const oldLocal = process.env.FRAAIME_LOCAL_MODE,
    oldOrigin = process.env.APP_ORIGIN;
  g.fraaimeDb = Promise.resolve(db);
  process.env.FRAAIME_LOCAL_MODE = "1";
  process.env.APP_ORIGIN = "http://localhost:5190";
  const p = uid(),
    other = uid(),
    empty = uid(),
    head = uid(),
    candidate = uid();
  const model = exampleModel();
  model.panelQuantities = buildEstimate(model).wallPanels.map((q) => ({
    ...q,
    source: "old",
    studLinearFeet: 99999,
  }));
  const get = (suffix = "") =>
    GET(new Request(`http://localhost:5190/api/projects/${p}${suffix}`));
  try {
    for (const id of [p, other, empty])
      await db.query(
        "INSERT INTO projects(id,name,owner_email,created_at) VALUES($1,'Synthetic revision test','owner','2026-01-01')",
        [id],
      );
    const insert = async (
      id: string,
      project: string,
      kind: string,
      date: string,
    ) =>
      db.query(
        "INSERT INTO revisions(id,project_id,kind,model,author,created_at) VALUES($1,$2,$3,$4,'test',$5)",
        [id, project, kind, JSON.stringify(model), date],
      );
    await insert(head, p, "human", "2026-01-01");
    await insert(candidate, p, "ai", "2026-01-02");
    const foreign = uid();
    await insert(foreign, other, "ai", "2026-01-03");
    await db.query("UPDATE projects SET head_id=$1 WHERE id=$2", [head, p]);
    const latest = await (await get("/model")).json();
    assert.equal(latest.id, candidate);
    assert.deepEqual(
      latest.model.panelQuantities,
      buildEstimate(model).wallPanels,
    );
    assert.equal(
      (await (await get("/model?revision=" + head)).json()).id,
      head,
    );
    assert.equal(await (await get("/model?revision=" + foreign)).json(), null);
    assert.equal(
      await (
        await GET(
          new Request(`http://localhost:5190/api/projects/${empty}/model`),
        )
      ).json(),
      null,
    );
    assert.equal(
      (await db.query("SELECT head_id FROM projects WHERE id=$1", [p])).rows[0]
        .head_id,
      head,
    );
    assert.deepEqual(
      (await db.query("SELECT model FROM revisions WHERE id=$1", [candidate]))
        .rows[0].model,
      model,
    );
    const partial = uid();
    await insert(partial, p, "ai_partial", "2026-01-04");
    assert.equal((await (await get("/model")).json()).id, partial);
    const tie = uid();
    await insert(tie, p, "ai", "2026-01-04");
    const expected = [partial, tie].sort().at(-1);
    assert.equal((await (await get("/model")).json()).id, expected);
    assert.equal((await (await get()).json()).revisions[0].id, expected);
    const post = () =>
      POST(
        new Request(`http://localhost:5190/api/projects/${p}/model`, {
          method: "POST",
          headers: {
            origin: "http://localhost:5190",
            "content-type": "application/json",
          },
          body: JSON.stringify({ baseId: head, model: latest.model }),
        }),
      );
    // Saving a viewed candidate still uses the saved head as concurrency token.
    const saved = await post();
    assert.equal(saved.status, 200);
    const savedId = (await saved.json()).id;
    assert.equal((await (await get("/model")).json()).id, savedId);
    assert.equal((await post()).status, 409);
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM revisions WHERE project_id=$1",
          [p],
        )
      ).rows[0].n,
      5,
    );
  } finally {
    g.fraaimeDb = oldDb;
    if (oldLocal === undefined) delete process.env.FRAAIME_LOCAL_MODE;
    else process.env.FRAAIME_LOCAL_MODE = oldLocal;
    if (oldOrigin === undefined) delete process.env.APP_ORIGIN;
    else process.env.APP_ORIGIN = oldOrigin;
    await db.close?.();
  }
});
