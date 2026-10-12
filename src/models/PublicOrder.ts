import { model, models, Schema, type InferSchemaType } from "mongoose";

const publicOrderItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    variantId: { type: Schema.Types.ObjectId, ref: "ProductVariant", required: true },
    productTitle: { type: String, required: true, trim: true },
    productSku: { type: String, required: true, trim: true },
    variantLabel: { type: String, required: true, trim: true },
    variantSku: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0.01 },
    lineTotal: { type: Number, required: true, min: 0.01 },
    stockAtRequest: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const publicOrderCustomerSchema = new Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, trim: true, default: "" },
    phone: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true, default: "" },
    address: { type: String, trim: true, default: "" },
  },
  { _id: false },
);

const publicOrderSchema = new Schema(
  {
    orderNumber: { type: String, required: true, unique: true, index: true },
    resellerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    resellerRole: { type: String, enum: ["ADMIN", "RESELLER"], required: true },
    customer: { type: publicOrderCustomerSchema, required: true },
    items: { type: [publicOrderItemSchema], required: true, validate: (items: unknown[]) => items.length > 0 },
    subtotal: { type: Number, required: true, min: 0.01 },
    note: { type: String, trim: true, default: "" },
    status: {
      type: String,
      enum: ["PENDING", "IN_PROGRESS", "CANCELLED", "CONVERTED"],
      required: true,
      default: "PENDING",
      index: true,
    },
    saleId: { type: Schema.Types.ObjectId, ref: "Sale", default: null, index: true },
    contactedAt: { type: Date, default: null },
    convertedAt: { type: Date, default: null },
    isActive: { type: Boolean, default: true, required: true, index: true },
  },
  { timestamps: true, versionKey: false },
);

publicOrderSchema.index({ resellerId: 1, status: 1, createdAt: -1 });

export type PublicOrder = InferSchemaType<typeof publicOrderSchema>;
export const PublicOrderModel = models.PublicOrder || model("PublicOrder", publicOrderSchema);
