"use client";

import Link from "next/link";
import { ShoppingCart } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { publicCartCount, readPublicCart } from "@/lib/public-cart-client";

type Props = {
  resellerId: string;
  storeSlug: string;
  storeName: string;
  logoUrl?: string;
};

export function PublicStorefrontHeader({ resellerId, storeSlug, storeName, logoUrl = "" }: Props) {
  const [count, setCount] = useState(0);
  const refresh = useCallback(() => setCount(publicCartCount(readPublicCart(resellerId))), [resellerId]);

  useEffect(() => {
    refresh();
    const handleUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ resellerId?: string }>).detail;
      if (!detail?.resellerId || detail.resellerId === resellerId) refresh();
    };
    window.addEventListener("storage", refresh);
    window.addEventListener("trendinshop:public-cart-updated", handleUpdate);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("trendinshop:public-cart-updated", handleUpdate);
    };
  }, [refresh, resellerId]);

  return (
    <header className="public-catalog-nav">
      <Link href={"/tienda/" + storeSlug} className="public-catalog-brand public-catalog-store-brand" aria-label={storeName}>
        {logoUrl ? (
          <img className="public-catalog-store-logo" src={logoUrl} alt={"Logotipo de " + storeName} />
        ) : (
          <span className="public-catalog-brand-mark">T</span>
        )}
        <span>{storeName || "Mi tienda"}</span>
      </Link>
      <div className="public-storefront-nav-actions">
        <Link href={"/tienda/" + storeSlug + "/carrito"} className="public-storefront-cart-link" aria-label={"Carrito de compras, " + count + " artículos"}>
          <ShoppingCart size={17} />
          <span>Carrito</span>
          <strong>{count}</strong>
        </Link>
        <Link href="/login" className="public-catalog-nav-link">Acceso de vendedor</Link>
      </div>
    </header>
  );
}
