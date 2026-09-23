import { parseCustomFields, validateCustomFields, type CustomEntityType } from "@/lib/custom-columns";

export type ToolArgs = Record<string, unknown>;

export type ToolContext = {
  userId: string | null;
};

export type JsonSchema = Record<string, unknown>;

export type McpTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  kind: "read" | "write" | "delete";
  handler: (args: ToolArgs, ctx: ToolContext) => Promise<unknown>;
};

/** Erreur « métier » renvoyée telle quelle à Claude (isError: true). */
export class ToolError extends Error {}

export function toolAnnotations(tool: McpTool) {
  return {
    title: tool.title,
    readOnlyHint: tool.kind === "read",
    destructiveHint: tool.kind === "delete",
    idempotentHint: tool.kind !== "write",
    openWorldHint: false,
  };
}

export function toJson(value: unknown) {
  return JSON.stringify(value, (key, v) =>
    key === "customFields" && typeof v === "string" ? parseCustomFields(v) : v,
  );
}

export function requireString(args: ToolArgs, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) throw new ToolError(`Paramètre « ${key} » requis.`);
  return value.trim();
}

export function optionalString(args: ToolArgs, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new ToolError(`« ${key} » doit être une chaîne de caractères.`);
  return value;
}

/** undefined = ne pas toucher, null ou "" = vider le champ. */
export function nullableString(args: ToolArgs, key: string): string | null | undefined {
  if (!(key in args) || args[key] === undefined) return undefined;
  const value = args[key];
  if (value === null) return null;
  if (typeof value !== "string") throw new ToolError(`« ${key} » doit être une chaîne ou null.`);
  return value;
}

export function optionalEnum<T extends string>(args: ToolArgs, key: string, values: readonly T[]): T | undefined {
  const value = args[key];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !values.includes(value as T)) {
    throw new ToolError(`« ${key} » invalide. Valeurs possibles : ${values.join(", ")}.`);
  }
  return value as T;
}

export function nullableDate(args: ToolArgs, key: string): Date | null | undefined {
  if (!(key in args) || args[key] === undefined) return undefined;
  const value = args[key];
  if (value === null || value === "") return null;
  const date = typeof value === "string" ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    throw new ToolError(`« ${key} » doit être une date ISO 8601 (ex. 2026-10-01 ou 2026-10-01T14:00:00+02:00).`);
  }
  return date;
}

export function optionalBoolean(args: ToolArgs, key: string): boolean | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") throw new ToolError(`« ${key} » doit être true ou false.`);
  return value;
}

export async function customFieldsArg(
  args: ToolArgs,
  entityType: CustomEntityType,
): Promise<Record<string, unknown> | undefined> {
  const value = args.customFields;
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new ToolError("« customFields » doit être un objet { cle: valeur }.");
  }
  try {
    return await validateCustomFields(entityType, value as Record<string, unknown>);
  } catch (error) {
    throw new ToolError(error instanceof Error ? error.message : "customFields invalide");
  }
}

export function pagination(args: ToolArgs, defaultSize = 25) {
  const page = Number(args.page ?? 1);
  const pageSize = Number(args.pageSize ?? defaultSize);
  return {
    page: Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1,
    pageSize: Number.isFinite(pageSize) ? Math.min(100, Math.max(1, Math.floor(pageSize))) : defaultSize,
  };
}

export const paginationSchema = {
  page: { type: "integer", minimum: 1, description: "Page (1 par défaut)" },
  pageSize: { type: "integer", minimum: 1, maximum: 100, description: "Résultats par page (25 par défaut, 100 max)" },
};

export const customFieldsSchema = {
  type: "object",
  description:
    "Valeurs des colonnes personnalisées { cle: valeur }. Les clés disponibles sont listées par get_crm_schema. Seules les clés fournies sont modifiées.",
  additionalProperties: true,
};

export function normalizeName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}
