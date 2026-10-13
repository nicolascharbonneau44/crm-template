import { NextResponse } from "next/server";
import { lookupApe } from "@/lib/company-ape";

/** Recherche du code APE d'une fiche société dans l'annuaire des entreprises (SIRENE). */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const result = await lookupApe({
    nom: searchParams.get("nom"),
    siret: searchParams.get("siret"),
    adresse: searchParams.get("adresse"),
  });
  return NextResponse.json(result);
}
