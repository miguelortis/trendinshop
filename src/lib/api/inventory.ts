import { NextResponse } from "next/server";
import { connectMongoDB } from "@/lib/db/mongodb";
import { InventoryMovementModel } from "@/models/InventoryMovement";
import { ProductVariantModel } from "@/models/ProductVariant";
import { ProductModel } from "@/models/Product";
import mongoose from "mongoose";

function errorResponse(message: string, status = 400, code = "BAD_REQUEST") {
  return NextResponse.json({ ok: false, error: code, message }, { status });
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function listInventory() {
  try {
    await connectMongoDB();

    const variants = await ProductVariantModel.find({ isActive: true })
      .populate({ path: "productId", model: ProductModel, select: "title sku" })
      .sort({ stock: 1, updatedAt: -1 })
      .lean();

    return NextResponse.json({ ok: true, variants });
  } catch (error) {
    console.error("[INVENTORY_LIST]", error);
    return errorResponse("No pudimos cargar el inventario.", 500, "INTERNAL_ERROR");
  }
}

export async function adjustInventory(request: Request, userId: string, userRole: string) {
  if (userRole !== "ADMIN") {
    return errorResponse("Solo un administrador puede modificar el inventario.", 403, "FORBIDDEN");
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const variantId = text(body.variantId);
    const delta = Number(body.delta);
    const reason = text(body.reason);

    if (!mongoose.isValidObjectId(variantId)) {
      return errorResponse("La variante no es válida.");
    }

    if (!Number.isFinite(delta) || delta === 0) {
      return errorResponse("La cantidad debe ser diferente de cero.");
    }

    await connectMongoDB();

    const variant = await ProductVariantModel.findById(variantId);
    if (!variant || !variant.isActive) {
      return errorResponse("La variante no existe.", 404, "VARIANT_NOT_FOUND");
    }

    const nextStock = variant.stock + delta;
    if (nextStock < 0) {
      return errorResponse("El stock no puede quedar negativo.");
    }

    variant.stock = nextStock;
    await variant.save();

    await InventoryMovementModel.create({
      variantId: variant._id,
      delta,
      type: delta > 0 ? "RESTOCK" : "ADJUSTMENT",
      reason: reason || (delta > 0 ? "Entrada de inventario" : "Salida de inventario"),
      performedBy: userId,
    });

    return NextResponse.json({
      ok: true,
      variant,
      message: "Inventario actualizado.",
    });
  } catch (error) {
    console.error("[INVENTORY_ADJUST]", error);
    return errorResponse("No pudimos actualizar el inventario.", 500, "INTERNAL_ERROR");
  }
}
