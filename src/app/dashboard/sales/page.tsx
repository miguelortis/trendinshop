"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownLeft, ArrowUpRight, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight,
  CircleDollarSign, ClipboardList, Plus, Search, ShoppingCart, X,
} from "lucide-react";
import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import { api } from "@/lib/api/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";

type SaleItem = {
  productTitle: string;
  variantLabel: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  unitCost?: number;
  lineCostTotal?: number;
  wholesaleUnitCost?: number;
  wholesaleLineCostTotal?: number;
  unitProfit?: number;
  lineProfit?: number;
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
  saleStatus: "ACTIVE" | "CANCELLED";
  cancellationReason?: string;
  cancelledAt?: string | null;
  isActive: boolean;
  profit: number;
  createdAt: string;
  note?: string;
};
type SalesResponse = {
  ok: true;
  sales: Sale[];
  pagination: { page: number; limit: number; total: number; pages: number };
  summary: { count: number; total: number; amountPaid: number; balanceDue: number; profit: number };
};
type StatusFilter = "ALL" | "UNPAID" | "PARTIAL" | "PAID" | "CANCELLED";

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}
function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
function statusLabel(status: Sale["paymentStatus"]) {
  if (status === "PAID") return "Pagada";
  if (status === "PARTIAL") return "Abono parcial";
  return "Pendiente";
}
function errorMessage(error: unknown) {
  const value = error as { response?: { data?: { message?: string } } };
  return value.response?.data?.message ?? "No pudimos completar la operación. Inténtalo de nuevo.";
}

