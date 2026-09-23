import { NextResponse } from "next/server";
import { authenticateMcpRequest, mcpUnauthorized } from "@/lib/auth-mcp";
import { handleMcpMessage } from "@/lib/mcp/server";
import { CORS_HEADERS } from "@/lib/oauth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await authenticateMcpRequest(request);
  if (!auth) return mcpUnauthorized(request);

  const body = (await request.json().catch(() => undefined)) as unknown;
  if (body === undefined) {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON invalide" } },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const ctx = { userId: auth.userId };
  const messages = Array.isArray(body) ? body : [body];
  const responses = (await Promise.all(messages.map((m) => handleMcpMessage(m, ctx)))).filter(Boolean);

  if (responses.length === 0) return new NextResponse(null, { status: 202, headers: CORS_HEADERS });
  return NextResponse.json(Array.isArray(body) ? responses : responses[0], { headers: CORS_HEADERS });
}

// Transport Streamable HTTP sans flux SSE serveur → 405 une fois authentifié.
export async function GET(request: Request) {
  const auth = await authenticateMcpRequest(request);
  if (!auth) return mcpUnauthorized(request);
  return new NextResponse(null, { status: 405, headers: { ...CORS_HEADERS, Allow: "POST" } });
}

export function DELETE() {
  return new NextResponse(null, { status: 405, headers: { ...CORS_HEADERS, Allow: "POST" } });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
