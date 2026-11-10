import { model, models, Schema, type InferSchemaType } from "mongoose";

const supplierPaymentAllocationSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    variantId: { type: Schema.Types.ObjectId, ref: "ProductVariant", required: true },
    productTitle: { type: String, required: true, trim: true },
    variantLabel: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0.01 },
  },
  { _id: false },
);

const resellerSupplierPaymentSchema = new Schema(
  {
    saleId: { type: Schema.Types.ObjectId, ref: "Sale", required: true, index: true },
    resellerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    amount: { type: Number, required: true, min: 0.01 },
    method: {
      type: String,
      enum: ["CASH", "TRANSFER", "CARD", "OTHER"],
      required: true,
    },
    note: { type: String, trim: true, default: "" },
    receivedBy: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    status: { type: String, enum: ["PENDING", "CONFIRMED", "REJECTED"], default: "CONFIRMED", required: true, index: true },
    reference: { type: String, trim: true, default: "" },
    submittedAt: { type: Date, default: Date.now, required: true },
    confirmedAt: { type: Date, default: null },
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    reviewNote: { type: String, trim: true, default: "" },
    allocations: { type: [supplierPaymentAllocationSchema], default: [] },
  },
  { timestamps: true, versionKey: false },
);

resellerSupplierPaymentSchema.index({ resellerId: 1, createdAt: -1 });
resellerSupplierPaymentSchema.index({ saleId: 1, createdAt: 1 });

export type ResellerSupplierPayment = InferSchemaType<typeof resellerSupplierPaymentSchema>;
export const ResellerSupplierPaymentModel =
  models.ResellerSupplierPayment || model("ResellerSupplierPayment", resellerSupplierPaymentSchema);
