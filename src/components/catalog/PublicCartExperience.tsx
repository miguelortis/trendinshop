"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  LoaderCircle,
  Minus,
  Plus,
  Share2,
  ShoppingBag,
  Trash2,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { PublicStorefrontHeader } from "@/components/catalog/PublicStorefrontHeader";
import {
  type PublicCartDraftItem,
  type PublicCartViewItem,
  readPublicCart,
  writePublicCart,
} from "@/lib/public-cart-client";

type Viewer = {
  id: string;
  role: "ADMIN" | "RESELLER";
  documentId: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
};

type Props = {
  resellerId: string;
  storeSlug: string;
  storeName: string;
  sellerPhone: string;
  logoUrl: string;
  shareToken: string;
  viewer: Viewer | null;
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
  exists: boolean;
  customer: Omit<CustomerForm, "note"> | null;
};

type OrderResponse = {
  ok: true;
  order: { orderNumber: string; subtotal: number };
  message: string;
};

type SaleResponse = {
  ok: true;
  sale: { saleNumber: string; total: number };
  message: string;
};

type ErrorShape = { response?: { data?: { message?: string } } };

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
  return items.map((item) => item.kind === "COMBO"
    ? {
        kind: "COMBO",
        productId: item.comboId ?? item.productId,
        variantId: item.variantId,
        comboId: item.comboId,
        quantity: item.quantity,
        components: (item.components ?? []).map((component) => ({
          productId: component.productId,
          variantId: component.variantId,
          quantity: component.quantity,
        })),
      }
    : { kind: "PRODUCT", productId: item.productId, variantId: item.variantId, quantity: item.quantity });
}

function totalQuantity(items: PublicCartViewItem[]) {
  return items.reduce((sum, item) => sum + item.quantity * (item.kind === "COMBO"
    ? (item.components ?? []).reduce((componentSum, component) => componentSum + component.quantity, 0)
    : 1), 0);
}

