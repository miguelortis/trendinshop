import { model, models, Schema, type InferSchemaType } from "mongoose";

const customerIdentitySchema = new Schema(
  {
    documentId: { type: String, required: true, trim: true, uppercase: true },
    firstName: { type: String, required: true, trim: true, maxlength: 100 },
    lastName: { type: String, required: true, trim: true, maxlength: 100 },
    phone: { type: String, required: true, trim: true, maxlength: 40 },
    email: { type: String, trim: true, lowercase: true, maxlength: 200, default: "" },
    address: { type: String, trim: true, maxlength: 300, default: "" },
    dataProcessingConsent: { type: Boolean, default: false, required: true },
    dataProcessingConsentAt: { type: Date, default: null },
    notificationsWhatsAppConsent: { type: Boolean, default: false, required: true },
    notificationsEmailConsent: { type: Boolean, default: false, required: true },
    sessionTokenHashes: { type: [String], default: [] },
    convertedUserId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    isActive: { type: Boolean, default: true, required: true, index: true },
  },
  { timestamps: true, versionKey: false },
);

customerIdentitySchema.index({ documentId: 1 }, { unique: true });
customerIdentitySchema.index({ updatedAt: -1 });

export type CustomerIdentity = InferSchemaType<typeof customerIdentitySchema>;
export const CustomerIdentityModel =
  models.CustomerIdentity || model("CustomerIdentity", customerIdentitySchema);