export default function SalesPage() {
  const { data: user } = useCurrentUser();
  const isAdmin = user?.role === "ADMIN";
  const queryClient = useQueryClient();
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [cancelTarget, setCancelTarget] = useState<Sale | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchDraft.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  const sales = useQuery({
    queryKey: ["sales", user?.id, page, search, statusFilter, from, to],
    enabled: !!user,
    queryFn: async () => (await api.get<SalesResponse>("/sales", {
      params: {
        page,
        limit: 25,
        q: search,
        saleStatus: statusFilter === "CANCELLED" ? "CANCELLED" : "ACTIVE",
        paymentStatus: ["UNPAID", "PARTIAL", "PAID"].includes(statusFilter) ? statusFilter : "",
        from,
        to,
      },
    })).data,
    placeholderData: (previous) => previous,
  });

  const cancelSale = useMutation({
    mutationFn: async () => {
      if (!cancelTarget) throw new Error("Selecciona una venta.");
      return (await api.patch("/sales/" + cancelTarget._id, { action: "CANCEL", reason: cancelReason.trim() })).data as { message?: string };
    },
    onSuccess: async (result) => {
      setActionMessage(result.message ?? "Venta anulada y existencias restauradas.");
      setActionError("");
      setCancelTarget(null);
      setCancelReason("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales"] }),
        queryClient.invalidateQueries({ queryKey: ["inventory"] }),
        queryClient.invalidateQueries({ queryKey: ["sale-options"] }),
        queryClient.invalidateQueries({ queryKey: ["reseller-catalog"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] }),
        queryClient.invalidateQueries({ queryKey: ["supplier-payables"] }),
      ]);
    },
    onError: (error: unknown) => setActionError(errorMessage(error)),
  });

  const allSales = sales.data?.sales ?? [];
  const summary = sales.data?.summary;
  const pagination = sales.data?.pagination;

  function handleCancel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionError("");
    if (cancelReason.trim().length < 3) {
      setActionError("Escribe un motivo de al menos 3 caracteres.");
      return;
    }
    cancelSale.mutate();
  }

  return (
    <div className="dashboard-page sales-page">
      <section className="page-heading">
        <div>
          <span className="page-kicker">Operaciones</span>
          <h1>Ventas</h1>
          <p>Busca cualquier venta, revisa sus cobros y controla los saldos pendientes.</p>
        </div>
        <Link href="/dashboard/sales/new" className="primary-button"><Plus size={17} /> Registrar venta</Link>
      </section>

      {actionMessage ? <div className="customers-success" role="status"><CheckCircle2 size={16} /> {actionMessage}</div> : null}
      {actionError && !cancelTarget ? <div className="auth-error customers-message" role="alert">{actionError}</div> : null}

      <section className="sales-summary-grid">
        <article className="stat-card">
          <span className="stat-icon"><ShoppingCart size={18} /></span>
          <div className="stat-label">Total vendido</div>
          <div className="stat-value">{money(summary?.total ?? 0)}</div>
          <div className="stat-hint">{summary?.count ?? 0} ventas activas en el filtro</div>
        </article>
        <article className="stat-card">
          <span className="stat-icon"><ArrowDownLeft size={18} /></span>
          <div className="stat-label">Cobrado</div>
          <div className="stat-value">{money(summary?.amountPaid ?? 0)}</div>
          <div className="stat-hint">Abonos registrados de esas ventas</div>
        </article>
        <article className="stat-card">
          <span className="stat-icon"><CircleDollarSign size={18} /></span>
          <div className="stat-label">Pendiente de cobro</div>
          <div className="stat-value">{money(summary?.balanceDue ?? 0)}</div>
          <div className="stat-hint">Saldo todavía por recibir</div>
        </article>
        <article className="stat-card">
          <span className="stat-icon"><ArrowUpRight size={18} /></span>
          <div className="stat-label">{isAdmin ? "Ganancia bruta" : "Ganancia estimada"}</div>
          <div className="stat-value">{money(summary?.profit ?? 0)}</div>
          <div className="stat-hint">Sin incluir gastos adicionales</div>
        </article>
      </section>

      <section className="panel-card sales-list-panel">
        <div className="sales-list-header">
          <div><span className="panel-kicker">Registro completo</span><h2>Historial de ventas</h2></div>
          <span className="sales-count">{pagination?.total ?? 0} registros</span>
        </div>

        <div className="sales-filter-bar">
          <label className="search-field sales-search-field">
            <Search size={16} />
            <input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Buscar número, cliente o producto" aria-label="Buscar ventas" />
          </label>
          <label className="field sales-status-filter">
            <span>Estado</span>
            <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value as StatusFilter); setPage(1); }}>
              <option value="ALL">Todas las activas</option>
              <option value="UNPAID">Pendientes de pago</option>
              <option value="PARTIAL">Abonos parciales</option>
              <option value="PAID">Pagadas</option>
              <option value="CANCELLED">Anuladas</option>
            </select>
          </label>
          <label className="field sales-date-filter">
            <span>Desde</span>
            <input type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1); }} />
          </label>
          <label className="field sales-date-filter">
            <span>Hasta</span>
            <input type="date" value={to} min={from || undefined} onChange={(event) => { setTo(event.target.value); setPage(1); }} />
          </label>
          {(searchDraft || statusFilter !== "ALL" || from || to) ? (
            <button className="secondary-button sales-clear-filters" type="button" onClick={() => { setSearchDraft(""); setSearch(""); setStatusFilter("ALL"); setFrom(""); setTo(""); setPage(1); }}>
              <X size={14} /> Limpiar
            </button>
          ) : null}
        </div>

        {sales.isLoading ? (
          <div className="dashboard-loading">Cargando ventas...</div>
        ) : sales.isError ? (
          <div className="dashboard-empty compact">
            <div className="dashboard-empty-icon"><ClipboardList size={19} /></div>
            <strong>No pudimos cargar las ventas</strong>
            <span>{errorMessage(sales.error)}</span>
            <button className="secondary-button" type="button" onClick={() => void sales.refetch()}>Intentar de nuevo</button>
          </div>
        ) : allSales.length ? (
          <>
            <div className="sales-list">
              {allSales.map((sale) => {
                const customer = [sale.customerSnapshot?.firstName, sale.customerSnapshot?.lastName].filter(Boolean).join(" ") || "Cliente ocasional";
                const cancelled = sale.saleStatus === "CANCELLED";
                return (
                  <article className={"sale-row" + (cancelled ? " sale-row-cancelled" : "")} key={sale._id}>
                    <div className="sale-row-icon"><ClipboardList size={19} /></div>
                    <div className="sale-row-main">
                      <div className="sale-row-title">
                        <strong>{sale.saleNumber}</strong>
                        <span className={"sale-payment-status " + (cancelled ? "cancelled" : sale.paymentStatus.toLowerCase())}>{cancelled ? "Anulada" : statusLabel(sale.paymentStatus)}</span>
                      </div>
                      <span className="sale-row-customer">{customer} · {dateLabel(sale.createdAt)}</span>
                      <div className="sale-row-items sale-row-item-details">
                        {sale.items.map((item, index) => {
                          const costPerUnit = isAdmin ? (item.unitCost ?? 0) : (item.wholesaleUnitCost ?? 0);
                          const costTotal = isAdmin ? (item.lineCostTotal ?? costPerUnit * item.quantity) : (item.wholesaleLineCostTotal ?? costPerUnit * item.quantity);
                          const profitPerUnit = item.unitProfit ?? item.unitPrice - costPerUnit;
                          const profitTotal = item.lineProfit ?? item.lineTotal - costTotal;
                          return (
                            <div className="sale-row-item-detail" key={sale._id + "-" + item.productTitle + "-" + item.variantLabel + "-" + index}>
                              <span><strong>{item.quantity} × {item.productTitle}</strong> · {item.variantLabel}</span>
                              <small>Venta: {money(item.unitPrice)} / unidad · Costo: {money(costPerUnit)} / unidad</small>
                              <small>Importe: {money(item.lineTotal)} · {isAdmin ? "Ganancia bruta" : "Tu ganancia"}: {money(profitTotal)} ({money(profitPerUnit)} / unidad)</small>
                            </div>
                          );
                        })}
                      </div>
                      {cancelled && sale.cancellationReason ? <span className="sale-cancellation-reason">Motivo: {sale.cancellationReason}</span> : null}
                    </div>
                    <div className="sale-row-financials">
                      <strong>{money(sale.total)}</strong>
                      <span>Recibido: {money(sale.amountPaid)}</span>
                      {cancelled ? <span className="sale-cancellation-reason">No contabiliza como venta activa</span> : sale.balanceDue > 0 ? <span className="sale-row-due">Pendiente: {money(sale.balanceDue)}</span> : <span className="sale-row-paid">Saldada</span>}
                      {sale.isActive && sale.amountPaid <= 0 ? (
                        <button className="product-card-action danger" type="button" onClick={() => { setCancelTarget(sale); setCancelReason(""); setActionError(""); setActionMessage(""); }}>
                          Anular venta
                        </button>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>

            <nav className="sales-pagination" aria-label="Paginación de ventas">
              <span>Página {pagination?.page ?? page} de {pagination?.pages ?? 1}</span>
              <div>
                <button className="secondary-button" type="button" disabled={page <= 1 || sales.isFetching} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={15} /> Anterior</button>
                <button className="secondary-button" type="button" disabled={page >= (pagination?.pages ?? 1) || sales.isFetching} onClick={() => setPage((value) => value + 1)}>Siguiente <ChevronRight size={15} /></button>
              </div>
            </nav>
          </>
        ) : (
          <div className="dashboard-empty compact sales-empty">
            <div className="dashboard-empty-icon"><ShoppingCart size={20} /></div>
            <strong>{statusFilter === "CANCELLED" ? "No hay ventas anuladas" : "No encontramos ventas con esos filtros"}</strong>
            <span>{statusFilter === "ALL" && !search && !from && !to ? "La primera venta aparecerá aquí junto con sus productos y el estado del pago." : "Prueba con otro cliente, estado o período."}</span>
            {statusFilter === "ALL" && !search && !from && !to ? <Link href="/dashboard/sales/new" className="secondary-action">Registrar primera venta</Link> : null}
          </div>
        )}
      </section>

      {cancelTarget ? (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !cancelSale.isPending) setCancelTarget(null); }}>
          <section className="payment-modal sale-cancel-modal" role="dialog" aria-modal="true" aria-labelledby="sale-cancel-title">
            <div className="panel-header">
              <div><span className="panel-kicker">Movimiento de inventario</span><h2 id="sale-cancel-title">Anular {cancelTarget.saleNumber}</h2></div>
              <button className="icon-button" type="button" aria-label="Cerrar" disabled={cancelSale.isPending} onClick={() => setCancelTarget(null)}><X size={18} /></button>
            </div>
            <p>Esta operación dejará un registro de auditoría y devolverá las unidades al inventario. Solo se permite automáticamente cuando aún no hay pagos de cliente ni abonos al administrador.</p>
            <form onSubmit={handleCancel}>
              <label className="field">
                <span>Motivo de la anulación *</span>
                <textarea rows={3} maxLength={500} required value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="Ej. Se registró una variante incorrecta..." />
              </label>
              {actionError ? <div className="auth-error" role="alert">{actionError}</div> : null}
              <div className="payment-modal-actions">
                <button className="secondary-button" type="button" disabled={cancelSale.isPending} onClick={() => setCancelTarget(null)}>Volver</button>
                <button className="primary-button" type="submit" disabled={cancelSale.isPending || cancelReason.trim().length < 3}>{cancelSale.isPending ? "Anulando..." : "Confirmar anulación"}</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}
