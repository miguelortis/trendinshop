import { model, models, Schema, type InferSchemaType } from "mongoose";

const resellerVariantPriceSchema = new Schema(
  {
    variantId: { type: Schema.Types.ObjectId, ref: "ProductVariant", required: true },
    sellingPrice: { type: Number, required: true, min: 0.01 },
  },
  { _id: false },
);

const resellerCatalogItemSchema = new Schema(
  {
    resellerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    productId: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },
    sellingPrice: { type: Number, required: true, min: 0 },
    variantPrices: { type: [resellerVariantPriceSchema], default: [] },
    isActive: { type: Boolean, default: true, required: true, index: true },
  },
  { timestamps: true, versionKey: false },
);

resellerCatalogItemSchema.index({ resellerId: 1, productId: 1 }, { unique: true });
resellerCatalogItemSchema.index({ resellerId: 1, isActive: 1, updatedAt: -1 });

export type ResellerCatalogItem = InferSchemaType<typeof resellerCatalogItemSchema>;
export const ResellerCatalogItemModel =
  models.ResellerCatalogItem || model("ResellerCatalogItem", resellerCatalogItemSchema);
