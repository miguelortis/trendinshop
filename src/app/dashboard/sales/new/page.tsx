"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Minus, Plus, ShoppingCart, Trash2 } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";

type SaleOption = {
  variantId: string;
  productId: string;
  productTitle: string;
  productSku: string;
  variantLabel: string;
  variantSku: string;
  options: { name: string; value: string }[];
  stock: number;
  defaultUnitPrice: number;
  canEditPrice: boolean;
};
type Customer = { _id: string; documentId: string; firstName: string; lastName: string; phone: string };
type OptionsResponse = { ok: true; items: SaleOption[] };
type CustomersResponse = { ok: true; customers: Customer[] };
type DraftLine = { id: number; variantId: string; quantity: string; unitPrice: string };
type CreateSalePayload = {
  customerId?: string;
  items: { variantId: string; quantity: number; unitPrice?: number }[];
  initialPayment: number;
  paymentMethod: string;
  note: string;
};

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}
function errorMessage(error: unknown) {
  const value = error as { response?: { data?: { message?: string } } };
  return value.response?.data?.message ?? "Ocurrió un error al registrar la venta.";
}
function optionsText(item: SaleOption) {
  const attributes = item.options.map((option) => option.name + ": " + option.value).join(", ");
  return item.productTitle + " — " + item.variantLabel + (attributes ? " (" + attributes + ")" : "") +
    " · Stock " + item.stock + " · " + money(item.defaultUnitPrice);
}

