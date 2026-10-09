import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectMongoDB } from "@/lib/db/mongodb";
import { CustomerModel } from "@/models/Customer";
import { InventoryMovementModel } from "@/models/InventoryMovement";
import { ProductModel } from "@/models/Product";
import { ProductVariantModel } from "@/models/ProductVariant";
import { ResellerCatalogItemModel } from "@/models/ResellerCatalogItem";
import { SaleModel } from "@/models/Sale";
import { SalePaymentModel } from "@/models/SalePayment";

type SaleLineInput = { variantId: string; quantity: number; unitPrice?: unknown };
type ProductRecord = {
  _id: unknown;
  title: string;
  sku: string;
  wholesalePrice: number;
  purchasePrice: number;
  isActive?: boolean;
};
type VariantRecord = {
  _id: unknown;
  productId: unknown;
  label: string;
  sku: string;
  options?: { name: string; value: string }[];
  stock: number;
  purchasePrice?: number | null;
  wholesalePrice?: number | null;
  isActive?: boolean;
};
type CatalogPriceRecord = { productId: unknown; sellingPrice: number; isActive: boolean };
type CustomerRecord = {
  _id: unknown;
  documentId: string;
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
  address?: string;
};

class SaleRequestError extends Error {
  status: number;
  code: string;
  isSaleRequestError = true;

