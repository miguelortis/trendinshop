"use client";

import { ShieldCheck, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";

export default function SettingsPage() {
  const router = useRouter();
  const { data: user } = useCurrentUser();
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleBootstrap(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setSaving(true);

    try {
      const response = await api.post<{ message: string }>("/setup/admin", { key });
      setMessage(response.data.message);
      setKey("");
      await new Promise((resolve) => setTimeout(resolve, 300));
      router.refresh();
      window.location.reload();
    } catch (requestError: any) {
      setError(requestError?.response?.data?.message ?? "No pudimos activar la cuenta.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="dashboard-page">
      <section className="page-heading">
        <div>
          <span className="page-kicker">Sistema</span>
          <h1>Configuración</h1>
          <p>Administra tu cuenta y las opciones iniciales del sistema.</p>
        </div>
      </section>

      <section className="settings-grid">
        <article className="panel-card settings-card">
          <div className="settings-icon"><UserRound size={18} /></div>
          <span className="panel-kicker">Cuenta</span>
          <h2>{user?.firstName} {user?.lastName}</h2>
          <p>{user?.email}</p>
          <span className="settings-role">{user?.role === "ADMIN" ? "Administrador" : "Revendedor"}</span>
        </article>

        {user?.role !== "ADMIN" ? (
          <article className="panel-card settings-card">
            <div className="settings-icon purple"><ShieldCheck size={18} /></div>
            <span className="panel-kicker">Configuración inicial</span>
            <h2>Activar administrador</h2>
            <p>Esta opción está disponible únicamente mientras no exista ningún administrador en el sistema.</p>

            <form onSubmit={handleBootstrap} className="settings-form">
              <label className="field">
                <span>Clave de activación</span>
                <input
                  type="password"
                  value={key}
                  onChange={(event) => setKey(event.target.value)}
                  placeholder="Introduce la clave configurada en Vercel"
                  required
                  disabled={saving}
                />
              </label>

              {error ? <div className="auth-error">{error}</div> : null}
              {message ? <div className="settings-success">{message}</div> : null}

              <button className="auth-submit" type="submit" disabled={saving}>
                {saving ? "Activando..." : "Convertir mi cuenta en administrador"}
              </button>
            </form>
          </article>
        ) : (
          <article className="panel-card settings-card settings-success-card">
            <div className="settings-icon green"><ShieldCheck size={18} /></div>
            <span className="panel-kicker">Acceso</span>
            <h2>Cuenta administradora activa</h2>
            <p>Esta cuenta puede administrar productos, categorías e inventario central.</p>
          </article>
        )}
      </section>
    </div>
  );
}
