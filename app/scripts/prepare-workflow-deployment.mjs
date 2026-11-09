import { readFileSync, writeFileSync } from "node:fs";
import { getWorkflowQueueTrigger } from "@workflow/builders";

// The hosted Next builder cannot resolve the generated source route in this
// integration. Persist its SDK-derived queue metadata in the Next function
// manifest, which the standard Vercel builder consumes directly.
const path = ".next/server/functions-config-manifest.json";
const routes = JSON.parse(readFileSync(".next/server/app-paths-manifest.json", "utf8"));
const route = "/.well-known/workflow/v1/flow";
for (const key of ["/page", "/api/[...path]/route", `${route}/route`]) {
  if (!routes[key]) throw new Error(`Required compiled application route is missing: ${key}`);
}
const manifest = JSON.parse(readFileSync(path, "utf8"));
if (manifest.version !== 1) throw new Error("Unsupported Next function manifest");
// The Build Output metadata needs the SDK's consumer field even though the
// public vercel.json queue/v2beta schema does not accept that field.
const trigger = getWorkflowQueueTrigger();
manifest.functions[route] = {
  ...manifest.functions[route],
  maxDuration: 800,
  experimentalTriggers: [trigger],
};
writeFileSync(path, JSON.stringify(manifest, null, 2));
console.log("Workflow queue metadata prepared (800-second duration).");
