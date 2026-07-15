import { NextResponse } from "next/server";
import { repositoryDispatch } from "@/lib/github";

/**
 * "Give this to all agents": replicate a capability that one agent already has
 * onto every agent. Body: { name, kind, fromAgent, url? }.
 *
 * Fires the same `tool-install` event as the add form, but the payload's `url`
 * carries the tool identifier (there may be no web URL for something already
 * configured in a workflow), and `notes` tells the installer to copy the exact
 * existing configuration.
 */
export async function POST(req: Request) {
  let body: {
    name?: string;
    kind?: string;
    fromAgent?: string;
    url?: string;
  } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const name = (body.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "Missing tool name" }, { status: 400 });
  }
  const kind = body.kind ?? "tool";
  const from = body.fromAgent ?? "an agent";
  const url = (body.url ?? "").trim() || name; // identifier when no web URL exists

  const notes = `This ${kind} ("${name}") is already configured on ${from}. Replicate that EXACT configuration to all other agents so every agent has it. Identifier: ${name}.`;

  try {
    await repositoryDispatch("tool-install", {
      url,
      target_agent: "all",
      notes,
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Could not start. Please try again." },
      { status: 500 },
    );
  }
}
