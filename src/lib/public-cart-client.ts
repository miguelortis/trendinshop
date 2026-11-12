export type PublicCartComponentSelection = {
  productId: string;
  variantId: string;
  quantity: number;
};

export type PublicCartDraftItem = {
  // PRODUCT is the legacy/default format; COMBO keeps one customer-facing cart row.
  kind?: "PRODUCT" | "COMBO";
  productId: string;
  variantId: string;
  quantity: number;
  comboId?: string;
  components?: PublicCartComponentSelection[];
};

export type PublicCartViewComponent = PublicCartComponentSelection & {
  productTitle: string;
  productSku: string;
  variantLabel: string;
  variantSku: string;
  unitCost: number;
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
  components?: PublicCartViewComponent[];
};

export function publicCartStorageKey(resellerId: string) {
  return "trendinshop:public-cart:" + resellerId;
}

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{24}$/i.test(value);
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
      const quantity = Number(item.quantity);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) return [];
      if (item.kind === "COMBO") {
        const comboId = item.comboId;
        const components = item.components;
        if (!validId(comboId) || !Array.isArray(components) || components.length < 2 || components.length > 5) return [];
        const safeComponents = components.flatMap((rawComponent) => {
          if (!rawComponent || typeof rawComponent !== "object") return [];
          const component = rawComponent as Record<string, unknown>;
          const componentQuantity = Number(component.quantity);
          if (!validId(component.productId) || !validId(component.variantId) ||
              !Number.isInteger(componentQuantity) || componentQuantity < 1 || componentQuantity > 100) return [];
          return [{ productId: component.productId, variantId: component.variantId, quantity: componentQuantity }];
        });
        if (safeComponents.length !== components.length) return [];
        return [{
          kind: "COMBO" as const,
          comboId,
          productId: comboId,
          variantId: "COMBO:" + comboId,
          quantity,
          components: safeComponents,
        }];
      }
      const productId = item.productId;
      const variantId = item.variantId;
      if (!validId(productId) || !validId(variantId)) return [];
      return [{ kind: "PRODUCT" as const, productId, variantId, quantity }];
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
