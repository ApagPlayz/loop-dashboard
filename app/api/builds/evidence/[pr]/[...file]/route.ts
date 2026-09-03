import { readEvidenceFile } from "@/lib/queues";
import { evidenceRendersInline } from "@/lib/queues-evidence";
import { resolveProjectFromUrl, ProjectError } from "@/lib/projects";

export const dynamic = "force-dynamic";

/**
 * GET /api/builds/evidence/[pr]/[...file]
 * Streams a single media file out of the demo-evidence artifact for a PR.
 * The [...file] catch-all lets us serve nested paths like video/01-demo.webm.
 */
export async function GET(
  req: Request,
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
    const { repo } = await resolveProjectFromUrl(req.url);
    const result = await readEvidenceFile(prNumber, filePath, repo);
    if (!result) {
      return new Response("Evidence file not found or artifact expired.", {
        status: 404,
      });
    }
    const bodyBuffer = Buffer.from(result.bytes);
    const inline = evidenceRendersInline(result.contentType);
    return new Response(bodyBuffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": result.contentType,
        "Content-Length": String(result.bytes.byteLength),
        // Artifact contents are immutable for a given upload; cache briefly.
        "Cache-Control": "private, max-age=300",
        // This body came out of a CI artifact — content this app did not write
        // and cannot vouch for — but it is served from the app's own origin, so
        // anything scriptable in it would run as us. Three locks:
        //   * nosniff, so the browser cannot upgrade a benign declared type
        //     into an executable one it guessed at.
        //   * a document-scoped CSP that permits nothing, plus `sandbox`, so an
        //     SVG or HTML file opened directly still cannot execute or fetch.
        //   * attachment for anything that isn't an image/video/audio, so it is
        //     downloaded rather than rendered. `contentTypeFor` no longer maps
        //     .svg at all, which is what closes the stored-XSS hole this had.
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        ...(inline
          ? {}
          : { "Content-Disposition": "attachment" }),
      },
    });
  } catch (err) {
    if (err instanceof ProjectError) {
      return new Response(err.message, { status: err.httpStatus });
    }
    // Deliberately NOT err.message. That string is whatever Octokit or the zip
    // reader produced — it has carried API URLs, rate-limit detail and, on a
    // filesystem error, absolute paths. The real error goes to the task log,
    // where only the owner can read it.
    console.error("evidence: read failed", err);
    return new Response("Could not read evidence.", { status: 502 });
  }
}
