"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  CreditCard,
  HandCoins,
  ReceiptText,
  Search,
  WalletCards,
  X,
} from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { api } from "@/lib/api/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";

type SupplierSaleItem = {
  productId: string;
  variantId: string;
  productTitle: string;
  productSku: string;
  variantLabel: string;
  variantSku: string;
  quantity: number;
  unitPrice: number;
  wholesaleUnitCost: number;
  lineTotal: number;
  wholesaleCost: number;
  resellerProfit: number;
  supplierAmountPaid: number;
  supplierBalanceDue: number;
};
type SupplierSale = {
  _id: string;
  ownerId: string;
  resellerName: string;
  resellerPhone: string;
  resellerEmail: string;
  saleNumber: string;
  customerName: string;
  customerSnapshot?: { phone?: string; documentId?: string };
  total: number;
  amountCollectedFromCustomer: number;
  customerBalanceDue: number;
  supplierAmountDue: number;
  supplierAmountPaid: number;
  supplierBalanceDue: number;
  supplierPaymentStatus: "UNPAID" | "PARTIAL" | "PAID";
  grossProfit: number;
  createdAt: string;
  note?: string;
  items: SupplierSaleItem[];
};
type SupplierResellerSummary = {
  id: string;
  name: string;
  phone: string;
  email: string;
  salesCount: number;
  totalDue: number;
  totalPaid: number;
  balanceDue: number;
  customerBalanceDue: number;
};
type SupplierPayablesResponse = {
  ok: true;
  role: "ADMIN" | "RESELLER";
  resellers: SupplierResellerSummary[];
  summary: {
    salesCount: number;
    totalDue: number;
    totalPaid: number;
    balanceDue: number;
    resellersOwing: number;
  };
  sales: SupplierSale[];
};
type SupplierPayment = {
  _id: string;
  saleId: string;
  saleNumber: string;
  resellerId: string;
  resellerName: string;
  amount: number;
  method: "CASH" | "TRANSFER" | "CARD" | "OTHER";
  methodLabel: string;
  note: string;
  receivedBy?: string;
  reviewedBy?: string;
  allocations: { productTitle: string; variantLabel: string; amount: number }[];
  createdAt: string;
  status?: "PENDING" | "CONFIRMED" | "REJECTED";
  reference?: string;
  reviewNote?: string;
};
type SupplierPaymentsResponse = { ok: true; payments: SupplierPayment[] };
type PaymentForm = { saleId: string; amount: string; method: string; note: string; reference: string };

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function toCents(value: number) {
  return Math.round((value + Number.EPSILON) * 100);
}

function fromCents(value: number) {
  return Number((value / 100).toFixed(2));
}
function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" }).format(date);
}


function calculateItemSupplierBalance(item: SupplierSaleItem) {
  const unitCostCents = Math.max(0, toCents(item.wholesaleUnitCost));
  const costCents = unitCostCents * Math.max(0, Math.trunc(item.quantity));
  const paidCents = Math.min(costCents, Math.max(0, toCents(item.supplierAmountPaid ?? 0)));
  return {
    wholesaleCost: fromCents(costCents),
    supplierAmountPaid: fromCents(paidCents),
    supplierBalanceDue: fromCents(Math.max(0, costCents - paidCents)),
  };
}

function normalizeSaleSupplierBalances(sale: SupplierSale): SupplierSale {
  const items: SupplierSaleItem[] = sale.items.map((item): SupplierSaleItem => ({
    ...item,
    ...calculateItemSupplierBalance(item),
  }));
  const supplierAmountDueCents = items.reduce((sum: number, item) => sum + toCents(item.wholesaleCost), 0);
  const supplierAmountPaidCents = items.reduce((sum: number, item) => sum + toCents(item.supplierAmountPaid), 0);
  const supplierBalanceDueCents = Math.max(0, supplierAmountDueCents - supplierAmountPaidCents);
  const supplierPaymentStatus: SupplierSale["supplierPaymentStatus"] =
    supplierBalanceDueCents <= 0
      ? "PAID"
      : supplierAmountPaidCents > 0 ? "PARTIAL" : "UNPAID";

  return {
    ...sale,
    items,
    supplierAmountDue: fromCents(supplierAmountDueCents),
    supplierAmountPaid: fromCents(supplierAmountPaidCents),
    supplierBalanceDue: fromCents(supplierBalanceDueCents),
    supplierPaymentStatus,
  };
}



