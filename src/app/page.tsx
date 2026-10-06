import { BarChart3, Boxes, CreditCard, Package, UsersRound } from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/brand/Logo";

const stats = [
  ["Productos", "248"],
  ["Inventario", "1,842"],
  ["Revendedores", "37"],
  ["Ventas", "$12.8K"],
];

export default function HomePage() {
  return (
    <main className="ts-shell">
      <div className="ts-container">
        <nav className="ts-nav">
          <Logo />
          <Link className="ts-button ts-button-secondary" href="/login">
            Entrar
          </Link>
        </nav>

        <section className="ts-hero">
          <span className="ts-pill">
            <Package size={14} />
            Plataforma comercial para proveedores y revendedores
          </span>

          <h1>
            Tu catálogo.
            <br />
            <span className="ts-gradient-text">Más ventas.</span>
          </h1>

          <p>
            TrendinShop reúne productos, inventario, catálogos personalizados,
            clientes, ventas, pagos y cuentas pendientes en una experiencia simple.
          </p>

          <div className="ts-actions">
            <Link className="ts-button ts-button-primary" href="/login">
              Comenzar
            </Link>
            <a className="ts-button ts-button-secondary" href="#preview">
              Ver la plataforma
            </a>
          </div>

          <div className="ts-preview" id="preview">
            <div className="ts-preview-bar">
              <span className="ts-dot" />
              <span className="ts-dot" />
              <span className="ts-dot" />
            </div>

            <div className="ts-preview-grid">
              <aside className="ts-sidebar">
                <strong>TrendinShop</strong>
                <div className="ts-side-item active">Resumen</div>
                <div className="ts-side-item">Productos</div>
                <div className="ts-side-item">Inventario</div>
                <div className="ts-side-item">Mi catálogo</div>
                <div className="ts-side-item">Ventas</div>
                <div className="ts-side-item">Pagos</div>
              </aside>

              <div className="ts-main-panel">
                <div className="ts-stat-grid">
                  {stats.map(([label, value]) => (
                    <div className="ts-stat" key={label}>
                      <div className="ts-stat-label">{label}</div>
                      <div className="ts-stat-value">{value}</div>
                    </div>
                  ))}
                </div>

                <div className="ts-product-row">
                  <div className="ts-product-meta">
                    <span className="ts-product-thumb" />
                    <div>
                      <strong>Vaso Térmico Premium</strong>
                      <div style={{ color: "#667085", marginTop: 4, fontSize: 13 }}>
                        18 unidades disponibles
                      </div>
                    </div>
                  </div>
                  <strong>$35.00</strong>
                </div>

                <div className="ts-product-row">
                  <div className="ts-product-meta">
                    <span className="ts-product-thumb" />
                    <div>
                      <strong>Camisa Premium</strong>
                      <div style={{ color: "#667085", marginTop: 4, fontSize: 13 }}>
                        7 variantes disponibles
                      </div>
                    </div>
                  </div>
                  <strong>$45.00</strong>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="ts-preview" style={{ background: "#fff", color: "#101828" }}>
          <div className="ts-main-panel" style={{ background: "transparent", padding: 0 }}>
            <div className="ts-stat-grid">
              <div className="ts-stat"><Boxes size={22} /><div className="ts-stat-value">Inventario</div></div>
              <div className="ts-stat"><UsersRound size={22} /><div className="ts-stat-value">Clientes</div></div>
              <div className="ts-stat"><CreditCard size={22} /><div className="ts-stat-value">Pagos</div></div>
              <div className="ts-stat"><BarChart3 size={22} /><div className="ts-stat-value">Reportes</div></div>
            </div>
          </div>
        </section>

        <footer className="ts-footer">TrendinShop · Tu catálogo, más ventas.</footer>
      </div>
    </main>
  );
}
