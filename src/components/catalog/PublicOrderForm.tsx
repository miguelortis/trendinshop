"use client";

import { useState, type FormEvent } from "react";
import { CheckCircle2, ClipboardList, LoaderCircle, ShoppingBag } from "lucide-react";
import { api } from "@/lib/api/client";

type OrderVariant = { id: string; label: string; stock: number };
type Props = {
  resellerId: string;
  sellerName: string;
  sellerPhone: string;
  productId: string;
  productTitle: string;
  sellingPrice: number;
  variants: OrderVariant[];
};

type ErrorShape = { response?: { data?: { message?: string } } };
type OrderResponse = {
  ok: true;
  order: { orderNumber: string; subtotal: number };
  message: string;
};

function money(value: number) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "USD" }).format(value);
}

function phoneDigits(value: string) {
  return value.replace(/[^0-9]/g, "");
}

export function PublicOrderForm({
  resellerId,
  sellerName,
  sellerPhone,
  productId,
  productTitle,
  sellingPrice,
  variants,
}: Props) {
  const availableVariants = variants.filter((variant) => variant.stock > 0);
  const [variantId, setVariantId] = useState(availableVariants[0]?.id ?? "");
  const [quantity, setQuantity] = useState("1");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<OrderResponse["order"] | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const variant = availableVariants.find((item) => item.id === variantId);
  const amount = Number(quantity);
  const validQuantity = Number.isInteger(amount) && amount > 0 && amount <= Math.min(100, variant?.stock ?? 0);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess(null);

    if (!variant) {
      setError("Selecciona una variante disponible.");
      return;
    }
    if (!validQuantity) {
      setError("Revisa la cantidad. Máximo disponible: " + variant.stock + ".");
      return;
    }

    setSubmitting(true);
    try {
      const response = await api.post<OrderResponse>("/public-orders", {
        resellerId,
        productId,
        variantId,
        quantity: amount,
        firstName,
        lastName,
        phone,
        email,
        address,
        note,
      });
      setSuccess(response.data.order);
    } catch (caught) {
      const value = caught as ErrorShape;
      setError(value.response?.data?.message ?? "No pudimos enviar el pedido. Inténtalo de nuevo.");
    } finally {
      setSubmitting(false);
    }
  }

  const contactNumber = phoneDigits(sellerPhone);
  const whatsAppLink = success && contactNumber
    ? "https://wa.me/" + contactNumber + "?text=" + encodeURIComponent(
        "Hola " + sellerName + ", acabo de enviar el pedido " + success.orderNumber +
        " de " + productTitle + ". ¿Podemos confirmar disponibilidad y entrega?",
      )
    : "";

  if (!availableVariants.length) {
    return (
      <section className="public-order-panel">
        <h2>Solicitar este producto</h2>
        <p className="public-order-muted">Por el momento no hay variantes con existencias disponibles.</p>
      </section>
    );
  }

  if (success) {
    return (
      <section className="public-order-panel public-order-success" aria-live="polite">
        <span className="public-order-success-icon"><CheckCircle2 size={22} /></span>
        <span className="public-catalog-kicker">SOLICITUD REGISTRADA</span>
        <h2>¡Gracias por tu pedido!</h2>
        <p>{"Tu número de pedido es " + success.orderNumber + ". El vendedor revisará el inventario y confirmará los detalles contigo."}</p>
        <div className="public-order-success-total"><span>Total estimado</span><strong>{money(success.subtotal)}</strong></div>
        {whatsAppLink ? (
          <a className="public-order-whatsapp" href={whatsAppLink} target="_blank" rel="noreferrer">Confirmar por WhatsApp</a>
        ) : null}
        <button type="button" className="public-order-secondary" onClick={() => setSuccess(null)}>Enviar otro pedido</button>
      </section>
    );
  }

  return (
    <section className="public-order-panel" id="solicitar-producto">
      <div className="public-order-panel-heading">
        <span className="public-order-panel-icon"><ShoppingBag size={18} /></span>
        <div><h2>Solicitar este producto</h2><p>Envía tus datos para que {sellerName || "el vendedor"} confirme tu pedido.</p></div>
      </div>

      <div className="public-order-product-summary">
        <span>{productTitle}</span>
        <strong>{money(sellingPrice)} <small>/ unidad</small></strong>
      </div>

      <form onSubmit={handleSubmit} className="public-order-form">
        <label className="public-order-field">
          <span>Variante</span>
          <select required value={variantId} onChange={(event) => setVariantId(event.target.value)}>
            {availableVariants.map((item) => (
              <option value={item.id} key={item.id}>{item.label} · {item.stock} disponibles</option>
            ))}
          </select>
        </label>

        <label className="public-order-field">
          <span>Cantidad</span>
          <input type="number" required min="1" max={Math.min(100, variant?.stock ?? 1)} step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
        </label>

        <div className="public-order-form-grid">
          <label className="public-order-field">
            <span>Nombre *</span>
            <input required maxLength={100} autoComplete="given-name" value={firstName} onChange={(event) => setFirstName(event.target.value)} placeholder="Tu nombre" />
          </label>
          <label className="public-order-field">
            <span>Apellido</span>
            <input maxLength={100} autoComplete="family-name" value={lastName} onChange={(event) => setLastName(event.target.value)} placeholder="Tu apellido" />
          </label>
        </div>

        <label className="public-order-field">
          <span>Teléfono / WhatsApp *</span>
          <input required maxLength={40} type="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Número de contacto" />
        </label>

        <label className="public-order-field">
          <span>Correo electrónico (opcional)</span>
          <input maxLength={200} type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="tu@correo.com" />
        </label>

        <label className="public-order-field">
          <span>Dirección o lugar de entrega (opcional)</span>
          <input maxLength={300} autoComplete="street-address" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Indica dónde entregar" />
        </label>

        <label className="public-order-field">
          <span>Nota (opcional)</span>
          <textarea maxLength={500} rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Detalles adicionales del pedido" />
        </label>

        <div className="public-order-total"><span>Total estimado</span><strong>{money(validQuantity ? sellingPrice * amount : sellingPrice)}</strong></div>
        {error ? <p className="public-order-error" role="alert">{error}</p> : null}
        <button className="public-order-submit" type="submit" disabled={submitting || !variant}>
          {submitting ? <LoaderCircle size={17} className="public-order-spinner" /> : <ClipboardList size={17} />}
          {submitting ? "Enviando pedido..." : "Enviar solicitud de pedido"}
        </button>
        <p className="public-order-disclaimer">Este formulario no realiza un cobro ni reserva inventario. El vendedor confirmará precio, existencias y entrega antes de registrar la venta.</p>
      </form>
    </section>
  );
}
