import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { localMode } from "./config";
import { HttpError } from "./access";
const safe = (key: string) => {
  if (!/^plans\/[a-f0-9-]+\/source\.pdf$/.test(key))
    throw new HttpError(400, "Invalid storage key");
  return path.join(".local/files", key);
};
export async function writeLocal(key: string, bytes: Uint8Array) {
  if (!localMode()) throw new HttpError(403, "Local uploads disabled");
  const file = safe(key);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes, { flag: "wx" });
}
export async function readSource(key: string): Promise<Response> {
  if (localMode())
    return new Response(new Uint8Array(await readFile(safe(key))), {
      headers: {
        "Content-Type": "application/pdf",
        "Cache-Control": "private, no-store",
      },
    });
  const { get } = await import("@vercel/blob");
  const blob = await get(key, { access: "private", useCache: false });
  if (!blob || !blob.stream) throw new HttpError(404, "Source file missing");
  return new Response(blob.stream, {
    headers: {
      "Content-Type": "application/pdf",
      "Cache-Control": "private, no-store",
    },
  });
}
export async function deleteSource(key: string) {
  if (localMode()) await rm(safe(key), { force: true });
  else {
    const { del } = await import("@vercel/blob");
    await del(key);
  }
}
export async function writeArtifact(key: string, data: unknown) {
  if (!/^artifacts\/[a-f0-9-]+\/page-\d+\.json$/.test(key))
    throw new Error("Invalid artifact key");
  const text = JSON.stringify(data);
  if (localMode()) {
    const file = path.join(".local/files", key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text);
  } else {
    const { put } = await import("@vercel/blob");
    await put(key, text, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });
  }
}
export async function readArtifact(key: string) {
  if (!/^artifacts\/[a-f0-9-]+\/page-\d+\.json$/.test(key))
    throw new Error("Invalid artifact key");
  if (localMode())
    return JSON.parse(await readFile(path.join(".local/files", key), "utf8"));
  const { get } = await import("@vercel/blob");
  const blob = await get(key, { access: "private", useCache: false });
  if (!blob?.stream) throw new Error("Artifact missing");
  return new Response(blob.stream).json();
}
export async function deleteArtifacts(planId: string) {
  if (!/^[a-f0-9-]+$/.test(planId)) throw new Error("Invalid plan ID");
  if (localMode()) {
    await rm(path.join(".local/files/artifacts", planId), {
      recursive: true,
      force: true,
    });
    return;
  }
  const { list, del } = await import("@vercel/blob");
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: `artifacts/${planId}/`, cursor });
    if (page.blobs.length) await del(page.blobs.map((b) => b.url));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
}
