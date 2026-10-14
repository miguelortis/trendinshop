"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowLeft, CheckCircle2, ClipboardList, LoaderCircle, Minus, Plus, Share2, ShoppingBag, Trash2 } from "lucide-react";
import { api } from "@/lib/api/client";
import { PublicStorefrontHeader } from "@/components/catalog/PublicStorefrontHeader";
import {
  type PublicCartDraftItem,
  type PublicCartViewItem,
  readPublicCart,
  writePublicCart,
} from "@/lib/public-cart-client";

const CUSTOMER_SESSION_KEY = "trendinshop:customer-session";

type Props = {
  resellerId: string;
  storeSlug: string;
  storeName: string;
  sellerPhone: string;
  logoUrl: string;
  shareToken: string;
};
type CartResponse = {
  ok: true;
  token?: string;
  seller: { id: string; name: string; phone: string; slug: string };
  items: PublicCartViewItem[];
  subtotal: number;
  expiresAt?: string;
};
type CustomerForm = {
  documentId: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  address: string;
  note: string;
};
type CustomerLookupResponse = {
  ok: true;
  customer: Omit<CustomerForm, "note">;
};
type OrderResponse = {
  ok: true;
  order: { orderNumber: string; subtotal: number };
  customerSessionToken: string;
  message: string;
};
type ErrorShape = { response?: { data?: { message?: string } } };
type StoredCustomerSession = { documentId: string; token: string };

const blankCustomer: CustomerForm = {
  documentId: "",
  firstName: "",
  lastName: "",
  phone: "",
  email: "",
  address: "",
  note: "",
};

function messageFrom(error: unknown, fallback: string) {
  return (error as ErrorShape)?.response?.data?.message ?? fallback;
}
function money(value: number) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "USD" }).format(value);
}
function normalizeDocumentId(value: string) {
  return value.trim().toUpperCase().replace(/[.\s-]/g, "");
}
function draft(items: PublicCartViewItem[]): PublicCartDraftItem[] {
  return items.map(({ productId, variantId, quantity }) => ({ productId, variantId, quantity }));
}
function totalQuantity(items: PublicCartViewItem[]) {
  return items.reduce((sum, item) => sum + item.quantity, 0);
}

