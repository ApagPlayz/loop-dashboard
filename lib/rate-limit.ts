/**
 * A tiny fixed-window rate limiter, in process memory.
 *
 * In-memory is the RIGHT storage here, not a shortcut: the ECS service is
 * pinned to `desiredCount: 1` precisely because six other module-level stores
 * already assume a single process (see infra/deploy.sh). One task means one
 * counter, so there is nothing to share. If the service is ever scaled out,
 * this becomes per-task — which still bounds spend, just at N x the limit —
 * and the note in deploy.sh already says to move that state out first.
 *
 * Fixed window, not a token bucket: the thing being defended is "an anonymous
 * visitor cannot spend the owner's money or hammer GitHub", and for that a
 * coarse ceiling is enough. Bursts inside a window are fine; sustained load is
 * not, and a fixed window stops that with one Map lookup and no timers.
 */

type Window = { count: number; resetAt: number };

const WINDOWS = new Map<string, Window>();

/**
 * Entries are only ever removed lazily, on a hit for the same key, so a scan of
 * unique attacker IPs would grow the Map without bound. Sweep on write once the
 * Map gets big rather than running an interval (an interval keeps the event
 * loop alive and has to be torn down in tests).
 */
const SWEEP_THRESHOLD = 5_000;

function sweep(now: number) {
  for (const [key, win] of WINDOWS) {
    if (win.resetAt <= now) WINDOWS.delete(key);
  }
}

export type RateLimitResult = {
  ok: boolean;
  /** Requests still allowed in the current window. */
  remaining: number;
  /** Seconds until the window resets — the value for `Retry-After`. */
  retryAfterSeconds: number;
  limit: number;
};

/**
 * Count one request against `key`. Returns `ok: false` once `limit` requests
 * have been seen inside `windowMs`.
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  if (WINDOWS.size > SWEEP_THRESHOLD) sweep(now);

  const existing = WINDOWS.get(key);
  if (!existing || existing.resetAt <= now) {
    WINDOWS.set(key, { count: 1, resetAt: now + windowMs });
    return {
      ok: true,
      remaining: limit - 1,
      retryAfterSeconds: Math.ceil(windowMs / 1000),
      limit,
    };
  }

  existing.count += 1;
  const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
  return {
    ok: existing.count <= limit,
    remaining: Math.max(0, limit - existing.count),
    retryAfterSeconds,
    limit,
  };
}

/** Test seam — drops every window. */
export function resetRateLimits(): void {
  WINDOWS.clear();
}

/**
 * Best-effort client identity for rate limiting.
 *
 * `x-forwarded-for` is the only `X-Forwarded-*` header CloudFront actually sets
 * on the way to the origin, and it appends the viewer IP as the LAST entry of
 * whatever the client already sent. So the client controls every entry except
 * the final one — take the last, not the first, or a visitor can rotate their
 * own bucket key at will by sending a fake header.
 *
 * `cloudfront-viewer-address` is preferred when present (the managed origin
 * request policy this distribution uses forwards it) because CloudFront sets it
 * itself and the viewer cannot influence it at all.
 */
export function clientKey(headers: Headers): string {
  const viewerAddress = headers.get("cloudfront-viewer-address");
  if (viewerAddress) {
    // "1.2.3.4:53412" or "[2001:db8::1]:53412" — strip the ephemeral port.
    const bracketed = viewerAddress.match(/^\[(.+)\]:\d+$/);
    if (bracketed) return bracketed[1]!;
    const lastColon = viewerAddress.lastIndexOf(":");
    return lastColon > 0 ? viewerAddress.slice(0, lastColon) : viewerAddress;
  }

  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1]!;
  }

  return "unknown";
}
