import { randomBytes } from "crypto";
import { Prisma } from "@prisma/client";
import type { PersonCategory, PersonState } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createAction } from "@/lib/actions";
import { runImport } from "@/lib/import/apply";
import { contactDisplayName, formatDateTime, isPersonCategory, isPersonState } from "@/lib/labels";
import { safeEqual } from "@/lib/oauth";

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

type LeadItem = {
  lead?: Record<string, unknown>;
  person?: Record<string, unknown>;
  reply?: Message | null;
  trigger_message?: Message | null;
  messages?: Message[];
  reply_channel?: unknown;
  company_linkedin_url?: unknown;
  person_linkedin_url?: unknown;
};

const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");

function newToken() {
  return randomBytes(24).toString("base64url");
}

export async function getMeetMagnetWebhook() {
  const existing = await prisma.inboundWebhook.findUnique({ where: { source: MEETMAGNET_SOURCE } });
  if (existing) return existing;
  try {
    return await prisma.inboundWebhook.create({ data: { source: MEETMAGNET_SOURCE, token: newToken() } });
  } catch {
    return prisma.inboundWebhook.findUniqueOrThrow({ where: { source: MEETMAGNET_SOURCE } });
  }
}

export async function regenerateMeetMagnetToken() {
  await getMeetMagnetWebhook();
  return prisma.inboundWebhook.update({ where: { source: MEETMAGNET_SOURCE }, data: { token: newToken() } });
}

export async function updateMeetMagnetSettings(input: {
  defaultCategory?: unknown;
  defaultState?: unknown;
  createTask?: unknown;
}) {
  await getMeetMagnetWebhook();
  if (input.defaultCategory !== undefined && !isPersonCategory(input.defaultCategory)) {
    throw new WebhookPayloadError("Catégorie invalide");
  }
  if (input.defaultState !== undefined && !isPersonState(input.defaultState)) {
    throw new WebhookPayloadError("État invalide");
  }
  return prisma.inboundWebhook.update({
    where: { source: MEETMAGNET_SOURCE },
    data: {
      ...(input.defaultCategory !== undefined ? { defaultCategory: input.defaultCategory as string } : {}),
      ...(input.defaultState !== undefined ? { defaultState: input.defaultState as string } : {}),
      ...(typeof input.createTask === "boolean" ? { createTask: input.createTask } : {}),
    },
  });
}

export async function findMeetMagnetWebhookByToken(token: string) {
  const webhook = await prisma.inboundWebhook.findUnique({ where: { source: MEETMAGNET_SOURCE } });
  if (!webhook || !token || !safeEqual(token, webhook.token)) return null;
  return webhook;
}

export function webhookUrl(baseUrl: string, token: string) {
  return `${baseUrl}/api/webhooks/meetmagnet/${token}`;
}

/** « S11_50 » → « 11-50 », « S10001_PLUS » → « 10001+ » (converti ensuite en effectif approximatif). */
function companySizeToEffectif(size: string) {
  const match = size.match(/(\d+)\D+(\d+|plus)/i);
  if (!match) return /^\D*\d+\D*$/.test(size) ? size.replace(/\D/g, "") : "";
  return match[2].toLowerCase() === "plus" ? `${match[1]}+` : `${match[1]}-${match[2]}`;
}

// Charges utiles d'exemple envoyées par le bouton « Tester l'envoi » de MeetMagnet.
const isTestLead = (id: string) => /^0{8}-0{4}-4000-8000-/.test(id);

