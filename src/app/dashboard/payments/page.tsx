"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowDownLeft, CreditCard, WalletCards } from "lucide-react";
import Link from "next/link";
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
type PaymentsResponse = { ok: true; payments: Payment[] };

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}
function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export default function PaymentsPage() {
  const payments = useQuery({
    queryKey: ["payments"],
    queryFn: async () => (await api.get<PaymentsResponse>("/payments")).data.payments,
  });
  const rows = payments.data ?? [];
  const total = rows.reduce((sum, payment) => sum + payment.amount, 0);
  const cashTotal = rows.filter((payment) => payment.method === "CASH").reduce((sum, payment) => sum + payment.amount, 0);
  const transferTotal = rows.filter((payment) => payment.method === "TRANSFER").reduce((sum, payment) => sum + payment.amount, 0);

  return (
    <div className="dashboard-page payments-page">
      <section className="page-heading">
        <div>
          <span className="page-kicker">Registro de cobros</span>
          <h1>Pagos</h1>
          <p>Consulta los pagos iniciales y los abonos registrados en tus ventas.</p>
        </div>
        <Link href="/dashboard/receivables" className="primary-button"><CreditCard size={16} /> Cuentas por cobrar</Link>
      </section>

      <section className="payments-summary-grid">
        <article className="stat-card">
          <span className="stat-icon"><WalletCards size={18} /></span>
          <div className="stat-label">Total recibido</div>
          <div className="stat-value">{money(total)}</div>
          <div className="stat-hint">{rows.length} movimientos visibles</div>
        </article>
        <article className="stat-card">
          <span className="stat-icon"><ArrowDownLeft size={18} /></span>
          <div className="stat-label">Efectivo</div>
          <div className="stat-value">{money(cashTotal)}</div>
          <div className="stat-hint">Pagos registrados en efectivo</div>
        </article>
        <article className="stat-card">
          <span className="stat-icon"><CreditCard size={18} /></span>
          <div className="stat-label">Transferencias</div>
          <div className="stat-value">{money(transferTotal)}</div>
          <div className="stat-hint">Pagos registrados por transferencia</div>
        </article>
      </section>

      <section className="panel-card payments-list-panel">
        <div className="payments-list-header">
          <div><span className="panel-kicker">Actividad financiera</span><h2>Historial de pagos</h2></div>
          <span className="payments-count">{rows.length} registros</span>
        </div>

        {payments.isLoading ? (
          <div className="dashboard-loading">Cargando pagos...</div>
        ) : payments.isError ? (
          <div className="dashboard-empty compact">
            <div className="dashboard-empty-icon"><WalletCards size={19} /></div>
            <strong>No pudimos cargar los pagos</strong>
            <span>Comprueba tu conexión e inténtalo de nuevo.</span>
            <button type="button" className="secondary-button" onClick={() => void payments.refetch()}>Intentar de nuevo</button>
          </div>
        ) : rows.length ? (
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
        ) : (
          <div className="dashboard-empty compact">
            <div className="dashboard-empty-icon"><WalletCards size={20} /></div>
            <strong>Aún no hay pagos registrados</strong>
            <span>Los pagos iniciales y los abonos de tus ventas aparecerán aquí.</span>
            <Link href="/dashboard/sales/new" className="secondary-action">Registrar primera venta</Link>
          </div>
        )}
      </section>
    </div>
  );
}
