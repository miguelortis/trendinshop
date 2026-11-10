"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowDownLeft, ChevronLeft, ChevronRight, CreditCard, Search, WalletCards, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api/client";

type Payment = {
  _id: string;
  saleId: string;
  saleNumber: string;
  customerName: string;
  amount: number;
  method: "CASH" | "TRANSFER" | "CARD" | "OTHER";
  methodLabel: string;
  note: string;
  createdAt: string;
};
type PaymentsResponse = {
  ok: true;
  payments: Payment[];
  pagination: { page: number; limit: number; total: number; pages: number };
  summary: { count: number; total: number; cashTotal: number; transferTotal: number };
};
type MethodFilter = "ALL" | Payment["method"];

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}
function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
function errorMessage(error: unknown) {
  const value = error as { response?: { data?: { message?: string } } };
  return value.response?.data?.message ?? "No pudimos cargar el historial de pagos.";
}

export default function PaymentsPage() {
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [method, setMethod] = useState<MethodFilter>("ALL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchDraft.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  const payments = useQuery({
    queryKey: ["payments", page, search, method, from, to],
    queryFn: async () => (await api.get<PaymentsResponse>("/payments", {
      params: { page, limit: 25, q: search, method: method === "ALL" ? "" : method, from, to },
    })).data,
    placeholderData: (previous) => previous,
  });
  const rows = payments.data?.payments ?? [];
  const summary = payments.data?.summary;
  const pagination = payments.data?.pagination;

  return (
    <div className="dashboard-page payments-page">
      <section className="page-heading">
        <div>
          <span className="page-kicker">Registro de cobros</span>
          <h1>Pagos</h1>
          <p>Consulta pagos iniciales y abonos de todas tus ventas con filtros y paginación.</p>
        </div>
        <Link href="/dashboard/receivables" className="primary-button"><CreditCard size={16} /> Cuentas por cobrar</Link>
      </section>

      <section className="payments-summary-grid">
        <article className="stat-card">
          <span className="stat-icon"><WalletCards size={18} /></span>
          <div className="stat-label">Total recibido</div>
          <div className="stat-value">{money(summary?.total ?? 0)}</div>
          <div className="stat-hint">{summary?.count ?? 0} movimientos en el filtro</div>
        </article>
        <article className="stat-card">
          <span className="stat-icon"><ArrowDownLeft size={18} /></span>
          <div className="stat-label">Efectivo</div>
          <div className="stat-value">{money(summary?.cashTotal ?? 0)}</div>
          <div className="stat-hint">Total de los movimientos encontrados</div>
        </article>
        <article className="stat-card">
          <span className="stat-icon"><CreditCard size={18} /></span>
          <div className="stat-label">Transferencias</div>
          <div className="stat-value">{money(summary?.transferTotal ?? 0)}</div>
          <div className="stat-hint">Total de los movimientos encontrados</div>
        </article>
      </section>

      <section className="panel-card payments-list-panel">
        <div className="payments-list-header">
          <div><span className="panel-kicker">Actividad financiera</span><h2>Historial completo de pagos</h2></div>
          <span className="payments-count">{pagination?.total ?? 0} registros</span>
        </div>

        <div className="sales-filter-bar payment-filter-bar">
          <label className="search-field sales-search-field">
            <Search size={16} />
            <input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Buscar venta, cliente o producto" aria-label="Buscar pagos" />
          </label>
          <label className="field">
            <span>Método</span>
            <select value={method} onChange={(event) => { setMethod(event.target.value as MethodFilter); setPage(1); }}>
              <option value="ALL">Todos</option>
              <option value="CASH">Efectivo</option>
              <option value="TRANSFER">Transferencia</option>
              <option value="CARD">Tarjeta</option>
              <option value="OTHER">Otro</option>
            </select>
          </label>
          <label className="field"><span>Desde</span><input type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1); }} /></label>
          <label className="field"><span>Hasta</span><input type="date" min={from || undefined} value={to} onChange={(event) => { setTo(event.target.value); setPage(1); }} /></label>
          {(searchDraft || method !== "ALL" || from || to) ? (
            <button className="secondary-button sales-clear-filters" type="button" onClick={() => { setSearchDraft(""); setSearch(""); setMethod("ALL"); setFrom(""); setTo(""); setPage(1); }}><X size={14} /> Limpiar</button>
          ) : null}
        </div>

        {payments.isLoading ? (
          <div className="dashboard-loading">Cargando pagos...</div>
        ) : payments.isError ? (
          <div className="dashboard-empty compact">
            <div className="dashboard-empty-icon"><WalletCards size={19} /></div>
            <strong>No pudimos cargar los pagos</strong>
            <span>{errorMessage(payments.error)}</span>
            <button type="button" className="secondary-button" onClick={() => void payments.refetch()}>Intentar de nuevo</button>
          </div>
        ) : rows.length ? (
          <>
            <div className="payments-list">
              {rows.map((payment) => (
                <article className="payment-row" key={payment._id}>
                  <div className="payment-row-icon"><WalletCards size={19} /></div>
                  <div className="payment-row-main">
                    <strong>{payment.saleNumber}</strong>
                    <span>{payment.customerName} · {dateLabel(payment.createdAt)}</span>
                    <span className="payment-row-note">{payment.methodLabel}{payment.note ? " · " + payment.note : ""}</span>
                  </div>
                  <div className="payment-row-amount">
                    <strong>{money(payment.amount)}</strong>
                    <span>Recibido</span>
                  </div>
                </article>
              ))}
            </div>
            <nav className="sales-pagination" aria-label="Paginación de pagos">
              <span>Página {pagination?.page ?? page} de {pagination?.pages ?? 1}</span>
              <div>
                <button className="secondary-button" type="button" disabled={page <= 1 || payments.isFetching} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={15} /> Anterior</button>
                <button className="secondary-button" type="button" disabled={page >= (pagination?.pages ?? 1) || payments.isFetching} onClick={() => setPage((value) => value + 1)}>Siguiente <ChevronRight size={15} /></button>
              </div>
            </nav>
          </>
        ) : (
          <div className="dashboard-empty compact">
            <div className="dashboard-empty-icon"><WalletCards size={20} /></div>
            <strong>{search || method !== "ALL" || from || to ? "No encontramos pagos con esos filtros" : "Aún no hay pagos registrados"}</strong>
            <span>{search || method !== "ALL" || from || to ? "Cambia la búsqueda, el método o el período." : "Los pagos iniciales y los abonos aparecerán aquí cuando registres una venta."}</span>
            {!search && method === "ALL" && !from && !to ? <Link href="/dashboard/sales/new" className="secondary-action">Registrar primera venta</Link> : null}
          </div>
        )}
      </section>
    </div>
  );
}
