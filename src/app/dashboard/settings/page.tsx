"use client";

import { Copy, ExternalLink, ImagePlus, LoaderCircle, ShieldCheck, Store, UserRound, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ChangeEvent, type FormEvent, useEffect, useState } from "react";
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
  storeLogoUrl: string;
  storeSlug: string;
};
type ProfileResponse = { ok: true; profile: CommercialProfile; message?: string };
type RequestError = { response?: { data?: { message?: string } } };

function requestMessage(error: unknown, fallback: string) {
  return (error as RequestError)?.response?.data?.message ?? fallback;
}

function slugPreview(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
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
  const [storeSlug, setStoreSlug] = useState("");
  const [savedStoreSlug, setSavedStoreSlug] = useState("");
  const [storeLogoUrl, setStoreLogoUrl] = useState("");
  const [logoLocalPreview, setLogoLocalPreview] = useState("");
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileMessage, setProfileMessage] = useState("");
  const [copyMessage, setCopyMessage] = useState("");

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
        setStoreSlug(data.profile.storeSlug ?? "");
        setSavedStoreSlug(data.profile.storeSlug ?? "");
        setStoreLogoUrl(data.profile.storeLogoUrl ?? "");
      })
      .catch((caught: unknown) => {
        if (active) setProfileError(requestMessage(caught, "No pudimos cargar el perfil comercial."));
      })
      .finally(() => {
        if (active) setLoadingProfile(false);
      });

    return () => { active = false; };
  }, [user?.id]);

  useEffect(() => {
    return () => {
      if (logoLocalPreview) URL.revokeObjectURL(logoLocalPreview);
    };
  }, [logoLocalPreview]);

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
        storeSlug,
      });
      setStoreName(response.data.profile.storeName ?? "");
      setStoreDescription(response.data.profile.storeDescription ?? "");
      setStoreWhatsApp(response.data.profile.storeWhatsApp ?? "");
      setStoreSlug(response.data.profile.storeSlug ?? "");
      setSavedStoreSlug(response.data.profile.storeSlug ?? "");
      setStoreLogoUrl(response.data.profile.storeLogoUrl ?? "");
      setProfileMessage(response.data.message ?? "Perfil comercial actualizado correctamente.");
    } catch (caught) {
      setProfileError(requestMessage(caught, "No pudimos guardar el perfil comercial."));
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleLogoSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setProfileError("");
    setProfileMessage("");
    if (!file.type.startsWith("image/")) {
      setProfileError("Selecciona un archivo de imagen.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setProfileError("El logotipo no puede superar los 5 MB.");
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    setLogoLocalPreview(previewUrl);
    setUploadingLogo(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await api.post<ProfileResponse>("/profile/logo", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setStoreLogoUrl(response.data.profile.storeLogoUrl ?? "");
      setProfileMessage(response.data.message ?? "Logotipo actualizado correctamente.");
    } catch (caught) {
      setProfileError(requestMessage(caught, "No pudimos subir el logotipo."));
    } finally {
      URL.revokeObjectURL(previewUrl);
      setLogoLocalPreview("");
      setUploadingLogo(false);
    }
  }

  async function copyStoreLink() {
    if (!user?.id || typeof window === "undefined") return;
    setCopyMessage("");
    try {
      await navigator.clipboard.writeText(window.location.origin + "/tienda/" + (savedStoreSlug || user.id));
      setCopyMessage("Enlace copiado al portapapeles.");
    } catch {
      setCopyMessage("No pudimos copiar el enlace. Abre la tienda y copia su dirección desde el navegador.");
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

  const publicStoreKey = savedStoreSlug || user?.id || "";
  const publicStoreUrl = typeof window !== "undefined" && publicStoreKey
    ? window.location.origin + "/tienda/" + publicStoreKey
    : "";

  return (
    <div className="dashboard-page">
      <section className="page-heading">
        <div>
          <span className="page-kicker">Sistema</span>
          <h1>Configuración</h1>
          <p>Personaliza la identidad y el enlace de tu tienda pública.</p>
        </div>
      </section>

      <section className="settings-grid">
        <article className="panel-card settings-card settings-store-card">
          <div className="settings-icon"><Store size={18} /></div>
          <span className="panel-kicker">Tienda pública</span>
          <h2>Identidad de tu tienda</h2>
          <p>El nombre, logotipo y descripción distinguen tu tienda. El enlace personalizado debe ser único.</p>

          <div className="settings-logo-section">
            <div className="settings-logo-preview">
              {logoLocalPreview || storeLogoUrl ? (
                <img src={logoLocalPreview || storeLogoUrl} alt="Logotipo de la tienda" />
              ) : (
                <span><ImagePlus size={25} /></span>
              )}
              {uploadingLogo ? <span className="settings-logo-uploading"><LoaderCircle size={17} /> Subiendo</span> : null}
            </div>
            <div className="settings-logo-copy">
              <strong>Logotipo</strong>
              <p>Se verá en la cabecera del catálogo. Recomendado: PNG transparente, JPG o WebP, hasta 5 MB.</p>
              <label className="secondary-button settings-logo-select">
                <ImagePlus size={14} /> {uploadingLogo ? "Subiendo logotipo..." : storeLogoUrl ? "Cambiar logotipo" : "Subir logotipo"}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/avif,image/gif"
                  hidden
                  disabled={loadingProfile || uploadingLogo}
                  onChange={(event) => void handleLogoSelection(event)}
                />
              </label>
            </div>
          </div>

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

            <label className="field">
              <span>Dirección personalizada</span>
              <div className="settings-slug-input">
                <span>/tienda/</span>
                <input
                  value={storeSlug}
                  onChange={(event) => setStoreSlug(event.target.value)}
                  maxLength={80}
                  placeholder={user?.firstName ? slugPreview(user.firstName + "-" + user.lastName) : "mi-tienda"}
                  disabled={loadingProfile || savingProfile}
                  autoCapitalize="none"
                  autoCorrect="off"
                />
              </div>
              <small className="field-help">
                {storeSlug.trim()
                  ? "Tu enlace: " + (typeof window !== "undefined" ? window.location.origin : "") + "/tienda/" + slugPreview(storeSlug)
                  : "Si queda vacío, se seguirá usando el enlace actual con tu identificador de cuenta."}
              </small>
            </label>

            {profileError ? <div className="auth-error" role="alert">{profileError}</div> : null}
            {profileMessage ? <div className="settings-success" role="status">{profileMessage}</div> : null}

            <button className="primary-button settings-save-button" type="submit" disabled={loadingProfile || savingProfile || uploadingLogo}>
              {loadingProfile ? "Cargando perfil..." : savingProfile ? "Guardando..." : "Guardar perfil comercial"}
            </button>
          </form>

          <div className="settings-store-link">
            <div>
              <span className="panel-kicker">Enlace público</span>
              <strong>Comparte tu tienda</strong>
              <p>{publicStoreUrl}</p>
            </div>
            {user?.id ? (
              <div className="settings-store-link-actions">
                <a href={"/tienda/" + publicStoreKey} target="_blank" rel="noreferrer" className="secondary-button">
                  <ExternalLink size={14} /> Abrir tienda
                </a>
                <button type="button" onClick={copyStoreLink} className="secondary-button">
                  <Copy size={14} /> Copiar enlace
                </button>
              </div>
            ) : null}
            {copyMessage ? <small className="field-help" role="status">{copyMessage}</small> : null}
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
