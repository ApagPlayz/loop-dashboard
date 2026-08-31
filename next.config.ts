import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Ship only the files `next start` needs at runtime (a pruned
  // node_modules + a server.js entrypoint) into `.next/standalone` so the
  // Docker image doesn't carry the full dev node_modules tree.
  // See docs/plans/aws-bedrock-multitenant-plan-2026-08-31.md §2.2.
  output: "standalone",
};

export default nextConfig;
