import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectMongoDB } from "@/lib/db/mongodb";
import { createSale } from "@/lib/api/sales";
import { ProductModel } from "@/models/Product";
import { ProductVariantModel } from "@/models/ProductVariant";
import { PublicOrderModel } from "@/models/PublicOrder";
import { ResellerCatalogItemModel } from "@/models/ResellerCatalogItem";
import { UserModel } from "@/models/User";
import { CustomerModel } from "@/models/Customer";
import { CustomerIdentityModel } from "@/models/CustomerIdentity";
import { enforceRateLimit } from "@/lib/security/rate-limit";

type Role = "ADMIN" | "RESELLER";
type CustomerInput = {
  documentId: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  address: string;
};
type OrderItemRecord = {
  productId: mongoose.Types.ObjectId | string;
  variantId: mongoose.Types.ObjectId | string;
  productTitle: string;
  productSku: string;
  variantLabel: string;
  variantSku: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  stockAtRequest: number;
};
type CustomerRecord = CustomerInput;
type PublicOrderRecord = {
  _id: mongoose.Types.ObjectId;
  orderNumber: string;
  resellerId: mongoose.Types.ObjectId;
  resellerRole: Role;
  customer: CustomerRecord;
  items: OrderItemRecord[];
  subtotal: number;
  note?: string;
  status: "PENDING" | "IN_PROGRESS" | "CANCELLED" | "CONVERTED";
  saleId?: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
  contactedAt?: Date | null;
  convertedAt?: Date | null;
};
type UserRecord = {
  _id: mongoose.Types.ObjectId;
  firstName: string;
  lastName: string;
  phone?: string;
  role: Role;
  isActive: boolean;
  storeName?: string;
  storeWhatsApp?: string;
};

type PublicProductForOrder = {
  _id: mongoose.Types.ObjectId;
  title: string;
  sku: string;
};
type PublicVariantForOrder = {
  _id: mongoose.Types.ObjectId;
  productId: mongoose.Types.ObjectId;
  label: string;
  sku: string;
  stock: number;
};
type PublicOrderLineInput = { productId: string; variantId: string; quantity: number };

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

function orderNumber() {
  return "TS-P-" + Date.now().toString(36).toUpperCase() + "-" + randomBytes(3).toString("hex").toUpperCase();
}

function customerName(customer?: CustomerRecord) {
  return [customer?.firstName, customer?.lastName].filter(Boolean).join(" ") || "Cliente";
}
function normalizeRequestedItems(body: Record<string, unknown>): PublicOrderLineInput[] | null {
  let source: unknown = body.items;
  if (!Array.isArray(source)) {
    const productId = text(body.productId);
    const variantId = text(body.variantId);
    source = [{ productId, variantId, quantity: Number(body.quantity) }];
  }
  if (!Array.isArray(source) || source.length < 1 || source.length > 30) return null;

  const seen = new Set<string>();
  const output: PublicOrderLineInput[] = [];
  for (const value of source) {
    if (!value || typeof value !== "object") return null;
    const item = value as Record<string, unknown>;
    const productId = text(item.productId);
    const variantId = text(item.variantId);
    const quantity = Number(item.quantity);
    if (!/^[a-f0-9]{24}$/i.test(productId) || !/^[a-f0-9]{24}$/i.test(variantId) ||
      !Number.isInteger(quantity) || quantity < 1 || quantity > 100 || seen.has(variantId)) return null;
    seen.add(variantId);
    output.push({ productId, variantId, quantity });
  }
  return output;
}

function serializeOrder(order: PublicOrderRecord, seller?: UserRecord) {
  return {
    _id: String(order._id),
    orderNumber: order.orderNumber,
    resellerId: String(order.resellerId),
    resellerName: seller ? (seller.storeName?.trim() || [seller.firstName, seller.lastName].filter(Boolean).join(" ")) : "",
    resellerPhone: seller?.storeWhatsApp?.trim() || seller?.phone || "",
    resellerRole: order.resellerRole,
    customer: order.customer,
    customerName: customerName(order.customer),
    items: (order.items ?? []).map((item) => ({
      productId: String(item.productId),
      variantId: String(item.variantId),
      productTitle: item.productTitle,
      productSku: item.productSku,
      variantLabel: item.variantLabel,
      variantSku: item.variantSku,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
      stockAtRequest: item.stockAtRequest,
    })),
    subtotal: order.subtotal,
    note: order.note ?? "",
    status: order.status,
    saleId: order.saleId ? String(order.saleId) : null,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    contactedAt: order.contactedAt ?? null,
    convertedAt: order.convertedAt ?? null,
  };
}

