import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { validateAuthorizeRequest } from "@/lib/oauth";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export const dynamic = "force-dynamic";

export default async function AuthorizePage({ searchParams }: { searchParams: SearchParams }) {
  const raw = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") query.set(key, value);
  }

  const user = await getSessionUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${query.toString()}`)}`);
  }

  const validation = await validateAuthorizeRequest(query);
  if (validation.kind === "redirect_error") redirect(validation.url);

  if (validation.kind === "fatal") {
    return (
      <div className="login-page">
        <div className="login-card">
          <h1>Connexion impossible</h1>
          <p>{validation.message}</p>
        </div>
      </div>
    );
  }

  const redirectHost = (() => {
    try {
      const url = new URL(validation.redirectUri);
      return url.host || url.protocol.replace(":", "");
    } catch {
      return validation.redirectUri;
    }
  })();
  const host = (await headers()).get("x-forwarded-host") ?? (await headers()).get("host");

  return (
    <div className="login-page">
      <form className="login-card consent-card" method="post" action="/api/oauth/authorize">
        <h1>Autoriser {validation.client.name} ?</h1>
        <p>
          {validation.client.name} demande l’accès à votre CRM <strong>{host}</strong>.
        </p>
        <ul className="consent-list">
          <li>Consulter et rechercher les contacts, entreprises et actions</li>
          <li>Créer, modifier et supprimer des contacts, entreprises et actions</li>
          <li>Lire les statistiques</li>
        </ul>
        <p className="consent-meta">
          Connecté en tant que <strong>{user.email}</strong>. Vous serez ensuite renvoyé vers{" "}
          <strong>{redirectHost}</strong>. Vous pourrez retirer cet accès à tout moment dans Paramètres.
        </p>
        {[
          "client_id",
          "redirect_uri",
          "response_type",
          "code_challenge",
          "code_challenge_method",
          "state",
          "scope",
        ].map((name) =>
          query.has(name) ? <input key={name} type="hidden" name={name} value={query.get(name) ?? ""} /> : null,
        )}
        <div className="consent-actions">
          <button className="btn secondary" type="submit" name="decision" value="deny">
            Refuser
          </button>
          <button className="btn" type="submit" name="decision" value="allow">
            Autoriser
          </button>
        </div>
      </form>
    </div>
  );
}
