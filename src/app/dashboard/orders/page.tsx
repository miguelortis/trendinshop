"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  ExternalLink,
  MessageCircle,
  PackageCheck,
  Search,
  ShoppingBag,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { api } from "@/lib/api/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";

type OrderStatus = "PENDING" | "IN_PROGRESS" | "CANCELLED" | "CONVERTED";
type PublicOrderItem = {
  productId: string;
  variantId: string;
  productTitle: string;
  productSku: string;
  variantLabel: string;
  variantSku: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  stockAtRequest: number;
};
type PublicOrder = {
  _id: string;
  orderNumber: string;
  resellerId: string;
  resellerName: string;
  resellerPhone: string;
  resellerRole: "ADMIN" | "RESELLER";
  customer: { documentId?: string; firstName: string; lastName: string; phone: string; email: string; address: string };
  customerName: string;
  items: PublicOrderItem[];
  subtotal: number;
  note: string;
  status: OrderStatus;
  saleId: string | null;
  createdAt: string;
  updatedAt: string;
  contactedAt: string | null;
  convertedAt: string | null;
};
type OrdersResponse = { ok: true; orders: PublicOrder[] };
type ErrorShape = { response?: { data?: { message?: string } } };

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function errorMessage(error: unknown) {
  const value = error as ErrorShape;
  return value.response?.data?.message ?? "Ocurrió un error. Inténtalo de nuevo.";
}

function statusLabel(status: OrderStatus) {
  if (status === "IN_PROGRESS") return "En gestión";
  if (status === "CANCELLED") return "Cancelado";
  if (status === "CONVERTED") return "Convertido en venta";
  return "Pendiente";
}

function statusClass(status: OrderStatus) {
  if (status === "IN_PROGRESS") return "in-progress";
  if (status === "CANCELLED") return "cancelled";
  if (status === "CONVERTED") return "converted";
  return "pending";
}

