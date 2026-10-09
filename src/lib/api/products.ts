import { copy, del } from "@vercel/blob";
import { NextResponse } from "next/server";
import { connectMongoDB } from "@/lib/db/mongodb";
import { CategoryModel } from "@/models/Category";
import { InventoryMovementModel } from "@/models/InventoryMovement";
import { ProductModel } from "@/models/Product";
import { ProductVariantModel } from "@/models/ProductVariant";
import mongoose from "mongoose";
import { isPendingProductImageUrl } from "@/lib/api/blob";

type ProductImageData = {
  url: string;
  alt: string;
  isPrimary: boolean;
};

type ParsedProductVariant = {
  _id?: string;
  label: string;
  sku: string;
  purchasePrice: number | null;
  wholesalePrice: number | null;
  stock: number;
  lowStockThreshold: number;
  options: { name: string; value: string }[];
};

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

function parseImages(value: unknown, title: string): ProductImageData[] {
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

async function promoteProductImages(
  images: ProductImageData[],
  userId: string,
  productId: string,
) {
  if (!images.length) {
    return { images: [], pendingUrls: [], permanentUrls: [] };
  }

  const promoted: { url: string; alt: string; isPrimary: boolean }[] = [];
  const pendingUrls: string[] = [];
  const permanentUrls: string[] = [];

  try {
    for (const [index, image] of images.entries()) {
      if (!isPendingProductImageUrl(image.url, userId)) {
        throw new Error("INVALID_PENDING_PRODUCT_IMAGE");
      }

      const sourceUrl = new URL(image.url);
      const pathname = decodeURIComponent(sourceUrl.pathname).replace(/^\/+/, "");
      const filename = pathname.split("/").pop() || "image-" + (index + 1) + ".webp";
      const destination = "products/" + userId + "/" + productId + "/" + filename;

      const copied = await copy(image.url, destination, {
        access: "public",
        addRandomSuffix: true,
      });

      promoted.push({
        ...image,
        url: copied.url,
      });
      pendingUrls.push(image.url);
      permanentUrls.push(copied.url);
    }

    return {
      images: promoted,
      pendingUrls,
      permanentUrls,
    };
  } catch (error) {
    if (permanentUrls.length) {
      try {
        await del(permanentUrls);
      } catch (cleanupError) {
        console.error("[PRODUCT_IMAGE_PROMOTION_CLEANUP]", cleanupError);
      }
    }

    throw error;
  }
}

function parseVariants(value: unknown): ParsedProductVariant[] {
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
      _id: text(item._id) || undefined,
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
        _id: "",
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

    const productId = new mongoose.Types.ObjectId();
    const promotedImages = await promoteProductImages(
      images,
      userId,
      productId.toString(),
    );

    const product = await ProductModel.create({
      _id: productId,
      title,
      slug,
      description,
      categoryId,
      sku,
      purchasePrice,
      wholesalePrice,
      images: promotedImages.images,
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

      if (promotedImages.pendingUrls.length) {
        try {
          await del(promotedImages.pendingUrls);
        } catch (cleanupError) {
          console.error("[PRODUCT_PENDING_IMAGE_CLEANUP]", cleanupError);
        }
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

      if (promotedImages.permanentUrls.length) {
        try {
          await del(promotedImages.permanentUrls);
        } catch (cleanupError) {
          console.error("[PRODUCT_IMAGE_ROLLBACK_CLEANUP]", cleanupError);
        }
      }

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


async function prepareEditedProductImages(
  requestedImages: ProductImageData[],
  currentImages: { url: string; alt?: string; isPrimary?: boolean }[],
  userId: string,
  productId: string,
) {
  const existingByUrl = new Map<string, { url: string; alt?: string; isPrimary?: boolean }>();
  for (const image of currentImages) {
    existingByUrl.set(image.url, image);
  }
  const finalImages: { url: string; alt: string; isPrimary: boolean }[] = [];
  const pendingUrls: string[] = [];
  const newPermanentUrls: string[] = [];

  try {
    for (const image of requestedImages) {
      const existing = existingByUrl.get(image.url);

      if (existing) {
        finalImages.push({
          url: existing.url,
          alt: image.alt || existing.alt || "",
          isPrimary: image.isPrimary,
        });
        continue;
      }

      if (!isPendingProductImageUrl(image.url, userId)) {
        throw new Error("INVALID_PRODUCT_IMAGE_URL");
      }

      const sourceUrl = new URL(image.url);
      const pathname = decodeURIComponent(sourceUrl.pathname).replace(/^\/+/, "");
      const filename = pathname.split("/").pop() || "image.webp";
      const copied = await copy(
        image.url,
        "products/" + userId + "/" + productId + "/" + filename,
        { access: "public", addRandomSuffix: true },
      );

      finalImages.push({
        url: copied.url,
        alt: image.alt,
        isPrimary: image.isPrimary,
      });
      pendingUrls.push(image.url);
      newPermanentUrls.push(copied.url);
    }

    return { images: finalImages, pendingUrls, newPermanentUrls };
  } catch (error) {
    if (newPermanentUrls.length) {
      try {
        await del(newPermanentUrls);
      } catch (cleanupError) {
        console.error("[PRODUCT_EDIT_IMAGE_ROLLBACK]", cleanupError);
      }
    }

    throw error;
  }
}

export async function updateProduct(
  request: Request,
  productId: string,
  userId: string,
  userRole: string,
) {
  if (userRole !== "ADMIN") {
    return errorResponse("Solo un administrador puede editar productos.", 403, "FORBIDDEN");
  }

  if (!mongoose.isValidObjectId(productId)) {
    return errorResponse("El producto solicitado no es válido.", 400, "INVALID_PRODUCT_ID");
  }

  let promotedImageUrls: string[] = [];
  let productSaved = false;

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

    if (!preferredSku) {
      return errorResponse("El SKU del producto es obligatorio.");
    }

    if (!Number.isFinite(purchasePrice) || purchasePrice < 0) {
      return errorResponse("El precio de compra no es válido.");
    }

    if (!Number.isFinite(wholesalePrice) || wholesalePrice < purchasePrice) {
      return errorResponse("El precio mayorista no puede ser menor que el precio de compra.");
    }

    if (!mongoose.isValidObjectId(categoryId)) {
      return errorResponse("La categoría no es válida.");
    }

    if (!variants.length) {
      return errorResponse("El producto debe tener al menos una variante.");
    }

    for (const variant of variants) {
      if (
        (variant.purchasePrice !== null &&
          (!Number.isFinite(variant.purchasePrice) || variant.purchasePrice < 0)) ||
        (variant.wholesalePrice !== null &&
          (!Number.isFinite(variant.wholesalePrice) || variant.wholesalePrice < 0)) ||
        (variant.purchasePrice !== null &&
          variant.wholesalePrice !== null &&
          variant.wholesalePrice < variant.purchasePrice) ||
        !Number.isFinite(variant.stock) ||
        variant.stock < 0 ||
        !Number.isFinite(variant.lowStockThreshold) ||
        variant.lowStockThreshold < 0
      ) {
        return errorResponse("Revisa los precios y el inventario de las variantes.");
      }
    }

    await connectMongoDB();

    const product = await ProductModel.findOne({ _id: productId, isActive: true });
    if (!product) {
      return errorResponse("No encontramos ese producto.", 404, "PRODUCT_NOT_FOUND");
    }

    const categoryExists = await CategoryModel.exists({ _id: categoryId, isActive: true });
    if (!categoryExists) {
      return errorResponse("La categoría no existe o está inactiva.", 404, "CATEGORY_NOT_FOUND");
    }

    const slug = slugify(title);
    if (!slug) {
      return errorResponse("El título no permite generar un identificador válido.");
    }

    const [duplicateSlug, duplicateSku] = await Promise.all([
      ProductModel.exists({ _id: { $ne: product._id }, slug }),
      ProductModel.exists({ _id: { $ne: product._id }, sku: preferredSku }),
    ]);

    if (duplicateSlug) {
      return errorResponse("Ya existe otro producto con ese nombre.", 409, "PRODUCT_EXISTS");
    }

    if (duplicateSku) {
      return errorResponse("Ese SKU ya pertenece a otro producto.", 409, "PRODUCT_SKU_EXISTS");
    }

    const activeVariants = await ProductVariantModel.find({
      productId: product._id,
      isActive: true,
    });
    const variantsById = new Map<string, (typeof activeVariants)[number]>();
    for (const variant of activeVariants) {
      variantsById.set(variant._id.toString(), variant);
    }
    const retainedVariantIds = new Set<string>();
    const variantSkus = new Set<string>();

    for (const [index, variant] of variants.entries()) {
      if (!variant.sku) {
        variant.sku = index === 0 ? preferredSku : preferredSku + "-" + (index + 1);
      }

      if (variantSkus.has(variant.sku)) {
        return errorResponse("Hay SKUs de variantes repetidos.");
      }
      variantSkus.add(variant.sku);

      if (variant._id) {
        if (!mongoose.isValidObjectId(variant._id) || !variantsById.has(variant._id)) {
          return errorResponse("Una variante no pertenece a este producto.", 400, "INVALID_VARIANT");
        }
        retainedVariantIds.add(variant._id);
      }
    }

    const excludedVariantIds = Array.from(retainedVariantIds)
      .map((id) => new mongoose.Types.ObjectId(id));
    const duplicateVariantSku = await ProductVariantModel.exists({
      sku: { $in: Array.from(variantSkus) },
      _id: { $nin: excludedVariantIds },
    });

    if (duplicateVariantSku) {
      return errorResponse("Uno de los SKUs de variantes ya está en uso.", 409, "VARIANT_SKU_EXISTS");
    }

    const currentImages: ProductImageData[] = Array.from(
      product.images as unknown as ProductImageData[],
    ).map((image: ProductImageData) => ({
      url: image.url,
      alt: image.alt,
      isPrimary: image.isPrimary,
    }));
    const preparedImages = await prepareEditedProductImages(
      images,
      currentImages,
      userId,
      product._id.toString(),
    );
    promotedImageUrls = preparedImages.newPermanentUrls;

    const previousImageUrls: string[] = currentImages.map(
      (image: ProductImageData) => image.url,
    );
    const retainedImageUrls = new Set<string>(
      preparedImages.images.map((image: ProductImageData) => image.url),
    );

    product.set({
      title,
      slug,
      description,
      categoryId,
      sku: preferredSku,
      purchasePrice,
      wholesalePrice,
      images: preparedImages.images,
    });
    await product.save();
    productSaved = true;

    for (const oldVariant of activeVariants) {
      if (!retainedVariantIds.has(oldVariant._id.toString())) {
        oldVariant.isActive = false;
        await oldVariant.save();
      }
    }

    for (const variant of variants) {
      if (variant._id) {
        const existing = variantsById.get(variant._id)!;
        const oldStock = existing.stock;
        existing.label = variant.label;
        existing.options = variant.options;
        existing.sku = variant.sku;
        existing.purchasePrice = variant.purchasePrice;
        existing.wholesalePrice = variant.wholesalePrice;
        existing.lowStockThreshold = variant.lowStockThreshold;
        existing.stock = variant.stock;
        existing.isActive = true;
        await existing.save();

        const delta = variant.stock - oldStock;
        if (delta !== 0) {
          await InventoryMovementModel.create({
            variantId: existing._id,
            delta,
            type: "ADJUSTMENT",
            reason: "Ajuste de stock desde la edición del producto",
            performedBy: userId,
          });
        }
      } else {
        const created = await ProductVariantModel.create({
          productId: product._id,
          label: variant.label,
          options: variant.options,
          sku: variant.sku,
          purchasePrice: variant.purchasePrice,
          wholesalePrice: variant.wholesalePrice,
          stock: variant.stock,
          lowStockThreshold: variant.lowStockThreshold,
          isActive: true,
        });

        if (created.stock > 0) {
          await InventoryMovementModel.create({
            variantId: created._id,
            delta: created.stock,
            type: "INITIAL",
            reason: "Stock inicial de nueva variante",
            performedBy: userId,
          });
        }
      }
    }

    if (preparedImages.pendingUrls.length) {
      try {
        await del(preparedImages.pendingUrls);
      } catch (cleanupError) {
        console.error("[PRODUCT_EDIT_PENDING_IMAGE_CLEANUP]", cleanupError);
      }
    }

    const obsoleteImages = previousImageUrls.filter(
      (url: string) => !retainedImageUrls.has(url),
    );
    if (obsoleteImages.length) {
      try {
        await del(obsoleteImages);
      } catch (cleanupError) {
        console.error("[PRODUCT_EDIT_OBSOLETE_IMAGE_CLEANUP]", cleanupError);
      }
    }

    const updatedVariants = await ProductVariantModel.find({
      productId: product._id,
      isActive: true,
    }).sort({ createdAt: 1 }).lean();

    return NextResponse.json({
      ok: true,
      product: await ProductModel.findById(product._id).populate("categoryId", "name slug").lean(),
      variants: updatedVariants,
      message: "Producto actualizado correctamente.",
    });
  } catch (error) {
    if (!productSaved && promotedImageUrls.length) {
      try {
        await del(promotedImageUrls);
      } catch (cleanupError) {
        console.error("[PRODUCT_EDIT_IMAGE_CLEANUP]", cleanupError);
      }
    }

    console.error("[PRODUCT_UPDATE]", error);
    return errorResponse("No pudimos guardar los cambios del producto.", 500, "INTERNAL_ERROR");
  }
}
