import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { UserError, sendInvitation, updateUserName, userDisplayName } from "@/lib/users";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Ctx) {
  if (!(await getSessionUser())) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { fullName?: unknown };
  try {
    return NextResponse.json(await updateUserName(id, body.fullName));
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }
}

/** Nouveau lien d'invitation / de choix du mot de passe (l'ancien lien est annulé). */
export async function POST(request: Request, context: Ctx) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  const { id } = await context.params;
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, email: true, fullName: true } });
  if (!user) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  return NextResponse.json(await sendInvitation(user, userDisplayName(me), request.headers));
}
