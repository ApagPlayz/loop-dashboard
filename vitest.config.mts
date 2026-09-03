import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// fileURLToPath, not `new URL(...).pathname`. A file: URL percent-encodes its
// path, and this repo lives under ".../Claude Projects/..." — so .pathname
// yields "Claude%20Projects" and the alias below silently pointed at a
// directory that does not exist. Every "@/..." import then failed to resolve,
// which is why the existing tests all reach for relative paths instead.
const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      // Mirrors tsconfig.json's "@/*" -> "./*" path alias so tests (and any
      // source files they pull in) can use the same imports as app code.
      "@": rootDir,
    },
  },
});
