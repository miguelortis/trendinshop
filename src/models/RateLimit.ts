import { model, models, Schema, type InferSchemaType } from "mongoose";

const rateLimitSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    count: { type: Number, required: true, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false },
);

rateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type RateLimit = InferSchemaType<typeof rateLimitSchema>;
export const RateLimitModel = models.RateLimit || model("RateLimit", rateLimitSchema);
