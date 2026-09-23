"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);
    const form = new FormData(event.currentTarget);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Connexion impossible");
      setPending(false);
      return;
    }
    const requested = searchParams.get("next") ?? "";
    const next = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/contacts";
    router.push(next);
    router.refresh();
  }

  return (
    <div className="login-page">
      <form className="login-card form-grid" onSubmit={onSubmit}>
        <div>
          <h1>CRM Client</h1>
          <p>Connectez-vous pour accéder à l’interface.</p>
        </div>
        <label>
          Email
          <input className="input" name="email" type="email" required defaultValue="admin@example.com" />
        </label>
        <label>
          Mot de passe
          <input className="input" name="password" type="password" required defaultValue="admin123!" />
        </label>
        {error ? <p className="error">{error}</p> : null}
        <button className="btn" disabled={pending} type="submit">
          {pending ? "Connexion…" : "Se connecter"}
        </button>
      </form>
    </div>
  );
}
