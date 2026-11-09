/** Trusted local demo importer. Never invoked on uploaded user files. */
import { readFile, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
import { blankModel, ModelSchema, validateModel } from "../src/lib/model";
import { database, uid, now } from "../src/lib/db";
import { saveRevision } from "../src/lib/revisions";
import { localMode } from "../src/lib/config";
const folder = process.argv[2],
  name = process.argv[3] || "Imported reference",
  pdf = process.argv[4],
  profilePath = process.argv[5];
const profile = profilePath
  ? JSON.parse(await readFile(profilePath, "utf8"))
  : {};
if (!folder || !localMode())
  throw new Error(
    'Local only. Usage: FRAAIME_LOCAL_MODE=1 npm run import:legacy -- /absolute/demo-folder "Project name" [/absolute/source.pdf]',
  );
const moduleText = await readFile(path.join(folder, "dist/data.js"), "utf8");
const data = await import(
  "data:text/javascript;base64," + Buffer.from(moduleText).toString("base64")
);
const source = await readFile(path.join(folder, "dist/model.js"), "utf8");
let walls = data.walls;
if (!walls) {
  const match = source.match(/const walls=(\{.*?\});/s);
  if (!match) throw new Error("No legacy wall data found");
  walls = vm.runInNewContext("(" + match[1] + ")", Object.create(null), {
    timeout: 1000,
  });
}
const m = blankModel(name),
  projectId = uid(),
  planId = uid(),
  owner = process.env.FRAAIME_LOCAL_EMAIL || "developer@localhost";
const wallLevels = Array.isArray(Object.values(walls)[0])
  ? { main: walls }
  : walls;
const sourceEvidence = (
  page = 1,
  note = "Illustrative legacy trace; verify against source plan",
) =>
  pdf ? [{ planId, page, sheet: "Legacy reference", region: null, note }] : [];
for (const [levelId, items] of Object.entries(wallLevels) as [
  string,
  Record<string, number[]>,
][]) {
  const defaultHeight =
    profile.levels?.[levelId]?.height ??
    (levelId === "upper"
      ? 9 + 10 / 12
      : levelId === "main" && wallLevels.upper
        ? 10
        : 9);
  const elevation =
    levelId === "main" && wallLevels.lower
      ? 10 + 4 / 12
      : levelId === "upper"
        ? 11 + 2 / 12
        : 0;
  let outline =
    profile.levels?.[levelId]?.outline ||
    data.floorOutlines?.[levelId] ||
    data.footprint;
  if (!outline) {
    const coords = Object.values(items),
      xs = coords.flatMap((c) => [c[0], c[2]]),
      zs = coords.flatMap((c) => [c[1], c[3]]);
    outline = [
      [Math.min(...xs), Math.min(...zs)],
      [Math.max(...xs), Math.min(...zs)],
      [Math.max(...xs), Math.max(...zs)],
      [Math.min(...xs), Math.max(...zs)],
    ];
    m.issues.push({
      id: "outline-" + levelId,
      elementId: levelId,
      severity: "warning",
      message:
        "Imported floor is a bounding rectangle. Trace its actual outline before relying on area or shape.",
      resolved: false,
      resolution: "",
    });
  }
  const holes =
    profile.levels?.[levelId]?.voids ??
    (data.courtyard ? [data.courtyard] : []);
  m.levels.push({
    id: levelId,
    label: levelId + " floor",
    elevation: elevation * 304.8,
    height: defaultHeight * 304.8,
    outline: outline.map((p: number[]) => [p[0] * 304.8, p[1] * 304.8]),
    voids: holes.map((h: number[][]) =>
      h.map((p) => [p[0] * 304.8, p[1] * 304.8]),
    ),
    evidence: sourceEvidence(),
    inferred: true,
  });
  for (const [key, c] of Object.entries(items))
    m.walls.push({
      id: `${levelId}-${key}`,
      label: key,
      levelId,
      start: [c[0] * 304.8, c[1] * 304.8],
      end: [c[2] * 304.8, c[3] * 304.8],
      height: defaultHeight * 304.8,
      thickness: 152.4,
      evidence: sourceEvidence(),
      inferred: true,
    });
}
for (const o of data.openings) {
  if (o.kind === "skylight") {
    m.issues.push({
      id: "unsupported-" + o.id,
      elementId: null,
      severity: "warning",
      message: `Legacy skylight ${o.id} is not represented as a wall opening. Add its roof component manually.`,
      resolved: false,
      resolution: "",
    });
    continue;
  }
  const wallId =
    o.wall && m.walls.some((w) => w.id === `${o.level}-${o.wall}`)
      ? `${o.level}-${o.wall}`
      : null;
  const width = o.width * 25.4,
    height = o.height * 25.4;
  if (!(width > 0 && height > 0)) continue;
  const sill =
    typeof o.modelSill === "number"
      ? o.modelSill * 304.8
      : o.kind === "window"
        ? Math.max(0, ((o.head ?? o.height) - o.height) * 25.4)
        : 0;
  m.openings.push({
    id: o.id,
    label: o.room || String(o.tag),
    tag: String(o.tag),
    kind: o.kind === "window" ? "window" : "door",
    levelId: m.levels.some((l) => l.id === o.level) ? o.level : null,
    wallId,
    offset: Math.max(0, o.t * 304.8 - width / 2),
    width,
    height,
    sill,
    operation: o.operation || "",
    evidence: sourceEvidence(
      o.page,
      o.note || "Legacy schedule dimensions; placement is illustrative",
    ),
    inferred: true,
  });
}
for (const roof of profile.roofs ?? [])
  m.roofs.push({
    ...roof,
    vertices: roof.vertices.map((v: number[]) => v.map((n) => n * 304.8)),
    evidence: sourceEvidence(roof.page ?? 1),
    inferred: true,
  });
for (const wall of m.walls) {
  const h = profile.wallHeights?.[wall.id];
  if (h) wall.height = h * 304.8;
}
m.issues.push({
  id: "legacy-import",
  elementId: null,
  severity: "warning",
  message:
    "Imported reference demo, not AI output. Story heights, slab outlines and placements require verification. Project-specific roof/furniture code is not silently executed; roof geometry must be supplied as model data.",
  resolved: false,
  resolution: "",
});
m.issues.push(...validateModel(m));
ModelSchema.parse(m);
const db = await database();
await db.query(
  "INSERT INTO projects(id,name,owner_email,created_at) VALUES($1,$2,$3,$4)",
  [projectId, name, owner, now()],
);
if (pdf) {
  const key = `plans/${planId}/source.pdf`;
  await mkdir(path.join(".local/files", path.dirname(key)), {
    recursive: true,
  });
  await copyFile(pdf, path.join(".local/files", key));
  const { stat } = await import("node:fs/promises");
  await db.query(
    "INSERT INTO plans(id,project_id,filename,storage_key,size_bytes,created_at) VALUES($1,$2,$3,$4,$5,$6)",
    [planId, projectId, path.basename(pdf), key, (await stat(pdf)).size, now()],
  );
}
await saveRevision(db, projectId, null, m, owner);
console.log(
  JSON.stringify({
    projectId,
    levels: m.levels.length,
    walls: m.walls.length,
    openings: m.openings.length,
    issues: m.issues.length,
  }),
);
process.exit(0);
