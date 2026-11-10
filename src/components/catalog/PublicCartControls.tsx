"use client";

import Link from "next/link";
import { Check, Minus, Plus, ShoppingCart } from "lucide-react";
import { useState } from "react";
import { readPublicCart, writePublicCart } from "@/lib/public-cart-client";

type Variant = { id: string; label: string; stock: number; sellingPrice?: number };
type Props = {
  resellerId: string;
  storeSlug: string;
  productId: string;
  productTitle: string;
  sellingPrice: number;
  variants: Variant[];
};

function money(value: number) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "USD" }).format(value);
}

export function PublicCartControls({
  resellerId, storeSlug, productId, productTitle, sellingPrice, variants,
}: Props) {
  const availableVariants = variants.filter((variant) => variant.stock > 0);
  const [variantId, setVariantId] = useState(availableVariants[0]?.id ?? "");
  const [quantity, setQuantity] = useState(1);
  const [notice, setNotice] = useState("");
  const [justAdded, setJustAdded] = useState(false);
  const variant = availableVariants.find((item) => item.id === variantId);

  function addItem() {
    if (!variant || quantity < 1 || quantity > Math.min(100, variant.stock)) {
      setNotice("Selecciona una variante y una cantidad disponible.");
      return;
    }

    const current = readPublicCart(resellerId);
    const existing = current.find((item) => item.variantId === variant.id);
    if (!existing && current.length >= 30) {
      setNotice("El carrito admite hasta 30 variantes diferentes.");
      return;
    }
    const next = existing
      ? current.map((item) => item.variantId === variant.id
          ? { ...item, quantity: Math.min(variant.stock, item.quantity + quantity) }
          : item)
      : [...current, { productId, variantId: variant.id, quantity }];
    writePublicCart(resellerId, next);
    setNotice(productTitle + " se añadió al carrito.");
    setJustAdded(true);
  }

  if (!availableVariants.length) {
    return <div className="public-cart-controls-unavailable">Este producto está agotado por el momento.</div>;
  }

  return (
    <div className="public-cart-controls">
      <label className="public-order-field">
        <span>Variante</span>
        <select value={variantId} onChange={(event) => {
          setVariantId(event.target.value);
          setQuantity(1);
          setJustAdded(false);
          setNotice("");
        }}>
          {availableVariants.map((item) => (
            <option value={item.id} key={item.id}>{item.label} · {money(item.sellingPrice ?? sellingPrice)} · {item.stock} disponibles</option>
          ))}
        </select>
      </label>
      <div className="public-cart-controls-bottom">
        <div className="public-cart-quantity-picker">
          <button type="button" aria-label="Reducir cantidad" onClick={() => setQuantity((value) => Math.max(1, value - 1))} disabled={quantity <= 1}><Minus size={14} /></button>
          <span>{quantity}</span>
          <button type="button" aria-label="Aumentar cantidad" onClick={() => setQuantity((value) => Math.min(Math.min(100, variant?.stock ?? 1), value + 1))} disabled={!variant || quantity >= Math.min(100, variant.stock)}><Plus size={14} /></button>
        </div>
        <strong className="public-cart-controls-total">{money((variant?.sellingPrice ?? sellingPrice) * quantity)}</strong>
      </div>
      <button type="button" className="public-cart-add-button" onClick={addItem}>
        {justAdded ? <Check size={16} /> : <ShoppingCart size={16} />}
        {justAdded ? "Añadir otro" : "Añadir al carrito"}
      </button>
      {notice ? <p className={justAdded ? "public-cart-notice success" : "public-cart-notice"} role="status">{notice}</p> : null}
      {justAdded ? <Link className="public-cart-go-link" href={"/tienda/" + storeSlug + "/carrito"}>Ver carrito y finalizar pedido →</Link> : null}
    </div>
  );
}
