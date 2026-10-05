import { randomBytes } from "crypto";
import { Prisma, type WebhookEndpoint } from "@prisma/client";
import type { PersonCategory, PersonState } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createAction } from "@/lib/actions";
import { listCustomColumns } from "@/lib/custom-columns";
import { runImport } from "@/lib/import/apply";
import { parseTarget } from "@/lib/import/fields";
import { contactDisplayName, formatDateTime, isPersonCategory, isPersonState } from "@/lib/labels";
import { isKnownMeetMagnetPath, resolveMapping, type WebhookMapping } from "@/lib/webhooks/meetmagnet-fields";

export const MEETMAGNET_SOURCE = "meetmagnet";
const MAX_LEADS = 100;

export class WebhookPayloadError extends Error {}

type Message = {
  id?: unknown;
  direction?: unknown;
  channel?: unknown;
  reply_channel?: unknown;
  subject?: unknown;
  content?: unknown;
  sent_at?: unknown;
};

type LeadItem = Record<string, unknown> & {
  lead?: Record<string, unknown>;
  person?: Record<string, unknown>;
  reply?: Message | null;
  trigger_message?: Message | null;
  messages?: Message[];
};

const str = (value: unknown) =>
  typeof value === "string" ? value.trim() : typeof value === "number" || typeof value === "boolean" ? String(value) : "";

function newToken() {
  return randomBytes(24).toString("base64url");
}

// ——— Points d'entrée ———

export function webhookUrl(baseUrl: string, token: string) {
  return `${baseUrl}/api/webhooks/meetmagnet/${token}`;
}

export async function listEndpoints() {
  return prisma.webhookEndpoint.findMany({ where: { provider: MEETMAGNET_SOURCE }, orderBy: { createdAt: "asc" } });
}

/** Garantit au moins un point d'entrée pour que l'onglet Intégrations ne soit jamais vide. */
export async function ensureDefaultEndpoint() {
  const count = await prisma.webhookEndpoint.count({ where: { provider: MEETMAGNET_SOURCE } });
  if (count === 0) await createEndpoint("MeetMagnet — réponses");
}

export async function createEndpoint(name: unknown) {
  const label = typeof name === "string" && name.trim() ? name.trim().slice(0, 120) : "Nouveau webhook MeetMagnet";
  return prisma.webhookEndpoint.create({ data: { name: label, provider: MEETMAGNET_SOURCE, token: newToken() } });
}

export async function regenerateEndpointToken(id: string) {
  return prisma.webhookEndpoint.update({ where: { id }, data: { token: newToken() } });
}

export async function deleteEndpoint(id: string) {
  await prisma.webhookEndpoint.delete({ where: { id } });
}

export async function findEndpointByToken(token: string) {
  if (!token) return null;
  return prisma.webhookEndpoint.findUnique({ where: { token } });
}

async function validateMapping(input: unknown): Promise<string | null> {
  if (input === null) return null;
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new WebhookPayloadError("Correspondance invalide");
  const [contactColumns, companyColumns] = await Promise.all([listCustomColumns("contact"), listCustomColumns("company")]);
  const custom = {
    contact: new Set(contactColumns.map((c) => c.key)),
    company: new Set(companyColumns.map((c) => c.key)),
  };
  const clean: WebhookMapping = {};
  for (const [path, target] of Object.entries(input as Record<string, unknown>)) {
    if (!isKnownMeetMagnetPath(path)) continue;
    if (target === "" || target === null) {
      clean[path] = "";
      continue;
    }
    const parsed = typeof target === "string" ? parseTarget(target) : null;
    if (!parsed || parsed.kind === "new") throw new WebhookPayloadError(`Champ du CRM inconnu : ${String(target)}`);
    if (parsed.kind === "custom" && !custom[parsed.entity].has(parsed.key)) {
      throw new WebhookPayloadError(`Colonne personnalisée inconnue : ${parsed.key}`);
    }
    clean[path] = target as string;
  }
  return JSON.stringify(clean);
}

