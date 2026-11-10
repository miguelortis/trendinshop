"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight, Boxes, CircleDollarSign, Clock3,
  ClipboardList, CreditCard, HandCoins, PackageCheck, Plus,
  ShoppingBag, ShoppingCart, UsersRound,
} from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";

type PaymentStatus = "UNPAID" | "PARTIAL" | "PAID";
type DashboardSale = {
  _id: string;
  saleNumber: string;
  customerName: string;
  total: number;
  amountPaid: number;
  balanceDue: number;
  paymentStatus: PaymentStatus;
  profit: number;
  createdAt: string;
  itemSummary: string;
};
type DashboardSummary = {
  ok: true;
  role: "ADMIN" | "RESELLER";
  generatedAt: string;
  monthly: { salesCount: number; salesTotal: number; grossProfit: number };
  receivables: { count: number; balanceDue: number };
  supplierDebt: { totalDue: number; totalPaid: number; balanceDue: number };
  pendingOrders: number;
  activeResellers: number;
  catalogProductCount: number;
  inventory: {
    totalUnits: number;
    variants: number;
    outOfStockVariants: number;
    lowStockVariants: number;
  };
  recentSales: DashboardSale[];
};

function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function paymentStatusLabel(status: PaymentStatus) {
  if (status === "PAID") return "Pagada";
  if (status === "PARTIAL") return "Pago parcial";
  return "Pendiente";
}

function paymentStatusClass(status: PaymentStatus) {
  if (status === "PAID") return "paid";
  if (status === "PARTIAL") return "partial";
  return "unpaid";
}

function errorMessage(error: unknown) {
  const value = error as { response?: { data?: { message?: string } } };
  return value.response?.data?.message ?? "No pudimos cargar los datos del dashboard.";
}

