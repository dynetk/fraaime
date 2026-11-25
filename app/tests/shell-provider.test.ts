import { test } from "node:test";
import assert from "node:assert/strict";
import { extractShell, SHELL_TIMEOUT_MS } from "../src/lib/shell-provider";
import { ExtractionFailure } from "../src/lib/extraction";
import { assembleStoredResults } from "../src/lib/shell-results";
import { blankModel } from "../src/lib/model";
import type { PageEvidence } from "../src/lib/worker";
const pages = [1, 2].map((page) => ({
  page,
  width: 100,
  height: 100,
  evidenceVersion: 2,
  coordinateSpace: "displayed-crop-points",
  rotation: 0,
  text: "Synthetic",
  lines: [],
  images: [{ region: [0, 0, 1, 1], base64: "synthetic" }],
})) as PageEvidence[];
const draft = {
  version: 1 as const,
  datum: "Test",
  sheets: [],
  levels: [],
  openings: [],
  roofs: [],
  scheduleEntries: [],
  issues: [],
};
test("joint request sends all sheets to Sol medium and retains billable usage on invalid responses", async () => {
  const fetchBefore = globalThis.fetch,
    key = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "sk-synthetic";
  let valid = true,
    calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    const b = JSON.parse(init!.body as string);
    assert.equal(b.model, "gpt-6.1-sol");
    assert.equal(b.reasoning.effort, "medium");
    assert.equal(b.store, false);
    assert.equal(b.stream, true);
    assert.equal(SHELL_TIMEOUT_MS, 720_000);
    assert.equal(
      b.input[0].content.filter((x: any) => x.type === "input_image").length,
      2,
    );
    assert.match(b.input[0].content[0].text, /'?page"?:1/);
    const response = {
      id: "response-test",
      object: "response",
      created_at: 0,
      status: "completed",
      output: [
        {
          id: "message-test",
          type: "message",
          role: "assistant",
          status: "completed",
          content: [
            {
              type: "output_text",
              text: valid ? JSON.stringify(draft) : "{}",
              annotations: [],
            },
          ],
        },
      ],
      usage: {
        input_tokens: 1000,
        output_tokens: 200,
        input_tokens_details: { cached_tokens: 500 },
        output_tokens_details: { reasoning_tokens: 100 },
      },
    };
    return new Response(
      `data: ${JSON.stringify({ type: "response.completed", response })}\n\n`,
      { headers: { "content-type": "text/event-stream" } },
    );
  };
  try {
    const result = await extractShell(pages, "test", "Sample");
    assert.equal(result.inputTokens, 1000);
    assert.equal(result.cachedInputTokens, 500);
    assert.equal(result.model.levels.length, 0);
    valid = false;
    await assert.rejects(
      () => extractShell(pages, "test", "Sample"),
      (e) => {
        assert(e instanceof ExtractionFailure);
        assert.equal(e.details.usage?.outputTokens, 200);
        assert.equal(e.details.responseId, "response-test");
        return true;
      },
    );
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = fetchBefore;
    if (key === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = key;
  }
});
test("shell interruption retains response identity and unknown usage without a duplicate request", async () => {
  const fetchBefore = globalThis.fetch,
    key = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "sk-synthetic";
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(
      `data: ${JSON.stringify({ type: "response.created", response: { id: "resp-interrupted", status: "in_progress" } })}\n\n`,
      { headers: { "content-type": "text/event-stream" } },
    );
  };
  try {
    await assert.rejects(
      () => extractShell(pages, "test", "Sample"),
      (e) => {
        assert(e instanceof ExtractionFailure);
        assert.equal(e.details.responseId, "resp-interrupted");
        assert.equal(e.details.usage, null);
        assert.equal(e.details.reason, "missing_terminal_event");
        return true;
      },
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = fetchBefore;
    if (key === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = key;
  }
});
test("shell deadline bounds the response body and never retries an aborted stream", async () => {
  const fetchBefore = globalThis.fetch,
    key = process.env.OPENAI_API_KEY;
  const timeoutBefore = AbortSignal.timeout;
  const controller = new AbortController();
  let calls = 0;
  process.env.OPENAI_API_KEY = "sk-synthetic";
  AbortSignal.timeout = (ms) => {
    assert.equal(ms, 720_000);
    return controller.signal;
  };
  globalThis.fetch = async (_url, init) => {
    calls++;
    return new Response(
      new ReadableStream({
        start(stream) {
          stream.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({ type: "response.created", response: { id: "resp-deadline", status: "in_progress" } })}\n\n`,
            ),
          );
          init!.signal!.addEventListener(
            "abort",
            () => stream.error(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
          setTimeout(() => controller.abort(), 10);
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );
  };
  try {
    await assert.rejects(
      () => extractShell(pages, "test", "Sample"),
      (e) => {
        assert(e instanceof ExtractionFailure);
        assert.equal(e.details.reason, "request_timeout");
        assert.equal(e.details.responseId, "resp-deadline");
        assert.equal(e.details.usage, null);
        return true;
      },
    );
    assert.equal(calls, 1);
  } finally {
    AbortSignal.timeout = timeoutBefore;
    globalThis.fetch = fetchBefore;
    if (key === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = key;
  }
});
test("joint checkpoint assembly preserves cross-sheet evidence and excludes mixed legacy results", () => {
  const model = blankModel("Sample");
  model.levels = [
    {
      id: "L1",
      label: "Test",
      elevation: 0,
      height: 3000,
      outline: [
        [0, 0],
        [10000, 0],
        [10000, 10000],
        [0, 10000],
      ],
      voids: [],
      inferred: true,
      evidence: [1, 2].map((page) => ({
        planId: "test",
        page,
        sheet: "Test",
        region: [0, 0, 1, 1],
        note: "Source",
      })),
    },
  ];
  const joint = {
    page: 0,
    result: {
      kind: "project-shell" as const,
      model,
      draft,
      sourcePages: [1, 2],
    },
  };
  const restored = assembleStoredResults([joint], "Sample", "test", [1, 2, 3]);
  assert.deepEqual(
    restored.levels[0].evidence.map((e) => e.page),
    [1, 2],
  );
  assert(restored.issues.some((i) => i.id === "shell-unread-sheets"));
  assert.throws(() =>
    assembleStoredResults([joint, joint], "Sample", "test", [1, 2]),
  );
});
