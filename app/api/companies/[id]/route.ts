import { NextResponse } from "next/server";
import { deleteCompany, getCompany, updateCompany } from "@/lib/companies";
import { parseEffectif } from "@/lib/labels";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Ctx) {
  const { id } = await context.params;
  const company = await getCompany(id);
  if (!company) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  return NextResponse.json(company);
}

export async function PATCH(request: Request, context: Ctx) {
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const effectif = body.effectif === undefined ? undefined : parseEffectif(body.effectif);
  if (body.effectif !== undefined && effectif === undefined) {
    return NextResponse.json({ error: "Effectif invalide (nombre attendu)" }, { status: 400 });
  }
  try {
    const company = await updateCompany(id, {
      nom: body.nom,
      email: body.email,
      telephone: body.telephone,
      adresse: body.adresse,
      siteWeb: body.siteWeb,
      siret: body.siret,
      codeNaf: body.codeNaf,
      effectif,
      linkedinUrl: body.linkedinUrl,
      description: body.description,
      notes: body.notes,
      customFields:
        body.customFields && typeof body.customFields === "object" && !Array.isArray(body.customFields)
          ? (body.customFields as Record<string, unknown>)
          : undefined,
    });
    return NextResponse.json(company);
  } catch {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }
}

export async function DELETE(_request: Request, context: Ctx) {
  const { id } = await context.params;
  try {
    await deleteCompany(id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }
}
