import { NextResponse } from "next/server";
import { AUTH_COOKIE, viewerProtocol } from "@/lib/auth";

export async function POST(req: Request) {
  const res = NextResponse.json({ ok: true });
  // Match the login route: Secure follows the actual connection so the
  // cookie clears correctly on both http://localhost and https on Vercel.
  const proto = viewerProtocol(req);
  res.cookies.set(AUTH_COOKIE, "", {
    httpOnly: true,
    secure: proto === "https",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
