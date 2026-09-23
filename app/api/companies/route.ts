import { NextResponse } from "next/server";
import { createCompany, listCompanies } from "@/lib/companies";
import type { CompanySort } from "@/lib/companies";
import { parseEffectif } from "@/lib/labels";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  let sorts: CompanySort[] = [];
  const sortsRaw = searchParams.get("sorts");
  if (sortsRaw) {
    try {
      sorts = JSON.parse(sortsRaw) as CompanySort[];
    } catch {
      sorts = [];
    }
  }
  const result = await listCompanies(
    {
      q: searchParams.get("q") ?? undefined,
      email: searchParams.get("email") ?? undefined,
      siteWeb: searchParams.get("siteWeb") ?? undefined,
      siret: searchParams.get("siret") ?? undefined,
      codeNaf: searchParams.get("codeNaf") ?? undefined,
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
  const body = await request.json().catch(() => ({}));
  const effectif = parseEffectif(body.effectif);
  if (effectif === undefined) {
    return NextResponse.json({ error: "Effectif invalide (nombre attendu)" }, { status: 400 });
  }
  try {
    const company = await createCompany({
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
    return NextResponse.json(company, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Création impossible" },
      { status: 400 },
    );
  }
}
