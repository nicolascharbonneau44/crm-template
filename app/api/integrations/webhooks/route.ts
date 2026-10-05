import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createEndpoint } from "@/lib/webhooks/meetmagnet";

export async function POST(request: Request) {
  if (!(await getSessionUser())) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { name?: unknown };
  const endpoint = await createEndpoint(body.name);
  return NextResponse.json({ id: endpoint.id }, { status: 201 });
}