export async function updateEndpoint(
  id: string,
  input: {
    name?: unknown;
    sourceLabel?: unknown;
    defaultCategory?: unknown;
    defaultState?: unknown;
    defaultOwnerId?: unknown;
    createTask?: unknown;
    mapping?: unknown;
  },
) {
  if (input.defaultOwnerId !== undefined && input.defaultOwnerId !== null && input.defaultOwnerId !== "") {
    const exists =
      typeof input.defaultOwnerId === "string" && (await prisma.user.findUnique({ where: { id: input.defaultOwnerId } }));
    if (!exists) throw new WebhookPayloadError("Responsable inconnu");
  }
  if (input.defaultCategory !== undefined && !isPersonCategory(input.defaultCategory)) {
    throw new WebhookPayloadError("Catégorie invalide");
  }
  if (input.defaultState !== undefined && !isPersonState(input.defaultState)) {
    throw new WebhookPayloadError("État invalide");
  }
  const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : undefined);
  const name = text(input.name, 120);
  if (input.name !== undefined && !name) throw new WebhookPayloadError("Le nom est requis");

  return prisma.webhookEndpoint.update({
    where: { id },
    data: {
      ...(name ? { name } : {}),
      ...(input.sourceLabel !== undefined ? { sourceLabel: text(input.sourceLabel, 200) ?? "" } : {}),
      ...(input.defaultCategory !== undefined ? { defaultCategory: input.defaultCategory as string } : {}),
      ...(input.defaultState !== undefined ? { defaultState: input.defaultState as string } : {}),
      ...(typeof input.createTask === "boolean" ? { createTask: input.createTask } : {}),
      ...(input.defaultOwnerId !== undefined ? { defaultOwnerId: (input.defaultOwnerId as string) || null } : {}),
      ...(input.mapping !== undefined ? { mapping: await validateMapping(input.mapping) } : {}),
    },
  });
}

// ——— Lecture de la charge utile ———

const FALLBACKS: Record<string, string[]> = {
  "lead.person_firstname": ["person.firstname"],
  "lead.person_lastname": ["person.lastname"],
  "lead.person_email": ["person.email"],
  "lead.person_headline": ["person.headline"],
  "lead.person_provider_id": ["person.urn"],
  "reply.subject": ["trigger_message.subject"],
  "reply.content": ["trigger_message.content"],
  "reply.sent_at": ["trigger_message.sent_at"],
  reply_channel: ["reply.reply_channel", "trigger_message.channel"],
};

function readPath(item: LeadItem, path: string): string {
  for (const candidate of [path, ...(FALLBACKS[path] ?? [])]) {
    let value: unknown = item;
    for (const key of candidate.split(".")) {
      value = value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
    }
    const result = str(value);
    if (result) return result;
  }
  if (path === "person_linkedin_url") {
    const providerId = readPath(item, "lead.person_provider_id");
    return providerId ? `https://www.linkedin.com/in/${providerId}` : "";
  }
  return "";
}

/** « S11_50 » → « 11-50 », « S10001_PLUS » → « 10001+ » (converti ensuite en effectif approximatif). */
function companySizeToEffectif(size: string) {
  const match = size.match(/^S?(\d+)_(\d+|plus)$/i);
  if (!match) return size;
  return match[2].toLowerCase() === "plus" ? `${match[1]}+` : `${match[1]}-${match[2]}`;
}

// Charges utiles d'exemple envoyées par le bouton « Tester l'envoi » de MeetMagnet.
const isTestLead = (id: string) => /^0{8}-0{4}-4000-8000-/.test(id);

function replyChannel(item: LeadItem) {
  return readPath(item, "reply_channel").toLowerCase().includes("linkedin") ? "linkedin" : "email";
}

function formatMessageDate(value: unknown) {
  const date = new Date(str(value));
  return Number.isNaN(date.getTime()) ? "" : formatDateTime(date);
}

function replyContent(reply: Message, messages: Message[]) {
  const date = formatMessageDate(reply.sent_at);
  const subject = str(reply.subject);
  const lines = [
    `Réponse reçue via MeetMagnet${date ? ` le ${date}` : ""}${subject ? ` — ${subject}` : ""} :`,
    "",
    str(reply.content),
  ];
  const history = [...messages]
    .filter((m) => str(m.content))
    .sort((a, b) => new Date(str(a.sent_at)).getTime() - new Date(str(b.sent_at)).getTime());
  if (history.length > 1) {
    lines.push("", "— Conversation —");
    for (const m of history) {
      const who = str(m.direction).toUpperCase() === "INBOUND" ? "Prospect" : "Vous";
      const when = formatMessageDate(m.sent_at);
      lines.push("", `${who}${when ? ` · ${when}` : ""} :`, str(m.content).slice(0, 1500));
    }
  }
  return lines.join("\n").slice(0, 10000);
}

type LeadResult = { status: "created" | "updated" | "duplicate" | "test" | "error"; summary: string; contactId?: string };

async function logDelivery(
  endpoint: WebhookEndpoint,
  data: { event: string; externalId: string | null; status: LeadResult["status"]; summary: string; contactId?: string | null },
) {
  await prisma.webhookDelivery.create({
    data: { source: MEETMAGNET_SOURCE, endpointId: endpoint.id, ...data, contactId: data.contactId ?? null },
  });
}

