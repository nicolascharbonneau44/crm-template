import type { ActionChannel, ActionStatut, PersonCategory, PersonState } from "@prisma/client";

export const PERSON_CATEGORIES: PersonCategory[] = [
  "lead",
  "prospect",
  "client",
  "ex_clients",
  "autres",
];

export const PERSON_STATES: PersonState[] = [
  "a_traiter",
  "a_rappeler",
  "relance_3mois",
  "inscription_site",
  "inscription_newsletter_inscrite",
  "new_lead",
  "lead_en_cours",
  "free_trial",
  "onboarding",
  "rdv_a_planifier",
  "rdv_decouverte",
  "rencontre",
  "rdv2_planifie",
  "relance_suite_rdv",
  "propale",
  "done",
  "kickoff",
  "perdu",
  "concurrent",
  "ok_plus_tard",
  "mis_de_cote",
  "pas_de_besoin",
  "pas_interesse",
  "prospect_pas_interlocuteur",
  "plus_dans_societe",
  "mauvaise_cible",
  "nok",
  "erreur_email",
  "waitlist",
  "erreur_invitation_linkedin",
  "autres",
];

export const PERSON_CATEGORY_DEFAULT_STATES: Record<PersonCategory, PersonState> = {
  lead: "new_lead",
  prospect: "rdv_decouverte",
  client: "kickoff",
  ex_clients: "perdu",
  autres: "autres",
};

/** Aligné sur MeetMagnet personStateCatalog — « perdu » ne force pas la catégorie. */
export const PERSON_STATE_CATEGORY_MAP: Partial<Record<PersonState, PersonCategory>> = {
  a_traiter: "lead",
  a_rappeler: "lead",
  relance_3mois: "lead",
  inscription_site: "lead",
  inscription_newsletter_inscrite: "lead",
  new_lead: "lead",
  lead_en_cours: "lead",
  free_trial: "lead",
  onboarding: "lead",
  rdv_a_planifier: "lead",
  rdv_decouverte: "prospect",
  rencontre: "prospect",
  rdv2_planifie: "prospect",
  relance_suite_rdv: "prospect",
  propale: "prospect",
  kickoff: "client",
  done: "client",
  autres: "autres",
};

export const PERSON_CATEGORY_STATE_KEYS: Record<PersonCategory, PersonState[]> = {
  lead: [
    "inscription_newsletter_inscrite",
    "new_lead",
    "lead_en_cours",
    "a_rappeler",
    "relance_3mois",
    "free_trial",
    "onboarding",
    "rdv_a_planifier",
  ],
  prospect: ["rdv_decouverte", "rencontre", "rdv2_planifie", "relance_suite_rdv", "propale"],
  client: ["kickoff", "done"],
  ex_clients: ["perdu"],
  autres: [
    "autres",
    "concurrent",
    "ok_plus_tard",
    "mis_de_cote",
    "pas_de_besoin",
    "pas_interesse",
    "prospect_pas_interlocuteur",
    "plus_dans_societe",
    "mauvaise_cible",
    "nok",
    "erreur_email",
    "waitlist",
    "erreur_invitation_linkedin",
  ],
};

export const ACTION_CHANNELS: ActionChannel[] = [
  "email",
  "linkedin",
  "phone",
  "meeting",
  "note",
  "other",
];

export const ACTION_STATUTS: ActionStatut[] = ["a_faire", "en_cours", "termine"];

