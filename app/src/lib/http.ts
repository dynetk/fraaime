import { ZodError } from "zod";
import { HttpError } from "./access";
export function route(fn: (r: Request) => Promise<Response>) {
  return async (r: Request) => {
    try {
      if (!["GET", "HEAD", "OPTIONS"].includes(r.method)) {
        const origin = r.headers.get("origin");
        if (
          origin &&
          origin !== (process.env.APP_ORIGIN || new URL(r.url).origin)
        )
          throw new HttpError(403, "Cross-origin request rejected.");
      }
      return await fn(r);
    } catch (e) {
      if (e instanceof HttpError)
        return Response.json({ error: e.message }, { status: e.status });
      if (e instanceof ZodError)
        return Response.json(
          {
            error: "Invalid input",
            details: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
          },
          { status: 400 },
        );
      console.error(
        "request_failed",
        e instanceof Error ? e.message : "Unknown error",
      );
      return Response.json(
        {
          error:
            "The request could not be completed. Check server configuration and logs.",
        },
        { status: 500 },
      );
    }
  };
}
export async function json(r: Request) {
  const text = await r.text();
  if (text.length > 8_000_000) throw new HttpError(413, "Request too large.");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Invalid JSON.");
  }
}
