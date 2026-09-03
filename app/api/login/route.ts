import { NextResponse } from "next/server";
import {
  AUTH_COOKIE,
  COOKIE_MAX_AGE,
  createAuthCookie,
  verifyPassword,
  viewerProtocol,
} from "@/lib/auth";

export async function POST(req: Request) {
  let password = "";
  try {
    const body = (await req.json()) as { password?: string };
    password = body.password ?? "";
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (!password || !verifyPassword(password)) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  const token = await createAuthCookie();
  const res = NextResponse.json({ ok: true });
  // Secure must follow the actual connection, not NODE_ENV: the production
  // build also runs locally over plain http, where Safari drops Secure cookies.
  const proto = viewerProtocol(req);
  res.cookies.set(AUTH_COOKIE, token, {
    httpOnly: true,
    secure: proto === "https",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
  return res;
}
