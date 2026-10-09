"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowUpRight, CircleDollarSign, ClipboardList, Plus, ShoppingCart } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";

type SaleItem = {
  productTitle: string;
  variantLabel: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};
type Sale = {
  _id: string;
  saleNumber: string;
  customerSnapshot?: { firstName?: string; lastName?: string; documentId?: string };
  items: SaleItem[];
  total: number;
  amountPaid: number;
  balanceDue: number;
  paymentStatus: "UNPAID" | "PARTIAL" | "PAID";
  profit: number;
  createdAt: string;
  note?: string;
};
type SalesResponse = { ok: true; sales: Sale[] };

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}
function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
function statusLabel(status: Sale["paymentStatus"]) {
  if (status === "PAID") return "Pagada";
  if (status === "PARTIAL") return "Pago parcial";
  return "Pendiente";
}

export default function SalesPage() {
  const { data: user } = useCurrentUser();
  const isAdmin = user?.role === "ADMIN";
  const sales = useQuery({
    queryKey: ["sales"],
    enabled: !!user,
    queryFn: async () => (await api.get<SalesResponse>("/sales")).data.sales,
  });

  const allSales = sales.data ?? [];
  const totalSales = allSales.reduce((sum, sale) => sum + sale.total, 0);
  const collected = allSales.reduce((sum, sale) => sum + sale.amountPaid, 0);
  const pending = allSales.reduce((sum, sale) => sum + sale.balanceDue, 0);
  const profit = allSales.reduce((sum, sale) => sum + sale.profit, 0);

  return (
    <div className="dashboard-page sales-page">
      <section className="page-heading">
        <div>
          <span className="page-kicker">Operaciones</span>
          <h1>Ventas</h1>
          <p>Consulta las ventas registradas, los pagos recibidos y los importes pendientes.</p>
        </div>
        <Link href="/dashboard/sales/new" className="primary-button"><Plus size={17} /> Registrar venta</Link>
      </section>

      <section className="sales-summary-grid">
        <article className="stat-card">
          <span className="stat-icon"><ShoppingCart size={18} /></span>
          <div className="stat-label">Ventas registradas</div>
          <div className="stat-value">{money(totalSales)}</div>
          <div className="stat-hint">{allSales.length} operaciones recientes</div>
        </article>
        <article className="stat-card">
          <span className="stat-icon"><ArrowDownLeft size={18} /></span>
          <div className="stat-label">Cobrado</div>
          <div className="stat-value">{money(collected)}</div>
          <div className="stat-hint">Pagos iniciales registrados</div>
        </article>
        <article className="stat-card">
          <span className="stat-icon"><CircleDollarSign size={18} /></span>
          <div className="stat-label">Pendiente de cobro</div>
          <div className="stat-value">{money(pending)}</div>
          <div className="stat-hint">Saldo de estas ventas</div>
        </article>
        <article className="stat-card">
          <span className="stat-icon"><ArrowUpRight size={18} /></span>
          <div className="stat-label">{isAdmin ? "Ganancia bruta" : "Ganancia estimada"}</div>
          <div className="stat-value">{money(profit)}</div>
          <div className="stat-hint">{isAdmin ? "Antes de gastos operativos" : "Diferencia entre tu precio y el mayorista"}</div>
        </article>
      </section>

      <section className="panel-card sales-list-panel">
        <div className="sales-list-header">
          <div><span className="panel-kicker">Historial</span><h2>Ventas recientes</h2></div>
          <span className="sales-count">{allSales.length} registros visibles</span>
        </div>

        {sales.isLoading ? (
          <div className="dashboard-loading">Cargando ventas...</div>
        ) : sales.isError ? (
          <div className="dashboard-empty compact">
            <div className="dashboard-empty-icon"><ClipboardList size={19} /></div>
            <strong>No pudimos cargar las ventas</strong>
            <span>Comprueba tu conexión e inténtalo de nuevo.</span>
            <button className="secondary-button" type="button" onClick={() => void sales.refetch()}>Intentar de nuevo</button>
          </div>
        ) : allSales.length ? (
          <div className="sales-list">
            {allSales.map((sale) => {
              const customer = [sale.customerSnapshot?.firstName, sale.customerSnapshot?.lastName].filter(Boolean).join(" ") || "Cliente ocasional";
              const itemDescription = sale.items.map((item) => item.quantity + " × " + item.productTitle + " (" + item.variantLabel + ")").join(" · ");
              return (
                <article className="sale-row" key={sale._id}>
                  <div className="sale-row-icon"><ClipboardList size={19} /></div>
                  <div className="sale-row-main">
                    <div className="sale-row-title">
                      <strong>{sale.saleNumber}</strong>
                      <span className={"sale-payment-status " + sale.paymentStatus.toLowerCase()}>{statusLabel(sale.paymentStatus)}</span>
                    </div>
                    <span className="sale-row-customer">{customer} · {dateLabel(sale.createdAt)}</span>
                    <span className="sale-row-items">{itemDescription}</span>
                  </div>
                  <div className="sale-row-financials">
                    <strong>{money(sale.total)}</strong>
                    <span>Recibido: {money(sale.amountPaid)}</span>
                    {sale.balanceDue > 0 ? <span className="sale-row-due">Pendiente: {money(sale.balanceDue)}</span> : <span className="sale-row-paid">Saldada</span>}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="dashboard-empty compact sales-empty">
            <div className="dashboard-empty-icon"><ShoppingCart size={20} /></div>
            <strong>Aún no hay ventas registradas</strong>
            <span>La primera venta aparecerá aquí junto con sus productos y el estado del pago.</span>
            <Link href="/dashboard/sales/new" className="secondary-action">Registrar primera venta</Link>
          </div>
        )}
      </section>
    </div>
  );
}