export const PERSON_STATE_LABELS: Record<PersonState, string> = {
  a_traiter: "New lead",
  a_rappeler: "À relancer prochains jours",
  relance_3mois: "Relancer dans les prochains mois",
  inscription_site: "New lead",
  inscription_newsletter_inscrite: "Inscription newsletter inscrite",
  new_lead: "New lead",
  lead_en_cours: "Lead en cours",
  free_trial: "Free trial",
  onboarding: "Onboarding",
  rdv_a_planifier: "À relancer prochains jours",
  rdv_decouverte: "R1 démo",
  rencontre: "Relance suite RDV",
  rdv2_planifie: "RDV 2",
  relance_suite_rdv: "Relance suite RDV",
  propale: "Propale",
  done: "Done",
  kickoff: "Kick-off",
  perdu: "Perdu",
  concurrent: "Concurrent",
  ok_plus_tard: "OK pour plus tard",
  mis_de_cote: "Mis de côté",
  pas_de_besoin: "Pas de besoin",
  pas_interesse: "Pas intéressé",
  prospect_pas_interlocuteur: "Prospect pas interlocuteur",
  plus_dans_societe: "Plus dans la société",
  mauvaise_cible: "Mauvaise cible",
  nok: "NOK",
  erreur_email: "Erreur email",
  waitlist: "Waitlist",
  erreur_invitation_linkedin: "Erreur invitation LinkedIn",
  autres: "Autres",
};

export const PERSON_CATEGORY_LABELS: Record<PersonCategory, string> = {
  lead: "Lead",
  prospect: "Prospect",
  client: "Client",
  ex_clients: "Ex-clients",
  autres: "Autres",
};

export const PERSON_STATE_COLORS: Record<PersonState, string> = {
  a_traiter: "badge-yellow",
  a_rappeler: "badge-yellow",
  relance_3mois: "badge-yellow",
  inscription_site: "badge-yellow",
  inscription_newsletter_inscrite: "badge-yellow",
  new_lead: "badge-yellow",
  lead_en_cours: "badge-yellow",
  free_trial: "badge-orange",
  onboarding: "badge-yellow",
  rdv_a_planifier: "badge-blue",
  rdv_decouverte: "badge-blue",
  rencontre: "badge-blue",
  rdv2_planifie: "badge-blue",
  relance_suite_rdv: "badge-blue",
  propale: "badge-violet",
  done: "badge-green",
  kickoff: "badge-green",
  perdu: "badge-red",
  concurrent: "badge-red",
  ok_plus_tard: "badge-gray",
  mis_de_cote: "badge-gray",
  pas_de_besoin: "badge-gray",
  pas_interesse: "badge-gray",
  prospect_pas_interlocuteur: "badge-gray",
  plus_dans_societe: "badge-gray",
  mauvaise_cible: "badge-gray",
  nok: "badge-gray",
  erreur_email: "badge-gray",
  waitlist: "badge-gray",
  erreur_invitation_linkedin: "badge-gray",
  autres: "badge-gray",
};

export const PERSON_CATEGORY_COLORS: Record<PersonCategory, string> = {
  lead: "badge-yellow",
  prospect: "badge-blue",
  client: "badge-green",
  ex_clients: "badge-red",
  autres: "badge-gray",
};

export const ACTION_CHANNEL_LABELS: Record<ActionChannel, string> = {
  email: "E-mail",
  linkedin: "LinkedIn",
  phone: "Téléphone",
  meeting: "Rendez-vous",
  note: "Note",
  other: "Autre",
};

export const ACTION_STATUT_LABELS: Record<ActionStatut, string> = {
  a_faire: "À faire",
  en_cours: "En cours",
  termine: "Terminé",
};

export const CIVILITES = ["Monsieur", "Madame"] as const;
export type Civilite = (typeof CIVILITES)[number];

const CIVILITE_SYNONYMS: Record<string, Civilite> = {
  monsieur: "Monsieur",
  m: "Monsieur",
  mr: "Monsieur",
  mister: "Monsieur",
  sir: "Monsieur",
  homme: "Monsieur",
  madame: "Madame",
  mme: "Madame",
  mrs: "Madame",
  ms: "Madame",
  miss: "Madame",
  mlle: "Madame",
  mademoiselle: "Madame",
  femme: "Madame",
};

