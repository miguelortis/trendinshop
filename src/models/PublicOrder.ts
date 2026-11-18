import { model, models, Schema, type InferSchemaType } from "mongoose";

const publicOrderComboComponentSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    variantId: { type: Schema.Types.ObjectId, ref: "ProductVariant", required: true },
    productTitle: { type: String, required: true, trim: true },
    productSku: { type: String, required: true, trim: true },
    variantLabel: { type: String, required: true, trim: true },
    variantSku: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 1 },
    unitCost: { type: Number, required: true, min: 0 },
    stockAtRequest: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const publicOrderItemSchema = new Schema(
  {
    kind: { type: String, enum: ["PRODUCT", "COMBO"], default: "PRODUCT", required: true },
    comboId: { type: Schema.Types.ObjectId, ref: "ResellerCombo", default: null },
    comboTitle: { type: String, trim: true, default: "" },
    components: { type: [publicOrderComboComponentSchema], default: [] },
    productId: { type: Schema.Types.ObjectId, ref: "Product", default: null },
    variantId: { type: Schema.Types.ObjectId, ref: "ProductVariant", default: null },
    productTitle: { type: String, required: true, trim: true },
    productSku: { type: String, trim: true, default: "" },
    variantLabel: { type: String, trim: true, default: "" },
    variantSku: { type: String, trim: true, default: "" },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0.01 },
    lineTotal: { type: Number, required: true, min: 0.01 },
    stockAtRequest: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const publicOrderCustomerSchema = new Schema(
  {
    documentId: { type: String, trim: true, uppercase: true, default: "" },
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
    customerProfileId: { type: Schema.Types.ObjectId, ref: "CustomerIdentity", default: null, index: true },
    items: {
      type: [publicOrderItemSchema],
      required: true,
      validate: (items: any[]) => items.length > 0 && items.every((item) =>
        item.kind === "COMBO"
          ? Boolean(item.comboId) && Array.isArray(item.components) && item.components.length >= 2 && item.components.length <= 5
          : Boolean(item.productId) && Boolean(item.variantId)),
    },
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
