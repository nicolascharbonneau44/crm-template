import type { PersonCategory, PersonState, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isPersonCategory, isPersonState, resolveLifecycleUpdate } from "@/lib/labels";
import { parseCustomFields, stringifyCustomFields } from "@/lib/custom-columns";

export type ContactFilters = {
  q?: string;
  category?: string;
  state?: string;
  source?: string;
  email?: string;
  telephone?: string;
  poste?: string;
  companyId?: string;
};

export type ContactSort = {
  field: string;
  direction: "asc" | "desc";
};

const SORTABLE: Record<string, Prisma.ContactOrderByWithRelationInput> = {
  prenom: { prenom: "asc" },
  nom: { nom: "asc" },
  email: { email: "asc" },
  telephone: { telephone: "asc" },
  poste: { poste: "asc" },
  category: { category: "asc" },
  state: { state: "asc" },
  source: { source: "asc" },
  updatedAt: { updatedAt: "asc" },
  createdAt: { createdAt: "asc" },
  prochaineActionDate: { prochaineActionDate: "asc" },
  company: { company: { nom: "asc" } },
};

function buildWhere(filters: ContactFilters = {}): Prisma.ContactWhereInput {
  const where: Prisma.ContactWhereInput = {};
  const and: Prisma.ContactWhereInput[] = [];

  if (filters.q?.trim()) {
    const q = filters.q.trim();
    and.push({
      OR: [
        { prenom: { contains: q } },
        { nom: { contains: q } },
        { email: { contains: q } },
        { telephone: { contains: q } },
        { poste: { contains: q } },
        { company: { nom: { contains: q } } },
      ],
    });
  }
  if (filters.category && isPersonCategory(filters.category)) where.category = filters.category;
  if (filters.state && isPersonState(filters.state)) where.state = filters.state;
  if (filters.source?.trim()) and.push({ source: { contains: filters.source.trim() } });
  if (filters.email?.trim()) and.push({ email: { contains: filters.email.trim() } });
  if (filters.telephone?.trim()) and.push({ telephone: { contains: filters.telephone.trim() } });
  if (filters.poste?.trim()) and.push({ poste: { contains: filters.poste.trim() } });
  if (filters.companyId) where.companyId = filters.companyId;

  if (and.length) where.AND = and;
  return where;
}

function buildOrderBy(sorts: ContactSort[] = []): Prisma.ContactOrderByWithRelationInput[] {
  if (!sorts.length) return [{ updatedAt: "desc" }];
  return sorts
    .map((s) => {
      const base = SORTABLE[s.field];
      if (!base) return null;
      if (s.field === "company") return { company: { nom: s.direction } };
      return { [s.field]: s.direction } as Prisma.ContactOrderByWithRelationInput;
    })
    .filter(Boolean) as Prisma.ContactOrderByWithRelationInput[];
}

