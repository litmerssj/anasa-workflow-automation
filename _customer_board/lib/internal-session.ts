import { createHmac, timingSafeEqual } from "node:crypto";

export const INTERNAL_SESSION_COOKIE = "anasa_internal";

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function signInternalSession(secret: string, expiresAt: number): string {
  const payload = String(Math.trunc(expiresAt));
  return `${payload}.${signature(payload, secret)}`;
}

export function verifyInternalSession(token: string | undefined, secret: string, now = Date.now()): boolean {
  if (!token || !secret) return false;
  const separator = token.indexOf(".");
  if (separator <= 0) return false;
  const payload = token.slice(0, separator);
  const supplied = token.slice(separator + 1);
  const expiresAt = Number(payload);
  if (!Number.isFinite(expiresAt) || now > expiresAt) return false;
  const expected = signature(payload, secret);
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  if (suppliedBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(suppliedBytes, expectedBytes);
}

export function requireInternalSessionSecret(
  env: Record<string, string | undefined> = process.env,
): string {
  const secret = env.INTERNAL_SESSION_SECRET;
  if (!secret) throw new Error("INTERNAL_SESSION_SECRET가 설정되지 않았습니다");
  return secret;
}
