import type { Company, Contact, PersonCategory, PersonState } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createCompany, updateCompany, type CompanyInput } from "@/lib/companies";
import { createContact, updateContact, type ContactInput } from "@/lib/contacts";
import { listCustomColumns, normalizeCustomFieldInput, parseCustomFields } from "@/lib/custom-columns";
import {
  PERSON_CATEGORIES,
  PERSON_CATEGORY_LABELS,
  PERSON_STATES,
  PERSON_STATE_LABELS,
  isPersonCategory,
  isPersonState,
  normalizeCivilite,
  parseEffectif,
} from "@/lib/labels";
import {
  MAX_ROWS_PER_REQUEST,
  normalizeHeader,
  parseTarget,
  type ExistingPolicy,
  type ImportMode,
} from "@/lib/import/fields";

export type ImportRequest = {
  mode: ImportMode;
  onExisting: ExistingPolicy;
  columns: string[];
  rows: string[][];
  firstLine: number;
  defaults: { category?: PersonCategory; state?: PersonState; source?: string };
};

export type ImportResult = {
  contacts: { created: number; updated: number; unchanged: number };
  companies: { createdIds: string[]; updatedIds: string[] };
  errors: { line: number; message: string }[];
  warnings: string[];
};

export class ImportValidationError extends Error {}

const CONTACT_TEXT_FIELDS = [
  "civilite",
  "prenom",
  "nom",
  "email",
  "telephone",
  "poste",
  "linkedinUrl",
  "source",
  "adresse",
  "pays",
  "description",
] as const;
const COMPANY_TEXT_FIELDS = [
  "nom",
  "siret",
  "codeNaf",
  "siteWeb",
  "linkedinUrl",
  "telephone",
  "email",
  "adresse",
  "description",
  "notes",
] as const;

const CATEGORY_LOOKUP = new Map<string, PersonCategory>([
  ...PERSON_CATEGORIES.map((c) => [normalizeHeader(c), c] as const),
  ...PERSON_CATEGORIES.map((c) => [normalizeHeader(PERSON_CATEGORY_LABELS[c]), c] as const),
  ["customer", "client"],
  ["clients", "client"],
  ["leads", "lead"],
  ["prospects", "prospect"],
]);
const STATE_LOOKUP = new Map<string, PersonState>([
  ...PERSON_STATES.map((s) => [normalizeHeader(s), s] as const),
  ...PERSON_STATES.map((s) => [normalizeHeader(PERSON_STATE_LABELS[s]), s] as const),
]);

const isBlank = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
const digits = (v: string) => v.replace(/\D/g, "");

function normalizeUrl(value: string) {
  let v = value.trim().toLowerCase();
  try {
    v = decodeURIComponent(v);
  } catch {
    // URL mal encodée : on garde la version brute
  }
  return v
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
}

/** Ne garde que les champs à écrire selon la règle choisie. */
function patchFor<T extends string>(
  current: Record<string, unknown> | null,
  incoming: Partial<Record<T, string>>,
  policy: ExistingPolicy,
): Partial<Record<T, string>> {
  if (!current) return incoming;
  if (policy === "skip") return {};
  const patch: Partial<Record<T, string>> = {};
  for (const [key, value] of Object.entries(incoming) as [T, string][]) {
    const existing = current[key];
    if (policy === "fill" ? isBlank(existing) : existing !== value) patch[key] = value;
  }
  return patch;
}

function customPatch(currentRaw: string | null, incoming: Record<string, unknown>, policy: ExistingPolicy) {
  if (!Object.keys(incoming).length) return undefined;
  if (currentRaw === null) return incoming;
  if (policy === "skip") return undefined;
  const current = parseCustomFields(currentRaw);
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(incoming)) {
    if (policy === "fill" ? isBlank(current[key]) : current[key] !== value) patch[key] = value;
  }
  return Object.keys(patch).length ? patch : undefined;
}

function validateRequest(body: unknown): ImportRequest {
  if (!body || typeof body !== "object") throw new ImportValidationError("Requête invalide");
  const b = body as Record<string, unknown>;
  const mode = b.mode === "companies" ? "companies" : b.mode === "contacts" ? "contacts" : null;
  if (!mode) throw new ImportValidationError("mode invalide");
  const onExisting = ["fill", "overwrite", "skip"].includes(String(b.onExisting))
    ? (b.onExisting as ExistingPolicy)
    : "fill";
  if (!Array.isArray(b.columns) || !b.columns.every((c) => typeof c === "string") || b.columns.length > 500) {
    throw new ImportValidationError("columns invalide");
  }
  if (!Array.isArray(b.rows) || b.rows.length > MAX_ROWS_PER_REQUEST) {
    throw new ImportValidationError(`rows invalide (${MAX_ROWS_PER_REQUEST} lignes max par envoi)`);
  }
  const rows = b.rows.map((r) => (Array.isArray(r) ? r.map((v) => (v == null ? "" : String(v).slice(0, 10000))) : []));
  const d = (b.defaults ?? {}) as Record<string, unknown>;
  return {
    mode,
    onExisting,
    columns: b.columns as string[],
    rows,
    firstLine: Number.isInteger(b.firstLine) ? (b.firstLine as number) : 2,
    defaults: {
      category: isPersonCategory(d.category) ? d.category : undefined,
      state: isPersonState(d.state) ? d.state : undefined,
      source: typeof d.source === "string" && d.source.trim() ? d.source.trim().slice(0, 200) : undefined,
    },
  };
}

