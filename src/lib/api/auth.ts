import { createHash, randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { connectMongoDB } from "@/lib/db/mongodb";
import { assertAuthConfiguration, createSessionToken, SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth/session";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { UserModel } from "@/models/User";
import { CustomerIdentityModel } from "@/models/CustomerIdentity";
import { PasswordResetTokenModel } from "@/models/PasswordResetToken";
import { normalizeCustomerDocumentId } from "@/lib/customer-session";
import { enforceRateLimit } from "@/lib/security/rate-limit";

const COOKIE_BASE = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

type AuthUser = {
  _id: { toString(): string };
  documentId: string;
  firstName: string;
  lastName: string;
  email: string;
  gender: string;
  birthDate: Date;
  phone: string;
  role: string;
  isActive: boolean;
};

function publicUser(user: AuthUser) {
  return {
    id: user._id.toString(),
    documentId: user.documentId,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    gender: user.gender,
    birthDate: user.birthDate,
    phone: user.phone,
    role: user.role as "ADMIN" | "RESELLER",
    isActive: user.isActive,
  };
}

function errorResponse(message: string, status = 400, code = "BAD_REQUEST") {
  return NextResponse.json({ ok: false, error: code, message }, { status });
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function email(value: unknown) {
  return text(value).toLowerCase();
}

export async function registerUser(request: Request) {
  let createdUserId = "";
  try {
    const blocked = await enforceRateLimit(request, "register", 6, 60 * 60 * 1000);
    if (blocked) return blocked;

    const body = (await request.json()) as Record<string, unknown>;
    const documentId = normalizeCustomerDocumentId(body.documentId);
    const firstName = text(body.firstName);
    const lastName = text(body.lastName);
    const userEmail = email(body.email);
    const phone = text(body.phone);
    const password = typeof body.password === "string" ? body.password : "";
    const confirmPassword = typeof body.confirmPassword === "string" ? body.confirmPassword : "";
    const gender = text(body.gender);
    const birthDate = text(body.birthDate);

    if (!documentId || !firstName || !lastName || !userEmail || !phone || !password || !confirmPassword || !gender || !birthDate) {
      return errorResponse("Completa todos los campos obligatorios.");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmail)) {
      return errorResponse("Introduce un correo electrónico válido.");
    }
    if (password.length < 8) return errorResponse("La contraseña debe tener al menos 8 caracteres.");
    if (password !== confirmPassword) return errorResponse("Las contraseñas no coinciden.");

    const parsedBirthDate = new Date(birthDate);
    if (Number.isNaN(parsedBirthDate.getTime())) return errorResponse("La fecha de nacimiento no es válida.");
    if (parsedBirthDate > new Date()) return errorResponse("La fecha de nacimiento no puede estar en el futuro.");
    if (!["female", "male", "unspecified"].includes(gender)) return errorResponse("Selecciona un género válido.");

    assertAuthConfiguration();
    await connectMongoDB();

    const existingIdentity = await CustomerIdentityModel.findOne({ documentId, isActive: true })
      .select("convertedUserId")
      .lean() as unknown as { convertedUserId?: unknown } | null;
    if (existingIdentity?.convertedUserId) {
      return errorResponse("Ya existe una cuenta asociada a esta cédula. Inicia sesión o recupera tu contraseña.", 409, "DOCUMENT_IN_USE");
    }

    const [emailExists, documentExists] = await Promise.all([
      UserModel.exists({ email: userEmail }),
      UserModel.exists({ documentId }),
    ]);
    if (emailExists) return errorResponse("Ya existe una cuenta con ese correo.", 409, "EMAIL_IN_USE");
    if (documentExists) return errorResponse("Ya existe una cuenta con esa cédula.", 409, "DOCUMENT_IN_USE");

    const passwordHash = await hashPassword(password);
    const user = await UserModel.create({
      documentId,
      firstName,
      lastName,
      email: userEmail,
      passwordHash,
      gender,
      birthDate: parsedBirthDate,
      phone,
      role: "RESELLER",
      isActive: true,
    });
    createdUserId = user._id.toString();

    // Si el comprador tenía un perfil de cliente sin contraseña, el registro
    // vincula el perfil a la cuenta y sustituye sus datos con los verificados
    // por el propio usuario en este formulario.
    await CustomerIdentityModel.findOneAndUpdate(
      { documentId },
      {
        $set: {
          documentId,
          firstName,
          lastName,
          phone,
          email: userEmail,
          dataProcessingConsent: true,
          dataProcessingConsentAt: new Date(),
          sessionTokenHashes: [],
          convertedUserId: user._id,
          isActive: true,
        },
        $setOnInsert: {
          notificationsWhatsAppConsent: false,
          notificationsEmailConsent: false,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).exec();

    const token = await createSessionToken(
      { id: user._id.toString(), role: user.role as "ADMIN" | "RESELLER" },
      true,
    );
    const response = NextResponse.json(
      { ok: true, user: publicUser(user), message: "Cuenta creada correctamente." },
      { status: 201 },
    );
    response.cookies.set(SESSION_COOKIE_NAME, token, {
      ...COOKIE_BASE,
      maxAge: 60 * 60 * 24 * 30,
    });
    return response;
  } catch (error) {
    if (createdUserId) {
      try { await UserModel.deleteOne({ _id: createdUserId }); } catch { /* Evitar dejar una cuenta parcial. */ }
    }
    if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
      return errorResponse("Ya existe una cuenta con esa cédula o correo.", 409, "DUPLICATE_ACCOUNT");
    }
    console.error("[AUTH_REGISTER]", error);
    return errorResponse("No pudimos crear la cuenta. Inténtalo de nuevo.", 500, "INTERNAL_ERROR");
  }
}

export async function loginUser(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const userEmail = email(body.email);
    const password = typeof body.password === "string" ? body.password : "";
    const blocked = await enforceRateLimit(request, "login", 8, 15 * 60 * 1000, userEmail);
    if (blocked) return blocked;
    const remember = body.remember !== false;

    if (!userEmail || !password) {
      return errorResponse("Introduce tu correo y contraseña.");
    }

    await connectMongoDB();
    const user = await UserModel.findOne({ email: userEmail }).select("+passwordHash");

    if (!user) return errorResponse("El correo o la contraseña no son correctos.", 401, "INVALID_CREDENTIALS");
    if (!user.isActive) return errorResponse("Tu cuenta está desactivada. Contacta al administrador.", 403, "ACCOUNT_DISABLED");

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) return errorResponse("El correo o la contraseña no son correctos.", 401, "INVALID_CREDENTIALS");

    const token = await createSessionToken({ id: user._id.toString(), role: user.role }, remember);
    const response = NextResponse.json({ ok: true, user: publicUser(user), message: "Inicio de sesión correcto." });

    response.cookies.set(SESSION_COOKIE_NAME, token, {
      ...COOKIE_BASE,
      ...(remember ? { maxAge: 60 * 60 * 24 * 30 } : {}),
    });

    return response;
  } catch (error) {
    console.error("[AUTH_LOGIN]", error);
    return errorResponse("No pudimos iniciar sesión. Inténtalo de nuevo.", 500, "INTERNAL_ERROR");
  }
}


function escapeHtml(value: string) {
  const entities: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return value.replace(/[&<>"']/g, (character) => entities[character] ?? character);
}

export async function requestPasswordReset(request: Request) {
  try {
    const ipBlocked = await enforceRateLimit(request, "password-reset-ip", 4, 60 * 60 * 1000);
    if (ipBlocked) return ipBlocked;

    const body = await request.json() as Record<string, unknown>;
    const userEmail = email(body.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmail)) {
      return errorResponse("Introduce un correo electrónico válido.");
    }
    const accountBlocked = await enforceRateLimit(request, "password-reset-account", 3, 60 * 60 * 1000, userEmail);
    if (accountBlocked) return accountBlocked;

    const apiKey = process.env.RESEND_API_KEY?.trim();
    const from = process.env.AUTH_EMAIL_FROM?.trim();
    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
    if (!apiKey || !from || !appUrl) {
      return errorResponse("La recuperación de contraseña todavía no está configurada. Contacta al administrador.", 503, "PASSWORD_RESET_NOT_CONFIGURED");
    }

    await connectMongoDB();
    const user = await UserModel.findOne({ email: userEmail, isActive: true })
      .select("_id firstName email")
      .lean() as unknown as { _id: mongoose.Types.ObjectId; firstName: string; email: string } | null;

    // Do not reveal whether an email address belongs to an account.
    if (!user) {
      return NextResponse.json({
        ok: true,
        message: "Si existe una cuenta activa con ese correo, recibirás un enlace para restablecer la contraseña.",
      });
    }

    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await PasswordResetTokenModel.updateMany(
      { userId: user._id, usedAt: null },
      { $set: { usedAt: new Date() } },
    );
    await PasswordResetTokenModel.create({
      userId: user._id,
      tokenHash,
      expiresAt,
      usedAt: null,
    });

    const resetUrl = new URL("/reset-password", appUrl);
    resetUrl.searchParams.set("token", rawToken);
    const displayName = escapeHtml(user.firstName || "usuario");
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [user.email],
        subject: "Restablece tu contraseña de TrendinShop",
        html: "<p>Hola " + displayName + ",</p><p>Recibimos una solicitud para restablecer la contraseña de tu cuenta.</p><p><a href=\"" + resetUrl.toString() + "\">Crear una nueva contraseña</a></p><p>Este enlace caduca en una hora y solo puede utilizarse una vez. Si no solicitaste este cambio, ignora este mensaje.</p>",
      }),
    });

    if (!response.ok) {
      await PasswordResetTokenModel.deleteOne({ tokenHash });
      console.error("[PASSWORD_RESET_EMAIL] Provider rejected the message:", response.status);
      return NextResponse.json({
        ok: true,
        message: "Si existe una cuenta activa con ese correo, recibirás un enlace para restablecer la contraseña.",
      });
    }

    return NextResponse.json({
      ok: true,
      message: "Si existe una cuenta activa con ese correo, recibirás un enlace para restablecer la contraseña.",
    });
  } catch (error) {
    console.error("[PASSWORD_RESET_REQUEST]", error);
    return errorResponse("No pudimos procesar la solicitud. Inténtalo de nuevo.", 500, "INTERNAL_ERROR");
  }
}

