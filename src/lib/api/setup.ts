import { NextResponse } from "next/server";
import { connectMongoDB } from "@/lib/db/mongodb";
import { getAuthenticatedUser, unauthorized } from "@/lib/api/auth-context";
import { createSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { UserModel } from "@/models/User";

const COOKIE_BASE = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

function errorResponse(message: string, status = 400, code = "BAD_REQUEST") {
  return NextResponse.json({ ok: false, error: code, message }, { status });
}

export async function bootstrapAdmin(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();

  if (user.role === "ADMIN") {
    return NextResponse.json({ ok: true, message: "Tu cuenta ya es administradora." });
  }

  const bootstrapKey = process.env.ADMIN_BOOTSTRAP_KEY?.trim();
  if (!bootstrapKey) {
    return errorResponse("La activación inicial de administrador no está configurada.", 503, "BOOTSTRAP_DISABLED");
  }

  const body = (await request.json()) as Record<string, unknown>;
  const providedKey = typeof body.key === "string" ? body.key.trim() : "";

  if (!providedKey || providedKey !== bootstrapKey) {
    return errorResponse("La clave de activación no es correcta.", 403, "INVALID_BOOTSTRAP_KEY");
  }

  await connectMongoDB();

  const existingAdmin = await UserModel.exists({ role: "ADMIN" });
  if (existingAdmin) {
    return errorResponse("Ya existe un administrador. La activación inicial está cerrada.", 409, "ADMIN_EXISTS");
  }

  const promoted = await UserModel.findByIdAndUpdate(
    user.id,
    { $set: { role: "ADMIN" } },
    { new: true },
  );

  if (!promoted) {
    return errorResponse("No pudimos actualizar tu cuenta.", 404, "USER_NOT_FOUND");
  }

  const token = await createSessionToken(
    { id: promoted._id.toString(), role: "ADMIN" },
    true,
  );

  const response = NextResponse.json({
    ok: true,
    message: "Tu cuenta ahora es administradora.",
  });

  response.cookies.set(SESSION_COOKIE_NAME, token, {
    ...COOKIE_BASE,
    maxAge: 60 * 60 * 24 * 30,
  });

  return response;
}
