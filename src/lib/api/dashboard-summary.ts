import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectMongoDB } from "@/lib/db/mongodb";
import { SaleModel } from "@/models/Sale";
import { ProductVariantModel } from "@/models/ProductVariant";
import { UserModel } from "@/models/User";
import { ResellerCatalogItemModel } from "@/models/ResellerCatalogItem";
import { PublicOrderModel } from "@/models/PublicOrder";

type Role = "ADMIN" | "RESELLER";
type CustomerSnapshot = { firstName?: string; lastName?: string };
type DashboardSaleRecord = {
  _id: mongoose.Types.ObjectId;
  saleNumber: string;
  customerSnapshot?: CustomerSnapshot;
  total: number;
  amountPaid: number;
  balanceDue: number;
  paymentStatus: "UNPAID" | "PARTIAL" | "PAID";
  grossProfit: number;
  createdAt: Date;
  items: { productTitle: string; variantLabel: string; quantity: number }[];
};
type SummaryRow = {
  _id?: null;
  count?: number;
  total?: number;
  profit?: number;
  balanceDue?: number;
  totalDue?: number;
  totalPaid?: number;
  outOfStockVariants?: number;
  lowStockVariants?: number;
  totalUnits?: number;
  variants?: number;
};

type SupplierDebtItemRecord = {
  unitCost?: number;
  quantity?: number;
  supplierAmountPaid?: number;
};
type SupplierDebtSaleRecord = {
  items?: SupplierDebtItemRecord[];
};

function toCents(value: number) {
  return Math.round((value + Number.EPSILON) * 100);
}

function fromCents(value: number) {
  return Number((value / 100).toFixed(2));
}

