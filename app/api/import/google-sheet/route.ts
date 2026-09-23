import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";

const MAX_BYTES = 10 * 1024 * 1024;

/** Lit une feuille Google Sheets partagée « toute personne disposant du lien » et renvoie son CSV. */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { url?: unknown };
  const url = typeof body.url === "string" ? body.url.trim() : "";
  const id = url.match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/)?.[1];
  if (!id) {
    return NextResponse.json(
      { error: "Collez le lien d'une feuille Google Sheets (https://docs.google.com/spreadsheets/d/…)." },
      { status: 400 },
    );
  }
  const gid = url.match(/[#&?]gid=(\d+)/)?.[1];
  const exportUrl = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gid ? `&gid=${gid}` : ""}`;

  const response = await fetch(exportUrl, { redirect: "follow", signal: AbortSignal.timeout(15000) }).catch(() => null);
  const type = response?.headers.get("content-type") ?? "";
  if (!response?.ok || !type.includes("text/csv")) {
    return NextResponse.json(
      {
        error:
          "Feuille inaccessible. Dans Google Sheets : Partager → Accès général → « Tous les utilisateurs disposant du lien », puis réessayez.",
      },
      { status: 400 },
    );
  }
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES) {
    return NextResponse.json({ error: "Feuille trop volumineuse (10 Mo max)." }, { status: 400 });
  }
  const text = await response.text();
  if (text.length > MAX_BYTES) {
    return NextResponse.json({ error: "Feuille trop volumineuse (10 Mo max)." }, { status: 400 });
  }
  return NextResponse.json({ csv: text });
}