export default function OrdersPage() {
  const { data: user, isLoading: userLoading } = useCurrentUser();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | OrderStatus>("ALL");
  const [busyOrderId, setBusyOrderId] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");

  const ordersQuery = useQuery({
    queryKey: ["public-orders", user?.id],
    enabled: !!user,
    queryFn: async () => (await api.get<OrdersResponse>("/public-orders", {
      headers: { "Cache-Control": "no-cache" },
    })).data.orders,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  const updateOrder = useMutation({
    mutationFn: async ({ orderId, action }: { orderId: string; action: "IN_PROGRESS" | "CANCELLED" | "CONVERT" }) => {
      return (await api.patch("/public-orders/" + orderId, { action })).data;
    },
    onMutate: ({ orderId }) => {
      setBusyOrderId(orderId);
      setActionError("");
      setActionMessage("");
    },
    onSuccess: async (_result, variables) => {
      setActionMessage(
        variables.action === "CONVERT"
          ? "Pedido convertido en venta. Se actualizaron inventario y cuentas."
          : variables.action === "IN_PROGRESS"
            ? "Pedido marcado en gestión."
            : "Pedido cancelado.",
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["public-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["sales"] }),
        queryClient.invalidateQueries({ queryKey: ["receivables"] }),
        queryClient.invalidateQueries({ queryKey: ["payments"] }),
        queryClient.invalidateQueries({ queryKey: ["supplier-payables"] }),
        queryClient.invalidateQueries({ queryKey: ["supplier-payments"] }),
        queryClient.invalidateQueries({ queryKey: ["inventory"] }),
      ]);
    },
    onError: (error: unknown) => setActionError(errorMessage(error)),
    onSettled: () => setBusyOrderId(""),
  });

  const orders = ordersQuery.data ?? [];
  const counts = useMemo(() => ({
    all: orders.length,
    pending: orders.filter((order) => order.status === "PENDING").length,
    progress: orders.filter((order) => order.status === "IN_PROGRESS").length,
    converted: orders.filter((order) => order.status === "CONVERTED").length,
  }), [orders]);

  const visibleOrders = useMemo(() => {
    const term = search.trim().toLowerCase();
    return orders.filter((order) => {
      if (statusFilter !== "ALL" && order.status !== statusFilter) return false;
      if (!term) return true;
      return [
        order.orderNumber,
        order.customerName,
        order.customer.phone,
        order.customer.email,
        order.resellerName,
        ...order.items.map((item) => item.productTitle + " " + item.variantLabel + " " + item.productSku),
      ].join(" ").toLowerCase().includes(term);
    });
  }, [orders, search, statusFilter]);

  if (userLoading) {
    return <div className="dashboard-page"><div className="panel-card dashboard-loading">Cargando pedidos...</div></div>;
  }

  return (
    <div className="dashboard-page public-orders-dashboard">
      <section className="page-heading">
        <div>
          <span className="page-kicker">Ventas desde el catálogo público</span>
          <h1>Pedidos</h1>
          <p>Revisa las solicitudes de clientes, contacta al comprador y convierte un pedido confirmado en una venta registrada.</p>
        </div>
        <Link className="primary-button" href="/dashboard/catalog"><ShoppingBag size={16} /> Mi catálogo</Link>
      </section>

      <section className="orders-summary-grid">
        <article className="stat-card"><span className="stat-icon"><ShoppingBag size={18} /></span><div className="stat-label">Solicitudes totales</div><div className="stat-value">{counts.all}</div><div className="stat-hint">Pedidos recibidos desde enlaces públicos</div></article>
        <article className="stat-card"><span className="stat-icon"><Clock3 size={18} /></span><div className="stat-label">Por revisar</div><div className="stat-value">{counts.pending}</div><div className="stat-hint">Esperando contacto del vendedor</div></article>
        <article className="stat-card"><span className="stat-icon"><MessageCircle size={18} /></span><div className="stat-label">En gestión</div><div className="stat-value">{counts.progress}</div><div className="stat-hint">En conversación o confirmación</div></article>
        <article className="stat-card"><span className="stat-icon"><PackageCheck size={18} /></span><div className="stat-label">Convertidos en venta</div><div className="stat-value">{counts.converted}</div><div className="stat-hint">Con inventario y cuentas actualizados</div></article>
      </section>

      {actionError ? <div className="orders-feedback error" role="alert">{actionError}</div> : null}
      {actionMessage ? <div className="orders-feedback success" role="status">{actionMessage}</div> : null}

      <section className="panel-card public-orders-panel">
        <div className="orders-toolbar">
          <div><span className="panel-kicker">Bandeja</span><h2>Solicitudes de pedido</h2></div>
          <label className="search-field orders-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar pedido, cliente o producto..." aria-label="Buscar pedidos" /></label>
        </div>
        <div className="orders-status-filters">
          {([
            ["ALL", "Todos", counts.all],
            ["PENDING", "Pendientes", counts.pending],
            ["IN_PROGRESS", "En gestión", counts.progress],
            ["CONVERTED", "Convertidos", counts.converted],
            ["CANCELLED", "Cancelados", orders.filter((order) => order.status === "CANCELLED").length],
          ] as const).map(([value, label, count]) => (
            <button key={value} type="button" className={statusFilter === value ? "active" : ""} onClick={() => setStatusFilter(value)}>{label}<span>{count}</span></button>
          ))}
        </div>

        {ordersQuery.isLoading ? (
          <div className="dashboard-loading">Cargando solicitudes...</div>
        ) : ordersQuery.isError ? (
          <div className="dashboard-empty"><strong>No pudimos cargar los pedidos</strong><span>{errorMessage(ordersQuery.error)}</span><button type="button" className="secondary-button" onClick={() => void ordersQuery.refetch()}>Intentar de nuevo</button></div>
        ) : visibleOrders.length ? (
          <div className="public-orders-list">
            {visibleOrders.map((order) => {
              const canConvert = order.resellerId === user?.id &&
                (order.status === "PENDING" || order.status === "IN_PROGRESS");
              const canManage = order.status === "PENDING" || order.status === "IN_PROGRESS";
              const busy = busyOrderId === order._id;
              const message = "Hola " + order.customer.firstName + ", te contacto por tu pedido " + order.orderNumber + " de TrendinShop.";
              const whatsAppLink = "https://wa.me/" + order.customer.phone.replace(/[^0-9]/g, "") + "?text=" + encodeURIComponent(message);

              return (
                <article className="public-order-card" key={order._id}>
                  <div className="public-order-card-header">
                    <div className="public-order-title-group">
                      <strong>{order.orderNumber}</strong>
                      <span>{dateLabel(order.createdAt)}</span>
                      <span className={"public-order-status " + statusClass(order.status)}>{statusLabel(order.status)}</span>
                    </div>
                    <strong className="public-order-card-total">{money(order.subtotal)}</strong>
                  </div>

                  <div className="public-order-card-body">
                    <div className="public-order-customer">
                      <span className="orders-section-label">Cliente</span>
                      <strong>{order.customerName}</strong>
                      {order.customer.documentId ? <span>Cédula: {order.customer.documentId}</span> : null}
                      <span>{order.customer.phone}</span>
                      {order.customer.email ? <span>{order.customer.email}</span> : null}
                      {order.customer.address ? <span>{order.customer.address}</span> : null}
                    </div>
                    {user?.role === "ADMIN" ? (
                      <div className="public-order-seller"><span className="orders-section-label">Vendedor</span><strong>{order.resellerName || "Vendedor"}</strong>{order.resellerPhone ? <span>{order.resellerPhone}</span> : null}</div>
                    ) : null}
                    <div className="public-order-items">
                      <span className="orders-section-label">Productos solicitados</span>
                      {order.items.map((item, index) => (
                        <div className="public-order-item" key={item.variantId + "-" + index}>
                          <div><strong>{item.productTitle}</strong><span>{item.variantLabel} · SKU {item.variantSku} · Cantidad: {item.quantity}</span></div>
                          <div><strong>{money(item.lineTotal)}</strong><span>{money(item.unitPrice)} / unidad</span></div>
                        </div>
                      ))}
                    </div>
                  </div>
                  {order.note ? <p className="public-order-note"><strong>Nota del cliente:</strong> {order.note}</p> : null}
                  <div className="public-order-card-footer">
                    <span>Existencias al solicitar: {order.items.map((item) => item.stockAtRequest).join(", ")}</span>
                    <div className="public-order-actions">
                      {order.customer.phone ? <a href={whatsAppLink} target="_blank" rel="noreferrer" className="orders-action-link whatsapp"><MessageCircle size={14} /> Contactar</a> : null}
                      {order.status === "CONVERTED" && order.saleId ? <Link className="orders-action-link" href="/dashboard/sales"><ExternalLink size={14} /> Ver ventas</Link> : null}
                      {canManage ? (
                        <>
                          {order.status === "PENDING" ? <button type="button" className="orders-action-button" disabled={busy} onClick={() => updateOrder.mutate({ orderId: order._id, action: "IN_PROGRESS" })}>En gestión</button> : null}
                          {canConvert ? <button type="button" className="orders-action-button primary" disabled={busy} onClick={() => updateOrder.mutate({ orderId: order._id, action: "CONVERT" })}>{busy ? "Procesando..." : "Convertir en venta"} <ArrowRight size={14} /></button> : null}
                          <button type="button" className="orders-action-button danger" disabled={busy} onClick={() => updateOrder.mutate({ orderId: order._id, action: "CANCELLED" })}><XCircle size={14} /> Cancelar</button>
                        </>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="dashboard-empty orders-empty">
            <div className="dashboard-empty-icon"><CheckCircle2 size={20} /></div>
            <strong>{search || statusFilter !== "ALL" ? "No hay pedidos que coincidan" : "Todavía no has recibido pedidos"}</strong>
            <span>Las solicitudes enviadas desde las páginas públicas de productos aparecerán aquí.</span>
          </div>
        )}
      </section>
    </div>
  );
}
