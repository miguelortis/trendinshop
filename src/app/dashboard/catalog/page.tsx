"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, ExternalLink, Layers, Package, Plus, Search, ShoppingBag, Trash2, X } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useMemo, useState } from "react";
import { api } from "@/lib/api/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { ShareProductActions } from "@/components/catalog/ShareProductActions";

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
  variants: { _id: string; label: string; sku: string; options: { name: string; value: string }[]; stock: number; wholesalePrice: number }[];
};
type CatalogItem = {
  _id: string;
  productId: string;
  sellingPrice: number;
  variantPrices?: { variantId: string; sellingPrice: number }[];
};
type CatalogResponse = {
  ok: true;
  products: CatalogProduct[];
  items: CatalogItem[];
};
type CatalogCombo = {
  _id: string; title: string; description: string; profitMode: "FIXED" | "PERCENT"; profitValue: number;
  components: { productId: string; quantity: number; product: { title: string; wholesalePrice: number; images: { url: string; alt?: string; isPrimary?: boolean }[] }; variants: { _id: string; stock: number; wholesalePrice: number }[] }[];
};
type CombosResponse = { ok: true; combos: CatalogCombo[] };
type SavePayload = {
  productId: string;
  itemId?: string;
  sellingPrice: number;
  variantPrices: { variantId: string; sellingPrice: number }[];
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
  const [variantPriceDrafts, setVariantPriceDrafts] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState("");
  const [shareCopied, setShareCopied] = useState(false);
  const [addMenuProductId, setAddMenuProductId] = useState<string | null>(null);
  const [comboBuilderOpen, setComboBuilderOpen] = useState(false);
  const [comboSearch, setComboSearch] = useState("");
  const [comboSelection, setComboSelection] = useState<string[]>([]);
  const [comboQuantities, setComboQuantities] = useState<Record<string, string>>({});
  const [comboTitle, setComboTitle] = useState("");
  const [comboDescription, setComboDescription] = useState("");
  const [comboProfitMode, setComboProfitMode] = useState<"FIXED" | "PERCENT">("FIXED");
  const [comboProfitValue, setComboProfitValue] = useState("5");

  const catalog = useQuery({
    queryKey: ["reseller-catalog"],
    enabled: user?.role === "RESELLER" || user?.role === "ADMIN",
    queryFn: async () => (await api.get<CatalogResponse>("/catalog")).data,
  });

  const itemByProductId = useMemo(() => {
    const items = new Map<string, CatalogItem>();
    for (const item of catalog.data?.items ?? []) {
      items.set(item.productId, item);
    }
    return items;
  }, [catalog.data?.items]);

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

  const combos = useQuery({
    queryKey: ["reseller-combos"],
    enabled: user?.role === "RESELLER" || user?.role === "ADMIN",
    queryFn: async () => (await api.get<CombosResponse>("/combos")).data,
  });
  const comboProducts = useMemo(() => {
    const term = comboSearch.trim().toLowerCase();
    return (catalog.data?.products ?? []).filter((product) => product.availableStock > 0)
      .filter((product) => !term || [product.title, product.sku].join(" ").toLowerCase().includes(term));
  }, [catalog.data?.products, comboSearch]);
  const selectedComboProducts = useMemo(
    () => comboSelection.flatMap((id) => {
      const product = catalog.data?.products.find((item) => item._id === id);
      return product ? [product] : [];
    }),
    [comboSelection, catalog.data?.products],
  );
  const createCombo = useMutation({
    mutationFn: async () => api.post("/combos", {
      title: comboTitle, description: comboDescription, profitMode: comboProfitMode,
      profitValue: Number(comboProfitValue),
      components: comboSelection.map((productId) => ({ productId, quantity: Math.max(1, Math.min(50, Number(comboQuantities[productId]) || 1)) })),
    }),
    onSuccess: async () => {
      setComboBuilderOpen(false); setComboSelection([]); setComboQuantities({}); setComboSearch(""); setComboTitle("");
      setComboDescription(""); setComboProfitMode("FIXED"); setComboProfitValue("5");
      setActionError("");
      await queryClient.invalidateQueries({ queryKey: ["reseller-combos"] });
    },
    onError: (error: unknown) => setActionError(errorMessage(error)),
  });
  const removeCombo = useMutation({
    mutationFn: async (comboId: string) => api.delete("/combos/" + comboId),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["reseller-combos"] }); },
    onError: (error: unknown) => setActionError(errorMessage(error)),
  });
  function openComboBuilder(initialProductId?: string) {
    setActionError(""); setComboSelection(initialProductId ? [initialProductId] : []);
    setComboQuantities(initialProductId ? { [initialProductId]: "1" } : {});
    setComboSearch(""); setComboBuilderOpen(true);
  }
  function toggleComboProduct(productId: string) {
    const removing = comboSelection.includes(productId);
    setComboSelection((current) => removing
      ? current.filter((id) => id !== productId)
      : current.length < 5 ? [...current, productId] : current);
    setComboQuantities((current) => {
      if (removing) {
        const next = { ...current };
        delete next[productId];
        return next;
      }
      return { ...current, [productId]: "1" };
    });
  }
  function comboSellingPrice(base: number, mode: "FIXED" | "PERCENT", value: number) {
    return Number((mode === "PERCENT" ? base * (1 + value / 100) : base + value).toFixed(2));
  }

  const saveItem = useMutation({
    mutationFn: async ({ productId, itemId, sellingPrice, variantPrices }: SavePayload) => {
      if (itemId) {
        return (await api.patch("/catalog/" + itemId, { sellingPrice, variantPrices })).data;
      }
      return (await api.post("/catalog", { productId, sellingPrice, variantPrices })).data;
    },
    onSuccess: async () => {
      setEditingProductId(null);
      setPriceDraft("");
      setVariantPriceDrafts({});
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
    setVariantPriceDrafts(Object.fromEntries((item?.variantPrices ?? []).map((variant) => [variant.variantId, String(variant.sellingPrice)])));
  }

  function handleSavePrice(event: FormEvent<HTMLFormElement>, product: CatalogProduct, item?: CatalogItem) {
    event.preventDefault();
    setActionError("");
    saveItem.mutate({
      productId: product._id,
      itemId: item?._id,
      sellingPrice: Number(priceDraft),
      variantPrices: product.variants
        .map((variant) => {
          const raw = variantPriceDrafts[variant._id];
          return raw !== undefined && raw.trim() !== "" && Number.isFinite(Number(raw)) && Number(raw) > 0
            ? { variantId: variant._id, sellingPrice: Number(raw) }
            : null;
        })
        .filter((item): item is { variantId: string; sellingPrice: number } => item !== null),
    });
  }

  async function handleCopyPublicCatalog() {
    if (!user?.id) return;
    const shareUrl = window.location.origin + "/tienda/" + user.id;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareCopied(true);
      setActionError("");
    } catch {
      setShareCopied(false);
      setActionError("No pudimos copiar el enlace automáticamente. Abre “Ver catálogo público” y copia la dirección del navegador.");
    }
  }

  if (userLoading) {
    return <div className="dashboard-page"><div className="panel-card dashboard-loading">Cargando tu cuenta...</div></div>;
  }

  if (user?.role !== "RESELLER" && user?.role !== "ADMIN") {
    return (
      <div className="dashboard-page">
        <section className="page-heading">
          <div>
            <span className="page-kicker">Catálogo personal</span>
            <h1>Mi catálogo</h1>
            <p>Necesitas iniciar sesión con una cuenta válida para administrar un catálogo.</p>
          </div>
        </section>
        <div className="panel-card reseller-catalog-restricted">
          <ShoppingBag size={28} />
          <strong>No se puede abrir el catálogo personal</strong>
          <span>Tu cuenta no tiene permisos para administrar este catálogo.</span>
        </div>
      </div>
    );
  }

  const savedCount = catalog.data?.items.length ?? 0;

  return (
    <div className="dashboard-page reseller-catalog-page">
      <section className="page-heading reseller-catalog-heading">
        <div>
          <span className="page-kicker">Venta personalizada</span>
          <h1>Mi catálogo</h1>
          <p>Agrega productos individuales o agrupa varios para crear combos personalizables.</p>
        </div>
        <div className="reseller-catalog-heading-actions">
          <Link
            href={"/tienda/" + user.id}
            target="_blank"
            rel="noreferrer"
            className="product-card-action reseller-public-action"
          >
            <ExternalLink size={14} /> Ver catálogo público
          </Link>
          <button
            type="button"
            className="product-card-action primary reseller-share-button"
            onClick={() => void handleCopyPublicCatalog()}
          >
            <Copy size={14} /> {shareCopied ? "Enlace copiado" : "Copiar enlace"}
          </button>
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
            onClick={() => { setActiveTab("explore"); setActionError(""); setEditingProductId(null); setVariantPriceDrafts({}); }}
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
            const catalogVariantPrices = new Map((item?.variantPrices ?? []).map((entry) => [entry.variantId, entry.sellingPrice]));
            const isEditing = editingProductId === product._id;

            return (
              <article className={`product-card reseller-catalog-card ${addMenuProductId === product._id ? "add-menu-open" : ""}`} key={product._id}>
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

                  {item && product.variants.length > 1 ? (
                    <div className="catalog-variant-profit-list">
                      <span className="catalog-variant-profit-title">Ganancia estimada por variante</span>
                      {product.variants.map((variant) => {
                        const variantPrice = catalogVariantPrices.get(variant._id) ?? item.sellingPrice;
                        const variantProfit = variantPrice - variant.wholesalePrice;
                        return (
                          <div className="catalog-variant-profit-row" key={variant._id}>
                            <span>{variant.label}</span>
                            <small>Costo {money(variant.wholesalePrice)} · Venta {money(variantPrice)}</small>
                            <strong className={variantProfit >= 0 ? "" : "loss"}>{money(variantProfit)}</strong>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}

                  {isEditing ? (
                    <form className="reseller-catalog-price-form" onSubmit={(event) => handleSavePrice(event, product, item)}>
                      <label className="field">
                        <span>Precio general de venta (USD)</span>
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
                      {product.variants.length > 1 ? (
                        <div className="catalog-variant-price-editor">
                          <div>
                            <strong>Precios por variante</strong>
                            <small>Deja el precio general para las variantes que no quieras personalizar.</small>
                          </div>
                          {product.variants.map((variant) => {
                            const raw = variantPriceDrafts[variant._id];
                            const effectivePrice = raw === undefined || raw.trim() === "" ? Number(priceDraft) : Number(raw);
                            const estimatedProfit = effectivePrice - variant.wholesalePrice;
                            return (
                              <label className="field catalog-variant-price-row" key={variant._id}>
                                <span>{variant.label} · Costo {money(variant.wholesalePrice)}</span>
                                <div className="catalog-variant-price-input">
                                  <input
                                    type="number"
                                    min="0.01"
                                    step="0.01"
                                    inputMode="decimal"
                                    value={raw ?? ""}
                                    onChange={(event) => setVariantPriceDrafts((current) => ({ ...current, [variant._id]: event.target.value }))}
                                    placeholder={priceDraft || "Usar precio general"}
                                  />
                                  <small className={estimatedProfit >= 0 ? "" : "loss"}>Ganancia: {Number.isFinite(estimatedProfit) ? money(estimatedProfit) : "—"}</small>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      ) : null}
                      <div className="reseller-catalog-card-actions">
                        <button className="primary-button" type="submit" disabled={saveItem.isPending}>
                          <Check size={14} /> {saveItem.isPending ? "Guardando..." : "Guardar precio"}
                        </button>
                        <button className="secondary-button" type="button" onClick={() => { setEditingProductId(null); setPriceDraft(""); setVariantPriceDrafts({}); }}>
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
                        <div className="reseller-card-add-menu">
                          <button
                            type="button"
                            className="product-card-action primary"
                            disabled={product.availableStock <= 0}
                            aria-haspopup="menu"
                            aria-expanded={addMenuProductId === product._id}
                            onClick={() => setAddMenuProductId((current) => current === product._id ? null : product._id)}
                          >
                            <Plus size={14} /> Añadir a mi catálogo
                          </button>
                          {addMenuProductId === product._id ? (
                            <div className="reseller-card-add-menu-panel" role="menu">
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setAddMenuProductId(null);
                                  openEditor(product);
                                }}
                              >
                                <Package size={17} />
                                <span><strong>Producto individual</strong><small>Añadir este producto a tu catálogo.</small></span>
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setAddMenuProductId(null);
                                  openComboBuilder(product._id);
                                }}
                              >
                                <Layers size={17} />
                                <span><strong>Crear Pack</strong><small>Incluir este producto en un pack.</small></span>
                              </button>
                            </div>
                          ) : null}
                        </div>
                      )}
                    </div>
                  )}
                  {item && !isEditing ? (
                    <ShareProductActions
                      title={product.title}
                      description={product.description || product.title}
                      productUrl={"/tienda/" + user.id + "/producto/" + product._id}
                      imageUrl={primaryImage?.url}
                    />
                  ) : null}
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

      {comboBuilderOpen ? (
        <div className="combo-builder-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !createCombo.isPending) setComboBuilderOpen(false);
        }}>
          <section className="combo-builder-dialog" role="dialog" aria-modal="true" aria-labelledby="combo-builder-title">
            <header className="combo-builder-header">
              <div><span className="page-kicker">Publicación agrupada</span><h2 id="combo-builder-title">Crear combo</h2><p>Selecciona de 2 a 5 productos del catálogo general. No necesitas publicarlos individualmente.</p></div>
              <button type="button" className="product-card-action" onClick={() => setComboBuilderOpen(false)} disabled={createCombo.isPending} aria-label="Cerrar"><X size={16}/></button>
            </header>
            <div className="combo-builder-selection">
              <div className="combo-builder-section-heading"><strong>Seleccionados</strong><span>{comboSelection.length} / 5</span></div>
              <div className="combo-builder-selected-list combo-builder-selected-rows">
                {selectedComboProducts.map((product) => (
                  <div className="combo-builder-selected-row" key={product._id}>
                    <strong>{product.title}</strong>
                    <label>Cant. <input type="number" min="1" max="50" value={comboQuantities[product._id] ?? "1"} onChange={(event) => setComboQuantities((current) => ({ ...current, [product._id]: event.target.value }))}/></label>
                    <button type="button" aria-label={"Quitar " + product.title} onClick={() => toggleComboProduct(product._id)}><X size={14}/></button>
                  </div>
                ))}
                {!selectedComboProducts.length ? <small>Aún no has seleccionado productos.</small> : null}
              </div>
            </div>
            <label className="search-field combo-builder-search"><Search size={16}/><input value={comboSearch} onChange={(event) => setComboSearch(event.target.value)} placeholder="Buscar productos por nombre o SKU..." /></label>
            <div className="combo-builder-product-list">
              {comboProducts.map((product) => {
                const selected = comboSelection.includes(product._id);
                const image = product.images?.find((entry) => entry.isPrimary) ?? product.images?.[0];
                return <button type="button" key={product._id} className={"combo-builder-product" + (selected ? " selected" : "")} onClick={() => toggleComboProduct(product._id)} disabled={!selected && comboSelection.length >= 5}>
                  <span className={"combo-builder-check" + (selected ? " checked" : "")}>{selected ? <Check size={14}/> : null}</span>
                  <span className="combo-builder-product-image">{image ? <img src={image.url} alt={image.alt || product.title}/> : <Package size={20}/>}</span>
                  <span className="combo-builder-product-copy"><strong>{product.title}</strong><small>SKU {product.sku} · {product.availableStock} disponibles</small></span>
                  <strong className="combo-builder-product-price">{money(product.wholesalePrice)}</strong>
                </button>;
              })}
              {!comboProducts.length ? <small>No hay productos disponibles que coincidan con la búsqueda.</small> : null}
            </div>
            <div className="combo-builder-form">
              <label className="field"><span>Nombre del combo *</span><input value={comboTitle} onChange={(event) => setComboTitle(event.target.value)} maxLength={100} placeholder="Ej. Combo de destapadores"/></label>
              <label className="field"><span>Descripción</span><textarea value={comboDescription} onChange={(event) => setComboDescription(event.target.value)} maxLength={1000} rows={2} placeholder="Describe qué incluye..."/></label>
              <div className="combo-builder-profit-grid">
                <label className="field"><span>Tipo de ganancia</span><select value={comboProfitMode} onChange={(event) => setComboProfitMode(event.target.value as "FIXED" | "PERCENT")}><option value="FIXED">Importe fijo</option><option value="PERCENT">Porcentaje</option></select></label>
                <label className="field"><span>{comboProfitMode === "FIXED" ? "Ganancia (USD)" : "Ganancia (%)"}</span><input type="number" min="0.01" max={comboProfitMode === "PERCENT" ? "500" : "100000"} step="0.01" value={comboProfitValue} onChange={(event) => setComboProfitValue(event.target.value)}/></label>
              </div>
              {selectedComboProducts.length >= 2 ? (() => {
                const minimum = selectedComboProducts.reduce((sum, product) => {
                  const costs = product.variants.filter((variant) => variant.stock > 0).map((variant) => variant.wholesalePrice);
                  return sum + (costs.length ? Math.min(...costs) : product.wholesalePrice) * Math.max(1, Number(comboQuantities[product._id]) || 1);
                }, 0);
                const maximum = selectedComboProducts.reduce((sum, product) => {
                  const costs = product.variants.filter((variant) => variant.stock > 0).map((variant) => variant.wholesalePrice);
                  return sum + (costs.length ? Math.max(...costs) : product.wholesalePrice) * Math.max(1, Number(comboQuantities[product._id]) || 1);
                }, 0);
                return <div className="combo-builder-price-preview"><span>Precio estimado</span><strong>{money(comboSellingPrice(minimum, comboProfitMode, Number(comboProfitValue) || 0))} – {money(comboSellingPrice(maximum, comboProfitMode, Number(comboProfitValue) || 0))}</strong><small>El precio final se ajustará a las variantes que el cliente seleccione.</small></div>;
              })() : null}
              {createCombo.isError ? <p className="auth-error">{errorMessage(createCombo.error)}</p> : null}
              <div className="combo-builder-actions">
                <button type="button" className="secondary-button" onClick={() => setComboBuilderOpen(false)} disabled={createCombo.isPending}>Cancelar</button>
                <button type="button" className="primary-button" onClick={() => createCombo.mutate()} disabled={createCombo.isPending || comboSelection.length < 2 || !comboTitle.trim() || !Number.isFinite(Number(comboProfitValue)) || Number(comboProfitValue) <= 0}><Layers size={15}/>{createCombo.isPending ? "Creando..." : "Crear combo"}</button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      <section className="reseller-combos-section">
        <div className="reseller-combos-heading"><div><span className="page-kicker">Publicaciones agrupadas</span><h2>Mis combos <small>{combos.data?.combos.length ?? 0}</small></h2></div></div>
        {combos.isLoading ? <div className="panel-card dashboard-loading">Cargando combos...</div> : combos.data?.combos.length ? (
          <div className="reseller-combos-grid">
            {combos.data.combos.map((combo) => {
              const baseMin = combo.components.reduce((sum, component) => {
                const values = component.variants.filter((variant) => variant.stock > 0).map((variant) => variant.wholesalePrice);
                return sum + (values.length ? Math.min(...values) : component.product.wholesalePrice) * component.quantity;
              }, 0);
              const baseMax = combo.components.reduce((sum, component) => {
                const values = component.variants.filter((variant) => variant.stock > 0).map((variant) => variant.wholesalePrice);
                return sum + (values.length ? Math.max(...values) : component.product.wholesalePrice) * component.quantity;
              }, 0);
              return <article className="reseller-combo-card" key={combo._id}>
                <div className="reseller-combo-images">{combo.components.map((component) => {
                  const image = component.product.images?.find((entry) => entry.isPrimary) ?? component.product.images?.[0];
                  return <span key={component.productId}>{image ? <img src={image.url} alt={component.product.title}/> : <Package size={18}/>}</span>;
                })}<span className="reseller-combo-mark"><Layers size={14}/> COMBO</span></div>
                <div className="reseller-combo-card-copy"><h3>{combo.title}</h3><p>{combo.components.map((component) => component.quantity + " × " + component.product.title).join(" · ")}</p><strong>{money(comboSellingPrice(baseMin, combo.profitMode, combo.profitValue))}{baseMax !== baseMin ? " – " + money(comboSellingPrice(baseMax, combo.profitMode, combo.profitValue)) : ""}</strong></div>
                <button type="button" className="product-card-action danger" onClick={() => { if (window.confirm("¿Retirar este combo? Los productos originales no se modificarán.")) removeCombo.mutate(combo._id); }} disabled={removeCombo.isPending}><Trash2 size={14}/> Retirar combo</button>
              </article>;
            })}
          </div>
        ) : <div className="panel-card dashboard-empty product-empty"><div className="dashboard-empty-icon"><Layers size={20}/></div><strong>Aún no has creado combos</strong><span>Agrupa productos del catálogo general para publicarlos como un solo artículo.</span></div>}
      </section>
    </div>
  );
}
