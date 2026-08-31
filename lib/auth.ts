/**
 * Auth: single-owner password gate.
 *
 * A successful login sets an httpOnly cookie whose value is
 * `<payload>.<signature>`, where the signature is an HMAC-SHA256 of the
 * payload keyed by SESSION_SECRET. Everything here uses the Web Crypto
 * API (crypto.subtle) so it runs on the Edge runtime (middleware) as well as
 * the Node/serverless runtime (API routes) on Vercel.
 *
 * Two DIFFERENT secrets, on purpose:
 *
 *   - DASHBOARD_PASSWORD — what the owner types on /login. Nothing else.
 *   - SESSION_SECRET     — 32 random bytes, the HMAC key for the cookie.
 *
 * They used to be the same value, which meant a leaked password was also a
 * cookie-forgery key, sessions couldn't be revoked without changing the
 * password, and the key had only as much entropy as a human chose.
 *
 * SESSION_SECRET is optional for now so a solo owner who hasn't set it yet
 * still gets in: we fall back to the password and warn once on the server.
 * Set it — see .env.local guidance below. Generate one with:
 *
 *     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * Changing SESSION_SECRET (or bumping SESSION_KEY_VERSION) invalidates every
 * existing cookie — everyone is simply sent back to /login. That's the
 * revocation lever: bump the version, sessions die, the password is untouched.
 */

export const AUTH_COOKIE = "loop_dash_session";

const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;
export const COOKIE_MAX_AGE = THIRTY_DAYS_SECONDS;

/** Bump (via env) to invalidate every outstanding session cookie. */
function getKeyVersion(): string {
  return (process.env.SESSION_KEY_VERSION ?? "1").trim() || "1";
}

function getPassword(): string {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) {
    throw new Error(
      "DASHBOARD_PASSWORD is not set. Add it to your environment / Vercel project settings.",
    );
  }
  return password;
}

let warnedAboutMissingSessionSecret = false;

/**
 * The HMAC key for session cookies. Prefers SESSION_SECRET; falls back to
 * DASHBOARD_PASSWORD (the old behaviour) with a one-time server-side warning
 * rather than hard-failing, so an existing install doesn't lock its owner out.
 */
function getSigningKey(): string {
  const sessionSecret = process.env.SESSION_SECRET?.trim();
  if (sessionSecret) return sessionSecret;

  if (!warnedAboutMissingSessionSecret) {
    warnedAboutMissingSessionSecret = true;
    console.warn(
      "auth: SESSION_SECRET is not set — falling back to signing session cookies with DASHBOARD_PASSWORD. " +
        "That makes a leaked password a cookie-forgery key. Set SESSION_SECRET to 32 random bytes " +
        '(node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"). ' +
        "Doing so signs everyone out once; nothing else changes.",
    );
  }
  return getPassword();
}

function base64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(input: string): Uint8Array {
  let str = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = str.length % 4;
  if (pad) str += "=".repeat(4 - pad);
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function sign(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getSigningKey()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return base64urlEncode(new Uint8Array(sig));
}

/**
 * Compare the submitted password against DASHBOARD_PASSWORD.
 *
 * No early return on a length mismatch — that told an attacker how long the
 * password is. The lengths are folded into the same accumulator instead, and
 * out-of-range charCodeAt() (NaN) is normalised to 0.
 */
export function verifyPassword(input: string): boolean {
  const secret = getPassword();
  let diff = input.length ^ secret.length;
  const len = Math.max(input.length, secret.length);
  for (let i = 0; i < len; i++) {
    diff |= (input.charCodeAt(i) || 0) ^ (secret.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/** Build a signed session token (30-day expiry baked into the payload). */
export async function createAuthCookie(): Promise<string> {
  const payloadObj = { v: getKeyVersion(), exp: Date.now() + COOKIE_MAX_AGE * 1000 };
  const payload = base64urlEncode(
    new TextEncoder().encode(JSON.stringify(payloadObj)),
  );
  const signature = await sign(payload);
  return `${payload}.${signature}`;
}

/**
 * Validate a session token: the signature must match, the key version must be
 * the current one, and it must not be expired.
 */
export async function verifyAuthCookie(
  token: string | undefined | null,
): Promise<boolean> {
  if (!token) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;

  const expected = await sign(payload);
  if (signature.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < signature.length; i++) {
    diff |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  if (diff !== 0) return false;

  try {
    const obj = JSON.parse(
      new TextDecoder().decode(base64urlDecode(payload)),
    ) as { v?: string; exp?: number };
    // Cookies minted before the version field existed count as version "1".
    if ((obj.v ?? "1") !== getKeyVersion()) return false;
    if (typeof obj.exp !== "number" || Date.now() > obj.exp) return false;
  } catch {
    return false;
  }
  return true;
}
