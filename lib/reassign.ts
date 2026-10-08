import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildWhere, type ContactFilters } from "@/lib/contacts";
import { contactDisplayName } from "@/lib/labels";
import { userDisplayName } from "@/lib/users";

export type ReassignSelection = ContactFilters & {
  ids?: string[];
  createdFrom?: Date;
  createdTo?: Date;
};

export function hasSelection(selection: ReassignSelection) {
  return Object.values(selection).some((v) => v !== undefined && !(Array.isArray(v) && v.length === 0));
}

/**
 * Change le responsable de tous les contacts sélectionnés. Les relances non terminées qui
 * étaient assignées à l'ancien responsable suivent le contact (si moveOpenActions).
 */
export async function reassignContacts(selection: ReassignSelection, newOwnerId: string | null, moveOpenActions = true) {
  const { ids, createdFrom, createdTo, ...filters } = selection;
  const where: Prisma.ContactWhereInput = buildWhere(filters);
  const and: Prisma.ContactWhereInput[] = where.AND ? [where.AND].flat() : [];
  if (ids?.length) and.push({ id: { in: ids } });
  if (createdFrom || createdTo) and.push({ createdAt: { ...(createdFrom ? { gte: createdFrom } : {}), ...(createdTo ? { lte: createdTo } : {}) } });
  if (and.length) where.AND = and;

  const matched = await prisma.contact.findMany({
    where,
    select: { id: true, prenom: true, nom: true, ownerId: true, owner: { select: { id: true, email: true, fullName: true } } },
    orderBy: [{ nom: "asc" }, { prenom: "asc" }],
  });
  const toChange = matched.filter((c) => (c.ownerId ?? null) !== newOwnerId);

  let actionsMoved = 0;
  if (toChange.length) {
    await prisma.$transaction(async (tx) => {
      await tx.contact.updateMany({ where: { id: { in: toChange.map((c) => c.id) } }, data: { ownerId: newOwnerId } });
      if (!moveOpenActions) return;
      const byPreviousOwner = new Map<string | null, string[]>();
      for (const c of toChange) byPreviousOwner.set(c.ownerId, [...(byPreviousOwner.get(c.ownerId) ?? []), c.id]);
      for (const [previousOwnerId, contactIds] of byPreviousOwner) {
        const result = await tx.action.updateMany({
          where: { contactId: { in: contactIds }, statut: { not: "termine" }, userId: previousOwnerId },
          data: { userId: newOwnerId },
        });
        actionsMoved += result.count;
      }
    });
  }

  const previousOwners: Record<string, number> = {};
  for (const c of toChange) {
    const label = c.owner ? userDisplayName(c.owner) : "Non attribué";
    previousOwners[label] = (previousOwners[label] ?? 0) + 1;
  }

  return {
    contactsSelectionnes: matched.length,
    contactsModifies: toChange.length,
    dejaAttribues: matched.length - toChange.length,
    relancesTransferees: actionsMoved,
    anciensResponsables: previousOwners,
    contacts: toChange.slice(0, 100).map((c) => ({ id: c.id, nom: contactDisplayName(c) })),
    ...(toChange.length > 100 ? { autres: toChange.length - 100 } : {}),
  };
}
