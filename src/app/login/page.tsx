import Link from "next/link";
import { Logo } from "@/components/brand/Logo";

export default function LoginPage() {
  return (
    <main className="ts-shell" style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
      <div style={{ width: "min(420px, calc(100% - 28px))" }}>
        <div style={{ marginBottom: 24 }}>
          <Logo href="/" />
        </div>
        <div style={{
          background: "white",
          border: "1px solid #e4e7ec",
          borderRadius: 22,
          padding: 26,
          boxShadow: "0 20px 60px rgba(15,23,42,.08)"
        }}>
          <h1 style={{ margin: "0 0 8px", fontSize: 28 }}>Bienvenido</h1>
          <p style={{ margin: "0 0 24px", color: "#667085" }}>
            La autenticación será implementada en la siguiente fase.
          </p>
          <Link className="ts-button ts-button-primary" style={{ display: "inline-block" }} href="/">
            Volver al inicio
          </Link>
        </div>
      </div>
    </main>
  );
}
