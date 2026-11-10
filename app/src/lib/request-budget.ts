import OpenAI from "openai";
import { required } from "./config";
import { tokenCost, MODEL_PRICING } from "./ai-config";
import { processingErrorMessage } from "./processing-error";

/** Count the actual text, images, instructions and schema before reserving any generation. */
export async function countRequestReservation(
  request: OpenAI.Responses.ResponseCreateParamsNonStreaming,
) {
  const model = request.model;
  const rates = model ? MODEL_PRICING[model] : undefined;
  if (
    !model ||
    !rates ||
    !Number.isSafeInteger(request.max_output_tokens) ||
    request.max_output_tokens! <= 0
  )
    throw new Error(
      "Cannot reserve an unpriced model or missing output limit.",
    );
  const client = new OpenAI({
    apiKey: required("OPENAI_API_KEY"),
    maxRetries: 0,
    timeout: 60000,
  });
  let count: number;
  try {
    const result = await client.responses.inputTokens.count({
      model: request.model,
      input: request.input,
      instructions: request.instructions,
      reasoning: request.reasoning,
      text: request.text,
      tools: request.tools,
      tool_choice: request.tool_choice,
      truncation: "disabled",
    });
    count = result.input_tokens;
  } catch (error) {
    throw new Error(
      "Could not check AI input size before processing. No generation was started. " +
        processingErrorMessage(error),
    );
  }
  if (!Number.isSafeInteger(count) || count <= 0)
    throw new Error("AI token count was invalid. No generation was started.");
  // Ten percent headroom plus formatting allowance; no cache discount is assumed.
  const reservedInputTokens = Math.ceil(count * 1.1) + 1024;
  return {
    inputTokens: count,
    reservedInputTokens,
    maxOutputTokens: request.max_output_tokens!,
    reservedUsd: tokenCost(
      reservedInputTokens,
      request.max_output_tokens!,
      rates,
      model,
    ),
  };
}
export function budgetLimitMessage(b: {
  reserved: number;
  jobSpent: number;
  jobBudget: number;
  monthlySpent: number;
  monthlyBudget: number;
}) {
  if (Object.values(b).some((n) => !Number.isFinite(n) || n < 0))
    return "Invalid AI budget configuration. No generation was started.";
  const cost = b.reserved.toFixed(2);
  if (b.jobSpent + b.reserved > b.jobBudget)
    return `This stage needs a reservation of $${cost}, but this job has $${Math.max(0, b.jobBudget - b.jobSpent).toFixed(2)} remaining of its $${b.jobBudget.toFixed(2)} budget. No new generation was started. Select fewer sheets in a new attempt or ask an administrator to review the limit.`;
  if (b.monthlySpent + b.reserved > b.monthlyBudget)
    return `This stage needs a reservation of $${cost}, but the account has $${Math.max(0, b.monthlyBudget - b.monthlySpent).toFixed(2)} remaining of its $${b.monthlyBudget.toFixed(2)} monthly budget. No new generation was started. Ask an administrator to review the limit.`;
  return null;
}
