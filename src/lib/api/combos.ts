import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectMongoDB } from "@/lib/db/mongodb";
import { ProductModel } from "@/models/Product";
import { ProductVariantModel } from "@/models/ProductVariant";
import { ResellerComboModel } from "@/models/ResellerCombo";

type ComponentInput = { productId: string; quantity: number };
type ComboInput = {
  title: string;
  description: string;
  components: ComponentInput[];
  profitMode: "FIXED" | "PERCENT";
  profitValue: number;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
function cents(value: number) {
  return Math.round((value + Number.EPSILON) * 100);
}
function errorResponse(message: string, status = 400, code = "BAD_REQUEST") {
  return NextResponse.json({ ok: false, error: code, message }, { status, headers: { "Cache-Control": "no-store" } });
}
function authorize(role: string) {
  return role === "RESELLER" || role === "ADMIN"
    ? null
    : errorResponse("Tu cuenta no tiene acceso a la gestión de combos.", 403, "FORBIDDEN");
}
function parseCombo(body: Record<string, unknown>): ComboInput | null {
  const title = text(body.title);
  const description = text(body.description);
  const profitMode = text(body.profitMode).toUpperCase() === "PERCENT" ? "PERCENT" : "FIXED";
  const profitValue = Number(body.profitValue);
  if (!title || title.length > 100 || description.length > 1000 ||
      !Number.isFinite(profitValue) || profitValue <= 0 ||
      (profitMode === "PERCENT" && profitValue > 500) || (profitMode === "FIXED" && profitValue > 100000)) return null;
  if (!Array.isArray(body.components) || body.components.length < 2 || body.components.length > 5) return null;
  const seen = new Set<string>();
  const components: ComponentInput[] = [];
  for (const raw of body.components) {
    if (!raw || typeof raw !== "object") return null;
    const row = raw as Record<string, unknown>;
    const productId = text(row.productId);
    const quantity = Number(row.quantity ?? 1);
    if (!mongoose.isValidObjectId(productId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 50 || seen.has(productId)) return null;
    seen.add(productId);
    components.push({ productId, quantity });
  }
  return { title, description, components, profitMode, profitValue };
}
async function validateComponents(components: ComponentInput[]) {
  const productIds = components.map((item) => item.productId);
  const [products, variants] = await Promise.all([
    ProductModel.find({ _id: { $in: productIds }, isActive: true })
      .select("_id title sku wholesalePrice images").lean(),
    ProductVariantModel.find({ productId: { $in: productIds }, isActive: true, stock: { $gt: 0 } })
      .select("_id productId label sku options images stock wholesalePrice").lean(),
  ]);
  if (products.length !== components.length) return null;
  const byProduct = new Map<string, typeof variants>();
  for (const variant of variants) {
    const key = String(variant.productId);
    byProduct.set(key, [...(byProduct.get(key) ?? []), variant]);
  }
  if (components.some((item) => !(byProduct.get(item.productId)?.length))) return null;
  return { products, variants, byProduct };
}
function serializeCombo(combo: any, productById: Map<string, any>, variantsByProduct: Map<string, any[]>) {
  return {
    _id: String(combo._id),
    title: combo.title,
    description: combo.description ?? "",
    profitMode: combo.profitMode,
    profitValue: combo.profitValue,
    isActive: combo.isActive,
    components: (combo.components ?? []).flatMap((component: any) => {
      const productId = String(component.productId);
      const product = productById.get(productId);
      if (!product) return [];
      return [{
        productId,
        quantity: component.quantity,
        product: {
          title: product.title,
          sku: product.sku,
          wholesalePrice: product.wholesalePrice,
          images: product.images ?? [],
        },
        variants: (variantsByProduct.get(productId) ?? []).map((variant) => ({
          _id: String(variant._id),
          label: variant.label,
          sku: variant.sku,
          options: variant.options ?? [],
          images: variant.images ?? [],
          stock: variant.stock,
          wholesalePrice: variant.wholesalePrice ?? product.wholesalePrice,
        })),
      }];
    }),
    createdAt: combo.createdAt,
    updatedAt: combo.updatedAt,
  };
}

export async function listResellerCombos(userId: string, userRole: string) {
  const forbidden = authorize(userRole);
  if (forbidden) return forbidden;
  try {
    await connectMongoDB();
    const combos = await ResellerComboModel.find({ resellerId: userId, isActive: true }).sort({ updatedAt: -1 }).lean() as any[];
    const productIds = [...new Set(combos.flatMap((combo) => (combo.components ?? []).map((component: any) => String(component.productId))))];
    const [products, variants] = await Promise.all([
      productIds.length ? ProductModel.find({ _id: { $in: productIds } }).select("_id title sku wholesalePrice images isActive").lean() : Promise.resolve([]),
      productIds.length ? ProductVariantModel.find({ productId: { $in: productIds }, isActive: true }).select("_id productId label sku options images stock wholesalePrice").lean() : Promise.resolve([]),
    ]);
    const productById = new Map(products.map((product: any) => [String(product._id), product]));
    const variantsByProduct = new Map<string, any[]>();
    for (const variant of variants as any[]) variantsByProduct.set(String(variant.productId), [...(variantsByProduct.get(String(variant.productId)) ?? []), variant]);
    return NextResponse.json({ ok: true, combos: combos.map((combo) => serializeCombo(combo, productById, variantsByProduct)) });
  } catch (error) {
    console.error("[COMBOS_LIST]", error);
    return errorResponse("No pudimos cargar tus combos.", 500, "INTERNAL_ERROR");
  }
}

export async function createResellerCombo(request: Request, userId: string, userRole: string) {
  const forbidden = authorize(userRole);
  if (forbidden) return forbidden;
  try {
    const body = await request.json() as Record<string, unknown>;
    const parsed = parseCombo(body);
    if (!parsed) return errorResponse("Revisa el nombre, la ganancia y selecciona entre 2 y 5 productos diferentes.");
    await connectMongoDB();
    const checked = await validateComponents(parsed.components);
    if (!checked) return errorResponse("Todos los productos deben estar activos y tener al menos una variante con existencias.", 409, "COMPONENT_UNAVAILABLE");
    const combo = await ResellerComboModel.create({
      resellerId: userId,
      ...parsed,
      components: parsed.components.map((component) => ({ productId: new mongoose.Types.ObjectId(component.productId), quantity: component.quantity })),
      isActive: true,
    });
    const productById = new Map(checked.products.map((product: any) => [String(product._id), product]));
    return NextResponse.json({ ok: true, combo: serializeCombo(combo.toObject(), productById, checked.byProduct) }, { status: 201 });
  } catch (error) {
    console.error("[COMBO_CREATE]", error);
    return errorResponse("No pudimos crear el combo.", 500, "INTERNAL_ERROR");
  }
}

export async function updateResellerCombo(request: Request, comboId: string, userId: string, userRole: string) {
  const forbidden = authorize(userRole);
  if (forbidden) return forbidden;
  if (!mongoose.isValidObjectId(comboId)) return errorResponse("El combo seleccionado no es válido.", 400, "INVALID_COMBO_ID");
  try {
    const parsed = parseCombo(await request.json() as Record<string, unknown>);
    if (!parsed) return errorResponse("Revisa el nombre, la ganancia y selecciona entre 2 y 5 productos diferentes.");
    await connectMongoDB();
    const checked = await validateComponents(parsed.components);
    if (!checked) return errorResponse("Todos los productos deben estar activos y tener al menos una variante con existencias.", 409, "COMPONENT_UNAVAILABLE");
    const combo = await ResellerComboModel.findOne({ _id: comboId, resellerId: userId, isActive: true }).exec();
    if (!combo) return errorResponse("No encontramos ese combo en tu catálogo.", 404, "COMBO_NOT_FOUND");
    combo.title = parsed.title;
    combo.description = parsed.description;
    combo.profitMode = parsed.profitMode;
    combo.profitValue = parsed.profitValue;
    combo.components = parsed.components.map((component) => ({ productId: new mongoose.Types.ObjectId(component.productId), quantity: component.quantity })) as any;
    await combo.save();
    const productById = new Map(checked.products.map((product: any) => [String(product._id), product]));
    return NextResponse.json({ ok: true, combo: serializeCombo(combo.toObject(), productById, checked.byProduct) });
  } catch (error) {
    console.error("[COMBO_UPDATE]", error);
    return errorResponse("No pudimos actualizar el combo.", 500, "INTERNAL_ERROR");
  }
}

export async function removeResellerCombo(comboId: string, userId: string, userRole: string) {
  const forbidden = authorize(userRole);
  if (forbidden) return forbidden;
  if (!mongoose.isValidObjectId(comboId)) return errorResponse("El combo seleccionado no es válido.", 400, "INVALID_COMBO_ID");
  try {
    await connectMongoDB();
    const combo = await ResellerComboModel.findOneAndUpdate(
      { _id: comboId, resellerId: userId, isActive: true },
      { $set: { isActive: false } },
      { new: true },
    );
    if (!combo) return errorResponse("No encontramos ese combo en tu catálogo.", 404, "COMBO_NOT_FOUND");
    return NextResponse.json({ ok: true, message: "Combo retirado de tu catálogo." });
  } catch (error) {
    console.error("[COMBO_REMOVE]", error);
    return errorResponse("No pudimos quitar el combo.", 500, "INTERNAL_ERROR");
  }
}
