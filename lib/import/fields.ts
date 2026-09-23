// Partagé client/serveur : pas d'import Prisma ici.

export type ImportEntity = "contact" | "company";
export type ImportMode = "contacts" | "companies";
export type ExistingPolicy = "fill" | "overwrite" | "skip";

export type ImportField = {
  target: string;
  entity: ImportEntity;
  label: string;
};

export const CONTACT_FIELDS: ImportField[] = [
  { target: "contact.prenom", entity: "contact", label: "Prénom" },
  { target: "contact.nom", entity: "contact", label: "Nom" },
  { target: "contact.fullName", entity: "contact", label: "Nom complet (prénom + nom)" },
  { target: "contact.email", entity: "contact", label: "Email" },
  { target: "contact.telephone", entity: "contact", label: "Téléphone" },
  { target: "contact.poste", entity: "contact", label: "Poste" },
  { target: "contact.linkedinUrl", entity: "contact", label: "LinkedIn (profil)" },
  { target: "contact.category", entity: "contact", label: "Catégorie" },
  { target: "contact.state", entity: "contact", label: "État" },
  { target: "contact.source", entity: "contact", label: "Source" },
  { target: "contact.adresse", entity: "contact", label: "Adresse (contact)" },
  { target: "contact.pays", entity: "contact", label: "Pays" },
  { target: "contact.description", entity: "contact", label: "Description (contact)" },
];

export const COMPANY_FIELDS: ImportField[] = [
  { target: "company.nom", entity: "company", label: "Entreprise (nom)" },
  { target: "company.siret", entity: "company", label: "SIRET" },
  { target: "company.siteWeb", entity: "company", label: "Site web" },
  { target: "company.linkedinUrl", entity: "company", label: "LinkedIn (entreprise)" },
  { target: "company.telephone", entity: "company", label: "Téléphone (entreprise)" },
  { target: "company.email", entity: "company", label: "Email (entreprise)" },
  { target: "company.adresse", entity: "company", label: "Adresse (entreprise)" },
  { target: "company.description", entity: "company", label: "Description (entreprise)" },
  { target: "company.notes", entity: "company", label: "Notes (entreprise)" },
];

export const STANDARD_FIELDS = [...CONTACT_FIELDS, ...COMPANY_FIELDS];

export const NEW_CUSTOM_PREFIX = "new.";
export const CUSTOM_PREFIX = "custom.";

export function customTarget(entity: ImportEntity, key: string) {
  return `${entity}.${CUSTOM_PREFIX}${key}`;
}

export function newCustomTarget(entity: ImportEntity) {
  return `${NEW_CUSTOM_PREFIX}${entity}`;
}

export function parseTarget(target: string):
  | { kind: "field"; entity: ImportEntity; field: string }
  | { kind: "custom"; entity: ImportEntity; key: string }
  | { kind: "new"; entity: ImportEntity }
  | null {
  if (target === "new.contact" || target === "new.company") {
    return { kind: "new", entity: target.slice(4) as ImportEntity };
  }
  const match = target.match(/^(contact|company)\.(.+)$/);
  if (!match) return null;
  const entity = match[1] as ImportEntity;
  if (match[2].startsWith(CUSTOM_PREFIX)) return { kind: "custom", entity, key: match[2].slice(CUSTOM_PREFIX.length) };
  if (!STANDARD_FIELDS.some((f) => f.target === target)) return null;
  return { kind: "field", entity, field: match[2] };
}

