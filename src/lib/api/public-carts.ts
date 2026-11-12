import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectMongoDB } from "@/lib/db/mongodb";
import { ProductModel } from "@/models/Product";
import { ProductVariantModel } from "@/models/ProductVariant";
import { PublicCartShareModel } from "@/models/PublicCartShare";
import { ResellerCatalogItemModel } from "@/models/ResellerCatalogItem";
import { ResellerComboModel } from "@/models/ResellerCombo";
import { UserModel } from "@/models/User";
import { enforceRateLimit } from "@/lib/security/rate-limit";

type ProductCartInput = { kind?: "PRODUCT"; productId: string; variantId: string; quantity: number };
type ComboCartInput = {
  kind: "COMBO"; productId: string; variantId: string; comboId: string; quantity: number;
  components: { productId: string; variantId: string; quantity: number }[];
};
type CartInputItem = ProductCartInput | ComboCartInput;
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
type ProductRecord = { _id: mongoose.Types.ObjectId; title: string; sku: string; wholesalePrice?: number };
type VariantRecord = {
  _id: mongoose.Types.ObjectId;
  productId: mongoose.Types.ObjectId;
  label: string;
  sku: string;
  stock: number;
  wholesalePrice?: number | null;
};
type CatalogItemRecord = { productId: mongoose.Types.ObjectId; sellingPrice: number; variantPrices?: { variantId: mongoose.Types.ObjectId; sellingPrice: number }[] };
type SnapshotItem = {
  productId: mongoose.Types.ObjectId;
  variantId: mongoose.Types.ObjectId;
  quantity: number;
  productTitle: string;
  variantLabel: string;
  unitPrice: number;
};
type ComboSnapshot = { comboId: string; title: string; unitPrice: number; components: { productId: string; variantId: string; quantity: number; productTitle: string; productSku: string; variantLabel: string; variantSku: string; unitCost: number }[] };

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
    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) return null;
    if (item.kind === "COMBO") {
      const comboId = text(item.comboId);
      if (!mongoose.isValidObjectId(comboId) || !Array.isArray(item.components) ||
          item.components.length < 2 || item.components.length > 5) return null;
      const components: ComboCartInput["components"] = [];
      const componentProducts = new Set<string>();
      for (const rawComponent of item.components) {
        if (!rawComponent || typeof rawComponent !== "object") return null;
        const component = rawComponent as Record<string, unknown>;
        const productId = text(component.productId);
        const variantId = text(component.variantId);
        const componentQuantity = Number(component.quantity);
        if (!mongoose.isValidObjectId(productId) || !mongoose.isValidObjectId(variantId) ||
            !Number.isInteger(componentQuantity) || componentQuantity < 1 || componentQuantity > 50 ||
            componentProducts.has(productId)) return null;
        componentProducts.add(productId);
        components.push({ productId, variantId, quantity: componentQuantity });
      }
      const key = comboId + ":" + components.map((component) => component.variantId).join("-");
      if (seen.has(key)) return null;
      seen.add(key);
      output.push({ kind: "COMBO", comboId, productId: comboId, variantId: "COMBO:" + key, quantity, components });
      continue;
    }
    const productId = text(item.productId);
    const variantId = text(item.variantId);
    if (!mongoose.isValidObjectId(productId) || !mongoose.isValidObjectId(variantId)) return null;
    if (seen.has(variantId)) return null;
    seen.add(variantId);
    output.push({ kind: "PRODUCT", productId, variantId, quantity });
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

