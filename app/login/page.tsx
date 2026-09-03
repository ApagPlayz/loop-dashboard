import LoginForm from "./login-form";
import { publicDemoEnabled } from "@/lib/public-access";

/**
 * A server wrapper around the client login form, purely so this page renders
 * DYNAMICALLY.
 *
 * The CSP is nonce-based (see lib/security-headers.ts), and Next can only stamp
 * a nonce onto markup it generates in response to a real request. This page used
 * to be prerendered at build time — it appeared in `.next/prerender-manifest`
 * alongside `/_not-found` — so its script tags carried no nonce and the strict
 * policy would have blocked every one of them. A login form that cannot hydrate
 * is a login form the owner cannot use, which would have quietly traded the
 * owner's access for the public demo.
 */
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return <LoginForm demoMode={publicDemoEnabled()} />;
}
