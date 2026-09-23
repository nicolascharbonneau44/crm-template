import Link from "next/link";
import { isResetTokenValid } from "@/lib/password";
import { ResetPasswordForm } from "./reset-form";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ token?: string }>;

export default async function ResetPasswordPage({ searchParams }: { searchParams: SearchParams }) {
  const token = (await searchParams).token ?? "";
  const valid = await isResetTokenValid(token);

  return (
    <div className="login-page">
      {valid ? (
        <ResetPasswordForm token={token} />
      ) : (
        <div className="login-card">
          <h1>Lien expiré</h1>
          <p>Ce lien n’est plus valable (il expire après 1 heure et ne sert qu’une fois).</p>
          <Link className="btn" href="/forgot-password">
            Demander un nouveau lien
          </Link>
        </div>
      )}
    </div>
  );
}
