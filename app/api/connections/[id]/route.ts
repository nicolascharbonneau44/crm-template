import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { revokeConnection } from "@/lib/oauth";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, context: Ctx) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  const { id } = await context.params;
  if (!(await revokeConnection(id))) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
