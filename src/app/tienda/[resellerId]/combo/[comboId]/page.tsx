import type { Metadata } from "next";
import Link from "next/link";
import mongoose from "mongoose";
import { notFound } from "next/navigation";
import { PublicComboControls } from "@/components/catalog/PublicComboControls";
import { PublicStorefrontHeader } from "@/components/catalog/PublicStorefrontHeader";
import { connectMongoDB } from "@/lib/db/mongodb";
import { ProductModel } from "@/models/Product";
import { ProductVariantModel } from "@/models/ProductVariant";
import { ResellerComboModel } from "@/models/ResellerCombo";
import { UserModel } from "@/models/User";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ resellerId: string; comboId: string }> };
type ImageRecord = { url: string; alt?: string; isPrimary?: boolean };
type VariantRecord = {
  _id: mongoose.Types.ObjectId; productId: mongoose.Types.ObjectId; label: string; sku: string;
  options?: { name: string; value: string }[]; stock: number; wholesalePrice?: number | null; images?: ImageRecord[];
};
function safeImageUrl(value: string) {
  try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : ""; }
  catch { return ""; }
}
function variantLabel(variant: VariantRecord) {
  const label = (variant.options ?? []).map((option) => [option.name, option.value].filter(Boolean).join(": ")).filter(Boolean).join(" · ");
  return label || variant.label || "Opción disponible";
}
async function getCombo(resellerId: string, comboId: string) {
  if (!mongoose.isValidObjectId(comboId)) return null;
  await connectMongoDB();
  const identityFilter = /^[a-f0-9]{24}$/i.test(resellerId)
    ? { $or: [{ _id: resellerId }, { storeSlug: resellerId }] }
    : { storeSlug: resellerId };
  const seller = await UserModel.findOne({ ...identityFilter, role: { $in: ["RESELLER", "ADMIN"] }, isActive: true })
    .select("_id firstName lastName phone storeName storeWhatsApp storeLogoUrl storeSlug storeDescription").lean() as any;
  if (!seller) return null;
  const combo = await ResellerComboModel.findOne({ _id: comboId, resellerId: seller._id, isActive: true }).lean() as any;
  if (!combo || !Array.isArray(combo.components) || combo.components.length < 2) return null;
  const productIds = combo.components.map((component: any) => component.productId);
  const [products, variants] = await Promise.all([
    ProductModel.find({ _id: { $in: productIds }, isActive: true })
      .select("_id title description wholesalePrice images").lean() as any,
    ProductVariantModel.find({ productId: { $in: productIds }, isActive: true, stock: { $gt: 0 } })
      .select("_id productId label sku options stock wholesalePrice images").lean() as unknown as VariantRecord[],
  ]);
  const productById = new Map<string, any>(products.map((product: any) => [String(product._id), product]));
  const variantsByProduct = new Map<string, VariantRecord[]>();
  for (const variant of variants) {
    const key = String(variant.productId);
    variantsByProduct.set(key, [...(variantsByProduct.get(key) ?? []), variant]);
  }
  const safeImages = (images?: ImageRecord[]) => (images ?? [])
    .map((image) => ({ ...image, url: safeImageUrl(image.url) })).filter((image) => Boolean(image.url));
  const components = combo.components.map((component: any) => {
    const productId = String(component.productId);
    const product = productById.get(productId);
    if (!product) return null;
    const componentVariants = variantsByProduct.get(productId) ?? [];
    return {
      productId,
      title: product.title,
      quantity: Number(component.quantity ?? 1),
      images: safeImages(product.images),
      variants: componentVariants.map((variant) => ({
        id: String(variant._id),
        label: variantLabel(variant),
        stock: variant.stock,
        wholesalePrice: Number(variant.wholesalePrice ?? product.wholesalePrice ?? 0),
        options: variant.options ?? [],
        images: safeImages(variant.images),
      })),
    };
  });
  if (components.some((component: any) => !component)) return null;
  const resellerName = seller.storeName?.trim() || [seller.firstName, seller.lastName].filter(Boolean).join(" ");
  return {
    sellerId: String(seller._id),
    sellerName: resellerName,
    storeSlug: seller.storeSlug?.trim() || String(seller._id),
    logoUrl: seller.storeLogoUrl ? safeImageUrl(seller.storeLogoUrl) : "",
    description: seller.storeDescription?.trim() ?? "",
    profitMode: combo.profitMode as "FIXED" | "PERCENT",
    profitValue: Number(combo.profitValue),
    combo: {
      id: String(combo._id),
      title: String(combo.title),
      description: String(combo.description ?? ""),
      components,
      available: components.every((component: any) => component.variants.length > 0),
    },
  };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { resellerId, comboId } = await params;
  const data = await getCombo(resellerId, comboId);
  if (!data) return { title: "Combo no disponible | TrendinShop", robots: { index: false, follow: false } };
  const description = data.combo.description || data.combo.title + " disponible en el catálogo de " + data.sellerName + ".";
  return {
    title: data.combo.title + " | " + data.sellerName,
    description: description.slice(0, 160),
    openGraph: { title: data.combo.title + " | " + data.sellerName, description, type: "website", images: data.combo.components.flatMap((component: any) => component.images.slice(0, 1)).map((image: ImageRecord) => ({ url: image.url })) },
  };
}

export default async function PublicComboPage({ params }: PageProps) {
  const { resellerId, comboId } = await params;
  const data = await getCombo(resellerId, comboId);
  if (!data) notFound();
  return (
    <main className="public-catalog-shell public-product-shell">
      <div className="public-catalog-container">
        <PublicStorefrontHeader resellerId={data.sellerId} storeSlug={data.storeSlug} storeName={data.sellerName} logoUrl={data.logoUrl}/>
        <nav className="public-product-breadcrumb" aria-label="Ruta de navegación">
          <Link href={"/tienda/" + data.storeSlug}>{data.sellerName}</Link><span>/</span><span>{data.combo.title}</span>
        </nav>
        {!data.combo.available ? <div className="public-cart-feedback error">Este combo está agotado por el momento.</div> : null}
        <PublicComboControls
          resellerId={data.sellerId}
          storeSlug={data.storeSlug}
          comboId={data.combo.id}
          title={data.combo.title}
          description={data.combo.description}
          profitMode={data.profitMode}
          profitValue={data.profitValue}
          components={data.combo.components}
        />
        <Link href={"/tienda/" + data.storeSlug} className="public-product-back-link">← Volver al catálogo de {data.sellerName}</Link>
        <footer className="public-catalog-footer"><span>Catálogo creado con <strong>TrendinShop</strong></span><span>Precios y disponibilidad sujetos a cambios.</span></footer>
      </div>
    </main>
  );
}
