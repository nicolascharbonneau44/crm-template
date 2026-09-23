import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  WebhookPayloadError,
  regenerateMeetMagnetToken,
  updateMeetMagnetSettings,
} from "@/lib/webhooks/meetmagnet";

export async function PATCH(request: Request) {
  if (!(await getSessionUser())) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const webhook = await updateMeetMagnetSettings(body);
    return NextResponse.json({
      defaultCategory: webhook.defaultCategory,
      defaultState: webhook.defaultState,
      createTask: webhook.createTask,
    });
  } catch (error) {
    if (error instanceof WebhookPayloadError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

/** Génère une nouvelle URL secrète (l'ancienne cesse de fonctionner). */
export async function POST() {
  if (!(await getSessionUser())) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  await regenerateMeetMagnetToken();
  return NextResponse.json({ ok: true });
}
