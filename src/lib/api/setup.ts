import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { connectMongoDB } from "@/lib/db/mongodb";
import { getAuthenticatedUser, unauthorized } from "@/lib/api/auth-context";
import { createSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { UserModel } from "@/models/User";
import { AdminBootstrapClaimModel } from "@/models/AdminBootstrapClaim";
import { enforceRateLimit } from "@/lib/security/rate-limit";

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

  const blocked = await enforceRateLimit(request, "admin-bootstrap", 5, 60 * 60 * 1000, user.id);
  if (blocked) return blocked;

  const bootstrapKey = process.env.ADMIN_BOOTSTRAP_KEY?.trim();
  if (!bootstrapKey) {
    return errorResponse("La activación inicial de administrador no está configurada.", 503, "BOOTSTRAP_DISABLED");
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return errorResponse("La solicitud no contiene datos válidos.");
  }
  const providedKey = typeof body.key === "string" ? body.key.trim() : "";
  if (!providedKey || providedKey !== bootstrapKey) {
    return errorResponse("La clave de activación no es correcta.", 403, "INVALID_BOOTSTRAP_KEY");
  }

  let session: mongoose.ClientSession | null = null;
  let promoted: { _id: mongoose.Types.ObjectId } | null = null;

  try {
    await connectMongoDB();
    session = await mongoose.startSession();

    await session.withTransaction(async () => {
      const existingAdmin = await UserModel.exists({ role: "ADMIN" }).session(session!);
      if (existingAdmin) {
        throw new Error("ADMIN_EXISTS");
      }

      // The fixed unique claim and the role update commit together. Competing
      // first-admin requests cannot both acquire this one-time activation.
      await AdminBootstrapClaimModel.create([{
        _id: "initial-admin",
        userId: user.id,
        claimedAt: new Date(),
      }], { session: session! });

      promoted = await UserModel.findOneAndUpdate(
        { _id: user.id, role: "RESELLER", isActive: true },
        { $set: { role: "ADMIN" } },
        { new: true, session: session! },
      ) as unknown as { _id: mongoose.Types.ObjectId } | null;

      if (!promoted) throw new Error("USER_NOT_FOUND");
    });

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
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error
      ? Number(error.code)
      : 0;
    const message = error instanceof Error ? error.message : "";

    if (message === "ADMIN_EXISTS" || code === 11000) {
      return errorResponse("La activación inicial ya fue utilizada o existe un administrador.", 409, "ADMIN_EXISTS");
    }
    if (message === "USER_NOT_FOUND") {
      return errorResponse("No pudimos actualizar tu cuenta.", 404, "USER_NOT_FOUND");
    }

    console.error("[ADMIN_BOOTSTRAP]", error);
    return errorResponse("No pudimos activar el administrador. Inténtalo de nuevo.", 500, "INTERNAL_ERROR");
  } finally {
    if (session) await session.endSession();
  }
}