  constructor(message: string, status = 400, code = "BAD_REQUEST") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function fail(message: string, status = 400, code = "BAD_REQUEST"): never {
  throw new SaleRequestError(message, status, code);
}

function errorResponse(message: string, status = 400, code = "BAD_REQUEST") {
  return NextResponse.json({ ok: false, error: code, message }, { status });
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function toCents(value: number) {
  return Math.round((value + Number.EPSILON) * 100);
}

function fromCents(value: number) {
  return Number((value / 100).toFixed(2));
}

function parsePrice(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? fromCents(toCents(number)) : null;
}

function createSaleNumber() {
  return "TS-" + Date.now().toString(36).toUpperCase() + "-" + randomBytes(3).toString("hex").toUpperCase();
}

function serializeSale(input: unknown, userRole: string) {
  const sale = input as Record<string, any>;
  const value = typeof sale.toObject === "function" ? sale.toObject() as Record<string, any> : sale;
  const items = (Array.isArray(value.items) ? value.items : []).map((rawItem: Record<string, any>) => {
    const unitProfit = fromCents(toCents(Number(rawItem.unitPrice)) - toCents(Number(rawItem.unitCost)));
    const safeItem = {
      ...rawItem,
      unitProfit,
      lineProfit: fromCents(toCents(Number(rawItem.lineTotal)) - toCents(Number(rawItem.lineCostTotal))),
      variantId: String(rawItem.variantId),
      productId: String(rawItem.productId),
    };
    if (userRole === "ADMIN") return safeItem;
    const {
      unitCost: _unitCost,
      lineCostTotal: _lineCostTotal,
      ...resellerItem
    } = safeItem;
    return resellerItem;
  });

  const result: Record<string, unknown> = {
    _id: String(value._id),
    saleNumber: value.saleNumber,
    customerId: value.customerId ? String(value.customerId) : null,
    customerSnapshot: value.customerSnapshot,
    items,
    subtotal: value.subtotal,
    total: value.total,
    amountPaid: value.amountPaid,
    balanceDue: value.balanceDue,
    paymentStatus: value.paymentStatus,
    note: value.note ?? "",
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    profit: value.grossProfit,
  };
  if (userRole === "ADMIN") result.totalCost = value.totalCost;
  return result;
}

function readSaleLines(value: unknown): SaleLineInput[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 30) return null;
  const result: SaleLineInput[] = [];
  const seen = new Set<string>();

  for (const entry of value) {
    if (!entry || typeof entry !== "object") return null;
    const row = entry as Record<string, unknown>;
    const variantId = text(row.variantId);
    const quantity = Number(row.quantity);
    if (!mongoose.isValidObjectId(variantId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 10000) {
      return null;
    }
    if (seen.has(variantId)) return null;
    seen.add(variantId);
    result.push({ variantId, quantity, unitPrice: row.unitPrice });
  }
  return result;
}

export async function getSaleOptions(userId: string, userRole: string) {
  try {
    await connectMongoDB();

    let catalogItems: CatalogPriceRecord[] = [];
    let productIds: unknown[];

    if (userRole === "RESELLER") {
      catalogItems = await ResellerCatalogItemModel.find({ resellerId: userId, isActive: true })
        .select("productId sellingPrice isActive")
        .lean() as unknown as CatalogPriceRecord[];
      productIds = catalogItems.map((item) => item.productId);
    } else if (userRole === "ADMIN") {
      productIds = await ProductModel.find({ isActive: true }).distinct("_id");
    } else {
      return errorResponse("No tienes permiso para registrar ventas.", 403, "FORBIDDEN");
    }

    if (!productIds.length) return NextResponse.json({ ok: true, items: [] });

    const [products, variants] = await Promise.all([
      ProductModel.find({ _id: { $in: productIds }, isActive: true })
        .select("title sku wholesalePrice")
        .lean() as unknown as Promise<ProductRecord[]>,
      ProductVariantModel.find({ productId: { $in: productIds }, isActive: true, stock: { $gt: 0 } })
        .select("productId label sku options stock wholesalePrice")
        .sort({ updatedAt: -1 })
        .lean() as unknown as Promise<VariantRecord[]>,
    ]);

    const productsById = new Map<string, ProductRecord>();
    for (const product of products) productsById.set(String(product._id), product);

    const catalogByProductId = new Map<string, CatalogPriceRecord>();
    for (const item of catalogItems) catalogByProductId.set(String(item.productId), item);
    const items = variants.flatMap((variant) => {
      const productId = String(variant.productId);
      const product = productsById.get(productId);
      if (!product || variant.stock <= 0) return [];
      const catalogItem = catalogByProductId.get(productId);
      if (userRole === "RESELLER" && !catalogItem) return [];

      return [{
        variantId: String(variant._id),
        productId,
        productTitle: product.title,
        productSku: product.sku,
        variantLabel: variant.label,
        variantSku: variant.sku,
        options: variant.options ?? [],
        stock: variant.stock,
        defaultUnitPrice: userRole === "RESELLER"
          ? catalogItem!.sellingPrice
          : (variant.wholesalePrice ?? product.wholesalePrice),
        canEditPrice: userRole === "ADMIN",
      }];
    });

    items.sort((a, b) => a.productTitle.localeCompare(b.productTitle) || a.variantLabel.localeCompare(b.variantLabel));
    return NextResponse.json({ ok: true, items });
  } catch (error) {
    console.error("[SALES_OPTIONS]", error);
    return errorResponse("No pudimos cargar los productos para la venta.", 500, "INTERNAL_ERROR");
  }
}

export async function listSales(userId: string, userRole: string) {
  try {
    await connectMongoDB();
    const sales = await SaleModel.find({ ownerId: userId, isActive: true })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    return NextResponse.json({
      ok: true,
      sales: sales.map((sale) => serializeSale(sale, userRole)),
    });
  } catch (error) {
    console.error("[SALES_LIST]", error);
    return errorResponse("No pudimos cargar las ventas.", 500, "INTERNAL_ERROR");
  }
}

export async function createSale(request: Request, userId: string, userRole: string) {
  if (userRole !== "ADMIN" && userRole !== "RESELLER") {
    return errorResponse("No tienes permiso para registrar ventas.", 403, "FORBIDDEN");
  }

  let session: mongoose.ClientSession | null = null;
  try {
    const body = await request.json() as Record<string, unknown>;
    const lines = readSaleLines(body.items);
    if (!lines) {
      return errorResponse("Añade al menos un producto y revisa las variantes y cantidades.");
    }

    const customerId = text(body.customerId);
    if (customerId && !mongoose.isValidObjectId(customerId)) {
      return errorResponse("El cliente seleccionado no es válido.", 400, "INVALID_CUSTOMER_ID");
    }

    const initialPaymentValue = body.initialPayment === undefined || body.initialPayment === null || body.initialPayment === ""
      ? 0
      : Number(body.initialPayment);
    if (!Number.isFinite(initialPaymentValue) || initialPaymentValue < 0) {
      return errorResponse("El pago inicial debe ser cero o mayor.");
    }
    const initialPaymentCents = toCents(initialPaymentValue);
    const paymentMethod = text(body.paymentMethod || "CASH");
    if (!["CASH", "TRANSFER", "CARD", "OTHER"].includes(paymentMethod)) {
      return errorResponse("El método de pago no es válido.");
    }
    const note = text(body.note).slice(0, 500);

    await connectMongoDB();
    session = await mongoose.startSession();
    let createdSale: unknown = null;

    await session.withTransaction(async () => {
      let customer: CustomerRecord | null = null;
      if (customerId) {
        customer = await CustomerModel.findOne({
          _id: customerId,
          ownerId: userId,
          isActive: true,
        }).session(session).lean() as unknown as CustomerRecord | null;
        if (!customer) fail("No encontramos al cliente seleccionado en tu directorio.", 404, "CUSTOMER_NOT_FOUND");
      }

      const variantIds = lines.map((line) => line.variantId);
      const variants = await ProductVariantModel.find({
        _id: { $in: variantIds },
        isActive: true,
      }).session(session).lean() as unknown as VariantRecord[];

      if (variants.length !== lines.length) {
        fail("Una de las variantes ya no está disponible.", 409, "VARIANT_UNAVAILABLE");
      }

      const variantById = new Map<string, VariantRecord>();
      for (const variant of variants) variantById.set(String(variant._id), variant);
      const productIds = [...new Set(variants.map((variant) => String(variant.productId)))];
      const products = await ProductModel.find({ _id: { $in: productIds }, isActive: true })
        .session(session)
        .lean() as unknown as ProductRecord[];

      if (products.length !== productIds.length) {
        fail("Uno de los productos ya no está disponible.", 409, "PRODUCT_UNAVAILABLE");
      }

      const productById = new Map<string, ProductRecord>();
      for (const product of products) productById.set(String(product._id), product);
      const resellerCatalogItems = userRole === "RESELLER"
        ? await ResellerCatalogItemModel.find({
            resellerId: userId,
            productId: { $in: productIds },
            isActive: true,
          }).session(session).lean() as unknown as CatalogPriceRecord[]
        : [];
      const catalogByProductId = new Map<string, CatalogPriceRecord>();
      for (const item of resellerCatalogItems) catalogByProductId.set(String(item.productId), item);

      const normalizedItems = lines.map((line) => {
        const variant = variantById.get(line.variantId);
        if (!variant) fail("Una de las variantes ya no está disponible.", 409, "VARIANT_UNAVAILABLE");
        const product = productById.get(String(variant.productId));
        if (!product) fail("Uno de los productos ya no está disponible.", 409, "PRODUCT_UNAVAILABLE");
        const catalogItem = catalogByProductId.get(String(product._id));
        if (userRole === "RESELLER" && !catalogItem) {
          fail("Añade primero cada producto a tu catálogo personal.", 403, "PRODUCT_NOT_IN_CATALOG");
        }

        const defaultPrice = userRole === "RESELLER"
          ? catalogItem!.sellingPrice
          : (variant.wholesalePrice ?? product.wholesalePrice);
        const unitPrice = userRole === "RESELLER"
          ? parsePrice(defaultPrice)
          : (line.unitPrice === undefined || line.unitPrice === null || line.unitPrice === ""
              ? parsePrice(defaultPrice)
              : parsePrice(line.unitPrice));
        if (unitPrice === null) fail("El precio de venta debe ser mayor que cero.", 400, "INVALID_PRICE");

        const unitCost = userRole === "ADMIN"
          ? (variant.purchasePrice ?? product.purchasePrice)
          : (variant.wholesalePrice ?? product.wholesalePrice);
        const unitCostCents = toCents(Number(unitCost));
        const lineTotalCents = toCents(unitPrice) * line.quantity;
        const lineCostCents = unitCostCents * line.quantity;

        return {
          sourceLine: line,
          variant,
          product,
          quantity: line.quantity,
          unitPrice: fromCents(toCents(unitPrice)),
          unitCost: fromCents(unitCostCents),
          lineTotalCents,
          lineCostCents,
          lineTotal: fromCents(lineTotalCents),
          lineCostTotal: fromCents(lineCostCents),
          lineProfit: fromCents(lineTotalCents - lineCostCents),
        };
      });

      const subtotalCents = normalizedItems.reduce((sum, item) => sum + item.lineTotalCents, 0);
      if (initialPaymentCents > subtotalCents) {
        fail("El pago inicial no puede superar el total de la venta.", 400, "PAYMENT_EXCEEDS_TOTAL");
      }

      for (const item of normalizedItems) {
        const updated = await ProductVariantModel.updateOne(
          { _id: item.variant._id, isActive: true, stock: { $gte: item.quantity } },
          { $inc: { stock: -item.quantity } },
          { session },
        ).exec();

        if (updated.modifiedCount !== 1) {
          fail("No hay existencias suficientes para " + item.product.title + " (" + item.variant.label + ").", 409, "INSUFFICIENT_STOCK");
        }
      }

      const totalCostCents = normalizedItems.reduce((sum, item) => sum + item.lineCostCents, 0);
      const grossProfitCents = subtotalCents - totalCostCents;
      const saleNumber = createSaleNumber();
      const subtotal = fromCents(subtotalCents);
      const amountPaid = fromCents(initialPaymentCents);
      const balanceDue = fromCents(subtotalCents - initialPaymentCents);
      const created = await SaleModel.create([{
        saleNumber,
        ownerId: userId,
        customerId: customerId || null,
        customerSnapshot: customer
          ? {
              documentId: customer.documentId,
              firstName: customer.firstName,
              lastName: customer.lastName,
              phone: customer.phone,
              email: customer.email ?? "",
              address: customer.address ?? "",
            }
          : { firstName: "Cliente ocasional", lastName: "" },
        items: normalizedItems.map((item) => ({
          productId: item.product._id,
          variantId: item.variant._id,
          productTitle: item.product.title,
          productSku: item.product.sku,
          variantLabel: item.variant.label,
          variantSku: item.variant.sku,
          options: item.variant.options ?? [],
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          unitCost: item.unitCost,
          lineTotal: item.lineTotal,
          lineCostTotal: item.lineCostTotal,
          lineProfit: item.lineProfit,
        })),
        subtotal,
        total: subtotal,
        totalCost: fromCents(totalCostCents),
        grossProfit: fromCents(grossProfitCents),
        amountPaid,
        balanceDue,
        paymentStatus: balanceDue <= 0 ? "PAID" : amountPaid > 0 ? "PARTIAL" : "UNPAID",
        note,
        isActive: true,
      }], { session });

      createdSale = created[0];

      await InventoryMovementModel.create(
        normalizedItems.map((item) => ({
          variantId: item.variant._id,
          delta: -item.quantity,
          type: "SALE",
          reason: "Venta " + saleNumber,
          referenceType: "SALE",
          referenceId: String((createdSale as { _id: unknown })._id),
          performedBy: userId,
        })),
        { session },
      );

      if (initialPaymentCents > 0) {
        await SalePaymentModel.create([{
          saleId: (createdSale as { _id: unknown })._id,
          ownerId: userId,
          amount: amountPaid,
          method: paymentMethod,
          note: note ? "Pago inicial. " + note : "Pago inicial de la venta",
          receivedBy: userId,
        }], { session });
      }
    });

    if (!createdSale) return errorResponse("No pudimos registrar la venta.", 500, "SALE_NOT_CREATED");
    return NextResponse.json({
      ok: true,
      sale: serializeSale(createdSale, userRole),
      message: "Venta registrada correctamente.",
    }, { status: 201 });
  } catch (error) {
    if (error instanceof SaleRequestError) {
      return errorResponse(error.message, error.status, error.code);
    }
    if (typeof error === "object" && error !== null && "isSaleRequestError" in error && error.isSaleRequestError === true) {
      const typedError = error as { message?: string; status?: number; code?: string };
      return errorResponse(typedError.message ?? "Los datos de la venta no son válidos.", typedError.status ?? 400, typedError.code ?? "BAD_REQUEST");
    }
    if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
      return errorResponse("No pudimos generar un número único para la venta. Inténtalo de nuevo.", 409, "SALE_NUMBER_CONFLICT");
    }
    console.error("[SALE_CREATE]", error);
    return errorResponse("No pudimos registrar la venta. Comprueba la conexión e inténtalo de nuevo.", 500, "INTERNAL_ERROR");
  } finally {
    if (session) await session.endSession();
  }
}
