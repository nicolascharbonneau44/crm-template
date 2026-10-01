import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createAction, listActions } from "@/lib/actions";
import type { ActionSort } from "@/lib/actions";
import { isActionChannel, isActionStatut, parseOptionalDate } from "@/lib/labels";
import { isDueFilter } from "@/lib/dates";
import { UserError, resolveUserRef } from "@/lib/users";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const me = await getSessionUser();
  let assigneeId: string | null | undefined;
  try {
    assigneeId = await resolveUserRef(searchParams.get("assignee") ?? undefined, me?.id ?? null);
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
  const due = searchParams.get("due");
  let sorts: ActionSort[] = [];
  const sortsRaw = searchParams.get("sorts");
  if (sortsRaw) {
    try {
      sorts = JSON.parse(sortsRaw) as ActionSort[];
    } catch {
      sorts = [];
    }
  }
  const result = await listActions(
    {
      q: searchParams.get("q") ?? undefined,
      channel: searchParams.get("channel") ?? undefined,
      statut: searchParams.get("statut") ?? undefined,
      contactCategory: searchParams.get("contactCategory") ?? undefined,
      contactId: searchParams.get("contactId") ?? undefined,
      titre: searchParams.get("titre") ?? undefined,
      assigneeId,
      due: isDueFilter(due) ? due : undefined,
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
  if (!isActionChannel(body.channel)) {
    return NextResponse.json({ error: "Canal invalide" }, { status: 400 });
  }
  if (body.statut !== undefined && !isActionStatut(body.statut)) {
    return NextResponse.json({ error: "Statut invalide" }, { status: 400 });
  }
  try {
    const assigneeId = await resolveUserRef(body.assigneeId, user?.id ?? null);
    const action = await createAction(
      {
        contactId: body.contactId,
        channel: body.channel,
        titre: body.titre,
        contenu: body.contenu,
        statut: isActionStatut(body.statut) ? body.statut : undefined,
        datePrevue: parseOptionalDate(body.datePrevue) ?? null,
        userId: assigneeId,
      },
      user?.id ?? null,
    );
    return NextResponse.json(action, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Création impossible" },
      { status: 400 },
    );
  }
}
