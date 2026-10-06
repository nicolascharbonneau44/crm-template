import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { deleteContact, getContact, updateContact } from "@/lib/contacts";
import { isPersonCategory, isPersonState, normalizeCivilite, parseOptionalDate, parseYesNo } from "@/lib/labels";
import { UserError, resolveUserRef } from "@/lib/users";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Ctx) {
  const { id } = await context.params;
  const contact = await getContact(id);
  if (!contact) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  return NextResponse.json(contact);
}

export async function PATCH(request: Request, context: Ctx) {
  const { id } = await context.params;
  const user = await getSessionUser();
  const body = await request.json().catch(() => ({}));

  if (body.category !== undefined && body.category !== null && body.category !== "" && !isPersonCategory(body.category)) {
    return NextResponse.json({ error: "Catégorie invalide" }, { status: 400 });
  }
  if (body.state !== undefined && body.state !== null && body.state !== "" && !isPersonState(body.state)) {
    return NextResponse.json({ error: "État invalide" }, { status: 400 });
  }
  const civilite = body.civilite === undefined ? undefined : normalizeCivilite(body.civilite);
  if (body.civilite !== undefined && civilite === undefined) {
    return NextResponse.json({ error: "Civilité invalide (Monsieur ou Madame)" }, { status: 400 });
  }
  let ownerId: string | null | undefined;
  try {
    ownerId = await resolveUserRef(body.ownerId, user?.id ?? null);
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }

  const contact = await updateContact(
    id,
    {
      ownerId,
      newsletter: body.newsletter === undefined ? undefined : parseYesNo(body.newsletter),
      civilite,
      prenom: body.prenom,
      nom: body.nom,
      email: body.email,
      telephone: body.telephone,
      poste: body.poste,
      linkedinUrl: body.linkedinUrl,
      description: body.description,
      adresse: body.adresse,
      pays: body.pays,
      source: body.source,
      category: isPersonCategory(body.category) ? body.category : undefined,
      state: isPersonState(body.state) ? body.state : undefined,
      companyId: body.companyId,
      prochaineActionTitre: body.prochaineActionTitre,
      prochaineActionDate:
        body.prochaineActionDate !== undefined ? parseOptionalDate(body.prochaineActionDate) ?? null : undefined,
      customFields:
        body.customFields && typeof body.customFields === "object" && !Array.isArray(body.customFields)
          ? (body.customFields as Record<string, unknown>)
          : undefined,
    },
    user?.id,
  );

  if (!contact) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  return NextResponse.json(contact);
}

export async function DELETE(_request: Request, context: Ctx) {
  const { id } = await context.params;
  try {
    await deleteContact(id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }
}
