import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectMongoDB } from "@/lib/db/mongodb";
import { ProductModel } from "@/models/Product";
import { ProductVariantModel } from "@/models/ProductVariant";
import { ResellerCatalogItemModel } from "@/models/ResellerCatalogItem";

function errorResponse(message: string, status = 400, code = "BAD_REQUEST") {
  return NextResponse.json({ ok: false, error: code, message }, { status });
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseSellingPrice(value: unknown) {
  const price = typeof value === "number" ? value : Number(value);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function requireReseller(userRole: string) {
  return userRole === "RESELLER"
    ? null
    : errorResponse("El catálogo personal está disponible solo para revendedores.", 403, "FORBIDDEN");
}

export async function listResellerCatalog(userId: string, userRole: string) {
  const forbidden = requireReseller(userRole);
  if (forbidden) return forbidden;

  try {
    await connectMongoDB();

    const products = await ProductModel.find({ isActive: true })
      .select("title slug description categoryId sku wholesalePrice images isActive")
      .populate("categoryId", "name slug")
      .sort({ createdAt: -1 })
      .lean();

    const productIds = products.map((product) => product._id);
    const [variants, items] = await Promise.all([
      productIds.length
        ? ProductVariantModel.find({ productId: { $in: productIds }, isActive: true })
            .select("productId stock")
            .lean()
        : Promise.resolve([]),
      ResellerCatalogItemModel.find({ resellerId: userId, isActive: true })
        .sort({ updatedAt: -1 })
        .lean(),
    ]);

    const stockByProductId = new Map<string, number>();
    for (const variant of variants) {
      const productId = String(variant.productId);
      stockByProductId.set(productId, (stockByProductId.get(productId) ?? 0) + variant.stock);
    }

    const safeProducts = products.map((product) => ({
      ...product,
      availableStock: stockByProductId.get(String(product._id)) ?? 0,
    }));

    const safeItems = items.map((item) => ({
      _id: String(item._id),
      productId: String(item.productId),
      sellingPrice: item.sellingPrice,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }));

    return NextResponse.json({ ok: true, products: safeProducts, items: safeItems });
  } catch (error) {
    console.error("[RESELLER_CATALOG_LIST]", error);
    return errorResponse("No pudimos cargar tu catálogo.", 500, "INTERNAL_ERROR");
  }
}

export async function addResellerCatalogItem(request: Request, userId: string, userRole: string) {
  const forbidden = requireReseller(userRole);
  if (forbidden) return forbidden;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const productId = text(body.productId);
    const sellingPrice = parseSellingPrice(body.sellingPrice);

    if (!mongoose.isValidObjectId(productId)) {
      return errorResponse("El producto seleccionado no es válido.", 400, "INVALID_PRODUCT_ID");
    }
    if (sellingPrice === null) {
      return errorResponse("Indica un precio de venta mayor que cero.");
    }

    await connectMongoDB();

    const product = await ProductModel.findOne({ _id: productId, isActive: true })
      .select("_id wholesalePrice")
      .lean();
    if (!product) {
      return errorResponse("El producto ya no está disponible.", 404, "PRODUCT_NOT_FOUND");
    }

    const hasStock = await ProductVariantModel.exists({
      productId,
      isActive: true,
      stock: { $gt: 0 },
    });
    if (!hasStock) {
      return errorResponse("No puedes añadir un producto agotado a tu catálogo.", 409, "PRODUCT_OUT_OF_STOCK");
    }

    const existing = await ResellerCatalogItemModel.findOne({ resellerId: userId, productId }).exec();
    if (existing?.isActive) {
      return errorResponse("Ese producto ya está en tu catálogo.", 409, "CATALOG_ITEM_EXISTS");
    }

    if (existing) {
      existing.sellingPrice = sellingPrice;
      existing.isActive = true;
      await existing.save();
      return NextResponse.json({
        ok: true,
        item: {
          _id: String(existing._id),
          productId: String(existing.productId),
          sellingPrice: existing.sellingPrice,
        },
      });
    }

    const item = await ResellerCatalogItemModel.create({
      resellerId: userId,
      productId,
      sellingPrice,
      isActive: true,
    });

    return NextResponse.json(
      {
        ok: true,
        item: {
          _id: String(item._id),
          productId: String(item.productId),
          sellingPrice: item.sellingPrice,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("[RESELLER_CATALOG_ADD]", error);
    return errorResponse("No pudimos añadir el producto a tu catálogo.", 500, "INTERNAL_ERROR");
  }
}

export async function updateResellerCatalogItem(
  request: Request,
  itemId: string,
  userId: string,
  userRole: string,
) {
  const forbidden = requireReseller(userRole);
  if (forbidden) return forbidden;

  if (!mongoose.isValidObjectId(itemId)) {
    return errorResponse("El producto de tu catálogo no es válido.", 400, "INVALID_CATALOG_ITEM_ID");
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const sellingPrice = parseSellingPrice(body.sellingPrice);
    if (sellingPrice === null) {
      return errorResponse("Indica un precio de venta mayor que cero.");
    }

    await connectMongoDB();
    const item = await ResellerCatalogItemModel.findOne({
      _id: itemId,
      resellerId: userId,
      isActive: true,
    }).exec();

    if (!item) {
      return errorResponse("No encontramos ese producto en tu catálogo.", 404, "CATALOG_ITEM_NOT_FOUND");
    }

    item.sellingPrice = sellingPrice;
    await item.save();

    return NextResponse.json({
      ok: true,
      item: {
        _id: String(item._id),
        productId: String(item.productId),
        sellingPrice: item.sellingPrice,
      },
    });
  } catch (error) {
    console.error("[RESELLER_CATALOG_UPDATE]", error);
    return errorResponse("No pudimos actualizar el precio de venta.", 500, "INTERNAL_ERROR");
  }
}

export async function removeResellerCatalogItem(
  itemId: string,
  userId: string,
  userRole: string,
) {
  const forbidden = requireReseller(userRole);
  if (forbidden) return forbidden;

  if (!mongoose.isValidObjectId(itemId)) {
    return errorResponse("El producto de tu catálogo no es válido.", 400, "INVALID_CATALOG_ITEM_ID");
  }

  try {
    await connectMongoDB();
    const item = await ResellerCatalogItemModel.findOneAndUpdate(
      { _id: itemId, resellerId: userId, isActive: true },
      { $set: { isActive: false } },
      { new: true },
    ).exec();

    if (!item) {
      return errorResponse("No encontramos ese producto en tu catálogo.", 404, "CATALOG_ITEM_NOT_FOUND");
    }

    return NextResponse.json({ ok: true, message: "Producto retirado de tu catálogo." });
  } catch (error) {
    console.error("[RESELLER_CATALOG_REMOVE]", error);
    return errorResponse("No pudimos quitar el producto de tu catálogo.", 500, "INTERNAL_ERROR");
  }
}