export default function DashboardPage() {
  const { data: user, isLoading: userLoading } = useCurrentUser();
  const isAdmin = user?.role === "ADMIN";
  const firstName = user?.firstName ?? "usuario";
  const roleLabel = isAdmin ? "administrador" : "revendedor";

  const dashboardQuery = useQuery({
    queryKey: ["dashboard-summary", user?.id],
    enabled: !!user,
    queryFn: async () => (await api.get<DashboardSummary>("/dashboard-summary", {
      headers: { "Cache-Control": "no-cache" },
    })).data,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  const data = dashboardQuery.data;
  const displayMoney = (value: number | undefined) => data ? money(value ?? 0) : "—";

  const stats = isAdmin
    ? [
        {
          label: "Ventas del mes",
          value: displayMoney(data?.monthly.salesTotal),
          change: data ? String(data.monthly.salesCount) + " ventas" : "Actualizando",
          hint: "Ventas directas de este mes",
          icon: ShoppingCart,
        },
        {
          label: "Clientes por cobrar",
          value: displayMoney(data?.receivables.balanceDue),
          change: data ? String(data.receivables.count) + " cuentas" : "Actualizando",
          hint: "Saldo pendiente de tus clientes directos",
          icon: CircleDollarSign,
        },
        {
          label: "Deuda de revendedores",
          value: displayMoney(data?.supplierDebt.balanceDue),
          change: data ? String(data.activeResellers) + " activos" : "Actualizando",
          hint: "Costo mayorista aún no liquidado",
          icon: HandCoins,
        },
        {
          label: "Pedidos pendientes",
          value: data ? String(data.pendingOrders) : "—",
          change: "Pedidos públicos",
          hint: "Solicitudes que requieren revisión",
          icon: ClipboardList,
        },
      ]
    : [
        {
          label: "Ventas del mes",
          value: displayMoney(data?.monthly.salesTotal),
          change: data ? String(data.monthly.salesCount) + " ventas" : "Actualizando",
          hint: "Total vendido este mes",
          icon: ShoppingCart,
        },
        {
          label: "Ganancia estimada",
          value: displayMoney(data?.monthly.grossProfit),
          change: data ? String(data.monthly.salesCount) + " ventas" : "Actualizando",
          hint: "Precio de venta menos costo mayorista",
          icon: ArrowUpRight,
        },
        {
          label: "Clientes por cobrar",
          value: displayMoney(data?.receivables.balanceDue),
          change: data ? String(data.receivables.count) + " cuentas" : "Actualizando",
          hint: "Saldo que tus clientes aún deben",
          icon: Clock3,
        },
        {
          label: "Pendiente al proveedor",
          value: displayMoney(data?.supplierDebt.balanceDue),
          change: data ? money(data.supplierDebt.totalPaid) + " abonado" : "Actualizando",
          hint: "Tu deuda mayorista pendiente",
          icon: HandCoins,
        },
      ];

  const quickActions = isAdmin
    ? [
        { href: "/dashboard/products/new", title: "Crear producto", description: "Agrega un producto al catálogo maestro", icon: Plus, tone: "purple" },
        { href: "/dashboard/inventory", title: "Revisar inventario", description: "Consulta existencias y movimientos", icon: Boxes, tone: "blue" },
        { href: "/dashboard/orders", title: "Revisar pedidos", description: "Gestiona solicitudes del catálogo público", icon: ClipboardList, tone: "green" },
        { href: "/dashboard/sales/new", title: "Registrar venta", description: "Vende directamente a un cliente", icon: ShoppingCart, tone: "amber" },
      ]
    : [
        { href: "/dashboard/catalog", title: "Gestionar mi catálogo", description: "Elige productos y define precios", icon: ShoppingBag, tone: "purple" },
        { href: "/dashboard/orders", title: "Ver pedidos", description: "Revisa solicitudes de tus clientes", icon: ClipboardList, tone: "blue" },
        { href: "/dashboard/customers", title: "Buscar cliente", description: "Busca por cédula o teléfono", icon: UsersRound, tone: "green" },
        { href: "/dashboard/sales/new", title: "Registrar venta", description: "Registra una venta directa", icon: ShoppingCart, tone: "amber" },
      ];

  const financeLinks = isAdmin
    ? [
        { href: "/dashboard/receivables", label: "Deudas de tus clientes", amount: data ? money(data.receivables.balanceDue) : "—", detail: data ? String(data.receivables.count) + " cuentas pendientes" : "Consultando cuentas", icon: CreditCard },
        { href: "/dashboard/supplier-payables", label: "Deudas de revendedores", amount: data ? money(data.supplierDebt.balanceDue) : "—", detail: data ? String(data.activeResellers) + " revendedores activos" : "Consultando cuentas", icon: HandCoins },
        { href: "/dashboard/orders", label: "Pedidos por revisar", amount: data ? String(data.pendingOrders) : "—", detail: "Solicitudes recibidas en tu tienda", icon: ClipboardList },
      ]
    : [
        { href: "/dashboard/receivables", label: "Tus clientes", amount: data ? money(data.receivables.balanceDue) : "—", detail: data ? String(data.receivables.count) + " cuentas por cobrar" : "Consultando cuentas", icon: CreditCard },
        { href: "/dashboard/supplier-payables", label: "Tu deuda al proveedor", amount: data ? money(data.supplierDebt.balanceDue) : "—", detail: data ? money(data.supplierDebt.totalPaid) + " abonado" : "Consultando pagos", icon: HandCoins },
        { href: "/dashboard/orders", label: "Pedidos pendientes", amount: data ? String(data.pendingOrders) : "—", detail: "Solicitudes de tus clientes", icon: ClipboardList },
      ];

  return (
    <div className="dashboard-page">
      <section className="page-heading">
        <div>
          <span className="page-kicker">Resumen en tiempo real</span>
          <h1>Buenos días, {firstName} 👋</h1>
          <p>Aquí tienes una vista rápida de tu negocio como {roleLabel}.</p>
        </div>
        <Link href="/dashboard/sales/new" className="primary-button"><Plus size={17} /> Nueva venta</Link>
      </section>

      {dashboardQuery.isError ? (
        <div className="dashboard-summary-error" role="alert">
          <span>{errorMessage(dashboardQuery.error)}</span>
          <button type="button" className="secondary-button" onClick={() => void dashboardQuery.refetch()}>Actualizar</button>
        </div>
      ) : null}

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
              <div className="stat-value">{userLoading || dashboardQuery.isLoading ? "…" : stat.value}</div>
              <div className="stat-hint">{stat.hint}</div>
            </article>
          );
        })}
      </section>

      <section className="dashboard-grid-main">
        <article className="panel-card">
          <div className="panel-header">
            <div><span className="panel-kicker">Actividad real</span><h2>Ventas recientes</h2></div>
            <Link href="/dashboard/sales" className="text-link">Ver todas</Link>
          </div>

          {dashboardQuery.isLoading || userLoading ? (
            <div className="dashboard-loading">Cargando actividad...</div>
          ) : dashboardQuery.isError ? (
            <div className="dashboard-empty compact">
              <div className="dashboard-empty-icon"><ClipboardList size={19} /></div>
              <strong>No pudimos cargar las ventas</strong>
              <span>Comprueba tu conexión e inténtalo de nuevo.</span>
            </div>
          ) : data?.recentSales.length ? (
            <div className="sales-list">
              {data.recentSales.map((sale) => (
                <article className="sale-row" key={sale._id}>
                  <div className="sale-row-icon"><ClipboardList size={19} /></div>
                  <div className="sale-row-main">
                    <div className="sale-row-title">
                      <strong>{sale.saleNumber}</strong>
                      <span className={"sale-payment-status " + paymentStatusClass(sale.paymentStatus)}>{paymentStatusLabel(sale.paymentStatus)}</span>
                    </div>
                    <span className="sale-row-customer">{sale.customerName} · {dateLabel(sale.createdAt)}</span>
                    <span className="sale-row-items">{sale.itemSummary || "Productos de la venta"}</span>
                  </div>
                  <div className="sale-row-financials">
                    <strong>{money(sale.total)}</strong>
                    <span>Recibido: {money(sale.amountPaid)}</span>
                    {sale.balanceDue > 0 ? <span className="sale-row-due">Pendiente: {money(sale.balanceDue)}</span> : <span className="sale-row-paid">Saldada</span>}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="dashboard-empty">
              <div className="dashboard-empty-icon"><ShoppingCart size={20} /></div>
              <strong>Aún no hay ventas</strong>
              <span>Cuando registres una venta, aparecerá aquí con sus productos y estado de pago.</span>
              <Link href="/dashboard/sales/new" className="secondary-action">Registrar primera venta</Link>
            </div>
          )}
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
            <div><span className="panel-kicker">{isAdmin ? "Inventario central" : "Actividad comercial"}</span><h2>{isAdmin ? "Existencias que requieren atención" : "Actividad pendiente"}</h2></div>
            <Link href={isAdmin ? "/dashboard/inventory" : "/dashboard/orders"} className="text-link">{isAdmin ? "Ver inventario" : "Ver pedidos"}</Link>
          </div>

          {dashboardQuery.isLoading || userLoading ? (
            <div className="dashboard-loading">Cargando pendientes...</div>
          ) : isAdmin ? (
            <div className="dashboard-attention-grid">
              <div className="dashboard-attention-item">
                <span className="dashboard-attention-icon"><Boxes size={17} /></span>
                <div><strong>{data?.inventory.totalUnits ?? 0}</strong><span>Unidades disponibles</span></div>
              </div>
              <div className="dashboard-attention-item">
                <span className="dashboard-attention-icon warning"><Clock3 size={17} /></span>
                <div><strong>{data?.inventory.lowStockVariants ?? 0}</strong><span>Variantes con 1–3 unidades</span></div>
              </div>
              <div className="dashboard-attention-item">
                <span className="dashboard-attention-icon danger"><PackageCheck size={17} /></span>
                <div><strong>{data?.inventory.outOfStockVariants ?? 0}</strong><span>Variantes agotadas</span></div>
              </div>
            </div>
          ) : data?.pendingOrders ? (
            <div className="dashboard-pending-order-callout">
              <span className="dashboard-attention-icon"><ClipboardList size={18} /></span>
              <div><strong>{data.pendingOrders} {data.pendingOrders === 1 ? "pedido pendiente" : "pedidos pendientes"}</strong><p>Revisa las solicitudes, confirma existencias y convierte los pedidos listos en ventas.</p></div>
              <Link href="/dashboard/orders" className="secondary-action">Revisar pedidos</Link>
            </div>
          ) : (
            <div className="dashboard-empty compact">
              <div className="dashboard-empty-icon"><PackageCheck size={19} /></div>
              <strong>No hay pedidos pendientes</strong>
              <span>Cuando un cliente envíe una solicitud desde tu catálogo público, aparecerá aquí.</span>
            </div>
          )}
        </article>

        <article className="panel-card">
          <div className="panel-header">
            <div><span className="panel-kicker">Cuentas importantes</span><h2>{isAdmin ? "Dinero y pedidos por gestionar" : "Tus saldos y pedidos"}</h2></div>
          </div>
          <div className="dashboard-finance-links">
            {financeLinks.map((item) => {
              const Icon = item.icon;
              return (
                <Link className="dashboard-finance-link" href={item.href} key={item.label}>
                  <span className="dashboard-finance-icon"><Icon size={17} /></span>
                  <span className="dashboard-finance-copy"><strong>{item.label}</strong><small>{item.detail}</small></span>
                  <strong className="dashboard-finance-value">{item.amount}</strong>
                </Link>
              );
            })}
          </div>
          {dashboardQuery.dataUpdatedAt ? (
            <p className="dashboard-updated-at">Actualizado: {dateLabel(data?.generatedAt ?? "")}</p>
          ) : null}
        </article>
      </section>
    </div>
  );
}
