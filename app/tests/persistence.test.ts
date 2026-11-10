import { MOCK_ESTIMATE_SETTINGS } from "../src/lib/estimate-settings";
import { test } from "node:test";
import assert from "node:assert/strict";
import { openLocal, uid, now } from "../src/lib/db";
import { exampleModel } from "../src/lib/model";
import { saveRevision, saveCandidate } from "../src/lib/revisions";
import { permitted } from "../src/lib/access";
test("project roles deny cross-project reads and customer review", () => {
  const a = { email: "a@example.com", role: "customer" as const };
  assert.equal(permitted(a, "b@example.com", null, "read"), false);
  assert.equal(permitted(a, a.email, null, "edit"), true);
  assert.equal(permitted(a, a.email, null, "review"), false);
  assert.equal(
    permitted(
      { ...a, role: "reviewer" },
      "b@example.com",
      "reviewer",
      "review",
    ),
    true,
  );
});
test("revision transactions prevent stale overwrites and keep reruns separate", async () => {
  const db = await openLocal(),
    project = uid(),
    plan = uid(),
    job = uid(),
    email = "review@example.com";
  await db.query(
    "INSERT INTO projects(id,name,owner_email,created_at) VALUES($1,$2,$3,$4)",
    [project, "Test", email, now()],
  );
  const first = await saveRevision(db, project, null, exampleModel(), email);
  await assert.rejects(
    () => saveRevision(db, project, null, exampleModel(), email),
    /Another revision/,
  );
  await db.query(
    "INSERT INTO plans(id,project_id,filename,storage_key,size_bytes,created_at) VALUES($1,$2,$3,$4,1,$5)",
    [plan, project, "test.pdf", "plans/test/source.pdf", now()],
  );
  await db.query(
    "INSERT INTO jobs(id,project_id,plan_id,state,phase,budget_usd,created_at,updated_at) VALUES($1,$2,$3,$4,$5,10,$6,$6)",
    [job, project, plan, "extracting", "Test", now()],
  );
  const candidate = await saveCandidate(
    db,
    project,
    job,
    first,
    exampleModel(),
  );
  assert.equal(
    await saveCandidate(db, project, job, first, exampleModel()),
    candidate,
  );
  const p = await db.query<{ head_id: string }>(
    "SELECT head_id FROM projects WHERE id=$1",
    [project],
  );
  assert.equal(p.rows[0].head_id, first);
  const r = await db.query("SELECT id FROM revisions WHERE job_id=$1", [job]);
  assert.equal(r.rows.length, 1);
  await assert.rejects(
    () => saveRevision(db, project, first, exampleModel(), email, true),
    /Resolve issues/,
  );
  const clean = exampleModel();
  clean.issues = [];
  const reviewed = await saveRevision(db, project, first, clean, email, true);
  const saved = await db.query<{ model: unknown; reviewed: boolean }>(
    "SELECT model,reviewed FROM revisions WHERE id=$1",
    [reviewed],
  );
  assert.deepEqual(saved.rows[0].model, {
    ...clean,
    estimate: MOCK_ESTIMATE_SETTINGS,
  });
  assert.equal(saved.rows[0].reviewed, true);
  await db.close?.();
});

test("partial results and final candidates coexist; cancelled jobs cannot publish", async () => {
  const db = await openLocal(),
    p = uid(),
    plan = uid(),
    j = uid();
  await db.query(
    "INSERT INTO projects(id,name,owner_email,created_at) VALUES($1,$2,$3,$4)",
    [p, "Partial", "a", now()],
  );
  await db.query(
    "INSERT INTO plans(id,project_id,filename,storage_key,size_bytes,created_at) VALUES($1,$2,$3,$4,1,$5)",
    [plan, p, "a.pdf", "key", now()],
  );
  await db.query(
    "INSERT INTO jobs(id,project_id,plan_id,state,phase,budget_usd,created_at,updated_at) VALUES($1,$2,$3,$4,$5,10,$6,$6)",
    [j, p, plan, "extracting", "run", now()],
  );
  const partial = await saveCandidate(db, p, j, null, exampleModel(), true),
    final = await saveCandidate(db, p, j, null, exampleModel());
  assert.notEqual(partial, final);
  assert.equal(
    (await db.query("SELECT id FROM revisions WHERE job_id=$1", [j])).rows
      .length,
    2,
  );
  await db.query("UPDATE jobs SET state='cancelled' WHERE id=$1", [j]);
  await db.query("DELETE FROM revisions WHERE job_id=$1", [j]);
  await assert.rejects(
    () => saveCandidate(db, p, j, null, exampleModel()),
    /cancelled/,
  );
  await db.close?.();
});
