import type { ActionChannel, ActionStatut, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { refreshContactNextAction } from "@/lib/contacts";
import { isActionChannel, isActionStatut, isPersonCategory } from "@/lib/labels";
import { parseCustomFields, stringifyCustomFields } from "@/lib/custom-columns";

export type ActionFilters = {
  q?: string;
  channel?: string;
  statut?: string;
  contactCategory?: string;
  contactId?: string;
  companyId?: string;
  overdue?: boolean;
  titre?: string;
};

export type ActionSort = { field: string; direction: "asc" | "desc" };

function buildWhere(filters: ActionFilters = {}): Prisma.ActionWhereInput {
  const where: Prisma.ActionWhereInput = {};
  if (filters.contactId) where.contactId = filters.contactId;
  if (filters.channel && isActionChannel(filters.channel)) where.channel = filters.channel;
  if (filters.statut && isActionStatut(filters.statut)) where.statut = filters.statut;
  const contactWhere: Prisma.ContactWhereInput = {};
  if (filters.contactCategory && isPersonCategory(filters.contactCategory)) {
    contactWhere.category = filters.contactCategory;
  }
  if (filters.companyId) contactWhere.companyId = filters.companyId;
  if (Object.keys(contactWhere).length) where.contact = contactWhere;
  if (filters.overdue) {
    where.datePrevue = { lt: new Date() };
    if (!where.statut) where.statut = { not: "termine" };
  }
  if (filters.titre?.trim()) where.titre = { contains: filters.titre.trim() };
  if (filters.q?.trim()) {
    const q = filters.q.trim();
    where.OR = [
      { titre: { contains: q } },
      { contenu: { contains: q } },
      { contact: { prenom: { contains: q } } },
      { contact: { nom: { contains: q } } },
      { contact: { email: { contains: q } } },
    ];
  }
  return where;
}

function buildOrderBy(sorts: ActionSort[] = []): Prisma.ActionOrderByWithRelationInput[] {
  if (!sorts.length) return [{ datePrevue: "asc" }, { createdAt: "desc" }];
  return sorts.map((s) => {
    if (s.field === "contact") return { contact: { nom: s.direction } };
    return { [s.field]: s.direction } as Prisma.ActionOrderByWithRelationInput;
  });
}

export async function listActions(
  filters: ActionFilters = {},
  options: { sorts?: ActionSort[]; page?: number; pageSize?: number } = {},
) {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(1000, Math.max(1, options.pageSize ?? 25));
  const where = buildWhere(filters);
  const [total, data] = await Promise.all([
    prisma.action.count({ where }),
    prisma.action.findMany({
      where,
      include: {
        contact: { include: { company: true } },
        user: { select: { id: true, email: true, fullName: true } },
      },
      orderBy: buildOrderBy(options.sorts),
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return { data, total, page, pageSize };
}

export async function getAction(id: string) {
  return prisma.action.findUnique({
    where: { id },
    include: {
      contact: { include: { company: true } },
      user: { select: { id: true, email: true, fullName: true } },
    },
  });
}

export type ActionInput = {
  contactId?: string;
  channel?: ActionChannel;
  titre?: string;
  contenu?: string;
  statut?: ActionStatut;
  datePrevue?: Date | null;
  dateRealisation?: Date | null;
  userId?: string | null;
  customFields?: Record<string, unknown>;
};

export async function createAction(input: ActionInput) {
  if (!input.contactId) throw new Error("contactId requis");
  if (!input.channel) throw new Error("channel requis");
  if (!input.titre?.trim()) throw new Error("titre requis");

  const action = await prisma.action.create({
    data: {
      contactId: input.contactId,
      channel: input.channel,
      titre: input.titre.trim(),
      contenu: input.contenu?.trim() ?? "",
      statut: input.statut ?? "a_faire",
      datePrevue: input.datePrevue ?? null,
      dateRealisation: input.dateRealisation ?? null,
      userId: input.userId ?? null,
      customFields: stringifyCustomFields(input.customFields ?? {}),
    },
    include: {
      contact: { include: { company: true } },
      user: { select: { id: true, email: true, fullName: true } },
    },
  });
  await refreshContactNextAction(action.contactId);
  return action;
}

export async function updateAction(id: string, input: ActionInput) {
  const current = await prisma.action.findUnique({ where: { id } });
  if (!current) return null;

  let statut = input.statut;
  let dateRealisation = input.dateRealisation;
  if (statut === "termine" && dateRealisation === undefined) {
    dateRealisation = new Date();
  }
  if (statut && statut !== "termine" && dateRealisation === undefined) {
    dateRealisation = null;
  }

  const action = await prisma.action.update({
    where: { id },
    data: {
      ...(input.channel ? { channel: input.channel } : {}),
      ...(input.titre !== undefined ? { titre: input.titre.trim() } : {}),
      ...(input.contenu !== undefined ? { contenu: input.contenu } : {}),
      ...(statut ? { statut } : {}),
      ...(input.datePrevue !== undefined ? { datePrevue: input.datePrevue } : {}),
      ...(dateRealisation !== undefined ? { dateRealisation } : {}),
      ...(input.userId !== undefined ? { userId: input.userId } : {}),
      ...(input.customFields !== undefined
        ? {
            customFields: stringifyCustomFields({
              ...parseCustomFields(current.customFields),
              ...input.customFields,
            }),
          }
        : {}),
    },
    include: {
      contact: { include: { company: true } },
      user: { select: { id: true, email: true, fullName: true } },
    },
  });
  await refreshContactNextAction(action.contactId);
  return action;
}

export async function deleteAction(id: string) {
  const action = await prisma.action.delete({ where: { id } });
  await refreshContactNextAction(action.contactId);
  return action;
}

export async function bulkDeleteActions(ids: string[]) {
  const actions = await prisma.action.findMany({ where: { id: { in: ids } }, select: { id: true, contactId: true } });
  const result = await prisma.action.deleteMany({ where: { id: { in: ids } } });
  const contactIds = Array.from(new Set(actions.map((a) => a.contactId)));
  for (const contactId of contactIds) {
    await refreshContactNextAction(contactId);
  }
  return result;
}

export async function bulkUpdateActionStatut(ids: string[], statut: ActionStatut) {
  const dateRealisation = statut === "termine" ? new Date() : null;
  await prisma.action.updateMany({
    where: { id: { in: ids } },
    data: { statut, dateRealisation },
  });
  const actions = await prisma.action.findMany({ where: { id: { in: ids } }, select: { contactId: true } });
  for (const contactId of Array.from(new Set(actions.map((a) => a.contactId)))) {
    await refreshContactNextAction(contactId);
  }
  return { count: ids.length };
}

/** Compat MCP / anciens appels « note ». */
export async function addNote(contactId: string, titre: string, contenu = "") {
  return createAction({
    contactId,
    channel: "note",
    titre,
    contenu,
    statut: "termine",
    dateRealisation: new Date(),
  });
}
