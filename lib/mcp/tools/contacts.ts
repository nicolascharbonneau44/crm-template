import type { Contact, Company } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createContact, deleteContact, listContacts, updateContact, type ContactInput } from "@/lib/contacts";
import { PERSON_CATEGORIES, PERSON_STATES } from "@/lib/labels";
import { resolveCompanyLink } from "@/lib/mcp/tools/companies";
import {
  ToolError,
  customFieldsArg,
  customFieldsSchema,
  nullableDate,
  nullableString,
  optionalBoolean,
  optionalEnum,
  optionalString,
  pagination,
  paginationSchema,
  requireString,
  type McpTool,
  type ToolArgs,
} from "@/lib/mcp/types";

const contactFields = {
  prenom: { type: "string" },
  nom: { type: "string" },
  email: { type: ["string", "null"] },
  telephone: { type: ["string", "null"] },
  poste: { type: ["string", "null"], description: "Fonction / poste occupé" },
  linkedinUrl: { type: ["string", "null"] },
  description: { type: ["string", "null"] },
  adresse: { type: ["string", "null"] },
  pays: { type: ["string", "null"] },
  source: { type: ["string", "null"], description: "Origine du contact (salon, site, recommandation…)" },
  category: {
    type: "string",
    enum: PERSON_CATEGORIES,
    description: "Catégorie. Si seul category change, l'état passe à l'état par défaut de la catégorie.",
  },
  state: {
    type: "string",
    enum: PERSON_STATES,
    description: "État dans le cycle de vie. La catégorie est alors déduite automatiquement (voir get_crm_schema).",
  },
  companyId: {
    type: ["string", "null"],
    description: "Rattache le contact à cette entreprise (null pour le détacher). Prioritaire sur companyName.",
  },
  companyName: {
    type: "string",
    description: "Rattache le contact à l'entreprise de ce nom, créée automatiquement si elle n'existe pas.",
  },
  prochaineActionTitre: { type: ["string", "null"] },
  prochaineActionDate: { type: ["string", "null"], description: "Date ISO 8601" },
  customFields: customFieldsSchema,
};

export function contactSummary(contact: Contact & { company?: Pick<Company, "id" | "nom"> | null }) {
  return {
    id: contact.id,
    prenom: contact.prenom,
    nom: contact.nom,
    email: contact.email,
    telephone: contact.telephone,
    poste: contact.poste,
    category: contact.category,
    state: contact.state,
    source: contact.source,
    company: contact.company ? { id: contact.company.id, nom: contact.company.nom } : null,
    prochaineActionTitre: contact.prochaineActionTitre,
    prochaineActionDate: contact.prochaineActionDate,
    customFields: contact.customFields,
    updatedAt: contact.updatedAt,
  };
}

async function contactInput(args: ToolArgs): Promise<ContactInput> {
  return {
    prenom: optionalString(args, "prenom"),
    nom: optionalString(args, "nom"),
    email: nullableString(args, "email"),
    telephone: nullableString(args, "telephone"),
    poste: nullableString(args, "poste"),
    linkedinUrl: nullableString(args, "linkedinUrl"),
    description: nullableString(args, "description"),
    adresse: nullableString(args, "adresse"),
    pays: nullableString(args, "pays"),
    source: nullableString(args, "source"),
    category: optionalEnum(args, "category", PERSON_CATEGORIES),
    state: optionalEnum(args, "state", PERSON_STATES),
    prochaineActionTitre: nullableString(args, "prochaineActionTitre"),
    prochaineActionDate: nullableDate(args, "prochaineActionDate"),
    customFields: await customFieldsArg(args, "contact"),
  };
}

async function findContactByEmail(email: string, excludeId?: string) {
  return prisma.contact.findFirst({
    where: { email: email.trim(), ...(excludeId ? { NOT: { id: excludeId } } : {}) },
    select: { id: true, prenom: true, nom: true },
  });
}

