import { NextResponse } from "next/server";
import { AUTH_COOKIE } from "@/lib/auth";

export async function POST(req: Request) {
  const res = NextResponse.json({ ok: true });
  // Match the login route: Secure follows the actual connection so the
  // cookie clears correctly on both http://localhost and https on Vercel.
  const proto =
    req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.slice(0, -1);
  res.cookies.set(AUTH_COOKIE, "", {
    httpOnly: true,
    secure: proto === "https",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
