import { NextResponse } from "next/server";
import {
  CORS_HEADERS,
  OAuthError,
  authenticateClient,
  exchangeAuthorizationCode,
  findClient,
  refreshAccessToken,
} from "@/lib/oauth";

async function readParams(request: Request): Promise<URLSearchParams> {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(body)) {
      if (typeof value === "string") params.set(key, value);
    }
    return params;
  }
  return new URLSearchParams(await request.text());
}

function basicCredentials(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Basic\s+(.+)$/i);
  if (!match) return null;
  const decoded = Buffer.from(match[1], "base64").toString("utf8");
  const sep = decoded.indexOf(":");
  if (sep < 0) return null;
  return {
    clientId: decodeURIComponent(decoded.slice(0, sep)),
    clientSecret: decodeURIComponent(decoded.slice(sep + 1)),
  };
}

function oauthError(code: string, description: string, status = 400) {
  return NextResponse.json(
    { error: code, error_description: description },
    { status, headers: { ...CORS_HEADERS, "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const params = await readParams(request);
  const basic = basicCredentials(request);
  const clientId = basic?.clientId ?? params.get("client_id");
  const clientSecret = basic?.clientSecret ?? params.get("client_secret");

  const client = await findClient(clientId);
  if (!client || !authenticateClient(client, clientSecret)) {
    return oauthError("invalid_client", "Application inconnue ou secret invalide", 401);
  }

  try {
    const grantType = params.get("grant_type");
    let tokens;
    if (grantType === "authorization_code") {
      const code = params.get("code");
      if (!code) return oauthError("invalid_request", "code requis");
      tokens = await exchangeAuthorizationCode({
        code,
        clientId: client.id,
        redirectUri: params.get("redirect_uri"),
        codeVerifier: params.get("code_verifier"),
      });
    } else if (grantType === "refresh_token") {
      const refreshToken = params.get("refresh_token");
      if (!refreshToken) return oauthError("invalid_request", "refresh_token requis");
      tokens = await refreshAccessToken({ refreshToken, clientId: client.id });
    } else {
      return oauthError("unsupported_grant_type", "grant_type non supporté");
    }
    return NextResponse.json(tokens, {
      headers: { ...CORS_HEADERS, "Cache-Control": "no-store", Pragma: "no-cache" },
    });
  } catch (error) {
    if (error instanceof OAuthError) return oauthError(error.code, error.message, error.status);
    throw error;
  }
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
