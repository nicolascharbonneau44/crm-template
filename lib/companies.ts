import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseCustomFields, stringifyCustomFields } from "@/lib/custom-columns";

export type CompanyFilters = {
  q?: string;
  email?: string;
  siteWeb?: string;
  siret?: string;
  codeNaf?: string;
};

export type CompanySort = { field: string; direction: "asc" | "desc" };

function buildWhere(filters: CompanyFilters = {}): Prisma.CompanyWhereInput {
  const where: Prisma.CompanyWhereInput = {};
  const and: Prisma.CompanyWhereInput[] = [];
  if (filters.q?.trim()) {
    const query = filters.q.trim();
    and.push({
      OR: [
        { nom: { contains: query } },
        { email: { contains: query } },
        { siteWeb: { contains: query } },
        { siret: { contains: query } },
        { codeNaf: { contains: query } },
      ],
    });
  }
  if (filters.email?.trim()) and.push({ email: { contains: filters.email.trim() } });
  if (filters.siteWeb?.trim()) and.push({ siteWeb: { contains: filters.siteWeb.trim() } });
  if (filters.siret?.trim()) and.push({ siret: { contains: filters.siret.trim() } });
  if (filters.codeNaf?.trim()) and.push({ codeNaf: { contains: filters.codeNaf.trim() } });
  if (and.length) where.AND = and;
  return where;
}

function buildOrderBy(sorts: CompanySort[] = []): Prisma.CompanyOrderByWithRelationInput[] {
  if (!sorts.length) return [{ nom: "asc" }];
  return sorts.map((s) => {
    if (s.field === "contactsCount") return { contacts: { _count: s.direction } };
    return { [s.field]: s.direction } as Prisma.CompanyOrderByWithRelationInput;
  });
}

export async function listCompanies(
  filters: CompanyFilters | string = {},
  options: { sorts?: CompanySort[]; page?: number; pageSize?: number } = {},
) {
  const normalized: CompanyFilters = typeof filters === "string" ? { q: filters } : filters;
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(1000, Math.max(1, options.pageSize ?? 25));
  const where = buildWhere(normalized);
  const [total, data] = await Promise.all([
    prisma.company.count({ where }),
    prisma.company.findMany({
      where,
      include: { _count: { select: { contacts: true } } },
      orderBy: buildOrderBy(options.sorts),
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return { data, total, page, pageSize };
}

export async function getCompany(id: string) {
  return prisma.company.findUnique({
    where: { id },
    include: {
      contacts: { orderBy: [{ nom: "asc" }, { prenom: "asc" }] },
    },
  });
}

export type CompanyInput = {
  nom?: string;
  email?: string | null;
  telephone?: string | null;
  adresse?: string | null;
  siteWeb?: string | null;
  siret?: string | null;
  codeNaf?: string | null;
  effectif?: number | null;
  linkedinUrl?: string | null;
  description?: string | null;
  notes?: string | null;
  customFields?: Record<string, unknown>;
};

function cleanOptional(value: string | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export async function createCompany(input: CompanyInput) {
  const nom = input.nom?.trim();
  if (!nom) throw new Error("Le nom est requis");
  return prisma.company.create({
    data: {
      nom,
      email: cleanOptional(input.email) ?? null,
      telephone: cleanOptional(input.telephone) ?? null,
      adresse: cleanOptional(input.adresse) ?? null,
      siteWeb: cleanOptional(input.siteWeb) ?? null,
      siret: cleanOptional(input.siret) ?? null,
      codeNaf: cleanOptional(input.codeNaf)?.toUpperCase() ?? null,
      effectif: input.effectif ?? null,
      linkedinUrl: cleanOptional(input.linkedinUrl) ?? null,
      description: cleanOptional(input.description) ?? null,
      notes: cleanOptional(input.notes) ?? null,
      customFields: stringifyCustomFields(input.customFields ?? {}),
    },
  });
}

export async function updateCompany(id: string, input: CompanyInput) {
  const current = await prisma.company.findUnique({ where: { id } });
  if (!current) throw new Error("Introuvable");
  return prisma.company.update({
    where: { id },
    data: {
      ...(input.nom !== undefined ? { nom: input.nom.trim() } : {}),
      ...(input.email !== undefined ? { email: cleanOptional(input.email) } : {}),
      ...(input.telephone !== undefined ? { telephone: cleanOptional(input.telephone) } : {}),
      ...(input.adresse !== undefined ? { adresse: cleanOptional(input.adresse) } : {}),
      ...(input.siteWeb !== undefined ? { siteWeb: cleanOptional(input.siteWeb) } : {}),
      ...(input.siret !== undefined ? { siret: cleanOptional(input.siret) } : {}),
      ...(input.codeNaf !== undefined ? { codeNaf: cleanOptional(input.codeNaf)?.toUpperCase() ?? null } : {}),
      ...(input.effectif !== undefined ? { effectif: input.effectif } : {}),
      ...(input.linkedinUrl !== undefined ? { linkedinUrl: cleanOptional(input.linkedinUrl) } : {}),
      ...(input.description !== undefined ? { description: cleanOptional(input.description) } : {}),
      ...(input.notes !== undefined ? { notes: cleanOptional(input.notes) } : {}),
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
      contacts: { orderBy: [{ nom: "asc" }, { prenom: "asc" }] },
    },
  });
}

export async function deleteCompany(id: string) {
  return prisma.company.delete({ where: { id } });
}

export async function bulkDeleteCompanies(ids: string[]) {
  return prisma.company.deleteMany({ where: { id: { in: ids } } });
}
