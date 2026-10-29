import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectMongoDB } from "@/lib/db/mongodb";
import { CustomerModel } from "@/models/Customer";
import { InventoryMovementModel } from "@/models/InventoryMovement";
import { ProductModel } from "@/models/Product";
import { ProductVariantModel } from "@/models/ProductVariant";
import { PublicOrderModel } from "@/models/PublicOrder";
import { ResellerCatalogItemModel } from "@/models/ResellerCatalogItem";
import { SaleModel } from "@/models/Sale";
import { SalePaymentModel } from "@/models/SalePayment";
import { ResellerSupplierPaymentModel } from "@/models/ResellerSupplierPayment";

type SaleLineInput = { variantId: string; quantity: number; unitPrice?: unknown };
type ProductRecord = {
  _id: mongoose.Types.ObjectId;
  title: string;
  sku: string;
  wholesalePrice: number;
  purchasePrice: number;
  isActive?: boolean;
};
type VariantRecord = {
  _id: mongoose.Types.ObjectId;
  productId: mongoose.Types.ObjectId;
  label: string;
  sku: string;
  options?: { name: string; value: string }[];
  stock: number;
  purchasePrice?: number | null;
  wholesalePrice?: number | null;
  isActive?: boolean;
};
type CatalogPriceRecord = { productId: mongoose.Types.ObjectId; sellingPrice: number; isActive: boolean; variantPrices?: { variantId: mongoose.Types.ObjectId | string; sellingPrice: number }[] };
type CustomerRecord = {
  _id: mongoose.Types.ObjectId;
  documentId: string;
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
  address?: string;
};

