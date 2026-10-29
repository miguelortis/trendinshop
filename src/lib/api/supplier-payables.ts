import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectMongoDB } from "@/lib/db/mongodb";
import { SaleModel } from "@/models/Sale";
import { ResellerSupplierPaymentModel } from "@/models/ResellerSupplierPayment";
import { UserModel } from "@/models/User";

type PaymentMethod = "CASH" | "TRANSFER" | "CARD" | "OTHER";
type Snapshot = { firstName?: string; lastName?: string; phone?: string; documentId?: string };
type SupplierSaleItem = {
  productId: mongoose.Types.ObjectId | string;
  variantId: mongoose.Types.ObjectId | string;
  productTitle: string;
  productSku: string;
  variantLabel: string;
  variantSku: string;
  quantity: number;
  unitPrice: number;
  unitCost: number;
  lineTotal: number;
  lineCostTotal: number;
  lineProfit: number;
  supplierAmountPaid?: number;
  supplierBalanceDue?: number;
};
type SaleRecord = {
  _id: mongoose.Types.ObjectId;
  ownerId: mongoose.Types.ObjectId;
  saleNumber: string;
  customerSnapshot?: Snapshot;
  items: SupplierSaleItem[];
  total: number;
  totalCost: number;
  grossProfit: number;
  supplierAmountDue?: number;
  supplierAmountPaid?: number;
  supplierBalanceDue?: number;
  supplierPaymentStatus?: "UNPAID" | "PARTIAL" | "PAID";
  amountPaid: number;
  balanceDue: number;
  paymentStatus: "UNPAID" | "PARTIAL" | "PAID";
  createdAt: Date;
  note?: string;
};
type UserRecord = {
  _id: mongoose.Types.ObjectId;
  firstName: string;
  lastName: string;
  phone?: string;
  email?: string;
};
type SupplierPaymentRecord = {
  _id: mongoose.Types.ObjectId;
  saleId: mongoose.Types.ObjectId;
  resellerId: mongoose.Types.ObjectId;
  amount: number;
  method: PaymentMethod;
  note?: string;
  receivedBy?: mongoose.Types.ObjectId | null;
  status?: "PENDING" | "CONFIRMED" | "REJECTED";
  reference?: string;
  submittedAt?: Date;
  confirmedAt?: Date | null;
  reviewedAt?: Date | null;
  reviewNote?: string;
  allocations?: {
    productId: mongoose.Types.ObjectId;
    variantId: mongoose.Types.ObjectId;
    productTitle: string;
    variantLabel: string;
    amount: number;
  }[];
  createdAt: Date;
};

