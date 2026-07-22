import { NextResponse } from "next/server";
import { resolveProjectFromUrl, ProjectError } from "@/lib/projects";
import { getLoopConfig, setLoopConfig, LoopConfigError, type LoopConfig } from "@/lib/loop-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/loop-config?project=<key>
 * Current loop config for a project (falls back to defaults if unset).
 * Returns: { config: LoopConfig }
 */
export async function GET(req: Request) {
  try {
    const { repo } = await resolveProjectFromUrl(req.url);
    const config = await getLoopConfig(repo);
    return NextResponse.json({ config });
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
 * Body: Partial<LoopConfig> — merged over the current (or default) config.
 * Returns: { ok: true, config: LoopConfig }
 */
export async function PATCH(req: Request) {
  try {
    const { repo } = await resolveProjectFromUrl(req.url);
    let patch: Partial<LoopConfig>;
    try {
      patch = await req.json();
    } catch {
      return NextResponse.json({ error: "Bad request." }, { status: 400 });
    }
    const config = await setLoopConfig(repo, patch);
    return NextResponse.json({ ok: true, config });
  } catch (err) {
    if (err instanceof ProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
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
