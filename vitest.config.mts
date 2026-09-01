import path from "node:path";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(new URL(import.meta.url).pathname);

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
