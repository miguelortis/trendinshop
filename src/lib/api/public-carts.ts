import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectMongoDB } from "@/lib/db/mongodb";
import { ProductModel } from "@/models/Product";
import { ProductVariantModel } from "@/models/ProductVariant";
import { PublicCartShareModel } from "@/models/PublicCartShare";
import { ResellerCatalogItemModel } from "@/models/ResellerCatalogItem";
import { UserModel } from "@/models/User";

type CartInputItem = { productId: string; variantId: string; quantity: number };
type SellerRecord = {
  _id: mongoose.Types.ObjectId;
  firstName: string;
  lastName: string;
  phone?: string;
  role: "ADMIN" | "RESELLER";
  storeName?: string;
  storeSlug?: string;
  storeLogoUrl?: string;
};
type ProductRecord = { _id: mongoose.Types.ObjectId; title: string; sku: string };
type VariantRecord = {
  _id: mongoose.Types.ObjectId;
  productId: mongoose.Types.ObjectId;
  label: string;
  sku: string;
  stock: number;
};
type CatalogItemRecord = { productId: mongoose.Types.ObjectId; sellingPrice: number };
type SnapshotItem = {
  productId: mongoose.Types.ObjectId;
  variantId: mongoose.Types.ObjectId;
  quantity: number;
  productTitle: string;
  variantLabel: string;
  unitPrice: number;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
function toCents(value: number) {
  return Math.round((value + Number.EPSILON) * 100);
}
function fromCents(value: number) {
  return Number((value / 100).toFixed(2));
}
function errorResponse(message: string, status = 400, code = "BAD_REQUEST") {
  return NextResponse.json({ ok: false, error: code, message }, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
function normalizeCartItems(value: unknown): CartInputItem[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 30) return null;
  const output: CartInputItem[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object") return null;
    const item = raw as Record<string, unknown>;
    const productId = text(item.productId);
    const variantId = text(item.variantId);
    const quantity = Number(item.quantity);
    if (!/^[a-f0-9]{24}$/i.test(productId) || !/^[a-f0-9]{24}$/i.test(variantId) ||
      !Number.isInteger(quantity) || quantity < 1 || quantity > 100) return null;
    if (seen.has(variantId)) return null;
    seen.add(variantId);
    output.push({ productId, variantId, quantity });
  }
  return output;
}
function serializeSeller(seller: SellerRecord) {
  return {
    id: String(seller._id),
    name: seller.storeName?.trim() || [seller.firstName, seller.lastName].filter(Boolean).join(" "),
    phone: seller.phone ?? "",
    logoUrl: seller.storeLogoUrl ?? "",
    slug: seller.storeSlug?.trim() || String(seller._id),
  };
}
async function findSeller(resellerId: string) {
  if (!/^[a-f0-9]{24}$/i.test(resellerId)) return null;
  return await UserModel.findOne({
    _id: resellerId,
    role: { $in: ["ADMIN", "RESELLER"] },
    isActive: true,
  }).select("_id firstName lastName phone role storeName storeSlug storeLogoUrl").lean() as unknown as SellerRecord | null;
}

async function hydrateCartItems(
  seller: SellerRecord,
  items: CartInputItem[],
  snapshots: SnapshotItem[] = [],
  strict = false,
) {
  const variantIds = items.map((item) => new mongoose.Types.ObjectId(item.variantId));
  const productIds = [...new Set(items.map((item) => item.productId))];
  const [products, variants, catalogItems] = await Promise.all([
    ProductModel.find({ _id: { $in: productIds }, isActive: true })
      .select("_id title sku").lean() as unknown as Promise<ProductRecord[]>,
    ProductVariantModel.find({ _id: { $in: variantIds }, isActive: true })
      .select("_id productId label sku stock").lean() as unknown as Promise<VariantRecord[]>,
    ResellerCatalogItemModel.find({
      resellerId: seller._id,
      productId: { $in: productIds },
      isActive: true,
    }).select("productId sellingPrice").lean() as unknown as Promise<CatalogItemRecord[]>,
  ]);
  const productById = new Map(products.map((product) => [String(product._id), product]));
  const variantById = new Map(variants.map((variant) => [String(variant._id), variant]));
  const priceByProductId = new Map(catalogItems.map((item) => [String(item.productId), item.sellingPrice]));
  const snapshotByVariantId = new Map(snapshots.map((item) => [String(item.variantId), item]));
  const output = items.map((input) => {
    const product = productById.get(input.productId);
    const variant = variantById.get(input.variantId);
    const snapshot = snapshotByVariantId.get(input.variantId);
    const catalogPrice = priceByProductId.get(input.productId);
    const sameProduct = variant && String(variant.productId) === input.productId;
    const inCatalog = catalogPrice !== undefined && Boolean(product) && Boolean(sameProduct);
    const unitPrice = inCatalog ? Number(catalogPrice) : Number(snapshot?.unitPrice ?? 0);
    const productTitle = product?.title ?? snapshot?.productTitle ?? "Producto no disponible";
    const variantLabel = variant?.label ?? snapshot?.variantLabel ?? "Variante no disponible";
    const stock = inCatalog && variant ? Math.max(0, variant.stock) : 0;
    const available = inCatalog && unitPrice > 0 && stock >= input.quantity;
    if (strict && !inCatalog) {
      throw new Error("El producto " + productTitle + " ya no está publicado en este catálogo.");
    }
    if (strict && unitPrice <= 0) {
      throw new Error("El producto " + productTitle + " no tiene un precio de venta válido.");
    }
    if (strict && stock < input.quantity) {
      throw new Error("No hay suficientes existencias para " + productTitle + " (" + variantLabel + "). Disponibles: " + stock + ".");
    }
    return {
      productId: input.productId,
      variantId: input.variantId,
      productTitle,
      productSku: product?.sku ?? "",
      variantLabel,
      variantSku: variant?.sku ?? "",
      quantity: input.quantity,
      unitPrice,
      lineTotal: fromCents(toCents(unitPrice) * input.quantity),
      stock,
      available,
    };
  });
  return output;
}

export async function validatePublicCart(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const resellerId = text(body.resellerId);
    const items = normalizeCartItems(body.items);
    if (!mongoose.isValidObjectId(resellerId) || !items) {
      return errorResponse("El carrito no es válido. Revisa sus productos y cantidades.", 400, "INVALID_CART");
    }
    await connectMongoDB();
    const seller = await findSeller(resellerId);
    if (!seller) return errorResponse("Esta tienda ya no está disponible.", 404, "STORE_NOT_FOUND");
    const hydrated = await hydrateCartItems(seller, items);
    return NextResponse.json({
      ok: true,
      seller: serializeSeller(seller),
      items: hydrated,
      subtotal: fromCents(hydrated.reduce((sum, item) => sum + toCents(item.lineTotal), 0)),
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    console.error("[PUBLIC_CART_VALIDATE]", error);
    return errorResponse("No pudimos actualizar los precios del carrito.", 500, "INTERNAL_ERROR");
  }
}

export async function createPublicCartShare(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const resellerId = text(body.resellerId);
    const items = normalizeCartItems(body.items);
    if (!mongoose.isValidObjectId(resellerId) || !items) {
      return errorResponse("El carrito no es válido. Agrega productos disponibles antes de compartirlo.", 400, "INVALID_CART");
    }

    await connectMongoDB();
    const seller = await findSeller(resellerId);
    if (!seller) return errorResponse("Esta tienda ya no está disponible.", 404, "STORE_NOT_FOUND");
    const hydrated = await hydrateCartItems(seller, items, [], true);
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await PublicCartShareModel.create({
      token,
      resellerId: seller._id,
      items: hydrated.map((item) => ({
        productId: new mongoose.Types.ObjectId(item.productId),
        variantId: new mongoose.Types.ObjectId(item.variantId),
        quantity: item.quantity,
        productTitle: item.productTitle,
        variantLabel: item.variantLabel,
        unitPrice: item.unitPrice,
      })),
      expiresAt,
      isActive: true,
    });

    return NextResponse.json({
      ok: true,
      token,
      expiresAt,
      seller: serializeSeller(seller),
      items: hydrated,
      subtotal: fromCents(hydrated.reduce((sum, item) => sum + toCents(item.lineTotal), 0)),
    }, { status: 201, headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    console.error("[PUBLIC_CART_SHARE]", error);
    return errorResponse(message || "No pudimos preparar el enlace del carrito.", message ? 409 : 500, "CART_SHARE_FAILED");
  }
}

export async function getPublicCartShare(request: Request) {
  try {
    const token = new URL(request.url).searchParams.get("token")?.trim() ?? "";
    if (!/^[a-f0-9]{64}$/i.test(token)) return errorResponse("El enlace del carrito no es válido.", 404, "CART_SHARE_NOT_FOUND");
    await connectMongoDB();
    const shared = await PublicCartShareModel.findOne({
      token,
      isActive: true,
      expiresAt: { $gt: new Date() },
    }).lean() as unknown as {
      token: string;
      resellerId: mongoose.Types.ObjectId;
      items: (CartInputItem & { productTitle?: string; variantLabel?: string; unitPrice?: number })[];
      expiresAt: Date;
    } | null;
    if (!shared) return errorResponse("Este enlace del carrito ha caducado o ya no está disponible.", 404, "CART_SHARE_NOT_FOUND");

    const seller = await findSeller(String(shared.resellerId));
    if (!seller) return errorResponse("Esta tienda ya no está disponible.", 404, "STORE_NOT_FOUND");
    const normalizedItems: CartInputItem[] = shared.items.map((item) => ({
      productId: String(item.productId),
      variantId: String(item.variantId),
      quantity: Number(item.quantity),
    }));
    const snapshots: SnapshotItem[] = shared.items.map((item) => ({
      productId: new mongoose.Types.ObjectId(String(item.productId)),
      variantId: new mongoose.Types.ObjectId(String(item.variantId)),
      quantity: Number(item.quantity),
      productTitle: item.productTitle ?? "",
      variantLabel: item.variantLabel ?? "",
      unitPrice: Number(item.unitPrice ?? 0),
    }));
    const hydrated = await hydrateCartItems(seller, normalizedItems, snapshots);
    return NextResponse.json({
      ok: true,
      token: shared.token,
      expiresAt: shared.expiresAt,
      seller: serializeSeller(seller),
      items: hydrated,
      subtotal: fromCents(hydrated.reduce((sum, item) => sum + toCents(item.lineTotal), 0)),
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    console.error("[PUBLIC_CART_SHARE_GET]", error);
    return errorResponse("No pudimos cargar el carrito compartido.", 500, "INTERNAL_ERROR");
  }
}
