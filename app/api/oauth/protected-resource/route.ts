import { NextResponse } from "next/server";
import { CORS_HEADERS, protectedResourceMetadata } from "@/lib/oauth";

export function GET(request: Request) {
  return NextResponse.json(protectedResourceMetadata(request.headers), { headers: CORS_HEADERS });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