export async function resetPassword(request: Request) {
  let session: mongoose.ClientSession | null = null;
  try {
    const blocked = await enforceRateLimit(request, "password-reset-complete", 8, 15 * 60 * 1000);
    if (blocked) return blocked;

    const body = await request.json() as Record<string, unknown>;
    const rawToken = text(body.token);
    const password = typeof body.password === "string" ? body.password : "";
    const confirmPassword = typeof body.confirmPassword === "string" ? body.confirmPassword : "";

    if (!/^[a-f0-9]{64}$/i.test(rawToken)) {
      return errorResponse("El enlace de recuperación no es válido o ya caducó.", 400, "INVALID_RESET_TOKEN");
    }
    if (password.length < 8) return errorResponse("La contraseña debe tener al menos 8 caracteres.");
    if (password !== confirmPassword) return errorResponse("Las contraseñas no coinciden.");

    await connectMongoDB();
    session = await mongoose.startSession();
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const now = new Date();
    const passwordHash = await hashPassword(password);
    let completed = false;

    await session.withTransaction(async () => {
      const reset = await PasswordResetTokenModel.findOne({
        tokenHash,
        usedAt: null,
        expiresAt: { $gt: now },
      }).session(session!).exec();

      if (!reset) throw new Error("INVALID_RESET_TOKEN");

      const user = await UserModel.findOne({ _id: reset.userId, isActive: true })
        .session(session!).exec();
      if (!user) throw new Error("INVALID_RESET_TOKEN");

      user.passwordHash = passwordHash;
      user.sessionInvalidBefore = new Date(Date.now() + 1000);
      await user.save({ session: session! });

      reset.usedAt = now;
      await reset.save({ session: session! });
      await PasswordResetTokenModel.updateMany(
        { userId: user._id, _id: { $ne: reset._id }, usedAt: null },
        { $set: { usedAt: now } },
        { session: session! },
      );
      completed = true;
    });

    if (!completed) return errorResponse("El enlace de recuperación no es válido o ya caducó.", 400, "INVALID_RESET_TOKEN");
    return NextResponse.json({
      ok: true,
      message: "Tu contraseña se actualizó correctamente. Inicia sesión con la nueva contraseña.",
    });
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_RESET_TOKEN") {
      return errorResponse("El enlace de recuperación no es válido o ya caducó.", 400, "INVALID_RESET_TOKEN");
    }
    console.error("[PASSWORD_RESET_COMPLETE]", error);
    return errorResponse("No pudimos actualizar la contraseña. Inténtalo de nuevo.", 500, "INTERNAL_ERROR");
  } finally {
    if (session) await session.endSession();
  }
}