export async function runImport(body: unknown, userId?: string): Promise<ImportResult> {
  const req = validateRequest(body);

  const [contactColumns, companyColumns] = await Promise.all([
    listCustomColumns("contact"),
    listCustomColumns("company"),
  ]);
  const customTypes = {
    contact: new Map(contactColumns.map((c) => [c.key, c.type])),
    company: new Map(companyColumns.map((c) => [c.key, c.type])),
  };
  const targets = req.columns.map((target) => {
    if (!target) return null;
    const parsed = parseTarget(target);
    if (!parsed || parsed.kind === "new") throw new ImportValidationError(`Colonne cible inconnue : ${target}`);
    if (parsed.kind === "custom" && !customTypes[parsed.entity].has(parsed.key)) {
      throw new ImportValidationError(`Colonne personnalisée inconnue : ${parsed.key}`);
    }
    return parsed;
  });

  const result: ImportResult = {
    contacts: { created: 0, updated: 0, unchanged: 0 },
    companies: { createdIds: [], updatedIds: [] },
    errors: [],
    warnings: [],
  };
  const warn = (message: string) => {
    if (!result.warnings.includes(message) && result.warnings.length < 20) result.warnings.push(message);
  };

  const companies = new Map<string, Company>();
  const companyBySiret = new Map<string, string>();
  const companyByName = new Map<string, string>();
  const indexCompany = (c: Company) => {
    companies.set(c.id, c);
    if (c.siret) companyBySiret.set(digits(c.siret), c.id);
    companyByName.set(normalizeHeader(c.nom), c.id);
  };
  (await prisma.company.findMany()).forEach(indexCompany);

  const contactByEmail = new Map<string, string>();
  const contactByLinkedin = new Map<string, string>();
  const contactByName = new Map<string, string>();
  const indexContact = (c: Pick<Contact, "id" | "email" | "linkedinUrl" | "prenom" | "nom" | "companyId">) => {
    if (c.email) contactByEmail.set(c.email.trim().toLowerCase(), c.id);
    if (c.linkedinUrl) contactByLinkedin.set(normalizeUrl(c.linkedinUrl), c.id);
    contactByName.set(`${normalizeHeader(`${c.prenom} ${c.nom}`)}|${c.companyId ?? ""}`, c.id);
  };
  if (req.mode === "contacts") {
    (
      await prisma.contact.findMany({
        select: { id: true, email: true, linkedinUrl: true, prenom: true, nom: true, companyId: true },
      })
    ).forEach(indexContact);
  }

  for (const [index, row] of req.rows.entries()) {
    const line = req.firstLine + index;
    try {
      const contact: Partial<Record<string, string>> = {};
      const company: Partial<Record<string, string>> = {};
      const contactCustom: Record<string, unknown> = {};
      const companyCustom: Record<string, unknown> = {};

      targets.forEach((target, i) => {
        const value = (row[i] ?? "").trim();
        if (!target || !value) return;
        if (target.kind === "field") {
          (target.entity === "contact" ? contact : company)[target.field] = value;
          return;
        }
        if (target.kind !== "custom") return;
        const type = customTypes[target.entity].get(target.key) ?? "text";
        const normalized = normalizeCustomFieldInput(type, type === "number" ? value.replace(/[\s ]/g, "") : value);
        if (normalized === null) {
          warn(`Valeur ignorée pour la colonne « ${target.key} » (format invalide), ex. ligne ${line}`);
          return;
        }
        (target.entity === "contact" ? contactCustom : companyCustom)[target.key] = normalized;
      });

      if (contact.fullName) {
        const [first, ...rest] = contact.fullName.split(/\s+/);
        contact.prenom ??= first;
        if (rest.length) contact.nom ??= rest.join(" ");
        delete contact.fullName;
      }

      // Entreprise
      let companyId: string | null = null;
      const hasCompanyData = Object.keys(company).length > 0 || Object.keys(companyCustom).length > 0;
      if (hasCompanyData) {
        const existingId =
          (company.siret && companyBySiret.get(digits(company.siret))) ||
          (company.nom && companyByName.get(normalizeHeader(company.nom))) ||
          null;
        if (company.codeNaf) company.codeNaf = company.codeNaf.toUpperCase();
        let effectif: number | undefined;
        if (company.effectif) {
          const parsed = parseEffectif(company.effectif);
          if (typeof parsed === "number") effectif = parsed;
          else warn(`Effectif non reconnu « ${company.effectif} » : ignoré.`);
        }
        const fields = Object.fromEntries(
          COMPANY_TEXT_FIELDS.filter((f) => company[f]).map((f) => [f, company[f] as string]),
        );
        if (existingId) {
          const current = companies.get(existingId)!;
          const patch: CompanyInput = patchFor(current as unknown as Record<string, unknown>, fields, req.onExisting);
          const setEffectif =
            effectif !== undefined &&
            (req.onExisting === "overwrite" ? current.effectif !== effectif : req.onExisting === "fill" && current.effectif === null);
          if (setEffectif) patch.effectif = effectif;
          const customFields = customPatch(current.customFields, companyCustom, req.onExisting);
          if (Object.keys(patch).length || customFields) {
            const updated = await updateCompany(existingId, { ...patch, customFields });
            indexCompany(updated);
            if (!result.companies.createdIds.includes(existingId) && !result.companies.updatedIds.includes(existingId)) {
              result.companies.updatedIds.push(existingId);
            }
          }
          companyId = existingId;
        } else if (company.nom) {
          const created = await createCompany({ ...(fields as CompanyInput), effectif, customFields: companyCustom });
          indexCompany(created);
          result.companies.createdIds.push(created.id);
          companyId = created.id;
        } else if (req.mode === "companies") {
          throw new Error("Nom d'entreprise manquant");
        } else {
          warn("Des lignes ont des informations d'entreprise sans nom d'entreprise : entreprise non créée.");
        }
      } else if (req.mode === "companies") {
        continue;
      }

      if (req.mode === "companies") continue;

      // Contact
      const hasContactData = Object.keys(contact).length > 0 || Object.keys(contactCustom).length > 0;
      if (!hasContactData) continue;

      if (contact.civilite) {
        const civilite = normalizeCivilite(contact.civilite);
        if (civilite) contact.civilite = civilite;
        else {
          warn(`Civilité inconnue « ${contact.civilite} » : ignorée.`);
          delete contact.civilite;
        }
      }

      let category: PersonCategory | undefined;
      if (contact.category) {
        category = CATEGORY_LOOKUP.get(normalizeHeader(contact.category));
        if (!category) warn(`Catégorie inconnue « ${contact.category} » : valeur par défaut utilisée.`);
      }
      let state: PersonState | undefined;
      if (contact.state) {
        state = STATE_LOOKUP.get(normalizeHeader(contact.state));
        if (!state) warn(`État inconnu « ${contact.state} » : valeur par défaut utilisée.`);
      }

      const fields = Object.fromEntries(
        CONTACT_TEXT_FIELDS.filter((f) => contact[f]).map((f) => [f, contact[f] as string]),
      );
      const hasName = Boolean(contact.prenom || contact.nom);
      const existingId =
        (contact.email && contactByEmail.get(contact.email.toLowerCase())) ||
        (contact.linkedinUrl && contactByLinkedin.get(normalizeUrl(contact.linkedinUrl))) ||
        (hasName &&
          contactByName.get(`${normalizeHeader(`${contact.prenom ?? ""} ${contact.nom ?? ""}`)}|${companyId ?? ""}`)) ||
        null;

      if (!existingId) {
        if (!hasName) throw new Error("Contact introuvable et prénom/nom manquants pour le créer");
        const created = await createContact(
          {
            ...(fields as ContactInput),
            source: fields.source ?? req.defaults.source ?? null,
            category: category ?? req.defaults.category,
            state: state ?? (category ? undefined : req.defaults.state),
            companyId,
            customFields: contactCustom,
          },
          userId,
        );
        indexContact(created);
        result.contacts.created++;
        continue;
      }

      const current = await prisma.contact.findUnique({ where: { id: existingId } });
      if (!current || req.onExisting === "skip") {
        result.contacts.unchanged++;
        continue;
      }
      const patch: ContactInput = patchFor(current as unknown as Record<string, unknown>, fields, req.onExisting);
      if (req.onExisting === "overwrite") {
        if (category && category !== current.category) patch.category = category;
        if (state && state !== current.state) patch.state = state;
      }
      if (companyId && companyId !== current.companyId && (req.onExisting === "overwrite" || !current.companyId)) {
        patch.companyId = companyId;
      }
      const customFields = customPatch(current.customFields, contactCustom, req.onExisting);
      if (customFields) patch.customFields = customFields;

      if (Object.keys(patch).length === 0) {
        result.contacts.unchanged++;
        continue;
      }
      const updated = await updateContact(existingId, patch, userId);
      if (updated) indexContact(updated);
      result.contacts.updated++;
    } catch (error) {
      result.errors.push({ line, message: error instanceof Error ? error.message : "Erreur inattendue" });
    }
  }

  return result;
}
