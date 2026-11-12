import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectMongoDB } from "@/lib/db/mongodb";
import { createSale } from "@/lib/api/sales";
import { ProductModel } from "@/models/Product";
import { ProductVariantModel } from "@/models/ProductVariant";
import { PublicOrderModel } from "@/models/PublicOrder";
import { ResellerCatalogItemModel } from "@/models/ResellerCatalogItem";
import { ResellerComboModel } from "@/models/ResellerCombo";
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
type OrderItemRecord = Record<string, any>;

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
  wholesalePrice?: number;
};
type PublicVariantForOrder = {
  _id: mongoose.Types.ObjectId;
  productId: mongoose.Types.ObjectId;
  label: string;
  sku: string;
  stock: number;
  wholesalePrice?: number | null;
};
type ProductOrderInput = { kind: "PRODUCT"; productId: string; variantId: string; quantity: number };
type ComboOrderInput = { kind: "COMBO"; comboId: string; quantity: number; components: { productId: string; variantId: string; quantity: number }[] };
type PublicOrderLineInput = ProductOrderInput | ComboOrderInput;


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
    source = [{ kind: "PRODUCT", productId: text(body.productId), variantId: text(body.variantId), quantity: Number(body.quantity) }];
  }
  if (!Array.isArray(source) || source.length < 1 || source.length > 30) return null;
  const seen = new Set<string>();
  const output: PublicOrderLineInput[] = [];
  for (const value of source) {
    if (!value || typeof value !== "object") return null;
    const item = value as Record<string, unknown>;
    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) return null;
    if (item.kind === "COMBO") {
      const comboId = text(item.comboId);
      if (!mongoose.isValidObjectId(comboId) || !Array.isArray(item.components) || item.components.length < 2 || item.components.length > 5) return null;
      const components: ComboOrderInput["components"] = [];
      const productIds = new Set<string>();
      for (const raw of item.components) {
        if (!raw || typeof raw !== "object") return null;
        const component = raw as Record<string, unknown>;
        const productId = text(component.productId);
        const variantId = text(component.variantId);
        const componentQuantity = Number(component.quantity);
        if (!mongoose.isValidObjectId(productId) || !mongoose.isValidObjectId(variantId) ||
            !Number.isInteger(componentQuantity) || componentQuantity < 1 || componentQuantity > 50 || productIds.has(productId)) return null;
        productIds.add(productId);
        components.push({ productId, variantId, quantity: componentQuantity });
      }
      const key = comboId + ":" + components.map((component) => component.variantId).join("-");
      if (seen.has(key)) return null;
      seen.add(key);
      output.push({ kind: "COMBO", comboId, quantity, components });
    } else {
      const productId = text(item.productId);
      const variantId = text(item.variantId);
      if (!mongoose.isValidObjectId(productId) || !mongoose.isValidObjectId(variantId) || seen.has("P:" + variantId)) return null;
      seen.add("P:" + variantId);
      output.push({ kind: "PRODUCT", productId, variantId, quantity });
    }
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
    items: (order.items ?? []).map((item) => item.kind === "COMBO" ? ({
      kind: "COMBO",
      comboId: String(item.comboId),
      comboTitle: item.comboTitle,
      productTitle: item.productTitle,
      productSku: "",
      variantLabel: item.variantLabel,
      variantSku: "",
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
      stockAtRequest: item.stockAtRequest,
      components: (item.components ?? []).map((component: any) => ({
        productId: String(component.productId),
        variantId: String(component.variantId),
        productTitle: component.productTitle,
        productSku: component.productSku,
        variantLabel: component.variantLabel,
        variantSku: component.variantSku,
        quantity: component.quantity,
        unitCost: component.unitCost,
        stockAtRequest: component.stockAtRequest,
      })),
    }) : ({
      kind: "PRODUCT",
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

      const regularInputs = inputItems.filter((item): item is ProductOrderInput => item.kind === "PRODUCT");
      const comboInputs = inputItems.filter((item): item is ComboOrderInput => item.kind === "COMBO");
      const productIds = [...new Set([
        ...regularInputs.map((item) => item.productId),
        ...comboInputs.flatMap((item) => item.components.map((component) => component.productId)),
      ])];
      const variantIds = [
        ...regularInputs.map((item) => item.variantId),
        ...comboInputs.flatMap((item) => item.components.map((component) => component.variantId)),
      ];
      const comboIds = comboInputs.map((item) => item.comboId);
      const [catalogItems, products, variants, combos] = await Promise.all([
        ResellerCatalogItemModel.find({
          resellerId: seller._id,
          productId: { $in: regularInputs.map((item) => item.productId) },
          isActive: true,
        }).select("productId sellingPrice variantPrices").session(session!).lean() as unknown as Promise<{ productId: mongoose.Types.ObjectId; sellingPrice: number; variantPrices?: { variantId: mongoose.Types.ObjectId; sellingPrice: number }[] }[]>,
        ProductModel.find({ _id: { $in: productIds }, isActive: true })
          .select("_id title sku wholesalePrice").session(session!).lean() as unknown as Promise<PublicProductForOrder[]>,
        ProductVariantModel.find({ _id: { $in: variantIds }, isActive: true })
          .select("_id productId label sku stock wholesalePrice").session(session!).lean() as unknown as Promise<PublicVariantForOrder[]>,
        comboIds.length ? ResellerComboModel.find({ _id: { $in: comboIds }, resellerId: seller._id, isActive: true }).session(session!).lean() as any : Promise.resolve([]),
      ]);

      const productById = new Map(products.map((product) => [String(product._id), product]));
      const variantById = new Map(variants.map((variant) => [String(variant._id), variant]));
      const catalogByProductId = new Map(catalogItems.map((item) => [String(item.productId), item]));
      const comboById = new Map((combos as any[]).map((combo) => [String(combo._id), combo]));
      const normalizedItems = inputItems.map((input) => {
        if (input.kind === "COMBO") {
          const combo = comboById.get(input.comboId);
          if (!combo) throw new PublicOrderError("El combo ya no está publicado en este catálogo.", 409, "COMBO_NOT_AVAILABLE");
          const definitions = combo.components as { productId: mongoose.Types.ObjectId; quantity: number }[];
          if (definitions.length !== input.components.length) throw new PublicOrderError("La composición del combo cambió. Vuelve a configurarlo.", 409, "COMBO_CHANGED");
          const selectedByProduct = new Map(input.components.map((component) => [component.productId, component]));
          if (definitions.some((definition) => !selectedByProduct.has(String(definition.productId)))) {
            throw new PublicOrderError("Selecciona una variante para cada producto del combo.", 400, "COMBO_SELECTION_INCOMPLETE");
          }
          const componentSnapshots = definitions.map((definition) => {
            const productId = String(definition.productId);
            const selected = selectedByProduct.get(productId);
            const product = productById.get(productId);
            const variant = selected ? variantById.get(selected.variantId) : undefined;
            if (!product || !variant || String(variant.productId) !== productId) {
              throw new PublicOrderError("Una variante del combo ya no está disponible.", 409, "COMBO_VARIANT_UNAVAILABLE");
            }
            const quantity = Number(definition.quantity ?? 1);
            if (variant.stock < quantity * input.quantity) {
              throw new PublicOrderError("No hay existencias suficientes para " + product.title + ". Disponibles: " + Math.floor(variant.stock / quantity) + " combos.", 409, "INSUFFICIENT_COMBO_STOCK");
            }
            return {
              productId: product._id,
              variantId: variant._id,
              productTitle: product.title,
              productSku: product.sku,
              variantLabel: variant.label,
              variantSku: variant.sku,
              quantity,
              unitCost: fromCents(toCents(Number(variant.wholesalePrice ?? product.wholesalePrice ?? 0))),
              stockAtRequest: variant.stock,
            };
          });
          const baseCents = componentSnapshots.reduce((sum, component) => sum + toCents(component.unitCost) * component.quantity, 0);
          const base = fromCents(baseCents);
          const unitPrice = fromCents(toCents(combo.profitMode === "PERCENT"
            ? base * (1 + Number(combo.profitValue) / 100)
            : base + Number(combo.profitValue)));
          if (unitPrice <= 0) throw new PublicOrderError("El precio calculado del combo no es válido.", 409, "INVALID_COMBO_PRICE");
          const stockAtRequest = Math.min(...componentSnapshots.map((component) => Math.floor(component.stockAtRequest / component.quantity)));
          return {
            kind: "COMBO",
            comboId: combo._id,
            comboTitle: combo.title,
            components: componentSnapshots,
            productTitle: combo.title,
            productSku: "",
            variantLabel: componentSnapshots.map((component) => component.variantLabel).join(" + "),
            variantSku: "",
            quantity: input.quantity,
            unitPrice,
            lineTotal: fromCents(toCents(unitPrice) * input.quantity),
            stockAtRequest,
          };
        }
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
          kind: "PRODUCT",
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
      items: order.items.flatMap((item: any) => {
        if (item.kind !== "COMBO") return [{
          variantId: String(item.variantId),
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        }];
        const components = item.components ?? [];
        const totalRevenueCents = toCents(Number(item.unitPrice) * Number(item.quantity));
        const totalWeight = components.reduce((sum: number, component: any) =>
          sum + Math.max(1, toCents(Number(component.unitCost) * Number(component.quantity) * Number(item.quantity))), 0);
        let allocated = 0;
        return components.map((component: any, index: number) => {
          const quantity = Number(component.quantity) * Number(item.quantity);
          const lineTotalCents = index === components.length - 1
            ? totalRevenueCents - allocated
            : Math.max(1, Math.round(totalRevenueCents * Math.max(1, toCents(Number(component.unitCost) * quantity)) / totalWeight));
          allocated += lineTotalCents;
          return {
            variantId: String(component.variantId),
            quantity,
            unitPrice: fromCents(Math.max(1, Math.round(lineTotalCents / quantity))),
            lineTotal: fromCents(lineTotalCents),
            comboId: String(item.comboId),
            comboTitle: item.comboTitle || item.productTitle,
            comboGroupId: String(item.comboId) + ":" + String(order._id) + ":" + (item.components ?? []).map((entry: any) => String(entry.variantId)).join("-"),
          };
        });
      }),
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
