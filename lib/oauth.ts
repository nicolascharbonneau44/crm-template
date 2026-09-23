import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";

export const MCP_SCOPE = "crm";
const CODE_TTL_MS = 5 * 60 * 1000;
const ACCESS_TTL_S = 60 * 60;
const REFRESH_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export class OAuthError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export function publicBaseUrl(headers: Headers) {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  const host = headers.get("x-forwarded-host") ?? headers.get("host") ?? "localhost:3000";
  const proto =
    headers.get("x-forwarded-proto")?.split(",")[0].trim() ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${proto}://${host}`;
}

export function mcpResourceUrl(headers: Headers) {
  return `${publicBaseUrl(headers)}/api/mcp`;
}

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function randomToken(prefix: string) {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

export function safeEqual(a: string, b: string) {
  const ha = Buffer.from(sha256(a), "hex");
  const hb = Buffer.from(sha256(b), "hex");
  return timingSafeEqual(ha, hb);
}

const BLOCKED_SCHEMES = new Set(["javascript:", "data:", "file:", "vbscript:", "blob:"]);

function isAcceptableRedirectUri(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length > 2000) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.hash) return false;
  if (BLOCKED_SCHEMES.has(url.protocol)) return false;
  if (url.protocol === "http:") {
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  }
  return true;
}

export async function registerClient(body: Record<string, unknown>) {
  const redirectUris = body.redirect_uris;
  if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
    throw new OAuthError("invalid_redirect_uri", "redirect_uris requis");
  }
  if (!redirectUris.every(isAcceptableRedirectUri)) {
    throw new OAuthError("invalid_redirect_uri", "redirect_uri non autorisée");
  }

  const name =
    typeof body.client_name === "string" && body.client_name.trim()
      ? body.client_name.trim().slice(0, 120)
      : "Application MCP";
  const authMethod =
    typeof body.token_endpoint_auth_method === "string" ? body.token_endpoint_auth_method : "none";
  if (!["none", "client_secret_post", "client_secret_basic"].includes(authMethod)) {
    throw new OAuthError("invalid_client_metadata", "token_endpoint_auth_method non supportée");
  }

  const clientId = `mcp_${randomBytes(16).toString("hex")}`;
  const clientSecret = authMethod === "none" ? null : randomToken("crm_cs");

  const client = await prisma.mcpClient.create({
    data: {
      id: clientId,
      name,
      redirectUris: JSON.stringify(redirectUris),
      secretHash: clientSecret ? sha256(clientSecret) : null,
    },
  });

  return {
    client_id: client.id,
    client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
    ...(clientSecret ? { client_secret: clientSecret, client_secret_expires_at: 0 } : {}),
    client_name: name,
    redirect_uris: redirectUris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: authMethod,
    scope: MCP_SCOPE,
  };
}

export async function findClient(clientId: string | null | undefined) {
  if (!clientId) return null;
  return prisma.mcpClient.findUnique({ where: { id: clientId } });
}

export function clientRedirectUris(client: { redirectUris: string }): string[] {
  try {
    const parsed = JSON.parse(client.redirectUris) as unknown;
    return Array.isArray(parsed) ? parsed.filter((u): u is string => typeof u === "string") : [];
  } catch {
    return [];
  }
}

export function isRegisteredRedirectUri(client: { redirectUris: string }, redirectUri: string) {
  return clientRedirectUris(client).includes(redirectUri);
}

type AuthorizeParams = { get(name: string): string | null };

export type AuthorizeValidation =
  | { kind: "fatal"; message: string }
  | { kind: "redirect_error"; url: string }
  | {
      kind: "ok";
      client: { id: string; name: string };
      redirectUri: string;
      codeChallenge: string;
      state: string | null;
      scope: string;
    };

export function authorizationRedirect(
  redirectUri: string,
  params: Record<string, string | null | undefined>,
) {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
}

export async function validateAuthorizeRequest(params: AuthorizeParams): Promise<AuthorizeValidation> {
  const client = await findClient(params.get("client_id"));
  if (!client) {
    return { kind: "fatal", message: "Application inconnue. Relancez la connexion depuis Claude." };
  }
  const redirectUri = params.get("redirect_uri") ?? clientRedirectUris(client)[0] ?? "";
  if (!redirectUri || !isRegisteredRedirectUri(client, redirectUri)) {
    return { kind: "fatal", message: "Adresse de retour non autorisée pour cette application." };
  }

  const state = params.get("state");
  const fail = (error: string, description: string): AuthorizeValidation => ({
    kind: "redirect_error",
    url: authorizationRedirect(redirectUri, { error, error_description: description, state }),
  });

  if (params.get("response_type") !== "code") {
    return fail("unsupported_response_type", "response_type=code requis");
  }
  const codeChallenge = params.get("code_challenge");
  if (!codeChallenge || params.get("code_challenge_method") !== "S256") {
    return fail("invalid_request", "PKCE S256 requis");
  }

  return {
    kind: "ok",
    client: { id: client.id, name: client.name },
    redirectUri,
    codeChallenge,
    state,
    scope: MCP_SCOPE,
  };
}