export const contactTools: McpTool[] = [
  {
    name: "search_contacts",
    title: "Rechercher des contacts",
    kind: "read",
    description:
      "Recherche les contacts (prénom, nom, email, téléphone, poste, nom d'entreprise) avec filtres optionnels. Sans filtre, liste les contacts les plus récemment modifiés.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Texte recherché" },
        category: { type: "string", enum: PERSON_CATEGORIES },
        state: { type: "string", enum: PERSON_STATES },
        companyId: { type: "string", description: "Uniquement les contacts de cette entreprise" },
        source: { type: "string" },
        ...paginationSchema,
      },
    },
    async handler(args) {
      const { page, pageSize } = pagination(args);
      const result = await listContacts(
        {
          q: optionalString(args, "query"),
          category: optionalEnum(args, "category", PERSON_CATEGORIES),
          state: optionalEnum(args, "state", PERSON_STATES),
          companyId: optionalString(args, "companyId"),
          source: optionalString(args, "source"),
        },
        { page, pageSize },
      );
      return { total: result.total, page, pageSize, contacts: result.data.map(contactSummary) };
    },
  },
  {
    name: "get_contact",
    title: "Fiche contact",
    kind: "read",
    description:
      "Renvoie la fiche complète d'un contact : entreprise, toutes ses actions et l'historique de ses changements d'état.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Identifiant du contact" } },
      required: ["id"],
    },
    async handler(args) {
      const id = requireString(args, "id");
      const contact = await prisma.contact.findUnique({
        where: { id },
        include: {
          company: true,
          actions: { orderBy: [{ datePrevue: "asc" }, { createdAt: "desc" }] },
          stateHistory: { orderBy: { createdAt: "desc" }, take: 20 },
        },
      });
      if (!contact) throw new ToolError(`Contact introuvable (id ${id}).`);
      return contact;
    },
  },
  {
    name: "create_contact",
    title: "Créer un contact",
    kind: "write",
    description:
      "Crée un contact (prénom ou nom requis). Rattachement à une entreprise via companyId, ou companyName (créée si besoin). Refuse si l'email existe déjà (renvoie l'id existant), sauf allowDuplicate=true. Sans état ni catégorie : lead / new_lead.",
    inputSchema: {
      type: "object",
      properties: {
        ...contactFields,
        allowDuplicate: { type: "boolean", description: "Créer même si l'email existe déjà" },
      },
    },
    async handler(args, ctx) {
      const input = await contactInput(args);
      if (!input.prenom?.trim() && !input.nom?.trim()) throw new ToolError("Prénom ou nom requis.");
      if (input.email?.trim() && !optionalBoolean(args, "allowDuplicate")) {
        const existing = await findContactByEmail(input.email);
        if (existing) {
          throw new ToolError(
            `Un contact avec cet email existe déjà : ${existing.prenom} ${existing.nom} (id ${existing.id}). Utilisez update_contact, ou allowDuplicate=true.`,
          );
        }
      }
      const link = await resolveCompanyLink(args);
      const contact = await createContact({ ...input, companyId: link.companyId ?? null }, ctx.userId ?? undefined);
      return { contact: contactSummary(contact), ...(link.createdCompany ? { entrepriseCreee: link.createdCompany } : {}) };
    },
  },
  {
    name: "update_contact",
    title: "Modifier un contact",
    kind: "write",
    description:
      "Modifie un contact : coordonnées, état/catégorie (historisés), entreprise (companyId, null pour détacher, ou companyName), colonnes personnalisées. Seuls les champs fournis sont changés ; null vide un champ.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, ...contactFields },
      required: ["id"],
    },
    async handler(args, ctx) {
      const id = requireString(args, "id");
      const exists = await prisma.contact.findUnique({ where: { id }, select: { id: true } });
      if (!exists) throw new ToolError(`Contact introuvable (id ${id}).`);

      const input = await contactInput(args);
      if (input.email?.trim()) {
        const duplicate = await findContactByEmail(input.email, id);
        if (duplicate) {
          throw new ToolError(
            `Cet email est déjà utilisé par ${duplicate.prenom} ${duplicate.nom} (id ${duplicate.id}).`,
          );
        }
      }
      const link = await resolveCompanyLink(args);
      const contact = await updateContact(id, { ...input, companyId: link.companyId }, ctx.userId ?? undefined);
      if (!contact) throw new ToolError(`Contact introuvable (id ${id}).`);
      return { contact: contactSummary(contact), ...(link.createdCompany ? { entrepriseCreee: link.createdCompany } : {}) };
    },
  },
  {
    name: "delete_contact",
    title: "Supprimer un contact",
    kind: "delete",
    description: "Supprime définitivement un contact ainsi que toutes ses actions et son historique.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
    async handler(args) {
      const id = requireString(args, "id");
      const contact = await prisma.contact.findUnique({
        where: { id },
        select: { id: true, prenom: true, nom: true, _count: { select: { actions: true } } },
      });
      if (!contact) throw new ToolError(`Contact introuvable (id ${id}).`);
      await deleteContact(id);
      return {
        deleted: true,
        id,
        nom: `${contact.prenom} ${contact.nom}`.trim(),
        actionsSupprimees: contact._count.actions,
      };
    },
  },
];
