"use client";

import { ArrowRight, Eye, EyeOff, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { FormEvent, useState } from "react";
import { Logo } from "@/components/brand/Logo";

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
  }

  return (
    <main className="auth-page">
      <div className="auth-background" />
      <div className="auth-layout">
        <section className="auth-showcase">
          <Logo />
          <div className="auth-showcase-copy">
            <span className="auth-badge"><Sparkles size={14} />Hecho para vender mejor</span>
            <h1>Tu negocio,<br /><span>más organizado.</span></h1>
            <p>Productos, inventario, clientes, ventas y pagos. Todo en un solo lugar y sin complicaciones.</p>
          </div>
          <div className="auth-showcase-card">
            <div className="showcase-card-top"><span>Ventas del mes</span><span className="showcase-positive">+12.8%</span></div>
            <strong>$12,840</strong>
            <div className="mini-bars">{[36,52,44,68,58,74,62,84,70,94,76,100].map((height, index) => <span key={index} style={{ height: height + "%" }} />)}</div>
          </div>
          <div className="auth-trust"><ShieldCheck size={16} />Tus datos se gestionan de forma segura.</div>
        </section>

        <section className="auth-card-wrap">
          <div className="auth-card">
            <div className="auth-card-heading">
              <span className="mobile-logo"><Logo /></span>
              <span className="page-kicker">Bienvenido de nuevo</span>
              <h2>Inicia sesión</h2>
              <p>Accede a tu panel de TrendinShop.</p>
            </div>

            <form className="auth-form" onSubmit={handleSubmit}>
              <label className="field">
                <span>Correo electrónico</span>
                <input type="email" placeholder="nombre@correo.com" autoComplete="email" required />
              </label>

              <label className="field">
                <div className="field-label-row"><span>Contraseña</span><button type="button" className="field-link">¿Olvidaste tu contraseña?</button></div>
                <div className="password-input">
                  <input type={showPassword ? "text" : "password"} placeholder="••••••••" autoComplete="current-password" required />
                  <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label="Mostrar contraseña">
                    {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              </label>

              <label className="check-row">
                <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
                <span>Recordarme en este dispositivo</span>
              </label>

              <button className="auth-submit" type="submit">Entrar a TrendinShop<ArrowRight size={17} /></button>
            </form>

            <div className="auth-divider"><span>o</span></div>
            <div className="auth-footer-copy">¿Aún no tienes una cuenta? <Link href="/register">Crear cuenta</Link></div>
            <Link href="/dashboard?preview=1" className="demo-link">Ver vista previa del dashboard</Link>
          </div>
        </section>
      </div>
    </main>
  );
}