export function PublicCartExperience({
  resellerId,
  storeSlug,
  storeName,
  sellerPhone,
  logoUrl,
  shareToken,
  viewer,
}: Props) {
  const [items, setItems] = useState<PublicCartViewItem[]>([]);
  const [loadingCart, setLoadingCart] = useState(true);
  const [busy, setBusy] = useState(false);
  const [cartError, setCartError] = useState("");
  const [cartMessage, setCartMessage] = useState("");
  const [shareMessage, setShareMessage] = useState("");
  const [sharedUrl, setSharedUrl] = useState("");
  const [customer, setCustomer] = useState<CustomerForm>(() =>
    viewer && viewer.id !== resellerId
      ? {
          ...blankCustomer,
          documentId: viewer.documentId,
          firstName: viewer.firstName,
          lastName: viewer.lastName,
          phone: viewer.phone,
          email: viewer.email,
        }
      : blankCustomer,
  );
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupState, setLookupState] = useState<"idle" | "checking" | "found" | "not-found" | "error">("idle");
  const [lookedUpDocumentId, setLookedUpDocumentId] = useState("");
  const [lookupMessage, setLookupMessage] = useState("");
  const [acceptCustomerData, setAcceptCustomerData] = useState(false);
  const [orderError, setOrderError] = useState("");
  const [success, setSuccess] = useState<{
    kind: "sale" | "order";
    reference: string;
    total: number;
  } | null>(null);

  const isSellerView = Boolean(viewer && viewer.id === resellerId && shareToken);
  const isBuyerView = Boolean(viewer && viewer.id !== resellerId);
  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const hasUnavailable = items.some((item) => !item.available || item.stock < item.quantity);
  const lookupComplete = (lookupState === "found" || lookupState === "not-found") &&
    lookedUpDocumentId === normalizeDocumentId(customer.documentId);

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

    const startLoading = window.setTimeout(() => {
      if (!active) return;
      setLoadingCart(true);
      setCartError("");
      void load();
    }, 0);

    return () => {
      active = false;
      window.clearTimeout(startLoading);
    };
  }, [resellerId, shareToken, refreshCart]);

  const lookupCustomer = useCallback(async (documentId: string) => {
    if (!documentId || !isSellerView) return;
    setLookupLoading(true);
    setLookupState("checking");
    setLookupMessage("");
    try {
      const response = await api.post<CustomerLookupResponse>("/customers/lookup", { documentId });
      setLookedUpDocumentId(documentId);
      if (response.data.exists && response.data.customer) {
        setCustomer({
          ...blankCustomer,
          ...response.data.customer,
          documentId,
        });
        setLookupState("found");
        setLookupMessage("Cliente encontrado en tu directorio. Revisa y actualiza sus datos si es necesario.");
      } else {
        setCustomer((current) => ({ ...blankCustomer, documentId: current.documentId }));
        setLookupState("not-found");
        setLookupMessage("No encontramos este cliente en tu directorio. Completa sus datos para guardarlos con la venta.");
      }
    } catch (error) {
      setLookupState("error");
      setLookedUpDocumentId(documentId);
      setLookupMessage(messageFrom(error, "No pudimos consultar tu directorio de clientes."));
    } finally {
      setLookupLoading(false);
    }
  }, [isSellerView]);

  useEffect(() => {
    if (!isSellerView) return;
    const documentId = normalizeDocumentId(customer.documentId);
    if (!documentId) return;
    if (lookupState === "checking") return;
    if (lookedUpDocumentId === documentId &&
      (lookupState === "found" || lookupState === "not-found" || lookupState === "error")) return;

    const timeout = window.setTimeout(() => {
      void lookupCustomer(documentId);
    }, 650);
    return () => window.clearTimeout(timeout);
  }, [customer.documentId, isSellerView, lookupCustomer, lookedUpDocumentId, lookupState]);

  function changeQuantity(variantId: string, nextQuantity: number) {
    const existing = items.find((item) => item.variantId === variantId);
    if (!existing) return;
    if (nextQuantity < 1) {
      removeItem(variantId);
      return;
    }
    const bounded = Math.min(100, existing.stock || 100, nextQuantity);
    const next = items.map((item) => item.variantId === variantId ? { ...item, quantity: bounded, lineTotal: item.unitPrice * bounded } : item);
    setItems(next);
    writePublicCart(resellerId, draft(next));
  }

  function removeItem(variantId: string) {
    const next = items.filter((item) => item.variantId !== variantId);
    setItems(next);
    writePublicCart(resellerId, draft(next));
  }

  async function updatePrices() {
    setCartError("");
    setCartMessage("");
    if (!items.length) return;
    setBusy(true);
    try {
      await refreshCart(draft(items));
      setCartMessage("Precios y existencias actualizados.");
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
        setShareMessage("Enlace copiado. Envíalo al vendedor para que complete los datos y registre la compra.");
      } catch {
        setShareMessage("Enlace listo. Cópialo desde el campo de abajo para enviarlo al vendedor.");
      }
    } catch (error) {
      setCartError(messageFrom(error, "No pudimos compartir el carrito. Inténtalo de nuevo."));
    } finally {
      setBusy(false);
    }
  }

  function updateCustomer<K extends keyof CustomerForm>(key: K, value: CustomerForm[K]) {
    setCustomer((current) => ({ ...current, [key]: value }));
    setOrderError("");
    if (key === "documentId") {
      setAcceptCustomerData(false);
      setLookupState("idle");
      setLookedUpDocumentId("");
      setLookupMessage("");
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOrderError("");

    if (!items.length) {
      setOrderError("Agrega al menos un producto al carrito.");
      return;
    }
    if (hasUnavailable) {
      setOrderError("Hay productos sin existencias suficientes. Actualiza el carrito antes de continuar.");
      return;
    }
    if (isSellerView) {
      if (!shareToken) {
        setOrderError("Abre el enlace compartido para registrar esta compra.");
        return;
      }
      if (!lookupComplete) {
        setOrderError("Introduce la cédula y espera a que termine la búsqueda en tu directorio.");
        return;
      }
      if (!customer.firstName.trim() || !customer.lastName.trim() || !customer.phone.trim()) {
        setOrderError("Completa nombre, apellido y teléfono del cliente.");
        return;
      }
      if (!acceptCustomerData) {
        setOrderError("Confirma que el cliente autorizó el uso de sus datos para registrar la compra.");
        return;
      }
      setBusy(true);
      try {
        const response = await api.post<SaleResponse>("/sales", {
          sharedCartToken: shareToken,
          customer: {
            documentId: normalizeDocumentId(customer.documentId),
            firstName: customer.firstName,
            lastName: customer.lastName,
            phone: customer.phone,
            email: customer.email,
            address: customer.address,
          },
          customerDataConsent: true,
          initialPayment: 0,
          note: customer.note,
        });
        setSuccess({
          kind: "sale",
          reference: response.data.sale.saleNumber,
          total: response.data.sale.total,
        });
        setItems([]);
        writePublicCart(resellerId, []);
      } catch (error) {
        setOrderError(messageFrom(error, "No pudimos registrar la venta. Comprueba los datos e inténtalo de nuevo."));
      } finally {
        setBusy(false);
      }
      return;
    }

    if (!isBuyerView || !viewer) {
      setOrderError("Inicia sesión como comprador o comparte el carrito con el vendedor para continuar.");
      return;
    }
    if (!acceptCustomerData) {
      setOrderError("Autoriza compartir tus datos de cuenta con esta tienda para gestionar el pedido.");
      return;
    }

    setBusy(true);
    try {
      const response = await api.post<OrderResponse>("/public-orders", {
        resellerId,
        items: draft(items),
        address: customer.address,
        note: customer.note,
        customerDataConsent: true,
      });
      setSuccess({
        kind: "order",
        reference: response.data.order.orderNumber,
        total: response.data.order.subtotal,
      });
      setItems([]);
      writePublicCart(resellerId, []);
    } catch (error) {
      setOrderError(messageFrom(error, "No pudimos registrar la solicitud. Inténtalo de nuevo."));
    } finally {
      setBusy(false);
    }
  }

  const sellerDigits = sellerPhone.replace(/[^0-9]/g, "");
  const whatsappLink = success?.kind === "order" && sellerDigits
    ? "https://wa.me/" + sellerDigits + "?text=" + encodeURIComponent(
        "Hola " + storeName + ", envié el pedido " + success.reference + ". ¿Podemos confirmar disponibilidad y entrega?",
      )
    : "";

  if (success) {
    return (
      <main className="public-catalog-shell">
        <div className="public-catalog-container">
          <PublicStorefrontHeader resellerId={resellerId} storeSlug={storeSlug} storeName={storeName} logoUrl={logoUrl} />
          <div className="public-cart-result">
            <span className="public-cart-result-icon"><CheckCircle2 size={28} /></span>
            <span className="public-catalog-kicker">{success.kind === "sale" ? "VENTA REGISTRADA" : "SOLICITUD REGISTRADA"}</span>
            <h1>{success.kind === "sale" ? "¡Compra registrada!" : "¡Gracias por tu pedido!"}</h1>
            <p>
              {success.kind === "sale"
                ? "La venta " + success.reference + " fue registrada. Se actualizaron las existencias y las cuentas correspondientes."
                : "Tu solicitud " + success.reference + " fue enviada. El vendedor confirmará existencias, importe final y entrega."}
            </p>
            <div className="public-cart-result-total"><span>{success.kind === "sale" ? "Total de la venta" : "Total estimado"}</span><strong>{money(success.total)}</strong></div>
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
        {sharedUrl ? (
          <div className="public-cart-share-link">
            <label htmlFor="public-cart-shared-url">Enlace compartible</label>
            <input id="public-cart-shared-url" value={sharedUrl} readOnly onFocus={(event) => event.currentTarget.select()} />
            <button type="button" className="public-cart-secondary-button" onClick={() => {
              void navigator.clipboard.writeText(sharedUrl)
                .then(() => setShareMessage("Enlace copiado."))
                .catch(() => setShareMessage("Selecciona el enlace y cópialo manualmente."));
            }}>Copiar de nuevo</button>
          </div>
        ) : null}

        {loadingCart ? (
          <div className="public-cart-loading"><LoaderCircle className="public-order-spinner" size={24} /> Cargando carrito...</div>
        ) : !items.length ? (
          <section className="public-cart-empty">
            <span className="public-cart-empty-icon"><ShoppingBag size={28} /></span>
            <h2>Tu carrito está vacío</h2>
            <p>Explora el catálogo y añade los productos que te interesan. Después podrás compartir el carrito con el vendedor.</p>
            <Link href={"/tienda/" + storeSlug} className="public-order-submit"><ShoppingBag size={16} /> Explorar productos</Link>
          </section>
        ) : (
          <div className="public-cart-layout">
            <section className="public-cart-items-panel">
              <div className="public-cart-panel-heading">
                <div><span className="panel-kicker">Resumen</span><h2>{items.length} {items.length === 1 ? "variante" : "variantes"} · {totalQuantity(items)} unidades</h2></div>
                <button type="button" className="public-cart-secondary-button" onClick={() => void updatePrices()} disabled={busy}>
                  <LoaderCircle size={14} className={busy ? "public-order-spinner" : ""} /> Actualizar precios
                </button>
              </div>
              <div className="public-cart-items-list">
                {items.map((item) => (
                  <article className={"public-cart-item" + (!item.available ? " unavailable" : "")} key={item.variantId}>
                    <div className="public-cart-item-image"><ShoppingBag size={20} /></div>
                    <div className="public-cart-item-copy">
                      <strong>{item.kind === "COMBO" ? "COMBO · " + item.productTitle : item.productTitle}</strong>
                      {item.kind === "COMBO" ? (
                        <div className="public-cart-combo-components">
                          {(item.components ?? []).map((component) => (
                            <span key={component.productId}>{component.quantity} × {component.productTitle} · {component.variantLabel}</span>
                          ))}
                        </div>
                      ) : <span>{item.variantLabel}</span>}
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
                <div>
                  <strong>¿Quieres que alguien revise esta compra?</strong>
                  <p>Comparte un enlace con todos los artículos. El enlace caduca en 30 días.</p>
                </div>
                <button type="button" onClick={() => void shareCart()} className="public-cart-secondary-button" disabled={busy || hasUnavailable}>
                  <Share2 size={15} /> Compartir carrito
                </button>
              </div>
            </section>

            <aside className="public-cart-checkout-panel">
              {isSellerView ? (
                <>
                  <div className="public-cart-panel-heading"><div><span className="panel-kicker">Venta asistida</span><h2>Registrar compra del cliente</h2></div></div>
                  <p className="public-cart-checkout-hint">El enlace de tu tienda llegó a tu cuenta. Completa o recupera los datos del cliente y registra la venta desde aquí.</p>
                  <form className="public-cart-customer-form" onSubmit={handleSubmit}>
                    <label className="public-order-field">
                      <span>Cédula del cliente *</span>
                      <input
                        value={customer.documentId}
                        onChange={(event) => updateCustomer("documentId", event.target.value)}
                        maxLength={40}
                        autoComplete="off"
                        required
                        disabled={busy || lookupLoading}
                        placeholder="Cédula o documento"
                      />
                    </label>
                    {lookupLoading ? <p className="public-cart-lookup-note" role="status"><LoaderCircle size={14} className="public-order-spinner" /> Buscando en tu directorio...</p> : null}
                    {lookupMessage ? <p className={"public-cart-lookup-note" + (lookupState === "found" ? " success" : "")} role="status">{lookupMessage}</p> : null}
                    {lookupState === "found" || lookupState === "not-found" ? (
                      <>
                        <div className="public-order-form-grid">
                          <label className="public-order-field">
                            <span>Nombre *</span>
                            <input required maxLength={100} value={customer.firstName} onChange={(event) => updateCustomer("firstName", event.target.value)} disabled={busy} autoComplete="given-name" />
                          </label>
                          <label className="public-order-field">
                            <span>Apellido *</span>
                            <input required maxLength={100} value={customer.lastName} onChange={(event) => updateCustomer("lastName", event.target.value)} disabled={busy} autoComplete="family-name" />
                          </label>
                        </div>
                        <label className="public-order-field">
                          <span>Teléfono / WhatsApp *</span>
                          <input required maxLength={40} type="tel" value={customer.phone} onChange={(event) => updateCustomer("phone", event.target.value)} disabled={busy} autoComplete="tel" />
                        </label>
                        <label className="public-order-field">
                          <span>Correo electrónico (opcional)</span>
                          <input maxLength={200} type="email" value={customer.email} onChange={(event) => updateCustomer("email", event.target.value)} disabled={busy} autoComplete="email" />
                        </label>
                        <label className="public-order-field">
                          <span>Dirección de entrega (opcional)</span>
                          <input maxLength={300} value={customer.address} onChange={(event) => updateCustomer("address", event.target.value)} disabled={busy} autoComplete="street-address" />
                        </label>
                        <label className="public-order-field">
                          <span>Nota (opcional)</span>
                          <textarea maxLength={500} rows={2} value={customer.note} onChange={(event) => updateCustomer("note", event.target.value)} disabled={busy} />
                        </label>
                        <label className="public-cart-remember-row">
                          <input type="checkbox" required checked={acceptCustomerData} onChange={(event) => setAcceptCustomerData(event.target.checked)} disabled={busy} />
                          <span>Confirmo que el cliente autorizó guardar y utilizar estos datos para gestionar su compra.</span>
                        </label>
                        <div className="public-cart-checkout-totals">
                          <div><span>Artículos</span><strong>{totalQuantity(items)}</strong></div>
                          <div className="public-cart-checkout-grand-total"><span>Total de la venta</span><strong>{money(subtotal)}</strong></div>
                        </div>
                        {orderError ? <p className="public-cart-error" role="alert">{orderError}</p> : null}
                        <button className="public-order-submit" type="submit" disabled={busy || lookupLoading || !lookupComplete || !acceptCustomerData || hasUnavailable}>
                          {busy ? <LoaderCircle className="public-order-spinner" size={17} /> : <ClipboardList size={17} />}
                          {busy ? "Registrando venta..." : "Registrar compra"}
                        </button>
                        <p className="public-order-disclaimer">La venta descontará las existencias y actualizará las cuentas correspondientes. El perfil del cliente no tendrá contraseña ni acceso a una cuenta.</p>
                      </>
                    ) : null}
                  </form>
                </>
              ) : isBuyerView && viewer ? (
                <>
                  <div className="public-cart-panel-heading"><div><span className="panel-kicker">Finalizar</span><h2>Tus datos de compra</h2></div></div>
                  <p className="public-cart-checkout-hint">Usaremos los datos de tu cuenta. No tendrás que escribir tu cédula ni volver a completar tus datos personales.</p>
                  <form className="public-cart-customer-form" onSubmit={handleSubmit}>
                    <div className="public-order-form-grid">
                      <label className="public-order-field"><span>Nombre</span><input value={viewer.firstName} readOnly /></label>
                      <label className="public-order-field"><span>Apellido</span><input value={viewer.lastName} readOnly /></label>
                    </div>
                    <label className="public-order-field"><span>Cédula</span><input value={viewer.documentId} readOnly /></label>
                    <label className="public-order-field"><span>Teléfono</span><input value={viewer.phone} readOnly /></label>
                    <label className="public-order-field"><span>Correo electrónico</span><input value={viewer.email} readOnly /></label>
                    <label className="public-order-field">
                      <span>Dirección de entrega (opcional)</span>
                      <input maxLength={300} value={customer.address} onChange={(event) => updateCustomer("address", event.target.value)} disabled={busy} autoComplete="street-address" placeholder="Dirección o lugar de entrega" />
                    </label>
                    <label className="public-order-field">
                      <span>Nota (opcional)</span>
                      <textarea maxLength={500} rows={2} value={customer.note} onChange={(event) => updateCustomer("note", event.target.value)} disabled={busy} placeholder="Indicaciones para el vendedor..." />
                    </label>
                    <label className="public-cart-remember-row">
                      <input type="checkbox" required checked={acceptCustomerData} onChange={(event) => setAcceptCustomerData(event.target.checked)} disabled={busy} />
                      <span>Autorizo compartir mis datos de cuenta con esta tienda para gestionar este pedido y facilitar futuras compras.</span>
                    </label>
                    <div className="public-cart-checkout-totals">
                      <div><span>Artículos</span><strong>{totalQuantity(items)}</strong></div>
                      <div className="public-cart-checkout-grand-total"><span>Total estimado</span><strong>{money(subtotal)}</strong></div>
                    </div>
                    {orderError ? <p className="public-cart-error" role="alert">{orderError}</p> : null}
                    <button className="public-order-submit" type="submit" disabled={busy || !acceptCustomerData || hasUnavailable}>
                      {busy ? <LoaderCircle className="public-order-spinner" size={17} /> : <ClipboardList size={17} />}
                      {busy ? "Enviando solicitud..." : "Enviar solicitud de pedido"}
                    </button>
                    <p className="public-order-disclaimer">Esto no es un cobro ni una reserva de inventario. El vendedor confirmará disponibilidad, importe final y entrega.</p>
                  </form>
                </>
              ) : (
                <>
                  <div className="public-cart-panel-heading"><div><span className="panel-kicker">Compartir</span><h2>Enviar carrito al vendedor</h2></div></div>
                  <p className="public-cart-checkout-hint">Para registrar una compra, inicia sesión con una cuenta de comprador o comparte este carrito con el dueño de la tienda. El visitante sin sesión no puede enviar pedidos ni consultar datos por cédula.</p>
                  {orderError ? <p className="public-cart-error" role="alert">{orderError}</p> : null}
                  <button type="button" className="public-order-submit" onClick={() => void shareCart()} disabled={busy || hasUnavailable}>
                    <Share2 size={16} /> Compartir carrito con el vendedor
                  </button>
                  <Link
                    href={"/login?next=" + encodeURIComponent("/tienda/" + storeSlug + "/carrito?share=" + shareToken)}
                    className="public-product-back-link"
                  >
                    Ya tengo cuenta · Iniciar sesión
                  </Link>
                </>
              )}
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
