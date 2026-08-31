/**
 * Local-mode gate for the Mac-only surface of the dashboard.
 *
 * `lib/launchers.ts`, `lib/local-folders.ts` and the routes in front of them
 * spawn processes and read the filesystem of the machine the dashboard runs
 * on. That's exactly what the owner wants on their Mac; in a container it is
 * process execution reachable by anyone holding a session cookie. So the whole
 * surface is inert unless it's explicitly switched on.
 *
 * Default is OFF, deliberately: a cloud deploy is safe without anyone
 * remembering to set anything. To use the launcher and local-folder features
 * on a laptop, put this in `.env.local`:
 *
 *     LOOP_DASHBOARD_LOCAL_MODE=1
 *
 * Gate at the ROUTE, never inside the libraries, so nothing can reach the
 * local helpers by some other path.
 */

import { NextResponse } from "next/server";

const TRUTHY = new Set(["1", "true", "yes", "on"]);

/** Whether the local-machine features are switched on for this process. */
export function isLocalModeEnabled(): boolean {
  const raw = (process.env.LOOP_DASHBOARD_LOCAL_MODE ?? "").trim().toLowerCase();
  return TRUTHY.has(raw);
}

/**
 * The response every local-only route returns when local mode is off. A 404,
 * not a 403: on a server without local mode the feature doesn't exist at all.
 */
export function localModeDisabledResponse(): NextResponse {
  return NextResponse.json(
    {
      error:
        "Local-machine features aren't available on this server. They only run on the machine the dashboard is installed on (set LOOP_DASHBOARD_LOCAL_MODE=1 there).",
    },
    { status: 404 },
  );
}