export async function listContacts(
  filters: ContactFilters = {},
  options: { sorts?: ContactSort[]; page?: number; pageSize?: number } = {},
) {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(1000, Math.max(1, options.pageSize ?? 25));
  const where = buildWhere(filters);
  const [total, data] = await Promise.all([
    prisma.contact.count({ where }),
    prisma.contact.findMany({
      where,
      include: { company: true },
      orderBy: buildOrderBy(options.sorts),
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return { data, total, page, pageSize };
}

export async function getContact(id: string) {
  return prisma.contact.findUnique({
    where: { id },
    include: {
      company: true,
      actions: { orderBy: [{ datePrevue: "asc" }, { createdAt: "desc" }] },
    },
  });
}

export type ContactInput = {
  prenom?: string;
  nom?: string;
  email?: string | null;
  telephone?: string | null;
  poste?: string | null;
  linkedinUrl?: string | null;
  description?: string | null;
  adresse?: string | null;
  pays?: string | null;
  source?: string | null;
  category?: PersonCategory;
  state?: PersonState;
  companyId?: string | null;
  prochaineActionTitre?: string | null;
  prochaineActionDate?: Date | null;
  customFields?: Record<string, unknown>;
};

function cleanOptional(value: string | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export async function createContact(input: ContactInput, changedById?: string) {
  const lifecycle = resolveLifecycleUpdate({
    currentState: "new_lead",
    currentCategory: "lead",
    requestedState: input.state,
    requestedCategory: input.category,
  });

  return prisma.$transaction(async (tx) => {
    const contact = await tx.contact.create({
      data: {
        prenom: input.prenom?.trim() ?? "",
        nom: input.nom?.trim() ?? "",
        email: cleanOptional(input.email) ?? null,
        telephone: cleanOptional(input.telephone) ?? null,
        poste: cleanOptional(input.poste) ?? null,
        linkedinUrl: cleanOptional(input.linkedinUrl) ?? null,
        description: cleanOptional(input.description) ?? null,
        adresse: cleanOptional(input.adresse) ?? null,
        pays: cleanOptional(input.pays) ?? null,
        source: cleanOptional(input.source) ?? null,
        category: lifecycle.category,
        state: lifecycle.state,
        companyId: input.companyId || null,
        prochaineActionTitre: cleanOptional(input.prochaineActionTitre) ?? null,
        prochaineActionDate: input.prochaineActionDate ?? null,
        customFields: stringifyCustomFields(input.customFields ?? {}),
      },
      include: { company: true },
    });

    await tx.contactStateHistory.create({
      data: {
        contactId: contact.id,
        previousState: null,
        newState: contact.state,
        previousCategory: null,
        newCategory: contact.category,
        changedById: changedById || null,
      },
    });

    return contact;
  });
}

export async function updateContact(id: string, input: ContactInput, changedById?: string) {
  const current = await prisma.contact.findUnique({ where: { id } });
  if (!current) return null;

  const lifecycle = resolveLifecycleUpdate({
    currentState: current.state,
    currentCategory: current.category,
    requestedState: input.state,
    requestedCategory: input.category,
  });

  const stateChanged = lifecycle.state !== current.state || lifecycle.category !== current.category;

  return prisma.$transaction(async (tx) => {
    const contact = await tx.contact.update({
      where: { id },
      data: {
        ...(input.prenom !== undefined ? { prenom: input.prenom.trim() } : {}),
        ...(input.nom !== undefined ? { nom: input.nom.trim() } : {}),
        ...(input.email !== undefined ? { email: cleanOptional(input.email) } : {}),
        ...(input.telephone !== undefined ? { telephone: cleanOptional(input.telephone) } : {}),
        ...(input.poste !== undefined ? { poste: cleanOptional(input.poste) } : {}),
        ...(input.linkedinUrl !== undefined ? { linkedinUrl: cleanOptional(input.linkedinUrl) } : {}),
        ...(input.description !== undefined ? { description: cleanOptional(input.description) } : {}),
        ...(input.adresse !== undefined ? { adresse: cleanOptional(input.adresse) } : {}),
        ...(input.pays !== undefined ? { pays: cleanOptional(input.pays) } : {}),
        ...(input.source !== undefined ? { source: cleanOptional(input.source) } : {}),
        ...(input.companyId !== undefined ? { companyId: input.companyId || null } : {}),
        ...(input.prochaineActionTitre !== undefined
          ? { prochaineActionTitre: cleanOptional(input.prochaineActionTitre) }
          : {}),
        ...(input.prochaineActionDate !== undefined
          ? { prochaineActionDate: input.prochaineActionDate }
          : {}),
        ...(input.customFields !== undefined
          ? {
              customFields: stringifyCustomFields({
                ...parseCustomFields(current.customFields),
                ...input.customFields,
              }),
            }
          : {}),
        category: lifecycle.category,
        state: lifecycle.state,
      },
      include: {
        company: true,
        actions: { orderBy: [{ datePrevue: "asc" }, { createdAt: "desc" }] },
      },
    });

    if (stateChanged) {
      await tx.contactStateHistory.create({
        data: {
          contactId: id,
          previousState: current.state,
          newState: lifecycle.state,
          previousCategory: current.category,
          newCategory: lifecycle.category,
          changedById: changedById || null,
        },
      });
    }

    return contact;
  });
}

export async function deleteContact(id: string) {
  return prisma.contact.delete({ where: { id } });
}

export async function bulkUpdateContacts(
  ids: string[],
  patch: { category?: PersonCategory; state?: PersonState },
  changedById?: string,
) {
  const results = [];
  for (const id of ids) {
    results.push(await updateContact(id, patch, changedById));
  }
  return results.filter(Boolean);
}

export async function bulkDeleteContacts(ids: string[]) {
  return prisma.contact.deleteMany({ where: { id: { in: ids } } });
}

export async function refreshContactNextAction(contactId: string) {
  const next = await prisma.action.findFirst({
    where: { contactId, statut: { not: "termine" } },
    orderBy: [{ datePrevue: "asc" }, { createdAt: "asc" }],
  });
  return prisma.contact.update({
    where: { id: contactId },
    data: {
      prochaineActionTitre: next?.titre ?? null,
      prochaineActionDate: next?.datePrevue ?? null,
    },
  });
}
