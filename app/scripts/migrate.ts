import { readFile } from "node:fs/promises";
import { database } from "../src/lib/db";
import { localMode } from "../src/lib/config";
const db = await database();
// Local initialization already applies the schema through PGlite's exec API.
if (!localMode()) await db.query(await readFile("db/schema.sql", "utf8"));
await db.close?.();
console.log("Database schema ready.");
process.exit(0);
