import { model, models, Schema, type InferSchemaType } from "mongoose";

const salePaymentSchema = new Schema(
  {
    saleId: { type: Schema.Types.ObjectId, ref: "Sale", required: true, index: true },
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    amount: { type: Number, required: true, min: 0.01 },
    method: {
      type: String,
      enum: ["CASH", "TRANSFER", "CARD", "OTHER"],
      required: true,
    },
    note: { type: String, trim: true, default: "" },
    receivedBy: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  },
  { timestamps: true, versionKey: false },
);

salePaymentSchema.index({ ownerId: 1, createdAt: -1 });
salePaymentSchema.index({ saleId: 1, createdAt: 1 });

export type SalePayment = InferSchemaType<typeof salePaymentSchema>;
export const SalePaymentModel = models.SalePayment || model("SalePayment", salePaymentSchema);
