import { localMode } from "../src/lib/config";
const names = [
  "DATABASE_URL",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "BLOB_READ_WRITE_TOKEN",
  "OPENAI_API_KEY",
  "OPENAI_INPUT_USD_PER_MILLION",
  "OPENAI_OUTPUT_USD_PER_MILLION",
  "PDF_WORKER_URL",
  "PDF_WORKER_TOKEN",
  "APP_ORIGIN",
  "ADMIN_EMAILS",
];
console.log(
  localMode()
    ? "Local development mode; production authentication is not active."
    : "Hosted mode; authentication is mandatory.",
);
for (const name of names)
  console.log(`${name}: ${process.env[name] ? "set" : "missing"}`);
if (!localMode() && names.some((n) => !process.env[n])) process.exitCode = 1;
