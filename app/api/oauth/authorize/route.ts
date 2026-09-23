import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  authorizationRedirect,
  createAuthorizationCode,
  publicBaseUrl,
  validateAuthorizeRequest,
} from "@/lib/oauth";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== publicBaseUrl(request.headers)) {
    return NextResponse.json({ error: "Origine refusée" }, { status: 403 });
  }

  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const form = await request.formData();
  const params = { get: (name: string) => (form.get(name) as string | null) ?? null };
  const validation = await validateAuthorizeRequest(params);

  if (validation.kind === "fatal") {
    return NextResponse.json({ error: validation.message }, { status: 400 });
  }
  if (validation.kind === "redirect_error") {
    return NextResponse.redirect(validation.url, 303);
  }

  if (form.get("decision") !== "allow") {
    return NextResponse.redirect(
      authorizationRedirect(validation.redirectUri, {
        error: "access_denied",
        error_description: "Accès refusé par l'utilisateur",
        state: validation.state,
      }),
      303,
    );
  }

  const code = await createAuthorizationCode({
    clientId: validation.client.id,
    userId: user.id,
    redirectUri: validation.redirectUri,
    codeChallenge: validation.codeChallenge,
    scope: validation.scope,
  });

  return NextResponse.redirect(
    authorizationRedirect(validation.redirectUri, {
      code,
      state: validation.state,
      iss: publicBaseUrl(request.headers),
    }),
    303,
  );
}
