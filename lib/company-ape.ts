import { prisma } from "@/lib/prisma";
import { apeLabel, isKnownApe, normalizeApe, searchKey } from "@/lib/ape";
import { createCompany, type CompanyInput } from "@/lib/companies";

// Annuaire officiel des entreprises (base SIRENE de l'INSEE), API publique sans clé.
// https://recherche-entreprises.api.gouv.fr — limite : 7 requêtes / seconde.
const API = "https://recherche-entreprises.api.gouv.fr/search";

export const APE_MISSING_MESSAGE = "Vous venez de créer une nouvelle fiche société, merci d'ajouter le code APE.";

export type SireneCandidate = {
  siren: string;
  siret: string | null;
  nom: string;
  ville: string | null;
  codePostal: string | null;
  codeApe: string | null;
  libelleApe: string | null;
};

export type ApeLookup =
  | { status: "provided"; code: string; label: string | null }
  | { status: "found"; code: string; label: string | null; source: "siret" | "nom"; entreprise: SireneCandidate }
  | { status: "missing"; message: string; candidates: SireneCandidate[] };

type ApiResult = {
  siren: string;
  nom_complet?: string;
  nom_raison_sociale?: string | null;
  sigle?: string | null;
  activite_principale?: string | null;
  etat_administratif?: string;
  nature_juridique?: string | null;
  siege?: { siret?: string; libelle_commune?: string; code_postal?: string; liste_enseignes?: string[] | null; nom_commercial?: string | null };
  matching_etablissements?: { siret?: string; liste_enseignes?: string[] | null; nom_commercial?: string | null }[];
};

function lookupEnabled() {
  return (process.env.SIRENE_LOOKUP ?? "on").toLowerCase() !== "off";
}

const LEGAL_FORMS = /\b(sas|sasu|sa|sarl|eurl|snc|sci|scop|sca|selarl|scea|gie|sasu|ste|societe|ets|etablissements)\b/g;

function normalizeName(value: string) {
  return searchKey(value)
    .replace(/&/g, " et ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(LEGAL_FORMS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toCandidate(r: ApiResult): SireneCandidate {
  const code = r.activite_principale ? normalizeApe(r.activite_principale) ?? null : null;
  const known = code && isKnownApe(code) ? code : null;
  return {
    siren: r.siren,
    siret: r.siege?.siret ?? null,
    nom: r.nom_complet ?? r.nom_raison_sociale ?? r.siren,
    ville: r.siege?.libelle_commune ?? null,
    codePostal: r.siege?.code_postal ?? null,
    codeApe: known,
    libelleApe: known ? apeLabel(known) ?? null : null,
  };
}

function namesOf(r: ApiResult) {
  const names = [r.nom_raison_sociale, r.sigle, r.nom_complet, r.siege?.nom_commercial, ...(r.siege?.liste_enseignes ?? [])];
  for (const e of r.matching_etablissements ?? []) names.push(e.nom_commercial, ...(e.liste_enseignes ?? []));
  return new Set(names.filter((n): n is string => !!n).map(normalizeName).filter(Boolean));
}

async function querySirene(q: string, perPage = 10): Promise<ApiResult[]> {
  const url = `${API}?${new URLSearchParams({ q, per_page: String(perPage), etat_administratif: "A" })}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(6000), headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Annuaire des entreprises : HTTP ${response.status}`);
  const data = (await response.json()) as { results?: ApiResult[] };
  return (data.results ?? []).filter((r) => r.etat_administratif !== "C");
}

/** Recherche libre (nom, SIREN, SIRET…) : quelques entreprises actives avec leur code APE. */
export async function searchSirene(query: string, limit = 5): Promise<SireneCandidate[]> {
  if (!query.trim()) return [];
  return (await querySirene(query.trim(), Math.min(Math.max(limit, 1), 25))).map(toCandidate);
}

