import { NextResponse } from "next/server";
import { repositoryDispatch } from "@/lib/github";
import { TARGET_AGENTS } from "@/lib/tools";

/**
 * Kick off a tool install. Body: { url, target_agent, notes? }.
 * Fires a `tool-install` repository_dispatch that the Tool-installer workflow
 * on the target repo listens for.
 */
export async function POST(req: Request) {
  let body: { url?: string; target_agent?: string; notes?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const url = (body.url ?? "").trim();
  const target = (body.target_agent ?? "").trim();

  try {
    new URL(url);
  } catch {
    return NextResponse.json(
      { error: "That doesn't look like a valid link. Paste the full web address." },
      { status: 400 },
    );
  }

  if (!TARGET_AGENTS.some((a) => a.value === target)) {
    return NextResponse.json(
      { error: "Pick which agent should get this tool." },
      { status: 400 },
    );
  }

  try {
    await repositoryDispatch("tool-install", {
      url,
      target_agent: target,
      notes: body.notes ?? "",
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Could not start the install. Please try again." },
      { status: 500 },
    );
  }
}