export function normalizeHeader(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Règles ordonnées : les plus spécifiques d'abord. Chaque champ n'est attribué qu'une fois.
const RULES: { target: string; test: RegExp }[] = [
  { target: "company.linkedinUrl", test: /linkedin.*(page|entreprise|societe|company|organisation)|(page|company|entreprise).*linkedin/ },
  { target: "contact.linkedinUrl", test: /linkedin/ },
  { target: "company.siret", test: /\bsiret\b/ },
  { target: "company.siteWeb", test: /\b(site|website|web|domaine|domain)\b/ },
  { target: "company.telephone", test: /\b(tel|telephone|phone)\b.*\b(standard|entreprise|societe|company|siege|accueil)\b|^standard$/ },
  { target: "company.email", test: /\b(e ?mail|courriel)\b.*\b(generique|entreprise|societe|company|contact general)\b/ },
  { target: "company.adresse", test: /\b(adresse|address)\b.*\b(siege|entreprise|societe|company)\b/ },
  { target: "company.description", test: /\bdescription\b.*\b(site|entreprise|societe|company)\b/ },
  { target: "contact.source", test: /\b(source|origine|liste|list|campagne|campaign)\b/ },
  { target: "contact.prenom", test: /^(prenom|first ?name|firstname|given name|prenom du contact)$/ },
  { target: "contact.fullName", test: /^(nom complet|full ?name|nom et prenom|prenom et nom|prenom nom|nom prenom|contact|name|contact name)$/ },
  { target: "contact.nom", test: /^(nom|last ?name|lastname|surname|nom de famille|family name|nom du contact)$/ },
  {
    target: "company.nom",
    test: /^(entreprise|societe|company|company name|organisation|organization|compte|account|account name|raison sociale|nom commercial|nom de l entreprise|nom entreprise|nom de la societe|employeur|employer)$/,
  },
  { target: "company.nom", test: /\b(raison sociale|nom legal|nom de l entreprise|nom entreprise|company name)\b/ },
  { target: "contact.email", test: /\b(e ?mail|courriel|mail)\b/ },
  { target: "contact.telephone", test: /\b(tel|telephone|phone|portable|mobile|gsm)\b/ },
  { target: "contact.poste", test: /\b(poste|fonction|job|title|titre|position|intitule)\b/ },
  { target: "contact.category", test: /^(categorie|category|type de contact|type contact|lifecycle stage|cycle de vie)$/ },
  { target: "contact.state", test: /^(etat|statut|status|state|stage|etape|pipeline)$/ },
  { target: "contact.pays", test: /^(pays|country)$/ },
  { target: "company.adresse", test: /^(adresse|address|adresse complete)$/ },
  { target: "company.notes", test: /^(notes?|commentaires?|remarques?)$/ },
  { target: "company.description", test: /^(description|activite|activity)$/ },
];

const PERSON_HINT = /prenom|first ?name|nom complet|full ?name|poste|fonction|job|linkedin.*(prospect|profil|profile)|civilite/;

const isEmail = (v: string) => /\S+@\S+\.\S+/.test(v);
const isUrl = (v: string) => /^(https?:\/\/|www\.)|^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(v.trim());
const isPhone = (v: string) => /^[+\d\s().\-/]{6,}$/.test(v.trim()) && (v.match(/\d/g)?.length ?? 0) >= 6;
const isSiret = (v: string) => /^\d{14}$/.test(v.replace(/\s/g, ""));

// Le contenu doit ressembler au champ : évite « Description issue du site internet » → site web, etc.
const VALUE_CHECKS: Record<string, (v: string) => boolean> = {
  "contact.email": isEmail,
  "company.email": isEmail,
  "contact.linkedinUrl": isUrl,
  "company.linkedinUrl": isUrl,
  "company.siteWeb": isUrl,
  "contact.telephone": isPhone,
  "company.telephone": isPhone,
  "company.siret": isSiret,
};

function valuesMatch(target: string, samples: string[]) {
  const check = VALUE_CHECKS[target];
  if (!check) return true;
  const hits = samples.filter(check).length;
  return hits > 0 && hits >= samples.length / 2;
}

export type AutoMapping = { targets: string[]; auto: boolean[]; suggestedMode: ImportMode };

/** samples[i] = valeurs non vides (quelques-unes) de la colonne i. */
export function autoMapHeaders(headers: string[], samples: string[][]): AutoMapping {
  const used = new Set<string>();
  const targets = headers.map(() => "");
  const normalized = headers.map(normalizeHeader);

  for (const rule of RULES) {
    if (used.has(rule.target)) continue;
    const index = normalized.findIndex(
      (h, i) => !targets[i] && samples[i]?.length > 0 && rule.test.test(h) && valuesMatch(rule.target, samples[i]),
    );
    if (index >= 0) {
      targets[index] = rule.target;
      used.add(rule.target);
    }
  }

  const hasPerson = normalized.some((h) => PERSON_HINT.test(h));
  if (!hasPerson) {
    // Fichier d'entreprises : « Nom » désigne l'entreprise, les coordonnées aussi.
    const swap: Record<string, string> = {
      "contact.nom": "company.nom",
      "contact.fullName": "company.nom",
      "contact.email": "company.email",
      "contact.telephone": "company.telephone",
      "contact.linkedinUrl": "company.linkedinUrl",
    };
    targets.forEach((t, i) => {
      const to = swap[t];
      if (to && !targets.includes(to)) targets[i] = to;
      else if (to) targets[i] = "";
    });
    targets.forEach((t, i) => {
      if (t.startsWith("contact.")) targets[i] = "";
    });
  }

  return { targets, auto: targets.map(Boolean), suggestedMode: hasPerson ? "contacts" : "companies" };
}

export const MAX_ROWS_PER_REQUEST = 200;
