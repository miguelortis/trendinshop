import { NextResponse } from "next/server";
import { connectMongoDB } from "@/lib/db/mongodb";
import { assertAuthConfiguration, createSessionToken, SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth/session";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { UserModel } from "@/models/User";

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
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const documentId = text(body.documentId);
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

    if (password.length < 8) {
      return errorResponse("La contraseña debe tener al menos 8 caracteres.");
    }

    if (password !== confirmPassword) {
      return errorResponse("Las contraseñas no coinciden.");
    }

    const parsedBirthDate = new Date(birthDate);
    if (Number.isNaN(parsedBirthDate.getTime())) {
      return errorResponse("La fecha de nacimiento no es válida.");
    }

    if (parsedBirthDate > new Date()) {
      return errorResponse("La fecha de nacimiento no puede estar en el futuro.");
    }

    if (!["female", "male", "unspecified"].includes(gender)) {
      return errorResponse("Selecciona un género válido.");
    }

    assertAuthConfiguration();
    await connectMongoDB();

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

    try {
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
    } catch (sessionError) {
      await UserModel.deleteOne({ _id: user._id });
      throw sessionError;
    }
  } catch (error) {
    console.error("[AUTH_REGISTER]", error);
    return errorResponse("No pudimos crear la cuenta. Inténtalo de nuevo.", 500, "INTERNAL_ERROR");
  }
}

export async function loginUser(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const userEmail = email(body.email);
    const password = typeof body.password === "string" ? body.password : "";
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
