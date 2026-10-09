"use client";

import {
  BarChart3, Bell, Boxes, ChevronDown, CircleDollarSign, ClipboardList,
  LayoutDashboard, LogOut, Menu, Package, PanelLeftClose, PanelLeftOpen,
  Settings, ShoppingBag, UsersRound, WalletCards, X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Logo } from "@/components/brand/Logo";
import { api } from "@/lib/api/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";

const navSections = [
  { label: "General", items: [
    { href: "/dashboard", label: "Resumen", icon: LayoutDashboard },
    { href: "/dashboard/products", label: "Productos", icon: Package },
    { href: "/dashboard/inventory", label: "Inventario", icon: Boxes },
    { href: "/dashboard/catalog", label: "Mi catálogo", icon: ShoppingBag },
  ]},
  { label: "Ventas", items: [
    { href: "/dashboard/sales", label: "Ventas", icon: ClipboardList },
    { href: "/dashboard/customers", label: "Clientes", icon: UsersRound },
    { href: "/dashboard/receivables", label: "Por cobrar", icon: CircleDollarSign },
    { href: "/dashboard/payments", label: "Pagos", icon: WalletCards },
  ]},
  { label: "Sistema", items: [{ href: "/dashboard/settings", label: "Configuración", icon: Settings }]},
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const { data: user } = useCurrentUser();

  const initials = useMemo(() => {
    if (!user) return "TS";
    return (user.firstName.charAt(0) + user.lastName.charAt(0)).toUpperCase();
  }, [user]);

  const displayName = user ? user.firstName + " " + user.lastName : "TrendinShop";
  const roleLabel = user?.role === "ADMIN" ? "Administrador" : "Revendedor";

  useEffect(() => setMobileOpen(false), [pathname]);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await api.post("/auth/logout");
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <div className={collapsed ? "app-shell collapsed" : "app-shell"}>
      <aside className={mobileOpen ? "app-sidebar mobile-open" : "app-sidebar"}>
        <div className="app-sidebar-top">
          <Logo compact={collapsed} href="/dashboard" />
          <button className="icon-button mobile-close" onClick={() => setMobileOpen(false)} aria-label="Cerrar menú"><X size={18} /></button>
        </div>

        <div className="app-sidebar-user">
          <div className="avatar avatar-gradient">{initials}</div>
          {!collapsed && <div className="sidebar-user-copy"><strong>{displayName}</strong><span>{roleLabel}</span></div>}
          {!collapsed && <ChevronDown size={16} className="sidebar-chevron" />}
        </div>

        <nav className="app-nav">
          {navSections.map((section) => {
            const visibleItems = section.items.filter(
              (item) => !(item.href === "/dashboard/catalog" && user?.role === "ADMIN") &&
                !(item.href === "/dashboard/inventory" && user?.role !== "ADMIN"),
            );
            if (!visibleItems.length) return null;

            return (
              <div key={section.label} className="app-nav-section">
                {!collapsed && <div className="app-nav-label">{section.label}</div>}
                {visibleItems.map((item) => {
                  const Icon = item.icon;
                  const active = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href + "/"));
                  return (
                    <Link key={item.href} href={item.href} title={collapsed ? item.label : undefined} className={active ? "app-nav-item active" : "app-nav-item"}>
                      <Icon size={18} strokeWidth={active ? 2.25 : 2} />
                      {!collapsed && <span>{item.label}</span>}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>

        {!collapsed && (
          <div className="sidebar-help-card">
            <div className="sidebar-help-icon"><BarChart3 size={17} /></div>
            <strong>Tu negocio, en un vistazo</strong>
            <span>Controla inventario, ventas y cuentas pendientes.</span>
          </div>
        )}

        <div className="app-sidebar-footer">
          <button className="collapse-button" onClick={handleLogout} disabled={loggingOut}>
            <LogOut size={18} />
            {!collapsed && <span>{loggingOut ? "Cerrando..." : "Cerrar sesión"}</span>}
          </button>
          <button className="collapse-button" onClick={() => setCollapsed((value) => !value)}>
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            {!collapsed && <span>Contraer menú</span>}
          </button>
        </div>
      </aside>

      {mobileOpen && <button className="sidebar-overlay" onClick={() => setMobileOpen(false)} aria-label="Cerrar menú" />}

      <div className="app-main">
        <header className="app-topbar">
          <div className="topbar-left">
            <button className="icon-button mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Abrir menú"><Menu size={20} /></button>
            <div><div className="topbar-eyebrow">TrendinShop</div><strong className="topbar-title">Panel de control</strong></div>
          </div>
          <div className="topbar-actions">
            <button className="icon-button notification-button" aria-label="Notificaciones"><Bell size={18} /><span className="notification-dot" /></button>
            <div className="topbar-account">
              <div className="avatar avatar-gradient">{initials}</div>
              <div className="topbar-account-copy"><strong>{displayName}</strong><span>{user?.email ?? "Cuenta de prueba"}</span></div>
            </div>
          </div>
        </header>
        <main className="app-content">{children}</main>
      </div>
    </div>
  );
}
