import { createHash } from "node:crypto";
import { RateLimitModel } from "@/models/RateLimit";
import { connectMongoDB } from "@/lib/db/mongodb";
import {
  getClientIdentifier,
  getRetryAfterSeconds,
  getWindowBucket,
} from "./rate-limit-policy.mjs";

export async function enforceRateLimit(
  request: Request,
  scope: string,
  limit: number,
  windowMs: number,
  subject = "",
): Promise<Response | null> {
  const now = Date.now();
  const bucket = getWindowBucket(now, windowMs);
  const client = getClientIdentifier(request.headers);
  const fingerprint = [scope, client, subject.trim().toLowerCase(), bucket].join(":");
  const key = createHash("sha256").update(fingerprint).digest("hex");
  const resetAt = (bucket + 1) * windowMs;
  const expiresAt = new Date(resetAt + Math.max(windowMs, 60_000));

  await connectMongoDB();

  let record: { count: number } | null = null;
  try {
    record = await RateLimitModel.findOneAndUpdate(
      { key },
      {
        $inc: { count: 1 },
        $setOnInsert: { expiresAt },
      },
      { upsert: true, new: true, setDefaultsOnInsert: false },
    ).lean().exec() as { count: number } | null;
  } catch (error) {
    if (!(typeof error === "object" && error !== null && "code" in error && error.code === 11000)) {
      throw error;
    }
    record = await RateLimitModel.findOneAndUpdate(
      { key },
      { $inc: { count: 1 } },
      { new: true },
    ).lean().exec() as { count: number } | null;
  }

  if (!record || record.count <= limit) return null;

  const retryAfter = getRetryAfterSeconds(now, resetAt);
  return Response.json(
    {
      ok: false,
      error: "RATE_LIMITED",
      message: "Has realizado demasiados intentos. Espera un momento antes de volver a intentarlo.",
      retryAfter,
    },
    {
      status: 429,
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "Retry-After": String(retryAfter),
      },
    },
  );
}
