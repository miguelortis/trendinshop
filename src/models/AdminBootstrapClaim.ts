import { model, models, Schema, type InferSchemaType } from "mongoose";

const adminBootstrapClaimSchema = new Schema(
  {
    _id: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    claimedAt: { type: Date, required: true, default: Date.now },
  },
  { versionKey: false, collection: "system_claims" },
);

export type AdminBootstrapClaim = InferSchemaType<typeof adminBootstrapClaimSchema>;
export const AdminBootstrapClaimModel =
  models.AdminBootstrapClaim || model("AdminBootstrapClaim", adminBootstrapClaimSchema);
