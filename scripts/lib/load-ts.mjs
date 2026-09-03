/**
 * Load the TypeScript `lib/` tree from a plain .mjs script.
 *
 * Node 26 strips types natively, but it will not resolve the extensionless
 * relative specifiers (`./graph`, `../github`) that the Next.js side of this
 * repo is written in, so scripts borrow Vite — already present via vitest — to
 * transpile and resolve on the fly.
 *
 * WHY A LONG-LIVED SERVER AND NOT `runnerImport`:
 * `runnerImport()` tears its module runner down as soon as the entry module has
 * evaluated. Any *lazy* `await import(...)` inside the loaded tree therefore
 * blows up later with "Vite module runner has been closed" — which is exactly
 * what lib/map-ai.ts does for the Bedrock SDK, so the whole bedrock backend was
 * unreachable from scripts. Holding one dev server open for the life of the
 * process keeps those deferred imports working.
 *
 * Usage:
 *   const load = await tsLoader();
 *   const agent = await load("lib/agent/index.ts");
 *   await load.close();
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Returns `load(relativePath)` plus `load.close()`. The server is also closed
 * on process exit so a forgotten close() can't hang the script.
 */
export async function tsLoader() {
  const { createServer } = await import("vite");
  const server = await createServer({
    configFile: false,
    root: ROOT,
    appType: "custom",
    logLevel: "error",
    server: { middlewareMode: true, hmr: false, watch: null },
  });

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await server.close();
  };
  process.once("exit", () => void server.close());

  const load = (relPath) => server.ssrLoadModule(`/${relPath.replace(/^\/+/, "")}`);
  load.close = close;
  return load;
}
