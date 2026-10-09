"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CircleDollarSign, Clock3, CreditCard, WalletCards, X } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api/client";

type Receivable = {
  _id: string;
  saleNumber: string;
  customerName: string;
  customerSnapshot?: { documentId?: string };
  total: number;
  amountPaid: number;
  balanceDue: number;
  paymentStatus: "UNPAID" | "PARTIAL" | "PAID";
  createdAt: string;
  items: { productTitle: string; variantLabel: string; quantity: number }[];
};
type ReceivablesResponse = { ok: true; receivables: Receivable[] };
type PaymentPayload = { saleId: string; amount: number; method: string; note: string };

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}
function errorMessage(error: unknown) {
  const value = error as { response?: { data?: { message?: string } } };
  return value.response?.data?.message ?? "No pudimos registrar el abono.";
}
function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("es", { dateStyle: "medium" }).format(date);
}

export default function ReceivablesPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Receivable | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("CASH");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const receivables = useQuery({
    queryKey: ["receivables"],
    queryFn: async () => (await api.get<ReceivablesResponse>("/receivables")).data.receivables,
  });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return receivables.data ?? [];
    return (receivables.data ?? []).filter((sale) =>
      [sale.saleNumber, sale.customerName, sale.customerSnapshot?.documentId ?? ""].join(" ").toLowerCase().includes(term),
    );
  }, [receivables.data, search]);

  const totalDue = (receivables.data ?? []).reduce((sum, sale) => sum + sale.balanceDue, 0);
  const totalOriginal = (receivables.data ?? []).reduce((sum, sale) => sum + sale.total, 0);

  const payment = useMutation({
    mutationFn: async (payload: PaymentPayload) => (await api.post("/payments", payload)).data as { message?: string },
    onSuccess: async (result) => {
      setSuccess(result.message ?? "Abono registrado correctamente.");
      setError("");
      setSelected(null);
      setAmount("");
      setNote("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["receivables"] }),
        queryClient.invalidateQueries({ queryKey: ["payments"] }),
        queryClient.invalidateQueries({ queryKey: ["sales"] }),
        queryClient.invalidateQueries({ queryKey: ["sale-options"] }),
      ]);
    },
    onError: (requestError: unknown) => { setError(errorMessage(requestError)); setSuccess(""); },
  });

  function openPayment(sale: Receivable) {
    setSelected(sale);
    setAmount(sale.balanceDue.toFixed(2));
    setMethod("CASH");
    setNote("");
    setError("");
    setSuccess("");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const number = Number(amount);
    if (!Number.isFinite(number) || number <= 0 || number > selected.balanceDue) {
      setError("Indica un importe mayor que cero y no superior al saldo pendiente.");
      return;
    }
    payment.mutate({ saleId: selected._id, amount: number, method, note: note.trim() });
  }

  return (
    <div className="dashboard-page receivables-page">
      <section className="page-heading">
        <div>
          <span className="page-kicker">Seguimiento de cobros</span>
          <h1>Cuentas por cobrar</h1>
          <p>Controla las ventas con saldo pendiente y registra los abonos recibidos.</p>
        </div>
        <Link href="/dashboard/payments" className="secondary-button"><WalletCards size={15} /> Historial de pagos</Link>
      </section>

      <section className="receivables-summary-grid">
        <article className="stat-card">
          <span className="stat-icon"><CircleDollarSign size={18} /></span>
          <div className="stat-label">Saldo pendiente total</div>
          <div className="stat-value">{money(totalDue)}</div>
          <div className="stat-hint">{filtered.length} cuentas en la vista</div>
        </article>
        <article className="stat-card">
          <span className="stat-icon"><Clock3 size={18} /></span>
          <div className="stat-label">Ventas por cobrar</div>
          <div className="stat-value">{receivables.data?.length ?? 0}</div>
          <div className="stat-hint">Operaciones sin liquidar</div>
        </article>
        <article className="stat-card">
          <span className="stat-icon"><CreditCard size={18} /></span>
          <div className="stat-label">Total original</div>
          <div className="stat-value">{money(totalOriginal)}</div>
          <div className="stat-hint">De las cuentas pendientes</div>
        </article>
      </section>

      {success ? <div className="customers-success"><Check size={16} /> {success}</div> : null}
      {error && !selected ? <div className="auth-error customers-message">{error}</div> : null}

      <section className="panel-card receivables-panel">
        <div className="receivables-header">
          <div><span className="panel-kicker">Cobros pendientes</span><h2>Saldo por venta</h2></div>
          <label className="search-field receivables-search">
            <CreditCard size={16} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar venta o cliente..." aria-label="Buscar cuentas por cobrar" />
          </label>
        </div>

        {receivables.isLoading ? (
          <div className="dashboard-loading">Cargando cuentas por cobrar...</div>
        ) : receivables.isError ? (
          <div className="dashboard-empty compact">
            <strong>No pudimos cargar las cuentas</strong>
            <span>{errorMessage(receivables.error)}</span>
            <button className="secondary-button" type="button" onClick={() => void receivables.refetch()}>Intentar de nuevo</button>
          </div>
        ) : filtered.length ? (
          <div className="receivables-list">
            {filtered.map((sale) => (
              <article className="receivable-row" key={sale._id}>
                <div className="receivable-icon"><CircleDollarSign size={19} /></div>
                <div className="receivable-main">
                  <div className="receivable-title-line">
                    <strong>{sale.saleNumber}</strong>
                    <span className={"sale-payment-status " + sale.paymentStatus.toLowerCase()}>{sale.paymentStatus === "PARTIAL" ? "Pago parcial" : "Pendiente"}</span>
                  </div>
                  <span className="receivable-customer">{sale.customerName} · {dateLabel(sale.createdAt)}</span>
                  <span className="receivable-items">{sale.items.map((item) => item.quantity + " × " + item.productTitle + " (" + item.variantLabel + ")").join(" · ")}</span>
                  <div className="receivable-progress"><span style={{ width: Math.min(100, sale.total > 0 ? sale.amountPaid / sale.total * 100 : 0) + "%" }} /></div>
                  <span className="receivable-progress-label">Cobrado {money(sale.amountPaid)} de {money(sale.total)}</span>
                </div>
                <div className="receivable-financials">
                  <span>Saldo</span>
                  <strong>{money(sale.balanceDue)}</strong>
                  <button className="product-card-action primary" type="button" onClick={() => openPayment(sale)}>Registrar abono</button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="dashboard-empty compact">
            <div className="dashboard-empty-icon"><Check size={20} /></div>
            <strong>{search ? "No encontramos coincidencias" : "Todo está al día"}</strong>
            <span>{search ? "Prueba con otro número de venta o cliente." : "No hay saldos pendientes en tus ventas registradas."}</span>
          </div>
        )}
      </section>

      {selected ? (
        <div className="modal-backdrop" onClick={() => !payment.isPending && setSelected(null)}>
          <section className="payment-modal" role="dialog" aria-modal="true" aria-labelledby="payment-modal-title" onClick={(event) => event.stopPropagation()}>
            <div className="panel-header">
              <div><span className="panel-kicker">Registrar cobro</span><h2 id="payment-modal-title">{selected.saleNumber}</h2></div>
              <button className="icon-button" type="button" aria-label="Cerrar" disabled={payment.isPending} onClick={() => setSelected(null)}><X size={18} /></button>
            </div>
            <div className="payment-modal-balance"><span>Saldo pendiente</span><strong>{money(selected.balanceDue)}</strong></div>
            <form onSubmit={handleSubmit}>
              <label className="field">
                <span>Importe del abono (USD) *</span>
                <input type="number" min="0.01" max={selected.balanceDue.toFixed(2)} step="0.01" required value={amount} onChange={(event) => setAmount(event.target.value)} />
              </label>
              <label className="field">
                <span>Método de pago *</span>
                <select value={method} onChange={(event) => setMethod(event.target.value)}>
                  <option value="CASH">Efectivo</option>
                  <option value="TRANSFER">Transferencia</option>
                  <option value="CARD">Tarjeta</option>
                  <option value="OTHER">Otro</option>
                </select>
              </label>
              <label className="field">
                <span>Nota o referencia (opcional)</span>
                <input value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder="Referencia de transferencia, recibo..." />
              </label>
              {error ? <div className="auth-error">{error}</div> : null}
              <div className="payment-modal-actions">
                <button type="button" className="secondary-button" disabled={payment.isPending} onClick={() => setSelected(null)}>Cancelar</button>
                <button type="submit" className="primary-button" disabled={payment.isPending}>{payment.isPending ? "Registrando..." : "Confirmar abono"}</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}
