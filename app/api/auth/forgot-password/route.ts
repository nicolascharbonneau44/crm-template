import { NextResponse } from "next/server";
import { requestPasswordReset } from "@/lib/password";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { email?: unknown };
  // Réponse identique et immédiate que le compte existe ou non (pas d'énumération, pas d'écart de temps).
  void requestPasswordReset(body.email, request.headers).catch((error) =>
    console.error("[mot de passe] envoi du lien impossible", error),
  );
  return NextResponse.json({ ok: true });
}
