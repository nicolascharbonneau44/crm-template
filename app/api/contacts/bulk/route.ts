import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { bulkDeleteContacts, bulkUpdateContacts } from "@/lib/contacts";
import { reassignContacts } from "@/lib/reassign";
import { isPersonCategory, isPersonState, parseYesNo } from "@/lib/labels";
import { UserError, resolveUserRef } from "@/lib/users";

export async function POST(request: Request) {
  const user = await getSessionUser();
  const body = await request.json().catch(() => ({}));
  const ids = Array.isArray(body.ids) ? body.ids.filter((id: unknown) => typeof id === "string") : [];
  if (!ids.length) {
    return NextResponse.json({ error: "Aucun contact sélectionné" }, { status: 400 });
  }

  const action = String(body.action ?? "");
  if (action === "delete") {
    const result = await bulkDeleteContacts(ids);
    return NextResponse.json({ ok: true, count: result.count });
  }

  if (action === "update") {
    const patch: { category?: never; state?: never } = {};
    if (body.category !== undefined && body.category !== "") {
      if (!isPersonCategory(body.category)) {
        return NextResponse.json({ error: "Catégorie invalide" }, { status: 400 });
      }
      (patch as { category?: string }).category = body.category;
    }
    if (body.state !== undefined && body.state !== "") {
      if (!isPersonState(body.state)) {
        return NextResponse.json({ error: "État invalide" }, { status: 400 });
      }
      (patch as { state?: string }).state = body.state;
    }
    if (body.ownerId !== undefined && body.ownerId !== "") {
      try {
        (patch as { ownerId?: string | null }).ownerId = (await resolveUserRef(body.ownerId, user?.id ?? null)) ?? null;
      } catch (error) {
        if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
        throw error;
      }
    }
    const newsletter = body.newsletter === undefined || body.newsletter === "" ? undefined : parseYesNo(body.newsletter);
    if (newsletter !== undefined) (patch as { newsletter?: boolean }).newsletter = newsletter;
    if (!("category" in patch) && !("state" in patch) && !("ownerId" in patch) && !("newsletter" in patch)) {
      return NextResponse.json({ error: "Rien à modifier" }, { status: 400 });
    }
    // Le responsable passe par reassignContacts : les relances en cours suivent le contact.
    let actionsMoved = 0;
    if ("ownerId" in patch) {
      const { ownerId } = patch as { ownerId?: string | null };
      actionsMoved = (await reassignContacts({ ids }, ownerId ?? null)).relancesTransferees;
      delete (patch as { ownerId?: unknown }).ownerId;
    }
    const updated = Object.keys(patch).length ? await bulkUpdateContacts(ids, patch as never, user?.id) : ids;
    return NextResponse.json({ ok: true, count: updated.length, actionsMoved });
  }

  return NextResponse.json({ error: "Action inconnue" }, { status: 400 });
}
