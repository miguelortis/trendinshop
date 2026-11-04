"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { ArrowLeft, LockKeyhole } from "lucide-react";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/brand/Logo";
import { api } from "@/lib/api/client";

type Props = { token: string };
type ErrorShape = { response?: { data?: { message?: string } } };

export function ResetPasswordForm({ token }: Props) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    if (!token) {
      setError("El enlace de recuperación está incompleto o no es válido.");
      return;
    }
    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setLoading(true);
    try {
      const response = await api.post<{ ok: true; message: string }>("/auth/password-reset", {
        token,
        password,
        confirmPassword,
      });
      setSuccess(response.data.message);
      window.setTimeout(() => router.replace("/login"), 1200);
    } catch (caught) {
      setError((caught as ErrorShape).response?.data?.message ?? "No pudimos actualizar la contraseña. Solicita un enlace nuevo.");
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
            <span className="page-kicker">Nueva contraseña</span>
            <h2>Restablecer contraseña</h2>
            <p>Elige una contraseña nueva para tu cuenta de TrendinShop.</p>
          </div>
          {error ? <div className="auth-error" role="alert">{error}</div> : null}
          {success ? <div className="auth-success" role="status">{success}</div> : null}
          <form className="auth-form" onSubmit={handleSubmit}>
            <label className="field">
              <span>Nueva contraseña</span>
              <div className="input-with-icon"><LockKeyhole size={16} /><input type="password" minLength={8} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required disabled={loading} /></div>
            </label>
            <label className="field">
              <span>Confirmar contraseña</span>
              <div className="input-with-icon"><LockKeyhole size={16} /><input type="password" minLength={8} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required disabled={loading} /></div>
            </label>
            <button className="auth-submit" type="submit" disabled={loading || Boolean(success)}>
              {loading ? "Actualizando..." : "Guardar nueva contraseña"}
            </button>
          </form>
          <Link href="/login" className="auth-back-link"><ArrowLeft size={16} /> Volver a iniciar sesión</Link>
        </div>
      </section>
    </main>
  );
}
