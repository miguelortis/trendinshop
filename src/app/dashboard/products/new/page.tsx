"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { api } from "@/lib/api/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";

type Category = { _id: string; name: string };

type VariantOptionInput = { name: string; value: string };

type ProductVariantInput = {
  label: string;
  sku: string;
  wholesalePrice: string;
  stock: string;
  lowStockThreshold: string;
  options: VariantOptionInput[];
};

const blankVariant = (): ProductVariantInput => ({
  label: "",
  sku: "",
  wholesalePrice: "",
  stock: "0",
  lowStockThreshold: "3",
  options: [{ name: "", value: "" }],
});

export default function NewProductPage() {
  const router = useRouter();
  const { data: user, isLoading: userLoading } = useCurrentUser();

  const [title, setTitle] = useState("");
  const [sku, setSku] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [description, setDescription] = useState("");
  const [wholesalePrice, setWholesalePrice] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [stock, setStock] = useState("0");
  const [lowStockThreshold, setLowStockThreshold] = useState("3");
  const [variants, setVariants] = useState<ProductVariantInput[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: async () =>
      (await api.get<{ ok: true; categories: Category[] }>("/categories")).data.categories,
    enabled: user?.role === "ADMIN",
  });

  function addVariant() {
    setVariants((current) => [...current, blankVariant()]);
  }

  function updateVariant(index: number, key: keyof Omit<ProductVariantInput, "options">, value: string) {
    setVariants((current) =>
      current.map((variant, variantIndex) =>
        variantIndex === index ? { ...variant, [key]: value } : variant,
      ),
    );
  }

  function updateOption(
    variantIndex: number,
    optionIndex: number,
    key: keyof VariantOptionInput,
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSaving(true);

    try {
      await api.post("/products", {
        title,
        sku,
        categoryId,
        description,
        wholesalePrice,
        imageUrl,
        stock,
        lowStockThreshold,
        variants: variants.map((variant) => ({
          label: variant.label,
          sku: variant.sku,
          wholesalePrice: variant.wholesalePrice,
          stock: variant.stock,
          lowStockThreshold: variant.lowStockThreshold,
          options: variant.options.filter((option) => option.name.trim() && option.value.trim()),
        })),
      });

      router.push("/dashboard/products");
      router.refresh();
    } catch (requestError: any) {
      setError(requestError?.response?.data?.message ?? "No pudimos crear el producto.");
    } finally {
      setSaving(false);
    }
  }

  if (userLoading) {
    return <div className="dashboard-empty">Cargando...</div>;
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
      <Link href="/dashboard/products" className="back-dashboard-link">
        <ArrowLeft size={16} /> Volver a productos
      </Link>

      <section className="page-heading product-form-heading">
        <div>
          <span className="page-kicker">Catálogo maestro</span>
          <h1>Nuevo producto</h1>
          <p>Define los datos base que utilizarán el inventario y los catálogos de tus revendedores.</p>
        </div>
      </section>

      <form onSubmit={handleSubmit} className="product-form-layout">
        <div className="product-form-main">
          <section className="panel-card">
            <div className="panel-header">
              <div><span className="panel-kicker">Información básica</span><h2>Producto</h2></div>
            </div>

            <div className="form-grid two">
              <label className="field">
                <span>Nombre del producto</span>
                <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ej. Vaso Térmico Premium" required />
              </label>
              <label className="field">
                <span>SKU maestro</span>
                <input value={sku} onChange={(event) => setSku(event.target.value.toUpperCase())} placeholder="VASO-001" required />
              </label>
            </div>

            <div className="form-grid two">
              <label className="field">
                <span>Categoría</span>
                <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} required>
                  <option value="">Selecciona una categoría</option>
                  {categories.data?.map((category) => <option key={category._id} value={category._id}>{category.name}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Precio mayorista</span>
                <input type="number" min="0" step="0.01" value={wholesalePrice} onChange={(event) => setWholesalePrice(event.target.value)} placeholder="25.00" required />
              </label>
            </div>

            <label className="field">
              <span>Descripción</span>
              <textarea className="field-textarea" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Describe el producto, materiales, características..." rows={5} />
            </label>

            <label className="field">
              <span>URL de imagen principal</span>
              <input type="url" value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} placeholder="https://..." />
            </label>
          </section>

          <section className="panel-card">
            <div className="panel-header">
              <div><span className="panel-kicker">Variantes</span><h2>Opciones e inventario</h2></div>
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
                      <button
                        type="button"
                        className="icon-button danger-icon"
                        onClick={() => setVariants((current) => current.filter((_, currentIndex) => currentIndex !== index))}
                        aria-label="Eliminar variante"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>

                    <div className="form-grid two">
                      <label className="field">
                        <span>Nombre visible</span>
                        <input value={variant.label} onChange={(event) => updateVariant(index, "label", event.target.value)} placeholder="Negro / M" />
                      </label>
                      <label className="field">
                        <span>SKU</span>
                        <input value={variant.sku} onChange={(event) => updateVariant(index, "sku", event.target.value.toUpperCase())} placeholder="CAM-NEG-M" required />
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
                          <input
                            value={option.name}
                            onChange={(event) => updateOption(index, optionIndex, "name", event.target.value)}
                            placeholder="Color / Talla / Material"
                          />
                          <input
                            value={option.value}
                            onChange={(event) => updateOption(index, optionIndex, "value", event.target.value)}
                            placeholder="Negro / M / Cuero"
                          />
                          {variant.options.length > 1 ? (
                            <button
                              type="button"
                              className="icon-button danger-icon"
                              onClick={() => removeOption(index, optionIndex)}
                              aria-label="Eliminar opción"
                            >
                              <Trash2 size={14} />
                            </button>
                          ) : null}
                        </div>
                      ))}
                    </div>

                    <div className="form-grid three">
                      <label className="field">
                        <span>Precio mayorista opcional</span>
                        <input type="number" min="0" step="0.01" value={variant.wholesalePrice} onChange={(event) => updateVariant(index, "wholesalePrice", event.target.value)} placeholder="Usar precio base" />
                      </label>
                      <label className="field">
                        <span>Stock</span>
                        <input type="number" min="0" value={variant.stock} onChange={(event) => updateVariant(index, "stock", event.target.value)} />
                      </label>
                      <label className="field">
                        <span>Alerta de stock</span>
                        <input type="number" min="0" value={variant.lowStockThreshold} onChange={(event) => updateVariant(index, "lowStockThreshold", event.target.value)} />
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="product-form-side">
          <section className="panel-card product-submit-card">
            <span className="panel-kicker">Publicación</span>
            <h2>Guardar producto</h2>
            <p>Al guardarlo, quedará disponible para el catálogo maestro y su inventario será centralizado.</p>
            {error ? <div className="auth-error">{error}</div> : null}
            <button className="auth-submit" type="submit" disabled={saving || !categories.data?.length}>
              {saving ? "Guardando..." : "Crear producto"}
            </button>
            {!categories.data?.length ? <small>Crea al menos una categoría antes de guardar.</small> : null}
          </section>
        </aside>
      </form>
    </div>
  );
}
