import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectMongoDB } from "@/lib/db/mongodb";
import { SaleModel } from "@/models/Sale";
import { SalePaymentModel } from "@/models/SalePayment";

type PaymentMethod = "CASH" | "TRANSFER" | "CARD" | "OTHER";
type SaleSnapshot = {
  firstName?: string;
  lastName?: string;
  documentId?: string;
  phone?: string;
};
type ReceivableRecord = {
  _id: mongoose.Types.ObjectId;
  saleNumber: string;
  customerSnapshot?: SaleSnapshot;
  total: number;
  amountPaid: number;
  balanceDue: number;
  paymentStatus: "UNPAID" | "PARTIAL" | "PAID";
  createdAt: Date;
  items: { productTitle: string; variantLabel: string; quantity: number }[];
  note?: string;
};
type PaymentRecord = {
  _id: mongoose.Types.ObjectId;
  saleId: mongoose.Types.ObjectId;
  amount: number;
  method: PaymentMethod;
  note?: string;
  createdAt: Date;
};
type SaleForPayment = {
  _id: mongoose.Types.ObjectId;
  saleNumber: string;
  customerSnapshot?: SaleSnapshot;
};

class PaymentRequestError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 400, code = "BAD_REQUEST") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function fail(message: string, status = 400, code = "BAD_REQUEST"): never {
  throw new PaymentRequestError(message, status, code);
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

function customerName(customer?: SaleSnapshot) {
  return [customer?.firstName, customer?.lastName].filter(Boolean).join(" ") || "Cliente ocasional";
}

function methodLabel(method: PaymentMethod) {
  const labels: Record<PaymentMethod, string> = {
    CASH: "Efectivo",
    TRANSFER: "Transferencia",
    CARD: "Tarjeta",
    OTHER: "Otro",
  };
  return labels[method];
}

export async function listReceivables(request: Request, userId: string) {
  try {
    await connectMongoDB();
    const url = new URL(request.url);
    const page = Math.max(1, Math.trunc(Number(url.searchParams.get("page") || 1) || 1));
    const limit = Math.min(100, Math.max(1, Math.trunc(Number(url.searchParams.get("limit") || 25) || 25)));
    const query = text(url.searchParams.get("q")).slice(0, 100);
    const from = text(url.searchParams.get("from"));
    const to = text(url.searchParams.get("to"));
    const filter: Record<string, unknown> = {
      ownerId: userId,
      isActive: true,
      balanceDue: { $gt: 0 },
    };
    const andFilters: Record<string, unknown>[] = [];
    if (query) {
      const special = new Set([String.fromCharCode(92), "^", "$", ".", "*", "+", "?", "(", ")", "[", "]", "{", "}", "|"]);
      const escaped = query.split("").map((character) => special.has(character) ? String.fromCharCode(92) + character : character).join("");
      const pattern = new RegExp(escaped, "i");
      andFilters.push({ $or: [
        { saleNumber: pattern },
        { "customerSnapshot.firstName": pattern },
        { "customerSnapshot.lastName": pattern },
        { "customerSnapshot.documentId": pattern },
        { "customerSnapshot.phone": pattern },
        { "items.productTitle": pattern },
        { "items.variantLabel": pattern },
      ] });
    }
    if (from || to) {
      const createdAt: Record<string, Date> = {};
      if (from && !Number.isNaN(Date.parse(from))) createdAt.$gte = new Date(from + "T00:00:00.000Z");
      if (to && !Number.isNaN(Date.parse(to))) createdAt.$lte = new Date(to + "T23:59:59.999Z");
      if (Object.keys(createdAt).length) andFilters.push({ createdAt });
    }
    if (andFilters.length) filter.$and = andFilters;

    const [sales, total, summaryRows] = await Promise.all([
      SaleModel.find(filter).sort({ createdAt: 1 }).skip((page - 1) * limit).limit(limit).lean() as unknown as Promise<ReceivableRecord[]>,
      SaleModel.countDocuments(filter),
      SaleModel.aggregate([
        { $match: filter },
        { $group: {
          _id: null,
          count: { $sum: 1 },
          total: { $sum: "$total" },
          amountPaid: { $sum: "$amountPaid" },
          balanceDue: { $sum: "$balanceDue" },
        } },
      ]).exec() as Promise<{ count?: number; total?: number; amountPaid?: number; balanceDue?: number }[]>,
    ]);

    const receivables = sales.map((sale) => ({
      _id: String(sale._id),
      saleNumber: sale.saleNumber,
      customerSnapshot: sale.customerSnapshot ?? {},
      customerName: customerName(sale.customerSnapshot),
      total: sale.total,
      amountPaid: sale.amountPaid,
      balanceDue: sale.balanceDue,
      paymentStatus: sale.paymentStatus,
      createdAt: sale.createdAt,
      items: sale.items.map((item) => ({
        productTitle: item.productTitle,
        variantLabel: item.variantLabel,
        quantity: item.quantity,
      })),
    }));
    const summary = summaryRows[0] ?? {};
    return NextResponse.json({
      ok: true,
      receivables,
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
      summary: {
        count: summary.count ?? 0,
        total: fromCents(toCents(summary.total ?? 0)),
        amountPaid: fromCents(toCents(summary.amountPaid ?? 0)),
        balanceDue: fromCents(toCents(summary.balanceDue ?? 0)),
      },
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    console.error("[RECEIVABLES_LIST]", error);
    return errorResponse("No pudimos cargar las cuentas por cobrar.", 500, "INTERNAL_ERROR");
  }
}
export async function listPayments(request: Request, userId: string) {
  try {
    await connectMongoDB();
    const url = new URL(request.url);
    const page = Math.max(1, Math.trunc(Number(url.searchParams.get("page") || 1) || 1));
    const limit = Math.min(100, Math.max(1, Math.trunc(Number(url.searchParams.get("limit") || 25) || 25)));
    const query = text(url.searchParams.get("q")).slice(0, 100);
    const method = text(url.searchParams.get("method")).toUpperCase();
    const from = text(url.searchParams.get("from"));
    const to = text(url.searchParams.get("to"));
    const filter: Record<string, unknown> = { ownerId: userId };
    if (["CASH", "TRANSFER", "CARD", "OTHER"].includes(method)) filter.method = method;

    const createdAt: Record<string, Date> = {};
    if (from && !Number.isNaN(Date.parse(from))) createdAt.$gte = new Date(from + "T00:00:00.000Z");
    if (to && !Number.isNaN(Date.parse(to))) createdAt.$lte = new Date(to + "T23:59:59.999Z");
    if (Object.keys(createdAt).length) filter.createdAt = createdAt;

    if (query) {
      const special = new Set([String.fromCharCode(92), "^", "$", ".", "*", "+", "?", "(", ")", "[", "]", "{", "}", "|"]);
      const escaped = query.split("").map((character) => special.has(character) ? String.fromCharCode(92) + character : character).join("");
      const pattern = new RegExp(escaped, "i");
      const matchingSaleIds = await SaleModel.find({
        ownerId: userId,
        isActive: true,
        $or: [
          { saleNumber: pattern },
          { "customerSnapshot.firstName": pattern },
          { "customerSnapshot.lastName": pattern },
          { "customerSnapshot.documentId": pattern },
          { "items.productTitle": pattern },
          { "items.variantLabel": pattern },
        ],
      }).distinct("_id").exec();
      filter.$or = matchingSaleIds.length
        ? [{ note: pattern }, { saleId: { $in: matchingSaleIds } }]
        : [{ note: pattern }];
    }

    const [payments, total, summaryRows] = await Promise.all([
      SalePaymentModel.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean() as unknown as Promise<PaymentRecord[]>,
      SalePaymentModel.countDocuments(filter),
      SalePaymentModel.aggregate([
        { $match: filter },
        { $group: {
          _id: null,
          count: { $sum: 1 },
          total: { $sum: "$amount" },
          cashTotal: { $sum: { $cond: [{ $eq: ["$method", "CASH"] }, "$amount", 0] } },
          transferTotal: { $sum: { $cond: [{ $eq: ["$method", "TRANSFER"] }, "$amount", 0] } },
        } },
      ]).exec() as Promise<{ count?: number; total?: number; cashTotal?: number; transferTotal?: number }[]>,
    ]);

    const saleIds = [...new Set(payments.map((payment) => String(payment.saleId)))];
    const sales = saleIds.length
      ? await SaleModel.find({ ownerId: userId, _id: { $in: saleIds } })
          .select("saleNumber customerSnapshot")
          .lean() as unknown as SaleForPayment[]
      : [];
    const salesById = new Map<string, SaleForPayment>();
    for (const sale of sales) salesById.set(String(sale._id), sale);
    const result = payments.map((payment) => {
      const sale = salesById.get(String(payment.saleId));
      return {
        _id: String(payment._id),
        saleId: String(payment.saleId),
        saleNumber: sale?.saleNumber ?? "Venta archivada",
        customerName: customerName(sale?.customerSnapshot),
        amount: payment.amount,
        method: payment.method,
        methodLabel: methodLabel(payment.method),
        note: payment.note ?? "",
        createdAt: payment.createdAt,
      };
    });
    const summary = summaryRows[0] ?? {};
    return NextResponse.json({
      ok: true,
      payments: result,
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
      summary: {
        count: summary.count ?? 0,
        total: fromCents(toCents(summary.total ?? 0)),
        cashTotal: fromCents(toCents(summary.cashTotal ?? 0)),
        transferTotal: fromCents(toCents(summary.transferTotal ?? 0)),
      },
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    console.error("[PAYMENTS_LIST]", error);
    return errorResponse("No pudimos cargar el historial de pagos.", 500, "INTERNAL_ERROR");
  }
}

export async function registerPayment(request: Request, userId: string) {
  let session: mongoose.ClientSession | null = null;
  try {
    const body = await request.json() as Record<string, unknown>;
    const saleId = text(body.saleId);
    const rawAmount = typeof body.amount === "number" ? body.amount : Number(body.amount);
    const amountCents = Number.isFinite(rawAmount) ? toCents(rawAmount) : 0;
    const methodValue = text(body.method || "CASH");
    const allowedMethods: PaymentMethod[] = ["CASH", "TRANSFER", "CARD", "OTHER"];
    const note = text(body.note).slice(0, 500);

    if (!mongoose.isValidObjectId(saleId)) {
      return errorResponse("La venta seleccionada no es válida.", 400, "INVALID_SALE_ID");
    }
    if (!Number.isFinite(rawAmount) || amountCents <= 0) {
      return errorResponse("El importe del abono debe ser mayor que cero.", 400, "INVALID_PAYMENT_AMOUNT");
    }
    if (!allowedMethods.includes(methodValue as PaymentMethod)) {
      return errorResponse("El método de pago no es válido.", 400, "INVALID_PAYMENT_METHOD");
    }

    await connectMongoDB();
    const transactionSession = await mongoose.startSession();
    session = transactionSession;
    let responsePayment: Record<string, unknown> | null = null;
    let responseSale: Record<string, unknown> | null = null;

    await transactionSession.withTransaction(async () => {
      const sale = await SaleModel.findOne({
        _id: saleId,
        ownerId: userId,
        isActive: true,
      }).session(transactionSession).exec();

      if (!sale) fail("No encontramos esa venta en tu cuenta.", 404, "SALE_NOT_FOUND");
      const balanceCents = toCents(sale.balanceDue);
      if (balanceCents <= 0) fail("Esta venta ya está completamente pagada.", 409, "SALE_ALREADY_PAID");
      if (amountCents > balanceCents) {
        fail("El abono no puede ser mayor que el saldo pendiente.", 400, "PAYMENT_EXCEEDS_BALANCE");
      }

      sale.amountPaid = fromCents(toCents(sale.amountPaid) + amountCents);
      sale.balanceDue = fromCents(balanceCents - amountCents);
      sale.paymentStatus = sale.balanceDue <= 0 ? "PAID" : "PARTIAL";
      await sale.save({ session: transactionSession });

      const created = await SalePaymentModel.create([{
        saleId: sale._id,
        ownerId: userId,
        amount: fromCents(amountCents),
        method: methodValue as PaymentMethod,
        note,
        receivedBy: userId,
      }], { session: transactionSession });
      const payment = created[0];

      responsePayment = {
        _id: String(payment._id),
        saleId: String(sale._id),
        saleNumber: sale.saleNumber,
        amount: payment.amount,
        method: payment.method,
        methodLabel: methodLabel(payment.method as PaymentMethod),
        note: payment.note ?? "",
        createdAt: payment.createdAt,
      };
      responseSale = {
        _id: String(sale._id),
        saleNumber: sale.saleNumber,
        total: sale.total,
        amountPaid: sale.amountPaid,
        balanceDue: sale.balanceDue,
        paymentStatus: sale.paymentStatus,
      };
    });

    if (!responsePayment || !responseSale) {
      return errorResponse("No pudimos registrar el abono.", 500, "PAYMENT_NOT_CREATED");
    }

    return NextResponse.json({
      ok: true,
      payment: responsePayment,
      sale: responseSale,
      message: "Abono registrado correctamente.",
    }, { status: 201 });
  } catch (error) {
    if (error instanceof PaymentRequestError) {
      return errorResponse(error.message, error.status, error.code);
    }
    if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
      return errorResponse("Este pago ya fue registrado.", 409, "PAYMENT_DUPLICATE");
    }
    console.error("[PAYMENT_CREATE]", error);
    return errorResponse("No pudimos registrar el abono. Inténtalo de nuevo.", 500, "INTERNAL_ERROR");
  } finally {
    if (session) await session.endSession();
  }
}
