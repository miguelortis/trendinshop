import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectMongoDB } from "@/lib/db/mongodb";
import { CustomerModel } from "@/models/Customer";

type CustomerInput = {
  documentId: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  address: string;
};

function errorResponse(message: string, status = 400, code = "BAD_REQUEST") {
  return NextResponse.json({ ok: false, error: code, message }, { status });
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeDocumentId(value: unknown) {
  return text(value).toUpperCase().replace(/[.\s-]/g, "");
}

function readCustomerInput(body: Record<string, unknown>): CustomerInput | null {
  const input = {
    documentId: normalizeDocumentId(body.documentId),
    firstName: text(body.firstName),
    lastName: text(body.lastName),
    phone: text(body.phone),
    email: text(body.email).toLowerCase(),
    address: text(body.address),
  };

  if (!input.documentId || !input.firstName || !input.lastName || !input.phone) {
    return null;
  }

  if (input.documentId.length > 40 || input.firstName.length > 100 ||
      input.lastName.length > 100 || input.phone.length > 40 ||
      input.email.length > 200 || input.address.length > 300) {
    return null;
  }

  if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) {
    return null;
  }

  return input;
}

function serializeCustomer<T extends { _id: unknown }>(customer: T) {
  // Mongoose documents and .lean() results can have different inferred types.
  // Normalize both into the same JSON-safe shape at this boundary.
  const value = customer as unknown as Record<string, unknown>;

  return {
    _id: String(value._id),
    documentId: text(value.documentId),
    firstName: text(value.firstName),
    lastName: text(value.lastName),
    phone: text(value.phone),
    email: text(value.email),
    address: text(value.address),
    createdAt: value.createdAt instanceof Date ? value.createdAt : undefined,
    updatedAt: value.updatedAt instanceof Date ? value.updatedAt : undefined,
  };
}

export async function listCustomers(userId: string) {
  try {
    await connectMongoDB();
    const customers = await CustomerModel.find({ ownerId: userId, isActive: true })
      .sort({ updatedAt: -1 })
      .limit(500)
      .lean();

    return NextResponse.json({
      ok: true,
      customers: customers.map((customer) => serializeCustomer(customer)),
    });
  } catch (error) {
    console.error("[CUSTOMERS_LIST]", error);
    return errorResponse("No pudimos cargar los clientes.", 500, "INTERNAL_ERROR");
  }
}

export async function createCustomer(request: Request, userId: string) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const input = readCustomerInput(body);
    if (!input) {
      return errorResponse(
        "Revisa los datos: cédula, nombre, apellido y teléfono son obligatorios; el correo debe ser válido.",
      );
    }

    await connectMongoDB();

    const existing = await CustomerModel.findOne({
      ownerId: userId,
      documentId: input.documentId,
    }).exec();

    if (existing?.isActive) {
      return errorResponse("Ya tienes un cliente registrado con esa cédula.", 409, "CUSTOMER_EXISTS");
    }

    if (existing) {
      Object.assign(existing, input);
      existing.isActive = true;
      await existing.save();
      return NextResponse.json({
        ok: true,
        customer: serializeCustomer(existing),
        message: "Cliente reactivado correctamente.",
      });
    }

    const customer = await CustomerModel.create({
      ownerId: userId,
      ...input,
      isActive: true,
    });

    return NextResponse.json({
      ok: true,
      customer: serializeCustomer(customer),
      message: "Cliente creado correctamente.",
    }, { status: 201 });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
      return errorResponse("Ya existe un cliente con esa cédula en tu cuenta.", 409, "CUSTOMER_EXISTS");
    }
    console.error("[CUSTOMER_CREATE]", error);
    return errorResponse("No pudimos crear el cliente.", 500, "INTERNAL_ERROR");
  }
}

export async function updateCustomer(request: Request, customerId: string, userId: string) {
  if (!mongoose.isValidObjectId(customerId)) {
    return errorResponse("El cliente solicitado no es válido.", 400, "INVALID_CUSTOMER_ID");
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const input = readCustomerInput(body);
    if (!input) {
      return errorResponse(
        "Revisa los datos: cédula, nombre, apellido y teléfono son obligatorios; el correo debe ser válido.",
      );
    }

    await connectMongoDB();

    const duplicate = await CustomerModel.exists({
      ownerId: userId,
      documentId: input.documentId,
      _id: { $ne: customerId },
    });
    if (duplicate) {
      return errorResponse("Ya existe otro cliente con esa cédula en tu cuenta.", 409, "CUSTOMER_EXISTS");
    }

    const customer = await CustomerModel.findOne({
      _id: customerId,
      ownerId: userId,
      isActive: true,
    }).exec();

    if (!customer) {
      return errorResponse("No encontramos ese cliente.", 404, "CUSTOMER_NOT_FOUND");
    }

    Object.assign(customer, input);
    await customer.save();

    return NextResponse.json({
      ok: true,
      customer: serializeCustomer(customer),
      message: "Cliente actualizado correctamente.",
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
      return errorResponse("Ya existe otro cliente con esa cédula en tu cuenta.", 409, "CUSTOMER_EXISTS");
    }
    console.error("[CUSTOMER_UPDATE]", error);
    return errorResponse("No pudimos actualizar el cliente.", 500, "INTERNAL_ERROR");
  }
}

export async function removeCustomer(customerId: string, userId: string) {
  if (!mongoose.isValidObjectId(customerId)) {
    return errorResponse("El cliente solicitado no es válido.", 400, "INVALID_CUSTOMER_ID");
  }

  try {
    await connectMongoDB();
    const customer = await CustomerModel.findOneAndUpdate(
      { _id: customerId, ownerId: userId, isActive: true },
      { $set: { isActive: false } },
      { new: true },
    ).exec();

    if (!customer) {
      return errorResponse("No encontramos ese cliente.", 404, "CUSTOMER_NOT_FOUND");
    }

    return NextResponse.json({ ok: true, message: "Cliente archivado correctamente." });
  } catch (error) {
    console.error("[CUSTOMER_REMOVE]", error);
    return errorResponse("No pudimos archivar el cliente.", 500, "INTERNAL_ERROR");
  }
}
