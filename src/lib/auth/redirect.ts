import type { UserRole } from "@/types/auth";

const DASHBOARD = "/dashboard";
const INTERNAL_ORIGIN = "https://trendinshop.internal";

export function getProtectedReturnPath(
  pathname: string,
  search = "",
  hash = "",
): string | null {
  if (pathname !== DASHBOARD && !pathname.startsWith(DASHBOARD + "/")) {
    return null;
  }

  return pathname + search + hash;
}

export function getPostLoginDestination(
  candidate: string | null | undefined,
  role: UserRole,
): string {
  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//")) {
    return DASHBOARD;
  }

  try {
    const destination = new URL(candidate, INTERNAL_ORIGIN);
    if (destination.origin !== INTERNAL_ORIGIN) return DASHBOARD;

    const pathname = destination.pathname;
    if (pathname !== DASHBOARD && !pathname.startsWith(DASHBOARD + "/")) {
      return DASHBOARD;
    }

    if (role === "RESELLER") {
      const adminOnly =
        pathname === "/dashboard/inventory" ||
        pathname.startsWith("/dashboard/inventory/") ||
        pathname === "/dashboard/products/new" ||
        /^\/dashboard\/products\/[^/]+\/edit(?:\/|$)/.test(pathname);

      if (adminOnly) return DASHBOARD;
    }

    return pathname + destination.search + destination.hash;
  } catch {
    return DASHBOARD;
  }
}
