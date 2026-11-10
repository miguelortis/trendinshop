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

type CatalogVariantPrice = { variantId: string; sellingPrice: number };

function parseVariantPrices(value: unknown): CatalogVariantPrice[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 500) return null;
  const seen = new Set<string>();
  const result: CatalogVariantPrice[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") return null;
    const row = raw as Record<string, unknown>;
    const variantId = text(row.variantId);
    const sellingPrice = parseSellingPrice(row.sellingPrice);
    if (!mongoose.isValidObjectId(variantId) || sellingPrice === null || seen.has(variantId)) return null;
    seen.add(variantId);
    result.push({ variantId, sellingPrice });
  }
  return result;
}

async function validateVariantPrices(value: unknown, productId: string) {
  const parsed = parseVariantPrices(value);
  if (!parsed) return null;
  if (!parsed.length) return [];
  const valid = await ProductVariantModel.find({
    _id: { $in: parsed.map((item) => item.variantId) },
    productId,
    isActive: true,
  }).select("_id").lean();
  if (valid.length !== parsed.length) return null;
  return parsed.map((item) => ({
    variantId: new mongoose.Types.ObjectId(item.variantId),
    sellingPrice: item.sellingPrice,
  }));
}

function requireCatalogUser(userRole: string) {
  return userRole === "RESELLER" || userRole === "ADMIN"
    ? null
    : errorResponse("Tu cuenta no tiene acceso al catálogo personal.", 403, "FORBIDDEN");
}

export async function listResellerCatalog(userId: string, userRole: string) {
  const forbidden = requireCatalogUser(userRole);
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
            .select("productId stock label sku options wholesalePrice")
            .lean()
        : Promise.resolve([]),
      ResellerCatalogItemModel.find({ resellerId: userId, isActive: true })
        .sort({ updatedAt: -1 })
        .lean(),
    ]);

    const stockByProductId = new Map<string, number>();
    const variantsByProductId = new Map<string, typeof variants>();
    for (const variant of variants) {
      const variantProductId = String(variant.productId);
      const variantRows = variantsByProductId.get(variantProductId) ?? [];
      variantRows.push(variant);
      variantsByProductId.set(variantProductId, variantRows);
      const productId = String(variant.productId);
      stockByProductId.set(productId, (stockByProductId.get(productId) ?? 0) + variant.stock);
    }

    const safeProducts = products.map((product) => ({
      ...product,
      availableStock: stockByProductId.get(String(product._id)) ?? 0,
      variants: (variantsByProductId.get(String(product._id)) ?? []).map((variant) => ({
        _id: String(variant._id),
        label: variant.label,
        sku: variant.sku,
        options: variant.options ?? [],
        stock: variant.stock,
        wholesalePrice: variant.wholesalePrice ?? product.wholesalePrice,
      })),
    }));

    const safeItems = items.map((item) => ({
      _id: String(item._id),
      productId: String(item.productId),
      sellingPrice: item.sellingPrice,
      variantPrices: (item.variantPrices ?? []).map((price: { variantId: mongoose.Types.ObjectId | string; sellingPrice: number }) => ({ variantId: String(price.variantId), sellingPrice: price.sellingPrice })),
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
  const forbidden = requireCatalogUser(userRole);
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

    const variantPrices = await validateVariantPrices(body.variantPrices, productId);
    if (!variantPrices) return errorResponse("Revisa los precios por variante. Cada variante debe pertenecer al producto y tener un precio válido.");

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
      existing.variantPrices = variantPrices;
      existing.isActive = true;
      await existing.save();
      return NextResponse.json({
        ok: true,
        item: {
          _id: String(existing._id),
          productId: String(existing.productId),
          sellingPrice: existing.sellingPrice,
          variantPrices: (existing.variantPrices ?? []).map((price: { variantId: mongoose.Types.ObjectId | string; sellingPrice: number }) => ({ variantId: String(price.variantId), sellingPrice: price.sellingPrice })),
        },
      });
    }

    const item = await ResellerCatalogItemModel.create({
      resellerId: userId,
      productId,
      sellingPrice,
      variantPrices,
      isActive: true,
    });

    return NextResponse.json(
      {
        ok: true,
        item: {
          _id: String(item._id),
          productId: String(item.productId),
          sellingPrice: item.sellingPrice,
          variantPrices: (item.variantPrices ?? []).map((price: { variantId: mongoose.Types.ObjectId | string; sellingPrice: number }) => ({ variantId: String(price.variantId), sellingPrice: price.sellingPrice })),
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
  const forbidden = requireCatalogUser(userRole);
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

    const variantPrices = await validateVariantPrices(body.variantPrices, String(item.productId));
    if (!variantPrices) return errorResponse("Revisa los precios por variante. Cada variante debe pertenecer al producto y tener un precio válido.");

    item.sellingPrice = sellingPrice;
    item.variantPrices = variantPrices;
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
  const forbidden = requireCatalogUser(userRole);
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
