/**
 * "Is the person rendering this page signed in?", for Server Components.
 *
 * The proxy already answers this for API traffic, but a page's server
 * components run *after* the proxy has waved the request through, and they load
 * their data by calling lib functions directly rather than by fetching
 * `/api/*`. So they need to ask the question again, here.
 *
 * The answer comes from the session cookie itself, verified with the same HMAC
 * as everywhere else — not from a header the proxy set. A header would be one
 * spoofable hop; `cookies()` is the request's own state and a visitor cannot
 * forge a signature without SESSION_SECRET.
 */

import { AUTH_COOKIE, verifyAuthCookie } from "@/lib/auth";
import { publicDemoEnabled } from "@/lib/public-access";

/**
 * True when this render should use the frozen demo snapshot instead of live
 * data.
 *
 * Returns false — i.e. "behave normally" — whenever demo mode is off, and also
 * whenever there is no request to read a cookie from (a build-time prerender, a
 * script). That direction of failure is the safe one: without demo mode the
 * proxy has already guaranteed the caller is the owner, so "not public" is
 * simply true.
 */
export async function isPublicViewer(): Promise<boolean> {
  if (!publicDemoEnabled()) return false;
  try {
    const { cookies } = await import("next/headers");
    const store = await cookies();
    return !(await verifyAuthCookie(store.get(AUTH_COOKIE)?.value));
  } catch {
    return false;
  }
}
