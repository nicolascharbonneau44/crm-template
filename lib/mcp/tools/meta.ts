import {
  CUSTOM_COLUMN_TYPES,
  createCustomColumn,
  listCustomColumns,
  type CustomEntityType,
} from "@/lib/custom-columns";
import {
  ACTION_CHANNELS,
  ACTION_CHANNEL_LABELS,
  ACTION_STATUTS,
  ACTION_STATUT_LABELS,
  PERSON_CATEGORIES,
  PERSON_CATEGORY_DEFAULT_STATES,
  PERSON_CATEGORY_LABELS,
  PERSON_CATEGORY_STATE_KEYS,
  PERSON_STATES,
  PERSON_STATE_CATEGORY_MAP,
  PERSON_STATE_LABELS,
} from "@/lib/labels";
import { getCrmStats } from "@/lib/stats";
import { ToolError, optionalEnum, requireString, type McpTool } from "@/lib/mcp/types";

export const CRM_RULES = [
  "Un contact appartient à 0 ou 1 entreprise (companyId) ; une entreprise regroupe plusieurs contacts.",
  "Une action est toujours liée à un contact (contactId).",
  "Changer l'état (state) d'un contact recalcule sa catégorie (ex. propale → prospect). Changer seulement la catégorie remet l'état par défaut de cette catégorie si l'état actuel n'y correspond pas. Chaque changement est historisé.",
  "La « prochaine action » d'un contact est recalculée automatiquement à partir de ses actions non terminées.",
  "Supprimer une entreprise détache ses contacts sans les supprimer. Supprimer un contact supprime ses actions.",
  "Avant de créer, cherchez s'il existe déjà (search_contacts / search_companies) pour éviter les doublons.",
  "Dates au format ISO 8601. Colonnes personnalisées : customFields { cle: valeur }.",
];

const ENTITY_TYPES: CustomEntityType[] = ["contact", "company", "action"];

export const metaTools: McpTool[] = [
  {
    name: "get_crm_schema",
    title: "Structure du CRM",
    kind: "read",
    description:
      "Décrit le CRM : règles de liaison, catégories et états des contacts (avec la catégorie déduite de chaque état), canaux et statuts d'action, colonnes personnalisées de chaque entité. À appeler en premier pour connaître les valeurs valides.",
    inputSchema: { type: "object", properties: {} },
    async handler() {
      const [contact, company, action] = await Promise.all(ENTITY_TYPES.map((t) => listCustomColumns(t)));
      const columns = (list: typeof contact) => list.map(({ key, label, type }) => ({ key, label, type }));
      return {
        regles: CRM_RULES,
        categories: PERSON_CATEGORIES.map((c) => ({
          value: c,
          label: PERSON_CATEGORY_LABELS[c],
          etatParDefaut: PERSON_CATEGORY_DEFAULT_STATES[c],
          etats: PERSON_CATEGORY_STATE_KEYS[c],
        })),
        etats: PERSON_STATES.map((s) => ({
          value: s,
          label: PERSON_STATE_LABELS[s],
          categorieDeduite: PERSON_STATE_CATEGORY_MAP[s] ?? null,
        })),
        canauxAction: ACTION_CHANNELS.map((c) => ({ value: c, label: ACTION_CHANNEL_LABELS[c] })),
        statutsAction: ACTION_STATUTS.map((s) => ({ value: s, label: ACTION_STATUT_LABELS[s] })),
        colonnesPersonnalisees: {
          contact: columns(contact),
          company: columns(company),
          action: columns(action),
        },
      };
    },
  },
  {
    name: "get_stats",
    title: "Statistiques",
    kind: "read",
    description:
      "Tableau de bord du CRM : totaux, contacts par catégorie et par état, actions par statut et par canal, activité des 30 derniers jours, actions en retard, derniers changements d'état.",
    inputSchema: { type: "object", properties: {} },
    handler: () => getCrmStats(),
  },
  {
    name: "create_custom_column",
    title: "Ajouter une colonne personnalisée",
    kind: "write",
    description:
      "Ajoute une colonne personnalisée à une entité (contact, company ou action), visible dans l'interface. Ses valeurs se renseignent ensuite via customFields.",
    inputSchema: {
      type: "object",
      properties: {
        entityType: { type: "string", enum: ENTITY_TYPES },
        label: { type: "string", description: "Libellé affiché" },
        type: { type: "string", enum: CUSTOM_COLUMN_TYPES, description: "text par défaut" },
      },
      required: ["entityType", "label"],
    },
    async handler(args) {
      const entityType = optionalEnum(args, "entityType", ENTITY_TYPES);
      if (!entityType) throw new ToolError("« entityType » requis : contact, company ou action.");
      const column = await createCustomColumn({
        entityType,
        label: requireString(args, "label"),
        type: optionalEnum(args, "type", CUSTOM_COLUMN_TYPES),
      }).catch((error: unknown) => {
        throw new ToolError(error instanceof Error ? error.message : "Création impossible");
      });
      return { key: column.key, label: column.label, type: column.type, entityType: column.entityType };
    },
  },
];
