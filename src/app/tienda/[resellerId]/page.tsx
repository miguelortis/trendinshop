import type { Metadata } from "next";
import Link from "next/link";
import mongoose from "mongoose";
import { notFound } from "next/navigation";
import { connectMongoDB } from "@/lib/db/mongodb";
import { CategoryModel } from "@/models/Category";
import { ProductModel } from "@/models/Product";
import { ProductVariantModel } from "@/models/ProductVariant";
import { ResellerCatalogItemModel } from "@/models/ResellerCatalogItem";
import { ResellerComboModel } from "@/models/ResellerCombo";
import { UserModel } from "@/models/User";
import { PublicStorefrontHeader } from "@/components/catalog/PublicStorefrontHeader";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ resellerId: string }>;
};

type ResellerRecord = {
  _id: mongoose.Types.ObjectId;
  firstName: string;
  lastName: string;
  phone?: string;
  storeName?: string;
  storeDescription?: string;
  storeWhatsApp?: string;
  storeLogoUrl?: string;
  storeSlug?: string;
};

type CatalogItemRecord = {
  productId: mongoose.Types.ObjectId;
  sellingPrice: number;
  variantPrices?: { variantId: mongoose.Types.ObjectId; sellingPrice: number }[];
};

type ProductImageRecord = {
  url: string;
  alt?: string;
  isPrimary?: boolean;
};

type ProductRecord = {
  _id: mongoose.Types.ObjectId;
  title: string;
  description?: string;
  categoryId?: mongoose.Types.ObjectId | string | null;
  images?: ProductImageRecord[];
  wholesalePrice?: number;
};
type CategoryRecord = { _id: mongoose.Types.ObjectId; name: string };

type VariantRecord = {
  _id: mongoose.Types.ObjectId;
  productId: mongoose.Types.ObjectId;
  label: string;
  options?: { name: string; value: string }[];
  stock: number;
  wholesalePrice?: number | null;
  images?: ProductImageRecord[];
};

type PublicCatalogProduct = {
  id: string;
  title: string;
  description: string;
  category: string;
  images: ProductImageRecord[];
  sellingPrice: number;
  available: boolean;
  variants: { id: string; label: string; stock: number; sellingPrice: number }[];
};

type PublicCatalogCombo = {
  id: string; title: string; description: string; available: boolean;
  images: ProductImageRecord[]; minPrice: number; maxPrice: number;
  components: {
    productId: string; title: string; quantity: number; images: ProductImageRecord[];
    variants: { id: string; label: string; options: { name: string; value: string }[]; stock: number; wholesalePrice: number; images: ProductImageRecord[] }[];
  }[];
};
type PublicCatalogData = {
  reseller: { id: string; name: string; description: string; contactWhatsApp: string; logoUrl: string; slug: string };
  products: PublicCatalogProduct[];
  combos: PublicCatalogCombo[];
};

function safeImageUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function variantLabel(variant: VariantRecord) {
  const options = (variant.options ?? [])
    .map((option) => [option.name, option.value].filter(Boolean).join(": "))
    .filter(Boolean)
    .join(" · ");
  return options || variant.label || "Opción disponible";
}

