import { model, models, Schema, type InferSchemaType } from "mongoose";

const productImageSchema = new Schema(
  {
    url: { type: String, required: true, trim: true },
    alt: { type: String, trim: true, default: "" },
  },
  { _id: false },
);

const productSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, index: true },
    slug: { type: String, required: true, trim: true, lowercase: true, unique: true, index: true },
    description: { type: String, trim: true, default: "" },
    categoryId: { type: Schema.Types.ObjectId, ref: "Category", required: true, index: true },
    sku: { type: String, required: true, trim: true, uppercase: true, unique: true, index: true },
    wholesalePrice: { type: Number, required: true, min: 0 },
    images: { type: [productImageSchema], default: [] },
    isActive: { type: Boolean, default: true, required: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  },
  { timestamps: true, versionKey: false },
);

productSchema.index({ categoryId: 1, isActive: 1 });

export type Product = InferSchemaType<typeof productSchema>;
export const ProductModel = models.Product || model("Product", productSchema);
