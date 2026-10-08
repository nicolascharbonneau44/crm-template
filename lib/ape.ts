// Partagé client/serveur : codes APE (nomenclature NAF rév. 2 de l'INSEE).
import { APE_CODES } from "@/lib/ape-codes";

const LABELS = new Map<string, string>(APE_CODES.map(([code, label]) => [code, label]));

/** « 7022z », « 70 22 Z », « 70.22Z » → « 70.22Z ». Une valeur hors format est conservée telle quelle (en majuscules). */
export function normalizeApe(value: string | null | undefined) {
  if (value === null || value === undefined) return value;
  const trimmed = value.trim().toUpperCase();
  if (!trimmed) return null;
  const compact = trimmed.replace(/[\s.]/g, "");
  return /^\d{4}[A-Z]$/.test(compact) ? `${compact.slice(0, 2)}.${compact.slice(2)}` : trimmed;
}

export function apeLabel(code: string | null | undefined) {
  return code ? LABELS.get(normalizeApe(code) ?? "") : undefined;
}

export function isKnownApe(code: string | null | undefined) {
  return apeLabel(code) !== undefined;
}

export function searchKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}
