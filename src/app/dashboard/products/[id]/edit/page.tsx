"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Calculator, Check, FolderPlus, Package, Percent, Plus, RefreshCw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api/client";
import { ProductImageUploader, type ProductImageInput } from "@/components/products/ProductImageUploader";
import { useCurrentUser } from "@/hooks/useCurrentUser";

type Category = { _id: string; name: string };

type ProductDetailsResponse = {
  ok: true;
  product: {
    _id: string;
    title: string;
    sku: string;
    description?: string;
    categoryId: { _id: string; name: string; slug: string } | string;
    purchasePrice: number;
    wholesalePrice: number;
    images: ProductImageInput[];
  };
  variants: {
    _id: string;
    label: string;
    sku: string;
    purchasePrice: number | null;
    wholesalePrice: number | null;
    stock: number;
    lowStockThreshold: number;
    options: { name: string; value: string }[];
  }[];
};

type ProductVariantInput = {
  _id?: string;
  label: string;
  sku: string;
  purchasePrice: string;
  wholesalePrice: string;
  stock: string;
  lowStockThreshold: string;
  options: { name: string; value: string }[];
};

type PricingMode = "margin" | "profit";

const blankVariant = (): ProductVariantInput => ({
  label: "",
  sku: "",
  purchasePrice: "",
  wholesalePrice: "",
  stock: "0",
  lowStockThreshold: "3",
  options: [{ name: "", value: "" }],
});

function makeSku(title: string) {
  return title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28);
}

