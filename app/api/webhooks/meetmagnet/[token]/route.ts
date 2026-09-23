import { NextResponse } from "next/server";
import {
  WebhookPayloadError,
  findMeetMagnetWebhookByToken,
  processMeetMagnetPayload,
} from "@/lib/webhooks/meetmagnet";

export const dynamic = "force-dynamic";

const MAX_BYTES = 2 * 1024 * 1024;

type Ctx = { params: Promise<{ token: string }> };

export async function GET(_request: Request, context: Ctx) {
  const { token } = await context.params;
  if (!(await findMeetMagnetWebhookByToken(token))) {
    return NextResponse.json({ error: "Webhook inconnu" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, source: "meetmagnet", message: "Webhook MeetMagnet prêt (POST JSON attendu)" });
}

export async function POST(request: Request, context: Ctx) {
  const { token } = await context.params;
  if (!(await findMeetMagnetWebhookByToken(token))) {
    return NextResponse.json({ error: "Webhook inconnu" }, { status: 404 });
  }

  const raw = await request.text();
  if (raw.length > MAX_BYTES) return NextResponse.json({ error: "Corps trop volumineux" }, { status: 413 });
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  try {
    const result = await processMeetMagnetPayload(payload);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof WebhookPayloadError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
