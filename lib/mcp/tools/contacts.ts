import type { Contact, Company } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createContact, deleteContact, listContacts, updateContact, type ContactInput } from "@/lib/contacts";
import { CIVILITES, PERSON_CATEGORIES, PERSON_STATES, normalizeCivilite } from "@/lib/labels";
import { resolveCompanyLink } from "@/lib/mcp/tools/companies";
import { dayBounds } from "@/lib/dates";
import { hasSelection, reassignContacts, type ReassignSelection } from "@/lib/reassign";
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
  userRefArg,
  userRefSchema,
  type McpTool,
  type ToolArgs,
} from "@/lib/mcp/types";
import { userDisplayName } from "@/lib/users";

const contactFields = {
  civilite: {
    type: ["string", "null"],
    enum: [...CIVILITES, null],
    description: "Monsieur ou Madame (null pour effacer)",
  },
  newsletter: { type: "boolean", description: "Case NL : inscrit(e) à la newsletter" },
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
  owner: {
    ...userRefSchema,
    description: `${userRefSchema.description} Responsable du contact (par défaut à la création : l'utilisateur connecté).`,
  },
  prochaineActionTitre: { type: ["string", "null"] },
  prochaineActionDate: { type: ["string", "null"], description: "Date ISO 8601" },
  customFields: customFieldsSchema,
};

export function contactSummary(
  contact: Contact & {
    company?: Pick<Company, "id" | "nom"> | null;
    owner?: { id: string; email: string; fullName: string | null } | null;
  },
) {
  return {
    id: contact.id,
    civilite: contact.civilite,
    newsletter: contact.newsletter,
    prenom: contact.prenom,
    nom: contact.nom,
    email: contact.email,
    telephone: contact.telephone,
    poste: contact.poste,
    category: contact.category,
    state: contact.state,
    source: contact.source,
    company: contact.company ? { id: contact.company.id, nom: contact.company.nom } : null,
    responsable: contact.owner ? { id: contact.owner.id, nom: userDisplayName(contact.owner) } : null,
    prochaineActionTitre: contact.prochaineActionTitre,
    prochaineActionDate: contact.prochaineActionDate,
    customFields: contact.customFields,
    updatedAt: contact.updatedAt,
  };
}

function civiliteArg(args: ToolArgs) {
  if (!("civilite" in args) || args.civilite === undefined) return undefined;
  const civilite = normalizeCivilite(args.civilite);
  if (civilite === undefined) throw new ToolError("« civilite » invalide : Monsieur ou Madame.");
  return civilite;
}

