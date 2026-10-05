// Partagé client/serveur : pas d'import Prisma ici.

export type MeetMagnetField = { path: string; label: string; example: string; group: string };

/** Champs d'un élément de « leads » envoyé par MeetMagnet (chemin relatif à l'élément). */
export const MEETMAGNET_FIELDS: MeetMagnetField[] = [
  { group: "Prospect", path: "lead.person_firstname", label: "Prénom", example: "Clara" },
  { group: "Prospect", path: "lead.person_lastname", label: "Nom", example: "Dupont" },
  { group: "Prospect", path: "lead.person_email", label: "Email", example: "clara.dupont@exemple.com" },
  { group: "Prospect", path: "lead.person_headline", label: "Poste (titre LinkedIn)", example: "Directrice commerciale" },
  { group: "Prospect", path: "person_linkedin_url", label: "URL LinkedIn du prospect", example: "https://www.linkedin.com/in/ACoAAAexemple" },
  { group: "Prospect", path: "person.address", label: "Localisation", example: "Paris, Île-de-France" },
  { group: "Prospect", path: "lead.activity_summary", label: "Résumé de son activité", example: "Se documente sur le coût du temps commercial perdu" },
  { group: "Entreprise", path: "lead.company_name", label: "Nom de l’entreprise", example: "Exemple SAS" },
  { group: "Entreprise", path: "lead.company_industry", label: "Secteur", example: "Business Consulting and Services" },
  { group: "Entreprise", path: "lead.company_size", label: "Taille (effectif)", example: "S11_50" },
  { group: "Entreprise", path: "company_linkedin_url", label: "URL LinkedIn de l’entreprise", example: "https://www.linkedin.com/company/exemple" },
  { group: "Réponse", path: "reply_channel", label: "Canal de la réponse", example: "email" },
  { group: "Réponse", path: "reply.subject", label: "Objet de la réponse", example: "Re: Opportunité business" },
  { group: "Réponse", path: "reply.content", label: "Texte de la réponse", example: "Bonjour, merci pour votre message. Pouvez-vous m’en dire plus ?" },
  { group: "Réponse", path: "reply.sent_at", label: "Date de la réponse", example: "2026-09-22T09:15:00.000Z" },
  { group: "MeetMagnet", path: "lead.id", label: "Identifiant MeetMagnet du prospect", example: "00000000-0000-4000-8000-000000000001" },
  { group: "MeetMagnet", path: "lead.persona_id", label: "Identifiant du persona", example: "00000000-0000-4000-8000-0000000000aa" },
  { group: "MeetMagnet", path: "lead.person_provider_id", label: "Identifiant LinkedIn (URN)", example: "ACoAAAexemple" },
  { group: "MeetMagnet", path: "lead.created_at", label: "Date d’entrée dans MeetMagnet", example: "2026-09-22T08:00:00.000Z" },
  { group: "MeetMagnet", path: "lead.last_inbound_channel", label: "Dernier canal entrant", example: "MAIL" },
  { group: "MeetMagnet", path: "post_linkedin_url", label: "URL du post LinkedIn à l’origine", example: "" },
];

/** Correspondance automatique : champ MeetMagnet → champ du CRM ("" = ignoré). */
export const DEFAULT_MEETMAGNET_MAPPING: Record<string, string> = {
  "lead.person_firstname": "contact.prenom",
  "lead.person_lastname": "contact.nom",
  "lead.person_email": "contact.email",
  "lead.person_headline": "contact.poste",
  person_linkedin_url: "contact.linkedinUrl",
  "person.address": "contact.adresse",
  "lead.activity_summary": "contact.description",
  "lead.company_name": "company.nom",
  "lead.company_industry": "company.description",
  "lead.company_size": "company.effectif",
  company_linkedin_url: "company.linkedinUrl",
};

export type WebhookMapping = Record<string, string>;

const KNOWN_PATHS = new Set(MEETMAGNET_FIELDS.map((f) => f.path));

/** Correspondance enregistrée (JSON) complétée par la correspondance par défaut pour les champs absents. */
export function resolveMapping(raw: string | null | undefined): WebhookMapping {
  const mapping: WebhookMapping = {};
  for (const field of MEETMAGNET_FIELDS) mapping[field.path] = DEFAULT_MEETMAGNET_MAPPING[field.path] ?? "";
  if (!raw) return mapping;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [path, target] of Object.entries(parsed)) {
        if (KNOWN_PATHS.has(path) && typeof target === "string") mapping[path] = target;
      }
    }
  } catch {
    // JSON corrompu : on garde la correspondance par défaut
  }
  return mapping;
}

export function isKnownMeetMagnetPath(path: string) {
  return KNOWN_PATHS.has(path);
}
