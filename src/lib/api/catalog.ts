import { NextResponse } from "next/server";
import { connectMongoDB } from "@/lib/db/mongodb";
import { CategoryModel } from "@/models/Category";
import { ProductModel } from "@/models/Product";

function errorResponse(message: string, status = 400, code = "BAD_REQUEST") {
  return NextResponse.json({ ok: false, error: code, message }, { status });
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

export async function listCategories() {
  try {
    await connectMongoDB();
    const categories = await CategoryModel.find({ isActive: true })
      .sort({ sortOrder: 1, name: 1 })
      .lean();

    return NextResponse.json({ ok: true, categories });
  } catch (error) {
    console.error("[CATEGORIES_LIST]", error);
    return errorResponse("No pudimos cargar las categorías.", 500, "INTERNAL_ERROR");
  }
}

export async function createCategory(request: Request, userRole: string) {
  if (userRole !== "ADMIN") {
    return errorResponse("No tienes permisos para crear categorías.", 403, "FORBIDDEN");
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const name = text(body.name);
    const description = text(body.description);

    if (!name) return errorResponse("El nombre de la categoría es obligatorio.");

    await connectMongoDB();

    const slug = slugify(name);
    if (!slug) return errorResponse("El nombre de la categoría no es válido.");

    const existing = await CategoryModel.exists({ slug });
    if (existing) {
      return errorResponse("Ya existe una categoría con ese nombre.", 409, "CATEGORY_EXISTS");
    }

    const category = await CategoryModel.create({
      name,
      slug,
      description,
      isActive: true,
    });

    return NextResponse.json({ ok: true, category }, { status: 201 });
  } catch (error) {
    console.error("[CATEGORY_CREATE]", error);
    return errorResponse("No pudimos crear la categoría.", 500, "INTERNAL_ERROR");
  }
}

export async function listProducts() {
  try {
    await connectMongoDB();
    const products = await ProductModel.find({ isActive: true })
      .populate("categoryId", "name slug")
      .sort({ createdAt: -1 })
      .lean();

    return NextResponse.json({ ok: true, products });
  } catch (error) {
    console.error("[PRODUCTS_LIST]", error);
    return errorResponse("No pudimos cargar los productos.", 500, "INTERNAL_ERROR");
  }
}
