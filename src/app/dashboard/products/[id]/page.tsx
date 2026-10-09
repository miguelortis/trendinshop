"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Boxes,
  CheckCircle2,
  Edit3,
  Image as ImageIcon,
  Package,
  Tag,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { api } from "@/lib/api/client";

type ProductImage = {
  url: string;
  alt?: string;
  isPrimary: boolean;
};

type ProductVariant = {
  _id: string;
  label: string;
  sku: string;
  purchasePrice: number | null;
  wholesalePrice: number | null;
  stock: number;
  lowStockThreshold: number;
  options: { name: string; value: string }[];
};

type ProductDetail = {
  _id: string;
  title: string;
  sku: string;
  slug: string;
  description?: string;
  purchasePrice?: number;
  wholesalePrice: number;
  images: ProductImage[];
  categoryId: { _id: string; name: string; slug: string } | string;
};

type ProductDetailResponse = {
  ok: true;
  product: ProductDetail;
  variants: ProductVariant[];
};

function money(value: number | null | undefined) {
  return "$" + Number(value ?? 0).toFixed(2);
}

export default function ProductDetailsPage() {
  const params = useParams<{ id: string }>();
  const productId = params.id;
  const { data: user, isLoading: userLoading } = useCurrentUser();
  const [selectedImage, setSelectedImage] = useState<number | null>(null);

  const query = useQuery({
    queryKey: ["product", productId],
    queryFn: async () =>
      (await api.get<ProductDetailResponse>(`/products/${productId}`)).data,
    enabled: Boolean(productId),
  });

  if (userLoading || query.isLoading) {
    return <div className="dashboard-empty">Cargando producto...</div>;
  }

  if (query.isError || !query.data?.product) {
    return (
      <div className="dashboard-page">
        <div className="panel-card dashboard-empty">
          <div className="dashboard-empty-icon"><Package size={20} /></div>
          <strong>No encontramos ese producto</strong>
          <span>Puede que haya sido eliminado o que no se pueda cargar ahora.</span>
          <Link href="/dashboard/products" className="secondary-action">Volver a productos</Link>
        </div>
      </div>
    );
  }

  const { product, variants } = query.data;
  const isAdmin = user?.role === "ADMIN";
  const category =
    typeof product.categoryId === "object"
      ? product.categoryId.name
      : "Sin categoría";
  const images = product.images ?? [];
  const primaryIndex = Math.max(0, images.findIndex((image) => image.isPrimary));
  const activeImage = images[selectedImage ?? primaryIndex] ?? images[0];
  const activeIndex = selectedImage ?? primaryIndex;
  const totalStock = variants.reduce((sum, variant) => sum + variant.stock, 0);
  const lowStockVariants = variants.filter(
    (variant) => variant.stock > 0 && variant.stock <= variant.lowStockThreshold,
  ).length;
  const unavailableVariants = variants.filter((variant) => variant.stock === 0).length;

  return (
    <div className="dashboard-page product-detail-page">
      <Link href="/dashboard/products" className="back-dashboard-link">
        <ArrowLeft size={16} /> Volver a productos
      </Link>

      <section className="product-detail-heading">
        <div>
          <span className="page-kicker">Catálogo maestro / Detalle</span>
          <h1>{product.title}</h1>
          <div className="product-detail-subtitle">
            <span><Tag size={14} /> {category}</span>
            <span>SKU {product.sku}</span>
          </div>
        </div>
        <div className="product-detail-heading-actions">
          {isAdmin ? (
            <Link href={`/dashboard/products/${productId}/edit`} className="primary-button">
              <Edit3 size={15} /> Editar producto
            </Link>
          ) : null}
        </div>
      </section>

      <div className="product-detail-layout">
        <section className="panel-card product-detail-gallery">
          <div className="product-detail-main-image">
            {activeImage ? (
              <img src={activeImage.url} alt={activeImage.alt || product.title} />
            ) : (
              <div className="product-detail-no-image">
                <ImageIcon size={34} />
                <span>Este producto aún no tiene imágenes</span>
              </div>
            )}
          </div>
          {images.length > 1 ? (
            <div className="product-detail-thumbnails">
              {images.map((image, index) => (
                <button
                  key={image.url}
                  type="button"
                  className={index === activeIndex ? "product-detail-thumbnail active" : "product-detail-thumbnail"}
                  onClick={() => setSelectedImage(index)}
                  aria-label={`Ver imagen ${index + 1}`}
                >
                  <img src={image.url} alt={image.alt || `${product.title} ${index + 1}`} />
                </button>
              ))}
            </div>
          ) : null}
          <div className="product-detail-image-meta">
            <span><ImageIcon size={14} /> {images.length} {images.length === 1 ? "imagen" : "imágenes"}</span>
            {images.some((image) => image.isPrimary) ? (
              <span className="product-detail-primary"><CheckCircle2 size={13} /> Imagen principal configurada</span>
            ) : null}
          </div>
        </section>

        <div className="product-detail-side">
          <section className="panel-card product-detail-info">
            <span className="panel-kicker">Información del producto</span>
            <h2>Descripción</h2>
            <p className={product.description ? "product-description" : "product-description muted"}>
              {product.description || "No se ha añadido una descripción para este producto."}
            </p>
            <div className="product-detail-info-row">
              <span>Estado</span>
              <strong className="product-active-status"><CheckCircle2 size={14} /> Activo</strong>
            </div>
            <div className="product-detail-info-row">
              <span>Variantes configuradas</span>
              <strong>{variants.length}</strong>
            </div>
            <div className="product-detail-info-row">
              <span>Unidades disponibles</span>
              <strong>{totalStock}</strong>
            </div>
          </section>

          <section className="panel-card product-detail-pricing">
            <span className="panel-kicker">Precio y rentabilidad</span>
            <div className="product-detail-price-row">
              <span>Precio mayorista</span>
              <strong>{money(product.wholesalePrice)}</strong>
            </div>
            {isAdmin ? (
              <>
                <div className="product-detail-price-row">
                  <span>Precio de compra</span>
                  <strong>{money(product.purchasePrice)}</strong>
                </div>
                <div className="product-detail-price-row profit">
                  <span>Ganancia estimada por unidad</span>
                  <strong>{money(Math.max(0, product.wholesalePrice - Number(product.purchasePrice ?? 0)))}</strong>
                </div>
              </>
            ) : null}
          </section>

          <section className="panel-card product-detail-inventory">
            <div className="product-detail-inventory-head">
              <div className="product-detail-inventory-icon"><Boxes size={17} /></div>
              <div>
                <strong>Resumen de inventario</strong>
                <span>Stock de todas las variantes</span>
              </div>
            </div>
            <div className="product-inventory-stats">
              <div><strong>{totalStock}</strong><span>Unidades</span></div>
              <div><strong>{lowStockVariants}</strong><span>Stock bajo</span></div>
              <div><strong>{unavailableVariants}</strong><span>Agotadas</span></div>
            </div>
          </section>
        </div>
      </div>

      <section className="panel-card product-detail-variants">
        <div className="panel-header">
          <div>
            <span className="panel-kicker">Opciones e inventario</span>
            <h2>Variantes del producto</h2>
          </div>
          <span className="product-variant-count">{variants.length} {variants.length === 1 ? "variante" : "variantes"}</span>
        </div>

        {variants.length ? (
          <div className="product-variant-list">
            {variants.map((variant) => {
              const stockState =
                variant.stock <= 0
                  ? "out"
                  : variant.stock <= variant.lowStockThreshold
                    ? "low"
                    : "available";

              return (
                <article className="product-variant-card" key={variant._id}>
                  <div className="product-variant-card-main">
                    <div className="product-variant-icon"><Package size={17} /></div>
                    <div className="product-variant-copy">
                      <strong>{variant.label || "Variante"}</strong>
                      <span>SKU {variant.sku}</span>
                      {variant.options.length ? (
                        <div className="product-variant-options">
                          {variant.options.map((option) => (
                            <span key={option.name + option.value}>
                              <b>{option.name}:</b> {option.value}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <small>Sin opciones adicionales</small>
                      )}
                    </div>
                  </div>
                  <div className="product-variant-prices">
                    <span>Mayorista</span>
                    <strong>{money(variant.wholesalePrice ?? product.wholesalePrice)}</strong>
                    {isAdmin ? (
                      <small>Costo: {money(variant.purchasePrice ?? product.purchasePrice)}</small>
                    ) : null}
                  </div>
                  <div className="product-variant-stock">
                    <span className={`product-stock-pill ${stockState}`}>
                      {stockState === "out" ? "Agotada" : stockState === "low" ? "Stock bajo" : "Disponible"}
                    </span>
                    <strong>{variant.stock} <small>unidades</small></strong>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="dashboard-empty compact">Este producto aún no tiene variantes.</div>
        )}
      </section>

      {isAdmin ? (
        <div className="product-detail-bottom-actions">
          <Link href={`/dashboard/products/${productId}/edit`} className="primary-button">
            <Edit3 size={15} /> Editar producto
          </Link>
        </div>
      ) : null}
    </div>
  );
}
