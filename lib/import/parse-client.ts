import Papa from "papaparse";

export type ParsedTable = {
  fileName: string;
  headers: string[];
  rows: string[][];
  sheets: string[];
  sheet: string | null;
};

const SPREADSHEET_EXT = ["xlsx", "xlsm", "xlsb", "xls", "ods", "fods", "numbers"];
export const ACCEPTED_FILES = ".csv,.tsv,.txt,.xlsx,.xlsm,.xlsb,.xls,.ods,.numbers,.json";

function cell(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value).replace(/ /g, " ").trim();
}

export function toTable(matrix: unknown[][], fileName: string, sheets: string[] = [], sheet: string | null = null): ParsedTable {
  const clean = matrix.map((r) => (Array.isArray(r) ? r.map(cell) : [])).filter((r) => r.some(Boolean));
  if (clean.length < 2) throw new Error("Le fichier doit contenir une ligne d'en-têtes et au moins une ligne de données.");
  const width = Math.max(...clean.map((r) => r.length));
  const seen = new Map<string, number>();
  const headers = Array.from({ length: width }, (_, i) => {
    const base = clean[0][i] || `Colonne ${i + 1}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count > 1 ? `${base} (${count})` : base;
  });
  const rows = clean.slice(1).map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ""));
  return { fileName, headers, rows, sheets, sheet };
}

function decodeText(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(buffer);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(buffer);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("windows-1252").decode(buffer);
  }
}

export function parseDelimitedText(text: string, fileName: string): ParsedTable {
  const clean = text.replace(/^﻿/, "").replace(/^sep=.\r?\n/i, "");
  const result = Papa.parse<string[]>(clean, { skipEmptyLines: "greedy" });
  return toTable(result.data, fileName);
}

function parseJson(text: string, fileName: string): ParsedTable {
  const data = JSON.parse(text) as unknown;
  const list = Array.isArray(data) ? data : Array.isArray((data as { data?: unknown })?.data) ? (data as { data: unknown[] }).data : null;
  if (!list?.length) throw new Error("Le JSON doit contenir une liste d'objets.");
  if (Array.isArray(list[0])) return toTable(list as unknown[][], fileName);
  const headers = Array.from(new Set(list.flatMap((o) => (o && typeof o === "object" ? Object.keys(o) : []))));
  return toTable([headers, ...list.map((o) => headers.map((h) => (o as Record<string, unknown>)?.[h]))], fileName);
}

function looksLikeSpreadsheet(bytes: Uint8Array) {
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const ole = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
  return zip || ole;
}

export async function readSpreadsheet(buffer: ArrayBuffer, fileName: string, sheetName?: string): Promise<ParsedTable> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(buffer, { type: "array", cellDates: false, dense: true });
  const sheets = workbook.SheetNames;
  const rowCount = (name: string) => {
    const ref = workbook.Sheets[name]?.["!ref"];
    return ref ? XLSX.utils.decode_range(ref).e.r : -1;
  };
  const largest = sheets.reduce((best, name) => (rowCount(name) > rowCount(best) ? name : best), sheets[0]);
  const sheet = sheetName && sheets.includes(sheetName) ? sheetName : largest;
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheet], {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  });
  return toTable(matrix, fileName, sheets, sheet);
}

export async function readFile(file: File, sheetName?: string): Promise<ParsedTable> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const buffer = await file.arrayBuffer();
  if (buffer.byteLength > 20 * 1024 * 1024) throw new Error("Fichier trop volumineux (20 Mo max).");
  if (SPREADSHEET_EXT.includes(ext) || looksLikeSpreadsheet(new Uint8Array(buffer.slice(0, 4)))) {
    return readSpreadsheet(buffer, file.name, sheetName);
  }
  const text = decodeText(buffer);
  if (ext === "json" || /^\s*[[{]/.test(text)) return parseJson(text, file.name);
  return parseDelimitedText(text, file.name);
}

/** Quelques valeurs non vides par colonne, pour l'auto-mapping et l'aperçu. */
export function columnSamples(table: ParsedTable, limit = 20) {
  return table.headers.map((_, i) => {
    const values: string[] = [];
    for (const row of table.rows) {
      if (row[i]) values.push(row[i]);
      if (values.length >= limit) break;
    }
    return values;
  });
}

export function guessColumnType(samples: string[]): "text" | "number" | "date" {
  if (!samples.length) return "text";
  if (samples.every((v) => /^\d{4}-\d{2}-\d{2}/.test(v))) return "date";
  if (samples.every((v) => /^-?\d+([.,]\d+)?$/.test(v.replace(/\s/g, "")) && !/^0\d/.test(v))) return "number";
  return "text";
}
