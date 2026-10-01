import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { UserError, createUser, listUsers, userDisplayName } from "@/lib/users";

export async function GET() {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  return NextResponse.json({ data: await listUsers(), currentUserId: me.id });
}

export async function POST(request: Request) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const result = await createUser(body as { email: unknown; fullName: unknown }, userDisplayName(me), request.headers);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
