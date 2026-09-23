import { NextResponse } from "next/server";
import { PasswordError, resetPassword } from "@/lib/password";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { token?: unknown; password?: unknown };
  try {
    await resetPassword(body.token, body.password);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof PasswordError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
