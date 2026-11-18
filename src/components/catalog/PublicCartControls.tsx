"use client";

import Link from "next/link";
import { Check, Minus, Plus, ShoppingCart } from "lucide-react";
import { useMemo, useState } from "react";
import { readPublicCart, writePublicCart } from "@/lib/public-cart-client";

type ProductImage = { url: string; alt?: string; isPrimary?: boolean };
type VariantOption = { name: string; value: string };
type Variant = {
  id: string;
  label: string;
  stock: number;
  sellingPrice?: number;
  options?: VariantOption[];
  images?: ProductImage[];
};
type Props = {
  resellerId: string;
  storeSlug: string;
  productId: string;
  productTitle: string;
  category: string;
  description: string;
  sellerName: string;
  sellerDescription: string;
  sellingPrice: number;
  variants: Variant[];
  productImages: ProductImage[];
};

function money(value: number) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "USD" }).format(value);
}

function primaryIndex(images: ProductImage[]) {
  const index = images.findIndex((image) => image.isPrimary);
  return index >= 0 ? index : 0;
}

export function PublicCartControls({
  resellerId, storeSlug, productId, productTitle, category, description, sellerName,
  sellerDescription, sellingPrice, variants, productImages,
}: Props) {
  const availableVariants = useMemo(() => variants.filter((variant) => variant.stock > 0), [variants]);
  const optionNames = useMemo(() => Array.from(new Set(
    variants.flatMap((variant) => (variant.options ?? []).map((option) => option.name.trim()).filter(Boolean)),
  )), [variants]);
  const optionValues = useMemo(() => Object.fromEntries(optionNames.map((name) => [
    name,
    Array.from(new Set(variants.flatMap((variant) =>
      (variant.options ?? []).filter((option) => option.name.trim() === name).map((option) => option.value.trim()),
    ))),
  ])), [variants, optionNames]);

  const [selection, setSelection] = useState<Record<string, string>>({});
  const [quantity, setQuantity] = useState(1);
  const [notice, setNotice] = useState("");
  const [justAdded, setJustAdded] = useState(false);
  const [selectedImageIndex, setSelectedImageIndex] = useState<number | null>(null);

  const selectedVariant = availableVariants.find((variant) => {
    const options = variant.options ?? [];
    return optionNames.length > 0
      ? optionNames.every((name) => selection[name] && options.some((option) => option.name.trim() === name && option.value.trim() === selection[name]))
        && options.filter((option) => optionNames.includes(option.name.trim())).length === optionNames.length
      : availableVariants.length === 1 ? true : variant.id === "";
  });
  const galleryImages = selectedVariant?.images?.length ? selectedVariant.images : productImages;
  const currentImageIndex = selectedImageIndex === null
    ? primaryIndex(galleryImages)
    : Math.min(selectedImageIndex, Math.max(0, galleryImages.length - 1));
  const activeGalleryImage = galleryImages[currentImageIndex] ?? galleryImages[0];
  const prices = availableVariants.map((variant) => variant.sellingPrice ?? sellingPrice);
  const minPrice = prices.length ? Math.min(...prices) : sellingPrice;
  const maxPrice = prices.length ? Math.max(...prices) : sellingPrice;
  const currentPrice = selectedVariant?.sellingPrice ?? sellingPrice;
  const canAdd = Boolean(selectedVariant);

  function matchingVariants(nextSelection: Record<string, string>, ignoreName?: string) {
    return availableVariants.filter((variant) => (variant.options ?? []).every((option) => {
      const name = option.name.trim();
      return name === ignoreName || !nextSelection[name] || nextSelection[name] === option.value.trim();
    }));
  }

  function chooseOption(name: string, value: string) {
    setSelection((current) => {
      const next = { ...current, [name]: value };
      // Keep earlier choices where possible, but clear any choice made impossible by this change.
      for (const otherName of optionNames) {
        if (otherName === name || !next[otherName]) continue;
        const candidates = matchingVariants(next, otherName);
        if (!candidates.some((variant) => (variant.options ?? []).some((option) =>
          option.name.trim() === otherName && option.value.trim() === next[otherName],
        ))) delete next[otherName];
      }
      return next;
    });
    setSelectedImageIndex(null);
    setQuantity(1);
    setNotice("");
    setJustAdded(false);
  }

  function isOptionAvailable(name: string, value: string) {
    const candidates = matchingVariants(selection, name);
    return candidates.some((variant) => (variant.options ?? []).some((option) =>
      option.name.trim() === name && option.value.trim() === value,
    ));
  }

  function addItem() {
    if (!selectedVariant || quantity < 1 || quantity > Math.min(100, selectedVariant.stock)) {
      setNotice("Selecciona todas las características disponibles y una cantidad válida.");
      return;
    }
    const current = readPublicCart(resellerId);
    const existing = current.find((item) => item.variantId === selectedVariant.id);
    if (!existing && current.length >= 30) {
      setNotice("El carrito admite hasta 30 variantes diferentes.");
      return;
    }
    const next = existing
      ? current.map((item) => item.variantId === selectedVariant.id
          ? { ...item, quantity: Math.min(selectedVariant.stock, item.quantity + quantity) }
          : item)
      : [...current, { productId, variantId: selectedVariant.id, quantity }];
    writePublicCart(resellerId, next);
    setNotice(productTitle + " se añadió al carrito.");
    setJustAdded(true);
  }

  if (!availableVariants.length) {
    return <div className="public-product-detail-grid">
      <div className="public-product-gallery"><div className="public-catalog-image-placeholder public-product-no-image"><span>T</span></div></div>
      <div className="public-product-detail-panel"><span className="public-catalog-kicker">{category}</span><h1>{productTitle}</h1><div className="public-product-price">{money(sellingPrice)}</div><div className="public-cart-controls-unavailable">Este producto está agotado por el momento.</div></div>
    </div>;
  }

  return (
    <div className="public-product-detail-grid">
      <div className="public-product-gallery-column">
        <div className="public-product-gallery">
          {activeGalleryImage ? (
            <img src={activeGalleryImage.url} alt={activeGalleryImage.alt || productTitle} />
          ) : (
            <div className="public-catalog-image-placeholder public-product-no-image"><span>T</span></div>
          )}
          {galleryImages.length > 1 ? (
            <div className="public-product-thumbnails">
              {galleryImages.map((image, index) => (
                <button
                  type="button"
                  key={image.url}
                  className={index === currentImageIndex ? "public-product-thumbnail active" : "public-product-thumbnail"}
                  onClick={() => setSelectedImageIndex(index)}
                  aria-label={"Ver imagen " + (index + 1)}
                >
                  <img src={image.url} alt={image.alt || productTitle} />
                </button>
              ))}
            </div>
          ) : null}
          <div className="public-product-image-count">
            {selectedVariant?.images?.length ? "Imágenes de esta variante" : "Imagen principal del producto"}
          </div>
        </div>
      </div>

      <div className="public-product-detail-panel">
        <span className="public-catalog-kicker">{category}</span>
        <h1>{productTitle}</h1>
        <p className="public-product-seller">Vendido por <strong>{sellerName}</strong></p>
        {sellerDescription ? <p className="public-product-seller-description">{sellerDescription}</p> : null}
        <div className="public-product-detail-price">
          <strong>{selectedVariant ? money(currentPrice) : minPrice === maxPrice ? money(minPrice) : "Desde " + money(minPrice)}</strong>
          {!selectedVariant && minPrice !== maxPrice ? <span>El precio final depende de la combinación seleccionada.</span> : null}
        </div>
        <span className="public-product-availability available">
          {selectedVariant ? selectedVariant.stock + " disponibles" : "Selecciona las características"}
        </span>
        {description ? <p className="public-product-description">{description}</p> : null}

        {optionNames.length ? (
          <div className="public-product-options">
            {optionNames.map((name) => (
              <section className="public-product-option-group" key={name} aria-label={name}>
                <div className="public-product-option-heading">
                  <strong>{name}</strong>
                  {selection[name] ? <span>{selection[name]}</span> : <small>Elige una opción</small>}
                </div>
                <div className="public-product-option-values">
                  {(optionValues[name] ?? []).map((value) => {
                    const selected = selection[name] === value;
                    const available = isOptionAvailable(name, value);
                    return (
                      <button
                        type="button"
                        key={value}
                        className={"public-product-option-button" + (selected ? " selected" : "") + (!available ? " unavailable" : "")}
                        aria-pressed={selected}
                        disabled={!available}
                        onClick={() => chooseOption(name, value)}
                      >
                        {value}
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
            <p className="public-product-selection-hint">
              {selectedVariant ? "Combinación seleccionada: " + selectedVariant.label : "Las opciones se actualizan según la disponibilidad de cada combinación."}
            </p>
          </div>
        ) : null}

        {selectedVariant ? (
          <div className="public-product-selected-variant">
            <Check size={15} />
            <span>Variante seleccionada</span>
            <strong>{selectedVariant.label}</strong>
          </div>
        ) : null}

        <div className="public-cart-controls-bottom">
          <div className="public-cart-quantity-picker">
            <button type="button" aria-label="Reducir cantidad" onClick={() => setQuantity((value) => Math.max(1, value - 1))} disabled={quantity <= 1}><Minus size={14} /></button>
            <span>{quantity}</span>
            <button type="button" aria-label="Aumentar cantidad" onClick={() => setQuantity((value) => Math.min(Math.min(100, selectedVariant?.stock ?? 1), value + 1))} disabled={!selectedVariant || quantity >= Math.min(100, selectedVariant.stock)}><Plus size={14} /></button>
          </div>
          <strong className="public-cart-controls-total">{money((selectedVariant?.sellingPrice ?? minPrice) * quantity)}</strong>
        </div>
        <button type="button" className="public-cart-add-button" onClick={addItem} disabled={!canAdd}>
          {justAdded ? <Check size={16} /> : <ShoppingCart size={16} />}
          {justAdded ? "Añadir otro" : "Añadir al carrito"}
        </button>
        {notice ? <p className={justAdded ? "public-cart-notice success" : "public-cart-notice"} role="status">{notice}</p> : null}
        {justAdded ? <Link className="public-cart-go-link" href={"/tienda/" + storeSlug + "/carrito"}>Ver carrito y finalizar pedido →</Link> : null}
      </div>
    </div>
  );
}