async function getPublicCatalog(resellerId: string): Promise<PublicCatalogData | null> {
  if (!resellerId.trim()) return null;

  await connectMongoDB();

  const isResellerObjectId = /^[a-f0-9]{24}$/i.test(resellerId);
  const identityFilter = isResellerObjectId
    ? { $or: [{ _id: resellerId }, { storeSlug: resellerId }] }
    : { storeSlug: resellerId };
  const reseller = await UserModel.findOne({
    ...identityFilter,
    role: { $in: ["RESELLER", "ADMIN"] },
    isActive: true,
  })
    .select("_id firstName lastName phone storeName storeDescription storeWhatsApp storeLogoUrl storeSlug")
    .lean() as unknown as ResellerRecord | null;

  if (!reseller) return null;
  const resellerName = reseller.storeName?.trim() || [reseller.firstName, reseller.lastName].filter(Boolean).join(" ");
  const resellerDescription = reseller.storeDescription?.trim() ?? "";
  const contactWhatsApp = reseller.storeWhatsApp?.trim() || reseller.phone?.trim() || "";
  const logoUrl = reseller.storeLogoUrl ? safeImageUrl(reseller.storeLogoUrl) : "";
  const identity = {
    id: String(reseller._id),
    name: resellerName,
    description: resellerDescription,
    contactWhatsApp,
    logoUrl,
    slug: reseller.storeSlug?.trim() || String(reseller._id),
  };

  const [catalogItems, resellerCombos] = await Promise.all([
    ResellerCatalogItemModel.find({ resellerId: reseller._id, isActive: true })
      .sort({ updatedAt: -1 }).lean() as unknown as Promise<CatalogItemRecord[]>,
    ResellerComboModel.find({ resellerId: reseller._id, isActive: true }).sort({ updatedAt: -1 }).lean() as any,
  ]);

  const comboProductIds = (resellerCombos as any[]).flatMap((combo) =>
    (combo.components ?? []).map((component: any) => component.productId),
  );
  const productIds = [...new Set([...catalogItems.map((item) => String(item.productId)), ...comboProductIds.map(String)])]
    .map((id) => new mongoose.Types.ObjectId(id));
  const [products, variants] = productIds.length ? await Promise.all([
    ProductModel.find({ _id: { $in: productIds }, isActive: true })
      .select("_id title description categoryId images wholesalePrice")
      .lean() as unknown as Promise<ProductRecord[]>,
    ProductVariantModel.find({ productId: { $in: productIds }, isActive: true })
      .select("_id productId label options stock wholesalePrice images")
      .lean() as unknown as Promise<VariantRecord[]>,
  ]) : [[], []];

  const categoryIds = [...new Set(products.map((product) => product.categoryId ? String(product.categoryId) : "").filter(Boolean))];
  const categories: CategoryRecord[] = categoryIds.length
    ? await CategoryModel.find({ _id: { $in: categoryIds } }).select("_id name").lean() as unknown as CategoryRecord[]
    : [];
  const categoryById = new Map(categories.map((category) => [String(category._id), category.name]));
  const productById = new Map<string, ProductRecord>(products.map((product) => [String(product._id), product]));
  const variantsByProductId = new Map<string, VariantRecord[]>();
  for (const variant of variants) {
    const productId = String(variant.productId);
    variantsByProductId.set(productId, [...(variantsByProductId.get(productId) ?? []), variant]);
  }

  const safeImages = (images?: ProductImageRecord[]) =>
    (images ?? []).map((image) => ({ ...image, url: safeImageUrl(image.url) })).filter((image) => Boolean(image.url));

  const productsForCatalog = catalogItems.flatMap((item) => {
    const id = String(item.productId);
    const product = productById.get(id);
    if (!product) return [];
    const productVariants = variantsByProductId.get(id) ?? [];
    const availableVariants = productVariants.filter((variant) => variant.stock > 0);
    const category = categoryById.get(product.categoryId ? String(product.categoryId) : "") || "General";
    return [{
      id, title: product.title, description: product.description ?? "", category,
      images: safeImages(product.images), sellingPrice: item.sellingPrice,
      available: availableVariants.length > 0,
      variants: availableVariants.map((variant) => ({
        id: String(variant._id), label: variantLabel(variant), stock: variant.stock,
        sellingPrice: item.variantPrices?.find((price) => String(price.variantId) === String(variant._id))?.sellingPrice ?? item.sellingPrice,
      })),
    }];
  });

  const combosForCatalog = (resellerCombos as any[]).flatMap((combo) => {
    const components = (combo.components ?? []).flatMap((component: any) => {
      const id = String(component.productId);
      const product = productById.get(id);
      if (!product || !product.isActive && product.isActive !== undefined) return [];
      const componentVariants = (variantsByProductId.get(id) ?? []).filter((variant) => variant.stock > 0);
      const variantOptions = componentVariants.map((variant) => ({
        id: String(variant._id), label: variantLabel(variant), options: variant.options ?? [],
        stock: variant.stock, wholesalePrice: Number(variant.wholesalePrice ?? product.wholesalePrice ?? 0),
        images: safeImages(variant.images),
      }));
      return [{
        productId: id, title: product.title, quantity: Number(component.quantity ?? 1),
        images: safeImages(product.images), variants: variantOptions,
      }];
    });
    if (components.length !== (combo.components ?? []).length) return [];
    const available = components.every((component) => component.variants.length > 0);
    const minBase = components.reduce((sum, component) =>
      sum + Math.min(...component.variants.map((variant) => variant.wholesalePrice)) * component.quantity, 0);
    const maxBase = components.reduce((sum, component) =>
      sum + Math.max(...component.variants.map((variant) => variant.wholesalePrice)) * component.quantity, 0);
    const applyProfit = (base: number) => Number((combo.profitMode === "PERCENT"
      ? base * (1 + Number(combo.profitValue) / 100)
      : base + Number(combo.profitValue)).toFixed(2));
    const images = components.flatMap((component) => component.images.slice(0, 1));
    return [{
      id: String(combo._id), title: combo.title, description: combo.description ?? "",
      available, images, minPrice: applyProfit(minBase), maxPrice: applyProfit(maxBase), components,
    }];
  });

  return {
    reseller: identity,
    products: productsForCatalog,
    combos: combosForCatalog,
  };
}

