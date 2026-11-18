import { model, models, Schema, type InferSchemaType } from "mongoose";

const sharedComboComponentSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    variantId: { type: Schema.Types.ObjectId, ref: "ProductVariant", required: true },
    quantity: { type: Number, required: true, min: 1 },
    productTitle: { type: String, trim: true, default: "" },
    productSku: { type: String, trim: true, default: "" },
    variantLabel: { type: String, trim: true, default: "" },
    variantSku: { type: String, trim: true, default: "" },
    unitCost: { type: Number, min: 0, default: 0 },
  },
  { _id: false },
);

const publicCartShareItemSchema = new Schema(
  {
    kind: { type: String, enum: ["PRODUCT", "COMBO"], default: "PRODUCT", required: true },
    comboId: { type: Schema.Types.ObjectId, ref: "ResellerCombo", default: null },
    components: { type: [sharedComboComponentSchema], default: [] },
    productId: { type: Schema.Types.ObjectId, ref: "Product", default: null },
    variantId: { type: Schema.Types.ObjectId, ref: "ProductVariant", default: null },
    quantity: { type: Number, required: true, min: 1, max: 100 },
    productTitle: { type: String, trim: true, default: "" },
    variantLabel: { type: String, trim: true, default: "" },
    unitPrice: { type: Number, min: 0, default: 0 },
  },
  { _id: false },
);

const publicCartShareSchema = new Schema(
  {
    token: { type: String, required: true, unique: true, index: true },
    resellerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    items: {
      type: [publicCartShareItemSchema],
      required: true,
      validate: (items: any[]) => items.length > 0 && items.length <= 30 &&
        items.every((item) => item.kind === "COMBO"
          ? Boolean(item.comboId) && Array.isArray(item.components) && item.components.length >= 2 && item.components.length <= 5
          : Boolean(item.productId) && Boolean(item.variantId)),
    },
    expiresAt: { type: Date, required: true },
    isActive: { type: Boolean, default: true, required: true, index: true },
  },
  { timestamps: true, versionKey: false },
);

publicCartShareSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
publicCartShareSchema.index({ resellerId: 1, createdAt: -1 });

export type PublicCartShare = InferSchemaType<typeof publicCartShareSchema>;
export const PublicCartShareModel = models.PublicCartShare || model("PublicCartShare", publicCartShareSchema);
