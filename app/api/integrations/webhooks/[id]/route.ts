import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  WebhookPayloadError,
  deleteEndpoint,
  regenerateEndpointToken,
  updateEndpoint,
} from "@/lib/webhooks/meetmagnet";

type Ctx = { params: Promise<{ id: string }> };

async function guard<T>(fn: () => Promise<T>) {
  if (!(await getSessionUser())) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  try {
    return NextResponse.json((await fn()) ?? { ok: true });
  } catch (error) {
    if (error instanceof WebhookPayloadError) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: "Webhook introuvable" }, { status: 404 });
  }
}

export async function PATCH(request: Request, context: Ctx) {
  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return guard(async () => {
    const endpoint = await updateEndpoint(id, body);
    return { id: endpoint.id };
  });
}

/** Nouvelle URL secrète : l'ancienne cesse aussitôt de fonctionner. */
export async function POST(_request: Request, context: Ctx) {
  const { id } = await context.params;
  return guard(async () => {
    await regenerateEndpointToken(id);
    return { ok: true };
  });
}

export async function DELETE(_request: Request, context: Ctx) {
  const { id } = await context.params;
  return guard(async () => {
    await deleteEndpoint(id);
    return { ok: true };
  });
}
