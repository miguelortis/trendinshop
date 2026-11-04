export function getWindowBucket(now, windowMs) {
  if (!Number.isFinite(now) || !Number.isFinite(windowMs) || windowMs <= 0) {
    throw new TypeError("A valid timestamp and positive window are required.");
  }
  return Math.floor(now / windowMs);
}

export function getClientIdentifier(headers) {
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp.slice(0, 128);

  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded ? forwarded.slice(0, 128) : "unknown";
}

export function getRetryAfterSeconds(now, resetAt) {
  return Math.max(1, Math.ceil((resetAt - now) / 1000));
}
