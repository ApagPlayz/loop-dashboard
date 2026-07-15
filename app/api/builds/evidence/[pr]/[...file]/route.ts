import { readEvidenceFile } from "@/lib/queues";

export const dynamic = "force-dynamic";

/**
 * GET /api/builds/evidence/[pr]/[...file]
 * Streams a single media file out of the demo-evidence artifact for a PR.
 * The [...file] catch-all lets us serve nested paths like video/01-demo.webm.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ pr: string; file: string[] }> },
) {
  const { pr, file } = await params;
  const prNumber = Number(pr);
  if (!Number.isInteger(prNumber)) {
    return new Response("Bad PR number", { status: 400 });
  }

  const filePath = (file ?? []).join("/");
  if (!filePath) {
    return new Response("No file specified", { status: 400 });
  }

  try {
    const result = await readEvidenceFile(prNumber, filePath);
    if (!result) {
      return new Response("Evidence file not found or artifact expired.", {
        status: 404,
      });
    }
    const bodyBuffer = Buffer.from(result.bytes);
    return new Response(bodyBuffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": result.contentType,
        "Content-Length": String(result.bytes.byteLength),
        // Artifact contents are immutable for a given upload; cache briefly.
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not read evidence.";
    return new Response(message, { status: 502 });
  }
}
