"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const email = String(new FormData(event.currentTarget).get("email") ?? "");
    await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    }).catch(() => null);
    setPending(false);
    setSent(true);
  }

  return (
    <div className="login-page">
      {sent ? (
        <div className="login-card">
          <h1>Vérifiez vos emails</h1>
          <p>
            Si un compte existe pour cette adresse, un lien pour choisir un nouveau mot de passe vient d’être envoyé. Il
            est valable 1 heure. Pensez à regarder dans les spams.
          </p>
          <Link className="btn secondary" href="/login">
            Retour à la connexion
          </Link>
        </div>
      ) : (
        <form className="login-card form-grid" onSubmit={onSubmit}>
          <div>
            <h1>Mot de passe oublié</h1>
            <p>Indiquez votre email : vous recevrez un lien pour choisir un nouveau mot de passe.</p>
          </div>
          <label>
            Email
            <input className="input" name="email" type="email" required autoComplete="email" autoFocus />
          </label>
          <button className="btn" disabled={pending} type="submit">
            {pending ? "Envoi…" : "Recevoir le lien"}
          </button>
          <Link className="login-link" href="/login">
            Retour à la connexion
          </Link>
        </form>
      )}
    </div>
  );
}
