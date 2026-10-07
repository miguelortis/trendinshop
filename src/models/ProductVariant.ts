import { model, models, Schema, type InferSchemaType } from "mongoose";

const variantOptionSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    value: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const productVariantSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true, index: true },
    label: { type: String, required: true, trim: true },
    options: { type: [variantOptionSchema], default: [] },
    sku: { type: String, required: true, trim: true, uppercase: true, unique: true, index: true },
    wholesalePrice: { type: Number, min: 0, default: null },
    stock: { type: Number, min: 0, default: 0, required: true },
    lowStockThreshold: { type: Number, min: 0, default: 3, required: true },
    isActive: { type: Boolean, default: true, required: true, index: true },
  },
  { timestamps: true, versionKey: false },
);

productVariantSchema.index({ productId: 1, isActive: 1 });

export type ProductVariant = InferSchemaType<typeof productVariantSchema>;
export const ProductVariantModel =
  models.ProductVariant || model("ProductVariant", productVariantSchema);
