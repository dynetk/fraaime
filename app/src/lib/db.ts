import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { localMode, required } from "./config";
export interface Queryable {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}
export interface Database extends Queryable {
  close?: () => Promise<void>;
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
}
const shared = globalThis as typeof globalThis & {
  fraaimeDb?: Promise<Database>;
};
export async function openLocal(dataDir?: string): Promise<Database> {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite(dataDir);
  await db.waitReady;
  const adapter: Database = {
    close: () => db.close(),
    query: (q, p) => db.query(q, p),
    transaction: (fn) =>
      db.transaction((tx) => fn({ query: (q, p) => tx.query(q, p) })),
  };
  await db.exec(
    await readFile(path.join(process.cwd(), "db/schema.sql"), "utf8"),
  );
  return adapter;
}
export function database(): Promise<Database> {
  if (!shared.fraaimeDb)
    shared.fraaimeDb = (async () => {
      if (localMode()) {
        await mkdir(".local", { recursive: true });
        return openLocal(path.resolve(".local/database"));
      }
      const { Pool } = await import("pg");
      const pool = new Pool({
        connectionString: required("DATABASE_URL"),
        max: 5,
      });
      const adapter: Database = {
        query: (q, p) => pool.query(q, p),
        transaction: async (fn) => {
          const c = await pool.connect();
          try {
            await c.query("BEGIN");
            const result = await fn(c);
            await c.query("COMMIT");
            return result;
          } catch (e) {
            await c.query("ROLLBACK");
            throw e;
          } finally {
            c.release();
          }
        },
      };
      return adapter;
    })();
  return shared.fraaimeDb;
}
export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export async function audit(
  tx: Queryable,
  actor: string,
  action: string,
  projectId: string | null,
  detail: unknown = {},
) {
  await tx.query(
    "INSERT INTO audit(id,project_id,actor,action,detail,created_at) VALUES($1,$2,$3,$4,$5,$6)",
    [uid(), projectId, actor, action, JSON.stringify(detail), now()],
  );
}
