"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Filter, Link2, Search, SlidersHorizontal, X } from "lucide-react";

type ImageRecord = { url: string; alt?: string; isPrimary?: boolean };
type VariantOption = { name: string; value: string };
type Product = {
  id: string; title: string; description: string; category: string; images: ImageRecord[];
  sellingPrice: number; available: boolean;
  variants: { id: string; label: string; stock: number; sellingPrice: number; options?: VariantOption[] }[];
  filterVariants: { options: VariantOption[] }[];
};
type Combo = {
  id: string; title: string; description: string; available: boolean; availablePacks: number;
  images: ImageRecord[]; minPrice: number; maxPrice: number;
  components: { productId: string; title: string; quantity: number; images: ImageRecord[];
    variants: { id: string; label: string; options: VariantOption[]; stock: number; images: ImageRecord[] }[] }[];
};
type Filters = { q?: string; category?: string[]; option?: Record<string, string[]>; stock?: string; min?: string; max?: string; sort?: string };
type Props = { resellerId: string; products: Product[]; combos: Combo[]; initialFilters?: Filters };

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase()
    .replace(/[^a-z0-9]/g, "");
}
function matches(value: string, query: string) {
  const terms = query.trim().split(/\s+/).map(normalize).filter(Boolean);
  const haystack = normalize(value);
  return !terms.length || terms.every((term) => haystack.includes(term));
}
function money(value: number) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}
function productSearchText(product: Product) {
  return [product.title, product.description, product.category,
    ...product.variants.flatMap((variant) => [variant.label, ...(variant.options ?? []).flatMap((option) => [option.name, option.value])]),
    ...product.filterVariants.flatMap((variant) => variant.options.flatMap((option) => [option.name, option.value])),
  ].join(" ");
}
function comboSearchText(combo: Combo) {
  return [combo.title, combo.description, "combo", ...combo.components.flatMap((component) =>
    [component.title, ...component.variants.flatMap((variant) => [variant.label, ...variant.options.flatMap((option) => [option.name, option.value])])])].join(" ");
}
function getProductOptions(product: Product) {
  return product.filterVariants.flatMap((variant) => variant.options);
}
function getComboOptions(combo: Combo) {
  return combo.components.flatMap((component) => component.variants.flatMap((variant) => variant.options ?? []));
}
function getFacetOptions(kind: "product" | "combo", item: Product | Combo, selected: Record<string, string[]>, facetName: string) {
  const entries = Object.entries(selected).filter(([name, values]) => name !== facetName && values.length);
  if (kind === "product") {
    const variants = (item as Product).filterVariants.filter((variant) => entries.every(([name, values]) =>
      variant.options.some((option) => option.name === name && values.includes(option.value))));
    return variants.flatMap((variant) => variant.options.filter((option) => option.name === facetName));
  }
  const combo = item as Combo;
  const allNames = new Set(getComboOptions(combo).map((option) => option.name));
  if (entries.some(([name]) => !allNames.has(name))) return [];
  return combo.components.flatMap((component) => {
    const names = new Set(component.variants.flatMap((variant) => variant.options.map((option) => option.name)));
    const relevant = entries.filter(([name]) => names.has(name));
    const variants = component.variants.filter((variant) => relevant.every(([name, values]) =>
      variant.options.some((option) => option.name === name && values.includes(option.value))));
    return variants.flatMap((variant) => variant.options.filter((option) => option.name === facetName));
  });
}
function readFiltersFromUrl(): Filters {
  const params = new URLSearchParams(window.location.search);
  const option: Record<string, string[]> = {};
  params.forEach((value, key) => {
    if (key.startsWith("f_")) option[key.slice(2)] = [...(option[key.slice(2)] ?? []), value];
  });
  return {
    q: params.get("q") ?? "", category: params.getAll("categoria"),
    option, stock: params.get("stock") ?? "", min: params.get("min") ?? "",
    max: params.get("max") ?? "", sort: params.get("orden") ?? "recent",
  };
}
function toQuery(filters: Filters) {
  const params = new URLSearchParams();
  if (filters.q?.trim()) params.set("q", filters.q.trim());
  (filters.category ?? []).forEach((value) => params.append("categoria", value));
  Object.entries(filters.option ?? {}).forEach(([name, values]) => values.forEach((value) => params.append("f_" + name, value)));
  if (filters.stock) params.set("stock", filters.stock);
  if (filters.min) params.set("min", filters.min);
  if (filters.max) params.set("max", filters.max);
  if (filters.sort && filters.sort !== "recent") params.set("orden", filters.sort);
  return params.toString();
}

