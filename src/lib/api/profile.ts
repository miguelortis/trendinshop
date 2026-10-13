import { NextResponse } from "next/server";
import { connectMongoDB } from "@/lib/db/mongodb";
import { UserModel } from "@/models/User";

type CommercialProfile = {
  _id: { toString(): string };
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  role: "ADMIN" | "RESELLER";
  storeName?: string;
  storeDescription?: string;
  storeWhatsApp?: string;
};

function errorResponse(message: string, status = 400, code = "BAD_REQUEST") {
  return NextResponse.json(
    { ok: false, error: code, message },
    { status, headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function serializeProfile(user: CommercialProfile) {
  return {
    id: user._id.toString(),
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    phone: user.phone,
    role: user.role,
    storeName: user.storeName ?? "",
    storeDescription: user.storeDescription ?? "",
    storeWhatsApp: user.storeWhatsApp ?? "",
  };
}

export async function getCommercialProfile(userId: string) {
  try {
    await connectMongoDB();
    const user = await UserModel.findById(userId)
      .select("_id firstName lastName email phone role storeName storeDescription storeWhatsApp")
      .lean() as unknown as CommercialProfile | null;

    if (!user) return errorResponse("No encontramos tu cuenta.", 404, "USER_NOT_FOUND");

    return NextResponse.json({
      ok: true,
      profile: serializeProfile(user),
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    console.error("[COMMERCIAL_PROFILE_GET]", error);
    return errorResponse("No pudimos cargar el perfil comercial.", 500, "INTERNAL_ERROR");
  }
}

export async function updateCommercialProfile(request: Request, userId: string) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const storeName = text(body.storeName);
    const storeDescription = text(body.storeDescription);
    const storeWhatsApp = text(body.storeWhatsApp);

    if (storeName.length > 80) {
      return errorResponse("El nombre comercial no puede superar los 80 caracteres.", 400, "STORE_NAME_TOO_LONG");
    }
    if (storeDescription.length > 300) {
      return errorResponse("La descripción no puede superar los 300 caracteres.", 400, "STORE_DESCRIPTION_TOO_LONG");
    }
    if (storeWhatsApp.length > 40) {
      return errorResponse("El WhatsApp no puede superar los 40 caracteres.", 400, "STORE_WHATSAPP_TOO_LONG");
    }
    if (storeWhatsApp && storeWhatsApp.replace(/\\D/g, "").length < 7) {
      return errorResponse("Introduce un número de WhatsApp válido con al menos 7 dígitos.", 400, "INVALID_STORE_WHATSAPP");
    }

    await connectMongoDB();
    const user = await UserModel.findByIdAndUpdate(
      userId,
      { $set: { storeName, storeDescription, storeWhatsApp } },
      { new: true, runValidators: true },
    )
      .select("_id firstName lastName email phone role storeName storeDescription storeWhatsApp")
      .lean() as unknown as CommercialProfile | null;

    if (!user) return errorResponse("No encontramos tu cuenta.", 404, "USER_NOT_FOUND");

    return NextResponse.json({
      ok: true,
      profile: serializeProfile(user),
      message: "Perfil comercial actualizado correctamente.",
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    console.error("[COMMERCIAL_PROFILE_UPDATE]", error);
    return errorResponse("No pudimos guardar el perfil comercial.", 500, "INTERNAL_ERROR");
  }
}
