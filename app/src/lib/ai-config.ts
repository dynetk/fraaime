/** Verified 2026-11-09 against OpenAI's model documentation. */
export const SOL_MODEL = "gpt-6.1-sol";
export const SOL_PRICING = { input: 2, output: 10 };
export const MODEL_PRICING: Record<
  string,
  { input: number; output: number; cached: number }
> = {
  "gpt-4.1": { input: 2, output: 8, cached: 0.5 },
  "gpt-6.1-sol": { ...SOL_PRICING, cached: 0.1 },
  "gpt-6.1-terra": { input: 1, output: 5, cached: 0.05 },
  "gpt-6-astra": { input: 10, output: 50, cached: 1 },
};
export function aiSettings(
  env: Record<string, string | undefined> = process.env,
) {
  const model = env.OPENAI_MODEL || SOL_MODEL;
  if (!Object.hasOwn(MODEL_PRICING, model))
    throw new Error(
      `Unsupported extraction model: ${model}. Validate its API and pricing before enabling it.`,
    );
  const effort = env.OPENAI_REASONING_EFFORT || "medium";
  if (!["low", "medium", "high", "xhigh", "max"].includes(effort))
    throw new Error("Invalid OPENAI_REASONING_EFFORT");
  return {
    model,
    // GPT-4.1 remains available only as the non-reasoning evaluation baseline.
    reasoning:
      model !== "gpt-4.1"
        ? { effort: effort as "low" | "medium" | "high" | "xhigh" | "max" }
        : undefined,
    maxOutputTokens: model !== "gpt-4.1" ? 24000 : 16000,
    timeoutMs: 240000,
  };
}

export function tokenCost(
  input: number,
  output: number,
  rates: { input: number; output: number },
  model: string,
) {
  // Total output already includes reasoning tokens; never add them a second time.
  const longContext = model.startsWith("gpt-6") && input > 272000;
  return (
    (input * rates.input * (longContext ? 2 : 1) +
      output * rates.output * (longContext ? 1.5 : 1)) /
    1e6
  );
}

/** Usage estimate with reported cache discounts, distinct from budget reservations. */
export function usageCost(
  input: number,
  output: number,
  cached: number,
  model: string,
) {
  const rates = MODEL_PRICING[model];
  if (!rates) throw new Error("Unknown model pricing");
  const long = model.startsWith("gpt-6") && input > 272000;
  const hit = Math.max(0, Math.min(input, cached));
  return (
    (((input - hit) * rates.input + hit * rates.cached) * (long ? 2 : 1) +
      output * rates.output * (long ? 1.5 : 1)) /
    1e6
  );
}