export default function EditProductPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const productId = params.id;
  const { data: user, isLoading: userLoading } = useCurrentUser();
  const [hydrated, setHydrated] = useState(false);
  const productQuery = useQuery({
    queryKey: ["product", productId],
    queryFn: async () =>
      (await api.get<ProductDetailsResponse>(`/products/${productId}`)).data,
    enabled: Boolean(productId) && user?.role === "ADMIN",
  });

  const [title, setTitle] = useState("");
  const [sku, setSku] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [description, setDescription] = useState("");
  const [images, setImages] = useState<ProductImageInput[]>([]);

  const [purchasePrice, setPurchasePrice] = useState("");
  const [wholesalePrice, setWholesalePrice] = useState("");
  const [pricingMode, setPricingMode] = useState<PricingMode>("margin");
  const [pricingTarget, setPricingTarget] = useState("35");

  const [stock, setStock] = useState("0");
  const [lowStockThreshold, setLowStockThreshold] = useState("3");
  const [variants, setVariants] = useState<ProductVariantInput[]>([]);

  const [categoryOpen, setCategoryOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryDescription, setNewCategoryDescription] = useState("");
  const [categorySaving, setCategorySaving] = useState(false);
  const [categoryError, setCategoryError] = useState("");

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const details = productQuery.data;
    if (!details?.product || hydrated) return;

    const product = details.product;
    setTitle(product.title);
    setSku(product.sku);
    setCategoryId(
      typeof product.categoryId === "object"
        ? product.categoryId._id
        : product.categoryId,
    );
    setDescription(product.description ?? "");
    setImages(product.images ?? []);
    setPurchasePrice(String(product.purchasePrice));
    setWholesalePrice(String(product.wholesalePrice));

    setVariants(
      details.variants.map((variant) => ({
        _id: variant._id,
        label: variant.label,
        sku: variant.sku,
        purchasePrice:
          variant.purchasePrice === null ? "" : String(variant.purchasePrice),
        wholesalePrice:
          variant.wholesalePrice === null ? "" : String(variant.wholesalePrice),
        stock: String(variant.stock),
        lowStockThreshold: String(variant.lowStockThreshold),
        options: variant.options?.length
          ? variant.options.map((option) => ({ ...option }))
          : [{ name: "", value: "" }],
      })),
    );
    setStock(String(details.variants[0]?.stock ?? 0));
    setLowStockThreshold(String(details.variants[0]?.lowStockThreshold ?? 3));
    setHydrated(true);
  }, [productQuery.data, hydrated]);

  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: async () =>
      (await api.get<{ ok: true; categories: Category[] }>("/categories")).data.categories,
    enabled: user?.role === "ADMIN",
  });

  const priceCalculation = useMemo(() => {
    const cost = Number(purchasePrice);
    const target = Number(pricingTarget);

    if (!Number.isFinite(cost) || cost < 0 || !Number.isFinite(target) || target < 0) {
      return { finalPrice: 0, profit: 0, margin: 0, valid: false };
    }

    if (pricingMode === "margin") {
      if (target >= 100) {
        return { finalPrice: 0, profit: 0, margin: 0, valid: false };
      }

      const finalPrice = cost === 0 ? 0 : cost / (1 - target / 100);
      const profit = finalPrice - cost;
      const margin = finalPrice > 0 ? (profit / finalPrice) * 100 : 0;

      return { finalPrice, profit, margin, valid: true };
    }

    const finalPrice = cost + target;
    const profit = target;
    const margin = finalPrice > 0 ? (profit / finalPrice) * 100 : 0;

    return { finalPrice, profit, margin, valid: true };
  }, [purchasePrice, pricingMode, pricingTarget]);

  function applyCalculatedPrice() {
    if (priceCalculation.valid) {
      setWholesalePrice(priceCalculation.finalPrice.toFixed(2));
    }
  }

  function regenerateSku() {
    setSku(makeSku(title));
  }

  function addVariant() {
    setVariants((current) => [...current, blankVariant()]);
  }

  function removeVariant(index: number) {
    setVariants((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }

  function updateVariantField(
    index: number,
    key: keyof Omit<ProductVariantInput, "options">,
    value: string,
  ) {
    setVariants((current) =>
      current.map((variant, variantIndex) =>
        variantIndex === index ? { ...variant, [key]: value } : variant,
      ),
    );
  }

  function updateOption(
    variantIndex: number,
    optionIndex: number,
    key: "name" | "value",
    value: string,
  ) {
    setVariants((current) =>
      current.map((variant, currentVariantIndex) =>
        currentVariantIndex !== variantIndex
          ? variant
          : {
              ...variant,
              options: variant.options.map((option, currentOptionIndex) =>
                currentOptionIndex === optionIndex ? { ...option, [key]: value } : option,
              ),
            },
      ),
    );
  }

  function addOption(variantIndex: number) {
    setVariants((current) =>
      current.map((variant, currentVariantIndex) =>
        currentVariantIndex === variantIndex
          ? { ...variant, options: [...variant.options, { name: "", value: "" }] }
          : variant,
      ),
    );
  }

  function removeOption(variantIndex: number, optionIndex: number) {
    setVariants((current) =>
      current.map((variant, currentVariantIndex) =>
        currentVariantIndex === variantIndex
          ? {
              ...variant,
              options: variant.options.filter((_, currentOptionIndex) => currentOptionIndex !== optionIndex),
            }
          : variant,
      ),
    );
  }

  async function handleCreateCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCategoryError("");
    setCategorySaving(true);

    try {
      const response = await api.post<{ ok: true; category: Category }>("/categories", {
        name: newCategoryName,
        description: newCategoryDescription,
      });

      await categories.refetch();
      setCategoryId(response.data.category._id);
      setNewCategoryName("");
      setNewCategoryDescription("");
      setCategoryOpen(false);
    } catch (requestError: any) {
      setCategoryError(
        requestError?.response?.data?.message ?? "No pudimos crear la categoría.",
      );
    } finally {
      setCategorySaving(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!categoryId) {
      setError("Selecciona una categoría para el producto.");
      return;
    }

    if (!purchasePrice || !wholesalePrice) {
      setError("Completa el precio de compra y el precio mayorista.");
      return;
    }

    if (Number(wholesalePrice) < Number(purchasePrice)) {
      setError("El precio mayorista no puede ser menor que el precio de compra.");
      return;
    }

    setSaving(true);

    try {
      await api.put(`/products/${productId}`, {
        title,
        sku,
        categoryId,
        description,
        images,
        purchasePrice,
        wholesalePrice,
        stock,
        lowStockThreshold,
        variants: variants.map((variant) => ({
          ...variant,
          options: variant.options.filter((option) => option.name.trim() && option.value.trim()),
        })),
      });

      router.push(`/dashboard/products/${productId}`);
      router.refresh();
    } catch (requestError: any) {
      setError(
        requestError?.response?.data?.message ?? "No pudimos guardar los cambios del producto.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (userLoading) {
    return <div className="dashboard-empty">Cargando...</div>;
  }

  if (user?.role === "ADMIN" && (productQuery.isLoading || (productQuery.data && !hydrated))) {
    return <div className="dashboard-empty">Cargando producto...</div>;
  }

  if (user?.role === "ADMIN" && (productQuery.isError || !productQuery.data?.product)) {
    return (
      <div className="dashboard-page">
        <div className="panel-card dashboard-empty">
          <div className="dashboard-empty-icon"><Package size={20} /></div>
          <strong>No pudimos cargar el producto</strong>
          <span>Puede que el producto no exista o que haya ocurrido un error al consultarlo.</span>
          <Link href="/dashboard/products" className="secondary-action">Volver a productos</Link>
        </div>
      </div>
    );
  }

  if (user?.role !== "ADMIN") {
    return (
      <div className="dashboard-page">
        <div className="panel-card dashboard-empty">
          <div className="dashboard-empty-icon"><ArrowLeft size={20} /></div>
          <strong>Solo disponible para administradores</strong>
          <span>Los productos maestros son administrados por el proveedor.</span>
          <Link href="/dashboard/products" className="secondary-action">Volver a productos</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-page">
      <Link href={`/dashboard/products/${productId}`} className="back-dashboard-link">
        <ArrowLeft size={16} /> Volver al producto
      </Link>

      <section className="page-heading product-form-heading">
        <div>
          <span className="page-kicker">Catálogo maestro</span>
          <h1>Editar producto</h1>
          <p>Actualiza la información, imágenes, precios, variantes e inventario del producto.</p>
        </div>
      </section>

      <form onSubmit={handleSubmit} className="product-form-layout">
        <div className="product-form-main">
          <section className="panel-card">
            <div className="panel-header">
              <div>
                <span className="panel-kicker">Información básica</span>
                <h2>Producto</h2>
              </div>
            </div>

            <div className="form-grid two">
              <label className="field">
                <span>Nombre del producto</span>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Ej. Vaso Térmico Premium"
                  required
                />
              </label>

              <label className="field">
                <span>SKU maestro</span>
                <div className="sku-input-row">
                  <input
                    value={sku}
                    onChange={(event) => {
                      setSku(event.target.value.toUpperCase());
                    }}
                    placeholder="Se genera automáticamente"
                    required
                  />
                  <button
                    type="button"
                    className="icon-button"
                    onClick={regenerateSku}
                    title="Generar SKU desde el nombre"
                    aria-label="Regenerar SKU"
                  >
                    <RefreshCw size={16} />
                  </button>
                </div>
                <small className="field-help">
                  Se genera automáticamente, pero puedes editarlo libremente.
                </small>
              </label>
            </div>

            <div className="category-select-row">
              <label className="field">
                <span>Categoría</span>
                <select
                  value={categoryId}
                  onChange={(event) => setCategoryId(event.target.value)}
                  required
                >
                  <option value="">Selecciona una categoría</option>
                  {categories.data?.map((category) => (
                    <option key={category._id} value={category._id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="button"
                className="secondary-button create-category-button"
                onClick={() => setCategoryOpen(true)}
              >
                <FolderPlus size={15} /> Crear categoría
              </button>
            </div>

            <label className="field">
              <span>Descripción</span>
              <textarea
                className="field-textarea"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Describe el producto, materiales, características..."
                rows={5}
              />
            </label>
          </section>

          <section className="panel-card">
            <div className="panel-header">
              <div>
                <span className="panel-kicker">Imágenes</span>
                <h2>Fotos del producto</h2>
              </div>
            </div>

            <ProductImageUploader key={productId} value={images} onChange={setImages} />
          </section>

          <section className="panel-card">
            <div className="panel-header">
              <div>
                <span className="panel-kicker">Precio y rentabilidad</span>
                <h2>¿Cuánto quieres ganar?</h2>
              </div>
              <Calculator size={18} color="#6941c6" />
            </div>

            <div className="pricing-main-grid">
              <label className="field">
                <span>Precio de compra</span>
                <div className="money-input"><span>$</span><input type="number" min="0" step="0.01" value={purchasePrice} onChange={(event) => setPurchasePrice(event.target.value)} placeholder="10.00" required /></div>
                <small className="field-help">Lo que te cuesta adquirir una unidad.</small>
              </label>

              <div className="pricing-target-card">
                <div className="pricing-mode-tabs">
                  <button type="button" className={pricingMode === "margin" ? "active" : ""} onClick={() => setPricingMode("margin")}>
                    <Percent size={14} /> Margen
                  </button>
                  <button type="button" className={pricingMode === "profit" ? "active" : ""} onClick={() => setPricingMode("profit")}>
                    <span>$</span> Ganancia fija
                  </button>
                </div>

                <label className="field">
                  <span>{pricingMode === "margin" ? "Margen deseado" : "Ganancia por unidad"}</span>
                  <div className="money-input">
                    <span>{pricingMode === "margin" ? "%" : "$"}</span>
                    <input
                      type="number"
                      min="0"
                      max={pricingMode === "margin" ? "99.99" : undefined}
                      step="0.01"
                      value={pricingTarget}
                      onChange={(event) => setPricingTarget(event.target.value)}
                    />
                  </div>
                </label>
              </div>
            </div>

            <div className="pricing-result">
              <div>
                <span>Precio mayorista sugerido</span>
                <strong>{"$"}{priceCalculation.finalPrice.toFixed(2)}</strong>
              </div>
              <div>
                <span>Ganancia por unidad</span>
                <strong>{"$"}{priceCalculation.profit.toFixed(2)}</strong>
              </div>
              <div>
                <span>Margen real</span>
                <strong>{priceCalculation.margin.toFixed(1)}%</strong>
              </div>
              <button type="button" className="primary-button" onClick={applyCalculatedPrice} disabled={!priceCalculation.valid}>
                <Check size={15} /> Usar precio sugerido
              </button>
            </div>

            <div className="form-grid two pricing-final-inputs">
              <label className="field">
                <span>Precio mayorista final</span>
                <div className="money-input"><span>$</span><input type="number" min="0" step="0.01" value={wholesalePrice} onChange={(event) => setWholesalePrice(event.target.value)} placeholder="Se calculará arriba" required /></div>
              </label>
              <div className="pricing-explainer">
                <strong>Este es tu precio de venta al mayor.</strong>
                <span>El sistema conservará el precio de compra y el precio mayorista para calcular tu ganancia en cada venta.</span>
              </div>
            </div>
          </section>

          <section className="panel-card">
            <div className="panel-header">
              <div>
                <span className="panel-kicker">Variantes</span>
                <h2>Opciones e inventario</h2>
              </div>
              <button type="button" className="secondary-button" onClick={addVariant}>
                <Plus size={15} /> Agregar variante
              </button>
            </div>

            {variants.length === 0 ? (
              <div className="variant-simple-box">
                <strong>Producto sin variantes</strong>
                <span>Usaremos una única variante con el SKU maestro.</span>

                <div className="form-grid two">
                  <label className="field">
                    <span>Stock inicial</span>
                    <input type="number" min="0" value={stock} onChange={(event) => setStock(event.target.value)} />
                  </label>
                  <label className="field">
                    <span>Alertar cuando queden</span>
                    <input type="number" min="0" value={lowStockThreshold} onChange={(event) => setLowStockThreshold(event.target.value)} />
                  </label>
                </div>
              </div>
            ) : (
              <div className="variant-list">
                {variants.map((variant, index) => (
                  <div className="variant-editor" key={index}>
                    <div className="variant-editor-head">
                      <strong>Variante {index + 1}</strong>
                      <button type="button" className="icon-button danger-icon" onClick={() => removeVariant(index)} aria-label="Eliminar variante">
                        <Trash2 size={15} />
                      </button>
                    </div>

                    <div className="form-grid two">
                      <label className="field">
                        <span>Nombre visible</span>
                        <input value={variant.label} onChange={(event) => updateVariantField(index, "label", event.target.value)} placeholder="Negro / M" />
                      </label>
                      <label className="field">
                        <span>SKU de variante</span>
                        <input value={variant.sku} onChange={(event) => updateVariantField(index, "sku", event.target.value.toUpperCase())} placeholder="Se genera si lo dejas vacío" />
                      </label>
                    </div>

                    <div className="variant-options-header">
                      <span>Opciones</span>
                      <button type="button" className="text-button" onClick={() => addOption(index)}>
                        <Plus size={14} /> Agregar opción
                      </button>
                    </div>

                    <div className="variant-options-list">
                      {variant.options.map((option, optionIndex) => (
                        <div className="variant-option-row" key={optionIndex}>
                          <input value={option.name} onChange={(event) => updateOption(index, optionIndex, "name", event.target.value)} placeholder="Color / Talla / Material" />
                          <input value={option.value} onChange={(event) => updateOption(index, optionIndex, "value", event.target.value)} placeholder="Negro / M / Cuero" />
                          {variant.options.length > 1 ? (
                            <button type="button" className="icon-button danger-icon" onClick={() => removeOption(index, optionIndex)} aria-label="Eliminar opción">
                              <Trash2 size={14} />
                            </button>
                          ) : null}
                        </div>
                      ))}
                    </div>

                    <div className="form-grid three">
                      <label className="field">
                        <span>Precio de compra</span>
                        <input type="number" min="0" step="0.01" value={variant.purchasePrice} onChange={(event) => updateVariantField(index, "purchasePrice", event.target.value)} placeholder="Usar precio base" />
                      </label>
                      <label className="field">
                        <span>Precio mayorista</span>
                        <input type="number" min="0" step="0.01" value={variant.wholesalePrice} onChange={(event) => updateVariantField(index, "wholesalePrice", event.target.value)} placeholder="Usar precio base" />
                      </label>
                      <label className="field">
                        <span>Stock inicial</span>
                        <input type="number" min="0" value={variant.stock} onChange={(event) => updateVariantField(index, "stock", event.target.value)} />
                      </label>
                    </div>

                    <label className="field variant-threshold-field">
                      <span>Alerta cuando queden</span>
                      <input type="number" min="0" value={variant.lowStockThreshold} onChange={(event) => updateVariantField(index, "lowStockThreshold", event.target.value)} />
                    </label>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="product-form-side">
          <section className="panel-card product-submit-card">
            <span className="panel-kicker">Publicación</span>
            <h2>Guardar cambios</h2>
            <p>
              El precio de compra queda como costo interno. El precio mayorista será el precio al que tú vendes como proveedor.
            </p>

            <div className="publish-summary">
              <div><span>SKU</span><strong>{sku || "Se generará automáticamente"}</strong></div>
              <div><span>Categoría</span><strong>{categories.data?.find((category) => category._id === categoryId)?.name || "Sin seleccionar"}</strong></div>
              <div><span>Imágenes</span><strong>{images.length}</strong></div>
              <div><span>Ganancia</span><strong>{"$"}{Math.max(0, Number(wholesalePrice || 0) - Number(purchasePrice || 0)).toFixed(2)}</strong></div>
            </div>

            {error ? <div className="auth-error">{error}</div> : null}

            <button className="auth-submit" type="submit" disabled={saving || !categories.data?.length}>
              {saving ? "Guardando..." : "Guardar cambios"}
            </button>

            {!categories.data?.length ? (
              <small>Crea al menos una categoría antes de guardar el producto.</small>
            ) : null}
          </section>
        </aside>
      </form>

      {categoryOpen ? (
        <div className="modal-backdrop" onClick={() => !categorySaving && setCategoryOpen(false)}>
          <div className="category-modal" onClick={(event) => event.stopPropagation()}>
            <div className="panel-header">
              <div>
                <span className="panel-kicker">Organización</span>
                <h2>Nueva categoría</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => !categorySaving && setCategoryOpen(false)} aria-label="Cerrar">
                ×
              </button>
            </div>

            <p className="modal-subtitle">Créala sin salir del formulario. Después quedará seleccionada automáticamente.</p>

            <form onSubmit={handleCreateCategory}>
              <label className="field">
                <span>Nombre</span>
                <input value={newCategoryName} onChange={(event) => setNewCategoryName(event.target.value)} placeholder="Ej. Audio" required />
              </label>

              <label className="field">
                <span>Descripción</span>
                <input value={newCategoryDescription} onChange={(event) => setNewCategoryDescription(event.target.value)} placeholder="Productos de audio y accesorios" />
              </label>

              {categoryError ? <div className="auth-error">{categoryError}</div> : null}

              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={() => setCategoryOpen(false)} disabled={categorySaving}>
                  Cancelar
                </button>
                <button type="submit" className="primary-button" disabled={categorySaving}>
                  {categorySaving ? "Creando..." : "Crear categoría"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
