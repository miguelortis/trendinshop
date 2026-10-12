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

type Role = "ADMIN" | "RESELLER";
type CustomerInput = { firstName: string; lastName: string; phone: string; email: string; address: string };
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

function orderNumber() {
  return "TS-P-" + Date.now().toString(36).toUpperCase() + "-" + randomBytes(3).toString("hex").toUpperCase();
}

function customerName(customer?: CustomerRecord) {
  return [customer?.firstName, customer?.lastName].filter(Boolean).join(" ") || "Cliente";
}

function serializeOrder(order: PublicOrderRecord, seller?: UserRecord) {
  return {
    _id: String(order._id),
    orderNumber: order.orderNumber,
    resellerId: String(order.resellerId),
    resellerName: seller ? [seller.firstName, seller.lastName].filter(Boolean).join(" ") : "",
    resellerPhone: seller?.phone ?? "",
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

export async function createPublicOrder(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const resellerId = text(body.resellerId);
    const productId = text(body.productId);
    const variantId = text(body.variantId);
    const quantity = Number(body.quantity);
    const customer: CustomerInput = {
      firstName: text(body.firstName),
      lastName: text(body.lastName),
      phone: text(body.phone),
      email: text(body.email).toLowerCase(),
      address: text(body.address),
    };
    const note = text(body.note).slice(0, 500);

    if (!mongoose.isValidObjectId(resellerId) || !mongoose.isValidObjectId(productId) || !mongoose.isValidObjectId(variantId)) {
      return errorResponse("El catálogo o producto seleccionado no es válido.", 400, "INVALID_PUBLIC_ORDER_REFERENCE");
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
      return errorResponse("La cantidad debe estar entre 1 y 100.", 400, "INVALID_QUANTITY");
    }
    if (!customer.firstName || customer.firstName.length > 100 || customer.lastName.length > 100 ||
        !customer.phone || customer.phone.length > 40 || customer.email.length > 200 || customer.address.length > 300) {
      return errorResponse("Completa tu nombre y teléfono e ingresa datos dentro de los límites permitidos.");
    }
    if (customer.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) {
      return errorResponse("El correo electrónico no tiene un formato válido.");
    }

    await connectMongoDB();
    const seller = await UserModel.findOne({
      _id: resellerId,
      role: { $in: ["ADMIN", "RESELLER"] },
      isActive: true,
    }).select("_id role").lean() as unknown as { _id: mongoose.Types.ObjectId; role: Role } | null;

    if (!seller) return errorResponse("Este catálogo ya no está disponible.", 404, "CATALOG_NOT_FOUND");

    const catalogItem = await ResellerCatalogItemModel.findOne({
      resellerId: seller._id,
      productId,
      isActive: true,
    }).select("sellingPrice").lean() as unknown as { sellingPrice: number } | null;
    if (!catalogItem) return errorResponse("Este producto ya no está publicado en el catálogo.", 404, "PRODUCT_NOT_IN_CATALOG");

    const [product, variant] = await Promise.all([
      ProductModel.findOne({ _id: productId, isActive: true }).select("_id title sku").lean(),
      ProductVariantModel.findOne({ _id: variantId, productId, isActive: true }).select("_id productId label sku stock").lean(),
    ]);

    if (!product || !variant) return errorResponse("El producto o variante ya no está disponible.", 409, "PRODUCT_UNAVAILABLE");
    if (variant.stock < quantity) {
      return errorResponse("Solo quedan " + variant.stock + " unidades disponibles.", 409, "INSUFFICIENT_STOCK");
    }

    const unitPrice = fromCents(toCents(catalogItem.sellingPrice));
    const subtotal = fromCents(toCents(unitPrice) * quantity);
    const created = await PublicOrderModel.create({
      orderNumber: orderNumber(),
      resellerId: seller._id,
      resellerRole: seller.role,
      customer,
      items: [{
        productId: product._id,
        variantId: variant._id,
        productTitle: product.title,
        productSku: product.sku,
        variantLabel: variant.label,
        variantSku: variant.sku,
        quantity,
        unitPrice,
        lineTotal: subtotal,
        stockAtRequest: variant.stock,
      }],
      subtotal,
      note,
      status: "PENDING",
      isActive: true,
    });

    const result = {
      ok: true,
      order: serializeOrder(created.toObject() as unknown as PublicOrderRecord),
      message: "Pedido enviado. El vendedor se pondrá en contacto contigo para confirmar la disponibilidad y entrega.",
    };
    return NextResponse.json(result, {
      status: 201,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
      return errorResponse("No pudimos asignar un número único al pedido. Inténtalo de nuevo.", 409, "ORDER_NUMBER_CONFLICT");
    }
    console.error("[PUBLIC_ORDER_CREATE]", error);
    return errorResponse("No pudimos registrar el pedido. Inténtalo de nuevo.", 500, "INTERNAL_ERROR");
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
      ? await UserModel.find({ _id: { $in: sellerIds } }).select("_id firstName lastName phone role isActive").lean() as unknown as UserRecord[]
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
