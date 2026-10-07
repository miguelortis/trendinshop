"use client";

import { useQuery } from "@tanstack/react-query";
import { FolderPlus, Package, Plus, Search, Tag } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useMemo, useState } from "react";
import { api } from "@/lib/api/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";

type Category = { _id: string; name: string; slug: string; description?: string };
type Product = {
  _id: string;
  title: string;
  sku: string;
  description?: string;
  purchasePrice: number;
  wholesalePrice: number;
  images?: { url: string; alt?: string }[];
  categoryId?: { _id: string; name: string; slug: string } | string;
};

export default function ProductsPage() {
  const { data: user } = useCurrentUser();
  const isAdmin = user?.role === "ADMIN";
  const [search, setSearch] = useState("");
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [categoryName, setCategoryName] = useState("");
  const [categoryDescription, setCategoryDescription] = useState("");
  const [categoryError, setCategoryError] = useState("");
  const [categorySaving, setCategorySaving] = useState(false);

  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: async () =>
      (await api.get<{ ok: true; categories: Category[] }>("/categories")).data.categories,
  });

  const products = useQuery({
    queryKey: ["products"],
    queryFn: async () =>
      (await api.get<{ ok: true; products: Product[] }>("/products")).data.products,
  });

  const filteredProducts = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return products.data ?? [];

    return (products.data ?? []).filter((product) =>
      [product.title, product.sku, typeof product.categoryId === "object" ? product.categoryId.name : ""]
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }, [products.data, search]);

  async function handleCreateCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCategoryError("");
    setCategorySaving(true);

    try {
      await api.post("/categories", { name: categoryName, description: categoryDescription });
      await categories.refetch();
      setCategoryName("");
      setCategoryDescription("");
      setCategoryOpen(false);
    } catch (error: any) {
      setCategoryError(error?.response?.data?.message ?? "No pudimos crear la categoría.");
    } finally {
      setCategorySaving(false);
    }
  }

  return (
    <div className="dashboard-page">
      <section className="page-heading">
        <div>
          <span className="page-kicker">Catálogo maestro</span>
          <h1>Productos</h1>
          <p>
            {isAdmin
              ? "Crea y administra los productos que estarán disponibles para tus revendedores."
              : "Explora los productos disponibles de tu proveedor para incorporarlos a tu catálogo."}
          </p>
        </div>

        {isAdmin ? (
          <div className="page-heading-actions">
            <button className="secondary-button" type="button" onClick={() => setCategoryOpen((value) => !value)}>
              <FolderPlus size={16} /> Nueva categoría
            </button>
            <Link href="/dashboard/products/new" className="primary-button">
              <Plus size={17} /> Nuevo producto
            </Link>
          </div>
        ) : null}
      </section>

      {categoryOpen && isAdmin ? (
        <section className="panel-card product-create-inline">
          <div className="panel-header">
            <div>
              <span className="panel-kicker">Organización</span>
              <h2>Crear categoría</h2>
            </div>
          </div>

          <form onSubmit={handleCreateCategory} className="inline-form-grid">
            <label className="field">
              <span>Nombre</span>
              <input value={categoryName} onChange={(event) => setCategoryName(event.target.value)} placeholder="Ej. Audio" required />
            </label>
            <label className="field">
              <span>Descripción</span>
              <input value={categoryDescription} onChange={(event) => setCategoryDescription(event.target.value)} placeholder="Accesorios y equipos de audio" />
            </label>
            <div className="inline-form-actions">
              <button type="button" className="secondary-button" onClick={() => setCategoryOpen(false)}>Cancelar</button>
              <button type="submit" className="primary-button" disabled={categorySaving}>
                {categorySaving ? "Guardando..." : "Guardar categoría"}
              </button>
            </div>
          </form>

          {categoryError ? <div className="auth-error">{categoryError}</div> : null}
        </section>
      ) : null}

      <section className="product-toolbar">
        <div className="search-field">
          <Search size={17} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nombre, SKU o categoría..." />
        </div>
        <div className="product-toolbar-meta">
          <span><Tag size={14} /> {categories.data?.length ?? 0} categorías</span>
          <span><Package size={14} /> {products.data?.length ?? 0} productos</span>
        </div>
      </section>

      <section className="product-grid">
        {products.isLoading ? (
          <div className="panel-card dashboard-loading">Cargando productos...</div>
        ) : filteredProducts.length ? (
          filteredProducts.map((product) => {
            const category = typeof product.categoryId === "object" ? product.categoryId?.name : "Sin categoría";
            const image = product.images?.find((item) => item.isPrimary)?.url ?? product.images?.[0]?.url;

            return (
              <article className="product-card" key={product._id}>
                <div className="product-card-image">
                  {image ? <img src={image} alt={product.images?.[0]?.alt || product.title} /> : <Package size={30} />}
                </div>
                <div className="product-card-body">
                  <span className="product-category">{category}</span>
                  <h2>{product.title}</h2>
                  <div className="product-sku">SKU {product.sku}</div>
                  <div className="product-card-footer product-card-financials">
                    <div>
                      <span>Compra</span>
                      <strong>{"$"}{product.purchasePrice.toFixed(2)}</strong>
                    </div>
                    <div>
                      <span>Mayorista</span>
                      <strong>{"$"}{product.wholesalePrice.toFixed(2)}</strong>
                    </div>
                    {isAdmin ? (
                      <div>
                        <span>Ganancia</span>
                        <strong className="profit-value">
                          {"$"}{Math.max(0, product.wholesalePrice - product.purchasePrice).toFixed(2)}
                        </strong>
                      </div>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })
        ) : (
          <div className="panel-card dashboard-empty product-empty">
            <div className="dashboard-empty-icon"><Package size={20} /></div>
            <strong>{search ? "No encontramos productos" : "Aún no hay productos"}</strong>
            <span>
              {search
                ? "Prueba con otro término de búsqueda."
                : isAdmin
                  ? "Crea tu primer producto maestro para empezar a construir TrendinShop."
                  : "Cuando el proveedor publique productos, aparecerán aquí."}
            </span>
            {isAdmin && !search ? <Link href="/dashboard/products/new" className="secondary-action">Crear primer producto</Link> : null}
          </div>
        )}
      </section>
    </div>
  );
}
