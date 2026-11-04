import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import mongoose from "mongoose";
import { connectMongoDB } from "@/lib/db/mongodb";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth/session";
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

type ViewerRecord = {
  id: string;
  role: "ADMIN" | "RESELLER";
  documentId: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
};

async function getViewer() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    const payload = await verifySessionToken(token);
    await connectMongoDB();
    const user = await UserModel.findOne({ _id: payload.sub, isActive: true })
      .select("_id role documentId firstName lastName phone email")
      .lean() as unknown as {
        _id: mongoose.Types.ObjectId;
        role: "ADMIN" | "RESELLER";
        documentId: string;
        firstName: string;
        lastName: string;
        phone: string;
        email: string;
      } | null;

    if (!user) return null;
    return {
      id: String(user._id),
      role: user.role,
      documentId: user.documentId,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      email: user.email,
    } satisfies ViewerRecord;
  } catch {
    return null;
  }
}

export default async function PublicCartPage({ params, searchParams }: PageProps) {
  const { resellerId } = await params;
  const query = await searchParams;
  if (!resellerId.trim()) notFound();

  await connectMongoDB();
  const isResellerObjectId = /^[a-f0-9]{24}$/i.test(resellerId);
  const identityFilter = isResellerObjectId
    ? { $or: [{ _id: resellerId }, { storeSlug: resellerId }] }
    : { storeSlug: resellerId };
  const seller = await UserModel.findOne({
    ...identityFilter,
    role: { $in: ["ADMIN", "RESELLER"] },
    isActive: true,
  }).select("_id firstName lastName phone storeName storeWhatsApp storeSlug storeLogoUrl")
    .lean() as unknown as SellerRecord | null;

  if (!seller) notFound();

  const viewer = await getViewer();

  return (
    <PublicCartExperience
      resellerId={String(seller._id)}
      storeSlug={seller.storeSlug?.trim() || String(seller._id)}
      storeName={seller.storeName?.trim() || [seller.firstName, seller.lastName].filter(Boolean).join(" ")}
      sellerPhone={seller.storeWhatsApp?.trim() || seller.phone || ""}
      logoUrl={seller.storeLogoUrl ?? ""}
      shareToken={query.share ?? ""}
      viewer={viewer}
    />
  );
}