class SupplierPaymentError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = "BAD_REQUEST") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function fail(message: string, status = 400, code = "BAD_REQUEST"): never {
  throw new SupplierPaymentError(message, status, code);
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

function nameOf(snapshot?: Snapshot) {
  return [snapshot?.firstName, snapshot?.lastName].filter(Boolean).join(" ") || "Cliente ocasional";
}

function userName(user?: UserRecord) {
  return [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "Revendedor";
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

function normalizedItems(sale: SaleRecord, isResellerSale: boolean) {
  return (sale.items ?? []).map((item) => {
    const quantity = Math.max(0, Math.trunc(item.quantity));
    const unitCostCents = Math.max(0, toCents(item.unitCost));
    const costCents = unitCostCents * quantity;
    const paidCents = Math.min(costCents, Math.max(0, toCents(item.supplierAmountPaid ?? 0)));
    const paid = fromCents(paidCents);
    // La deuda usa el costo unitario capturado en la venta por su cantidad, nunca un saldo guardado.
    const due = isResellerSale ? fromCents(Math.max(0, costCents - paidCents)) : 0;
    const wholesaleCost = fromCents(costCents);
    return {
      productId: String(item.productId),
      variantId: String(item.variantId),
      productTitle: item.productTitle,
      productSku: item.productSku,
      variantLabel: item.variantLabel,
      variantSku: item.variantSku,
      quantity,
      unitPrice: item.unitPrice,
      wholesaleUnitCost: fromCents(unitCostCents),
      lineTotal: item.lineTotal,
      wholesaleCost,
      resellerProfit: fromCents(toCents(item.lineTotal) - costCents),
      supplierAmountPaid: fromCents(paid),
      supplierBalanceDue: fromCents(due),
    };
  });
}

function serializeSale(sale: SaleRecord, reseller?: UserRecord) {
  const items = normalizedItems(sale, true);
  const supplierAmountDue = fromCents(items.reduce((sum, item) => sum + toCents(item.wholesaleCost), 0));
  const supplierAmountPaid = fromCents(items.reduce((sum, item) => sum + toCents(item.supplierAmountPaid), 0));
  const supplierBalanceDue = fromCents(items.reduce((sum, item) => sum + toCents(item.supplierBalanceDue), 0));
  return {
    _id: String(sale._id),
    ownerId: String(sale.ownerId),
    resellerName: userName(reseller),
    resellerPhone: reseller?.phone ?? "",
    resellerEmail: reseller?.email ?? "",
    saleNumber: sale.saleNumber,
    customerName: nameOf(sale.customerSnapshot),
    customerSnapshot: sale.customerSnapshot ?? {},
    total: sale.total,
    amountCollectedFromCustomer: sale.amountPaid,
    customerBalanceDue: sale.balanceDue,
    supplierAmountDue,
    supplierAmountPaid,
    supplierBalanceDue,
    supplierPaymentStatus: supplierBalanceDue <= 0 ? "PAID" : supplierAmountPaid > 0 ? "PARTIAL" : "UNPAID",
    grossProfit: sale.grossProfit,
    createdAt: sale.createdAt,
    note: sale.note ?? "",
    items,
  };
}

export async function listSupplierPayables(userId: string, userRole: string) {
  if (userRole !== "ADMIN" && userRole !== "RESELLER") {
    return errorResponse("No tienes permiso para consultar estas cuentas.", 403, "FORBIDDEN");
  }

  try {
    await connectMongoDB();
    let resellerUsers: UserRecord[] = [];
    let sales: SaleRecord[] = [];

    if (userRole === "ADMIN") {
      resellerUsers = await UserModel.find({ role: "RESELLER" })
        .select("_id firstName lastName phone email")
        .lean() as unknown as UserRecord[];
      const resellerIds = resellerUsers.map((reseller) => reseller._id);
      sales = resellerIds.length
        ? await SaleModel.find({ ownerId: { $in: resellerIds }, isActive: true })
            .sort({ createdAt: -1 })
            .lean() as unknown as SaleRecord[]
        : [];
    } else {
      sales = await SaleModel.find({ ownerId: userId, isActive: true })
        .sort({ createdAt: -1 })
        .lean() as unknown as SaleRecord[];
      const self = await UserModel.findById(userId)
        .select("_id firstName lastName phone email")
        .lean() as unknown as UserRecord | null;
      resellerUsers = self ? [self] : [];
    }

    const resellerById = new Map<string, UserRecord>();
    for (const reseller of resellerUsers) {
      resellerById.set(String(reseller._id), reseller);
    }
    const rows = sales.map((sale) => serializeSale(
      sale,
      resellerById.get(String(sale.ownerId)),
    ));
    // Todos los totales monetarios se agregan en centavos enteros a partir de las líneas recalculadas.
    const totalDueCents = rows.reduce((sum, sale) => sum + toCents(sale.supplierAmountDue), 0);
    const totalPaidCents = rows.reduce((sum, sale) => sum + toCents(sale.supplierAmountPaid), 0);
    const balanceDueCents = Math.max(0, totalDueCents - totalPaidCents);
    const owingResellers = new Set(rows.filter((sale) => sale.supplierBalanceDue > 0).map((sale) => sale.ownerId));
    const resellerSummaries = resellerUsers.map((reseller) => {
      const resellerSales = rows.filter((sale) => sale.ownerId === String(reseller._id));
      const resellerTotalDueCents = resellerSales.reduce((sum, sale) => sum + toCents(sale.supplierAmountDue), 0);
      const resellerTotalPaidCents = resellerSales.reduce((sum, sale) => sum + toCents(sale.supplierAmountPaid), 0);
      const resellerBalanceDueCents = Math.max(0, resellerTotalDueCents - resellerTotalPaidCents);
      const customerBalanceDueCents = resellerSales.reduce((sum, sale) => sum + toCents(sale.customerBalanceDue), 0);
      return {
        id: String(reseller._id),
        name: userName(reseller),
        phone: reseller.phone ?? "",
        email: reseller.email ?? "",
        salesCount: resellerSales.length,
        totalDue: fromCents(resellerTotalDueCents),
        totalPaid: fromCents(resellerTotalPaidCents),
        balanceDue: fromCents(resellerBalanceDueCents),
        customerBalanceDue: fromCents(customerBalanceDueCents),
      };
    }).sort((a, b) => b.balanceDue - a.balanceDue || a.name.localeCompare(b.name));

    return NextResponse.json({
      ok: true,
      role: userRole,
      calculationVersion: "supplier-debt-unit-cost-quantity-v2",
      resellers: resellerSummaries,
      summary: {
        salesCount: rows.length,
        totalDue: fromCents(totalDueCents),
        totalPaid: fromCents(totalPaidCents),
        balanceDue: fromCents(balanceDueCents),
        resellersOwing: owingResellers.size,
      },
      sales: rows,
    }, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    console.error("[SUPPLIER_PAYABLES_LIST]", error);
    return errorResponse("No pudimos cargar las deudas de productos.", 500, "INTERNAL_ERROR");
  }
}

export async function listSupplierPayments(userId: string, userRole: string) {
  if (userRole !== "ADMIN" && userRole !== "RESELLER") {
    return errorResponse("No tienes permiso para consultar estos pagos.", 403, "FORBIDDEN");
  }

  try {
    await connectMongoDB();
    const filter = userRole === "ADMIN" ? {} : { resellerId: userId };
    const payments = await ResellerSupplierPaymentModel.find(filter)
      .sort({ createdAt: -1 })
      .lean() as unknown as SupplierPaymentRecord[];

    const saleIds = [...new Set(payments.map((payment) => String(payment.saleId)))];
    const resellerIds = [...new Set(payments.map((payment) => String(payment.resellerId)))];
    const [sales, resellers, receivers] = await Promise.all([
      saleIds.length
        ? SaleModel.find({ _id: { $in: saleIds } }).select("saleNumber").lean() as unknown as Promise<{_id: mongoose.Types.ObjectId; saleNumber: string}[]>
        : Promise.resolve([]),
      resellerIds.length
        ? UserModel.find({ _id: { $in: resellerIds } }).select("_id firstName lastName").lean() as unknown as Promise<UserRecord[]>
        : Promise.resolve([]),
      userRole === "ADMIN"
        ? UserModel.find({ _id: { $in: [...new Set(payments.map((payment) => payment.receivedBy ? String(payment.receivedBy) : "").filter(Boolean))] } })
            .select("_id firstName lastName").lean() as unknown as Promise<UserRecord[]>
        : Promise.resolve([]),
    ]);
    const salesById = new Map<string, { _id: mongoose.Types.ObjectId; saleNumber: string }>();
    for (const sale of sales) salesById.set(String(sale._id), sale);
    const resellersById = new Map<string, UserRecord>();
    for (const reseller of resellers) resellersById.set(String(reseller._id), reseller);
    const receiversById = new Map<string, UserRecord>();
    for (const receiver of receivers) receiversById.set(String(receiver._id), receiver);

    return NextResponse.json({
      ok: true,
      payments: payments.map((payment) => ({
        _id: String(payment._id),
        saleId: String(payment.saleId),
        saleNumber: salesById.get(String(payment.saleId))?.saleNumber ?? "Venta archivada",
        resellerId: String(payment.resellerId),
        resellerName: userName(resellersById.get(String(payment.resellerId))),
        amount: payment.amount,
        method: payment.method,
        methodLabel: methodLabel(payment.method),
        note: payment.note ?? "",
        receivedBy: userRole === "ADMIN" && payment.receivedBy ? userName(receiversById.get(String(payment.receivedBy))) : undefined,
        status: payment.status ?? "CONFIRMED",
        reference: payment.reference ?? "",
        submittedAt: payment.submittedAt ?? payment.createdAt,
        confirmedAt: payment.confirmedAt ?? null,
        reviewedAt: payment.reviewedAt ?? null,
        reviewNote: payment.reviewNote ?? "",
        allocations: (payment.allocations ?? []).map((allocation) => ({
          productTitle: allocation.productTitle,
          variantLabel: allocation.variantLabel,
          amount: allocation.amount,
        })),
        createdAt: payment.createdAt,
      })),
    }, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    console.error("[SUPPLIER_PAYMENTS_LIST]", error);
    return errorResponse("No pudimos cargar el historial de abonos de revendedores.", 500, "INTERNAL_ERROR");
  }
}

export async function registerSupplierPayment(request: Request, userId: string, userRole: string) {
  if (userRole !== "ADMIN" && userRole !== "RESELLER") {
    return errorResponse("No tienes permiso para registrar abonos de proveedor.", 403, "FORBIDDEN");
  }

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
      return errorResponse("El abono debe ser mayor que cero.", 400, "INVALID_PAYMENT_AMOUNT");
    }
    if (!allowedMethods.includes(methodValue as PaymentMethod)) {
      return errorResponse("El método de pago no es válido.", 400, "INVALID_PAYMENT_METHOD");
    }

    if (userRole === "RESELLER") {
      await connectMongoDB();
      const transactionSession = await mongoose.startSession();
      session = transactionSession;
      let submitted: Record<string, unknown> | null = null;
      await transactionSession.withTransaction(async () => {
        const sale = await SaleModel.findOne({ _id: saleId, ownerId: userId, isActive: true })
          .session(transactionSession).lean() as unknown as SaleRecord | null;
        if (!sale) fail("No encontramos esa venta en tu cuenta.", 404, "SALE_NOT_FOUND");
        const items = normalizedItems(sale, true);
        const balanceCents = items.reduce((sum, item) => sum + toCents(item.supplierBalanceDue), 0);
        const pendingRows = await ResellerSupplierPaymentModel.aggregate([
          { $match: { saleId: sale._id, status: "PENDING" } },
          { $group: { _id: null, amount: { $sum: "$amount" } } },
        ]).session(transactionSession).exec() as { amount?: number }[];
        const reservedCents = toCents(pendingRows[0]?.amount ?? 0);
        const availableCents = Math.max(0, balanceCents - reservedCents);
        if (availableCents <= 0) fail("No queda saldo disponible para reportar otro abono. Revisa los abonos pendientes de confirmación.", 409, "NO_REMAINING_BALANCE");
        if (amountCents > availableCents) fail("El importe supera la deuda libre después de descontar tus abonos pendientes.", 400, "PAYMENT_EXCEEDS_BALANCE");
        const created = await ResellerSupplierPaymentModel.create([{
          saleId: sale._id,
          resellerId: userId,
          amount: fromCents(amountCents),
          method: methodValue as PaymentMethod,
          note,
          reference,
          status: "PENDING",
          submittedAt: new Date(),
          receivedBy: null,
          allocations: [],
        }], { session: transactionSession });
        const payment = created[0];
        submitted = {
          _id: String(payment._id),
          saleId: String(sale._id),
          saleNumber: sale.saleNumber,
          resellerId: userId,
          amount: payment.amount,
          method: payment.method,
          methodLabel: methodLabel(payment.method as PaymentMethod),
          status: "PENDING",
          note: payment.note ?? "",
          reference: payment.reference ?? "",
          allocations: [],
          createdAt: payment.createdAt,
        };
      });
      if (!submitted) return errorResponse("No pudimos registrar el abono pendiente.", 500, "PAYMENT_NOT_CREATED");
      return NextResponse.json({
        ok: true,
        payment: submitted,
        message: "Abono reportado. El administrador debe confirmar la recepción para actualizar la deuda.",
      }, { status: 201 });
    }

    await connectMongoDB();
    const transactionSession = await mongoose.startSession();
    session = transactionSession;
    let responsePayment: Record<string, unknown> | null = null;
    let responseSale: Record<string, unknown> | null = null;

    await transactionSession.withTransaction(async () => {
      const sale = await SaleModel.findOne({ _id: saleId, isActive: true })
        .session(transactionSession)
        .lean() as unknown as SaleRecord | null;

      if (!sale) fail("No encontramos esa venta.", 404, "SALE_NOT_FOUND");

      const reseller = await UserModel.findOne({ _id: sale.ownerId, role: "RESELLER" })
        .select("_id")
        .session(transactionSession)
        .lean();
      if (!reseller) fail("Esta venta no pertenece a un revendedor activo.", 409, "NOT_RESELLER_SALE");

      const lineBalances = sale.items.map((item) => {
        const quantity = Math.max(0, Math.trunc(item.quantity));
        const costCents = Math.max(0, toCents(item.unitCost)) * quantity;
        const paidCents = Math.min(costCents, Math.max(0, toCents(item.supplierAmountPaid ?? 0)));
        const paid = fromCents(paidCents);
        const balance = fromCents(Math.max(0, costCents - paidCents));
        return {
          item,
          paid,
          balance,
          remaining: balance,
          costCents,
          quantity,
          costTotal: fromCents(costCents),
        };
      });
      const balanceCents = lineBalances.reduce((sum, line) => sum + toCents(line.balance), 0);
      if (balanceCents <= 0) fail("Esta venta ya fue pagada al proveedor.", 409, "SUPPLIER_SALE_ALREADY_PAID");
      if (amountCents > balanceCents) {
        fail("El abono no puede superar la deuda pendiente de esta venta.", 400, "PAYMENT_EXCEEDS_BALANCE");
      }

      let remaining = amountCents;
      const allocations: { productId: mongoose.Types.ObjectId; variantId: mongoose.Types.ObjectId; productTitle: string; variantLabel: string; amount: number }[] = [];
      const updatedItems = lineBalances.map(({ item, paid, remaining: lineRemaining, costTotal, quantity }) => {
        const applied = Math.min(toCents(lineRemaining), remaining);
        remaining -= applied;
        const nextPaid = toCents(paid) + applied;
        const nextBalance = toCents(lineRemaining) - applied;

        if (applied > 0) {
          allocations.push({
            productId: new mongoose.Types.ObjectId(String(item.productId)),
            variantId: new mongoose.Types.ObjectId(String(item.variantId)),
            productTitle: item.productTitle,
            variantLabel: item.variantLabel,
            amount: fromCents(applied),
          });
        }

        return {
          ...item,
          quantity,
          lineCostTotal: costTotal,
          lineProfit: fromCents(toCents(item.lineTotal) - toCents(costTotal)),
          supplierAmountPaid: fromCents(nextPaid),
          supplierBalanceDue: fromCents(nextBalance),
        };
      });

      const totalDueCents = lineBalances.reduce((sum, line) => sum + line.costCents, 0);
      const totalPaidCents = updatedItems.reduce((sum, item) => sum + toCents(item.supplierAmountPaid ?? 0), 0);
      const totalBalanceCents = updatedItems.reduce((sum, item) => sum + toCents(item.supplierBalanceDue ?? 0), 0);

      await SaleModel.updateOne(
        { _id: sale._id, isActive: true },
        {
          $set: {
            ownerRole: "RESELLER",
            items: updatedItems,
            supplierAmountDue: fromCents(totalDueCents),
            supplierAmountPaid: fromCents(totalPaidCents),
            supplierBalanceDue: fromCents(totalBalanceCents),
            supplierPaymentStatus: totalBalanceCents <= 0 ? "PAID" : totalPaidCents > 0 ? "PARTIAL" : "UNPAID",
          },
        },
        { session: transactionSession },
      ).exec();

      const created = await ResellerSupplierPaymentModel.create([{
        saleId: sale._id,
        resellerId: sale.ownerId,
        amount: fromCents(amountCents),
        method: methodValue as PaymentMethod,
        note,
        receivedBy: adminId,
        status: "CONFIRMED",
        reference,
        submittedAt: new Date(),
        confirmedAt: new Date(),
        reviewedAt: new Date(),
        allocations,
      }], { session: transactionSession });
      const payment = created[0];

      responsePayment = {
        _id: String(payment._id),
        saleId: String(sale._id),
        saleNumber: sale.saleNumber,
        resellerId: String(sale.ownerId),
        amount: payment.amount,
        method: payment.method,
        methodLabel: methodLabel(payment.method as PaymentMethod),
        note: payment.note ?? "",
        reference: payment.reference ?? "",
        status: payment.status ?? "CONFIRMED",
        allocations: allocations.map((allocation) => ({
          productTitle: allocation.productTitle,
          variantLabel: allocation.variantLabel,
          amount: allocation.amount,
        })),
        createdAt: payment.createdAt,
      };
      responseSale = {
        _id: String(sale._id),
        saleNumber: sale.saleNumber,
        supplierAmountDue: fromCents(totalDueCents),
        supplierAmountPaid: fromCents(totalPaidCents),
        supplierBalanceDue: fromCents(totalBalanceCents),
        supplierPaymentStatus: totalBalanceCents <= 0 ? "PAID" : totalPaidCents > 0 ? "PARTIAL" : "UNPAID",
        items: updatedItems,
      };
    });

    if (!responsePayment || !responseSale) {
      return errorResponse("No pudimos registrar el abono del revendedor.", 500, "PAYMENT_NOT_CREATED");
    }

    return NextResponse.json({
      ok: true,
      payment: responsePayment,
      sale: responseSale,
      message: "Abono del revendedor registrado correctamente.",
    }, { status: 201 });
  } catch (error) {
    if (error instanceof SupplierPaymentError) {
      return errorResponse(error.message, error.status, error.code);
    }
    console.error("[SUPPLIER_PAYMENT_CREATE]", error);
    return errorResponse("No pudimos registrar el abono del revendedor. Inténtalo de nuevo.", 500, "INTERNAL_ERROR");
  } finally {
    if (session) await session.endSession();
  }
}


export async function reviewSupplierPayment(request: Request, paymentId: string, adminId: string, userRole: string) {
  if (userRole !== "ADMIN") return errorResponse("Solo el administrador puede revisar los abonos reportados.", 403, "FORBIDDEN");
  if (!mongoose.isValidObjectId(paymentId)) return errorResponse("El abono seleccionado no es válido.", 400, "INVALID_PAYMENT_ID");

  let session: mongoose.ClientSession | null = null;
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = text(body.action).toUpperCase();
    const reviewNote = text(body.note).slice(0, 500);
    if (action !== "CONFIRM" && action !== "REJECT") return errorResponse("La acción debe ser CONFIRM o REJECT.");

    await connectMongoDB();
    const transactionSession = await mongoose.startSession();
    session = transactionSession;
    let result: Record<string, unknown> | null = null;

    await transactionSession.withTransaction(async () => {
      const payment = await ResellerSupplierPaymentModel.findOne({ _id: paymentId, status: "PENDING" })
        .session(transactionSession).exec();
      if (!payment) fail("El abono ya fue revisado o no existe.", 409, "PAYMENT_NOT_PENDING");

      if (action === "REJECT") {
        payment.status = "REJECTED";
        payment.reviewedAt = new Date();
        payment.reviewNote = reviewNote || "Abono rechazado por el administrador.";
        payment.receivedBy = null;
        await payment.save({ session: transactionSession });
        result = { _id: String(payment._id), status: payment.status, reviewedAt: payment.reviewedAt, reviewNote: payment.reviewNote };
        return;
      }

      const sale = await SaleModel.findOne({
        _id: payment.saleId,
        ownerId: payment.resellerId,
        isActive: true,
      }).session(transactionSession).lean() as unknown as SaleRecord | null;
      if (!sale) fail("No encontramos la venta asociada al abono.", 404, "SALE_NOT_FOUND");

      const lineBalances = sale.items.map((item) => {
        const quantity = Math.max(0, Math.trunc(item.quantity));
        const costCents = Math.max(0, toCents(item.unitCost)) * quantity;
        const paidCents = Math.min(costCents, Math.max(0, toCents(item.supplierAmountPaid ?? 0)));
        const balanceCents = Math.max(0, costCents - paidCents);
        return { item, quantity, costCents, paidCents, balanceCents, costTotal: fromCents(costCents) };
      });
      const amountCents = toCents(payment.amount);
      const outstandingCents = lineBalances.reduce((sum, line) => sum + line.balanceCents, 0);
      if (amountCents > outstandingCents) fail("La deuda cambió desde que se reportó el abono. Revisa el saldo y registra el pago manualmente si corresponde.", 409, "BALANCE_CHANGED");
      if (outstandingCents <= 0) fail("Esta venta ya está pagada al proveedor.", 409, "SUPPLIER_SALE_ALREADY_PAID");

      let remaining = amountCents;
      const allocations: { productId: mongoose.Types.ObjectId; variantId: mongoose.Types.ObjectId; productTitle: string; variantLabel: string; amount: number }[] = [];
      const updatedItems = lineBalances.map(({ item, quantity, costCents, paidCents, balanceCents, costTotal }) => {
        const applied = Math.min(balanceCents, remaining);
        remaining -= applied;
        if (applied > 0) allocations.push({
          productId: new mongoose.Types.ObjectId(String(item.productId)),
          variantId: new mongoose.Types.ObjectId(String(item.variantId)),
          productTitle: item.productTitle,
          variantLabel: item.variantLabel,
          amount: fromCents(applied),
        });
        const supplierAmountPaid = fromCents(paidCents + applied);
        const supplierBalanceDue = fromCents(Math.max(0, costCents - paidCents - applied));
        return {
          ...item,
          quantity,
          lineCostTotal: costTotal,
          lineProfit: fromCents(toCents(item.lineTotal) - costCents),
          supplierAmountPaid,
          supplierBalanceDue,
        };
      });

      const totalDueCents = lineBalances.reduce((sum, line) => sum + line.costCents, 0);
      const totalPaidCents = updatedItems.reduce((sum, item) => sum + toCents(item.supplierAmountPaid ?? 0), 0);
      const totalBalanceCents = Math.max(0, totalDueCents - totalPaidCents);
      await SaleModel.updateOne({ _id: sale._id, isActive: true }, { $set: {
        ownerRole: "RESELLER",
        items: updatedItems,
        supplierAmountDue: fromCents(totalDueCents),
        supplierAmountPaid: fromCents(totalPaidCents),
        supplierBalanceDue: fromCents(totalBalanceCents),
        supplierPaymentStatus: totalBalanceCents <= 0 ? "PAID" : totalPaidCents > 0 ? "PARTIAL" : "UNPAID",
      } }, { session: transactionSession }).exec();

      payment.status = "CONFIRMED";
      payment.receivedBy = new mongoose.Types.ObjectId(adminId);
      payment.allocations = allocations;
      payment.confirmedAt = new Date();
      payment.reviewedAt = new Date();
      payment.reviewNote = reviewNote;
      await payment.save({ session: transactionSession });

      result = {
        _id: String(payment._id),
        saleId: String(sale._id),
        saleNumber: sale.saleNumber,
        resellerId: String(sale.ownerId),
        amount: payment.amount,
        method: payment.method,
        status: payment.status,
        reference: payment.reference ?? "",
        allocations: allocations.map((allocation) => ({ productTitle: allocation.productTitle, variantLabel: allocation.variantLabel, amount: allocation.amount })),
        supplierAmountDue: fromCents(totalDueCents),
        supplierAmountPaid: fromCents(totalPaidCents),
        supplierBalanceDue: fromCents(totalBalanceCents),
        reviewedAt: payment.reviewedAt,
        reviewNote: payment.reviewNote,
      };
    });

    if (!result) return errorResponse("No pudimos revisar el abono.", 500, "PAYMENT_REVIEW_FAILED");
    return NextResponse.json({
      ok: true,
      payment: result,
      message: action === "CONFIRM" ? "Abono confirmado y deuda actualizada." : "Abono rechazado. La deuda no fue modificada.",
    });
  } catch (error) {
    if (error instanceof SupplierPaymentError) return errorResponse(error.message, error.status, error.code);
    console.error("[SUPPLIER_PAYMENT_REVIEW]", error);
    return errorResponse("No pudimos revisar el abono.", 500, "INTERNAL_ERROR");
  } finally {
    if (session) await session.endSession();
  }
}
