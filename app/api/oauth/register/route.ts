import { NextResponse } from "next/server";
import { CORS_HEADERS, OAuthError, registerClient } from "@/lib/oauth";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { error: "invalid_client_metadata", error_description: "Corps JSON requis" },
      { status: 400, headers: CORS_HEADERS },
    );
  }
  try {
    const client = await registerClient(body);
    return NextResponse.json(client, {
      status: 201,
      headers: { ...CORS_HEADERS, "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof OAuthError) {
      return NextResponse.json(
        { error: error.code, error_description: error.message },
        { status: error.status, headers: CORS_HEADERS },
      );
    }
    throw error;
  }
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
