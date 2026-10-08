import { del, list, put } from "@vercel/blob";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import sharp from "sharp";
import { NextResponse } from "next/server";
import { getAuthenticatedUser, unauthorized } from "@/lib/api/auth-context";

const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const PENDING_IMAGE_PREFIX = "pending/products/";
const PENDING_IMAGE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
];

function errorResponse(message: string, status = 400, code = "BAD_REQUEST") {
  return NextResponse.json({ ok: false, error: code, message }, { status });
}

function getBlobFailureMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  const normalized = message.toLowerCase();

  if (
    normalized.includes("token") ||
    normalized.includes("access denied") ||
    normalized.includes("unauthorized") ||
    normalized.includes("forbidden") ||
    normalized.includes("blob store")
  ) {
    return "Vercel Blob no está conectado o autorizado para este entorno de Vercel.";
  }

  return fallback;
}

function isAllowedBlobUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      (url.hostname.endsWith("vercel-storage.com") || url.hostname.endsWith("blob.vercel-storage.com"))
    );
  } catch {
    return false;
  }
}

function isBlockedHost(hostname: string) {
  const host = hostname.toLowerCase();

  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host === "::1" ||
    host.startsWith("127.") ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    host.startsWith("169.254.")
  ) {
    return true;
  }

  const parts = host.split(".");
  if (parts.length === 4 && parts.every((part) => /^\d+$/.test(part))) {
    const [a, b] = parts.map(Number);
    if (a === 172 && b >= 16 && b <= 31) return true;
  }

  return false;
}

export async function prepareBlobUpload(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();

  try {
    const body = (await request.json()) as HandleUploadBody;

    const jsonResponse = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname) => {
        const safePathname = pathname.replace(/[^a-zA-Z0-9._/-]/g, "_");
        return {
          pathname: PENDING_IMAGE_PREFIX + user.id + "/" + safePathname,
          allowedContentTypes: ALLOWED_IMAGE_TYPES,
          maximumSizeInBytes: MAX_IMAGE_SIZE,
          addRandomSuffix: true,
        };
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    console.error("[BLOB_UPLOAD]", error);
    return errorResponse(
      getBlobFailureMessage(error, "No pudimos preparar la subida de la imagen."),
      500,
      "UPLOAD_ERROR",
    );
  }
}

export async function importImageFromUrl(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const rawUrl = typeof body.url === "string" ? body.url.trim() : "";

    if (!rawUrl) return errorResponse("Introduce una URL de imagen.");

    const source = new URL(rawUrl);
    if (source.protocol !== "http:" && source.protocol !== "https:") {
      return errorResponse("La URL debe comenzar con http:// o https://.");
    }

    if (isBlockedHost(source.hostname)) {
      return errorResponse("No podemos importar imágenes desde esa dirección.", 400, "BLOCKED_URL");
    }

    const response = await fetch(source, {
      signal: AbortSignal.timeout(15_000),
      headers: { Accept: "image/*" },
    });

    if (!response.ok) {
      return errorResponse("No pudimos descargar la imagen desde esa URL.", 400, "IMAGE_FETCH_FAILED");
    }

    const contentType = response.headers.get("content-type")?.split(";")[0].toLowerCase() ?? "";
    const contentLength = Number(response.headers.get("content-length") ?? 0);

    if (!ALLOWED_IMAGE_TYPES.includes(contentType)) {
      return errorResponse("La URL no contiene una imagen compatible.", 400, "INVALID_IMAGE_TYPE");
    }

    if (contentLength && contentLength > MAX_IMAGE_SIZE) {
      return errorResponse("La imagen supera el máximo de 10 MB.", 400, "IMAGE_TOO_LARGE");
    }

    const originalBuffer = Buffer.from(await response.arrayBuffer());
    if (originalBuffer.byteLength > MAX_IMAGE_SIZE) {
      return errorResponse("La imagen supera el máximo de 10 MB.", 400, "IMAGE_TOO_LARGE");
    }

    let uploadBuffer = originalBuffer;
    let uploadContentType = contentType;
    let extension = contentType.split("/")[1] || "jpg";

    // Optimize remote product images on the server as well, so URL imports
    // receive the same mobile-friendly treatment as local/pasted images.
    if (contentType !== "image/gif") {
      const optimizedBuffer = await sharp(originalBuffer)
        .rotate()
        .resize({
          width: 1600,
          height: 1600,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 84 })
        .toBuffer();

      if (optimizedBuffer.length < originalBuffer.length) {
        uploadBuffer = optimizedBuffer;
        uploadContentType = "image/webp";
        extension = "webp";
      }
    }

    const pathname =
      PENDING_IMAGE_PREFIX + user.id + "/imported-" + Date.now() + "." + extension;

    const blob = await put(pathname, new Blob([uploadBuffer], { type: uploadContentType }), {
      access: "public",
      addRandomSuffix: true,
    });

    return NextResponse.json({ ok: true, blob });
  } catch (error) {
    console.error("[BLOB_IMPORT_URL]", error);
    return errorResponse(
      getBlobFailureMessage(error, "No pudimos importar esa imagen."),
      500,
      "IMPORT_ERROR",
    );
  }
}

export function isPendingProductImageUrl(value: string, userId: string) {
  try {
    const url = new URL(value);

    if (
      url.protocol !== "https:" &&
      url.protocol !== "http:"
    ) {
      return false;
    }

    if (
      !url.hostname.endsWith("vercel-storage.com") &&
      !url.hostname.endsWith("blob.vercel-storage.com")
    ) {
      return false;
    }

    const pathname = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    return pathname.startsWith(PENDING_IMAGE_PREFIX + userId + "/");
  } catch {
    return false;
  }
}

export async function cleanupPendingProductImagesForUser(
  userId: string,
  maxAgeMs = PENDING_IMAGE_MAX_AGE_MS,
) {
  const prefix = PENDING_IMAGE_PREFIX + userId + "/";
  const cutoff = Date.now() - maxAgeMs;
  let cursor: string | undefined;
  let deleted = 0;

  do {
    const result = await list({
      prefix,
      limit: 1000,
      ...(cursor ? { cursor } : {}),
    });

    const expired = result.blobs.filter(
      (blob) => new Date(blob.uploadedAt).getTime() < cutoff,
    );

    if (expired.length) {
      await del(expired.map((blob) => blob.url));
      deleted += expired.length;
    }

    cursor = result.hasMore ? result.cursor : undefined;
  } while (cursor);

  return deleted;
}

export async function cleanupPendingProductImages(
  maxAgeMs = PENDING_IMAGE_MAX_AGE_MS,
) {
  const cutoff = Date.now() - maxAgeMs;
  let cursor: string | undefined;
  let deleted = 0;

  do {
    const result = await list({
      prefix: PENDING_IMAGE_PREFIX,
      limit: 1000,
      ...(cursor ? { cursor } : {}),
    });

    const expired = result.blobs.filter(
      (blob) => new Date(blob.uploadedAt).getTime() < cutoff,
    );

    if (expired.length) {
      await del(expired.map((blob) => blob.url));
      deleted += expired.length;
    }

    cursor = result.hasMore ? result.cursor : undefined;
  } while (cursor);

  return deleted;
}

export async function deleteBlob(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const url = typeof body.url === "string" ? body.url.trim() : "";

    if (!url || !isAllowedBlobUrl(url)) {
      return errorResponse("La imagen no pertenece al almacenamiento de TrendinShop.");
    }

    await del(url);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[BLOB_DELETE]", error);
    return errorResponse("No pudimos eliminar la imagen.", 500, "DELETE_ERROR");
  }
}
