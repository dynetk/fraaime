/** Workflow step errors may originate in another VM and fail instanceof Error. */
export function processingErrorMessage(error: unknown): string {
  if (typeof error === "string" && error.trim()) return error.slice(0, 1500);
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.trim()
  )
    return error.message.slice(0, 1500);
  return "Processing failed. Please retry or contact support with this attempt's timestamp.";
}
