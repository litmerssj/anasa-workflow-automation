import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  INTERNAL_SESSION_COOKIE,
  requireInternalSessionSecret,
  signInternalSession,
} from "@/lib/internal-session";

export async function POST(req: NextRequest) {
  const { password } = await req.json();
  if (!process.env.INTERNAL_QUEUE_PASSWORD || password !== process.env.INTERNAL_QUEUE_PASSWORD) {
    return NextResponse.json({ error: "비밀번호가 틀렸습니다." }, { status: 401 });
  }
  const maxAge = 60 * 60 * 24 * 7;
  const token = signInternalSession(
    requireInternalSessionSecret(),
    Date.now() + maxAge * 1000,
  );
  const store = await cookies();
  store.set(INTERNAL_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });
  return NextResponse.json({ ok: true });
}
