/**
 * Auth: single-owner password gate.
 *
 * A successful login sets an httpOnly cookie whose value is
 * `<payload>.<signature>`, where the signature is an HMAC-SHA256 of the
 * payload keyed by DASHBOARD_PASSWORD. Everything here uses the Web Crypto
 * API (crypto.subtle) so it runs on the Edge runtime (middleware) as well as
 * the Node/serverless runtime (API routes) on Vercel.
 */

export const AUTH_COOKIE = "loop_dash_session";

const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;
export const COOKIE_MAX_AGE = THIRTY_DAYS_SECONDS;

function getSecret(): string {
  const secret = process.env.DASHBOARD_PASSWORD;
  if (!secret) {
    throw new Error(
      "DASHBOARD_PASSWORD is not set. Add it to your environment / Vercel project settings.",
    );
  }
  return secret;
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
    new TextEncoder().encode(getSecret()),
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

/** Compare the submitted password against DASHBOARD_PASSWORD. */
export function verifyPassword(input: string): boolean {
  const secret = getSecret();
  if (input.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < input.length; i++) {
    diff |= input.charCodeAt(i) ^ secret.charCodeAt(i);
  }
  return diff === 0;
}

/** Build a signed session token (30-day expiry baked into the payload). */
export async function createAuthCookie(): Promise<string> {
  const payloadObj = { exp: Date.now() + COOKIE_MAX_AGE * 1000 };
  const payload = base64urlEncode(
    new TextEncoder().encode(JSON.stringify(payloadObj)),
  );
  const signature = await sign(payload);
  return `${payload}.${signature}`;
}

/** Validate a session token: signature must match and it must not be expired. */
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
    ) as { exp?: number };
    if (typeof obj.exp !== "number" || Date.now() > obj.exp) return false;
  } catch {
    return false;
  }
  return true;
}
