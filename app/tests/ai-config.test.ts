import { test } from "node:test";
import assert from "node:assert/strict";
import { aiSettings, SOL_PRICING, tokenCost } from "../src/lib/ai-config";
import { openAIProvider, ExtractionFailure } from "../src/lib/extraction";
import { exampleModel } from "../src/lib/model";

test("Sol uses medium reasoning and GPT-4.1 baseline omits unsupported reasoning", () => {
  assert.deepEqual(aiSettings({}).reasoning, { effort: "medium" });
  assert.equal(aiSettings({}).model, "gpt-6.1-sol");
  assert.equal(aiSettings({ OPENAI_MODEL: "gpt-4.1" }).reasoning, undefined);
  assert.throws(() => aiSettings({ OPENAI_REASONING_EFFORT: "none" }));
  assert.throws(() => aiSettings({ OPENAI_MODEL: "unverified-model" }));
});
test("spend counts total output once and includes Sol long-context surcharges", () => {
  assert.equal(tokenCost(100000, 20000, SOL_PRICING, "gpt-6.1-sol"), 0.4);
  assert.equal(tokenCost(300000, 20000, SOL_PRICING, "gpt-6.1-sol"), 1.5);
  assert.equal(
    tokenCost(300000, 20000, { input: 2, output: 8 }, "gpt-4.1"),
    0.76,
  );
});
test("actual SDK request preserves images/schema and requests standard Sol with medium reasoning", async () => {
  const before = { ...process.env },
    originalFetch = globalThis.fetch;
  let body: Record<string, any> = {};
  process.env.OPENAI_API_KEY = "sk-test-only";
  process.env.OPENAI_MODEL = "gpt-6.1-sol";
  process.env.OPENAI_REASONING_EFFORT = "medium";
  globalThis.fetch = async (_input, init) => {
    body = JSON.parse(init!.body as string);
    return new Response(
      JSON.stringify({
        id: "resp-test",
        object: "response",
        created_at: 0,
        status: "completed",
        model: "gpt-6.1-sol",
        output: [
          {
            type: "message",
            id: "msg-test",
            role: "assistant",
            status: "completed",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  kind: "floor-plan",
                  sheet: "TEST",
                  model: { ...exampleModel(), scheduleEntries: [] },
                }),
                annotations: [],
              },
            ],
          },
        ],
        usage: {
          input_tokens: 1000,
          output_tokens: 500,
          input_tokens_details: { cached_tokens: 100 },
          output_tokens_details: { reasoning_tokens: 200 },
        },
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  };
  try {
    const r = await openAIProvider().extract(
      {
        evidenceVersion: 2,
        coordinateSpace: "displayed-crop-points",
        page: 1,
        width: 100,
        height: 100,
        rotation: 0,
        text: "Synthetic",
        lines: [],
        images: [{ region: [0, 0, 1, 1], base64: "dGVzdA==" }],
      },
      "test",
      "",
    );
    assert.deepEqual(body.reasoning, { effort: "medium" });
    assert.equal(body.service_tier, "default");
    assert.equal(body.max_output_tokens, 24000);
    assert.equal(body.store, false);
    assert.equal(body.text.format.type, "json_schema");
    assert.equal(body.text.format.strict, true);
    assert.equal(body.input[0].content[1].type, "input_image");
    assert.equal(r.outputTokens, 500);
    assert.equal(r.reasoningTokens, 200);
    process.env.OPENAI_MODEL = "gpt-4.1";
    await openAIProvider().extract(
      {
        evidenceVersion: 2,
        coordinateSpace: "displayed-crop-points",
        page: 1,
        width: 100,
        height: 100,
        rotation: 0,
        text: "Synthetic",
        lines: [],
        images: [],
      },
      "test",
      "",
    );
    assert.equal(body.model, "gpt-4.1");
    assert.equal(body.reasoning, undefined);
    assert.equal(body.max_output_tokens, 16000);
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          id: "resp-malformed",
          object: "response",
          created_at: 0,
          status: "completed",
          model: "gpt-6.1-sol",
          output: [
            {
              type: "message",
              id: "msg-bad",
              role: "assistant",
              status: "completed",
              content: [
                { type: "output_text", text: "{not-json", annotations: [] },
              ],
            },
          ],
          usage: {
            input_tokens: 800,
            output_tokens: 250,
            input_tokens_details: { cached_tokens: 100 },
            output_tokens_details: { reasoning_tokens: 50 },
          },
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    await assert.rejects(
      openAIProvider().extract(
        {
          evidenceVersion: 2,
          coordinateSpace: "displayed-crop-points",
          page: 1,
          width: 100,
          height: 100,
          rotation: 0,
          text: "",
          lines: [],
          images: [],
        },
        "test",
        "",
      ),
      (e: unknown) => {
        assert(e instanceof ExtractionFailure);
        assert.equal(e.details.reason, "invalid_observations");
        assert.equal(e.details.usage?.inputTokens, 800);
        assert.equal(e.details.usage?.cachedInputTokens, 100);
        return true;
      },
    );
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          id: "resp-incomplete",
          object: "response",
          created_at: 0,
          status: "incomplete",
          incomplete_details: { reason: "max_output_tokens" },
          model: "gpt-6.1-sol",
          output: [],
          usage: {
            input_tokens: 1000,
            output_tokens: 24000,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens_details: { reasoning_tokens: 6000 },
          },
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    await assert.rejects(
      openAIProvider().extract(
        {
          evidenceVersion: 2,
          coordinateSpace: "displayed-crop-points",
          page: 1,
          width: 100,
          height: 100,
          rotation: 0,
          text: "Synthetic",
          lines: [],
          images: [],
        },
        "test",
        "",
      ),
      (e: unknown) => {
        assert(e instanceof ExtractionFailure);
        assert.equal(e.details.reason, "max_output_tokens");
        assert.equal(e.details.usage?.outputTokens, 24000);
        assert.equal(e.details.usage?.reasoningTokens, 6000);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
    for (const k of [
      "OPENAI_API_KEY",
      "OPENAI_MODEL",
      "OPENAI_REASONING_EFFORT",
    ]) {
      if (before[k] === undefined) delete process.env[k];
      else process.env[k] = before[k];
    }
  }
});
