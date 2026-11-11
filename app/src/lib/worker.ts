import { required, limit } from "./config";
import { z } from "zod";
export const TitleOcrSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]),
  engine: z.literal("tesseract"),
  status: z.enum(["complete", "unreadable", "failed"]),
  text: z.string().max(24000),
  rotation: z.number().optional(),
  lines: z
    .array(
      z.object({
        text: z.string().max(250),
        confidence: z.number().min(0).max(100),
        region: z.array(z.number().min(0).max(1)).length(4),
      }),
    )
    .max(1200),
  attempts: z.number().int().nonnegative().optional(),
  timedOutAttempts: z.number().int().nonnegative().optional(),
  durationMs: z.number().nonnegative().optional(),
  error: z.string().max(500).optional(),
});
export type TitleOcr = z.infer<typeof TitleOcrSchema>;

export interface Sheet {
  page: number;
  width: number;
  height: number;
  rotation: number;
  text: string;
  kind: string;
  sheet: string;
  revision: string;
  scanned: boolean;
  ocr?: TitleOcr;
  review?: {
    decision: "include" | "exclude";
    reason: string;
    by: string;
    at: string;
  };
}
export interface Manifest {
  indexingVersion?: 1;
  indexingComplete?: boolean;
  sha256: string;
  pageCount: number;
  sheets: Sheet[];
  warnings: string[];
}
export interface PageEvidence {
  evidenceVersion?: number;
  coordinateSpace?: string;
  sourceRotation?: number;
  page: number;
  width: number;
  height: number;
  rotation: number;
  text: string;
  lines: number[][];
  images: { region: number[]; base64: string }[];
}
export async function worker<T>(
  endpoint: string,
  planId: string,
  page?: number,
): Promise<T> {
  const url = new URL(endpoint, required("PDF_WORKER_URL"));
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${required("PDF_WORKER_TOKEN")}`,
    },
    body: JSON.stringify({
      source_url: `${required("APP_ORIGIN")}/api/worker-source/${planId}`,
      page,
      max_pages: limit("MAX_PDF_PAGES", 150),
      max_bytes: limit("MAX_UPLOAD_MB", 120) * 1024 * 1024,
    }),
    signal: AbortSignal.timeout(endpoint === "/ocr" ? 350000 : 240000),
  });
  if (!response.ok) {
    const fallback = `PDF service ${endpoint} returned HTTP ${response.status}. Retry PDF inspection or contact support if it repeats.`;
    const body = await response.json().catch(() => ({ detail: fallback }));
    throw new Error(
      typeof body?.detail === "string" && body.detail
        ? body.detail.slice(0, 1000)
        : fallback,
    );
  }
  return response.json() as Promise<T>;
}

export async function pageEvidence(
  planId: string,
  page: number,
): Promise<PageEvidence> {
  const { database } = await import("./db");
  const { readArtifact, writeArtifact } = await import("./storage");
  const db = await database();
  const old = await db.query<{ data: { storageKey: string } }>(
    "SELECT data FROM page_artifacts WHERE plan_id=$1 AND page=$2",
    [planId, page],
  );
  if (old.rows[0]) {
    const cached = (await readArtifact(
      old.rows[0].data.storageKey,
    )) as PageEvidence;
    if (cached.evidenceVersion === 2) return cached;
  }
  const data = await worker<PageEvidence>("/page", planId, page),
    key = `artifacts/${planId}/page-${page}-v2.json`;
  // Recheck deletion before writing an artifact after an expensive render.
  await db.transaction(async (tx) => {
    const p = await tx.query(
      "SELECT p.id FROM projects p JOIN plans pl ON pl.project_id=p.id WHERE pl.id=$1 AND p.deleted_at IS NULL FOR UPDATE OF p",
      [planId],
    );
    if (!p.rows.length) throw new Error("Project deleted");
    await writeArtifact(key, data);
    await tx.query(
      "INSERT INTO page_artifacts(plan_id,page,data) VALUES($1,$2,$3) ON CONFLICT(plan_id,page) DO UPDATE SET data=EXCLUDED.data",
      [planId, page, JSON.stringify({ storageKey: key })],
    );
  });
  return data;
}
