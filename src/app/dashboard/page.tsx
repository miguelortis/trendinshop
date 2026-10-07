"use client";

import {
  ArrowDownLeft, ArrowUpRight, Boxes, CircleDollarSign, Clock3,
  Plus, ShoppingBag, ShoppingCart, UsersRound,
} from "lucide-react";
import Link from "next/link";
import { useCurrentUser } from "@/hooks/useCurrentUser";

const emptySales: never[] = [];
const emptyStock: never[] = [];

export default function DashboardPage() {
  const { data: user } = useCurrentUser();
  const isAdmin = user?.role === "ADMIN";
  const firstName = user?.firstName ?? "usuario";
  const roleLabel = isAdmin ? "administrador" : "revendedor";

  const stats = isAdmin
    ? [
        { label: "Ventas del mes", value: "$0.00", change: "0 ventas", hint: "todavía no hay ventas registradas", icon: ShoppingCart, positive: false },
        { label: "Por cobrar", value: "$0.00", change: "0 cuentas", hint: "sin cuentas pendientes", icon: CircleDollarSign, positive: false },
        { label: "Inventario", value: "0", change: "0 productos", hint: "catálogo maestro vacío", icon: Boxes, positive: false },
        { label: "Revendedores", value: "0", change: "activos", hint: "todavía no hay revendedores", icon: UsersRound, positive: false },
      ]
    : [
        { label: "Ventas del mes", value: "$0.00", change: "0 ventas", hint: "todavía no hay ventas registradas", icon: ShoppingCart, positive: false },
        { label: "Ganancia estimada", value: "$0.00", change: "0 ventas", hint: "aparecerá al realizar ventas", icon: ArrowUpRight, positive: false },
        { label: "Por cobrar", value: "$0.00", change: "0 cuentas", hint: "sin cuentas pendientes", icon: Clock3, positive: false },
        { label: "Productos en catálogo", value: "0", change: "0 activos", hint: "añade productos para comenzar", icon: ShoppingBag, positive: false },
      ];

  const quickActions = isAdmin
    ? [
        { href: "/dashboard/products/new", title: "Crear producto", description: "Agrega un producto maestro al catálogo", icon: Plus, tone: "purple" },
        { href: "/dashboard/inventory", title: "Revisar inventario", description: "Consulta existencias y movimientos", icon: Boxes, tone: "blue" },
        { href: "/dashboard/customers", title: "Buscar cliente", description: "Busca por cédula o teléfono", icon: UsersRound, tone: "green" },
        { href: "/dashboard/sales/new", title: "Registrar venta", description: "Vende directamente a un cliente", icon: ShoppingCart, tone: "amber" },
      ]
    : [
        { href: "/dashboard/products", title: "Explorar productos", description: "Revisa los productos disponibles", icon: ShoppingBag, tone: "purple" },
        { href: "/dashboard/catalog", title: "Gestionar mi catálogo", description: "Elige qué productos quieres vender", icon: Plus, tone: "blue" },
        { href: "/dashboard/customers", title: "Buscar cliente", description: "Busca por cédula o teléfono", icon: UsersRound, tone: "green" },
        { href: "/dashboard/sales/new", title: "Registrar venta", description: "Registra una nueva venta", icon: ShoppingCart, tone: "amber" },
      ];

  const steps = isAdmin
    ? [
        ["01", "Crea tu primer producto", "Define precio mayorista, fotos, variantes e inventario."],
        ["02", "Configura tus métodos de pago", "Indica cómo recibir pagos de clientes y revendedores."],
        ["03", "Realiza tu primera venta", "Registra la venta y lleva el control de lo cobrado y pendiente."],
      ]
    : [
        ["01", "Explora los productos", "Revisa los productos disponibles de tu proveedor."],
        ["02", "Añádelos a tu catálogo", "Define tu precio de venta y calcula tu ganancia."],
        ["03", "Comparte y vende", "Comparte tu catálogo o un producto con tus clientes."],
      ];

  return (
    <div className="dashboard-page">
      <section className="page-heading">
        <div>
          <span className="page-kicker">Resumen</span>
          <h1>Buenos días, {firstName} 👋</h1>
          <p>Aquí tienes una vista rápida de tu negocio como {roleLabel}.</p>
        </div>
        <Link href="/dashboard/sales/new" className="primary-button"><Plus size={17} />Nueva venta</Link>
      </section>

      <section className="stats-grid">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <article className="stat-card" key={stat.label}>
              <div className="stat-card-top">
                <span className="stat-icon"><Icon size={18} /></span>
                <span className="stat-change">{stat.change}</span>
              </div>
              <div className="stat-label">{stat.label}</div>
              <div className="stat-value">{stat.value}</div>
              <div className="stat-hint">{stat.hint}</div>
            </article>
          );
        })}
      </section>

      <section className="dashboard-grid-main">
        <article className="panel-card">
          <div className="panel-header">
            <div><span className="panel-kicker">Actividad</span><h2>Ventas recientes</h2></div>
            <Link href="/dashboard/sales" className="text-link">Ver todas</Link>
          </div>
          {emptySales.length === 0 ? (
            <div className="dashboard-empty">
              <div className="dashboard-empty-icon"><ShoppingCart size={20} /></div>
              <strong>Aún no hay ventas</strong>
              <span>Cuando registres tu primera venta, aparecerá aquí con su estado de pago.</span>
              <Link href="/dashboard/sales/new" className="secondary-action">Registrar primera venta</Link>
            </div>
          ) : null}
        </article>

        <article className="panel-card quick-panel">
          <div className="panel-header"><div><span className="panel-kicker">Atajos</span><h2>Acciones rápidas</h2></div></div>
          <div className="quick-grid">
            {quickActions.map((action) => {
              const Icon = action.icon;
              return (
                <Link href={action.href} className="quick-action" key={action.title}>
                  <span className={"quick-action-icon " + action.tone}><Icon size={18} /></span>
                  <strong>{action.title}</strong><span>{action.description}</span>
                </Link>
              );
            })}
          </div>
        </article>
      </section>

      <section className="dashboard-grid-secondary">
        <article className="panel-card">
          <div className="panel-header">
            <div><span className="panel-kicker">Inventario</span><h2>Necesita atención</h2></div>
            <Link href="/dashboard/inventory" className="text-link">Ver inventario</Link>
          </div>
          {emptyStock.length === 0 ? (
            <div className="dashboard-empty compact">
              <div className="dashboard-empty-icon"><Boxes size={19} /></div>
              <strong>Sin inventario todavía</strong>
              <span>Cuando tengas productos con existencias, aquí aparecerán los que necesiten atención.</span>
            </div>
          ) : null}
        </article>

        <article className="panel-card">
          <div className="panel-header">
            <div><span className="panel-kicker">Primeros pasos</span><h2>Comienza con lo esencial</h2></div>
          </div>
          <div className="onboarding-list">
            {steps.map(([number, title, description]) => (
              <div className="onboarding-row" key={number}>
                <span>{number}</span>
                <div><strong>{title}</strong><p>{description}</p></div>
              </div>
            ))}
          </div>
          <div className="onboarding-note">
            <ArrowDownLeft size={14} />
            Tu dashboard se irá llenando automáticamente a medida que registres productos, ventas y pagos.
          </div>
        </article>
      </section>
    </div>
  );
}
