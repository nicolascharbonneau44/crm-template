import { NextResponse } from "next/server";
import { createSessionToken, getSessionUser, setSessionCookie } from "@/lib/auth";
import { PasswordError, changePassword } from "@/lib/password";

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { currentPassword?: unknown; newPassword?: unknown };
  try {
    const updated = await changePassword(user.id, body.currentPassword, body.newPassword);
    // Les autres sessions sont invalidées ; celle-ci reçoit un nouveau cookie.
    await setSessionCookie(await createSessionToken(updated));
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof PasswordError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
