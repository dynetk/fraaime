import { withWorkflow } from "workflow/next";
import type { NextConfig } from "next";
const config: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  outputFileTracingExcludes: {
    "/*": ["./.local/**/*", "./private/**/*", "./.env*"],
  },
  poweredByHeader: false,
  experimental: {
    proxyClientMaxBodySize:
      process.env.FRAAIME_LOCAL_MODE === "1" && !process.env.VERCEL
        ? "128mb"
        : "10mb",
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};
export default withWorkflow(config);
