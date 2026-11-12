"use client";

import Link from "next/link";
import { Check, Minus, Plus, ShoppingCart, Package } from "lucide-react";
import { useMemo, useState } from "react";
import { readPublicCart, writePublicCart } from "@/lib/public-cart-client";

type ImageRecord = { url: string; alt?: string; isPrimary?: boolean };
type Option = { name: string; value: string };
type Variant = {
  id: string;
  label: string;
  stock: number;
  wholesalePrice: number;
  options: Option[];
  images: ImageRecord[];
};
type Component = {
  productId: string;
  title: string;
  quantity: number;
  images: ImageRecord[];
  variants: Variant[];
};
type Props = {
  resellerId: string;
  storeSlug: string;
  comboId: string;
  title: string;
  description: string;
  profitMode: "FIXED" | "PERCENT";
  profitValue: number;
  components: Component[];
};

function money(value: number) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "USD" }).format(value);
}
function primaryImage(images: ImageRecord[]) {
  return images.find((image) => image.isPrimary) ?? images[0];
}
function optionNames(variants: Variant[]) {
  return Array.from(new Set(variants.flatMap((variant) => variant.options.map((option) => option.name.trim()).filter(Boolean))));
}
function optionValues(variants: Variant[], name: string) {
  return Array.from(new Set(variants.flatMap((variant) => variant.options
    .filter((option) => option.name.trim() === name).map((option) => option.value.trim()))));
}

