import { prisma } from "@/lib/prisma";
import { createAction, deleteAction, listActions, updateAction, type ActionInput } from "@/lib/actions";
import { ACTION_CHANNELS, ACTION_STATUTS, PERSON_CATEGORIES } from "@/lib/labels";
import {
  ToolError,
  customFieldsArg,
  customFieldsSchema,
  nullableDate,
  optionalBoolean,
  optionalEnum,
  optionalString,
  pagination,
  paginationSchema,
  requireString,
  type McpTool,
  type ToolArgs,
} from "@/lib/mcp/types";

const actionFields = {
  channel: { type: "string", enum: ACTION_CHANNELS, description: "Canal : email, linkedin, phone, meeting, note, other" },
  titre: { type: "string" },
  contenu: { type: "string", description: "Détail / compte rendu" },
  statut: {
    type: "string",
    enum: ACTION_STATUTS,
    description: "a_faire, en_cours ou termine (termine renseigne automatiquement la date de réalisation)",
  },
  datePrevue: { type: ["string", "null"], description: "Échéance, date ISO 8601" },
  dateRealisation: { type: ["string", "null"], description: "Date de réalisation, ISO 8601" },
  customFields: customFieldsSchema,
};

function actionSummary(action: Awaited<ReturnType<typeof listActions>>["data"][number]) {
  const { contact, user, ...rest } = action;
  return {
    ...rest,
    contact: {
      id: contact.id,
      prenom: contact.prenom,
      nom: contact.nom,
      company: contact.company ? { id: contact.company.id, nom: contact.company.nom } : null,
    },
    user: user ? { id: user.id, email: user.email } : null,
  };
}

async function actionInput(args: ToolArgs): Promise<ActionInput> {
  return {
    channel: optionalEnum(args, "channel", ACTION_CHANNELS),
    titre: optionalString(args, "titre"),
    contenu: optionalString(args, "contenu"),
    statut: optionalEnum(args, "statut", ACTION_STATUTS),
    datePrevue: nullableDate(args, "datePrevue"),
    dateRealisation: nullableDate(args, "dateRealisation"),
    customFields: await customFieldsArg(args, "action"),
  };
}

export const actionTools: McpTool[] = [
  {
    name: "search_actions",
    title: "Rechercher des actions",
    kind: "read",
    description:
      "Recherche les actions (tâches, appels, emails, rendez-vous, notes) avec filtres : contact, entreprise, statut, canal, catégorie du contact, en retard. Tri par échéance.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Texte dans le titre, le contenu ou le nom du contact" },
        contactId: { type: "string" },
        companyId: { type: "string", description: "Actions des contacts de cette entreprise" },
        statut: { type: "string", enum: ACTION_STATUTS },
        channel: { type: "string", enum: ACTION_CHANNELS },
        contactCategory: { type: "string", enum: PERSON_CATEGORIES },
        overdue: { type: "boolean", description: "Uniquement les actions non terminées dont l'échéance est passée" },
        ...paginationSchema,
      },
    },
    async handler(args) {
      const { page, pageSize } = pagination(args);
      const result = await listActions(
        {
          q: optionalString(args, "query"),
          contactId: optionalString(args, "contactId"),
          companyId: optionalString(args, "companyId"),
          statut: optionalEnum(args, "statut", ACTION_STATUTS),
          channel: optionalEnum(args, "channel", ACTION_CHANNELS),
          contactCategory: optionalEnum(args, "contactCategory", PERSON_CATEGORIES),
          overdue: optionalBoolean(args, "overdue"),
        },
        { page, pageSize },
      );
      return { total: result.total, page, pageSize, actions: result.data.map(actionSummary) };
    },
  },
  {
    name: "create_action",
    title: "Créer une action",
    kind: "write",
    description:
      "Crée une action liée à un contact (obligatoire : contactId, channel, titre). Pour une simple note, channel=note et statut=termine. Met à jour la « prochaine action » du contact.",
    inputSchema: {
      type: "object",
      properties: {
        contactId: { type: "string", description: "Contact concerné (voir search_contacts)" },
        ...actionFields,
      },
      required: ["contactId", "channel", "titre"],
    },
    async handler(args, ctx) {
      const contactId = requireString(args, "contactId");
      const contact = await prisma.contact.findUnique({ where: { id: contactId }, select: { id: true } });
      if (!contact) throw new ToolError(`Contact introuvable (contactId ${contactId}). Utilisez search_contacts.`);
      const input = await actionInput(args);
      if (!input.channel) throw new ToolError(`« channel » requis : ${ACTION_CHANNELS.join(", ")}.`);
      const titre = requireString(args, "titre");
      if (input.statut === "termine" && input.dateRealisation === undefined) input.dateRealisation = new Date();
      return actionSummary(await createAction({ ...input, titre, contactId, userId: ctx.userId }));
    },
  },
  {
    name: "update_action",
    title: "Modifier une action",
    kind: "write",
    description:
      "Modifie une action (titre, contenu, canal, statut, échéance, colonnes personnalisées). Passer statut=termine pour la clôturer. Seuls les champs fournis sont changés.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, ...actionFields },
      required: ["id"],
    },
    async handler(args) {
      const id = requireString(args, "id");
      const input = await actionInput(args);
      if (input.titre !== undefined && !input.titre.trim()) throw new ToolError("Le titre ne peut pas être vide.");
      const action = await updateAction(id, input);
      if (!action) throw new ToolError(`Action introuvable (id ${id}).`);
      return actionSummary(action);
    },
  },
  {
    name: "delete_action",
    title: "Supprimer une action",
    kind: "delete",
    description: "Supprime définitivement une action.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
    async handler(args) {
      const id = requireString(args, "id");
      const exists = await prisma.action.findUnique({ where: { id }, select: { id: true, titre: true } });
      if (!exists) throw new ToolError(`Action introuvable (id ${id}).`);
      await deleteAction(id);
      return { deleted: true, id, titre: exists.titre };
    },
  },
];
