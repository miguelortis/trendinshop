import { model, models, Schema, type InferSchemaType } from "mongoose";

const publicCartShareItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    variantId: { type: Schema.Types.ObjectId, ref: "ProductVariant", required: true },
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
    items: { type: [publicCartShareItemSchema], required: true, validate: (items: unknown[]) => items.length > 0 && items.length <= 30 },
    expiresAt: { type: Date, required: true },
    isActive: { type: Boolean, default: true, required: true, index: true },
  },
  { timestamps: true, versionKey: false },
);

publicCartShareSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
publicCartShareSchema.index({ resellerId: 1, createdAt: -1 });

export type PublicCartShare = InferSchemaType<typeof publicCartShareSchema>;
export const PublicCartShareModel =
  models.PublicCartShare || model("PublicCartShare", publicCartShareSchema);