export async function createAuthorizationCode(input: {
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  scope?: string | null;
}) {
  const code = randomToken("crm_code");
  await prisma.mcpAuthCode.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await prisma.mcpAuthCode.create({
    data: {
      codeHash: sha256(code),
      clientId: input.clientId,
      userId: input.userId,
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
      scope: input.scope ?? MCP_SCOPE,
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    },
  });
  return code;
}

function pkceChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function authenticateClient(
  client: { secretHash: string | null },
  providedSecret: string | null,
) {
  if (!client.secretHash) return true;
  if (!providedSecret) return false;
  return safeEqual(sha256(providedSecret), client.secretHash);
}

async function issueTokens(connectionId: string | null, data: { clientId: string; userId: string; scope: string | null }) {
  const accessToken = randomToken("crm_at");
  const refreshToken = randomToken("crm_rt");
  const tokenData = {
    accessTokenHash: sha256(accessToken),
    accessExpiresAt: new Date(Date.now() + ACCESS_TTL_S * 1000),
    refreshTokenHash: sha256(refreshToken),
    refreshExpiresAt: new Date(Date.now() + REFRESH_TTL_MS),
  };

  if (connectionId) {
    await prisma.mcpConnection.update({ where: { id: connectionId }, data: tokenData });
  } else {
    await prisma.mcpConnection.create({ data: { ...data, ...tokenData } });
  }

  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TTL_S,
    refresh_token: refreshToken,
    scope: data.scope ?? MCP_SCOPE,
  };
}

export async function exchangeAuthorizationCode(input: {
  code: string;
  clientId: string;
  redirectUri: string | null;
  codeVerifier: string | null;
}) {
  const codeHash = sha256(input.code);
  const record = await prisma.mcpAuthCode.findUnique({ where: { codeHash } });
  const consumed = await prisma.mcpAuthCode.deleteMany({ where: { codeHash } });
  if (!record || consumed.count !== 1 || record.expiresAt < new Date()) {
    throw new OAuthError("invalid_grant", "Code d'autorisation invalide ou expiré");
  }
  if (record.clientId !== input.clientId) {
    throw new OAuthError("invalid_grant", "Code émis pour une autre application");
  }
  if (input.redirectUri && input.redirectUri !== record.redirectUri) {
    throw new OAuthError("invalid_grant", "redirect_uri différente");
  }
  if (!input.codeVerifier || pkceChallenge(input.codeVerifier) !== record.codeChallenge) {
    throw new OAuthError("invalid_grant", "code_verifier invalide");
  }

  return issueTokens(null, { clientId: record.clientId, userId: record.userId, scope: record.scope });
}

export async function refreshAccessToken(input: { refreshToken: string; clientId: string }) {
  const connection = await prisma.mcpConnection.findUnique({
    where: { refreshTokenHash: sha256(input.refreshToken) },
  });
  if (!connection || connection.refreshExpiresAt < new Date()) {
    throw new OAuthError("invalid_grant", "Refresh token invalide ou expiré");
  }
  if (connection.clientId !== input.clientId) {
    throw new OAuthError("invalid_grant", "Refresh token émis pour une autre application");
  }
  return issueTokens(connection.id, connection);
}

export async function authenticateAccessToken(token: string) {
  const connection = await prisma.mcpConnection.findUnique({
    where: { accessTokenHash: sha256(token) },
    select: { id: true, userId: true, accessExpiresAt: true, lastUsedAt: true },
  });
  if (!connection || connection.accessExpiresAt < new Date()) return null;

  const staleAfter = Date.now() - 60 * 1000;
  if (!connection.lastUsedAt || connection.lastUsedAt.getTime() < staleAfter) {
    await prisma.mcpConnection.update({
      where: { id: connection.id },
      data: { lastUsedAt: new Date() },
    });
  }
  return { userId: connection.userId, connectionId: connection.id };
}

export async function listConnections() {
  return prisma.mcpConnection.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      lastUsedAt: true,
      client: { select: { name: true } },
      user: { select: { email: true } },
    },
  });
}

export async function revokeConnection(id: string) {
  const result = await prisma.mcpConnection.deleteMany({ where: { id } });
  return result.count > 0;
}

export function authorizationServerMetadata(headers: Headers) {
  const base = publicBaseUrl(headers);
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    scopes_supported: [MCP_SCOPE],
  };
}

export function protectedResourceMetadata(headers: Headers) {
  const base = publicBaseUrl(headers);
  return {
    resource: `${base}/api/mcp`,
    authorization_servers: [base],
    bearer_methods_supported: ["header"],
    scopes_supported: [MCP_SCOPE],
    resource_name: "CRM",
  };
}

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
  "Access-Control-Max-Age": "86400",
};
