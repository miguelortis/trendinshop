import mongoose from "mongoose";
import { notFound } from "next/navigation";
import { connectMongoDB } from "@/lib/db/mongodb";
import { UserModel } from "@/models/User";
import { PublicCartExperience } from "@/components/catalog/PublicCartExperience";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ resellerId: string }>;
  searchParams: Promise<{ share?: string }>;
};
type SellerRecord = {
  _id: mongoose.Types.ObjectId;
  firstName: string;
  lastName: string;
  phone?: string;
  storeName?: string;
  storeWhatsApp?: string;
  storeSlug?: string;
  storeLogoUrl?: string;
};

export default async function PublicCartPage({ params, searchParams }: PageProps) {
  const { resellerId } = await params;
  const query = await searchParams;
  if (!resellerId.trim()) notFound();

  await connectMongoDB();
  const identityFilter = mongoose.isValidObjectId(resellerId)
    ? { $or: [{ _id: resellerId }, { storeSlug: resellerId }] }
    : { storeSlug: resellerId };
  const seller = await UserModel.findOne({
    ...identityFilter,
    role: { $in: ["ADMIN", "RESELLER"] },
    isActive: true,
  }).select("_id firstName lastName phone storeName storeWhatsApp storeSlug storeLogoUrl")
    .lean() as unknown as SellerRecord | null;

  if (!seller) notFound();

  return (
    <PublicCartExperience
      resellerId={String(seller._id)}
      storeSlug={seller.storeSlug?.trim() || String(seller._id)}
      storeName={seller.storeName?.trim() || [seller.firstName, seller.lastName].filter(Boolean).join(" ")}
      sellerPhone={seller.storeWhatsApp?.trim() || seller.phone || ""}
      logoUrl={seller.storeLogoUrl ?? ""}
      shareToken={query.share ?? ""}
    />
  );
}
