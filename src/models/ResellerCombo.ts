import { model, models, Schema, type InferSchemaType } from "mongoose";

const comboComponentSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    quantity: { type: Number, required: true, min: 1, max: 50 },
  },
  { _id: false },
);

const resellerComboSchema = new Schema(
  {
    resellerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String, trim: true, default: "", maxlength: 1000 },
    components: {
      type: [comboComponentSchema],
      required: true,
      validate: (items: unknown[]) => items.length >= 2 && items.length <= 5,
    },
    profitMode: { type: String, enum: ["FIXED", "PERCENT"], required: true, default: "FIXED" },
    profitValue: { type: Number, required: true, min: 0.01 },
    isActive: { type: Boolean, default: true, required: true, index: true },
  },
  { timestamps: true, versionKey: false },
);

resellerComboSchema.index({ resellerId: 1, isActive: 1, updatedAt: -1 });

export type ResellerCombo = InferSchemaType<typeof resellerComboSchema>;
export const ResellerComboModel =
  models.ResellerCombo || model("ResellerCombo", resellerComboSchema);
