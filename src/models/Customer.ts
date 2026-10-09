import { model, models, Schema, type InferSchemaType } from "mongoose";

const customerSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    documentId: { type: String, required: true, trim: true, uppercase: true },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true, default: "" },
    address: { type: String, trim: true, default: "" },
    isActive: { type: Boolean, default: true, required: true, index: true },
  },
  { timestamps: true, versionKey: false },
);

customerSchema.index({ ownerId: 1, documentId: 1 }, { unique: true });
customerSchema.index({ ownerId: 1, isActive: 1, updatedAt: -1 });

export type Customer = InferSchemaType<typeof customerSchema>;
export const CustomerModel = models.Customer || model("Customer", customerSchema);