async function hydrateProductCartItems(
  seller: SellerRecord,
  items: ProductCartInput[],
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
    }).select("productId sellingPrice variantPrices").lean() as unknown as Promise<CatalogItemRecord[]>,
  ]);
  const productById = new Map(products.map((product) => [String(product._id), product]));
  const variantById = new Map(variants.map((variant) => [String(variant._id), variant]));
  const catalogByProductId = new Map(catalogItems.map((item) => [String(item.productId), item]));
  const snapshotByVariantId = new Map(snapshots.map((item) => [String(item.variantId), item]));
  const output = items.map((input) => {
    const product = productById.get(input.productId);
    const variant = variantById.get(input.variantId);
    const snapshot = snapshotByVariantId.get(input.variantId);
    const catalog = catalogByProductId.get(input.productId);
    const variantPrice = catalog?.variantPrices?.find((price) => String(price.variantId) === input.variantId)?.sellingPrice;
    const catalogPrice = catalog ? (variantPrice ?? catalog.sellingPrice) : undefined;
    const sameProduct = variant && String(variant.productId) === input.productId;
    const inCatalog = catalogPrice !== undefined && Boolean(product) && Boolean(sameProduct);
    const unitPrice = inCatalog ? fromCents(toCents(Number(catalogPrice))) : Number(snapshot?.unitPrice ?? 0);
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


async function hydrateComboCartItem(seller: SellerRecord, input: ComboCartInput, strict = false, snapshot?: ComboSnapshot) {
  const combo = await ResellerComboModel.findOne({ _id: input.comboId, resellerId: seller._id, isActive: true }).lean() as any;
  if (!combo) {
    if (strict || !snapshot) throw new Error("El combo ya no está disponible en este catálogo.");
    return {
      kind: "COMBO", comboId: input.comboId, productId: input.comboId, variantId: input.variantId,
      components: snapshot.components, productTitle: snapshot.title, productSku: "", variantLabel: "Combo",
      variantSku: "", quantity: input.quantity, unitPrice: snapshot.unitPrice,
      lineTotal: fromCents(toCents(snapshot.unitPrice) * input.quantity), stock: 0, available: false,
    };
  }
  const definitions = (combo.components ?? []) as { productId: mongoose.Types.ObjectId; quantity: number }[];
  if (definitions.length !== input.components.length) throw new Error("La composición del combo cambió. Actualiza el carrito y vuelve a seleccionarlo.");
  const productIds = definitions.map((component) => String(component.productId));
  const selectedByProduct = new Map(input.components.map((component) => [component.productId, component]));
  if (productIds.some((id) => !selectedByProduct.has(id))) throw new Error("Selecciona una variante para cada producto del combo.");
  const variantIds = input.components.map((component) => new mongoose.Types.ObjectId(component.variantId));
  const [products, variants] = await Promise.all([
    ProductModel.find({ _id: { $in: definitions.map((item) => item.productId) }, isActive: true }).select("_id title sku wholesalePrice").lean() as unknown as Promise<ProductRecord[]>,
    ProductVariantModel.find({ _id: { $in: variantIds }, isActive: true }).select("_id productId label sku stock wholesalePrice").lean() as unknown as Promise<VariantRecord[]>,
  ]);
  const productById = new Map(products.map((product) => [String(product._id), product]));
  const variantById = new Map(variants.map((variant) => [String(variant._id), variant]));
  const components = definitions.map((definition) => {
    const productId = String(definition.productId);
    const product = productById.get(productId);
    const selected = selectedByProduct.get(productId);
    const variant = selected ? variantById.get(selected.variantId) : undefined;
    if (!product || !variant || String(variant.productId) !== productId) {
      throw new Error("Una de las variantes seleccionadas ya no pertenece al combo.");
    }
    const quantity = Number(definition.quantity ?? 1);
    const unitCost = fromCents(toCents(Number(variant.wholesalePrice ?? product.wholesalePrice ?? 0)));
    return {
      productId, variantId: String(variant._id), quantity,
      productTitle: product.title, productSku: product.sku,
      variantLabel: variant.label, variantSku: variant.sku,
      unitCost, stock: variant.stock,
      required: quantity * input.quantity,
    };
  });
  const stock = Math.min(...components.map((component) => Math.floor(component.stock / component.quantity)));
  const available = components.every((component) => component.stock >= component.required);
  if (strict && !available) {
    const shortage = components.find((component) => component.stock < component.required);
    throw new Error("No hay existencias suficientes para " + (shortage?.productTitle ?? combo.title) + ". Disponibles: " + stock + " combos.");
  }
  const baseCost = components.reduce((sum, component) => sum + toCents(component.unitCost) * component.quantity, 0);
  const base = fromCents(baseCost);
  const unitPrice = fromCents(toCents(combo.profitMode === "PERCENT"
    ? base * (1 + Number(combo.profitValue) / 100)
    : base + Number(combo.profitValue)));
  return {
    kind: "COMBO", comboId: input.comboId, productId: input.comboId, variantId: input.variantId,
    components: components.map(({ stock: _stock, required: _required, ...component }) => component),
    productTitle: combo.title, productSku: "", variantLabel: components.map((component) => component.variantLabel).join(" + "),
    variantSku: "", quantity: input.quantity, unitPrice,
    lineTotal: fromCents(toCents(unitPrice) * input.quantity),
    stock: Math.max(0, stock), available: available && unitPrice > 0,
  };
}

async function hydrateCartItems(
  seller: SellerRecord,
  items: CartInputItem[],
  snapshots: SnapshotItem[] = [],
  strict = false,
  comboSnapshots: ComboSnapshot[] = [],
) {
  const regularItems = items.filter((item): item is ProductCartInput => item.kind !== "COMBO");
  const regularSnapshots = snapshots;
  const regular = regularItems.length ? await hydrateProductCartItems(seller, regularItems, regularSnapshots, strict) : [];
  const regularById = new Map(regular.map((item) => [item.variantId, item]));
  const snapshotByCombo = new Map(comboSnapshots.map((snapshot) => [snapshot.comboId, snapshot]));
  const comboItems = items.filter((item): item is ComboCartInput => item.kind === "COMBO");
  const combo = await Promise.all(comboItems.map((item) =>
    hydrateComboCartItem(seller, item, strict, snapshotByCombo.get(item.comboId))));
  const comboByKey = new Map(combo.map((item) => [item.variantId, item]));
  return items.map((item) => item.kind === "COMBO" ? comboByKey.get(item.variantId)! : regularById.get(item.variantId)!);
}

export async function validatePublicCart(request: Request) {
  try {
    const blocked = await enforceRateLimit(request, "public-cart-validate", 90, 15 * 60 * 1000);
    if (blocked) return blocked;
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
    const blocked = await enforceRateLimit(request, "public-cart-share", 20, 60 * 60 * 1000);
    if (blocked) return blocked;
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
      items: hydrated.map((item: any) => item.kind === "COMBO" ? ({
        kind: "COMBO",
        comboId: new mongoose.Types.ObjectId(item.comboId),
        quantity: item.quantity,
        productTitle: item.productTitle,
        variantLabel: item.variantLabel,
        unitPrice: item.unitPrice,
        components: item.components.map((component: any) => ({
          productId: new mongoose.Types.ObjectId(component.productId),
          variantId: new mongoose.Types.ObjectId(component.variantId),
          quantity: component.quantity,
          productTitle: component.productTitle,
          productSku: component.productSku,
          variantLabel: component.variantLabel,
          variantSku: component.variantSku,
          unitCost: component.unitCost,
        })),
      }) : ({
        kind: "PRODUCT",
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
    const blocked = await enforceRateLimit(request, "public-cart-share-view", 90, 15 * 60 * 1000);
    if (blocked) return blocked;
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
      items: any[];
      expiresAt: Date;
    } | null;
    if (!shared) return errorResponse("Este enlace del carrito ha caducado o ya no está disponible.", 404, "CART_SHARE_NOT_FOUND");

    const seller = await findSeller(String(shared.resellerId));
    if (!seller) return errorResponse("Esta tienda ya no está disponible.", 404, "STORE_NOT_FOUND");
    const normalizedItems: CartInputItem[] = shared.items.map((item) => item.kind === "COMBO" ? ({
      kind: "COMBO",
      comboId: String(item.comboId),
      productId: String(item.comboId),
      variantId: "COMBO:" + String(item.comboId) + ":" + (item.components ?? []).map((component: any) => String(component.variantId)).join("-"),
      quantity: Number(item.quantity),
      components: (item.components ?? []).map((component: any) => ({
        productId: String(component.productId),
        variantId: String(component.variantId),
        quantity: Number(component.quantity),
      })),
    }) : ({
      kind: "PRODUCT",
      productId: String(item.productId),
      variantId: String(item.variantId),
      quantity: Number(item.quantity),
    }));
    const snapshots: SnapshotItem[] = shared.items.filter((item) => item.kind !== "COMBO").map((item) => ({
      productId: new mongoose.Types.ObjectId(String(item.productId)),
      variantId: new mongoose.Types.ObjectId(String(item.variantId)),
      quantity: Number(item.quantity),
      productTitle: item.productTitle ?? "",
      variantLabel: item.variantLabel ?? "",
      unitPrice: Number(item.unitPrice ?? 0),
    }));
    const comboSnapshots: ComboSnapshot[] = shared.items.filter((item) => item.kind === "COMBO").map((item) => ({
      comboId: String(item.comboId),
      title: item.productTitle ?? "Combo",
      unitPrice: Number(item.unitPrice ?? 0),
      components: (item.components ?? []).map((component: any) => ({
        productId: String(component.productId), variantId: String(component.variantId),
        quantity: Number(component.quantity), productTitle: component.productTitle ?? "",
        productSku: component.productSku ?? "", variantLabel: component.variantLabel ?? "",
        variantSku: component.variantSku ?? "", unitCost: Number(component.unitCost ?? 0),
      })),
    }));
    const hydrated = await hydrateCartItems(seller, normalizedItems, snapshots, false, comboSnapshots);
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
