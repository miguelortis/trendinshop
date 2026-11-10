import { del, put } from "@vercel/blob";
import sharp from "sharp";
import { NextResponse } from "next/server";
import { connectMongoDB } from "@/lib/db/mongodb";
import { UserModel } from "@/models/User";

const MAX_LOGO_SIZE = 5 * 1024 * 1024;
const RESERVED_STORE_SLUGS = new Set([
  "api", "dashboard", "login", "logout", "register", "tienda",
  "producto", "productos", "favicon-ico", "robots-txt", "sitemap-xml",
]);

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
  storeLogoUrl?: string;
  storeSlug?: string;
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

function normalizeStoreSlug(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

function isOwnedStoreLogo(value: string, userId: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || (
      !url.hostname.endsWith("vercel-storage.com") &&
      !url.hostname.endsWith("blob.vercel-storage.com")
    )) return false;

    const path = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    return path.startsWith("store-logos/" + userId + "/");
  } catch {
    return false;
  }
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
    storeLogoUrl: user.storeLogoUrl ?? "",
    storeSlug: user.storeSlug ?? "",
  };
}

const PROFILE_FIELDS = "_id firstName lastName email phone role storeName storeDescription storeWhatsApp storeLogoUrl storeSlug";

export async function getCommercialProfile(userId: string) {
  try {
    await connectMongoDB();
    const user = await UserModel.findById(userId)
      .select(PROFILE_FIELDS)
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
    const requestedSlug = text(body.storeSlug);
    const storeSlug = requestedSlug ? normalizeStoreSlug(requestedSlug) : "";

    if (storeName.length > 80) {
      return errorResponse("El nombre comercial no puede superar los 80 caracteres.", 400, "STORE_NAME_TOO_LONG");
    }
    if (storeDescription.length > 300) {
      return errorResponse("La descripción no puede superar los 300 caracteres.", 400, "STORE_DESCRIPTION_TOO_LONG");
    }
    if (storeWhatsApp.length > 40) {
      return errorResponse("El WhatsApp no puede superar los 40 caracteres.", 400, "STORE_WHATSAPP_TOO_LONG");
    }
    if (storeWhatsApp && storeWhatsApp.replace(/\D/g, "").length < 7) {
      return errorResponse("Introduce un número de WhatsApp válido con al menos 7 dígitos.", 400, "INVALID_STORE_WHATSAPP");
    }
    if (requestedSlug && (storeSlug.length < 3 || storeSlug.length > 40)) {
      return errorResponse("La dirección personalizada debe tener entre 3 y 40 caracteres.", 400, "INVALID_STORE_SLUG");
    }
    if (storeSlug && RESERVED_STORE_SLUGS.has(storeSlug)) {
      return errorResponse("Esa dirección está reservada. Elige otra.", 400, "RESERVED_STORE_SLUG");
    }

    await connectMongoDB();

    if (storeSlug) {
      const slugExists = await UserModel.exists({ storeSlug, _id: { $ne: userId } });
      if (slugExists) {
        return errorResponse("Esa dirección ya está en uso por otra tienda.", 409, "STORE_SLUG_IN_USE");
      }
    }

    const update: Record<string, unknown> = {
      storeName,
      storeDescription,
      storeWhatsApp,
    };
    if (storeSlug) update.storeSlug = storeSlug;

    const user = await UserModel.findByIdAndUpdate(
      userId,
      {
        $set: update,
        ...(storeSlug ? {} : { $unset: { storeSlug: 1 } }),
      },
      { new: true, runValidators: true },
    )
      .select(PROFILE_FIELDS)
      .lean() as unknown as CommercialProfile | null;

    if (!user) return errorResponse("No encontramos tu cuenta.", 404, "USER_NOT_FOUND");

    return NextResponse.json({
      ok: true,
      profile: serializeProfile(user),
      message: "Perfil comercial actualizado correctamente.",
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
      return errorResponse("Esa dirección ya está en uso por otra tienda.", 409, "STORE_SLUG_IN_USE");
    }
    console.error("[COMMERCIAL_PROFILE_UPDATE]", error);
    return errorResponse("No pudimos guardar el perfil comercial.", 500, "INTERNAL_ERROR");
  }
}

export async function uploadStoreLogo(request: Request, userId: string) {
  let uploadedUrl = "";

  try {
    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return errorResponse("Selecciona una imagen para el logotipo.", 400, "LOGO_REQUIRED");
    }
    if (!file.type.startsWith("image/") || file.size <= 0) {
      return errorResponse("El archivo seleccionado no es una imagen válida.", 400, "INVALID_LOGO_TYPE");
    }
    if (file.size > MAX_LOGO_SIZE) {
      return errorResponse("El logotipo no puede superar los 5 MB.", 400, "LOGO_TOO_LARGE");
    }

    const originalBuffer = Buffer.from(await file.arrayBuffer());
    const image = sharp(originalBuffer, { failOn: "error" });
    const metadata = await image.metadata();
    if (!metadata.format || !["jpeg", "png", "webp", "avif", "gif", "tiff"].includes(metadata.format)) {
      return errorResponse("Usa una imagen JPG, PNG, WebP, AVIF o GIF compatible.", 400, "INVALID_LOGO_FORMAT");
    }

    const optimized = await sharp(originalBuffer)
      .rotate()
      .resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 88, effort: 4 })
      .toBuffer();

    const blob = await put(
      "store-logos/" + userId + "/logo.webp",
      new Blob([optimized], { type: "image/webp" }),
      { access: "public", addRandomSuffix: true },
    );
    uploadedUrl = blob.url;

    await connectMongoDB();
    const previous = await UserModel.findById(userId).select("storeLogoUrl").lean() as { storeLogoUrl?: string } | null;
    const user = await UserModel.findByIdAndUpdate(
      userId,
      { $set: { storeLogoUrl: blob.url } },
      { new: true },
    )
      .select(PROFILE_FIELDS)
      .lean() as unknown as CommercialProfile | null;

    if (!user) {
      await del(blob.url);
      return errorResponse("No encontramos tu cuenta.", 404, "USER_NOT_FOUND");
    }

    if (previous?.storeLogoUrl && previous.storeLogoUrl !== blob.url && isOwnedStoreLogo(previous.storeLogoUrl, userId)) {
      try {
        await del(previous.storeLogoUrl);
      } catch (cleanupError) {
        console.warn("[STORE_LOGO_OLD_IMAGE_CLEANUP]", cleanupError);
      }
    }

    return NextResponse.json({
      ok: true,
      profile: serializeProfile(user),
      message: "Logotipo actualizado correctamente.",
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    if (uploadedUrl) {
      try { await del(uploadedUrl); } catch { /* El Blob puede no estar disponible. */ }
    }
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    console.error("[STORE_LOGO_UPLOAD]", error);
    if (message.includes("token") || message.includes("unauthorized") || message.includes("forbidden") || message.includes("blob")) {
      return errorResponse("Vercel Blob no está conectado o autorizado para este entorno.", 500, "BLOB_NOT_CONFIGURED");
    }
    return errorResponse("No pudimos subir el logotipo. Comprueba el archivo e inténtalo de nuevo.", 500, "LOGO_UPLOAD_FAILED");
  }
}