/**
 * Cherche le code APE d'une entreprise : par SIRET/SIREN (certain), sinon par nom exact.
 * Plusieurs entreprises portant exactement ce nom → départage par code postal si l'adresse en contient un ;
 * sinon on ne devine pas (renvoie les candidats).
 */
export async function lookupApe(input: { nom?: string | null; siret?: string | null; adresse?: string | null }): Promise<ApeLookup> {
  const missing = (candidates: SireneCandidate[] = []): ApeLookup => ({ status: "missing", message: APE_MISSING_MESSAGE, candidates });
  if (!lookupEnabled()) return missing();
  try {
    const digits = (input.siret ?? "").replace(/\D/g, "");
    if (digits.length === 14 || digits.length === 9) {
      const hit = (await querySirene(digits, 1)).find((r) => r.siren === digits.slice(0, 9));
      const candidate = hit ? toCandidate(hit) : null;
      if (candidate?.codeApe) return { status: "found", code: candidate.codeApe, label: candidate.libelleApe, source: "siret", entreprise: candidate };
    }

    const nom = input.nom?.trim();
    if (!nom) return missing();
    const target = normalizeName(nom);
    if (!target) return missing();
    const results = await querySirene(nom);
    let exact = results.filter((r) => namesOf(r).has(target));
    const postal = input.adresse?.match(/\b\d{5}\b/)?.[0];
    if (exact.length > 1 && postal) {
      const samePostal = exact.filter((r) => r.siege?.code_postal === postal);
      if (samePostal.length) exact = samePostal;
    }
    // Homonymes : on écarte les sociétés civiles (SCI patrimoniales « SCI SODEBO »…) si une seule autre reste.
    if (new Set(exact.map((r) => r.siren)).size > 1) {
      const operating = exact.filter((r) => !(r.nature_juridique ?? "").startsWith("65"));
      if (new Set(operating.map((r) => r.siren)).size === 1) exact = operating;
    }
    const sirens = new Set(exact.map((r) => r.siren));
    if (sirens.size === 1) {
      const candidate = toCandidate(exact[0]);
      if (candidate.codeApe) return { status: "found", code: candidate.codeApe, label: candidate.libelleApe, source: "nom", entreprise: candidate };
    }
    return missing((exact.length ? exact : results).slice(0, 5).map(toCandidate).filter((c) => c.codeApe));
  } catch (error) {
    console.warn("Recherche du code APE impossible :", error instanceof Error ? error.message : error);
    return missing();
  }
}

/** Crée une fiche société ; sans code APE fourni, le cherche dans l'annuaire des entreprises. */
export async function createCompanyWithApe(input: CompanyInput) {
  const provided = normalizeApe(input.codeNaf ?? null);
  if (provided) {
    const company = await createCompany(input);
    return { company, ape: { status: "provided", code: provided, label: apeLabel(provided) ?? null } as ApeLookup };
  }
  const ape = await lookupApe({ nom: input.nom, siret: input.siret, adresse: input.adresse });
  const company = await createCompany(ape.status === "found" ? { ...input, codeNaf: ape.code } : input);
  return { company, ape };
}

// Imports / webhooks : recherche en arrière-plan, une entreprise à la fois (respect de la limite de l'API).
const queue: string[] = [];
let running = false;

export function enrichApeInBackground(companyIds: string[]) {
  if (!lookupEnabled() || !companyIds.length) return;
  queue.push(...companyIds.filter((id) => !queue.includes(id)));
  if (running) return;
  running = true;
  void (async () => {
    try {
      while (queue.length) {
        const id = queue.shift()!;
        const company = await prisma.company.findUnique({ where: { id }, select: { nom: true, siret: true, adresse: true, codeNaf: true } });
        if (!company || company.codeNaf) continue;
        const ape = await lookupApe(company);
        if (ape.status === "found") {
          await prisma.company.updateMany({ where: { id, codeNaf: null }, data: { codeNaf: ape.code } });
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    } finally {
      running = false;
    }
  })();
}
