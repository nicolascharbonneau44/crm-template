import { prisma } from "@/lib/prisma";

export const CUSTOM_COLUMN_TYPES = ["text", "number", "date", "boolean"] as const;
export type CustomColumnType = (typeof CUSTOM_COLUMN_TYPES)[number];
export type CustomEntityType = "contact" | "company" | "action";

export type CustomColumnRecord = {
  id: string;
  entityType: string;
  key: string;
  label: string;
  type: string;
  sortOrder: number;
};

export function isCustomColumnType(value: unknown): value is CustomColumnType {
  return typeof value === "string" && CUSTOM_COLUMN_TYPES.includes(value as CustomColumnType);
}

export function slugFromLabel(label: string) {
  const base = label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return base || `col_${Date.now().toString(36)}`;
}

export function parseCustomFields(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

export function stringifyCustomFields(fields: Record<string, unknown>) {
  return JSON.stringify(fields ?? {});
}

export function formatCustomFieldValue(value: unknown, type: string) {
  if (value === null || value === undefined || value === "") return "—";
  if (type === "boolean") return value === true || value === "true" ? "Oui" : "Non";
  if (type === "number") return String(value);
  return String(value);
}

export function normalizeCustomFieldInput(type: string, raw: unknown) {
  if (raw === null || raw === undefined || raw === "") return null;
  if (type === "boolean") {
    if (typeof raw === "boolean") return raw;
    if (raw === "true" || raw === "1" || raw === "on") return true;
    if (raw === "false" || raw === "0") return false;
    return Boolean(raw);
  }
  if (type === "number") {
    const n = typeof raw === "number" ? raw : Number(String(raw).replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  if (type === "date") {
    const s = String(raw).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  }
  return String(raw).trim();
}

export async function validateCustomFields(
  entityType: CustomEntityType,
  input: Record<string, unknown>,
) {
  const columns = await listCustomColumns(entityType);
  const byKey = new Map(columns.map((c) => [c.key, c]));
  const normalized: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(input)) {
    const column = byKey.get(key);
    if (!column) {
      const available = Array.from(byKey.keys()).join(", ") || "aucune";
      throw new Error(`Colonne personnalisée inconnue « ${key} ». Colonnes disponibles : ${available}.`);
    }
    const value = normalizeCustomFieldInput(column.type, raw);
    if (value === null && raw !== null && raw !== undefined && raw !== "") {
      throw new Error(`Valeur invalide pour « ${key} » (type ${column.type}) : ${JSON.stringify(raw)}.`);
    }
    normalized[key] = value;
  }
  return normalized;
}

export async function listCustomColumns(entityType: CustomEntityType) {
  return prisma.customColumn.findMany({
    where: { entityType },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
}

export async function createCustomColumn(input: {
  entityType: CustomEntityType;
  label: string;
  type?: string;
  key?: string;
}) {
  const label = input.label.trim();
  if (!label) throw new Error("Label requis");
  const type = isCustomColumnType(input.type) ? input.type : "text";
  let key = (input.key?.trim() || slugFromLabel(label)).replace(/[^a-z0-9_]/gi, "_").toLowerCase();
  if (!key) key = `col_${Date.now().toString(36)}`;

  const max = await prisma.customColumn.aggregate({
    where: { entityType: input.entityType },
    _max: { sortOrder: true },
  });

  try {
    return await prisma.customColumn.create({
      data: {
        entityType: input.entityType,
        key,
        label,
        type,
        sortOrder: (max._max.sortOrder ?? 0) + 1,
      },
    });
  } catch {
    throw new Error("Cette clé de colonne existe déjà");
  }
}

export async function updateCustomColumn(
  id: string,
  input: { label?: string; type?: string; sortOrder?: number },
) {
  return prisma.customColumn.update({
    where: { id },
    data: {
      ...(input.label !== undefined ? { label: input.label.trim() } : {}),
      ...(input.type !== undefined && isCustomColumnType(input.type) ? { type: input.type } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    },
  });
}

export async function deleteCustomColumn(id: string) {
  return prisma.customColumn.delete({ where: { id } });
}
