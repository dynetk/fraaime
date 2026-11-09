import { test } from "node:test";
import assert from "node:assert/strict";
import { route } from "../src/lib/http";
import { reserveCost, PageResult } from "../src/lib/extraction";
import { zodTextFormat } from "openai/helpers/zod";
test("CSRF checks use the configured external origin behind Next proxy", async () => {
  process.env.APP_ORIGIN = "http://127.0.0.1:5190";
  const handler = route(async () => Response.json({ ok: true }));
  assert.equal(
    (
      await handler(
        new Request("http://localhost:5190/api/test", {
          method: "POST",
          headers: { origin: "http://127.0.0.1:5190" },
        }),
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await handler(
        new Request("http://localhost:5190/api/test", {
          method: "POST",
          headers: { origin: "https://evil.example" },
        }),
      )
    ).status,
    403,
  );
});
test("cost reservation includes all image crops and fails without configured rates", () => {
  delete process.env.OPENAI_INPUT_USD_PER_MILLION;
  delete process.env.OPENAI_OUTPUT_USD_PER_MILLION;
  const evidence = {
    page: 1,
    width: 100,
    height: 100,
    rotation: 0,
    text: "abc",
    lines: [],
    images: [{ region: [0, 0, 1, 1], base64: "" }],
  };
  assert.throws(() => reserveCost(evidence, ""), /Invalid configuration/);
  process.env.OPENAI_INPUT_USD_PER_MILLION = "2";
  process.env.OPENAI_OUTPUT_USD_PER_MILLION = "8";
  const one = reserveCost(evidence, "");
  evidence.images.push(evidence.images[0]);
  assert(reserveCost(evidence, "") > one);
  delete process.env.OPENAI_INPUT_USD_PER_MILLION;
  delete process.env.OPENAI_OUTPUT_USD_PER_MILLION;
});
test("OpenAI structured output schema uses homogeneous arrays instead of unsupported tuples", () => {
  const format = zodTextFormat(PageResult, "plan_observations");
  const text = JSON.stringify(format);
  assert(!text.includes("prefixItems"));
  assert(text.includes("additionalProperties"));
});
