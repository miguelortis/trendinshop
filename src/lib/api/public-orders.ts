import { createHash, randomBytes } from "node:crypto";
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
function normalizeDocumentId(value: unknown) {
  return text(value).toUpperCase().replace(/[.\s-]/g, "");
}
function hashToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
function validSessionToken(hashes: unknown, token: string) {
  return Boolean(token && Array.isArray(hashes) && hashes.some((value) => value === hashToken(token)));
}
function randomCustomerSessionToken() {
  return randomBytes(32).toString("hex");
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

export async function createPublicOrder(request: Request) {
  let session: mongoose.ClientSession | null = null;
  let createdOrder: unknown = null;
  let customerSessionToken = "";
  try {
    const body = await request.json() as Record<string, unknown>;
    const resellerId = text(body.resellerId);
    const inputItems = normalizeRequestedItems(body);
    const customerBody = body.customer && typeof body.customer === "object"
      ? body.customer as Record<string, unknown>
      : body;
    const documentId = normalizeDocumentId(customerBody.documentId);
    const submittedCustomer: CustomerInput = {
      documentId,
      firstName: text(customerBody.firstName),
      lastName: text(customerBody.lastName),
      phone: text(customerBody.phone),
      email: text(customerBody.email).toLowerCase(),
      address: text(customerBody.address),
    };
    const submittedToken = text(body.customerSessionToken);
    const rememberCustomer = body.rememberCustomer === true;
    const customerDataConsent = body.customerDataConsent === true;
    const notificationsWhatsAppConsent = body.notificationsWhatsAppConsent === true;
    const notificationsEmailConsent = body.notificationsEmailConsent === true;
    const note = text(body.note).slice(0, 500);

    if (!mongoose.isValidObjectId(resellerId) || !inputItems) {
      return errorResponse("El catálogo o los productos seleccionados no son válidos.", 400, "INVALID_PUBLIC_ORDER_REFERENCE");
    }
    if (!documentId || documentId.length > 40 ||
      submittedCustomer.firstName.length > 100 || submittedCustomer.lastName.length > 100 ||
      submittedCustomer.phone.length > 40 || submittedCustomer.email.length > 200 ||
      submittedCustomer.address.length > 300) {
      return errorResponse("Revisa la cédula y los datos introducidos.", 400, "INVALID_CUSTOMER_FIELDS");
    }
    if (submittedCustomer.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(submittedCustomer.email)) {
      return errorResponse("El correo electrónico no tiene un formato válido.");
    }
    if (!customerDataConsent) {
      return errorResponse("Debes aceptar el uso de tus datos para gestionar este pedido y facilitar futuras compras.", 400, "CUSTOMER_DATA_CONSENT_REQUIRED");
    }
    if (submittedToken && !/^[a-f0-9]{64}$/i.test(submittedToken)) {
      return errorResponse("La sesión de cliente guardada no es válida. Completa los datos del cliente nuevamente.", 400, "INVALID_CUSTOMER_SESSION");
    }

    await connectMongoDB();
    session = await mongoose.startSession();

    await session.withTransaction(async () => {
      const seller = await UserModel.findOne({
        _id: resellerId,
        role: { $in: ["ADMIN", "RESELLER"] },
        isActive: true,
      }).select("_id role").session(session!).lean() as unknown as { _id: mongoose.Types.ObjectId; role: Role } | null;

      if (!seller) throw new PublicOrderError("Este catálogo ya no está disponible.", 404, "CATALOG_NOT_FOUND");

      const productIds = [...new Set(inputItems.map((item) => item.productId))];
      const variantIds = inputItems.map((item) => item.variantId);
      const [catalogItems, products, variants] = await Promise.all([
        ResellerCatalogItemModel.find({
          resellerId: seller._id,
          productId: { $in: productIds },
          isActive: true,
        }).select("productId sellingPrice").session(session!).lean() as unknown as Promise<{ productId: mongoose.Types.ObjectId; sellingPrice: number }[]>,
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
        if (toCents(catalog.sellingPrice) <= 0) {
          throw new PublicOrderError("El producto " + product.title + " no tiene un precio de venta válido.", 409, "INVALID_PRICE");
        }
        if (variant.stock < input.quantity) {
          throw new PublicOrderError("Solo quedan " + variant.stock + " unidades de " + product.title + " (" + variant.label + ").", 409, "INSUFFICIENT_STOCK");
        }
        const unitPrice = fromCents(toCents(catalog.sellingPrice));
        const lineTotal = fromCents(toCents(unitPrice) * input.quantity);
        return {
          productId: product._id,
          variantId: variant._id,
          productTitle: product.title,
          productSku: product.sku,
          variantLabel: variant.label,
          variantSku: variant.sku,
          quantity: input.quantity,
          unitPrice,
          lineTotal,
          stockAtRequest: variant.stock,
        };
      });
      const subtotalCents = normalizedItems.reduce((sum, item) => sum + toCents(item.lineTotal), 0);
      const subtotal = fromCents(subtotalCents);

      const identity = await CustomerIdentityModel.findOne({
        documentId,
        isActive: true,
      }).session(session!).exec();
      const registeredUser = await UserModel.findOne({
        documentId,
        isActive: true,
      }).select("_id documentId firstName lastName phone email role")
        .session(session!).exec() as unknown as {
          _id: mongoose.Types.ObjectId;
          documentId: string;
          firstName: string;
          lastName: string;
          phone: string;
          email: string;
          role: Role;
        } | null;

      let resolvedCustomer: CustomerInput;
      let customerProfileId: mongoose.Types.ObjectId;
      const customerProfileAlreadyExisted = Boolean(identity);

      if (identity) {
        // The database is authoritative for existing customers. The public
        // client submits only the document ID and optional delivery details.
        resolvedCustomer = {
          documentId: identity.documentId,
          firstName: registeredUser?.firstName ?? identity.firstName,
          lastName: registeredUser?.lastName ?? identity.lastName,
          phone: registeredUser?.phone ?? identity.phone,
          email: text(registeredUser?.email ?? identity.email).toLowerCase(),
          address: submittedCustomer.address,
        };
        customerProfileId = identity._id as mongoose.Types.ObjectId;

        const hasSubmittedValidToken = validSessionToken(identity.sessionTokenHashes, submittedToken);
        customerSessionToken = rememberCustomer
          ? (hasSubmittedValidToken ? submittedToken : randomCustomerSessionToken())
          : "";
        if (rememberCustomer && customerSessionToken && !hasSubmittedValidToken) {
          identity.sessionTokenHashes = [
            ...(identity.sessionTokenHashes ?? []),
            hashToken(customerSessionToken),
          ].slice(-5);
        } else if (!rememberCustomer && hasSubmittedValidToken) {
          const usedTokenHash = hashToken(submittedToken);
          identity.sessionTokenHashes = (identity.sessionTokenHashes ?? [])
            .filter((value: string) => value !== usedTokenHash);
        }

        if (submittedCustomer.address) identity.address = submittedCustomer.address;
        identity.dataProcessingConsent = true;
        identity.dataProcessingConsentAt = identity.dataProcessingConsentAt ?? new Date();
        identity.notificationsWhatsAppConsent = notificationsWhatsAppConsent;
        identity.notificationsEmailConsent = notificationsEmailConsent;
        await identity.save({ session: session! });
      } else if (registeredUser) {
        // Reseller accounts can also place public orders. Link a lightweight
        // customer identity to the existing account instead of asking them
        // to re-enter or exposing their protected contact details.
        resolvedCustomer = {
          documentId: registeredUser.documentId,
          firstName: registeredUser.firstName,
          lastName: registeredUser.lastName,
          phone: registeredUser.phone,
          email: registeredUser.email,
          address: submittedCustomer.address,
        };
        customerSessionToken = rememberCustomer ? randomCustomerSessionToken() : "";
        const createdIdentities = await CustomerIdentityModel.create([{
          ...resolvedCustomer,
          sessionTokenHashes: customerSessionToken ? [hashToken(customerSessionToken)] : [],
          convertedUserId: registeredUser._id,
          dataProcessingConsent: true,
          dataProcessingConsentAt: new Date(),
          notificationsWhatsAppConsent,
          notificationsEmailConsent,
          isActive: true,
        }], { session: session! });
        customerProfileId = createdIdentities[0]._id as mongoose.Types.ObjectId;
      } else {
        // New customer: only this path requires the full set of personal data.
        if (!submittedCustomer.firstName || !submittedCustomer.lastName ||
          !submittedCustomer.phone || !submittedCustomer.email) {
          throw new PublicOrderError(
            "Completa nombre, apellido, teléfono y correo electrónico para registrar tus datos.",
            400,
            "CUSTOMER_FIELDS_REQUIRED",
          );
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(submittedCustomer.email)) {
          throw new PublicOrderError("El correo electrónico no tiene un formato válido.", 400, "INVALID_EMAIL");
        }

        resolvedCustomer = submittedCustomer;
        customerSessionToken = rememberCustomer ? randomCustomerSessionToken() : "";
        const createdIdentities = await CustomerIdentityModel.create([{
          ...resolvedCustomer,
          sessionTokenHashes: customerSessionToken ? [hashToken(customerSessionToken)] : [],
          dataProcessingConsent: true,
          dataProcessingConsentAt: new Date(),
          notificationsWhatsAppConsent,
          notificationsEmailConsent,
          isActive: true,
        }], { session: session! });
        customerProfileId = createdIdentities[0]._id as mongoose.Types.ObjectId;
      }

      if (!resolvedCustomer.phone || !resolvedCustomer.email ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(resolvedCustomer.email)) {
        throw new PublicOrderError(
          "El perfil encontrado no tiene un teléfono y correo válidos para gestionar el pedido. Contacta al vendedor.",
          409,
          "CUSTOMER_PROFILE_INCOMPLETE",
        );
      }

      const customer = await CustomerModel.findOne({
        ownerId: seller._id,
        documentId,
      }).session(session!).exec();
      if (customer) {
        customer.firstName = resolvedCustomer.firstName;
        customer.lastName = resolvedCustomer.lastName;
        customer.phone = resolvedCustomer.phone;
        customer.email = resolvedCustomer.email;
        if (submittedCustomer.address) customer.address = submittedCustomer.address;
        customer.isActive = true;
        await customer.save({ session: session! });
      } else {
        await CustomerModel.create([{
          ownerId: seller._id,
          ...resolvedCustomer,
          isActive: true,
        }], { session: session! });
      }

      const created = await PublicOrderModel.create([{
        orderNumber: orderNumber(),
        resellerId: seller._id,
        resellerRole: seller.role,
        customer: resolvedCustomer,
        customerProfileId,
        items: normalizedItems,
        subtotal,
        note,
        status: "PENDING",
        isActive: true,
      }], { session: session! });
      createdOrder = created[0];
    });

    if (!createdOrder) return errorResponse("No pudimos registrar el pedido.", 500, "ORDER_NOT_CREATED");
    const result = {
      ok: true,
      order: serializeOrder((createdOrder as { toObject(): unknown }).toObject() as unknown as PublicOrderRecord),
      customerSessionToken: rememberCustomer ? customerSessionToken : "",
      message: "Solicitud registrada. El vendedor confirmará existencias, precio y entrega antes de crear la venta.",
    };
    return NextResponse.json(result, {
      status: 201,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    if (error instanceof PublicOrderError) return errorResponse(error.message, error.status, error.code);
    if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
      return errorResponse("Ya existe un registro con estos datos. Revisa la cédula e inténtalo de nuevo.", 409, "DUPLICATE_CUSTOMER_OR_ORDER");
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
