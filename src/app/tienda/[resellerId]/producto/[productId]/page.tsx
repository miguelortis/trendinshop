import type { Metadata } from "next";
import Link from "next/link";
import mongoose from "mongoose";
import { notFound } from "next/navigation";
import { ShareProductActions } from "@/components/catalog/ShareProductActions";
import { connectMongoDB } from "@/lib/db/mongodb";
import { ProductModel } from "@/models/Product";
import { ProductVariantModel } from "@/models/ProductVariant";
import { ResellerCatalogItemModel } from "@/models/ResellerCatalogItem";
import { UserModel } from "@/models/User";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ resellerId: string; productId: string }>;
};

type SellerRecord = {
  _id: mongoose.Types.ObjectId;
  firstName: string;
  lastName: string;
};

type CatalogItemRecord = {
  sellingPrice: number;
};

type ProductImageRecord = {
  url: string;
  alt?: string;
  isPrimary?: boolean;
};

type PopulatedCategory = {
  _id?: mongoose.Types.ObjectId;
  name?: string;
};

type ProductRecord = {
  _id: mongoose.Types.ObjectId;
  title: string;
  description?: string;
  categoryId?: PopulatedCategory | string | null;
  images?: ProductImageRecord[];
};

type VariantRecord = {
  _id: mongoose.Types.ObjectId;
  label: string;
  options?: { name: string; value: string }[];
  stock: number;
};

type PublicProductData = {
  sellerName: string;
  product: {
    id: string;
    title: string;
    description: string;
    category: string;
    images: ProductImageRecord[];
    sellingPrice: number;
    available: boolean;
    variants: string[];
  };
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

async function getPublicProduct(resellerId: string, productId: string): Promise<PublicProductData | null> {
  if (!mongoose.isValidObjectId(resellerId) || !mongoose.isValidObjectId(productId)) return null;

  await connectMongoDB();

  const seller = await UserModel.findOne({
    _id: resellerId,
    role: { $in: ["RESELLER", "ADMIN"] },
    isActive: true,
  })
    .select("_id firstName lastName")
    .lean() as unknown as SellerRecord | null;

  if (!seller) return null;

  const catalogItem = await ResellerCatalogItemModel.findOne({
    resellerId: seller._id,
    productId,
    isActive: true,
  })
    .select("sellingPrice")
    .lean() as unknown as CatalogItemRecord | null;

  if (!catalogItem) return null;

  const product = await ProductModel.findOne({ _id: productId, isActive: true })
    .select("_id title description categoryId images")
    .populate("categoryId", "name")
    .lean() as unknown as ProductRecord | null;

  if (!product) return null;

  const variants = await ProductVariantModel.find({ productId: product._id, isActive: true })
    .select("_id label options stock")
    .lean() as unknown as VariantRecord[];

  const availableVariants = variants.filter((variant) => variant.stock > 0);
  const images = (product.images ?? [])
    .map((image) => ({ ...image, url: safeImageUrl(image.url) }))
    .filter((image) => Boolean(image.url));

  const populatedCategory = product.categoryId;
  const category =
    populatedCategory && typeof populatedCategory === "object" && "name" in populatedCategory
      ? populatedCategory.name || "General"
      : "General";

  return {
    sellerName: [seller.firstName, seller.lastName].filter(Boolean).join(" "),
    product: {
      id: String(product._id),
      title: product.title,
      description: product.description ?? "",
      category,
      images,
      sellingPrice: catalogItem.sellingPrice,
      available: availableVariants.length > 0,
      variants: availableVariants.map(variantLabel),
    },
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
  const { resellerId, productId } = await params;
  const data = await getPublicProduct(resellerId, productId);
  if (!data) {
    return {
      title: "Producto no disponible | TrendinShop",
      robots: { index: false, follow: false },
    };
  }

  const { product, sellerName } = data;
  const description = product.description
    ? product.description.slice(0, 150)
    : product.title + " disponible en el catálogo de " + sellerName + ".";
  const image = product.images.find((item) => item.isPrimary) ?? product.images[0];
  const images = image ? [{ url: image.url, alt: image.alt || product.title }] : undefined;
  const title = product.title + " | " + sellerName;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      images,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images,
    },
  };
}

export default async function PublicProductPage({ params }: PageProps) {
  const { resellerId, productId } = await params;
  const data = await getPublicProduct(resellerId, productId);
  if (!data) notFound();

  const { product, sellerName } = data;
  const primaryImage = product.images.find((item) => item.isPrimary) ?? product.images[0];
  const shareUrl = "/tienda/" + resellerId + "/producto/" + productId;
  const shareDescription = product.description
    ? product.description.slice(0, 180)
    : product.title + " · " + money(product.sellingPrice);

  return (
    <main className="public-catalog-shell public-product-shell">
      <div className="public-catalog-container">
        <header className="public-catalog-nav">
          <Link href="/" className="public-catalog-brand" aria-label="TrendinShop, inicio">
            <span className="public-catalog-brand-mark">T</span>
            <span>Trendin<span>Shop</span></span>
          </Link>
          <Link href={"/tienda/" + resellerId} className="public-catalog-nav-link">Ver todo el catálogo</Link>
        </header>

        <nav className="public-product-breadcrumb" aria-label="Ruta de navegación">
          <Link href={"/tienda/" + resellerId}>{sellerName}</Link>
          <span>/</span>
          <span>{product.title}</span>
        </nav>

        <section className="public-product-layout">
          <div className="public-product-gallery">
            {primaryImage ? (
              <img src={primaryImage.url} alt={primaryImage.alt || product.title} />
            ) : (
              <div className="public-catalog-image-placeholder public-product-no-image"><span>T</span></div>
            )}
            {product.images.length > 1 ? (
              <div className="public-product-image-count">{product.images.length} imágenes del producto</div>
            ) : null}
          </div>

          <div className="public-product-information">
            <span className="public-catalog-kicker">{product.category}</span>
            <h1>{product.title}</h1>
            <p className="public-product-seller">Publicado por <strong>{sellerName}</strong></p>
            <div className="public-product-price">{money(product.sellingPrice)}</div>
            <span className={product.available ? "public-product-availability available" : "public-product-availability unavailable"}>
              {product.available ? "Disponible para pedir" : "Agotado por el momento"}
            </span>

            {product.description ? <p className="public-product-description">{product.description}</p> : null}

            {product.variants.length ? (
              <div className="public-product-variant-list">
                <strong>Opciones disponibles</strong>
                <div className="public-catalog-variants">
                  {product.variants.map((variant, index) => <span key={variant + "-" + index}>{variant}</span>)}
                </div>
              </div>
            ) : null}

            <div className="public-product-share-panel">
              <strong>Comparte este producto</strong>
              <p>Comparte la imagen y el enlace cuando tu dispositivo lo permita, o envía el enlace por WhatsApp.</p>
              <ShareProductActions
                title={product.title}
                description={shareDescription}
                productUrl={shareUrl}
                imageUrl={primaryImage?.url}
              />
            </div>

            <Link href={"/tienda/" + resellerId} className="public-product-back-link">
              ← Volver al catálogo de {sellerName}
            </Link>
          </div>
        </section>

        <footer className="public-catalog-footer">
          <span>Catálogo creado con <strong>TrendinShop</strong></span>
          <span>Precios y disponibilidad sujetos a cambios.</span>
        </footer>
      </div>
    </main>
  );
}