export function PublicCatalogFilters({ resellerId, products, combos, initialFilters = {} }: Props) {
  const [filters, setFilters] = useState<Filters>(() => ({
    q: initialFilters.q ?? "", category: initialFilters.category ?? [],
    option: initialFilters.option ?? {}, stock: initialFilters.stock ?? "",
    min: initialFilters.min ?? "", max: initialFilters.max ?? "", sort: initialFilters.sort ?? "recent",
  }));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [shareNotice, setShareNotice] = useState("");

  useEffect(() => {
    const onPopState = () => setFilters(readFiltersFromUrl());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    const query = toQuery(filters);
    const next = window.location.pathname + (query ? "?" + query : "");
    window.history.replaceState(null, "", next);
  }, [filters]);

  const searchable = useMemo(() => [
    ...products.map((item) => ({ kind: "product" as const, item, text: productSearchText(item) })),
    ...combos.map((item) => ({ kind: "combo" as const, item, text: comboSearchText(item) })),
  ], [products, combos]);

  const textMatches = useMemo(() => searchable.filter(({ text }) => matches(text, filters.q ?? "")), [searchable, filters.q]);
  const categoryOptions = useMemo(() => {
    const counts = new Map<string, number>();
    textMatches.forEach(({ kind, item }) => {
      const category = kind === "product" ? (item as Product).category : "Combo";
      counts.set(category, (counts.get(category) ?? 0) + 1);
    });
    return [...counts].sort(([a], [b]) => a.localeCompare(b, "es"));
  }, [textMatches]);

  const facetItems = useMemo(() => textMatches.filter(({ kind, item }) => {
    const category = kind === "product" ? (item as Product).category : "Combo";
    return !(filters.category?.length) || filters.category.includes(category);
  }), [textMatches, filters.category]);

  const optionFacets = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    const selected = filters.option ?? {};
    facetItems.forEach(({ kind, item }) => {
      const allOptions = kind === "product" ? getProductOptions(item as Product) : getComboOptions(item as Combo);
      const names = new Set(allOptions.map((option) => option.name.trim()).filter(Boolean));
      names.forEach((name) => {
        const matchingOptions = getFacetOptions(kind, item as Product | Combo, selected, name);
        const values = new Set(matchingOptions.map((option) => option.value.trim()).filter(Boolean));
        if (!values.size) return;
        const counts = map.get(name) ?? new Map<string, number>();
        values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
        map.set(name, counts);
      });
    });
    return [...map].map(([name, values]) => ({ name, values: [...values].sort(([a], [b]) => a.localeCompare(b, "es")) }))
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [facetItems, filters.option]);

  const filtered = useMemo(() => {
    const min = filters.min === "" ? null : Number(filters.min);
    const max = filters.max === "" ? null : Number(filters.max);
    const results = facetItems.filter(({ kind, item }) => {
      const available = kind === "product" ? (item as Product).available : (item as Combo).available;
      if (filters.stock === "available" && !available) return false;
      if (filters.stock === "unavailable" && available) return false;
      const priceMin = kind === "product"
        ? Math.min(...((item as Product).variants.map((v) => v.sellingPrice).length ? (item as Product).variants.map((v) => v.sellingPrice) : [(item as Product).sellingPrice]))
        : (item as Combo).minPrice;
      const priceMax = kind === "product"
        ? Math.max(...((item as Product).variants.map((v) => v.sellingPrice).length ? (item as Product).variants.map((v) => v.sellingPrice) : [(item as Product).sellingPrice]))
        : (item as Combo).maxPrice;
      if (min !== null && Number.isFinite(min) && priceMax < min) return false;
      if (max !== null && Number.isFinite(max) && priceMin > max) return false;
      const selected = filters.option ?? {};
      if (kind === "product") {
        const variants = (item as Product).filterVariants;
        const selectedEntries = Object.entries(selected).filter(([, values]) => values.length);
        if (!selectedEntries.length) return true;
        return variants.some((variant) => selectedEntries.every(([name, values]) =>
          variant.options.some((option) => option.name === name && values.includes(option.value))));
      }
      const allOptions = getComboOptions(item as Combo);
      return Object.entries(selected).every(([name, values]) => !values.length || values.some((value) =>
        allOptions.some((option) => option.name === name && option.value === value)));
    });
    const sort = filters.sort ?? "recent";
    return [...results].sort((a, b) => {
      const titleA = a.item.title; const titleB = b.item.title;
      const priceA = a.kind === "product" ? (a.item as Product).sellingPrice : (a.item as Combo).minPrice;
      const priceB = b.kind === "product" ? (b.item as Product).sellingPrice : (b.item as Combo).minPrice;
      if (sort === "name") return titleA.localeCompare(titleB, "es");
      if (sort === "price-asc") return priceA - priceB;
      if (sort === "price-desc") return priceB - priceA;
      return 0;
    });
  }, [facetItems, filters]);

  const activeCount = (filters.category?.length ?? 0) + Object.values(filters.option ?? {}).reduce((n, values) => n + values.length, 0)
    + Number(Boolean(filters.stock)) + Number(Boolean(filters.min)) + Number(Boolean(filters.max));
  const updateOption = (name: string, value: string) => setFilters((current) => {
    const currentValues = current.option?.[name] ?? [];
    const nextValues = currentValues.includes(value) ? currentValues.filter((item) => item !== value) : [...currentValues, value];
    const option = { ...(current.option ?? {}) };
    if (nextValues.length) option[name] = nextValues; else delete option[name];
    return { ...current, option };
  });
  const clear = () => setFilters({ q: "", category: [], option: {}, stock: "", min: "", max: "", sort: "recent" });
  const share = async () => {
    try {
      const url = window.location.href;
      if (navigator.share) await navigator.share({ title: "Catálogo de productos", url });
      else { await navigator.clipboard.writeText(url); setShareNotice("Enlace copiado. Ya puedes enviarlo a tus clientes."); }
    } catch (error) {
      if (error instanceof Error && error.name !== "AbortError") setShareNotice("No pudimos compartir el enlace. Puedes copiar la dirección del navegador.");
    }
  };

  const renderProduct = (product: Product) => {
    const image = product.images.find((entry) => entry.isPrimary) ?? product.images[0];
    const prices = product.variants.map((variant) => variant.sellingPrice);
    const min = prices.length ? Math.min(...prices) : product.sellingPrice;
    const max = prices.length ? Math.max(...prices) : product.sellingPrice;
    return <article className="public-catalog-card" key={product.id}>
      <Link href={"/tienda/" + resellerId + "/producto/" + product.id} className="public-catalog-image" aria-label={"Ver " + product.title}>
        {image ? <img src={image.url} alt={image.alt || product.title} loading="lazy" decoding="async"/> : <div className="public-catalog-image-placeholder"><span>T</span></div>}
        <span className={product.available ? "public-catalog-stock available" : "public-catalog-stock unavailable"}>{product.available ? "Disponible" : "Agotado"}</span>
      </Link>
      <div className="public-catalog-card-body">
        <span className="public-catalog-category">{product.category}</span>
        <h2><Link href={"/tienda/" + resellerId + "/producto/" + product.id}>{product.title}</Link></h2>
        {product.description ? <p className="public-catalog-description">{product.description}</p> : null}
        {product.variants.length ? <div className="public-catalog-variants" aria-label="Variantes disponibles">{product.variants.map((variant) =>
          <span key={variant.id}>{variant.label}</span>)}</div> : null}
        <div className="public-catalog-price-row"><span>Precio de venta</span><strong>{max > min ? "Desde " + money(min) : money(min)}</strong></div>
      </div>
    </article>;
  };
  const renderCombo = (combo: Combo) => <article className="public-catalog-card public-combo-catalog-card" key={combo.id}>
    <Link href={"/tienda/" + resellerId + "/combo/" + combo.id} className="public-catalog-image">
      <div className="public-combo-card-images">{combo.images.slice(0, 4).map((image, index) =>
        <img key={image.url + index} src={image.url} alt={image.alt || combo.title} loading="lazy" decoding="async"/>)}</div>
      <span className="public-combo-card-badge">COMBO · {combo.components.length} productos</span>
      <span className={combo.available ? "public-catalog-stock available" : "public-catalog-stock unavailable"}>{combo.available ? combo.availablePacks + (combo.availablePacks === 1 ? " pack disponible" : " packs disponibles") : "Agotado"}</span>
    </Link>
    <div className="public-catalog-card-body">
      <span className="public-catalog-category">Combo</span>
      <h2><Link href={"/tienda/" + resellerId + "/combo/" + combo.id}>{combo.title}</Link></h2>
      {combo.description ? <p className="public-catalog-description">{combo.description}</p> : null}
      <div className="public-combo-includes">{combo.components.map((component) =>
        <span key={component.productId}>{component.quantity} × {component.title}</span>)}</div>
      <div className="public-catalog-price-row"><span>Precio del combo</span><strong>{combo.minPrice === combo.maxPrice ? money(combo.minPrice) : "Desde " + money(combo.minPrice)}</strong></div>
    </div>
  </article>;

  return <section className="public-catalog-browser" aria-label="Buscar y filtrar catálogo">
    <div className="public-catalog-toolbar">
      <label className="public-catalog-search"><Search size={18}/><input value={filters.q ?? ""} onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))} placeholder="Buscar productos, categorías, tallas, colores..." aria-label="Buscar en el catálogo"/>{filters.q ? <button type="button" onClick={() => setFilters((current) => ({ ...current, q: "" }))} aria-label="Limpiar búsqueda"><X size={16}/></button> : null}</label>
      <button type="button" className={"public-catalog-filter-toggle" + (mobileOpen ? " active" : "")} onClick={() => setMobileOpen((value) => !value)}><SlidersHorizontal size={17}/> Filtros {activeCount ? <span>{activeCount}</span> : null}<ChevronDown size={15}/></button>
      <button type="button" className="public-catalog-share-filter" onClick={share}><Link2 size={16}/> Compartir selección</button>
    </div>
    <div className={"public-catalog-filter-layout" + (mobileOpen ? " is-open" : "")}>
      <aside className="public-catalog-filter-panel">
        <div className="public-catalog-filter-heading"><strong><Filter size={16}/> Filtrar productos</strong><div className="public-catalog-filter-heading-actions"><button type="button" onClick={clear}>Limpiar</button><button type="button" className="public-catalog-filter-close" onClick={() => setMobileOpen(false)} aria-label="Ocultar filtros"><X size={15}/><span>Ocultar</span></button></div></div>
        <div className="public-catalog-filter-group"><h3>Categoría</h3>{categoryOptions.map(([name, count]) =>
          <label className="public-catalog-filter-choice" key={name}><input type="checkbox" checked={(filters.category ?? []).includes(name)} onChange={() => setFilters((current) => ({ ...current, category: (current.category ?? []).includes(name) ? current.category!.filter((item) => item !== name) : [...(current.category ?? []), name] }))}/><span>{name}</span><small>{count}</small></label>)}</div>
        {optionFacets.map(({ name, values }) => <div className="public-catalog-filter-group" key={name}><h3>{name}</h3><div className="public-catalog-filter-chips">{values.map(([value, count]) =>
          <button type="button" key={value} aria-pressed={(filters.option?.[name] ?? []).includes(value)} className={(filters.option?.[name] ?? []).includes(value) ? "selected" : ""} onClick={() => updateOption(name, value)}>{value}<small>{count}</small>{(filters.option?.[name] ?? []).includes(value) ? <Check size={13}/> : null}</button>)}</div></div>)}
        <div className="public-catalog-filter-group"><h3>Disponibilidad</h3><select value={filters.stock ?? ""} onChange={(event) => setFilters((current) => ({ ...current, stock: event.target.value }))}><option value="">Todas</option><option value="available">Disponibles</option><option value="unavailable">Agotados</option></select></div>
        <div className="public-catalog-filter-group"><h3>Precio (USD)</h3><div className="public-catalog-price-filter"><input type="number" min="0" value={filters.min ?? ""} onChange={(event) => setFilters((current) => ({ ...current, min: event.target.value }))} placeholder="Mínimo" aria-label="Precio mínimo"/><input type="number" min="0" value={filters.max ?? ""} onChange={(event) => setFilters((current) => ({ ...current, max: event.target.value }))} placeholder="Máximo" aria-label="Precio máximo"/></div></div>
      </aside>
      <div className="public-catalog-results">
        <div className="public-catalog-results-head"><strong>{filtered.length} {filtered.length === 1 ? "resultado" : "resultados"}</strong><label>Ordenar <select value={filters.sort ?? "recent"} onChange={(event) => setFilters((current) => ({ ...current, sort: event.target.value }))}><option value="recent">Más recientes</option><option value="name">Nombre</option><option value="price-asc">Menor precio</option><option value="price-desc">Mayor precio</option></select></label></div>
        {activeCount || filters.q ? <div className="public-catalog-active-filters">{filters.q ? <button type="button" onClick={() => setFilters((current) => ({ ...current, q: "" }))}>“{filters.q}” <X size={12}/></button> : null}{(filters.category ?? []).map((name) => <button type="button" key={name} onClick={() => setFilters((current) => ({ ...current, category: current.category!.filter((item) => item !== name) }))}>{name} <X size={12}/></button>)}{Object.entries(filters.option ?? {}).flatMap(([name, values]) => values.map((value) => <button type="button" key={name + value} onClick={() => updateOption(name, value)}>{name}: {value} <X size={12}/></button>))}{filters.stock ? <button type="button" onClick={() => setFilters((current) => ({ ...current, stock: "" }))}>{filters.stock === "available" ? "Disponibles" : "Agotados"} <X size={12}/></button> : null}{filters.min ? <button type="button" onClick={() => setFilters((current) => ({ ...current, min: "" }))}>Desde {filters.min} <X size={12}/></button> : null}{filters.max ? <button type="button" onClick={() => setFilters((current) => ({ ...current, max: "" }))}>Hasta {filters.max} <X size={12}/></button> : null}</div> : null}
        {filtered.length ? <div className="public-catalog-grid">{filtered.map(({ kind, item }) => kind === "product" ? renderProduct(item as Product) : renderCombo(item as Combo))}</div> :
          <div className="public-catalog-empty"><div className="public-catalog-empty-mark">T</div><h2>No encontramos productos</h2><p>Prueba con otra búsqueda o elimina alguno de los filtros.</p><button type="button" onClick={clear}>Limpiar búsqueda y filtros</button></div>}
        {shareNotice ? <p className="public-catalog-share-notice" role="status">{shareNotice}</p> : null}
      </div>
    </div>
  </section>;
}
