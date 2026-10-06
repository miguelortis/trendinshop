import { model, models, Schema, type InferSchemaType } from "mongoose";

const userSchema = new Schema(
  {
    documentId: { type: String, required: true, trim: true, unique: true, index: true },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true, unique: true, index: true },
    passwordHash: { type: String, required: true, select: false },
    gender: { type: String, enum: ["female", "male", "unspecified"], required: true },
    birthDate: { type: Date, required: true },
    phone: { type: String, required: true, trim: true },
    role: { type: String, enum: ["ADMIN", "RESELLER"], default: "RESELLER", required: true, index: true },
    isActive: { type: Boolean, default: true, required: true, index: true },
  },
  { timestamps: true, versionKey: false },
);

export type User = InferSchemaType<typeof userSchema>;
export const UserModel = models.User || model("User", userSchema);
