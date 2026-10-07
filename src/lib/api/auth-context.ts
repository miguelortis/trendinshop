import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth/session";
import { UserModel } from "@/models/User";

export type AuthContextUser = {
  id: string;
  role: "ADMIN" | "RESELLER";
  documentId: string;
  firstName: string;
  lastName: string;
  email: string;
  isActive: boolean;
};

export async function getAuthenticatedUser(request: Request): Promise<AuthContextUser | null> {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const token = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(SESSION_COOKIE_NAME + "="))
    ?.slice((SESSION_COOKIE_NAME + "=").length);

  if (!token) return null;

  try {
    const payload = await verifySessionToken(decodeURIComponent(token));
    const user = await UserModel.findById(payload.sub).lean();

    if (!user || !user.isActive) return null;

    return {
      id: user._id.toString(),
      role: user.role as "ADMIN" | "RESELLER",
      documentId: user.documentId,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      isActive: user.isActive,
    };
  } catch {
    return null;
  }
}

export function unauthorized() {
  return Response.json(
    { ok: false, error: "UNAUTHENTICATED", message: "Necesitas iniciar sesión." },
    { status: 401 },
  );
}
