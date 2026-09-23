import { NextResponse } from "next/server";
import { CORS_HEADERS, MCP_SCOPE, authenticateAccessToken, publicBaseUrl, safeEqual } from "@/lib/oauth";

export type McpAuth = { userId: string | null; via: "oauth" | "static_token" };

function bearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  return header.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || null;
}

/** OAuth (Claude, Cursor…) ou jeton statique MCP_TOKEN (scripts, outils sans OAuth). */
export async function authenticateMcpRequest(request: Request): Promise<McpAuth | null> {
  const token = bearerToken(request);
  if (!token) return null;

  const staticToken = process.env.MCP_TOKEN?.trim();
  if (staticToken && safeEqual(token, staticToken)) return { userId: null, via: "static_token" };

  const connection = await authenticateAccessToken(token);
  return connection ? { userId: connection.userId, via: "oauth" } : null;
}

export function mcpUnauthorized(request: Request) {
  const metadataUrl = `${publicBaseUrl(request.headers)}/.well-known/oauth-protected-resource/api/mcp`;
  const invalidToken = bearerToken(request) ? ', error="invalid_token"' : "";
  return NextResponse.json(
    { error: "Non autorisé" },
    {
      status: 401,
      headers: {
        ...CORS_HEADERS,
        "WWW-Authenticate": `Bearer resource_metadata="${metadataUrl}", scope="${MCP_SCOPE}"${invalidToken}`,
      },
    },
  );
}
