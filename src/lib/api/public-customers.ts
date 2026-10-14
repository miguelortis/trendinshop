import { NextResponse } from "next/server";
import { connectMongoDB } from "@/lib/db/mongodb";
import { normalizeCustomerDocumentId } from "@/lib/customer-session";
import { CustomerIdentityModel } from "@/models/CustomerIdentity";
import { UserModel } from "@/models/User";

function errorResponse(message: string, status = 400, code = "BAD_REQUEST") {
  return NextResponse.json({ ok: false, error: code, message }, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

/**
 * Public lookup intentionally returns only a name and surname. Contact details,
 * addresses, session hashes and account metadata stay on the server.
 */
export async function lookupPublicCustomer(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const documentId = normalizeCustomerDocumentId(body.documentId);
    if (!documentId || documentId.length > 40) {
      return errorResponse("Introduce una cédula válida.", 400, "INVALID_DOCUMENT_ID");
    }

    await connectMongoDB();

    // Prefer the active account's current names if the document belongs to a reseller.
    const user = await UserModel.findOne({
      documentId,
      isActive: true,
    }).select("firstName lastName").lean() as unknown as {
      firstName: string;
      lastName: string;
    } | null;

    if (user) {
      return NextResponse.json({
        ok: true,
        exists: true,
        customer: {
          firstName: user.firstName,
          lastName: user.lastName,
        },
        message: "Encontramos un registro. Verifica que el nombre y apellido sean correctos.",
      }, { headers: { "Cache-Control": "no-store, max-age=0" } });
    }

    const identity = await CustomerIdentityModel.findOne({
      documentId,
      isActive: true,
    }).select("firstName lastName").lean() as unknown as {
      firstName: string;
      lastName: string;
    } | null;

    if (identity) {
      return NextResponse.json({
        ok: true,
        exists: true,
        customer: {
          firstName: identity.firstName,
          lastName: identity.lastName,
        },
        message: "Encontramos un registro. Verifica que el nombre y apellido sean correctos.",
      }, { headers: { "Cache-Control": "no-store, max-age=0" } });
    }

    return NextResponse.json({
      ok: true,
      exists: false,
      message: "No encontramos un registro con esa cédula. Completa tus datos para continuar.",
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    console.error("[PUBLIC_CUSTOMER_LOOKUP]", error);
    return errorResponse("No pudimos consultar la cédula. Inténtalo de nuevo.", 500, "INTERNAL_ERROR");
  }
}