/** « Mme », « Mr. », « madame »… → Monsieur / Madame. null = vide, undefined = non reconnu. */
export function normalizeCivilite(value: unknown): Civilite | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return undefined;
  const key = value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  if (!key) return null;
  return CIVILITE_SYNONYMS[key];
}

/**
 * Effectif approximatif : « 2 118 », « environ 50 », « 50+ », tranche « 2000 - 4999 » → milieu (3500).
 * null = vide, undefined = non reconnu.
 */
export function parseEffectif(value: unknown): number | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
  if (typeof value !== "string") return undefined;
  const clean = value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[\s  ]/g, "")
    .replace(/^(~|≈|environ|env\.?|approx\.?)/, "")
    .replace(/(salaries?|employes?|personnes?|pers\.?|etplus|\+)$/, "");
  if (!clean) return value.trim() ? undefined : null;
  const range = clean.match(/^(\d+)(?:-|a|à)(\d+)$/);
  if (range) return Math.round((Number(range[1]) + Number(range[2])) / 2);
  if (/^\d+([.,]\d+)?$/.test(clean)) return Math.round(Number(clean.replace(",", ".")));
  return undefined;
}

export function isPersonCategory(value: unknown): value is PersonCategory {
  return typeof value === "string" && PERSON_CATEGORIES.includes(value as PersonCategory);
}

export function isPersonState(value: unknown): value is PersonState {
  return typeof value === "string" && PERSON_STATES.includes(value as PersonState);
}

export function isActionChannel(value: unknown): value is ActionChannel {
  return typeof value === "string" && ACTION_CHANNELS.includes(value as ActionChannel);
}

export function isActionStatut(value: unknown): value is ActionStatut {
  return typeof value === "string" && ACTION_STATUTS.includes(value as ActionStatut);
}

export function resolveLifecycleUpdate({
  currentState,
  currentCategory,
  requestedState,
  requestedCategory,
}: {
  currentState?: PersonState | null;
  currentCategory?: PersonCategory | null;
  requestedState?: PersonState | null;
  requestedCategory?: PersonCategory | null;
}): { state: PersonState; category: PersonCategory } {
  const safeCurrentCategory =
    currentCategory && isPersonCategory(currentCategory) ? currentCategory : "lead";
  const hasRequestedState =
    requestedState !== undefined && requestedState !== null && String(requestedState).trim() !== "";
  const hasRequestedCategory =
    requestedCategory !== undefined &&
    requestedCategory !== null &&
    String(requestedCategory).trim() !== "";

  let nextState = (currentState && isPersonState(currentState) ? currentState : "new_lead") as PersonState;
  let nextCategory = safeCurrentCategory;

  if (hasRequestedState && requestedState) {
    nextState = requestedState;
    const requestedCategoryValue =
      hasRequestedCategory && requestedCategory && isPersonCategory(requestedCategory)
        ? requestedCategory
        : safeCurrentCategory;
    const mappedCategory = PERSON_STATE_CATEGORY_MAP[nextState];
    nextCategory = mappedCategory || requestedCategoryValue;
  } else if (hasRequestedCategory && requestedCategory && isPersonCategory(requestedCategory)) {
    nextCategory = requestedCategory;
    const mappedCurrentCategory = currentState ? PERSON_STATE_CATEGORY_MAP[currentState] : null;
    const nextDefaultState = PERSON_CATEGORY_DEFAULT_STATES[nextCategory];
    const stateAlreadyFits =
      mappedCurrentCategory === nextCategory || currentState === nextDefaultState;
    if (!stateAlreadyFits) {
      nextState = nextDefaultState;
    }
  }

  return { state: nextState, category: nextCategory };
}

export function contactDisplayName(contact: { prenom?: string | null; nom?: string | null }) {
  const full = `${contact.prenom || ""} ${contact.nom || ""}`.trim();
  return full || "Sans nom";
}

export function parseOptionalDate(value: unknown): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date;
}

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