function errorResponse(message: string, status = 400, code = "BAD_REQUEST") {
  return NextResponse.json(
    { ok: false, error: code, message },
    { status, headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}

function customerName(customer?: CustomerSnapshot) {
  return [customer?.firstName, customer?.lastName].filter(Boolean).join(" ") || "Cliente ocasional";
}

export async function getDashboardSummary(userId: string, userRole: string) {
  if (userRole !== "ADMIN" && userRole !== "RESELLER") {
    return errorResponse("No tienes permiso para consultar el resumen.", 403, "FORBIDDEN");
  }
  if (!mongoose.isValidObjectId(userId)) {
    return errorResponse("La sesión no contiene un usuario válido.", 401, "INVALID_USER_ID");
  }

  try {
    await connectMongoDB();
    const ownerObjectId = new mongoose.Types.ObjectId(userId);
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const ownerSalesFilter = { ownerId: ownerObjectId, isActive: true };
    const openReceivablesFilter = { ...ownerSalesFilter, balanceDue: { $gt: 0 } };

    const [
      monthlyRows,
      recentSales,
      receivableRows,
      pendingOrders,
      supplierUserIds,
      inventoryRows,
      activeResellers,
      catalogProductCount,
    ] = await Promise.all([
      SaleModel.aggregate([
        { $match: { ...ownerSalesFilter, createdAt: { $gte: monthStart } } },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            total: { $sum: "$total" },
            profit: { $sum: "$grossProfit" },
          },
        },
      ]).exec() as Promise<SummaryRow[]>,
      SaleModel.find(ownerSalesFilter)
        .select("saleNumber customerSnapshot total amountPaid balanceDue paymentStatus grossProfit createdAt items.productTitle items.variantLabel items.quantity")
        .sort({ createdAt: -1 })
        .limit(5)
        .lean() as unknown as Promise<DashboardSaleRecord[]>,
      SaleModel.aggregate([
        { $match: openReceivablesFilter },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            balanceDue: { $sum: "$balanceDue" },
          },
        },
      ]).exec() as Promise<SummaryRow[]>,
      PublicOrderModel.countDocuments({
        isActive: true,
        status: { $in: ["PENDING", "IN_PROGRESS"] },
        ...(userRole === "ADMIN" ? {} : { resellerId: ownerObjectId }),
      }),
      userRole === "ADMIN"
        ? UserModel.distinct("_id", { role: "RESELLER" }).exec() as Promise<mongoose.Types.ObjectId[]>
        : Promise.resolve([ownerObjectId]),
      userRole === "ADMIN"
        ? ProductVariantModel.aggregate([
            { $match: { isActive: true } },
            {
              $group: {
                _id: null,
                totalUnits: { $sum: "$stock" },
                variants: { $sum: 1 },
                outOfStockVariants: { $sum: { $cond: [{ $lte: ["$stock", 0] }, 1, 0] } },
                lowStockVariants: { $sum: { $cond: [{ $and: [{ $gt: ["$stock", 0] }, { $lte: ["$stock", 3] }] }, 1, 0] } },
              },
            },
          ]).exec() as Promise<SummaryRow[]>
        : Promise.resolve([] as SummaryRow[]),
      userRole === "ADMIN" ? UserModel.countDocuments({ role: "RESELLER", isActive: true }) : Promis    // Recalcula igual que /api/supplier-payables, con líneas de venta y centavos enteros.
    // Evita que pequeñas diferencias entre la agregación MongoDB y el cálculo normalizado
    // produzcan un balanceDue distinto entre la página financiera y el dashboard.
    const supplierSales: SupplierDebtSaleRecord[] = supplierUserIds.length
      ? await SaleModel.find({ ownerId: { $in: supplierUserIds }, isActive: true })
          .select("items.unitCost items.quantity items.supplierAmountPaid")
          .lean() as unknown as SupplierDebtSaleRecord[]
      : [];

    let supplierTotalDueCents = 0;
    let supplierTotalPaidCents = 0;

    for (const sale of supplierSales) {
      for (const item of sale.items ?? []) {
        const quantity = Math.max(0, Math.trunc(item.quantity ?? 0));
        const unitCostCents = Math.max(0, toCents(item.unitCost ?? 0));
        const costCents = unitCostCents * quantity;
        const paidCents = Math.min(
          costCents,
          Math.max(0, toCents(item.supplierAmountPaid ?? 0)),
        );

        supplierTotalDueCents += costCents;
        supplierTotalPaidCents += paidCents;
      }
    }

    const month = monthlyRows[0] ?? {};: "$costCents" },
                totalPaidCents: { $sum: "$paidCents" },
              },
            },
          ]).exec()
        : [];

    const month = monthlyRows[0] ?? {};
    const receivables = receivableRows[0] ?? {};
    const inventory = inventoryRows[0] ?? {};
    const sales = recentSales.map((sale) => ({
      _id: String(sale._id),
      saleNumber: sale.saleNumber,
      customerName: customerName(sale.customerSnapshot),
      total: sale.total,
      amountPaid: sale.amountPaid,
      balanceDue: sale.balanceDue,
      paymentStatus: sale.paymentStatus,
      profit: sale.grossProfit,
      createdAt: sale.createdAt,
      itemSummary: sale.items.map((item) =>
        item.quantity + " × " + item.productTitle + (item.variantLabel ? " (" + item.variantLabel + ")" : ""),
      ).join(", "),
    }));

    return NextResponse.json({
      ok: true,
      role: userRole as Role,
      generatedAt: now.toISOString(),
      monthly: {
        salesCount: month.count ?? 0,
        salesTotal: fromCents(toCents(month.total ?? 0)),
        grossProfit: fromCents(toCents(month.profit ?? 0)),
      },
      receivables: {
        count: receivables.count ?? 0,
        balanceDue: fromCents(toCents(receivables.balanceDue ?? 0)),
      },
      supplierDebt: {
        calculationVersion: "supplier-debt-line-normalized-v3",
        totalDue: fromCents(supplierTotalDueCents),
        totalPaid: fromCents(supplierTotalPaidCents),
        balanceDue: fromCents(Math.max(0, supplierTotalDueCents - supplierTotalPaidCents)),
      },
      pendingOrders,
      activeResellers,
      catalogProductCount,
      inventory: {
        totalUnits: inventory.totalUnits ?? 0,
        variants: inventory.variants ?? 0,
        outOfStockVariants: inventory.outOfStockVariants ?? 0,
        lowStockVariants: inventory.lowStockVariants ?? 0,
      },
      recentSales: sales,
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    console.error("[DASHBOARD_SUMMARY]", error);
    return errorResponse("No pudimos cargar el resumen del negocio.", 500, "INTERNAL_ERROR");
  }
}
