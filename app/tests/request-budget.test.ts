import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {
  countRequestReservation,
  budgetLimitMessage,
} from "../src/lib/request-budget";
import { processingErrorMessage } from "../src/lib/processing-error";
import { buildShellRequest } from "../src/lib/shell-provider";
import type { PageEvidence } from "../src/lib/worker";

test("preflight counts the exact multi-sheet request and reserves output without starting generation", async () => {
  const oldFetch = globalThis.fetch,
    oldKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "synthetic";
  const pages = Array.from({ length: 18 }, (_, i) => ({
    page: i + 1,
    width: 100,
    height: 100,
    evidenceVersion: 2,
    coordinateSpace: "displayed-crop-points",
    rotation: 0,
    text: "Synthetic",
    lines: [],
    images: Array.from({ length: 5 }, () => ({
      region: [0, 0, 1, 1],
      base64: "test",
    })),
  })) as PageEvidence[];
  const request = buildShellRequest(pages, "synthetic", "Test");
  let inputTokens = 193881;
  globalThis.fetch = async (url, init) => {
    assert(String(url).endsWith("/responses/input_tokens"));
    const body = JSON.parse(init!.body as string);
    assert.equal(body.model, request.model);
    assert.deepEqual(body.input, request.input);
    assert.deepEqual(body.text, request.text);
    assert.deepEqual(body.reasoning, { effort: "medium" });
    assert.equal(body.instructions, request.instructions);
    return new Response(JSON.stringify({ input_tokens: inputTokens }), {
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const estimate = await countRequestReservation(request);
    assert.equal(estimate.reservedUsd, 0.668588);
    assert.equal(estimate.maxOutputTokens, 24000);
    inputTokens = 300000;
    assert.equal(
      (await countRequestReservation(request)).reservedUsd,
      1.684096,
    ); // 331024 reserved tokens, long-context surcharge
    inputTokens = NaN;
    await assert.rejects(() => countRequestReservation(request), /invalid/);
    globalThis.fetch = async () => {
      throw Error("offline");
    };
    await assert.rejects(
      () => countRequestReservation(request),
      /No generation was started/,
    );
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
  }
});
test("job and monthly budgets remain enforced with separate useful errors", () => {
  const b = {
    reserved: 0.67,
    jobSpent: 0,
    jobBudget: 10,
    monthlySpent: 1.12,
    monthlyBudget: 100,
  };
  assert.equal(budgetLimitMessage(b), null);
  assert.match(
    budgetLimitMessage({ ...b, jobSpent: 9.5 })!,
    /job has \$0.50 remaining of its \$10.00/,
  );
  assert.match(
    budgetLimitMessage({ ...b, monthlySpent: 99.5 })!,
    /account has \$0.50 remaining/,
  );
  assert.match(budgetLimitMessage({ ...b, reserved: NaN })!, /Invalid/);
});
test("workflow errors retain messages across VM boundaries and serialized causes", () => {
  const foreign = vm.runInNewContext('new Error("Budget reservation blocked")');
  assert.equal(foreign instanceof Error, false);
  assert.equal(processingErrorMessage(foreign), "Budget reservation blocked");
  assert.equal(
    processingErrorMessage({ message: "Remote failure" }),
    "Remote failure",
  );
  assert.equal(processingErrorMessage("Cancelled"), "Cancelled");
  assert.match(processingErrorMessage(null), /Processing failed/);
});
