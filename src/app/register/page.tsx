"use client";

import { ArrowLeft, ArrowRight, CalendarDays, Eye, EyeOff, LockKeyhole, Mail, Phone, UserRound } from "lucide-react";
import Link from "next/link";
import { FormEvent, useState } from "react";
import { Logo } from "@/components/brand/Logo";

export default function RegisterPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
  }

  return (
    <main className="auth-page auth-page-register">
      <div className="auth-background" />
      <div className="register-shell">
        <div className="register-topbar"><Logo /><Link href="/login" className="back-link"><ArrowLeft size={16} />Ya tengo una cuenta</Link></div>

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

            <form className="register-form" onSubmit={handleSubmit}>
              <div className="form-section-label">Información personal</div>
              <div className="form-grid two">
                <label className="field"><span>Cédula</span><input placeholder="12345678" inputMode="numeric" required /></label>
                <label className="field"><span>Teléfono</span><div className="input-with-icon"><Phone size={16} /><input placeholder="+58 414 555 5555" type="tel" required /></div></label>
              </div>
              <div className="form-grid two">
                <label className="field"><span>Nombre</span><div className="input-with-icon"><UserRound size={16} /><input placeholder="Pedro" autoComplete="given-name" required /></div></label>
                <label className="field"><span>Apellido</span><input placeholder="Pérez" autoComplete="family-name" required /></label>
              </div>
              <div className="form-grid two">
                <label className="field"><span>Género</span><select defaultValue="" required><option value="" disabled>Selecciona una opción</option><option>Femenino</option><option>Masculino</option><option>No especificar</option></select></label>
                <label className="field"><span>Fecha de nacimiento</span><div className="input-with-icon"><CalendarDays size={16} /><input type="date" required /></div></label>
              </div>

              <div className="form-section-label">Acceso a tu cuenta</div>
              <label className="field"><span>Correo electrónico</span><div className="input-with-icon"><Mail size={16} /><input type="email" placeholder="nombre@correo.com" autoComplete="email" required /></div></label>

              <div className="form-grid two">
                <label className="field"><span>Contraseña</span><div className="password-input"><LockKeyhole size={16} /><input type={showPassword ? "text" : "password"} placeholder="Mínimo 8 caracteres" autoComplete="new-password" required /><button type="button" onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label>
                <label className="field"><span>Confirmar contraseña</span><div className="password-input"><LockKeyhole size={16} /><input type={showConfirm ? "text" : "password"} placeholder="Repite la contraseña" autoComplete="new-password" required /><button type="button" onClick={() => setShowConfirm((value) => !value)}>{showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label>
              </div>

              <label className="check-row register-check"><input type="checkbox" required /><span>Acepto los términos de servicio y la política de privacidad.</span></label>
              <button className="auth-submit" type="submit">Crear mi cuenta<ArrowRight size={17} /></button>
            </form>
          </section>
        </div>
      </div>
    </main>
  );
}
