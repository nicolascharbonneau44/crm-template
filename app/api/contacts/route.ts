import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createContact, listContacts } from "@/lib/contacts";
import { isPersonCategory, isPersonState, normalizeCivilite, parseOptionalDate } from "@/lib/labels";
import type { ContactSort } from "@/lib/contacts";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sortsRaw = searchParams.get("sorts");
  let sorts: ContactSort[] = [];
  if (sortsRaw) {
    try {
      sorts = JSON.parse(sortsRaw) as ContactSort[];
    } catch {
      sorts = [];
    }
  }

  const result = await listContacts(
    {
      q: searchParams.get("q") ?? undefined,
      category: searchParams.get("category") ?? undefined,
      state: searchParams.get("state") ?? undefined,
      source: searchParams.get("source") ?? undefined,
      email: searchParams.get("email") ?? undefined,
      telephone: searchParams.get("telephone") ?? undefined,
      poste: searchParams.get("poste") ?? undefined,
      civilite: searchParams.get("civilite") ?? undefined,
    },
    {
      sorts,
      page: Number(searchParams.get("page") ?? 1),
      pageSize: Number(searchParams.get("pageSize") ?? 25),
    },
  );
  return NextResponse.json(result);
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  const body = await request.json().catch(() => ({}));
  const prenom = String(body.prenom ?? "").trim();
  const nom = String(body.nom ?? "").trim();
  if (!prenom && !nom) {
    return NextResponse.json({ error: "Prénom ou nom requis" }, { status: 400 });
  }

  const category = body.category;
  const state = body.state;
  if (category !== undefined && category !== null && category !== "" && !isPersonCategory(category)) {
    return NextResponse.json({ error: "Catégorie invalide" }, { status: 400 });
  }
  if (state !== undefined && state !== null && state !== "" && !isPersonState(state)) {
    return NextResponse.json({ error: "État invalide" }, { status: 400 });
  }
  const civilite = normalizeCivilite(body.civilite);
  if (civilite === undefined) {
    return NextResponse.json({ error: "Civilité invalide (Monsieur ou Madame)" }, { status: 400 });
  }

  const contact = await createContact(
    {
      civilite,
      prenom,
      nom,
      email: body.email ?? null,
      telephone: body.telephone ?? null,
      poste: body.poste ?? null,
      linkedinUrl: body.linkedinUrl ?? null,
      description: body.description ?? null,
      adresse: body.adresse ?? null,
      pays: body.pays ?? null,
      source: body.source ?? null,
      category: isPersonCategory(category) ? category : undefined,
      state: isPersonState(state) ? state : undefined,
      companyId: body.companyId || null,
      prochaineActionTitre: body.prochaineActionTitre ?? null,
      prochaineActionDate: parseOptionalDate(body.prochaineActionDate) ?? null,
      customFields:
        body.customFields && typeof body.customFields === "object" && !Array.isArray(body.customFields)
          ? (body.customFields as Record<string, unknown>)
          : undefined,
    },
    user?.id,
  );

  return NextResponse.json(contact, { status: 201 });
}
