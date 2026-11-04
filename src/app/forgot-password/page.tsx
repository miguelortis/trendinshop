"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { ArrowLeft, Mail } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { api } from "@/lib/api/client";

type ErrorShape = { response?: { data?: { message?: string } } };

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setError("");
    setLoading(true);
    try {
      const response = await api.post<{ ok: true; message: string }>("/auth/password-reset-request", { email });
      setMessage(response.data.message);
    } catch (caught) {
      setError((caught as ErrorShape).response?.data?.message ?? "No pudimos procesar tu solicitud. Inténtalo de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-background" />
      <section className="auth-card-wrap">
        <div className="auth-card">
          <div className="auth-card-heading">
            <span className="mobile-logo"><Logo /></span>
            <span className="page-kicker">Recuperación de acceso</span>
            <h2>¿Olvidaste tu contraseña?</h2>
            <p>Escribe el correo asociado a tu cuenta y te enviaremos un enlace seguro para crear una nueva contraseña.</p>
          </div>
          {error ? <div className="auth-error" role="alert">{error}</div> : null}
          {message ? <div className="auth-success" role="status">{message}</div> : null}
          <form className="auth-form" onSubmit={handleSubmit}>
            <label className="field">
              <span>Correo electrónico</span>
              <div className="input-with-icon"><Mail size={16} /><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="nombre@correo.com" required disabled={loading} /></div>
            </label>
            <button className="auth-submit" type="submit" disabled={loading}>
              {loading ? "Enviando..." : "Enviar enlace de recuperación"}
            </button>
          </form>
          <Link href="/login" className="auth-back-link"><ArrowLeft size={16} /> Volver a iniciar sesión</Link>
        </div>
      </section>
    </main>
  );
}
