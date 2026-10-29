import { model, models, Schema, type InferSchemaType } from "mongoose";

const saleOptionSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    value: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const saleCustomerSnapshotSchema = new Schema(
  {
    documentId: { type: String, default: "" },
    firstName: { type: String, default: "Cliente" },
    lastName: { type: String, default: "" },
    phone: { type: String, default: "" },
    email: { type: String, default: "" },
    address: { type: String, default: "" },
  },
  { _id: false },
);

const saleItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    variantId: { type: Schema.Types.ObjectId, ref: "ProductVariant", required: true },
    productTitle: { type: String, required: true, trim: true },
    productSku: { type: String, required: true, trim: true },
    variantLabel: { type: String, required: true, trim: true },
    variantSku: { type: String, required: true, trim: true },
    options: { type: [saleOptionSchema], default: [] },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    unitCost: { type: Number, required: true, min: 0 },
    lineTotal: { type: Number, required: true, min: 0 },
    lineCostTotal: { type: Number, required: true, min: 0 },
    lineProfit: { type: Number, required: true },
    supplierAmountPaid: { type: Number, min: 0 },
    supplierBalanceDue: { type: Number, min: 0 },
  },
  { _id: false },
);

const saleSchema = new Schema(
  {
    saleNumber: { type: String, required: true, unique: true, index: true },
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    ownerRole: { type: String, enum: ["ADMIN", "RESELLER"] },
    saleStatus: { type: String, enum: ["ACTIVE", "CANCELLED"], required: true, default: "ACTIVE", index: true },
    cancellationReason: { type: String, trim: true, default: "" },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    customerId: { type: Schema.Types.ObjectId, ref: "Customer", default: null, index: true },
    customerSnapshot: { type: saleCustomerSnapshotSchema, default: () => ({}) },
    items: { type: [saleItemSchema], required: true, validate: (items: unknown[]) => items.length > 0 },
    subtotal: { type: Number, required: true, min: 0 },
    total: { type: Number, required: true, min: 0 },
    totalCost: { type: Number, required: true, min: 0 },
    grossProfit: { type: Number, required: true },
    supplierAmountDue: { type: Number, min: 0 },
    supplierAmountPaid: { type: Number, min: 0 },
    supplierBalanceDue: { type: Number, min: 0 },
    supplierPaymentStatus: {
      type: String,
      enum: ["UNPAID", "PARTIAL", "PAID"],
    },
    amountPaid: { type: Number, required: true, min: 0, default: 0 },
    balanceDue: { type: Number, required: true, min: 0, default: 0 },
    paymentStatus: {
      type: String,
      enum: ["UNPAID", "PARTIAL", "PAID"],
      required: true,
      default: "UNPAID",
      index: true,
    },
    note: { type: String, trim: true, default: "" },
    isActive: { type: Boolean, default: true, required: true, index: true },
  },
  { timestamps: true, versionKey: false },
);

saleSchema.index({ ownerId: 1, createdAt: -1 });
saleSchema.index({ ownerId: 1, paymentStatus: 1, createdAt: -1 });

export type Sale = InferSchemaType<typeof saleSchema>;
export const SaleModel = models.Sale || model("Sale", saleSchema);
