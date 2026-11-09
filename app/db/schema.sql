CREATE TABLE IF NOT EXISTS invitations (email TEXT PRIMARY KEY, role TEXT NOT NULL CHECK(role IN ('admin','reviewer','customer')), created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_email TEXT NOT NULL, head_id TEXT, created_at TEXT NOT NULL, deleted_at TEXT);
CREATE TABLE IF NOT EXISTS memberships (project_id TEXT NOT NULL REFERENCES projects(id), email TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('reviewer','customer')), PRIMARY KEY(project_id,email));
CREATE TABLE IF NOT EXISTS plans (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), filename TEXT NOT NULL, storage_key TEXT NOT NULL, size_bytes BIGINT NOT NULL, sha256 TEXT, manifest JSONB, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), plan_id TEXT NOT NULL REFERENCES plans(id), state TEXT NOT NULL, phase TEXT NOT NULL, run_id TEXT, pages JSONB NOT NULL DEFAULT '[]', completed_pages JSONB NOT NULL DEFAULT '[]', error TEXT, budget_usd NUMERIC NOT NULL, base_head TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS revisions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), parent_id TEXT, job_id TEXT REFERENCES jobs(id), kind TEXT NOT NULL, model JSONB NOT NULL, reviewed BOOLEAN NOT NULL DEFAULT FALSE, author TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ai_calls (id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id), page INTEGER NOT NULL, state TEXT NOT NULL, reserved_usd NUMERIC NOT NULL, cost_usd NUMERIC, input_tokens INTEGER, output_tokens INTEGER, model TEXT NOT NULL, result JSONB, response_id TEXT, error TEXT, created_at TEXT NOT NULL, UNIQUE(job_id,page));
CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY, project_id TEXT, actor TEXT NOT NULL, action TEXT NOT NULL, detail JSONB NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS spend_lock (id INTEGER PRIMARY KEY);
INSERT INTO spend_lock(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE INDEX IF NOT EXISTS jobs_project ON jobs(project_id);
CREATE INDEX IF NOT EXISTS revisions_project ON revisions(project_id);
CREATE INDEX IF NOT EXISTS plans_project ON plans(project_id);

ALTER TABLE revisions DROP CONSTRAINT IF EXISTS revisions_job_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS revisions_job_kind ON revisions(job_id,kind);
CREATE TABLE IF NOT EXISTS page_artifacts (plan_id TEXT NOT NULL REFERENCES plans(id), page INTEGER NOT NULL, data JSONB NOT NULL, PRIMARY KEY(plan_id,page));
