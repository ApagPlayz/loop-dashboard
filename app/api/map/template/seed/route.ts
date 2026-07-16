import { NextResponse } from "next/server";
import { seedTemplateFromPilot, TemplateError } from "@/lib/loop-template";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/map/template/seed — initialize the template once by copying the
 * pilot project's current workflows. Safe to call again (no-op when seeded).
 * Returns: { ok, alreadySeeded, files, commitUrl? }
 */
export async function POST() {
  try {
    const res = await seedTemplateFromPilot();
    return NextResponse.json({ ok: true, ...res });
  } catch (err) {
    if (err instanceof TemplateError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    console.error("template/seed: failed", err);
    return NextResponse.json(
      { error: "Couldn't set the template up. Try again." },
      { status: 502 },
    );
  }
}