export function PublicComboControls(props: Props) {
  const [selection, setSelection] = useState<Record<string, Record<string, string>>>({});
  const [quantity, setQuantity] = useState(1);
  const [notice, setNotice] = useState("");
  const [added, setAdded] = useState(false);

  const selected = useMemo(() => props.components.map((component) => {
    const available = component.variants.filter((variant) => variant.stock > 0);
    const names = optionNames(available);
    const chosen = selection[component.productId] ?? {};
    let variant: Variant | undefined;
    if (available.length === 1) variant = available[0];
    else if (names.length) {
      variant = available.find((candidate) =>
        names.every((name) => chosen[name] && candidate.options.some((option) =>
          option.name.trim() === name && option.value.trim() === chosen[name],
        )) && candidate.options.filter((option) => names.includes(option.name.trim())).length === names.length,
      );
    } else {
      variant = available.find((candidate) => candidate.id === chosen.__variantId);
    }
    return { component, available, names, chosen, variant };
  }), [props.components, selection]);

  const complete = selected.every((item) => Boolean(item.variant));
  const baseCost = selected.reduce((sum, item) =>
    sum + (item.variant?.wholesalePrice ?? 0) * item.component.quantity, 0);
  const price = props.profitMode === "PERCENT"
    ? baseCost * (1 + props.profitValue / 100)
    : baseCost + props.profitValue;
  const maxComboQuantity = selected.every((item) => item.variant)
    ? Math.min(...selected.map((item) => Math.floor((item.variant?.stock ?? 0) / item.component.quantity)))
    : 0;
  const gallery = selected.flatMap((item) => {
    const images = item.variant?.images.length ? item.variant.images : item.component.images;
    const primary = primaryImage(images);
    return primary ? [{ ...primary, key: item.component.productId, title: item.component.title }] : [];
  });

  function matching(component: Component, next: Record<string, string>, ignoreName?: string) {
    const variants = component.variants.filter((variant) => variant.stock > 0);
    return variants.filter((variant) => variant.options.every((option) =>
      option.name.trim() === ignoreName || !next[option.name.trim()] || next[option.name.trim()] === option.value.trim(),
    ));
  }

  function selectOption(component: Component, name: string, value: string) {
    setSelection((current) => {
      const next = { ...current, [component.productId]: { ...(current[component.productId] ?? {}), [name]: value } };
      const componentSelection = next[component.productId];
      for (const otherName of optionNames(component.variants)) {
        if (otherName === name || !componentSelection[otherName]) continue;
        const candidates = matching(component, componentSelection, otherName);
        if (!candidates.some((variant) => variant.options.some((option) =>
          option.name.trim() === otherName && option.value.trim() === componentSelection[otherName],
        ))) delete componentSelection[otherName];
      }
      delete componentSelection.__variantId;
      return next;
    });
    setQuantity(1);
    setNotice("");
    setAdded(false);
  }

  function choosePlainVariant(component: Component, variantId: string) {
    setSelection((current) => ({ ...current, [component.productId]: { __variantId: variantId } }));
    setQuantity(1);
    setNotice("");
    setAdded(false);
  }

  function isAvailable(component: Component, name: string, value: string) {
    const chosen = selection[component.productId] ?? {};
    const candidates = matching(component, chosen, name);
    return candidates.some((variant) => variant.options.some((option) =>
      option.name.trim() === name && option.value.trim() === value,
    ));
  }

  function addCombo() {
    if (!complete || maxComboQuantity < quantity) {
      setNotice("Selecciona una combinación disponible para cada producto del combo.");
      return;
    }
    const components = selected.map((item) => ({
      productId: item.component.productId,
      variantId: item.variant!.id,
      quantity: item.component.quantity,
    }));
    const variantKey = "COMBO:" + props.comboId + ":" + components.map((item) => item.variantId).join("-");
    const cart = readPublicCart(props.resellerId);
    const existing = cart.find((item) => item.kind === "COMBO" && item.variantId === variantKey);
    if (!existing && cart.length >= 30) {
      setNotice("El carrito admite hasta 30 artículos diferentes.");
      return;
    }
    const next = existing
      ? cart.map((item) => item.variantId === variantKey ? { ...item, quantity: Math.min(maxComboQuantity, item.quantity + quantity) } : item)
      : [...cart, {
          kind: "COMBO" as const,
          productId: props.comboId,
          variantId: variantKey,
          comboId: props.comboId,
          quantity,
          components,
        }];
    writePublicCart(props.resellerId, next);
    setNotice(props.title + " se añadió al carrito.");
    setAdded(true);
  }

  return (
    <div className="public-combo-detail-grid">
      <div className="public-combo-detail-gallery">
        <div className="public-combo-gallery-cover">
          {gallery[0] ? <img src={gallery[0].url} alt={gallery[0].alt || gallery[0].title}/> : <Package size={44}/>}
        </div>
        <div className="public-combo-gallery-strip">
          {gallery.map((image) => <div key={image.key} title={image.title}><img src={image.url} alt={image.alt || image.title}/></div>)}
        </div>
      </div>

      <div className="public-combo-detail-info">
        <span className="public-combo-detail-kicker">COMBO · {props.components.length} productos incluidos</span>
        <h1>{props.title}</h1>
        {props.description ? <p className="public-product-description">{props.description}</p> : null}
        <div className="public-combo-components">
          {selected.map(({ component, available, names, chosen, variant }) => {
            const images = variant?.images.length ? variant.images : component.images;
            const image = primaryImage(images);
            return (
              <section className="public-combo-component" key={component.productId}>
                <header>
                  <div className="public-combo-component-image">{image ? <img src={image.url} alt={image.alt || component.title}/> : <Package size={20}/>}</div>
                  <div><strong>{component.title}</strong><small>{component.quantity} {component.quantity === 1 ? "unidad incluida" : "unidades incluidas"}</small></div>
                  {variant ? <span className="public-combo-component-check"><Check size={14}/></span> : null}
                </header>
                {!available.length ? <p className="public-combo-unavailable">Este producto no tiene variantes disponibles.</p> : names.length ? names.map((name) => (
                  <div className="public-combo-option-group" key={name}>
                    <div><strong>{name}</strong><span>{chosen[name] || "Selecciona una opción"}</span></div>
                    <div className="public-combo-option-values">
                      {optionValues(available, name).map((value) => {
                        const selectedValue = chosen[name] === value;
                        const enabled = isAvailable(component, name, value);
                        return <button type="button" key={value} disabled={!enabled} aria-pressed={selectedValue}
                          className={selectedValue ? "selected" : !enabled ? "unavailable" : ""}
                          onClick={() => selectOption(component, name, value)}>{value}</button>;
                      })}
                    </div>
                  </div>
                )) : available.length > 1 ? (
                  <div className="public-combo-option-group"><div><strong>Presentación</strong><span>{variant?.label || "Selecciona una opción"}</span></div>
                    <div className="public-combo-option-values">{available.map((item) => <button type="button" key={item.id} className={variant?.id === item.id ? "selected" : ""} onClick={() => choosePlainVariant(component, item.id)}>{item.label}</button>)}</div>
                  </div>
                ) : variant ? <p className="public-combo-auto-selection">Opción única · {variant.label}</p> : null}
                {variant ? <small className="public-combo-stock-note">{variant.stock} disponibles</small> : null}
              </section>
            );
          })}
        </div>

        <div className="public-combo-total">
          <span>{complete ? "Precio del combo" : "Precio estimado desde"}</span>
          <strong>{money(price || props.profitValue)}</strong>
          <small>El precio se calcula según las variantes seleccionadas.</small>
        </div>
        <div className="public-cart-controls-bottom">
          <div className="public-cart-quantity-picker">
            <button type="button" aria-label="Reducir cantidad" onClick={() => setQuantity((value) => Math.max(1, value - 1))} disabled={quantity <= 1}><Minus size={14}/></button>
            <span>{quantity}</span>
            <button type="button" aria-label="Aumentar cantidad" onClick={() => setQuantity((value) => Math.min(maxComboQuantity, value + 1))} disabled={!complete || quantity >= Math.min(100, maxComboQuantity)}><Plus size={14}/></button>
          </div>
          <strong className="public-cart-controls-total">{complete ? money(price * quantity) : "—"}</strong>
        </div>
        <button type="button" className="public-cart-add-button" disabled={!complete || quantity > maxComboQuantity || maxComboQuantity < 1} onClick={addCombo}>
          {added ? <Check size={16}/> : <ShoppingCart size={16}/>} {added ? "Añadir otro combo" : "Añadir combo al carrito"}
        </button>
        {notice ? <p className={added ? "public-cart-notice success" : "public-cart-notice"} role="status">{notice}</p> : null}
        {added ? <Link className="public-cart-go-link" href={"/tienda/" + props.storeSlug + "/carrito"}>Ver carrito y finalizar pedido →</Link> : null}
      </div>
    </div>
  );
}
