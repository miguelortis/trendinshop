export function getWindowBucket(now: number, windowMs: number): number;
export function getClientIdentifier(headers: Pick<Headers, "get">): string;
export function getRetryAfterSeconds(now: number, resetAt: number): number;
