"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

export function ResetPasswordForm({ token }: { token: string }) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password !== String(form.get("confirm") ?? "")) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }
    setError("");
    setPending(true);
    const res = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    setPending(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Modification impossible");
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="login-card">
        <h1>Mot de passe modifié</h1>
        <p>Vous pouvez maintenant vous connecter avec votre nouveau mot de passe.</p>
        <Link className="btn" href="/login">
          Se connecter
        </Link>
      </div>
    );
  }

  return (
    <form className="login-card form-grid" onSubmit={onSubmit}>
      <div>
        <h1>Nouveau mot de passe</h1>
        <p>Choisissez un mot de passe d’au moins 8 caractères.</p>
      </div>
      <label>
        Nouveau mot de passe
        <input className="input" name="password" type="password" required minLength={8} autoComplete="new-password" autoFocus />
      </label>
      <label>
        Confirmer le mot de passe
        <input className="input" name="confirm" type="password" required minLength={8} autoComplete="new-password" />
      </label>
      {error ? <p className="error">{error}</p> : null}
      <button className="btn" disabled={pending} type="submit">
        {pending ? "Enregistrement…" : "Enregistrer le mot de passe"}
      </button>
    </form>
  );
}
