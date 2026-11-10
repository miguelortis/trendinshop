export type PublicCartDraftItem = {
  productId: string;
  variantId: string;
  quantity: number;
};

export type PublicCartViewItem = PublicCartDraftItem & {
  productTitle: string;
  productSku: string;
  variantLabel: string;
  variantSku: string;
  unitPrice: number;
  lineTotal: number;
  stock: number;
  available: boolean;
};

export function publicCartStorageKey(resellerId: string) {
  return "trendinshop:public-cart:" + resellerId;
}

export function readPublicCart(resellerId: string): PublicCartDraftItem[] {
  try {
    const value = localStorage.getItem(publicCartStorageKey(resellerId));
    if (!value) return [];
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((raw) => {
      if (!raw || typeof raw !== "object") return [];
      const item = raw as Record<string, unknown>;
      const productId = typeof item.productId === "string" ? item.productId : "";
      const variantId = typeof item.variantId === "string" ? item.variantId : "";
      const quantity = Number(item.quantity);
      if (!productId || !variantId || !Number.isInteger(quantity) || quantity < 1 || quantity > 100) return [];
      return [{ productId, variantId, quantity }];
    }).slice(0, 30);
  } catch {
    return [];
  }
}

export function writePublicCart(resellerId: string, items: PublicCartDraftItem[]) {
  try {
    if (items.length) localStorage.setItem(publicCartStorageKey(resellerId), JSON.stringify(items));
    else localStorage.removeItem(publicCartStorageKey(resellerId));
    window.dispatchEvent(new CustomEvent("trendinshop:public-cart-updated", { detail: { resellerId } }));
    return true;
  } catch {
    return false;
  }
}

export function publicCartCount(items: PublicCartDraftItem[]) {
  return items.reduce((sum, item) => sum + item.quantity, 0);
}
