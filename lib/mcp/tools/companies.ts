import { prisma } from "@/lib/prisma";
import {
  createCompany,
  deleteCompany,
  getCompany,
  listCompanies,
  updateCompany,
  type CompanyInput,
} from "@/lib/companies";
import {
  ToolError,
  customFieldsArg,
  customFieldsSchema,
  nullableString,
  normalizeName,
  optionalBoolean,
  optionalString,
  pagination,
  paginationSchema,
  requireString,
  type McpTool,
  type ToolArgs,
} from "@/lib/mcp/types";

const companyFields = {
  nom: { type: "string", description: "Raison sociale / nom de l'entreprise" },
  email: { type: ["string", "null"] },
  telephone: { type: ["string", "null"] },
  adresse: { type: ["string", "null"] },
  siteWeb: { type: ["string", "null"], description: "URL du site web" },
  siret: { type: ["string", "null"] },
  linkedinUrl: { type: ["string", "null"] },
  description: { type: ["string", "null"] },
  notes: { type: ["string", "null"], description: "Notes internes" },
  customFields: customFieldsSchema,
};

export async function findCompanyByName(name: string) {
  const exact = await prisma.company.findFirst({ where: { nom: name.trim() }, select: { id: true, nom: true } });
  if (exact) return exact;
  const target = normalizeName(name);
  const all = await prisma.company.findMany({ select: { id: true, nom: true } });
  return all.find((c) => normalizeName(c.nom) === target) ?? null;
}

/**
 * Règle CRM : un contact appartient à 0 ou 1 entreprise.
 * companyId (prioritaire) ou companyName (recherche par nom, création si absente).
 */
export async function resolveCompanyLink(args: ToolArgs) {
  if ("companyId" in args && args.companyId !== undefined) {
    if (args.companyId === null || args.companyId === "") return { companyId: null as string | null };
    if (typeof args.companyId !== "string") throw new ToolError("« companyId » doit être une chaîne ou null.");
    const company = await prisma.company.findUnique({ where: { id: args.companyId }, select: { id: true } });
    if (!company) throw new ToolError(`Entreprise introuvable (companyId ${args.companyId}). Utilisez search_companies.`);
    return { companyId: company.id };
  }

  const companyName = optionalString(args, "companyName")?.trim();
  if (!companyName) return { companyId: undefined };

  const existing = await findCompanyByName(companyName);
  if (existing) return { companyId: existing.id };
  const created = await createCompany({ nom: companyName });
  return { companyId: created.id, createdCompany: { id: created.id, nom: created.nom } };
}

async function companyInput(args: ToolArgs): Promise<CompanyInput> {
  return {
    nom: optionalString(args, "nom"),
    email: nullableString(args, "email"),
    telephone: nullableString(args, "telephone"),
    adresse: nullableString(args, "adresse"),
    siteWeb: nullableString(args, "siteWeb"),
    siret: nullableString(args, "siret"),
    linkedinUrl: nullableString(args, "linkedinUrl"),
    description: nullableString(args, "description"),
    notes: nullableString(args, "notes"),
    customFields: await customFieldsArg(args, "company"),
  };
}

async function requireCompany(id: string) {
  const company = await prisma.company.findUnique({ where: { id }, select: { id: true } });
  if (!company) throw new ToolError(`Entreprise introuvable (id ${id}).`);
}

export const companyTools: McpTool[] = [
  {
    name: "search_companies",
    title: "Rechercher des entreprises",
    kind: "read",
    description:
      "Recherche les entreprises (nom, email, site web, SIRET). Renvoie aussi le nombre de contacts rattachés. Sans filtre, liste toutes les entreprises par ordre alphabétique.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Texte recherché" },
        ...paginationSchema,
      },
    },
    async handler(args) {
      const { page, pageSize } = pagination(args);
      const result = await listCompanies({ q: optionalString(args, "query") }, { page, pageSize });
      return {
        total: result.total,
        page,
        pageSize,
        companies: result.data.map(({ _count, ...company }) => ({ ...company, contactsCount: _count.contacts })),
      };
    },
  },
  {
    name: "get_company",
    title: "Fiche entreprise",
    kind: "read",
    description:
      "Renvoie la fiche complète d'une entreprise avec ses contacts et les 20 dernières actions de ces contacts.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Identifiant de l'entreprise" } },
      required: ["id"],
    },
    async handler(args) {
      const id = requireString(args, "id");
      const company = await getCompany(id);
      if (!company) throw new ToolError(`Entreprise introuvable (id ${id}).`);
      const recentActions = await prisma.action.findMany({
        where: { contact: { companyId: id } },
        orderBy: { updatedAt: "desc" },
        take: 20,
        include: { contact: { select: { id: true, prenom: true, nom: true } } },
      });
      return { ...company, recentActions };
    },
  },
  {
    name: "create_company",
    title: "Créer une entreprise",
    kind: "write",
    description:
      "Crée une entreprise. Refuse si une entreprise du même nom existe déjà (renvoie son id), sauf allowDuplicate=true. Pour rattacher des contacts, utilisez ensuite update_contact avec companyId.",
    inputSchema: {
      type: "object",
      properties: {
        ...companyFields,
        allowDuplicate: { type: "boolean", description: "Créer même si le nom existe déjà" },
      },
      required: ["nom"],
    },
    async handler(args) {
      const nom = requireString(args, "nom");
      if (!optionalBoolean(args, "allowDuplicate")) {
        const existing = await findCompanyByName(nom);
        if (existing) {
          throw new ToolError(
            `L'entreprise « ${existing.nom} » existe déjà (id ${existing.id}). Utilisez update_company, ou allowDuplicate=true.`,
          );
        }
      }
      return createCompany({ ...(await companyInput(args)), nom });
    },
  },
  {
    name: "update_company",
    title: "Modifier une entreprise",
    kind: "write",
    description:
      "Modifie une entreprise. Seuls les champs fournis sont changés ; null vide un champ. customFields fusionne avec les valeurs existantes.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, ...companyFields },
      required: ["id"],
    },
    async handler(args) {
      const id = requireString(args, "id");
      await requireCompany(id);
      const input = await companyInput(args);
      if (input.nom !== undefined && !input.nom.trim()) throw new ToolError("Le nom ne peut pas être vide.");
      return updateCompany(id, input);
    },
  },
  {
    name: "delete_company",
    title: "Supprimer une entreprise",
    kind: "delete",
    description:
      "Supprime définitivement une entreprise. Ses contacts ne sont PAS supprimés : ils sont détachés (companyId vide).",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
    async handler(args) {
      const id = requireString(args, "id");
      await requireCompany(id);
      const detached = await prisma.contact.count({ where: { companyId: id } });
      const company = await deleteCompany(id);
      return { deleted: true, id: company.id, nom: company.nom, contactsDetaches: detached };
    },
  },
];
