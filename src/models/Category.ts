import { model, models, Schema, type InferSchemaType } from "mongoose";

const categorySchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, lowercase: true, unique: true, index: true },
    description: { type: String, trim: true, default: "" },
    isActive: { type: Boolean, default: true, required: true, index: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true, versionKey: false },
);

categorySchema.index({ name: 1 });

export type Category = InferSchemaType<typeof categorySchema>;
export const CategoryModel = models.Category || model("Category", categorySchema);
