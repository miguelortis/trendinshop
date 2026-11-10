"use client";

import { useQuery } from "@tanstack/react-query";
import { Boxes, Minus, Plus, Search, Warehouse } from "lucide-react";
import { useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";

type Variant = {
  _id: string;
  label: string;
  sku: string;
  stock: number;
  lowStockThreshold: number;
  productId?: { _id: string; title: string; sku: string };
};

export default function InventoryPage() {
  const { data: user, isLoading: userLoading } = useCurrentUser();
  const isAdmin = user?.role === "ADMIN";
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Variant | null>(null);
  const [amount, setAmount] = useState("1");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const inventory = useQuery({
    queryKey: ["inventory"],
    enabled: isAdmin,
    queryFn: async () =>
      (await api.get<{ ok: true; variants: Variant[] }>("/inventory")).data.variants,
  });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return inventory.data ?? [];

    return (inventory.data ?? []).filter((item) =>
      [item.label, item.sku, item.productId?.title, item.productId?.sku]
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }, [inventory.data, search]);

  const lowCount = (inventory.data ?? []).filter(
    (item) => item.stock <= item.lowStockThreshold,
  ).length;
  const totalUnits = (inventory.data ?? []).reduce(
    (total, item) => total + item.stock,
    0,
  );

  async function saveAdjustment(delta: number) {
    if (!editing) return;

    setSaving(true);
    setError("");

    try {
      await api.post("/inventory/adjust", {
        variantId: editing._id,
        delta,
        reason,
      });

      await inventory.refetch();
      setEditing(null);
      setReason("");
      setAmount("1");
    } catch (requestError: any) {
      setError(
        requestError?.response?.data?.message ??
          "No pudimos actualizar el inventario.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (userLoading) {
    return <div className="dashboard-page"><div className="panel-card dashboard-loading">Cargando tu cuenta...</div></div>;
  }

  if (user && !isAdmin) {
    return (
      <div className="dashboard-page">
        <section className="page-heading">
          <div>
            <span className="page-kicker">Inventario central</span>
            <h1>Inventario</h1>
            <p>El control central de existencias está reservado al administrador.</p>
          </div>
        </section>
        <div className="panel-card reseller-catalog-restricted">
          <Warehouse size={28} />
          <strong>Consulta existencias en los productos disponibles</strong>
          <span>El stock de los artículos de tu catálogo aparece al explorar productos y al registrar una venta.</span>
          <Link href="/dashboard/catalog" className="primary-button">Abrir mi catálogo</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-page">
      <section className="page-heading">
        <div>
          <span className="page-kicker">Inventario central</span>
          <h1>Inventario</h1>
          <p>El stock pertenece al producto y se descuenta de forma centralizada.</p>
        </div>
      </section>

      <section className="inventory-summary">
        <div className="stat-card">
          <span className="stat-icon"><Warehouse size={18} /></span>
          <div className="stat-label">Unidades disponibles</div>
          <div className="stat-value">{totalUnits}</div>
        </div>
        <div className="stat-card">
          <span className="stat-icon"><Boxes size={18} /></span>
          <div className="stat-label">Variantes</div>
          <div className="stat-value">{inventory.data?.length ?? 0}</div>
        </div>
        <div className="stat-card">
          <span className="stat-icon"><Minus size={18} /></span>
          <div className="stat-label">Stock bajo</div>
          <div className="stat-value">{lowCount}</div>
        </div>
      </section>

      <section className="panel-card inventory-table-card">
        <div className="inventory-toolbar">
          <div className="search-field">
            <Search size={17} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar producto, variante o SKU..."
            />
          </div>
        </div>

        <div className="inventory-table-wrap">
          <table className="inventory-table">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Variante</th>
                <th>SKU</th>
                <th>Stock</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => {
                const low = item.stock <= item.lowStockThreshold;

                return (
                  <tr key={item._id}>
                    <td><strong>{item.productId?.title ?? "Producto"}</strong></td>
                    <td>{item.label}</td>
                    <td>{item.sku}</td>
                    <td><strong>{item.stock}</strong></td>
                    <td>
                      <span className={low ? "stock-badge low" : "stock-badge ok"}>
                        {low ? "Stock bajo" : "Disponible"}
                      </span>
                    </td>
                    <td>
                      {isAdmin ? (
                        <button
                          className="secondary-button small-button"
                          type="button"
                          onClick={() => setEditing(item)}
                        >
                          <Plus size={14} /> Ajustar
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {!filtered.length ? (
            <div className="dashboard-empty compact">
              <div className="dashboard-empty-icon"><Boxes size={19} /></div>
              <strong>Sin inventario</strong>
              <span>Los productos y variantes que crees aparecerán aquí.</span>
            </div>
          ) : null}
        </div>
      </section>

      {editing ? (
        <div
          className="modal-backdrop"
          onClick={() => !saving && setEditing(null)}
        >
          <div className="inventory-modal" onClick={(event) => event.stopPropagation()}>
            <div className="panel-header">
              <div>
                <span className="panel-kicker">Ajustar stock</span>
                <h2>{editing.productId?.title}</h2>
              </div>
              <button
                className="icon-button"
                onClick={() => !saving && setEditing(null)}
                aria-label="Cerrar"
                type="button"
              >
                ×
              </button>
            </div>

            <p className="modal-subtitle">
              {editing.label} · {editing.sku} · stock actual {editing.stock}
            </p>

            <label className="field">
              <span>Cantidad</span>
              <input
                type="number"
                min="1"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </label>

            <label className="field">
              <span>Motivo</span>
              <input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Reposición, corrección, merma..."
              />
            </label>

            {error ? <div className="auth-error">{error}</div> : null}

            <div className="modal-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => saveAdjustment(-Math.abs(Number(amount)))}
                disabled={saving}
              >
                Registrar salida
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={() => saveAdjustment(Math.abs(Number(amount)))}
                disabled={saving}
              >
                Registrar entrada
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
