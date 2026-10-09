"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Package, Plus, Search, ShoppingBag, Trash2, X } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useMemo, useState } from "react";
import { api } from "@/lib/api/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";

type CategoryRef = { _id?: string; name: string; slug?: string };
type CatalogProduct = {
  _id: string;
  title: string;
  sku: string;
  description?: string;
  wholesalePrice: number;
  images?: { url: string; alt?: string; isPrimary?: boolean }[];
  categoryId?: CategoryRef | string;
  availableStock: number;
};
type CatalogItem = {
  _id: string;
  productId: string;
  sellingPrice: number;
};
type CatalogResponse = {
  ok: true;
  products: CatalogProduct[];
  items: CatalogItem[];
};
type SavePayload = {
  productId: string;
  itemId?: string;
  sellingPrice: number;
};

function errorMessage(error: unknown) {
  const response = error as { response?: { data?: { message?: string } } };
  return response.response?.data?.message ?? "Ocurrió un error. Inténtalo de nuevo.";
}

function money(value: number) {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

export default function ResellerCatalogPage() {
  const { data: user, isLoading: userLoading } = useCurrentUser();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"explore" | "mine">("explore");
  const [search, setSearch] = useState("");
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [priceDraft, setPriceDraft] = useState("");
  const [actionError, setActionError] = useState("");

  const catalog = useQuery({
    queryKey: ["reseller-catalog"],
    enabled: user?.role === "RESELLER",
    queryFn: async () => (await api.get<CatalogResponse>("/catalog")).data,
  });

  const itemByProductId = useMemo(
    () => new Map((catalog.data?.items ?? []).map((item) => [item.productId, item])),
    [catalog.data?.items],
  );

  const filteredProducts = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (catalog.data?.products ?? [])
      .filter((product) => activeTab === "explore" || itemByProductId.has(product._id))
      .filter((product) => {
        if (!term) return true;
        const category = typeof product.categoryId === "object" ? product.categoryId?.name ?? "" : "";
        return [product.title, product.sku, category].join(" ").toLowerCase().includes(term);
      });
  }, [activeTab, catalog.data?.products, itemByProductId, search]);

  const saveItem = useMutation({
    mutationFn: async ({ productId, itemId, sellingPrice }: SavePayload) => {
      if (itemId) {
        return (await api.patch("/catalog/" + itemId, { sellingPrice })).data;
      }
      return (await api.post("/catalog", { productId, sellingPrice })).data;
    },
    onSuccess: async () => {
      setEditingProductId(null);
      setPriceDraft("");
      setActionError("");
      await queryClient.invalidateQueries({ queryKey: ["reseller-catalog"] });
    },
    onError: (error: unknown) => setActionError(errorMessage(error)),
  });

  const removeItem = useMutation({
    mutationFn: async (itemId: string) => api.delete("/catalog/" + itemId),
    onSuccess: async () => {
      setEditingProductId(null);
      setPriceDraft("");
      setActionError("");
      await queryClient.invalidateQueries({ queryKey: ["reseller-catalog"] });
    },
    onError: (error: unknown) => setActionError(errorMessage(error)),
  });

  function openEditor(product: CatalogProduct, item?: CatalogItem) {
    setActionError("");
    setEditingProductId(product._id);
    setPriceDraft(item ? String(item.sellingPrice) : "");
  }

  function handleSavePrice(event: FormEvent<HTMLFormElement>, product: CatalogProduct, item?: CatalogItem) {
    event.preventDefault();
    setActionError("");
    saveItem.mutate({
      productId: product._id,
      itemId: item?._id,
      sellingPrice: Number(priceDraft),
    });
  }

  if (userLoading) {
    return <div className="dashboard-page"><div className="panel-card dashboard-loading">Cargando tu cuenta...</div></div>;
  }

  if (user?.role !== "RESELLER") {
    return (
      <div className="dashboard-page">
        <section className="page-heading">
          <div>
            <span className="page-kicker">Catálogo personal</span>
            <h1>Mi catálogo</h1>
            <p>Esta sección es exclusiva para cuentas de revendedor.</p>
          </div>
        </section>
        <div className="panel-card reseller-catalog-restricted">
          <ShoppingBag size={28} />
          <strong>Gestiona los productos de tus revendedores</strong>
          <span>Como administrador, publica y administra los productos del catálogo maestro.</span>
          <Link href="/dashboard/products" className="primary-button">Ir a productos</Link>
        </div>
      </div>
    );
  }

  const savedCount = catalog.data?.items.length ?? 0;

  return (
    <div className="dashboard-page reseller-catalog-page">
      <section className="page-heading">
        <div>
          <span className="page-kicker">Venta personalizada</span>
          <h1>Mi catálogo</h1>
          <p>Elige productos de tu proveedor y define el precio al que los ofrecerás a tus clientes.</p>
        </div>
      </section>

      <section className="reseller-catalog-summary">
        <div className="reseller-catalog-summary-icon"><ShoppingBag size={21} /></div>
        <div>
          <strong>{savedCount} {savedCount === 1 ? "producto en tu catálogo" : "productos en tu catálogo"}</strong>
          <span>Tu precio de venta es privado de tu catálogo. El costo de compra del proveedor no se muestra aquí.</span>
        </div>
      </section>

      <div className="reseller-catalog-controls">
        <div className="reseller-catalog-tabs" role="tablist" aria-label="Vista del catálogo">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "explore"}
            className={activeTab === "explore" ? "active" : ""}
            onClick={() => { setActiveTab("explore"); setActionError(""); setEditingProductId(null); }}
          >
            <Search size={15} /> Explorar productos
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "mine"}
            className={activeTab === "mine" ? "active" : ""}
            onClick={() => { setActiveTab("mine"); setActionError(""); setEditingProductId(null); }}
          >
            <ShoppingBag size={15} /> Mi selección <span>{savedCount}</span>
          </button>
        </div>
        <label className="search-field reseller-catalog-search">
          <Search size={17} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por nombre, SKU o categoría..."
            aria-label="Buscar productos"
          />
        </label>
      </div>

      {actionError ? <div className="auth-error reseller-catalog-error">{actionError}</div> : null}

      {catalog.isLoading ? (
        <div className="panel-card dashboard-loading">Cargando catálogo...</div>
      ) : catalog.isError ? (
        <div className="panel-card dashboard-empty product-empty">
          <div className="dashboard-empty-icon"><Package size={20} /></div>
          <strong>No pudimos cargar tu catálogo</strong>
          <span>{errorMessage(catalog.error)}</span>
          <button className="secondary-button" type="button" onClick={() => void catalog.refetch()}>Intentar de nuevo</button>
        </div>
      ) : filteredProducts.length ? (
        <section className="product-grid reseller-catalog-grid">
          {filteredProducts.map((product) => {
            const item = itemByProductId.get(product._id);
            const category = typeof product.categoryId === "object" ? product.categoryId?.name ?? "Sin categoría" : "Sin categoría";
            const primaryImage = product.images?.find((image) => image.isPrimary) ?? product.images?.[0];
            const margin = item ? item.sellingPrice - product.wholesalePrice : Number(priceDraft) - product.wholesalePrice;
            const isEditing = editingProductId === product._id;

            return (
              <article className="product-card reseller-catalog-card" key={product._id}>
                <div className="product-card-image reseller-catalog-image">
                  {primaryImage ? (
                    <img src={primaryImage.url} alt={primaryImage.alt || product.title} loading="lazy" decoding="async" />
                  ) : (
                    <Package size={30} />
                  )}
                  <span className={product.availableStock > 0 ? "catalog-stock available" : "catalog-stock unavailable"}>
                    {product.availableStock > 0 ? "Disponible · " + product.availableStock : "Agotado"}
                  </span>
                </div>
                <div className="product-card-body reseller-catalog-card-body">
                  <span className="product-category">{category}</span>
                  <h2>{product.title}</h2>
                  <div className="product-sku">SKU {product.sku}</div>

                  <div className="reseller-catalog-prices">
                    <div>
                      <span>Precio mayorista</span>
                      <strong>{money(product.wholesalePrice)}</strong>
                    </div>
                    {item ? (
                      <div>
                        <span>Tu precio</span>
                        <strong>{money(item.sellingPrice)}</strong>
                      </div>
                    ) : null}
                  </div>

                  {item ? (
                    <div className={item.sellingPrice >= product.wholesalePrice ? "catalog-margin" : "catalog-margin loss"}>
                      <span>{item.sellingPrice >= product.wholesalePrice ? "Ganancia bruta estimada" : "Venderías por debajo del mayorista"}</span>
                      <strong>{money(item.sellingPrice - product.wholesalePrice)}</strong>
                    </div>
                  ) : null}

                  {isEditing ? (
                    <form className="reseller-catalog-price-form" onSubmit={(event) => handleSavePrice(event, product, item)}>
                      <label className="field">
                        <span>Tu precio de venta (USD)</span>
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          inputMode="decimal"
                          required
                          autoFocus
                          value={priceDraft}
                          onChange={(event) => setPriceDraft(event.target.value)}
                          placeholder="Ej. 29.99"
                        />
                      </label>
                      {priceDraft && Number.isFinite(Number(priceDraft)) ? (
                        <div className={margin >= 0 ? "catalog-margin preview" : "catalog-margin preview loss"}>
                          <span>Ganancia estimada por unidad</span>
                          <strong>{money(Number(priceDraft) - product.wholesalePrice)}</strong>
                        </div>
                      ) : null}
                      <div className="reseller-catalog-card-actions">
                        <button className="primary-button" type="submit" disabled={saveItem.isPending}>
                          <Check size={14} /> {saveItem.isPending ? "Guardando..." : "Guardar precio"}
                        </button>
                        <button className="secondary-button" type="button" onClick={() => { setEditingProductId(null); setPriceDraft(""); }}>
                          <X size={14} /> Cancelar
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="reseller-catalog-card-actions">
                      {item ? (
                        <>
                          <button type="button" className="product-card-action primary" onClick={() => openEditor(product, item)}>
                            Editar precio
                          </button>
                          <button
                            type="button"
                            className="product-card-action danger"
                            disabled={removeItem.isPending}
                            onClick={() => {
                              if (window.confirm("¿Quitar este producto de tu catálogo?")) {
                                setActionError("");
                                removeItem.mutate(item._id);
                              }
                            }}
                          >
                            <Trash2 size={14} /> Quitar
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="product-card-action primary"
                          disabled={product.availableStock <= 0}
                          onClick={() => openEditor(product)}
                        >
                          <Plus size={14} /> Añadir a mi catálogo
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </section>
      ) : (
        <div className="panel-card dashboard-empty product-empty">
          <div className="dashboard-empty-icon"><Package size={20} /></div>
          <strong>{search ? "No encontramos productos" : activeTab === "mine" ? "Tu catálogo todavía está vacío" : "No hay productos disponibles"}</strong>
          <span>
            {search
              ? "Prueba con otro término de búsqueda."
              : activeTab === "mine"
                ? "Entra en “Explorar productos”, elige un artículo disponible y define tu precio de venta."
                : "Cuando tu proveedor publique productos con existencias, aparecerán aquí."}
          </span>
          {activeTab === "mine" && !search ? (
            <button className="secondary-action" type="button" onClick={() => setActiveTab("explore")}>Explorar productos</button>
          ) : null}
        </div>
      )}
    </div>
  );
}