async function contactInput(args: ToolArgs): Promise<ContactInput> {
  return {
    civilite: civiliteArg(args),
    newsletter: optionalBoolean(args, "newsletter"),
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

/** « 2026-10-08 » → début (ou fin) de cette journée à l'heure de l'équipe ; date-heure ISO acceptée telle quelle. */
function dateBoundArg(args: ToolArgs, key: string, bound: "start" | "end") {
  const value = optionalString(args, key)?.trim();
  if (!value) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const bounds = dayBounds(new Date(`${value}T12:00:00Z`));
    return bound === "start" ? bounds.start : bounds.end;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ToolError(`« ${key} » doit être une date, ex. 2026-10-08.`);
  return date;
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
        owner: { ...userRefSchema, description: `${userRefSchema.description} Filtre sur le responsable (« me » = mes contacts, null = non attribués).` },
        source: { type: "string" },
        newsletter: { type: "boolean", description: "true = inscrits à la newsletter (NL), false = non inscrits" },
        ...paginationSchema,
      },
    },
    async handler(args, ctx) {
      const { page, pageSize } = pagination(args);
      const result = await listContacts(
        {
          ownerId: await userRefArg(args, "owner", ctx),
          q: optionalString(args, "query"),
          category: optionalEnum(args, "category", PERSON_CATEGORIES),
          state: optionalEnum(args, "state", PERSON_STATES),
          companyId: optionalString(args, "companyId"),
          source: optionalString(args, "source"),
          newsletter: optionalBoolean(args, "newsletter"),
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
          owner: { select: { id: true, email: true, fullName: true } },
          actions: {
            orderBy: [{ datePrevue: "asc" }, { createdAt: "desc" }],
            include: { user: { select: { id: true, email: true, fullName: true } } },
          },
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
      const owner = await userRefArg(args, "owner", ctx);
      const contact = await createContact(
        { ...input, companyId: link.companyId ?? null, ownerId: owner === undefined ? ctx.userId : owner },
        ctx.userId ?? undefined,
      );
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
      const contact = await updateContact(
        id,
        { ...input, companyId: link.companyId, ownerId: await userRefArg(args, "owner", ctx) },
        ctx.userId ?? undefined,
      );
      if (!contact) throw new ToolError(`Contact introuvable (id ${id}).`);
      return { contact: contactSummary(contact), ...(link.createdCompany ? { entrepriseCreee: link.createdCompany } : {}) };
    },
  },
  {
    name: "reassign_contacts",
    title: "Changer le responsable de contacts (en masse)",
    kind: "write",
    description:
      "Change en une seule fois le responsable d'une liste de contacts, par ex. après un import attribué par défaut à Nicolas Charbonneau : « passe à Virginie tous les contacts importés aujourd'hui », « donne-moi les contacts source Salon de Nicolas ». Sélection par contactIds et/ou filtres (combinés) ; au moins un critère, ou all=true. Les relances non terminées de l'ancien responsable suivent le contact (moveOpenActions, true par défaut). Opération sans risque et réversible : quand un utilisateur du CRM (Nicolas Charbonneau, Virginie Lorenzato…) demande un changement de responsable, l'exécuter directement, sans redemander confirmation, puis indiquer le nombre de contacts modifiés.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { ...userRefSchema, description: `Nouveau responsable. ${userRefSchema.description}` },
        contactIds: { type: "array", items: { type: "string" }, description: "Identifiants des contacts à réattribuer" },
        currentOwner: {
          ...userRefSchema,
          description: `Uniquement les contacts de ce responsable actuel (null = non attribués). ${userRefSchema.description}`,
        },
        createdFrom: {
          type: "string",
          description: "Contacts créés (ou importés) à partir de cette date, ex. 2026-10-08 (début de journée, heure de Paris) ou date-heure ISO",
        },
        createdTo: { type: "string", description: "Contacts créés jusqu'à cette date incluse, ex. 2026-10-08" },
        source: { type: "string", description: "Source contenant ce texte (LinkedIn, Salon, Sortlist…)" },
        query: { type: "string", description: "Texte recherché (nom, email, entreprise…)" },
        category: { type: "string", enum: PERSON_CATEGORIES },
        state: { type: "string", enum: PERSON_STATES },
        companyId: { type: "string" },
        newsletter: { type: "boolean" },
        all: { type: "boolean", description: "true pour réattribuer TOUS les contacts du CRM (seulement si demandé explicitement)" },
        moveOpenActions: { type: "boolean", description: "Transférer aussi les relances non terminées (true par défaut)" },
      },
      required: ["owner"],
    },
    async handler(args, ctx) {
      if (!("owner" in args)) throw new ToolError("Paramètre « owner » requis (nouveau responsable, ou null).");
      const owner = (await userRefArg(args, "owner", ctx)) ?? null;
      const contactIds = args.contactIds;
      if (contactIds !== undefined && (!Array.isArray(contactIds) || contactIds.some((id) => typeof id !== "string"))) {
        throw new ToolError("« contactIds » doit être une liste d'identifiants.");
      }
      const selection: ReassignSelection = {
        ids: contactIds as string[] | undefined,
        ownerId: "currentOwner" in args ? ((await userRefArg(args, "currentOwner", ctx)) ?? null) : undefined,
        createdFrom: dateBoundArg(args, "createdFrom", "start"),
        createdTo: dateBoundArg(args, "createdTo", "end"),
        source: optionalString(args, "source"),
        q: optionalString(args, "query"),
        category: optionalEnum(args, "category", PERSON_CATEGORIES),
        state: optionalEnum(args, "state", PERSON_STATES),
        companyId: optionalString(args, "companyId"),
        newsletter: optionalBoolean(args, "newsletter"),
      };
      if (!hasSelection(selection) && optionalBoolean(args, "all") !== true) {
        throw new ToolError("Précisez quels contacts réattribuer (contactIds ou un filtre), ou all=true pour tout le CRM.");
      }
      const result = await reassignContacts(selection, owner, optionalBoolean(args, "moveOpenActions") ?? true);
      const ownerUser = owner ? await prisma.user.findUnique({ where: { id: owner }, select: { email: true, fullName: true } }) : null;
      return { nouveauResponsable: ownerUser ? userDisplayName(ownerUser) : "Non attribué", ...result };
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