async function processLead(event: string, item: LeadItem, endpoint: WebhookEndpoint): Promise<LeadResult> {
  const leadId = readPath(item, "lead.id");
  const reply = item.reply ?? item.trigger_message ?? null;
  const replyId = reply ? str(reply.id) : "";
  const name = contactDisplayName({
    prenom: readPath(item, "lead.person_firstname"),
    nom: readPath(item, "lead.person_lastname"),
  });

  if (isTestLead(leadId)) {
    const summary = `Test reçu (${name}) — aucune donnée créée`;
    await logDelivery(endpoint, { event, externalId: null, status: "test", summary });
    return { status: "test", summary };
  }

  // Une même réponse (ou un même prospect pour les autres événements) n'est traitée qu'une fois.
  const externalId = replyId ? `reply:${replyId}` : leadId ? `${event}:${leadId}` : null;
  if (externalId) {
    const already = await prisma.webhookDelivery.findUnique({
      where: { source_externalId: { source: MEETMAGNET_SOURCE, externalId } },
    });
    if (already) return { status: "duplicate", summary: "Déjà reçu", contactId: already.contactId ?? undefined };
  }

  const columns: string[] = [];
  const row: string[] = [];
  for (const [path, target] of Object.entries(resolveMapping(endpoint.mapping))) {
    if (!target) continue;
    const value = readPath(item, path);
    columns.push(target);
    row.push(target === "company.effectif" ? companySizeToEffectif(value) : value);
  }
  const sourceLabel = endpoint.sourceLabel.trim();
  if (sourceLabel && !columns.includes("contact.source")) {
    columns.push("contact.source");
    row.push(sourceLabel);
  }

  const imported = await runImport({
    mode: "contacts",
    onExisting: "fill",
    columns,
    rows: [row],
    firstLine: 1,
    defaults: {
      category: endpoint.defaultCategory as PersonCategory,
      state: endpoint.defaultState as PersonState,
      source: sourceLabel || undefined,
      ownerId: endpoint.defaultOwnerId ?? undefined,
    },
  });
  const contactId = imported.contactIds[0];
  if (!contactId) {
    const summary = `Erreur : ${imported.errors[0]?.message ?? "contact non créé (aucun prénom, nom ou email associé)"} (${name})`;
    await logDelivery(endpoint, { event, externalId: null, status: "error", summary });
    return { status: "error", summary };
  }

  const created = imported.contacts.created === 1;
  let withTask = false;
  if (reply && endpoint.createTask && str(reply.content)) {
    const channel = replyChannel(item);
    await createAction(
      {
        contactId,
        channel,
        titre: `Répondre à ${name} (${channel === "linkedin" ? "LinkedIn" : "e-mail"})`,
        contenu: replyContent(reply, item.messages ?? []),
        statut: "a_faire",
        datePrevue: new Date(),
      },
      endpoint.defaultOwnerId,
    );
    withTask = true;
  }

  const summary = `${created ? "Contact créé" : "Contact mis à jour"} : ${name}${withTask ? " + action « Répondre »" : ""}`;
  try {
    await logDelivery(endpoint, { event, externalId, status: created ? "created" : "updated", summary, contactId });
  } catch (error) {
    // Deux livraisons simultanées de la même réponse : la seconde est un doublon.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { status: "duplicate", summary: "Déjà reçu", contactId };
    }
    throw error;
  }
  return { status: created ? "created" : "updated", summary, contactId };
}

export async function processMeetMagnetPayload(payload: unknown, endpoint: WebhookEndpoint) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new WebhookPayloadError("Corps JSON attendu");
  }
  const body = payload as { event?: unknown; leads?: unknown };
  if (!Array.isArray(body.leads) || body.leads.length === 0) {
    throw new WebhookPayloadError("Champ « leads » manquant ou vide");
  }
  const event = str(body.event) || "UNKNOWN";

  const results: LeadResult[] = [];
  for (const item of body.leads.slice(0, MAX_LEADS)) {
    if (!item || typeof item !== "object") {
      results.push({ status: "error", summary: "Élément de « leads » invalide" });
      continue;
    }
    try {
      results.push(await processLead(event, item as LeadItem, endpoint));
    } catch (error) {
      console.error("[webhook meetmagnet]", error);
      const summary = `Erreur : ${error instanceof Error ? error.message : "inattendue"}`;
      await logDelivery(endpoint, { event, externalId: null, status: "error", summary }).catch(() => undefined);
      results.push({ status: "error", summary });
    }
  }
  return { event, results };
}

export async function listDeliveries(limit = 20) {
  const [deliveries, endpoints] = await Promise.all([
    prisma.webhookDelivery.findMany({ where: { source: MEETMAGNET_SOURCE }, orderBy: { receivedAt: "desc" }, take: limit }),
    prisma.webhookEndpoint.findMany({ select: { id: true, name: true } }),
  ]);
  const names = new Map(endpoints.map((e) => [e.id, e.name]));
  return deliveries.map((d) => ({ ...d, endpointName: d.endpointId ? (names.get(d.endpointId) ?? "Webhook supprimé") : "—" }));
}
