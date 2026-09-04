/**
 * Security response headers, built in one place so the proxy and next.config.ts
 * cannot drift apart.
 *
 * ## Why the CSP is nonce-based
 *
 * The dashboard renders content it did not author — issue and PR bodies, CI log
 * tails, files unzipped out of Actions artifacts — and now serves pages to
 * anyone with the link. A nonce plus `strict-dynamic` is the only CSP shape that
 * actually stops injected script; `script-src 'unsafe-inline'` would let any
 * successful injection run and would be security theatre.
 *
 * Next.js does the wiring itself: when a `Content-Security-Policy` request
 * header carrying a `'nonce-…'` is present, it extracts the nonce and stamps it
 * onto the framework bootstrap, the page chunks and its own inline tags. That
 * only works for DYNAMICALLY rendered pages — a page prerendered at build time
 * has no request and therefore no nonce — which is why `app/login/page.tsx` was
 * split into a `force-dynamic` server wrapper around the client form.
 *
 * KNOWN, ACCEPTED LIMITATION: Next's built-in 404 shell is emitted without a
 * nonce, so an unmatched URL logs a run of blocked-script violations in the
 * console. The page itself is server-rendered HTML and reads correctly; only
 * its hydration is blocked, and there is nothing on a 404 page to hydrate.
 * `export const dynamic = "force-dynamic"` on the root layout was tried and
 * does not change it — the shell does not go through page rendering at all.
 * The alternative is `script-src 'unsafe-inline'` across the whole site, which
 * would trade every page's real XSS protection for a tidier 404 console.
 *
 * ## Why style-src still allows 'unsafe-inline'
 *
 * `style-src` also governs inline `style=""` ATTRIBUTES, and a nonce cannot be
 * attached to an attribute. @xyflow/react positions every node in the process
 * map with inline styles, and `next/font` injects an inline `<style>` block, so
 * a nonce-only style policy renders the map as a pile of overlapping boxes.
 * Style-only injection is a far smaller problem than script execution, and
 * `default-src 'self'` still blocks loading stylesheets from anywhere else.
 */

export type CspOptions = {
  nonce: string;
  isDev: boolean;
};

export function buildCsp({ nonce, isDev }: CspOptions): string {
  const directives = [
    "default-src 'self'",
    // 'strict-dynamic' makes the nonce transitive: a nonced script may load the
    // chunks it needs without every chunk URL being listed. 'unsafe-eval' is
    // required in development only, where React uses eval() to rebuild
    // server-side error stacks in the browser.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    // blob: is for object URLs the client builds from fetched media; data: for
    // small inlined icons. No remote image hosts — everything is same-origin.
    // avatars.githubusercontent.com: PR and issue conversations render the
    // commenter's GitHub avatar. Without this every avatar in a PR thread is a
    // broken image and the console fills with CSP violations. Images only —
    // this widens no script or connect surface.
    "img-src 'self' blob: data: https://avatars.githubusercontent.com",
    "media-src 'self' blob: data:",
    "font-src 'self' data:",
    // The app only ever talks to itself. In dev, the HMR websocket also needs
    // the origin, which 'self' covers.
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    // No <object>/<embed>, and nothing may frame us or be framed by us.
    "object-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    // Stops an injected <base> silently repointing every relative script URL.
    "base-uri 'self'",
    // The login form is the only form; it must not be able to POST elsewhere.
    "form-action 'self'",
  ];
  if (!isDev) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

/**
 * Headers applied to every response.
 *
 * `Strict-Transport-Security` is set only in production: CloudFront terminates
 * TLS, so viewers are always on HTTPS there, while `next dev` is plain HTTP on
 * localhost and an HSTS header would pin the whole of localhost to HTTPS in the
 * developer's browser — including other projects on other ports.
 */
export function securityHeaders(opts: { isDev: boolean }): Record<string, string> {
  const headers: Record<string, string> = {
    // Content-type sniffing turns a text/plain response holding attacker text
    // into whatever the browser guesses. Never let it guess.
    "X-Content-Type-Options": "nosniff",
    // frame-ancestors in the CSP is the modern control; this is the fallback
    // for anything that only understands the old header.
    "X-Frame-Options": "DENY",
    // Send the full URL to ourselves, only the origin to anyone else, and
    // nothing at all when downgrading to HTTP.
    "Referrer-Policy": "strict-origin-when-cross-origin",
    // Nothing here uses a camera, microphone, location or payment API. Say so,
    // so that injected script cannot ask for them either.
    "Permissions-Policy":
      "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
    // Blocks cross-origin pages from loading our responses as an image/script
    // side channel.
    "Cross-Origin-Resource-Policy": "same-origin",
    "Cross-Origin-Opener-Policy": "same-origin",
    "X-DNS-Prefetch-Control": "off",
  };
  if (!opts.isDev) {
    headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  }
  return headers;
}
