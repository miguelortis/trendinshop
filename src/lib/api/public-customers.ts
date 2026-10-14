import { NextResponse } from "next/server";
import { connectMongoDB } from "@/lib/db/mongodb";
import { normalizeCustomerDocumentId, hasCustomerSessionToken } from "@/lib/customer-session";
import { CustomerIdentityModel } from "@/models/CustomerIdentity";

function errorResponse(message: string, status = 404, code = "CUSTOMER_PROFILE_NOT_FOUND") {
  return NextResponse.json({ ok: false, error: code, message }, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function lookupPublicCustomer(request: Request) {
  try {
    const url = new URL(request.url);
    const documentId = normalizeCustomerDocumentId(url.searchParams.get("documentId"));
    const token = url.searchParams.get("token")?.trim() ?? "";
    if (!documentId || documentId.length > 40 || !/^[a-f0-9]{64}$/i.test(token)) {
      return errorResponse("No pudimos recuperar los datos guardados en este dispositivo.");
    }

    await connectMongoDB();
    const customer = await CustomerIdentityModel.findOne({
      documentId,
      isActive: true,
    }).select("documentId firstName lastName phone email address sessionTokenHashes convertedUserId")
      .lean() as unknown as {
        documentId: string;
        firstName: string;
        lastName: string;
        phone: string;
        email?: string;
        address?: string;
        sessionTokenHashes?: string[];
        convertedUserId?: unknown;
      } | null;

    // Nunca se devuelve información personal basándose solamente en la cédula.
    if (!customer || !hasCustomerSessionToken(customer.sessionTokenHashes, token)) {
      return errorResponse("No pudimos recuperar los datos guardados en este dispositivo. Completa tus datos para continuar.");
    }

    return NextResponse.json({
      ok: true,
      customer: {
        documentId: customer.documentId,
        firstName: customer.firstName,
        lastName: customer.lastName,
        phone: customer.phone,
        email: customer.email ?? "",
        address: customer.address ?? "",
      },
      message: "Datos recuperados de forma segura.",
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    console.error("[PUBLIC_CUSTOMER_LOOKUP]", error);
    return errorResponse("No pudimos consultar los datos guardados.", 500, "INTERNAL_ERROR");
  }
}
