import { model, models, Schema, type InferSchemaType } from "mongoose";

const inventoryMovementSchema = new Schema(
  {
    variantId: { type: Schema.Types.ObjectId, ref: "ProductVariant", required: true, index: true },
    delta: { type: Number, required: true },
    type: {
      type: String,
      enum: ["INITIAL", "ADJUSTMENT", "SALE", "RETURN", "RESTOCK"],
      required: true,
    },
    reason: { type: String, trim: true, default: "" },
    referenceType: { type: String, trim: true, default: "" },
    referenceId: { type: String, trim: true, default: "" },
    performedBy: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  },
  { timestamps: true, versionKey: false },
);

inventoryMovementSchema.index({ variantId: 1, createdAt: -1 });

export type InventoryMovement = InferSchemaType<typeof inventoryMovementSchema>;
export const InventoryMovementModel =
  models.InventoryMovement || model("InventoryMovement", inventoryMovementSchema);