function errorMessage(error: unknown) {
  const value = error as { response?: { data?: { message?: string } } };
  return value.response?.data?.message ?? "Ocurrió un error. Inténtalo de nuevo.";
}

function paymentStatusLabel(status: SupplierSale["supplierPaymentStatus"]) {
  if (status === "PAID") return "Pagada al proveedor";
  if (status === "PARTIAL") return "Abono parcial";
  return "Pendiente al proveedor";
}

function paymentStatusClass(status: SupplierSale["supplierPaymentStatus"]) {
  if (status === "PAID") return "paid";
  if (status === "PARTIAL") return "partial";
  return "unpaid";
}

export default function SupplierPayablesPage() {
  const { data: user, isLoading: userLoading } = useCurrentUser();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedResellerId, setSelectedResellerId] = useState("");
  const [selectedSale, setSelectedSale] = useState<SupplierSale | null>(null);
  const [form, setForm] = useState<PaymentForm>({ saleId: "", amount: "", method: "TRANSFER", note: "", reference: "" });
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [formError, setFormError] = useState("");

  const isAdmin = user?.role === "ADMIN";

  const payables = useQuery({
    queryKey: ["supplier-payables", user?.id],
    enabled: !!user && (user.role === "ADMIN" || user.role === "RESELLER"),
    queryFn: async () => (await api.get<SupplierPayablesResponse>("/supplier-payables", {
      headers: { "Cache-Control": "no-cache" },
    })).data,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  const payments = useQuery({
    queryKey: ["supplier-payments", user?.id],
    enabled: !!user && (user.role === "ADMIN" || user.role === "RESELLER"),
    queryFn: async () => (await api.get<SupplierPaymentsResponse>("/supplier-payments", {
      headers: { "Cache-Control": "no-cache" },
    })).data.payments,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  const recordPayment = useMutation({
    mutationFn: async () => {
      return (await api.post("/supplier-payments", {
        saleId: form.saleId,
        amount: Number(form.amount),
        method: form.method,
        note: form.note,
        reference: form.reference,
      })).data;
    },
    onSuccess: async (result: { message?: string }) => {
      setSelectedSale(null);
      setActionMessage(result.message ?? (isAdmin ? "Abono registrado." : "Abono reportado para confirmación."));
      setActionError("");
      setFormError("");
      setForm({ saleId: "", amount: "", method: "TRANSFER", note: "", reference: "" });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["supplier-payables"] }),
        queryClient.invalidateQueries({ queryKey: ["supplier-payments"] }),
      ]);
    },
    onError: (error: unknown) => setFormError(errorMessage(error)),
  });

  const reviewPayment = useMutation({
    mutationFn: async ({ paymentId, action }: { paymentId: string; action: "CONFIRM" | "REJECT" }) =>
      (await api.patch("/supplier-payments/" + paymentId, { action })).data as { message?: string },
    onSuccess: async (result) => {
      setActionMessage(result.message ?? "El abono fue revisado.");
      setActionError("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["supplier-payables"] }),
        queryClient.invalidateQueries({ queryKey: ["supplier-payments"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] }),
      ]);
    },
    onError: (error: unknown) => { setActionError(errorMessage(error)); setActionMessage(""); },
  });

  // Recalcular también en el cliente a partir del costo unitario y cantidad. Esto evita
  // que un supplierBalanceDue antiguo (por ejemplo, $0.05) vuelva a mostrarse.
  const sales = useMemo(
    () => (payables.data?.sales ?? []).map(normalizeSaleSupplierBalances),
    [payables.data?.sales],
  );
  const summary = useMemo(() => {
    const totalDueCents = sales.reduce((sum: number, sale) => sum + toCents(sale.supplierAmountDue), 0);
    const totalPaidCents = sales.reduce((sum, sale) => sum + toCents(sale.supplierAmountPaid), 0);
    const balanceDueCents = sales.reduce((sum, sale) => sum + toCents(sale.supplierBalanceDue), 0);
    const owingResellers = new Set(
      sales.filter((sale) => sale.supplierBalanceDue > 0).map((sale) => sale.ownerId),
    );
    return {
      salesCount: sales.length,
      totalDue: fromCents(totalDueCents),
      totalPaid: fromCents(totalPaidCents),
      balanceDue: fromCents(balanceDueCents),
      resellersOwing: owingResellers.size,
    };
  }, [sales]);
  const paymentRows = payments.data ?? [];
  const pendingForSale = (saleId: string) => paymentRows.reduce((sum, payment) =>
    payment.saleId === saleId && (payment.status ?? "CONFIRMED") === "PENDING" ? sum + payment.amount : sum, 0);
  const availableToReport = (sale: SupplierSale) => Math.max(0, fromCents(toCents(sale.supplierBalanceDue) - toCents(pendingForSale(sale._id))));

  const filteredSales = useMemo(() => {
    const term = search.trim().toLowerCase();
    return sales.filter((sale) => {
      if (selectedResellerId && sale.ownerId !== selectedResellerId) return false;
      if (!term) return true;
      return [
        sale.saleNumber,
        sale.resellerName,
        sale.customerName,
        ...sale.items.map((item) => item.productTitle + " " + item.variantLabel + " " + item.productSku),
      ].join(" ").toLowerCase().includes(term);
    });
  }, [sales, search, selectedResellerId]);

  function openPayment(sale: SupplierSale) {
    setSelectedSale(sale);
    setForm({
      saleId: sale._id,
      amount: (isAdmin ? sale.supplierBalanceDue : availableToReport(sale)).toFixed(2),
      method: "TRANSFER",
      note: "",
      reference: "",
    });
    setFormError("");
    setActionMessage("");
    setActionError("");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    const amount = Number(form.amount);
    if (!form.saleId || !Number.isFinite(amount) || amount <= 0) {
      setFormError("Indica un importe de abono válido.");
      return;
    }
    const maximum = selectedSale ? (isAdmin ? selectedSale.supplierBalanceDue : availableToReport(selectedSale)) : 0;
    if (selectedSale && amount > maximum) {
      setFormError(isAdmin ? "El abono no puede superar la deuda de esta venta." : "El importe supera el saldo disponible después de tus reportes pendientes.");
      return;
    }
    recordPayment.mutate();
  }

  if (userLoading) {
    return <div className="dashboard-page"><div className="panel-card dashboard-loading">Cargando cuenta...</div></div>;
  }

  if (user?.role !== "ADMIN" && user?.role !== "RESELLER") {
    return (
      <div className="dashboard-page">
        <section className="page-heading"><div><span className="page-kicker">Control financiero</span><h1>Deudas de productos</h1><p>Necesitas una cuenta activa para consultar esta sección.</p></div></section>
      </div>
    );
  }

  const title = isAdmin ? "Cuentas por cobrar a revendedores" : "Mi deuda con el proveedor";
  const description = isAdmin
    ? "Controla qué vendió cada revendedor, cuánto te debe por costo mayorista y los abonos que ya recibiste."
    : "Consulta el costo mayorista de tus ventas, los abonos confirmados por el administrador y lo pendiente por pagar.";

  return (
    <div className="dashboard-page supplier-payables-page">
      <section className="page-heading">
        <div>
          <span className="page-kicker">Control financiero · {isAdmin ? "Plataforma" : "Proveedor"}</span>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </section>

      {actionMessage ? <div className="customers-success" role="status">{actionMessage}</div> : null}
      {actionError ? <div className="auth-error customers-message" role="alert">{actionError}</div> : null}

      <section className="supplier-summary-grid">
        <article className="stat-card">
          <span className="stat-icon"><ReceiptText size={18} /></span>
          <div className="stat-label">{isAdmin ? "Costo mayorista vendido" : "Costo de productos vendidos"}</div>
          <div className="stat-value">{money(summary?.totalDue ?? 0)}</div>
          <div className="stat-hint">{summary?.salesCount ?? 0} ventas registradas</div>
        </article>
        <article className="stat-card">
          <span className="stat-icon"><ArrowDownLeft size={18} /></span>
          <div className="stat-label">{isAdmin ? "Abonos recibidos" : "Pagado al proveedor"}</div>
          <div className="stat-value">{money(summary?.totalPaid ?? 0)}</div>
          <div className="stat-hint">Solo pagos confirmados por el administrador</div>
        </article>
        <article className="stat-card">
          <span className="stat-icon"><Clock3 size={18} /></span>
          <div className="stat-label">{isAdmin ? "Pendiente de cobrar" : "Pendiente con el proveedor"}</div>
          <div className="stat-value">{money(summary?.balanceDue ?? 0)}</div>
          <div className="stat-hint">{isAdmin ? (summary?.resellersOwing ?? 0) + " revendedores con deuda" : "Saldo mayorista por pagar"}</div>
        </article>
        <article className="stat-card">
          <span className="stat-icon"><ArrowUpRight size={18} /></span>
          <div className="stat-label">{isAdmin ? "Ganancia bruta revendedores" : "Ganancia estimada"}</div>
          <div className="stat-value">{money(sales.reduce((sum, sale) => sum + sale.grossProfit, 0))}</div>
          <div className="stat-hint">{isAdmin ? "Precio al cliente menos costo mayorista" : "Precio de venta menos costo mayorista"}</div>
        </article>
      </section>

      {isAdmin && (payables.data?.resellers.length ?? 0) > 0 ? (
        <section className="supplier-reseller-overview">
          <div className="supplier-overview-header">
            <div><span className="panel-kicker">Estado de cuentas</span><h2>Saldo por revendedor</h2><p>Selecciona un revendedor para ver sus ventas y productos pendientes.</p></div>
            {selectedResellerId ? <button type="button" className="secondary-button" onClick={() => setSelectedResellerId("")}>Ver todos</button> : null}
          </div>
          <div className="supplier-reseller-grid">
            {(payables.data?.resellers ?? []).map((reseller) => {
              const resellerSales = sales.filter((sale) => sale.ownerId === reseller.id);
              const due = fromCents(resellerSales.reduce((sum, sale) => sum + toCents(sale.supplierBalanceDue), 0));
              const cost = fromCents(resellerSales.reduce((sum, sale) => sum + toCents(sale.supplierAmountDue), 0));
              const paid = fromCents(resellerSales.reduce((sum, sale) => sum + toCents(sale.supplierAmountPaid), 0));
              const customerBalance = resellerSales.reduce((sum, sale) => sum + sale.customerBalanceDue, 0);
              return (
                <button
                  type="button"
                  key={reseller.id}
                  className={"supplier-reseller-card" + (selectedResellerId === reseller.id ? " active" : "")}
                  onClick={() => { setSelectedResellerId(selectedResellerId === reseller.id ? "" : reseller.id); setSearch(""); }}
                >
                  <span className="supplier-reseller-card-top"><strong>{reseller.name}</strong><span>{resellerSales.length} ventas</span></span>
                  <span className="supplier-reseller-debt-label">Debe al proveedor</span>
                  <strong className={due > 0 ? "supplier-reseller-balance due-text" : "supplier-reseller-balance"}>{money(due)}</strong>
                  <span className="supplier-reseller-stats">Costo vendido {money(cost)} · Abonado {money(paid)}</span>
                  <span className="supplier-reseller-stats">Sus clientes le deben {money(customerBalance)}</span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {!isAdmin ? (
        <div className="supplier-reseller-note">
          <HandCoins size={17} />
          <span>Registra aquí los abonos que enviaste. Solo se descontarán de tu deuda cuando el administrador confirme la recepción; los reportes pendientes reservan ese importe para evitar duplicarlo.</span>
        </div>
      ) : null}

      <section className="panel-card supplier-sales-panel">
        <div className="supplier-panel-header">
          <div><span className="panel-kicker">{isAdmin ? "Ventas de revendedores" : "Mis ventas"}</span><h2>Detalle de productos y saldos</h2></div>
          <label className="search-field supplier-search">
            <Search size={16} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar venta, vendedor o producto..." aria-label="Buscar deudas" />
          </label>
        </div>

        {payables.isLoading ? (
          <div className="dashboard-loading">Cargando las cuentas...</div>
        ) : payables.isError ? (
          <div className="dashboard-empty"><strong>No pudimos cargar las cuentas</strong><span>{errorMessage(payables.error)}</span><button type="button" className="secondary-button" onClick={() => void payables.refetch()}>Intentar de nuevo</button></div>
        ) : filteredSales.length ? (
          <div className="supplier-sale-list">
            {filteredSales.map((sale) => (
              <article className="supplier-sale-card" key={sale._id}>
                <div className="supplier-sale-header">
                  <div className="supplier-sale-meta">
                    <strong>{sale.saleNumber}</strong>
                    <span>{dateLabel(sale.createdAt)}</span>
                    <span className={"sale-payment-status " + paymentStatusClass(sale.supplierPaymentStatus)}>{paymentStatusLabel(sale.supplierPaymentStatus)}</span>
                  </div>
                  {isAdmin ? (
                    <div className="supplier-sale-seller"><span>Vendedor</span><strong>{sale.resellerName}</strong>{sale.resellerPhone ? <small>{sale.resellerPhone}</small> : null}</div>
                  ) : null}
                  <div className="supplier-sale-client"><span>Cliente final</span><strong>{sale.customerName}</strong>{sale.customerSnapshot?.phone ? <small>{sale.customerSnapshot.phone}</small> : null}</div>
                </div>

                <div className="supplier-line-list">
                  {sale.items.map((item, index) => (
                    <div className="supplier-line-row" key={item.variantId + "-" + index}>
                      <div className="supplier-line-main">
                        <strong>{item.productTitle}</strong>
                        <span>{item.variantLabel} · SKU {item.variantSku} · Cantidad: {item.quantity}</span>
                      </div>
                      <div className="supplier-line-financial"><span>Precio al cliente / unidad</span><strong>{money(item.unitPrice)}</strong><small>Venta total: {money(item.lineTotal)}</small></div>
                      <div className="supplier-line-financial"><span>Costo mayorista / unidad</span><strong>{money(item.wholesaleUnitCost)}</strong><small>Costo total: {money(item.wholesaleCost)}</small></div>
                      <div className="supplier-line-financial due"><span>{isAdmin ? "Deuda mayorista restante" : "Pendiente al proveedor"}</span><strong>{money(item.supplierBalanceDue)}</strong><small>Abonado: {money(item.supplierAmountPaid)} · Ganancia total: {money(item.resellerProfit)}</small></div>
                    </div>
                  ))}
                </div>

                <div className="supplier-sale-footer">
                  <div className="supplier-sale-footer-metric"><span>Total vendido al cliente</span><strong>{money(sale.total)}</strong></div>
                  <div className="supplier-sale-footer-metric"><span>Recibido por el vendedor</span><strong>{money(sale.amountCollectedFromCustomer)}</strong></div>
                  <div className="supplier-sale-footer-metric"><span>{isAdmin ? "Saldo que el cliente debe al revendedor" : "Saldo que tu cliente te debe"}</span><strong className={sale.customerBalanceDue > 0 ? "due-text" : ""}>{money(sale.customerBalanceDue)}</strong></div>
                  <div className="supplier-sale-footer-metric"><span>Costo mayorista de esta venta</span><strong>{money(sale.supplierAmountDue)}</strong></div>
                  <div className="supplier-sale-footer-metric"><span>Deuda con el proveedor</span><strong className={sale.supplierBalanceDue > 0 ? "due-text" : ""}>{money(sale.supplierBalanceDue)}</strong></div>
                  {sale.supplierBalanceDue > 0 && (isAdmin || availableToReport(sale) > 0) ? (
                    <button className="product-card-action primary supplier-record-button" type="button" onClick={() => openPayment(sale)}>
                      <CreditCard size={14} /> {isAdmin ? "Registrar abono recibido" : "Reportar abono enviado"}
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="dashboard-empty supplier-empty">
            <div className="dashboard-empty-icon"><CheckCircle2 size={20} /></div>
            <strong>{search ? "No hay resultados" : isAdmin ? "Todavía no hay ventas de revendedores" : "Todavía no tienes deudas registradas"}</strong>
            <span>{search ? "Prueba con otro nombre, producto o número de venta." : "Cuando se registre una venta de un revendedor, su costo mayorista aparecerá aquí."}</span>
          </div>
        )}
      </section>

      <section className="panel-card supplier-payments-panel">
        <div className="supplier-panel-header">
          <div><span className="panel-kicker">Historial</span><h2>{isAdmin ? "Abonos recibidos de revendedores" : "Abonos confirmados por el administrador"}</h2></div>
          <span className="supplier-payment-count">{paymentRows.length} movimientos</span>
        </div>
        {payments.isLoading ? (
          <div className="dashboard-loading">Cargando historial...</div>
        ) : payments.isError ? (
          <div className="dashboard-empty"><strong>No se pudo cargar el historial</strong><span>{errorMessage(payments.error)}</span></div>
        ) : paymentRows.length ? (
          <div className="supplier-payment-list">
            {paymentRows.map((payment) => (
              <div className="supplier-payment-row" key={payment._id}>
                <div className="supplier-payment-icon"><WalletCards size={17} /></div>
                <div className="supplier-payment-main">
                  <strong>{payment.saleNumber} · {payment.resellerName}</strong>
                  <span className={"sale-payment-status " + ((payment.status ?? "CONFIRMED") === "PENDING" ? "partial" : (payment.status ?? "CONFIRMED") === "REJECTED" ? "unpaid" : "paid")}>{(payment.status ?? "CONFIRMED") === "PENDING" ? "Pendiente de confirmación" : (payment.status ?? "CONFIRMED") === "REJECTED" ? "Rechazado" : "Confirmado"}</span>
                  <span>{dateLabel(payment.createdAt)} · {payment.methodLabel}{payment.receivedBy ? " · Recibió: " + payment.receivedBy : ""}{payment.reviewedBy ? " · Revisó: " + payment.reviewedBy : ""}</span>
                  {payment.reference ? <small>Referencia: {payment.reference}</small> : null}
                  {payment.allocations.length ? <small>{payment.allocations.map((item) => item.productTitle + " (" + item.variantLabel + "): " + money(item.amount)).join(" · ")}</small> : null}
                  {payment.note ? <small>{payment.note}</small> : null}
                </div>
                <div className="supplier-payment-actions">
                  <strong className="supplier-payment-amount">{money(payment.amount)}</strong>
                  {isAdmin && (payment.status ?? "CONFIRMED") === "PENDING" ? (
                    <div className="payment-modal-actions">
                      <button className="secondary-button" type="button" disabled={reviewPayment.isPending} onClick={() => reviewPayment.mutate({ paymentId: payment._id, action: "REJECT" })}>Rechazar</button>
                      <button className="primary-button" type="button" disabled={reviewPayment.isPending} onClick={() => reviewPayment.mutate({ paymentId: payment._id, action: "CONFIRM" })}>{reviewPayment.isPending && reviewPayment.variables?.paymentId === payment._id ? "Revisando..." : "Confirmar"}</button>
                    </div>
                  ) : null}
                  {payment.reviewNote ? <small>{payment.reviewNote}</small> : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="dashboard-empty supplier-empty">
            <div className="dashboard-empty-icon"><WalletCards size={20} /></div>
            <strong>Todavía no hay abonos registrados</strong>
            <span>Los pagos al proveedor se mostrarán aquí cuando el administrador confirme su recepción.</span>
          </div>
        )}
      </section>

      {selectedSale ? (
        <div className="image-modal-backdrop supplier-payment-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedSale(null); }}>
          <section className="payment-modal supplier-payment-modal" role="dialog" aria-modal="true" aria-labelledby="supplier-payment-title">
            <div className="panel-header">
              <div><span className="panel-kicker">{isAdmin ? "Confirmar dinero recibido" : "Reportar pago enviado"}</span><h2 id="supplier-payment-title">{isAdmin ? "Abono de " + selectedSale.resellerName : "Abono para el proveedor"}</h2><p>{selectedSale.saleNumber} · {selectedSale.customerName}</p></div>
              <button className="icon-button" type="button" onClick={() => setSelectedSale(null)} aria-label="Cerrar"><X size={17} /></button>
            </div>
            <div className="payment-modal-balance"><span>{isAdmin ? "Deuda pendiente de esta venta" : "Saldo disponible para reportar"}</span><strong>{money(isAdmin ? selectedSale.supplierBalanceDue : availableToReport(selectedSale))}</strong></div>
            <form onSubmit={handleSubmit}>
              <label className="field"><span>{isAdmin ? "Importe recibido (USD)" : "Importe que enviaste (USD)"}</span><input type="number" min="0.01" max={isAdmin ? selectedSale.supplierBalanceDue : availableToReport(selectedSale)} step="0.01" inputMode="decimal" required value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} /></label>
              <label className="field"><span>Método de pago</span><select required value={form.method} onChange={(event) => setForm({ ...form, method: event.target.value })}><option value="TRANSFER">Transferencia</option><option value="CASH">Efectivo</option><option value="CARD">Tarjeta</option><option value="OTHER">Otro</option></select></label>
              <label className="field"><span>Referencia bancaria / recibo (opcional)</span><input maxLength={160} value={form.reference} onChange={(event) => setForm({ ...form, reference: event.target.value })} placeholder="N.º de transferencia o referencia" /></label>
              <label className="field"><span>Nota adicional (opcional)</span><input maxLength={500} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="Fecha, banco o detalle del pago" /></label>
              {formError ? <div className="auth-error supplier-form-error" role="alert">{formError}</div> : null}
              <div className="payment-modal-actions">
                <button className="secondary-button" type="button" onClick={() => setSelectedSale(null)}>Cancelar</button>
                <button className="primary-button" type="submit" disabled={recordPayment.isPending}><CheckCircle2 size={15} /> {recordPayment.isPending ? "Guardando..." : isAdmin ? "Confirmar abono recibido" : "Reportar abono enviado"}</button>
              </div>
              <p className="sale-security-note">{isAdmin ? "Confirma solo el dinero que ya recibiste. El registro actualizará el saldo pendiente por producto." : "Este reporte no descuenta todavía tu deuda. El administrador deberá confirmar la recepción del dinero."}</p>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}