export async function createPublicOrder(request: Request, buyerId: string) {
  let session: mongoose.ClientSession | null = null;
  let createdOrder: unknown = null;
  try {
    const blocked = await enforceRateLimit(request, "public-order", 8, 60 * 60 * 1000, buyerId);
    if (blocked) return blocked;

    const body = await request.json() as Record<string, unknown>;
    const resellerId = text(body.resellerId);
    const inputItems = normalizeRequestedItems(body);
    const customerDataConsent = body.customerDataConsent === true;
    const address = text(body.address);
    const note = text(body.note).slice(0, 500);

    if (!mongoose.isValidObjectId(resellerId) || !inputItems) {
      return errorResponse("El catálogo o los productos seleccionados no son válidos.", 400, "INVALID_PUBLIC_ORDER_REFERENCE");
    }
    if (resellerId === buyerId) {
      return errorResponse("No puedes generar un pedido desde tu propia tienda.", 400, "CANNOT_ORDER_OWN_STORE");
    }
    if (address.length > 300) {
      return errorResponse("La dirección no puede superar los 300 caracteres.");
    }
    if (!customerDataConsent) {
      return errorResponse("Debes autorizar que compartamos tus datos de cuenta con esta tienda para gestionar el pedido.", 400, "CUSTOMER_DATA_CONSENT_REQUIRED");
    }

    await connectMongoDB();
    session = await mongoose.startSession();

    await session.withTransaction(async () => {
      const [buyer, seller] = await Promise.all([
        UserModel.findOne({ _id: buyerId, isActive: true })
          .select("_id documentId firstName lastName phone email")
          .session(session!).exec(),
        UserModel.findOne({
          _id: resellerId,
          role: { $in: ["ADMIN", "RESELLER"] },
          isActive: true,
        }).select("_id role").session(session!).exec(),
      ]);

      if (!buyer) throw new PublicOrderError("Tu cuenta ya no está disponible. Inicia sesión nuevamente.", 401, "BUYER_NOT_AVAILABLE");
      if (!seller) throw new PublicOrderError("Este catálogo ya no está disponible.", 404, "CATALOG_NOT_FOUND");

      const productIds = [...new Set(inputItems.map((item) => item.productId))];
      const variantIds = inputItems.map((item) => item.variantId);
      const [catalogItems, products, variants] = await Promise.all([
        ResellerCatalogItemModel.find({
          resellerId: seller._id,
          productId: { $in: productIds },
          isActive: true,
        }).select("productId sellingPrice variantPrices").session(session!).lean() as unknown as Promise<{ productId: mongoose.Types.ObjectId; sellingPrice: number; variantPrices?: { variantId: mongoose.Types.ObjectId; sellingPrice: number }[] }[]>,
        ProductModel.find({ _id: { $in: productIds }, isActive: true })
          .select("_id title sku").session(session!).lean() as unknown as Promise<PublicProductForOrder[]>,
        ProductVariantModel.find({ _id: { $in: variantIds }, isActive: true })
          .select("_id productId label sku stock").session(session!).lean() as unknown as Promise<PublicVariantForOrder[]>,
      ]);

      const productById = new Map(products.map((product) => [String(product._id), product]));
      const variantById = new Map(variants.map((variant) => [String(variant._id), variant]));
      const catalogByProductId = new Map(catalogItems.map((item) => [String(item.productId), item]));
      const normalizedItems = inputItems.map((input) => {
        const product = productById.get(input.productId);
        const variant = variantById.get(input.variantId);
        const catalog = catalogByProductId.get(input.productId);
        if (!product || !variant || String(variant.productId) !== input.productId) {
          throw new PublicOrderError("Uno de los productos o variantes ya no está disponible.", 409, "PRODUCT_UNAVAILABLE");
        }
        if (!catalog) {
          throw new PublicOrderError("El producto " + product.title + " ya no está publicado en este catálogo.", 409, "PRODUCT_NOT_IN_CATALOG");
        }
        const variantSellingPrice = catalog.variantPrices?.find((price) => String(price.variantId) === input.variantId)?.sellingPrice;
        const effectiveSellingPrice = variantSellingPrice ?? catalog.sellingPrice;
        if (toCents(effectiveSellingPrice) <= 0) {
          throw new PublicOrderError("El producto " + product.title + " no tiene un precio de venta válido.", 409, "INVALID_PRICE");
        }
        if (variant.stock < input.quantity) {
          throw new PublicOrderError("Solo quedan " + variant.stock + " unidades de " + product.title + " (" + variant.label + ").", 409, "INSUFFICIENT_STOCK");
        }
        const unitPrice = fromCents(toCents(effectiveSellingPrice));
        return {
          productId: product._id,
          variantId: variant._id,
          productTitle: product.title,
          productSku: product.sku,
          variantLabel: variant.label,
          variantSku: variant.sku,
          quantity: input.quantity,
          unitPrice,
          lineTotal: fromCents(toCents(unitPrice) * input.quantity),
          stockAtRequest: variant.stock,
        };
      });

      const customer: CustomerInput = {
        documentId: buyer.documentId,
        firstName: buyer.firstName,
        lastName: buyer.lastName,
        phone: buyer.phone,
        email: buyer.email,
        address,
      };

      const customerRecord = await CustomerModel.findOne({
        ownerId: seller._id,
        documentId: customer.documentId,
      }).session(session!).exec();
      if (customerRecord) {
        customerRecord.firstName = customer.firstName;
        customerRecord.lastName = customer.lastName;
        customerRecord.phone = customer.phone;
        customerRecord.email = customer.email;
        if (address) customerRecord.address = address;
        customerRecord.dataProcessingConsent = true;
        customerRecord.dataProcessingConsentAt = customerRecord.dataProcessingConsentAt ?? new Date();
        customerRecord.isActive = true;
        await customerRecord.save({ session: session! });
      } else {
        await CustomerModel.create([{
          ownerId: seller._id,
          ...customer,
          dataProcessingConsent: true,
          dataProcessingConsentAt: new Date(),
          isActive: true,
        }], { session: session! });
      }

      const identity = await CustomerIdentityModel.findOne({ documentId: buyer.documentId }).session(session!).exec();
      if (identity) {
        identity.firstName = buyer.firstName;
        identity.lastName = buyer.lastName;
        identity.phone = buyer.phone;
        identity.email = buyer.email;
        if (address) identity.address = address;
        identity.dataProcessingConsent = true;
        identity.dataProcessingConsentAt = identity.dataProcessingConsentAt ?? new Date();
        identity.convertedUserId = buyer._id as mongoose.Types.ObjectId;
        identity.isActive = true;
        await identity.save({ session: session! });
      } else {
        await CustomerIdentityModel.create([{
          ...customer,
          sessionTokenHashes: [],
          convertedUserId: buyer._id,
          dataProcessingConsent: true,
          dataProcessingConsentAt: new Date(),
          notificationsWhatsAppConsent: false,
          notificationsEmailConsent: false,
          isActive: true,
        }], { session: session! });
      }

      const subtotal = fromCents(normalizedItems.reduce((sum, item) => sum + toCents(item.lineTotal), 0));
      const created = await PublicOrderModel.create([{
        orderNumber: orderNumber(),
        resellerId: seller._id,
        resellerRole: seller.role,
        customer,
        items: normalizedItems,
        subtotal,
        note,
        status: "PENDING",
        isActive: true,
      }], { session: session! });
      createdOrder = created[0];
    });

    if (!createdOrder) return errorResponse("No pudimos registrar el pedido.", 500, "ORDER_NOT_CREATED");
    return NextResponse.json({
      ok: true,
      order: serializeOrder((createdOrder as { toObject(): unknown }).toObject() as unknown as PublicOrderRecord),
      message: "Solicitud registrada. El vendedor confirmará existencias, precio y entrega antes de crear la venta.",
    }, {
      status: 201,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    if (error instanceof PublicOrderError) return errorResponse(error.message, error.status, error.code);
    if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
      return errorResponse("Ya existe un registro con estos datos. Revisa la información e inténtalo de nuevo.", 409, "DUPLICATE_CUSTOMER_OR_ORDER");
    }
    console.error("[PUBLIC_ORDER_CREATE]", error);
    return errorResponse("No pudimos registrar el pedido. Inténtalo de nuevo.", 500, "INTERNAL_ERROR");
  } finally {
    if (session) await session.endSession();
  }
}

class PublicOrderError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function listPublicOrders(userId: string, userRole: string) {
  if (userRole !== "ADMIN" && userRole !== "RESELLER") {
    return errorResponse("No tienes permiso para consultar pedidos.", 403, "FORBIDDEN");
  }

  try {
    await connectMongoDB();
    const filter = userRole === "ADMIN" ? { isActive: true } : { resellerId: userId, isActive: true };
    const orders = await PublicOrderModel.find(filter).sort({ createdAt: -1 }).lean() as unknown as PublicOrderRecord[];
    const sellerIds = [...new Set(orders.map((order) => String(order.resellerId)))];
    const sellers = sellerIds.length
      ? await UserModel.find({ _id: { $in: sellerIds } }).select("_id firstName lastName phone role isActive storeName storeWhatsApp").lean() as unknown as UserRecord[]
      : [];
    const sellerById = new Map<string, UserRecord>();
    for (const seller of sellers) sellerById.set(String(seller._id), seller);

    return NextResponse.json({
      ok: true,
      orders: orders.map((order) => serializeOrder(order, sellerById.get(String(order.resellerId)))),
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    console.error("[PUBLIC_ORDER_LIST]", error);
    return errorResponse("No pudimos cargar los pedidos.", 500, "INTERNAL_ERROR");
  }
}

export async function updatePublicOrder(request: Request, orderId: string, userId: string, userRole: string) {
  if (!mongoose.isValidObjectId(orderId)) {
    return errorResponse("El pedido seleccionado no es válido.", 400, "INVALID_ORDER_ID");
  }
  if (userRole !== "ADMIN" && userRole !== "RESELLER") {
    return errorResponse("No tienes permiso para actualizar pedidos.", 403, "FORBIDDEN");
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return errorResponse("La solicitud no contiene datos válidos.");
  }

  const action = text(body.action).toUpperCase();
  if (action === "CONVERT") {
    return convertPublicOrderToSale(orderId, userId, userRole);
  }
  if (action !== "IN_PROGRESS" && action !== "CANCELLED") {
    return errorResponse("La acción solicitada no es válida.", 400, "INVALID_ORDER_ACTION");
  }

  try {
    await connectMongoDB();
    const filter: Record<string, any> = { _id: orderId, isActive: true };
    if (userRole !== "ADMIN") filter.resellerId = userId;

    const order = await PublicOrderModel.findOne(filter);
    if (!order) return errorResponse("No encontramos el pedido en tu cuenta.", 404, "ORDER_NOT_FOUND");
    if (order.status === "CONVERTED") return errorResponse("Este pedido ya se convirtió en venta y no se puede cambiar.", 409, "ORDER_ALREADY_CONVERTED");
    if (order.status === "CANCELLED" && action !== "CANCELLED") {
      return errorResponse("Un pedido cancelado no se puede reabrir.", 409, "ORDER_CANCELLED");
    }

    order.status = action;
    if (action === "IN_PROGRESS" && !order.contactedAt) order.contactedAt = new Date();
    await order.save();
    return NextResponse.json({
      ok: true,
      order: serializeOrder(order.toObject() as unknown as PublicOrderRecord),
      message: action === "IN_PROGRESS" ? "Pedido marcado como en gestión." : "Pedido cancelado.",
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    console.error("[PUBLIC_ORDER_UPDATE]", error);
    return errorResponse("No pudimos actualizar el pedido.", 500, "INTERNAL_ERROR");
  }
}

async function convertPublicOrderToSale(orderId: string, userId: string, userRole: string) {
  if (userRole !== "ADMIN" && userRole !== "RESELLER") {
    return errorResponse("No tienes permiso para convertir pedidos en ventas.", 403, "FORBIDDEN");
  }

  try {
    await connectMongoDB();
    const filter: Record<string, any> = { _id: orderId, isActive: true, status: { $in: ["PENDING", "IN_PROGRESS"] } };
    filter.resellerId = userId;
    const order = await PublicOrderModel.findOne(filter).lean() as unknown as PublicOrderRecord | null;
    if (!order) {
      return errorResponse("No encontramos un pedido pendiente propio para convertir. Los pedidos ya convertidos o de otro vendedor no se pueden reutilizar.", 404, "ORDER_NOT_FOUND_OR_CLOSED");
    }

    const payload = {
      sourcePublicOrderId: String(order._id),
      items: order.items.map((item) => ({
        variantId: String(item.variantId),
        quantity: item.quantity,
        unitPrice: item.unitPrice,
      })),
      initialPayment: 0,
      paymentMethod: "CASH",
      note: "Pedido público " + order.orderNumber + (order.note ? " · " + order.note : ""),
    };
    const request = new Request("http://internal/api/sales", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return createSale(request, userId, userRole);
  } catch (error) {
    console.error("[PUBLIC_ORDER_CONVERT]", error);
    return errorResponse("No pudimos convertir el pedido en venta.", 500, "INTERNAL_ERROR");
  }
}
