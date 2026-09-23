import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ImportValidationError, runImport } from "@/lib/import/apply";

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const body = await request.json().catch(() => null);
  try {
    return NextResponse.json(await runImport(body, user.id));
  } catch (error) {
    if (error instanceof ImportValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