export async function getCurrentUser(request: Request) {
  try {
    const cookieHeader = request.headers.get("cookie") ?? "";
    const token = cookieHeader
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(SESSION_COOKIE_NAME + "="))
      ?.slice((SESSION_COOKIE_NAME + "=").length);

    if (!token) return errorResponse("No hay una sesión activa.", 401, "UNAUTHENTICATED");

    const payload = await verifySessionToken(decodeURIComponent(token));
    await connectMongoDB();

    const user = await UserModel.findById(payload.sub);
    if (!user || !user.isActive) return errorResponse("La sesión ya no es válida.", 401, "UNAUTHENTICATED");
    if (user.sessionInvalidBefore && Number(payload.iat ?? 0) < Math.floor(user.sessionInvalidBefore.getTime() / 1000)) {
      return errorResponse("La sesión ya no es válida. Inicia sesión nuevamente.", 401, "UNAUTHENTICATED");
    }

    return NextResponse.json({ ok: true, user: publicUser(user) });
  } catch {
    return errorResponse("La sesión ya no es válida.", 401, "UNAUTHENTICATED");
  }
}

export function logoutUser() {
  const response = NextResponse.json({ ok: true, message: "Sesión cerrada." });
  response.cookies.set(SESSION_COOKIE_NAME, "", { ...COOKIE_BASE, maxAge: 0 });
  return response;
}
