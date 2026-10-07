import { NextResponse } from "next/server";
import { connectMongoDB } from "@/lib/db/mongodb";
import { CategoryModel } from "@/models/Category";
import { InventoryMovementModel } from "@/models/InventoryMovement";
import { ProductModel } from "@/models/Product";
import { ProductVariantModel } from "@/models/ProductVariant";
import mongoose from "mongoose";

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

function parseVariants(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value.map((raw, index) => {
    const item = (raw ?? {}) as Record<string, unknown>;

    const options = Array.isArray(item.options)
      ? item.options
          .map((option) => {
            const source = (option ?? {}) as Record<string, unknown>;
            return { name: text(source.name), value: text(source.value) };
          })
          .filter((option) => option.name && option.value)
      : [];

    const wholesalePrice =
      item.wholesalePrice === "" || item.wholesalePrice === undefined || item.wholesalePrice === null
        ? null
        : Number(item.wholesalePrice);

    return {
      label:
        text(item.label) ||
        (options.length
          ? options.map((option) => option.value).join(" / ")
          : "Variante " + (index + 1)),
      sku: text(item.sku).toUpperCase(),
      wholesalePrice,
      stock: Number(item.stock ?? 0),
      lowStockThreshold: Number(item.lowStockThreshold ?? 3),
      options,
    };
  });
}

export async function createProduct(request: Request, userId: string, userRole: string) {
  if (userRole !== "ADMIN") {
    return errorResponse("Solo un administrador puede crear productos.", 403, "FORBIDDEN");
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const title = text(body.title);
    const description = text(body.description);
    const categoryId = text(body.categoryId);
    const sku = text(body.sku).toUpperCase();
    const wholesalePrice = Number(body.wholesalePrice);
    const imageUrl = text(body.imageUrl);
    const variants = parseVariants(body.variants);

    if (!title || !categoryId || !sku) {
      return errorResponse("Título, categoría y SKU son obligatorios.");
    }

    if (!Number.isFinite(wholesalePrice) || wholesalePrice < 0) {
      return errorResponse("El precio mayorista no es válido.");
    }

    if (!mongoose.isValidObjectId(categoryId)) {
      return errorResponse("La categoría no es válida.");
    }

    if (variants.length === 0) {
      variants.push({
        label: "Única",
        sku,
        wholesalePrice: null,
        stock: Number(body.stock ?? 0),
        lowStockThreshold: Number(body.lowStockThreshold ?? 3),
        options: [],
      });
    }

    for (const variant of variants) {
      if (!variant.sku) return errorResponse("Cada variante necesita un SKU.");
      if (!Number.isFinite(variant.stock) || variant.stock < 0) {
        return errorResponse("El stock de las variantes no es válido.");
      }
      if (!Number.isFinite(variant.lowStockThreshold) || variant.lowStockThreshold < 0) {
        return errorResponse("El umbral de stock no es válido.");
      }
      if (
        variant.wholesalePrice !== null &&
        (!Number.isFinite(variant.wholesalePrice) || variant.wholesalePrice < 0)
      ) {
        return errorResponse("Hay un precio mayorista de variante inválido.");
      }
    }

    await connectMongoDB();

    const categoryExists = await CategoryModel.exists({ _id: categoryId, isActive: true });
    if (!categoryExists) {
      return errorResponse("La categoría no existe o está inactiva.", 404, "CATEGORY_NOT_FOUND");
    }

    const slug = slugify(title);
    if (!slug) return errorResponse("El título no permite generar un identificador válido.");

    const [existingSku, existingSlug] = await Promise.all([
      ProductModel.exists({ sku }),
      ProductModel.exists({ slug }),
    ]);

    if (existingSku) return errorResponse("Ya existe un producto con ese SKU.", 409, "SKU_EXISTS");
    if (existingSlug) return errorResponse("Ya existe un producto con ese nombre.", 409, "PRODUCT_EXISTS");

    const variantSkus = new Set<string>();

    for (const variant of variants) {
      if (variantSkus.has(variant.sku)) {
        return errorResponse("Hay SKUs de variantes repetidos.");
      }
      variantSkus.add(variant.sku);
    }

    const existingVariant = await ProductVariantModel.exists({
      sku: { $in: Array.from(variantSkus) },
    });

    if (existingVariant) {
      return errorResponse("Uno de los SKUs de variantes ya existe.", 409, "VARIANT_SKU_EXISTS");
    }

    const product = await ProductModel.create({
      title,
      slug,
      description,
      categoryId,
      sku,
      wholesalePrice,
      images: imageUrl ? [{ url: imageUrl, alt: title }] : [],
      isActive: true,
      createdBy: userId,
    });

    try {
      const createdVariants = await ProductVariantModel.insertMany(
        variants.map((variant) => ({
          productId: product._id,
          label: variant.label,
          options: variant.options,
          sku: variant.sku,
          wholesalePrice: variant.wholesalePrice,
          stock: variant.stock,
          lowStockThreshold: variant.lowStockThreshold,
          isActive: true,
        })),
      );

      const initialMovements = createdVariants
        .filter((variant) => variant.stock > 0)
        .map((variant) => ({
          variantId: variant._id,
          delta: variant.stock,
          type: "INITIAL" as const,
          reason: "Stock inicial del producto",
          performedBy: userId,
        }));

      if (initialMovements.length) {
        await InventoryMovementModel.insertMany(initialMovements);
      }

      return NextResponse.json(
        {
          ok: true,
          product,
          variants: createdVariants,
          message: "Producto creado correctamente.",
        },
        { status: 201 },
      );
    } catch (variantError) {
      await ProductVariantModel.deleteMany({ productId: product._id });
      await ProductModel.deleteOne({ _id: product._id });
      throw variantError;
    }
  } catch (error) {
    console.error("[PRODUCT_CREATE]", error);
    return errorResponse("No pudimos crear el producto.", 500, "INTERNAL_ERROR");
  }
}
