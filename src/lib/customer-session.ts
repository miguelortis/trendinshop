import { createHash, randomBytes } from "node:crypto";

export const CUSTOMER_SESSION_STORAGE_KEY = "trendinshop:customer-session";

export function normalizeCustomerDocumentId(value: unknown) {
  return (typeof value === "string" ? value.trim() : "")
    .toUpperCase()
    .replace(/[.\s-]/g, "");
}

export function hashCustomerSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createCustomerSessionToken() {
  return randomBytes(32).toString("hex");
}

export function hasCustomerSessionToken(
  storedHashes: unknown,
  token: string,
) {
  if (!token || !Array.isArray(storedHashes)) return false;
  const candidate = hashCustomerSessionToken(token);
  return storedHashes.some((value) => typeof value === "string" && value === candidate);
}
