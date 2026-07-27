import { NextResponse } from "next/server";
import { resolveProjectFromUrl, ProjectError } from "@/lib/projects";
import {
  getLoopConfig,
  setLoopConfig,
  loopConfigFingerprint,
  LoopConfigError,
  LoopConfigConflictError,
  type LoopConfigPatch,
} from "@/lib/loop-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/loop-config?project=<key>
 * Current loop config for a project (falls back to defaults if unset).
 * Returns: { config: LoopConfig, fingerprint: string }
 *
 * `fingerprint` is a short hash of the config as stored. Send it back on
 * PATCH as `expectedFingerprint` and the save is rejected with 409 if someone
 * else changed the file in the meantime.
 */
export async function GET(req: Request) {
  try {
    const { repo } = await resolveProjectFromUrl(req.url);
    const config = await getLoopConfig(repo);
    return NextResponse.json({ config, fingerprint: loopConfigFingerprint(config) });
  } catch (err) {
    if (err instanceof ProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    console.error("loop-config: read failed", err);
    return NextResponse.json(
      { error: "Couldn't read the loop config from GitHub. Try again." },
      { status: 502 },
    );
  }
}

/**
 * PATCH /api/loop-config?project=<key>
 * Body: Partial<LoopConfig> (+ optional `scout` sub-patch and
 * `expectedFingerprint`) — merged over the current (or default) config.
 * Returns: { ok: true, config: LoopConfig, fingerprint: string }
 * On a stale `expectedFingerprint`: 409 with { error, config, fingerprint }
 * so the caller can reload without another round trip.
 */
export async function PATCH(req: Request) {
  try {
    const { repo } = await resolveProjectFromUrl(req.url);
    let body: LoopConfigPatch & { expectedFingerprint?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Bad request." }, { status: 400 });
    }
    if (typeof body !== "object" || body === null) {
      return NextResponse.json({ error: "Bad request." }, { status: 400 });
    }
    const { expectedFingerprint, ...patch } = body;
    const config = await setLoopConfig(repo, patch, {
      expectedFingerprint:
        typeof expectedFingerprint === "string" ? expectedFingerprint : undefined,
    });
    return NextResponse.json({
      ok: true,
      config,
      fingerprint: loopConfigFingerprint(config),
    });
  } catch (err) {
    if (err instanceof ProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    if (err instanceof LoopConfigConflictError) {
      return NextResponse.json(
        { error: err.message, config: err.config, fingerprint: err.fingerprint },
        { status: err.httpStatus },
      );
    }
    if (err instanceof LoopConfigError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    console.error("loop-config: update failed", err);
    return NextResponse.json(
      { error: "Couldn't save the loop config to GitHub. Try again." },
      { status: 502 },
    );
  }
}