function money(value: number) {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { resellerId } = await params;
  const catalog = await getPublicCatalog(resellerId);
  if (!catalog) {
    return {
      title: "Catálogo no disponible | TrendinShop",
      robots: { index: false, follow: false },
    };
  }

  const title = "Catálogo de " + (catalog.reseller.name || "revendedor");
  const description = catalog.reseller.description || (catalog.products.length
    ? "Explora " + catalog.products.length + (catalog.products.length === 1 ? " producto disponible" : " productos disponibles") + " en el catálogo de " + catalog.reseller.name + "."
    : "Pronto habrá productos disponibles en el catálogo de " + catalog.reseller.name + ".");
  const image = catalog.products.flatMap((product) => product.images)[0]?.url || catalog.reseller.logoUrl;
  const images = image ? [{ url: image }] : undefined;

  return {
    title,
    description,
    openGraph: { title, description, type: "website", images },
    twitter: { card: "summary_large_image", title, description, images },
  };
}

export default async function PublicCatalogPage({ params }: PageProps) {
  const { resellerId } = await params;
  const catalog = await getPublicCatalog(resellerId);
  if (!catalog) notFound();
  const whatsappDigits = catalog.reseller.contactWhatsApp.replace(/\D/g, "");

  return (
    <main className="public-catalog-shell">
      <div className="public-catalog-container">
        <PublicStorefrontHeader
          resellerId={catalog.reseller.id}
          storeSlug={catalog.reseller.slug}
          storeName={catalog.reseller.name || "Mi tienda"}
          logoUrl={catalog.reseller.logoUrl}
        />

        <section className="public-catalog-hero">
          <span className="public-catalog-kicker">CATÁLOGO EN LÍNEA</span>
          <h1>{catalog.reseller.name || "Catálogo de productos"}</h1>
          <p>{catalog.reseller.description || "Productos seleccionados y precios de venta publicados por este revendedor."}</p>
          {whatsappDigits ? (
            <a
              className="public-catalog-contact-link"
              href={"https://wa.me/" + whatsappDigits}
              target="_blank"
              rel="noreferrer"
            >
              Contactar por WhatsApp
            </a>
          ) : null}
          <div className="public-catalog-count">
            <span>{catalog.products.length}</span>
            {catalog.products.length === 1 ? " producto" : " productos"}
          </div>
        </section>

        {catalog.products.length ? (
          <section className="public-catalog-grid" aria-label="Productos del catálogo">
            {catalog.products.map((product) => {
              const image = product.images.find((item) => item.isPrimary) ?? product.images[0];
              return (
                <article className="public-catalog-card" key={product.id}>
                  <Link href={"/tienda/" + resellerId + "/producto/" + product.id} className="public-catalog-image" aria-label={"Ver " + product.title}>
                    {image ? (
                      <img src={image.url} alt={image.alt || product.title} loading="lazy" decoding="async" />
                    ) : (
                      <div className="public-catalog-image-placeholder" aria-label="Producto sin imagen">
                        <span>T</span>
                      </div>
                    )}
                    <span className={product.available ? "public-catalog-stock available" : "public-catalog-stock unavailable"}>
                      {product.available ? "Disponible" : "Agotado"}
                    </span>
                  </Link>
                  <div className="public-catalog-card-body">
                    <span className="public-catalog-category">{product.category}</span>
                    <h2><Link href={"/tienda/" + resellerId + "/producto/" + product.id}>{product.title}</Link></h2>
                    {product.description ? <p className="public-catalog-description">{product.description}</p> : null}
                    {product.variants.length ? (
                      <div className="public-catalog-variants" aria-label="Variantes disponibles">
                        {product.variants.map((variant) => (
                          <span key={variant.id}>{variant.label}</span>
                        ))}
                      </div>
                    ) : null}
                    <div className="public-catalog-price-row">
                      <span>Precio de venta</span>
                      <strong>{(() => { const prices = product.variants.map((variant) => variant.sellingPrice); const min = prices.length ? Math.min(...prices) : product.sellingPrice; const max = prices.length ? Math.max(...prices) : product.sellingPrice; return max > min ? "Desde " + money(min) : money(min); })()}</strong>
                    </div>
                  </div>
                </article>
              );
            })}
          </section>
        ) : (
          <section className="public-catalog-empty">
            <div className="public-catalog-empty-mark">T</div>
            <h2>Este catálogo todavía no tiene productos</h2>
            <p>El revendedor aún no ha publicado productos para mostrar aquí. Vuelve pronto.</p>
          </section>
        )}

        <footer className="public-catalog-footer">
          <span>Catálogo creado con <strong>TrendinShop</strong></span>
          <span>Precios y disponibilidad sujetos a cambios.</span>
        </footer>
      </div>
    </main>
  );
}