export default function NewSalePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: user, isLoading: userLoading } = useCurrentUser();
  const isAdmin = user?.role === "ADMIN";
  const [customerId, setCustomerId] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ id: 1, variantId: "", quantity: "1", unitPrice: "" }]);
  const [nextLineId, setNextLineId] = useState(2);
  const [initialPayment, setInitialPayment] = useState("0");
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState("");

  const options = useQuery({
    queryKey: ["sale-options", user?.role],
    enabled: !!user && (user.role === "ADMIN" || user.role === "RESELLER"),
    queryFn: async () => (await api.get<OptionsResponse>("/sales/options")).data.items,
  });
  const customers = useQuery({
    queryKey: ["customers"],
    enabled: !!user,
    queryFn: async () => (await api.get<CustomersResponse>("/customers")).data.customers,
  });

  const selectedLines = useMemo(() => lines.map((line) => {
    const option = options.data?.find((item) => item.variantId === line.variantId);
    const qty = Number(line.quantity);
    const unitPrice = isAdmin ? Number(line.unitPrice) : option?.defaultUnitPrice ?? 0;
    return {
      ...line,
      option,
      quantity: Number.isInteger(qty) && qty > 0 ? qty : 0,
      unitPrice: Number.isFinite(unitPrice) && unitPrice > 0 ? unitPrice : 0,
      lineTotal: Number.isInteger(qty) && qty > 0 && Number.isFinite(unitPrice) && unitPrice > 0 ? qty * unitPrice : 0,
    };
  }), [lines, options.data, isAdmin]);

  const total = selectedLines.reduce((sum, line) => sum + line.lineTotal, 0);
  const paymentValue = Number(initialPayment);
  const paymentIsValid = Number.isFinite(paymentValue) && paymentValue >= 0 && paymentValue <= total;
  const hasValidLines = selectedLines.length > 0 && selectedLines.every(
    (line) => line.option && line.quantity > 0 && line.quantity <= (line.option?.stock ?? 0) && line.unitPrice > 0,
  );

  const create = useMutation({
    mutationFn: async (payload: CreateSalePayload) => (await api.post("/sales", payload)).data,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales"] }),
        queryClient.invalidateQueries({ queryKey: ["inventory"] }),
        queryClient.invalidateQueries({ queryKey: ["sale-options"] }),
        queryClient.invalidateQueries({ queryKey: ["reseller-catalog"] }),
      ]);
      router.push("/dashboard/sales");
      router.refresh();
    },
    onError: (error: unknown) => setFormError(errorMessage(error)),
  });

  function updateLine(id: number, updates: Partial<DraftLine>) {
    setLines((current) => current.map((line) => line.id === id ? { ...line, ...updates } : line));
  }

  function chooseVariant(id: number, variantId: string) {
    const option = options.data?.find((item) => item.variantId === variantId);
    updateLine(id, { variantId, unitPrice: option ? String(option.defaultUnitPrice) : "" });
    setFormError("");
  }

  function addLine() {
    setLines((current) => [...current, { id: nextLineId, variantId: "", quantity: "1", unitPrice: "" }]);
    setNextLineId((value) => value + 1);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    if (!hasValidLines) {
      setFormError("Revisa los productos y cantidades. La cantidad no puede superar el stock disponible.");
      return;
    }
    if (!Number.isFinite(paymentValue) || paymentValue < 0 || paymentValue > total) {
      setFormError("El pago inicial debe estar entre cero y el total de la venta.");
      return;
    }

    create.mutate({
      customerId: customerId || undefined,
      items: selectedLines.map((line) => ({
        variantId: line.variantId,
        quantity: line.quantity,
        ...(isAdmin ? { unitPrice: line.unitPrice } : {}),
      })),
      initialPayment: paymentValue,
      paymentMethod,
      note: note.trim(),
    });
  }

  if (userLoading) return <div className="dashboard-page"><div className="panel-card dashboard-loading">Cargando tu cuenta...</div></div>;

  return (
    <div className="dashboard-page new-sale-page">
      <section className="page-heading">
        <div>
          <span className="page-kicker">Operación comercial</span>
          <h1>Registrar venta</h1>
          <p>Selecciona cliente, productos y el importe recibido. El stock se actualizará al confirmar.</p>
        </div>
        <Link href="/dashboard/sales" className="secondary-button"><ArrowLeft size={15} /> Volver a ventas</Link>
      </section>

      {options.isLoading ? <div className="panel-card dashboard-loading">Cargando productos disponibles...</div> : null}
      {options.isError ? (
        <div className="panel-card dashboard-empty compact">
          <strong>No pudimos cargar los productos</strong>
          <span>{errorMessage(options.error)}</span>
          <button type="button" className="secondary-button" onClick={() => void options.refetch()}>Intentar de nuevo</button>
        </div>
      ) : null}

      {!options.isLoading && !options.isError && !options.data?.length ? (
        <div className="panel-card dashboard-empty sale-no-products">
          <div className="dashboard-empty-icon"><ShoppingCart size={20} /></div>
          <strong>No hay variantes disponibles para vender</strong>
          <span>{isAdmin ? "Crea productos con stock antes de registrar una venta." : "Añade productos con existencias a tu catálogo personal para comenzar."}</span>
          <Link href={isAdmin ? "/dashboard/products" : "/dashboard/catalog"} className="secondary-action">
            {isAdmin ? "Ir a productos" : "Abrir mi catálogo"}
          </Link>
        </div>
      ) : null}

      {options.data?.length ? (
        <form className="sale-form-layout" onSubmit={handleSubmit}>
          <div className="sale-form-main">
            <section className="panel-card sale-form-panel">
              <div className="panel-header">
                <div><span className="panel-kicker">Paso 1</span><h2>Cliente</h2></div>
              </div>
              <label className="field">
                <span>Seleccionar cliente (opcional)</span>
                <select value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
                  <option value="">Cliente ocasional / sin ficha</option>
                  {(customers.data ?? []).map((customer) => (
                    <option key={customer._id} value={customer._id}>
                      {customer.firstName} {customer.lastName} — {customer.documentId} · {customer.phone}
                    </option>
                  ))}
                </select>
              </label>
              {customers.isError ? <p className="sale-inline-note">No pudimos cargar tu directorio. Puedes registrar la venta sin asociar un cliente.</p> : null}
              <Link href="/dashboard/customers" className="sale-inline-link">Crear o gestionar clientes</Link>
            </section>

            <section className="panel-card sale-form-panel">
              <div className="panel-header">
                <div><span className="panel-kicker">Paso 2</span><h2>Productos de la venta</h2></div>
                <span className="sale-item-count">{lines.length} {lines.length === 1 ? "artículo" : "artículos"}</span>
              </div>
              <div className="sale-line-list">
                {selectedLines.map((line, index) => (
                  <article className="sale-line-card" key={line.id}>
                    <div className="sale-line-heading">
                      <span>Artículo {index + 1}</span>
                      {lines.length > 1 ? (
                        <button type="button" className="sale-remove-line" onClick={() => setLines((current) => current.filter((item) => item.id !== line.id))} aria-label="Quitar producto">
                          <Trash2 size={14} /> Quitar
                        </button>
                      ) : null}
                    </div>
                    <label className="field">
                      <span>Producto / variante *</span>
                      <select required value={line.variantId} onChange={(event) => chooseVariant(line.id, event.target.value)}>
                        <option value="">Selecciona una variante</option>
                        {(options.data ?? []).map((option) => (
                          <option key={option.variantId} value={option.variantId}>
                            {optionsText(option)}
                          </option>
                        ))}
                      </select>
                    </label>
                    {line.option ? (
                      <div className="sale-stock-hint">
                        <span>SKU {line.option.variantSku}</span>
                        <strong>{line.option.stock} disponibles</strong>
                      </div>
                    ) : null}
                    <div className="sale-line-bottom">
                      <label className="field sale-quantity-field">
                        <span>Cantidad *</span>
                        <input type="number" min="1" max={line.option?.stock ?? undefined} step="1" required value={line.quantity} onChange={(event) => updateLine(line.id, { quantity: event.target.value })} />
                      </label>
                      <label className="field sale-price-field">
                        <span>{isAdmin ? "Precio unitario (USD) *" : "Tu precio unitario"}</span>
                        <input type="number" min="0.01" step="0.01" inputMode="decimal" required readOnly={!isAdmin} value={isAdmin ? line.unitPrice : line.option ? String(line.option.defaultUnitPrice) : ""} onChange={(event) => updateLine(line.id, { unitPrice: event.target.value })} />
                      </label>
                      <div className="sale-line-total"><span>Importe</span><strong>{money(line.lineTotal)}</strong></div>
                    </div>
                    {!isAdmin && line.option ? <p className="sale-inline-note">Precio establecido en tu catálogo personal.</p> : null}
                  </article>
                ))}
              </div>
              <button type="button" className="secondary-button sale-add-line" onClick={addLine} disabled={lines.length >= 30}>
                <Plus size={15} /> Añadir otro producto
              </button>
            </section>

            <section className="panel-card sale-form-panel">
              <div className="panel-header">
                <div><span className="panel-kicker">Paso 3</span><h2>Pago inicial</h2></div>
              </div>
              <div className="sale-payment-fields">
                <label className="field">
                  <span>Importe recibido (USD)</span>
                  <input type="number" min="0" max={total.toFixed(2)} step="0.01" inputMode="decimal" value={initialPayment} onChange={(event) => setInitialPayment(event.target.value)} />
                </label>
                <label className="field">
                  <span>Método de pago</span>
                  <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>
                    <option value="CASH">Efectivo</option>
                    <option value="TRANSFER">Transferencia</option>
                    <option value="CARD">Tarjeta</option>
                    <option value="OTHER">Otro</option>
                  </select>
                </label>
              </div>
              <label className="field">
                <span>Nota (opcional)</span>
                <textarea rows={3} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Referencia del pago, entrega u observaciones..." />
              </label>
              <p className="sale-inline-note">Si el importe recibido es menor que el total, la diferencia quedará pendiente de cobro.</p>
            </section>
          </div>

          <aside className="sale-summary-column">
            <section className="panel-card sale-summary-card">
              <span className="panel-kicker">Resumen</span>
              <h2>Total de la venta</h2>
              <div className="sale-summary-total">{money(total)}</div>
              <div className="sale-summary-row"><span>Artículos</span><strong>{selectedLines.reduce((sum, line) => sum + line.quantity, 0)}</strong></div>
              <div className="sale-summary-row"><span>Recibido ahora</span><strong>{money(Number.isFinite(paymentValue) ? paymentValue : 0)}</strong></div>
              <div className="sale-summary-row due"><span>Pendiente</span><strong>{money(Math.max(0, total - (Number.isFinite(paymentValue) ? paymentValue : 0)))}</strong></div>
              {formError ? <div className="auth-error sale-form-error">{formError}</div> : null}
              <button type="submit" className="primary-button sale-submit" disabled={create.isPending || !hasValidLines || total <= 0 || !paymentIsValid}>
                <ShoppingCart size={16} /> {create.isPending ? "Registrando venta..." : "Confirmar venta"}
              </button>
              <p className="sale-security-note">Al confirmar, se guarda la venta, el registro del pago inicial y los movimientos de stock.</p>
            </section>
          </aside>
        </form>
      ) : null}
    </div>
  );
}