export function PublicCartExperience({ resellerId, storeSlug, storeName, sellerPhone, logoUrl, shareToken }: Props) {
  const [items, setItems] = useState<PublicCartViewItem[]>([]);
  const [loadingCart, setLoadingCart] = useState(true);
  const [busy, setBusy] = useState(false);
  const [cartError, setCartError] = useState("");
  const [cartMessage, setCartMessage] = useState("");
  const [shareMessage, setShareMessage] = useState("");
  const [sharedUrl, setSharedUrl] = useState("");
  const [customer, setCustomer] = useState<CustomerForm>(blankCustomer);
  const [customerToken, setCustomerToken] = useState("");
  const [storedCustomerSession, setStoredCustomerSession] = useState<StoredCustomerSession | null>(null);
  const [trustedCustomer, setTrustedCustomer] = useState(false);
  const [rememberData, setRememberData] = useState(!shareToken);
  const [lookupMessage, setLookupMessage] = useState("");
  const [orderError, setOrderError] = useState("");
  const [success, setSuccess] = useState<{ orderNumber: string; subtotal: number } | null>(null);

  const subtotal = useMemo(
    () => items.reduce((sum, item) => sum + item.lineTotal, 0),
    [items],
  );
  const hasUnavailable = items.some((item) => !item.available || item.stock < item.quantity);
  const canSubmit = items.length > 0 && !hasUnavailable && !loadingCart && !busy && !success;

  const refreshCart = useCallback(async (cartItems: PublicCartDraftItem[]) => {
    if (!cartItems.length) {
      setItems([]);
      writePublicCart(resellerId, []);
      return;
    }

    const response = await api.post<CartResponse>("/public-carts/validate", {
      resellerId,
      items: cartItems,
    });
    setItems(response.data.items);
    writePublicCart(resellerId, draft(response.data.items));
  }, [resellerId]);

  useEffect(() => {
    let active = true;
    setLoadingCart(true);
    setCartError("");

    async function load() {
      try {
        if (shareToken) {
          const response = await api.get<CartResponse>("/public-carts/share", { params: { token: shareToken } });
          if (response.data.seller.id !== resellerId) {
            throw new Error("Este enlace pertenece a otra tienda. Abre el carrito desde la tienda correcta.");
          }
          if (!active) return;
          setItems(response.data.items);
          writePublicCart(resellerId, draft(response.data.items));
          setRememberData(false);
        } else {
          const current = readPublicCart(resellerId);
          if (current.length) {
            await refreshCart(current);
          } else if (active) {
            setItems([]);
          }
        }
      } catch (error) {
        if (active) setCartError(messageFrom(error, "No pudimos cargar el carrito. Recarga la página para intentarlo de nuevo."));
      } finally {
        if (active) setLoadingCart(false);
      }
    }

    void load();
    return () => { active = false; };
  }, [resellerId, shareToken, refreshCart]);

  const lookupCustomer = useCallback(async (documentId: string, token: string) => {
    if (!documentId || !token) return false;
    setLookupMessage("");
    try {
      const response = await api.get<CustomerLookupResponse>("/public-customers/lookup", {
        params: { documentId, token },
      });
      const saved = response.data.customer;
      setCustomer((current) => ({
        ...current,
        documentId: saved.documentId,
        firstName: saved.firstName,
        lastName: saved.lastName,
        phone: saved.phone,
        email: saved.email,
        address: saved.address,
      }));
      setCustomerToken(token);
      setTrustedCustomer(true);
      setLookupMessage("Reconocimos tus datos guardados. Los datos personales principales están protegidos.");
      return true;
    } catch {
      setTrustedCustomer(false);
      setCustomerToken("");
      setLookupMessage("No encontramos datos guardados en este dispositivo. Completa tus datos para continuar.");
      return false;
    }
  }, []);

  useEffect(() => {
    setRememberData(!shareToken);
    try {
      const raw = localStorage.getItem(CUSTOMER_SESSION_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as StoredCustomerSession;
      if (!saved.documentId || !saved.token) return;
      // Se conserva el token en memoria, pero no se muestra el perfil hasta que el comprador
      // escriba su cédula y la coincidencia se compruebe expresamente.
      setStoredCustomerSession(saved);
    } catch {
      // Si el almacenamiento del navegador no se puede leer, el cliente puede completar el formulario.
    }
  }, [shareToken]);

  function changeQuantity(variantId: string, nextQuantity: number) {
    const existing = items.find((item) => item.variantId === variantId);
    if (!existing) return;
    if (nextQuantity < 1) {
      removeItem(variantId);
      return;
    }
    const bounded = Math.min(100, existing.stock || 100, nextQuantity);
    const next = items.map((item) => item.variantId === variantId ? { ...item, quantity: bounded, lineTotal: item.unitPrice * bounded, available: item.stock >= bounded } : item);
    setItems(next);
    writePublicCart(resellerId, draft(next));
    setCartMessage("");
  }

  function removeItem(variantId: string) {
    const next = items.filter((item) => item.variantId !== variantId);
    setItems(next);
    writePublicCart(resellerId, draft(next));
    setCartMessage("");
  }

  async function updatePrices() {
    setCartError("");
    setCartMessage("");
    setBusy(true);
    try {
      await refreshCart(draft(items));
      setCartMessage("Precios y disponibilidad actualizados.");
    } catch (error) {
      setCartError(messageFrom(error, "No pudimos actualizar el carrito."));
    } finally {
      setBusy(false);
    }
  }

  async function shareCart() {
    setShareMessage("");
    setCartError("");
    if (!items.length) {
      setCartError("Agrega al menos un producto antes de compartir el carrito.");
      return;
    }
    if (hasUnavailable) {
      setCartError("Corrige las cantidades o elimina los productos sin existencias antes de compartir.");
      return;
    }
    setBusy(true);
    try {
      const response = await api.post<CartResponse>("/public-carts/share", {
        resellerId,
        items: draft(items),
      });
      const link = window.location.origin + "/tienda/" + storeSlug + "/carrito?share=" + response.data.token;
      setSharedUrl(link);
      setItems(response.data.items);
      writePublicCart(resellerId, draft(response.data.items));
      try {
        await navigator.clipboard.writeText(link);
        setShareMessage("Enlace copiado. Cualquier persona con el enlace podrá revisar el carrito; caduca en 30 días.");
      } catch {
        setShareMessage("Enlace listo. Cópialo desde el campo de abajo para enviarlo al cliente; caduca en 30 días.");
      }
    } catch (error) {
      setCartError(messageFrom(error, "No pudimos compartir el carrito. Comprueba los permisos del navegador para copiar enlaces."));
    } finally {
      setBusy(false);
    }
  }

  function updateCustomer<K extends keyof CustomerForm>(key: K, value: CustomerForm[K]) {
    setCustomer((current) => ({ ...current, [key]: value }));
    setOrderError("");
  }

  async function handleDocumentBlur() {
    const value = normalizeDocumentId(customer.documentId);
    const saved = storedCustomerSession;
    if (!value || !saved?.token || normalizeDocumentId(saved.documentId) !== value) return;
    await lookupCustomer(value, saved.token);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOrderError("");
    if (!items.length) {
      setOrderError("Agrega al menos un producto al carrito.");
      return;
    }
    if (hasUnavailable) {
      setOrderError("Hay productos sin existencias suficientes. Ajusta las cantidades antes de enviar el pedido.");
      return;
    }

    setBusy(true);
    try {
      const response = await api.post<OrderResponse>("/public-orders", {
        resellerId,
        items: draft(items),
        customer: {
          documentId: normalizeDocumentId(customer.documentId),
          firstName: customer.firstName,
          lastName: customer.lastName,
          phone: customer.phone,
          email: customer.email,
          address: customer.address,
        },
        customerSessionToken: trustedCustomer ? customerToken : undefined,
        rememberCustomer: rememberData,
        note: customer.note,
      });
      setSuccess(response.data.order);
      setItems([]);
      writePublicCart(resellerId, []);
      if (rememberData && response.data.customerSessionToken) {
        try {
          const nextSession = {
            documentId: normalizeDocumentId(customer.documentId),
            token: response.data.customerSessionToken,
          } satisfies StoredCustomerSession;
          localStorage.setItem(CUSTOMER_SESSION_KEY, JSON.stringify(nextSession));
          setStoredCustomerSession(nextSession);
        } catch {
          // El pedido ya se registró; si no se puede guardar localmente, la próxima vez se completarán los datos manualmente.
        }
      } else {
        try {
          const raw = localStorage.getItem(CUSTOMER_SESSION_KEY);
          if (raw && normalizeDocumentId((JSON.parse(raw) as StoredCustomerSession).documentId) === normalizeDocumentId(customer.documentId)) {
            localStorage.removeItem(CUSTOMER_SESSION_KEY);
            setStoredCustomerSession(null);
          }
        } catch {
          // No bloquea el pedido.
        }
      }
    } catch (error) {
      setOrderError(messageFrom(error, "No pudimos enviar la solicitud. Revisa los datos e inténtalo de nuevo."));
    } finally {
      setBusy(false);
    }
  }

  const sellerDigits = sellerPhone.replace(/[^0-9]/g, "");
  const whatsappLink = success && sellerDigits
    ? "https://wa.me/" + sellerDigits + "?text=" + encodeURIComponent(
        "Hola " + storeName + ", envié el pedido " + success.orderNumber + ". ¿Podemos confirmar disponibilidad y entrega?",
      )
    : "";

  if (success) {
    return (
      <main className="public-catalog-shell">
        <div className="public-catalog-container">
          <PublicStorefrontHeader resellerId={resellerId} storeSlug={storeSlug} storeName={storeName} logoUrl={logoUrl} />
          <div className="public-cart-result">
            <span className="public-cart-result-icon"><CheckCircle2 size={28} /></span>
            <span className="public-catalog-kicker">SOLICITUD REGISTRADA</span>
            <h1>¡Gracias por tu pedido!</h1>
            <p>Tu solicitud <strong>{success.orderNumber}</strong> contiene todos los productos del carrito. El vendedor confirmará existencias, precio final y entrega antes de registrar la venta.</p>
            <div className="public-cart-result-total"><span>Total estimado</span><strong>{money(success.subtotal)}</strong></div>
            {whatsappLink ? <a className="public-order-whatsapp" href={whatsappLink} target="_blank" rel="noreferrer">Continuar por WhatsApp</a> : null}
            <Link href={"/tienda/" + storeSlug} className="public-product-back-link"><ArrowLeft size={14} /> Volver a la tienda</Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="public-catalog-shell public-cart-page">
      <div className="public-catalog-container">
        <PublicStorefrontHeader resellerId={resellerId} storeSlug={storeSlug} storeName={storeName} logoUrl={logoUrl} />
        <nav className="public-cart-breadcrumb">
          <Link href={"/tienda/" + storeSlug}><ArrowLeft size={14} /> Seguir comprando</Link>
          <span>Carrito de {storeName}</span>
        </nav>

        <section className="public-catalog-hero public-cart-hero">
          <span className="public-catalog-kicker">TU COMPRA</span>
          <h1>Carrito de compras</h1>
          <p>Revisa los productos, las cantidades y el total estimado. No se realiza ningún cobro hasta que el vendedor confirme la compra.</p>
        </section>

        {cartError ? <div className="public-cart-feedback error" role="alert">{cartError}</div> : null}
        {cartMessage ? <div className="public-cart-feedback success" role="status">{cartMessage}</div> : null}
        {shareMessage ? <div className="public-cart-feedback success" role="status">{shareMessage}</div> : null}
        {sharedUrl ? <div className="public-cart-share-link"><label htmlFor="public-cart-shared-url">Enlace compartible</label><input id="public-cart-shared-url" value={sharedUrl} readOnly onFocus={(event) => event.currentTarget.select()} /><button type="button" className="public-cart-secondary-button" onClick={() => { void navigator.clipboard.writeText(sharedUrl).then(() => setShareMessage("Enlace copiado." )).catch(() => setShareMessage("Selecciona el enlace y cópialo manualmente.")); }}>Copiar de nuevo</button></div> : null}

        {loadingCart ? (
          <div className="public-cart-loading"><LoaderCircle className="public-order-spinner" size={24} /> Cargando carrito...</div>
        ) : !items.length ? (
          <section className="public-cart-empty">
            <span className="public-cart-empty-icon"><ShoppingBag size={28} /></span>
            <h2>Tu carrito está vacío</h2>
            <p>Explora el catálogo y añade los productos que te interesan. Después podrás enviar una única solicitud con todos ellos.</p>
            <Link href={"/tienda/" + storeSlug} className="public-order-submit"><ShoppingBag size={16} /> Explorar productos</Link>
          </section>
        ) : (
          <div className="public-cart-layout">
            <section className="public-cart-items-panel">
              <div className="public-cart-panel-heading">
                <div><span className="panel-kicker">Resumen</span><h2>{items.length} {items.length === 1 ? "variante" : "variantes"} · {totalQuantity(items)} unidades</h2></div>
                <button type="button" className="public-cart-secondary-button" onClick={() => void updatePrices()} disabled={busy}><LoaderCircle size={14} className={busy ? "public-order-spinner" : ""} /> Actualizar precios</button>
              </div>
              <div className="public-cart-items-list">
                {items.map((item) => (
                  <article className={"public-cart-item" + (!item.available ? " unavailable" : "")} key={item.variantId}>
                    <div className="public-cart-item-image"><ShoppingBag size={20} /></div>
                    <div className="public-cart-item-copy">
                      <strong>{item.productTitle}</strong>
                      <span>{item.variantLabel}</span>
                      {item.productSku ? <small>SKU: {item.productSku}</small> : null}
                      {!item.available ? <em>{item.stock <= 0 ? "No disponible actualmente" : "Solo quedan " + item.stock + " unidades"}</em> : null}
                      <div className="public-cart-item-mobile-total">{money(item.lineTotal)}</div>
                    </div>
                    <div className="public-cart-item-unit">{money(item.unitPrice)} <small>/ unidad</small></div>
                    <div className="public-cart-quantity-picker">
                      <button type="button" aria-label={"Reducir cantidad de " + item.productTitle} onClick={() => changeQuantity(item.variantId, item.quantity - 1)}><Minus size={13} /></button>
                      <span>{item.quantity}</span>
                      <button type="button" aria-label={"Aumentar cantidad de " + item.productTitle} onClick={() => changeQuantity(item.variantId, item.quantity + 1)} disabled={!item.available || item.quantity >= Math.min(100, item.stock)}><Plus size={13} /></button>
                    </div>
                    <strong className="public-cart-item-total">{money(item.lineTotal)}</strong>
                    <button type="button" className="public-cart-remove" onClick={() => removeItem(item.variantId)} aria-label={"Eliminar " + item.productTitle}><Trash2 size={15} /></button>
                  </article>
                ))}
              </div>
              <div className="public-cart-share-area">
                <div><strong>¿Quieres que alguien revise esta compra?</strong><p>Comparte un enlace del carrito con todos los artículos. El enlace caduca en 30 días.</p></div>
                <button type="button" onClick={() => void shareCart()} className="public-cart-secondary-button" disabled={busy || hasUnavailable}><Share2 size={15} /> Copiar enlace compartible</button>
              </div>
            </section>

            <aside className="public-cart-checkout-panel">
              <div className="public-cart-panel-heading"><div><span className="panel-kicker">Finalizar</span><h2>Datos del cliente</h2></div></div>
              <p className="public-cart-checkout-hint">La cédula, el nombre, apellido, teléfono y correo son obligatorios. En este dispositivo podrás recuperarlos automáticamente en la próxima compra.</p>

              <form className="public-cart-customer-form" onSubmit={handleSubmit}>
                <label className="public-order-field">
                  <span>Cédula *</span>
                  <input
                    value={customer.documentId}
                    onChange={(event) => {
                      updateCustomer("documentId", event.target.value);
                      if (trustedCustomer) { setTrustedCustomer(false); setCustomerToken(""); }
                    }}
                    onBlur={() => void handleDocumentBlur()}
                    maxLength={40}
                    autoComplete="off"
                    required
                    disabled={trustedCustomer || busy}
                    placeholder="Número de documento"
                  />
                </label>
                <div className="public-cart-lookup-row">
                  <button type="button" className="public-cart-secondary-button" onClick={() => void handleDocumentBlur()} disabled={busy || !customer.documentId.trim()}>
                    Recuperar mis datos guardados
                  </button>
                  {trustedCustomer ? <span><CheckCircle2 size={13} /> Datos reconocidos</span> : null}
                </div>
                {lookupMessage ? <p className={trustedCustomer ? "public-cart-lookup-note success" : "public-cart-lookup-note"} role="status">{lookupMessage}</p> : null}

                <div className="public-order-form-grid">
                  <label className="public-order-field">
                    <span>Nombre *</span>
                    <input value={customer.firstName} onChange={(event) => updateCustomer("firstName", event.target.value)} maxLength={100} autoComplete="given-name" required disabled={trustedCustomer || busy} />
                  </label>
                  <label className="public-order-field">
                    <span>Apellido *</span>
                    <input value={customer.lastName} onChange={(event) => updateCustomer("lastName", event.target.value)} maxLength={100} autoComplete="family-name" required disabled={trustedCustomer || busy} />
                  </label>
                </div>
                <label className="public-order-field">
                  <span>Teléfono / WhatsApp *</span>
                  <input value={customer.phone} onChange={(event) => updateCustomer("phone", event.target.value)} maxLength={40} type="tel" autoComplete="tel" required disabled={trustedCustomer || busy} />
                </label>
                <label className="public-order-field">
                  <span>Correo electrónico *</span>
                  <input value={customer.email} onChange={(event) => updateCustomer("email", event.target.value)} maxLength={200} type="email" autoComplete="email" required disabled={trustedCustomer || busy} />
                </label>
                <label className="public-order-field">
                  <span>Dirección de entrega (opcional)</span>
                  <input value={customer.address} onChange={(event) => updateCustomer("address", event.target.value)} maxLength={300} autoComplete="street-address" disabled={busy} placeholder="Dirección o lugar de entrega" />
                </label>
                <label className="public-order-field">
                  <span>Nota (opcional)</span>
                  <textarea value={customer.note} onChange={(event) => updateCustomer("note", event.target.value)} maxLength={500} rows={2} disabled={busy} placeholder="Indicaciones para el vendedor..." />
                </label>

                <label className="public-cart-remember-row">
                  <input type="checkbox" checked={rememberData} onChange={(event) => setRememberData(event.target.checked)} disabled={busy} />
                  <span>Recordar mis datos en este dispositivo para futuras compras. No lo marques en un equipo compartido.</span>
                </label>

                <div className="public-cart-checkout-totals">
                  <div><span>Artículos</span><strong>{totalQuantity(items)}</strong></div>
                  <div className="public-cart-checkout-grand-total"><span>Total estimado</span><strong>{money(subtotal)}</strong></div>
                </div>
                {hasUnavailable ? <p className="public-cart-error">Hay productos sin existencias suficientes. Ajusta su cantidad o elimínalos.</p> : null}
                {orderError ? <p className="public-cart-error" role="alert">{orderError}</p> : null}
                <button className="public-order-submit" type="submit" disabled={!canSubmit}>
                  {busy ? <LoaderCircle className="public-order-spinner" size={17} /> : <ClipboardList size={17} />}
                  {busy ? "Enviando solicitud..." : "Enviar solicitud de pedido"}
                </button>
                <p className="public-order-disclaimer">Esto no es un cobro ni una reserva de inventario. El vendedor confirmará disponibilidad, importe final y entrega.</p>
              </form>
            </aside>
          </div>
        )}

        <footer className="public-catalog-footer">
          <span>Catálogo creado con <strong>TrendinShop</strong></span>
          <span>Precios y disponibilidad sujetos a cambios.</span>
        </footer>
      </div>
    </main>
  );
}
