import { cleanupPendingProductImages } from "@/lib/api/blob";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const authorization = request.headers.get("authorization");

  if (!cronSecret || authorization !== "Bearer " + cronSecret) {
    return Response.json(
      { ok: false, message: "No autorizado." },
      { status: 401 },
    );
  }

  try {
    const deleted = await cleanupPendingProductImages();

    return Response.json({
      ok: true,
      deleted,
      message: "Limpieza de imágenes temporales completada.",
    });
  } catch (error) {
    console.error("[CRON_PRODUCT_IMAGE_CLEANUP]", error);

    return Response.json(
      {
        ok: false,
        message: "No pudimos completar la limpieza de imágenes temporales.",
      },
      { status: 500 },
    );
  }
}
