"use client";

import { Copy, ExternalLink, ShieldCheck, Store, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { api } from "@/lib/api/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";

type CommercialProfile = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  role: "ADMIN" | "RESELLER";
  storeName: string;
  storeDescription: string;
  storeWhatsApp: string;
};
type ProfileResponse = { ok: true; profile: CommercialProfile; message?: string };
type RequestError = { response?: { data?: { message?: string } } };

function requestMessage(error: unknown, fallback: string) {
  return (error as RequestError)?.response?.data?.message ?? fallback;
}

export default function SettingsPage() {
  const router = useRouter();
  const { data: user } = useCurrentUser();
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const [storeName, setStoreName] = useState("");
  const [storeDescription, setStoreDescription] = useState("");
  const [storeWhatsApp, setStoreWhatsApp] = useState("");
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileMessage, setProfileMessage] = useState("");
  const [copyError, setCopyError] = useState("");

  useEffect(() => {
    if (!user?.id) return;
    let active = true;

    setLoadingProfile(true);
    api.get<ProfileResponse>("/profile")
      .then(({ data }) => {
        if (!active) return;
        setStoreName(data.profile.storeName ?? "");
        setStoreDescription(data.profile.storeDescription ?? "");
        setStoreWhatsApp(data.profile.storeWhatsApp ?? "");
      })
      .catch((caught: unknown) => {
        if (active) setProfileError(requestMessage(caught, "No pudimos cargar el perfil comercial."));
      })
      .finally(() => {
        if (active) setLoadingProfile(false);
      });

    return () => { active = false; };
  }, [user?.id]);

  async function handleProfileSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProfileError("");
    setProfileMessage("");
    setSavingProfile(true);

    try {
      const response = await api.patch<ProfileResponse>("/profile", {
        storeName,
        storeDescription,
        storeWhatsApp,
      });
      setStoreName(response.data.profile.storeName ?? "");
      setStoreDescription(response.data.profile.storeDescription ?? "");
      setStoreWhatsApp(response.data.profile.storeWhatsApp ?? "");
      setProfileMessage(response.data.message ?? "Perfil comercial actualizado correctamente.");
    } catch (caught) {
      setProfileError(requestMessage(caught, "No pudimos guardar el perfil comercial."));
    } finally {
      setSavingProfile(false);
    }
  }

  async function copyStoreLink() {
    if (!user?.id || typeof window === "undefined") return;
    setCopyError("");
    try {
      await navigator.clipboard.writeText(window.location.origin + "/tienda/" + user.id);
      setCopyError("Enlace copiado al portapapeles.");
    } catch {
      setCopyError("No pudimos copiar el enlace. Abre la tienda y copia su dirección desde el navegador.");
    }
  }

  async function handleBootstrap(event: FormEvent<HTMLFormElement>) {
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
    } catch (requestError: unknown) {
      setError(requestMessage(requestError, "No pudimos activar la cuenta."));
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
          <p>Personaliza cómo se presenta tu negocio en el catálogo público.</p>
        </div>
      </section>

      <section className="settings-grid">
        <article className="panel-card settings-card settings-store-card">
          <div className="settings-icon"><Store size={18} /></div>
          <span className="panel-kicker">Tienda pública</span>
          <h2>Perfil comercial</h2>
          <p>Este nombre, descripción y WhatsApp se mostrarán en tu tienda pública. Si el nombre queda vacío, usaremos tu nombre y apellido.</p>

          <form onSubmit={handleProfileSave} className="settings-form">
            <label className="field">
              <span>Nombre comercial</span>
              <input
                type="text"
                value={storeName}
                onChange={(event) => setStoreName(event.target.value)}
                maxLength={80}
                placeholder={user ? [user.firstName, user.lastName].filter(Boolean).join(" ") : "Nombre de tu negocio"}
                disabled={loadingProfile || savingProfile}
              />
            </label>

            <label className="field">
              <span>Descripción de la tienda</span>
              <textarea
                value={storeDescription}
                onChange={(event) => setStoreDescription(event.target.value)}
                maxLength={300}
                rows={3}
                placeholder="Qué vendes y qué pueden encontrar tus clientes..."
                disabled={loadingProfile || savingProfile}
              />
              <small className="field-help">{storeDescription.length}/300 caracteres</small>
            </label>

            <label className="field">
              <span>WhatsApp comercial</span>
              <input
                type="tel"
                value={storeWhatsApp}
                onChange={(event) => setStoreWhatsApp(event.target.value)}
                maxLength={40}
                placeholder={user?.phone || "+1 555 000 0000"}
                autoComplete="tel"
                disabled={loadingProfile || savingProfile}
              />
              <small className="field-help">Incluye el código de país. Si lo dejas vacío, se usará el teléfono de tu cuenta.</small>
            </label>

            {profileError ? <div className="auth-error" role="alert">{profileError}</div> : null}
            {profileMessage ? <div className="settings-success" role="status">{profileMessage}</div> : null}

            <button className="primary-button settings-save-button" type="submit" disabled={loadingProfile || savingProfile}>
              {loadingProfile ? "Cargando perfil..." : savingProfile ? "Guardando..." : "Guardar perfil comercial"}
            </button>
          </form>

          <div className="settings-store-link">
            <div>
              <span className="panel-kicker">Enlace público</span>
              <strong>Tu catálogo para compartir</strong>
              <p>Usa este enlace para enviar tu tienda a tus clientes.</p>
            </div>
            {user?.id ? (
              <div className="settings-store-link-actions">
                <a href={"/tienda/" + user.id} target="_blank" rel="noreferrer" className="secondary-button">
                  <ExternalLink size={14} /> Abrir tienda
                </a>
                <button type="button" onClick={copyStoreLink} className="secondary-button">
                  <Copy size={14} /> Copiar enlace
                </button>
              </div>
            ) : null}
            {copyError ? <small className="field-help" role="status">{copyError}</small> : null}
          </div>
        </article>

        <div className="settings-side-column">
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
        </div>
      </section>
    </div>
  );
}
