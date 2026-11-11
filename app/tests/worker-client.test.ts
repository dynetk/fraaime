import test from "node:test";
import assert from "node:assert/strict";
import { worker } from "../src/lib/worker";

test("PDF worker errors preserve useful status without exposing HTML or secrets", async () => {
  const keys = ["PDF_WORKER_URL", "PDF_WORKER_TOKEN", "APP_ORIGIN"];
  const original = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const fetch = globalThis.fetch;
  Object.assign(process.env, {
    PDF_WORKER_URL: "https://worker.example.com",
    PDF_WORKER_TOKEN: "synthetic",
    APP_ORIGIN: "https://app.example.com",
  });
  try {
    globalThis.fetch = async () =>
      new Response("<html>private diagnostic</html>", { status: 503 });
    await assert.rejects(
      () => worker("/inspect", "synthetic"),
      (error) => {
        assert.match(String(error), /PDF service \/inspect returned HTTP 503/);
        assert.doesNotMatch(String(error), /private diagnostic|<html>/);
        return true;
      },
    );
    globalThis.fetch = async () =>
      Response.json({ detail: "Password-protected PDF" }, { status: 422 });
    await assert.rejects(
      () => worker("/inspect", "synthetic"),
      /Password-protected PDF/,
    );
    globalThis.fetch = async () => Response.json(null, { status: 500 });
    await assert.rejects(
      () => worker("/page", "synthetic", 1),
      /PDF service \/page returned HTTP 500/,
    );
  } finally {
    globalThis.fetch = fetch;
    for (const k of keys) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  }
});
