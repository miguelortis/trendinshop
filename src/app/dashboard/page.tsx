"use client";

import {
  ArrowDownLeft, ArrowUpRight, CircleAlert, Clock3, PackageCheck,
  Plus, ShoppingCart, UsersRound,
} from "lucide-react";
import Link from "next/link";
import { useCurrentUser } from "@/hooks/useCurrentUser";

const stats = [
  { label: "Ventas del mes", value: "$12,840", change: "+12.8%", hint: "vs. mes anterior", positive: true, icon: ShoppingCart },
  { label: "Ganancia estimada", value: "$4,290", change: "+8.4%", hint: "vs. mes anterior", positive: true, icon: ArrowUpRight },
  { label: "Por cobrar", value: "$1,240", change: "8 cuentas", hint: "pendientes de pago", positive: false, icon: Clock3 },
  { label: "Inventario", value: "1,842", change: "24 bajas", hint: "últimos 7 días", positive: false, icon: PackageCheck },
];

const sales = [
  { customer: "María González", item: "Camisa Premium · 2 uds.", amount: "$90.00", status: "Pagada", initials: "MG" },
  { customer: "Carlos Pérez", item: "Vaso Térmico · 1 ud.", amount: "$35.00", status: "Parcial", initials: "CP" },
  { customer: "Ana Rodríguez", item: "Gorra Urban · 3 uds.", amount: "$72.00", status: "Pagada", initials: "AR" },
  { customer: "Luis Martínez", item: "Camisa Premium · 1 ud.", amount: "$45.00", status: "Pendiente", initials: "LM" },
];

const stock = [
  { name: "Camisa Premium · Negro / M", stock: 2, level: "critical" },
  { name: "Vaso Térmico · Azul", stock: 4, level: "low" },
  { name: "Gorra Urban · Negra", stock: 6, level: "low" },
];

export default function DashboardPage() {
  const { data: user } = useCurrentUser();
  const firstName = user?.firstName ?? "administrador";
  const roleLabel = user?.role === "RESELLER" ? "revendedor" : "administrador";

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
                <span className={stat.positive ? "stat-change positive" : "stat-change"}>
                  {stat.positive ? <ArrowUpRight size={14} /> : null}{stat.change}
                </span>
              </div>
              <div className="stat-label">{stat.label}</div>
              <div className="stat-value">{stat.value}</div>
              <div className="stat-hint">{stat.hint}</div>
            </article>
          );
        })}
      </section>

      <section className="dashboard-grid-main">
        <article className="panel-card sales-panel">
          <div className="panel-header">
            <div><span className="panel-kicker">Actividad</span><h2>Ventas recientes</h2></div>
            <Link href="/dashboard/sales" className="text-link">Ver todas</Link>
          </div>
          <div className="sales-list">
            {sales.map((sale) => (
              <div className="sale-row" key={sale.customer + sale.item}>
                <div className="sale-person">
                  <div className="mini-avatar">{sale.initials}</div>
                  <div><strong>{sale.customer}</strong><span>{sale.item}</span></div>
                </div>
                <div className="sale-right">
                  <strong>{sale.amount}</strong>
                  <span className={
                    sale.status === "Pagada" ? "status-badge success" :
                    sale.status === "Parcial" ? "status-badge warning" : "status-badge neutral"
                  }>{sale.status}</span>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="panel-card quick-panel">
          <div className="panel-header"><div><span className="panel-kicker">Atajos</span><h2>Acciones rápidas</h2></div></div>
          <div className="quick-grid">
            <Link href="/dashboard/products/new" className="quick-action">
              <span className="quick-action-icon purple"><Plus size={18} /></span>
              <strong>Agregar producto</strong><span>Publica un nuevo producto</span>
            </Link>
            <Link href="/dashboard/inventory" className="quick-action">
              <span className="quick-action-icon blue"><PackageCheck size={18} /></span>
              <strong>Revisar inventario</strong><span>Consulta existencias</span>
            </Link>
            <Link href="/dashboard/customers" className="quick-action">
              <span className="quick-action-icon green"><UsersRound size={18} /></span>
              <strong>Buscar cliente</strong><span>Por cédula o teléfono</span>
            </Link>
            <Link href="/dashboard/receivables" className="quick-action">
              <span className="quick-action-icon amber"><Clock3 size={18} /></span>
              <strong>Ver pendientes</strong><span>Controla cuentas por cobrar</span>
            </Link>
          </div>
        </article>
      </section>

      <section className="dashboard-grid-secondary">
        <article className="panel-card">
          <div className="panel-header">
            <div><span className="panel-kicker">Inventario</span><h2>Necesita atención</h2></div>
            <Link href="/dashboard/inventory" className="text-link">Ver inventario</Link>
          </div>
          <div className="attention-list">
            {stock.map((item) => (
              <div className="attention-row" key={item.name}>
                <div className="attention-icon">
                  {item.level === "critical" ? <CircleAlert size={18} /> : <PackageCheck size={18} />}
                </div>
                <div className="attention-copy">
                  <strong>{item.name}</strong>
                  <span>{item.stock} unidades disponibles</span>
                </div>
                <span className={item.level === "critical" ? "stock-badge critical" : "stock-badge low"}>{item.stock} uds.</span>
              </div>
            ))}
          </div>
        </article>

        <article className="panel-card">
          <div className="panel-header">
            <div><span className="panel-kicker">Cuentas</span><h2>Por cobrar</h2></div>
            <Link href="/dashboard/receivables" className="text-link">Ver cuentas</Link>
          </div>
          <div className="receivable-total">
            <div><span>Total pendiente</span><strong>$1,240.00</strong></div>
            <span className="receivable-pill"><ArrowDownLeft size={14} />8 cuentas</span>
          </div>
          <div className="receivable-progress"><span style={{ width: "68%" }} /></div>
          <div className="receivable-meta"><span>$2,650 facturado este mes</span><strong>68% cobrado</strong></div>
        </article>
      </section>
    </div>
  );
}
