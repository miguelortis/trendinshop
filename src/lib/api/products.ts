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

function skuBase(value: string) {
  const base = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28);

  return base || "PRODUCTO";
}

async function createUniqueSku(preferred: string, title: string) {
  const base = skuBase(preferred || title);

  if (!(await ProductModel.exists({ sku: base }))) {
    return base;
  }

  for (let suffix = 2; suffix <= 9999; suffix += 1) {
    const candidate = base.slice(0, 24) + "-" + suffix;
    if (!(await ProductModel.exists({ sku: candidate }))) {
      return candidate;
    }
  }

  return base.slice(0, 20) + "-" + Date.now().toString().slice(-6);
}

function parseImages(value: unknown, title: string) {
  if (!Array.isArray(value)) return [];

  const unique = new Set<string>();
  const parsed = value
    .map((raw) => {
      const item = (raw ?? {}) as Record<string, unknown>;
      const url = text(item.url);

      if (!url || unique.has(url)) return null;
      unique.add(url);

      return {
        url,
        alt: text(item.alt) || title,
        isPrimary: item.isPrimary === true,
      };
    })
    .filter(
      (image): image is { url: string; alt: string; isPrimary: boolean } =>
        Boolean(image),
    )
    .slice(0, 12);

  const primaryIndex = parsed.findIndex((image) => image.isPrimary);

  return parsed.map((image, index) => ({
    ...image,
    isPrimary: primaryIndex >= 0 ? index === primaryIndex : index === 0,
  }));
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

    const purchasePrice =
      item.purchasePrice === "" ||
      item.purchasePrice === undefined ||
      item.purchasePrice === null
        ? null
        : Number(item.purchasePrice);

    const wholesalePrice =
      item.wholesalePrice === "" ||
      item.wholesalePrice === undefined ||
      item.wholesalePrice === null
        ? null
        : Number(item.wholesalePrice);

    return {
      label:
        text(item.label) ||
        (options.length
          ? options.map((option) => option.value).join(" / ")
          : "Variante " + (index + 1)),
      sku: text(item.sku).toUpperCase(),
      purchasePrice,
      wholesalePrice,
      stock: Number(item.stock ?? 0),
      lowStockThreshold: Number(item.lowStockThreshold ?? 3),
      options,
    };
  });
}

export async function createProduct(
  request: Request,
  userId: string,
  userRole: string,
) {
  if (userRole !== "ADMIN") {
    return errorResponse(
      "Solo un administrador puede crear productos.",
      403,
      "FORBIDDEN",
    );
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;

    const title = text(body.title);
    const description = text(body.description);
    const categoryId = text(body.categoryId);
    const preferredSku = text(body.sku).toUpperCase();
    const purchasePrice = Number(body.purchasePrice);
    const wholesalePrice = Number(body.wholesalePrice);
    const images = parseImages(body.images, title);
    const variants = parseVariants(body.variants);

    if (!title || !categoryId) {
      return errorResponse("Título y categoría son obligatorios.");
    }

    if (!Number.isFinite(purchasePrice) || purchasePrice < 0) {
      return errorResponse("El precio de compra no es válido.");
    }

    if (!Number.isFinite(wholesalePrice) || wholesalePrice < 0) {
      return errorResponse("El precio mayorista no es válido.");
    }

    if (!mongoose.isValidObjectId(categoryId)) {
      return errorResponse("La categoría no es válida.");
    }

    if (wholesalePrice < purchasePrice) {
      return errorResponse(
        "El precio mayorista no puede ser menor que el precio de compra.",
      );
    }

    if (variants.length === 0) {
      variants.push({
        label: "Única",
        sku: preferredSku,
        purchasePrice: null,
        wholesalePrice: null,
        stock: Number(body.stock ?? 0),
        lowStockThreshold: Number(body.lowStockThreshold ?? 3),
        options: [],
      });
    }

    for (const variant of variants) {
      if (
        variant.purchasePrice !== null &&
        (!Number.isFinite(variant.purchasePrice) || variant.purchasePrice < 0)
      ) {
        return errorResponse("Hay un precio de compra de variante inválido.");
      }

      if (
        variant.wholesalePrice !== null &&
        (!Number.isFinite(variant.wholesalePrice) || variant.wholesalePrice < 0)
      ) {
        return errorResponse("Hay un precio mayorista de variante inválido.");
      }

      if (
        variant.purchasePrice !== null &&
        variant.wholesalePrice !== null &&
        variant.wholesalePrice < variant.purchasePrice
      ) {
        return errorResponse(
          "Una variante tiene el precio mayorista por debajo de su precio de compra.",
        );
      }

      if (!Number.isFinite(variant.stock) || variant.stock < 0) {
        return errorResponse("El stock de las variantes no es válido.");
      }

      if (
        !Number.isFinite(variant.lowStockThreshold) ||
        variant.lowStockThreshold < 0
      ) {
        return errorResponse("El umbral de stock no es válido.");
      }
    }

    await connectMongoDB();

    const categoryExists = await CategoryModel.exists({
      _id: categoryId,
      isActive: true,
    });

    if (!categoryExists) {
      return errorResponse(
        "La categoría no existe o está inactiva.",
        404,
        "CATEGORY_NOT_FOUND",
      );
    }

    const slug = slugify(title);

    if (!slug) {
      return errorResponse(
        "El título no permite generar un identificador válido.",
      );
    }

    const sku = await createUniqueSku(preferredSku, title);
    const existingSlug = await ProductModel.exists({ slug });

    if (existingSlug) {
      return errorResponse(
        "Ya existe un producto con ese nombre.",
        409,
        "PRODUCT_EXISTS",
      );
    }

    const variantSkus = new Set<string>();

    for (const variant of variants) {
      if (!variant.sku) {
        variant.sku =
          variantSkus.size === 0 ? sku : sku + "-" + (variantSkus.size + 1);
      }

      if (variantSkus.has(variant.sku)) {
        return errorResponse("Hay SKUs de variantes repetidos.");
      }

      variantSkus.add(variant.sku);
    }

    const existingVariant = await ProductVariantModel.exists({
      sku: { $in: Array.from(variantSkus) },
    });

    if (existingVariant) {
      return errorResponse(
        "Uno de los SKUs de variantes ya existe.",
        409,
        "VARIANT_SKU_EXISTS",
      );
    }

    const product = await ProductModel.create({
      title,
      slug,
      description,
      categoryId,
      sku,
      purchasePrice,
      wholesalePrice,
      images,
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
          purchasePrice: variant.purchasePrice,
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
    return errorResponse(
      "No pudimos crear el producto.",
      500,
      "INTERNAL_ERROR",
    );
  }
}