function replyChannel(item: LeadItem, reply: Message) {
  const raw = `${str(item.reply_channel)} ${str(reply.reply_channel)} ${str(reply.channel)}`.toLowerCase();
  return raw.includes("linkedin") ? "linkedin" : "email";
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

async function logDelivery(data: {
  event: string;
  externalId: string | null;
  status: LeadResult["status"];
  summary: string;
  contactId?: string | null;
}) {
  await prisma.webhookDelivery.create({
    data: { source: MEETMAGNET_SOURCE, ...data, contactId: data.contactId ?? null },
  });
}

async function processLead(
  event: string,
  item: LeadItem,
  settings: { defaultCategory: string; defaultState: string; createTask: boolean },
): Promise<LeadResult> {
  const lead = item.lead ?? {};
  const person = item.person ?? {};
  const leadId = str(lead.id);
  const reply = item.reply ?? item.trigger_message ?? null;
  const replyId = reply ? str(reply.id) : "";

  const prenom = str(lead.person_firstname) || str(person.firstname);
  const nom = str(lead.person_lastname) || str(person.lastname);
  const name = contactDisplayName({ prenom, nom });

  if (isTestLead(leadId)) {
    const summary = `Test reçu (${name}) — aucune donnée créée`;
    await logDelivery({ event, externalId: null, status: "test", summary });
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

  const providerId = str(lead.person_provider_id) || str(person.urn);
  const linkedin = str(item.person_linkedin_url) || (providerId ? `https://www.linkedin.com/in/${providerId}` : "");
  const industry = str(lead.company_industry);
  const columns = [
    "contact.prenom",
    "contact.nom",
    "contact.email",
    "contact.poste",
    "contact.linkedinUrl",
    "contact.adresse",
    "contact.description",
    "contact.source",
    "company.nom",
    "company.linkedinUrl",
    "company.effectif",
    "company.description",
  ];
  const row = [
    prenom,
    nom,
    str(lead.person_email) || str(person.email),
    str(lead.person_headline) || str(person.headline),
    linkedin,
    str(person.address),
    str(lead.activity_summary),
    "MeetMagnet",
    str(lead.company_name),
    str(item.company_linkedin_url),
    companySizeToEffectif(str(lead.company_size)),
    industry ? `Secteur : ${industry}` : "",
  ];

  const imported = await runImport({
    mode: "contacts",
    onExisting: "fill",
    columns,
    rows: [row],
    firstLine: 1,
    defaults: {
      category: settings.defaultCategory as PersonCategory,
      state: settings.defaultState as PersonState,
      source: "MeetMagnet",
    },
  });
  const contactId = imported.contactIds[0];
  if (!contactId) {
    const summary = `Erreur : ${imported.errors[0]?.message ?? "contact non créé"} (${name})`;
    await logDelivery({ event, externalId: null, status: "error", summary });
    return { status: "error", summary };
  }

  const created = imported.contacts.created === 1;
  let withTask = false;
  if (reply && settings.createTask && str(reply.content)) {
    const channel = replyChannel(item, reply);
    await createAction({
      contactId,
      channel,
      titre: `Répondre à ${name} (${channel === "linkedin" ? "LinkedIn" : "e-mail"})`,
      contenu: replyContent(reply, item.messages ?? []),
      statut: "a_faire",
      datePrevue: new Date(),
    });
    withTask = true;
  }

  const summary = `${created ? "Contact créé" : "Contact mis à jour"} : ${name}${withTask ? " + action « Répondre »" : ""}`;
  try {
    await logDelivery({ event, externalId, status: created ? "created" : "updated", summary, contactId });
  } catch (error) {
    // Deux livraisons simultanées de la même réponse : la seconde est un doublon.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { status: "duplicate", summary: "Déjà reçu", contactId };
    }
    throw error;
  }
  return { status: created ? "created" : "updated", summary, contactId };
}

export async function processMeetMagnetPayload(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new WebhookPayloadError("Corps JSON attendu");
  }
  const body = payload as { event?: unknown; leads?: unknown };
  if (!Array.isArray(body.leads) || body.leads.length === 0) {
    throw new WebhookPayloadError("Champ « leads » manquant ou vide");
  }
  const event = str(body.event) || "UNKNOWN";
  const settings = await getMeetMagnetWebhook();

  const results: LeadResult[] = [];
  for (const item of body.leads.slice(0, MAX_LEADS)) {
    if (!item || typeof item !== "object") {
      results.push({ status: "error", summary: "Élément de « leads » invalide" });
      continue;
    }
    try {
      results.push(await processLead(event, item as LeadItem, settings));
    } catch (error) {
      console.error("[webhook meetmagnet]", error);
      const summary = `Erreur : ${error instanceof Error ? error.message : "inattendue"}`;
      await logDelivery({ event, externalId: null, status: "error", summary }).catch(() => undefined);
      results.push({ status: "error", summary });
    }
  }
  return { event, results };
}

export async function listMeetMagnetDeliveries(limit = 15) {
  return prisma.webhookDelivery.findMany({
    where: { source: MEETMAGNET_SOURCE },
    orderBy: { receivedAt: "desc" },
    take: limit,
  });
}
