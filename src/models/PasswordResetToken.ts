import { model, models, Schema, type InferSchemaType } from "mongoose";

const passwordResetTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);

passwordResetTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
passwordResetTokenSchema.index({ userId: 1, createdAt: -1 });

export type PasswordResetToken = InferSchemaType<typeof passwordResetTokenSchema>;
export const PasswordResetTokenModel =
  models.PasswordResetToken || model("PasswordResetToken", passwordResetTokenSchema);
