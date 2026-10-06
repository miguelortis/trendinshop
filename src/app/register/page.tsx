"use client";

import { ArrowLeft, ArrowRight, CalendarDays, Eye, EyeOff, LockKeyhole, Mail, Phone, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Logo } from "@/components/brand/Logo";
import { api } from "@/lib/api/client";

export default function RegisterPage() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [documentId, setDocumentId] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [gender, setGender] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!accepted) {
      setError("Debes aceptar los términos de servicio y la política de privacidad.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setLoading(true);

    try {
      await api.post("/auth/register", {
        documentId,
        firstName,
        lastName,
        phone,
        gender,
        birthDate,
        email,
        password,
        confirmPassword,
      });
      router.replace("/dashboard");
      router.refresh();
    } catch (requestError: any) {
      const message =
        requestError?.response?.data?.message ??
        "No pudimos crear tu cuenta. Inténtalo de nuevo.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page auth-page-register">
      <div className="auth-background" />
      <div className="register-shell">
        <div className="register-topbar">
          <Logo />
          <Link href="/login" className="back-link"><ArrowLeft size={16} />Ya tengo una cuenta</Link>
        </div>

        <div className="register-layout">
          <aside className="register-intro">
            <span className="auth-badge">Únete a TrendinShop</span>
            <h1>Empieza a construir tu catálogo.</h1>
            <p>Regístrate como revendedor y tendrás tus productos, precios, clientes y cuentas en un solo lugar.</p>

            <div className="register-points">
              <div><span>01</span><div><strong>Elige productos</strong><p>Añade productos de tu proveedor a tu catálogo.</p></div></div>
              <div><span>02</span><div><strong>Define tu precio</strong><p>Mira tu ganancia antes de publicar una venta.</p></div></div>
              <div><span>03</span><div><strong>Comparte y vende</strong><p>Comparte tu catálogo o productos con tus clientes.</p></div></div>
            </div>
          </aside>

          <section className="register-card">
            <div className="auth-card-heading">
              <span className="page-kicker">Crear cuenta</span>
              <h2>Tus datos personales</h2>
              <p>Usaremos esta información para identificar tu cuenta y gestionar tus ventas.</p>
            </div>

            {error && <div className="auth-error" role="alert">{error}</div>}

            <form className="register-form" onSubmit={handleSubmit}>
              <div className="form-section-label">Información personal</div>
              <div className="form-grid two">
                <label className="field"><span>Cédula</span><input placeholder="12345678" inputMode="numeric" value={documentId} onChange={(event) => setDocumentId(event.target.value)} required disabled={loading} /></label>
                <label className="field"><span>Teléfono</span><div className="input-with-icon"><Phone size={16} /><input placeholder="+58 414 555 5555" type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} required disabled={loading} /></div></label>
              </div>
              <div className="form-grid two">
                <label className="field"><span>Nombre</span><div className="input-with-icon"><UserRound size={16} /><input placeholder="Pedro" autoComplete="given-name" value={firstName} onChange={(event) => setFirstName(event.target.value)} required disabled={loading} /></div></label>
                <label className="field"><span>Apellido</span><input placeholder="Pérez" autoComplete="family-name" value={lastName} onChange={(event) => setLastName(event.target.value)} required disabled={loading} /></label>
              </div>
              <div className="form-grid two">
                <label className="field"><span>Género</span><select value={gender} onChange={(event) => setGender(event.target.value)} required disabled={loading}><option value="" disabled>Selecciona una opción</option><option value="female">Femenino</option><option value="male">Masculino</option><option value="unspecified">Prefiero no decirlo</option></select></label>
                <label className="field"><span>Fecha de nacimiento</span><div className="input-with-icon"><CalendarDays size={16} /><input type="date" value={birthDate} onChange={(event) => setBirthDate(event.target.value)} required disabled={loading} /></div></label>
              </div>

              <div className="form-section-label">Acceso a tu cuenta</div>
              <label className="field"><span>Correo electrónico</span><div className="input-with-icon"><Mail size={16} /><input type="email" placeholder="nombre@correo.com" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required disabled={loading} /></div></label>

              <div className="form-grid two">
                <label className="field"><span>Contraseña</span><div className="password-input"><LockKeyhole size={16} /><input type={showPassword ? "text" : "password"} placeholder="Mínimo 8 caracteres" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required disabled={loading} /><button type="button" onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label>
                <label className="field"><span>Confirmar contraseña</span><div className="password-input"><LockKeyhole size={16} /><input type={showConfirm ? "text" : "password"} placeholder="Repite la contraseña" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required disabled={loading} /><button type="button" onClick={() => setShowConfirm((value) => !value)}>{showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label>
              </div>

              <label className="check-row register-check"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} required disabled={loading} /><span>Acepto los términos de servicio y la política de privacidad.</span></label>
              <button className="auth-submit" type="submit" disabled={loading}>
                {loading ? "Creando cuenta..." : "Crear mi cuenta"}
                {!loading && <ArrowRight size={17} />}
              </button>
            </form>
          </section>
        </div>
      </div>
    </main>
  );
}