type PublicOrderSource = {
  _id: mongoose.Types.ObjectId;
  resellerId: mongoose.Types.ObjectId;
  resellerRole: "ADMIN" | "RESELLER";
  status: "PENDING" | "IN_PROGRESS" | "CANCELLED" | "CONVERTED";
  items: {
    variantId: mongoose.Types.ObjectId;
    quantity: number;
    unitPrice: number;
  }[];
  customer: {
    documentId?: string;
    firstName: string;
    lastName?: string;
    phone: string;
    email?: string;
    address?: string;
  };
  saleId: mongoose.Types.ObjectId | null;
  convertedAt: Date | null;
  save(options?: { session?: mongoose.ClientSession }): Promise<unknown>;
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
    const safeItem: Record<string, any> = {
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
    return { ...resellerItem, wholesaleUnitCost: rawItem.unitCost, wholesaleLineCostTotal: rawItem.lineCostTotal };
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
    saleStatus: value.saleStatus ?? (value.isActive === false ? "CANCELLED" : "ACTIVE"),
    cancellationReason: value.cancellationReason ?? "",
    cancelledAt: value.cancelledAt ?? null,
    isActive: value.isActive !== false,
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
    let productIds: mongoose.Types.ObjectId[];

    if (userRole !== "RESELLER" && userRole !== "ADMIN") {
      return errorResponse("No tienes permiso para registrar ventas.", 403, "FORBIDDEN");
    }

    catalogItems = await ResellerCatalogItemModel.find({ resellerId: userId, isActive: true })
      .select("productId sellingPrice isActive variantPrices")
      .lean() as unknown as CatalogPriceRecord[];

    if (userRole === "RESELLER") {
      productIds = catalogItems.map((item) => item.productId);
    } else {
      productIds = await ProductModel.find({ isActive: true }).distinct("_id");
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
        defaultUnitPrice: catalogItem
          ? (catalogItem.variantPrices?.find((price) => String(price.variantId) === String(variant._id))?.sellingPrice ?? catalogItem.sellingPrice)
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

export async function listSales(request: Request, userId: string, userRole: string) {
  try {
    await connectMongoDB();
    const url = new URL(request.url);
    const page = Math.max(1, Math.trunc(Number(url.searchParams.get("page") || 1) || 1));
    const limit = Math.min(100, Math.max(1, Math.trunc(Number(url.searchParams.get("limit") || 25) || 25)));
    const query = text(url.searchParams.get("q")).slice(0, 100);
    const paymentStatus = text(url.searchParams.get("paymentStatus")).toUpperCase();
    const saleStatus = text(url.searchParams.get("saleStatus")).toUpperCase();
    const from = text(url.searchParams.get("from"));
    const to = text(url.searchParams.get("to"));
    const filter: Record<string, unknown> = {
      ownerId: userId,
      $or: [{ isActive: true }, { isActive: false, saleStatus: "CANCELLED" }],
    };

    const andFilters: Record<string, unknown>[] = [];
    if (query) {
            const specialCharacters = [String.fromCharCode(92), "^", "$", ".", "*", "+", "?", "(", ")", "[", "]", "{", "}", "|"];
      const escaped = query.split("").map((character) => specialCharacters.includes(character) ? String.fromCharCode(92) + character : character).join("");
      const pattern = new RegExp(escaped, "i");
      andFilters.push({ $or: [
        { saleNumber: pattern },
        { "customerSnapshot.firstName": pattern },
        { "customerSnapshot.lastName": pattern },
        { "customerSnapshot.documentId": pattern },
        { "items.productTitle": pattern },
        { "items.variantLabel": pattern },
        { "items.productSku": pattern },
        { "items.variantSku": pattern },
      ] });
    }
    if (from || to) {
      const createdAt: Record<string, Date> = {};
      if (from && !Number.isNaN(Date.parse(from))) createdAt.$gte = new Date(from + "T00:00:00.000Z");
      if (to && !Number.isNaN(Date.parse(to))) createdAt.$lte = new Date(to + "T23:59:59.999Z");
      if (Object.keys(createdAt).length) andFilters.push({ createdAt });
    }
    if (saleStatus === "CANCELLED") andFilters.push({ saleStatus: "CANCELLED", isActive: false });
    else {
      andFilters.push({ isActive: true });
      if (["UNPAID", "PARTIAL", "PAID"].includes(paymentStatus)) andFilters.push({ paymentStatus });
    }
    if (andFilters.length) filter.$and = andFilters;

    const [sales, total, summaryRows] = await Promise.all([
      SaleModel.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      SaleModel.countDocuments(filter),
      SaleModel.aggregate([
        { $match: { ...filter, ownerId: new mongoose.Types.ObjectId(userId), isActive: true } },
        { $group: {
          _id: null,
          count: { $sum: 1 },
          total: { $sum: "$total" },
          amountPaid: { $sum: "$amountPaid" },
          balanceDue: { $sum: "$balanceDue" },
          profit: { $sum: "$grossProfit" },
        } },
      ]).exec(),
    ]);
    const summary = summaryRows[0] ?? {};
    return NextResponse.json({
      ok: true,
      sales: sales.map((sale) => serializeSale(sale, userRole)),
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
      summary: {
        count: summary.count ?? 0,
        total: Number(Number(summary.total ?? 0).toFixed(2)),
        amountPaid: Number(Number(summary.amountPaid ?? 0).toFixed(2)),
        balanceDue: Number(Number(summary.balanceDue ?? 0).toFixed(2)),
        profit: Number(Number(summary.profit ?? 0).toFixed(2)),
      },
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    console.error("[SALES_LIST]", error);
    return errorResponse("No pudimos cargar las ventas.", 500, "INTERNAL_ERROR");
  }
}

export async function cancelSale(request: Request, saleId: string, userId: string, userRole: string) {
  if (userRole !== "ADMIN" && userRole !== "RESELLER") {
    return errorResponse("No tienes permiso para anular ventas.", 403, "FORBIDDEN");
  }
  if (!mongoose.isValidObjectId(saleId)) return errorResponse("La venta seleccionada no es válida.", 400, "INVALID_SALE_ID");

  let session: mongoose.ClientSession | null = null;
  try {
    const body = await request.json() as Record<string, unknown>;
    const reason = text(body.reason).slice(0, 500);
    if (reason.length < 3) return errorResponse("Indica el motivo de la anulación para conservar el historial.");
    await connectMongoDB();

    const transactionSession = await mongoose.startSession();
    session = transactionSession;
    let cancelled: Record<string, unknown> | null = null;
    await transactionSession.withTransaction(async () => {
      const sale = await SaleModel.findOne({ _id: saleId, ownerId: userId, isActive: true })
        .session(transactionSession).exec();
      if (!sale) fail("No encontramos una venta activa de tu cuenta.", 404, "SALE_NOT_FOUND");
      if (sale.saleStatus === "CANCELLED") fail("Esta venta ya está anulada.", 409, "SALE_ALREADY_CANCELLED");

      const hasCustomerPayments = await SalePaymentModel.exists({ saleId: sale._id }).session(transactionSession).exec();
      if (toCents(sale.amountPaid) > 0 || hasCustomerPayments) {
        fail("Esta venta ya tiene dinero recibido. Para proteger el historial financiero, no se puede anular hasta registrar el reembolso correspondiente.", 409, "SALE_HAS_CUSTOMER_PAYMENTS");
      }

      const hasSupplierPayments = await ResellerSupplierPaymentModel.exists({
        saleId: sale._id,
        status: { $ne: "REJECTED" },
      }).session(transactionSession).exec();
      const supplierPaid = (sale.items ?? []).some((item: { supplierAmountPaid?: number }) => toCents(Number(item.supplierAmountPaid ?? 0)) > 0);
      if (hasSupplierPayments || supplierPaid) {
        fail("Esta venta tiene un abono reportado o confirmado al administrador. Revisa ese movimiento antes de anularla.", 409, "SALE_HAS_SUPPLIER_PAYMENTS");
      }

      for (const item of sale.items) {
        const variantUpdate = await ProductVariantModel.updateOne(
          { _id: item.variantId },
          { $inc: { stock: item.quantity } },
          { session: transactionSession },
        ).exec();
        if (variantUpdate.matchedCount !== 1) fail("No pudimos devolver al inventario la variante de " + item.productTitle + ".", 409, "VARIANT_NOT_FOUND");
        await InventoryMovementModel.create([{
          variantId: item.variantId,
          delta: item.quantity,
          type: "RETURN",
          reason: "Anulación de " + sale.saleNumber + ": " + reason,
          referenceType: "SALE",
          referenceId: String(sale._id),
          performedBy: userId,
        }], { session: transactionSession });
      }

      sale.isActive = false;
      sale.saleStatus = "CANCELLED";
      sale.cancellationReason = reason;
      sale.cancelledAt = new Date();
      sale.cancelledBy = new mongoose.Types.ObjectId(userId);
      await sale.save({ session: transactionSession });
      await PublicOrderModel.updateOne(
        { saleId: sale._id, status: "CONVERTED" },
        { $set: { status: "CANCELLED" } },
        { session: transactionSession },
      ).exec();

      cancelled = {
        _id: String(sale._id),
        saleNumber: sale.saleNumber,
        saleStatus: sale.saleStatus,
        cancellationReason: sale.cancellationReason,
        cancelledAt: sale.cancelledAt,
      };
    });

    if (!cancelled) return errorResponse("No pudimos anular la venta.", 500, "SALE_CANCELLATION_FAILED");
    return NextResponse.json({ ok: true, sale: cancelled, message: "Venta anulada y existencias restauradas. El registro se conserva en el historial." });
  } catch (error) {
    if (error instanceof SaleRequestError) return errorResponse(error.message, error.status, error.code);
    console.error("[SALE_CANCEL]", error);
    return errorResponse("No pudimos anular la venta.", 500, "INTERNAL_ERROR");
  } finally {
    if (session) await session.endSession();
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

    const sourcePublicOrderId = text(body.sourcePublicOrderId);
    if (sourcePublicOrderId && !mongoose.isValidObjectId(sourcePublicOrderId)) {
      return errorResponse("El pedido público de origen no es válido.", 400, "INVALID_PUBLIC_ORDER_ID");
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
    const transactionSession = await mongoose.startSession();
    session = transactionSession;
    let createdSale: unknown = null;

    await transactionSession.withTransaction(async () => {
      let sourceOrder: PublicOrderSource | null = null;
      let effectiveLines = lines;
      const sourceOrderPriceByVariant = new Map<string, number>();

      if (sourcePublicOrderId) {
        sourceOrder = await PublicOrderModel.findOne({
          _id: sourcePublicOrderId,
          resellerId: userId,
          resellerRole: userRole,
          isActive: true,
          status: { $in: ["PENDING", "IN_PROGRESS"] },
        }).session(transactionSession).exec() as unknown as PublicOrderSource | null;

        if (!sourceOrder) {
          fail("El pedido ya fue convertido, cancelado o no pertenece a tu catálogo.", 409, "PUBLIC_ORDER_NOT_CONVERTIBLE");
        }

        const orderLines = sourceOrder.items.map((item) => {
          sourceOrderPriceByVariant.set(String(item.variantId), Number(item.unitPrice));
          return {
            variantId: String(item.variantId),
            quantity: Number(item.quantity),
            unitPrice: item.unitPrice,
          };
        });
        const parsedOrderLines = readSaleLines(orderLines);
        if (!parsedOrderLines) fail("Los productos guardados en el pedido ya no son válidos.", 409, "PUBLIC_ORDER_ITEMS_INVALID");
        effectiveLines = parsedOrderLines;
      }

      let customer: CustomerRecord | null = null;
      if (customerId) {
        customer = await CustomerModel.findOne({
          _id: customerId,
          ownerId: userId,
          isActive: true,
        }).session(transactionSession).lean() as unknown as CustomerRecord | null;
        if (!customer) fail("No encontramos al cliente seleccionado en tu directorio.", 404, "CUSTOMER_NOT_FOUND");
      }

      const variantIds = effectiveLines.map((line) => line.variantId);
      const variants = await ProductVariantModel.find({
        _id: { $in: variantIds },
        isActive: true,
      }).session(transactionSession).lean() as unknown as VariantRecord[];

      if (variants.length !== effectiveLines.length) {
        fail("Una de las variantes ya no está disponible.", 409, "VARIANT_UNAVAILABLE");
      }

      const variantById = new Map<string, VariantRecord>();
      for (const variant of variants) variantById.set(String(variant._id), variant);
      const productIds = [...new Set(variants.map((variant) => String(variant.productId)))];
      const products = await ProductModel.find({ _id: { $in: productIds }, isActive: true })
        .session(transactionSession)
        .lean() as unknown as ProductRecord[];

      if (products.length !== productIds.length) {
        fail("Uno de los productos ya no está disponible.", 409, "PRODUCT_UNAVAILABLE");
      }

      const productById = new Map<string, ProductRecord>();
      for (const product of products) productById.set(String(product._id), product);
      const resellerCatalogItems = await ResellerCatalogItemModel.find({
        resellerId: userId,
        productId: { $in: productIds },
        isActive: true,
      }).session(transactionSession).lean() as unknown as CatalogPriceRecord[];
      const catalogByProductId = new Map<string, CatalogPriceRecord>();
      for (const item of resellerCatalogItems) catalogByProductId.set(String(item.productId), item);

      const normalizedItems = effectiveLines.map((line) => {
        const variant = variantById.get(line.variantId);
        if (!variant) fail("Una de las variantes ya no está disponible.", 409, "VARIANT_UNAVAILABLE");
        const product = productById.get(String(variant.productId));
        if (!product) fail("Uno de los productos ya no está disponible.", 409, "PRODUCT_UNAVAILABLE");
        const catalogItem = catalogByProductId.get(String(product._id));
        if (userRole === "RESELLER" && !catalogItem) {
          fail("Añade primero cada producto a tu catálogo personal.", 403, "PRODUCT_NOT_IN_CATALOG");
        }

        const defaultPrice = catalogItem
          ? (catalogItem.variantPrices?.find((price) => String(price.variantId) === String(variant._id))?.sellingPrice ?? catalogItem.sellingPrice)
          : (variant.wholesalePrice ?? product.wholesalePrice);
        const sourceOrderPrice = sourceOrderPriceByVariant.get(line.variantId);
        const unitPrice = sourceOrderPrice !== undefined
          ? parsePrice(sourceOrderPrice)
          : userRole === "RESELLER" && catalogItem
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
          { session: transactionSession },
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
          : sourceOrder
            ? {
                documentId: sourceOrder.customer.documentId ?? "",
                firstName: sourceOrder.customer.firstName,
                lastName: sourceOrder.customer.lastName ?? "",
                phone: sourceOrder.customer.phone,
                email: sourceOrder.customer.email ?? "",
                address: sourceOrder.customer.address ?? "",
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
          supplierAmountPaid: 0,
          supplierBalanceDue: userRole === "RESELLER" ? item.lineCostTotal : 0,
        })),
        subtotal,
        total: subtotal,
        totalCost: fromCents(totalCostCents),
        grossProfit: fromCents(grossProfitCents),
        ownerRole: userRole,
        supplierAmountDue: userRole === "RESELLER" ? fromCents(totalCostCents) : 0,
        supplierAmountPaid: 0,
        supplierBalanceDue: userRole === "RESELLER" ? fromCents(totalCostCents) : 0,
        supplierPaymentStatus:
          userRole !== "RESELLER" || totalCostCents === 0 ? "PAID" : "UNPAID",
        amountPaid,
        balanceDue,
        paymentStatus: balanceDue <= 0 ? "PAID" : amountPaid > 0 ? "PARTIAL" : "UNPAID",
        note,
        isActive: true,
      }], { session: transactionSession });

      createdSale = created[0];

      await InventoryMovementModel.create(
        normalizedItems.map((item) => ({
          variantId: item.variant._id,
          delta: -item.quantity,
          type: "SALE",
          reason: "Venta " + saleNumber,
          referenceType: "SALE",
          referenceId: String((createdSale as { _id: mongoose.Types.ObjectId })._id),
          performedBy: userId,
        })),
        { session: transactionSession },
      );

      if (initialPaymentCents > 0) {
        await SalePaymentModel.create([{
          saleId: (createdSale as { _id: unknown })._id,
          ownerId: userId,
          amount: amountPaid,
          method: paymentMethod,
          note: note ? "Pago inicial. " + note : "Pago inicial de la venta",
          receivedBy: userId,
        }], { session: transactionSession });
      }

      if (sourceOrder) {
        sourceOrder.status = "CONVERTED";
        sourceOrder.saleId = (createdSale as { _id: mongoose.Types.ObjectId })._id;
        sourceOrder.convertedAt = new Date();
        await sourceOrder.save({ session: transactionSession });
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
