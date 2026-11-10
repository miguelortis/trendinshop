import { jwtVerify, SignJWT, type JWTPayload } from "jose";

export const SESSION_COOKIE_NAME = "ts_session";

export type SessionPayload = JWTPayload & {
  sub: string;
  role: "ADMIN" | "RESELLER";
};

function getAuthSecret() {
  const secret = process.env.AUTH_SECRET
    ?.trim()
    .replace(/^['"]|['"]$/g, "");

  if (!secret || secret.length < 16) {
    throw new Error("AUTH_SECRET debe existir y tener al menos 16 caracteres.");
  }

  return new TextEncoder().encode(secret);
}

export function assertAuthConfiguration() {
  getAuthSecret();
}

export async function createSessionToken(
  user: { id: string; role: "ADMIN" | "RESELLER" },
  remember = true,
) {
  const maxAgeSeconds = remember ? 60 * 60 * 24 * 30 : 60 * 60 * 8;

  return new SignJWT({ role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + maxAgeSeconds)
    .sign(getAuthSecret());
}

export async function verifySessionToken(token: string): Promise<SessionPayload> {
  const { payload } = await jwtVerify(token, getAuthSecret(), { algorithms: ["HS256"] });

  if (
    typeof payload.sub !== "string" ||
    (payload.role !== "ADMIN" && payload.role !== "RESELLER")
  ) {
    throw new Error("Sesión inválida.");
  }

  return payload as SessionPayload;
}
