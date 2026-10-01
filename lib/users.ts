import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { isMailConfigured, sendMail } from "@/lib/mailer";
import { escapeHtml, issuePasswordLink } from "@/lib/password";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class UserError extends Error {}

export type UserSummary = { id: string; email: string; fullName: string | null };

export function userDisplayName(user: { fullName?: string | null; email: string }) {
  return user.fullName?.trim() || user.email;
}

export async function listUsers(): Promise<UserSummary[]> {
  return prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, fullName: true },
  });
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Résout une référence d'utilisateur : « me »/« moi » (utilisateur courant), identifiant, email ou nom.
 * undefined = non fourni, null = « non attribué ».
 */
export async function resolveUserRef(ref: unknown, currentUserId: string | null): Promise<string | null | undefined> {
  if (ref === undefined) return undefined;
  if (ref === null || ref === "" || ref === "none") return null;
  if (typeof ref !== "string") throw new UserError("Utilisateur invalide.");
  const value = ref.trim();
  if (["me", "moi"].includes(value.toLowerCase())) {
    if (!currentUserId) {
      throw new UserError("Utilisateur courant inconnu : précisez le nom ou l'email de l'utilisateur.");
    }
    return currentUserId;
  }
  const users = await listUsers();
  const byId = users.find((u) => u.id === value);
  if (byId) return byId.id;
  const byEmail = users.find((u) => u.email.toLowerCase() === value.toLowerCase());
  if (byEmail) return byEmail.id;
  const target = normalize(value);
  const matches = users.filter((u) => {
    const name = normalize(u.fullName ?? "");
    return name && (name === target || name.split(" ").includes(target) || name.includes(target));
  });
  if (matches.length === 1) return matches[0].id;
  const list = users.map((u) => `${userDisplayName(u)} (${u.email})`).join(", ");
  throw new UserError(
    matches.length > 1
      ? `Plusieurs utilisateurs correspondent à « ${value} » : ${list}.`
      : `Utilisateur « ${value} » introuvable. Utilisateurs : ${list}.`,
  );
}

export async function createUser(input: { email: unknown; fullName: unknown }, invitedBy: string, headers: Headers) {
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const fullName = typeof input.fullName === "string" ? input.fullName.trim().slice(0, 120) : "";
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new UserError("Email invalide.");
  if (!fullName) throw new UserError("Le nom est requis.");
  if (await prisma.user.findUnique({ where: { email } })) throw new UserError("Un utilisateur existe déjà avec cet email.");

  const user = await prisma.user.create({
    data: {
      email,
      fullName,
      role: "admin",
      // Mot de passe inutilisable : l'utilisateur choisit le sien via le lien d'invitation.
      passwordHash: await hashPassword(randomBytes(32).toString("hex")),
    },
    select: { id: true, email: true, fullName: true },
  });
  return { user, ...(await sendInvitation(user, invitedBy, headers)) };
}

export async function sendInvitation(user: UserSummary, invitedBy: string, headers: Headers) {
  const link = await issuePasswordLink(user.id, INVITE_TTL_MS, headers);
  let emailed = false;
  if (isMailConfigured()) {
    const name = userDisplayName(user);
    // Un échec d'envoi ne bloque pas : le lien est de toute façon affiché à l'administrateur.
    await sendMail({
      to: user.email,
      subject: "Votre accès au CRM",
      text: [
        `Bonjour ${name},`,
        "",
        `${invitedBy} vous a créé un accès au CRM.`,
        `Choisissez votre mot de passe ici (lien valable 7 jours) : ${link}`,
        "",
        `Votre identifiant de connexion : ${user.email}`,
      ].join("\n"),
      html: `<div style="font-family:system-ui,-apple-system,sans-serif;color:#37352f;max-width:480px">
<p>Bonjour ${escapeHtml(name)},</p>
<p>${escapeHtml(invitedBy)} vous a créé un accès au CRM.</p>
<p><a href="${link}" style="display:inline-block;background:#37352f;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Choisir mon mot de passe</a></p>
<p style="font-size:13px;color:#6b6b69">Identifiant : ${escapeHtml(user.email)}<br>Lien valable 7 jours, utilisable une seule fois.</p>
</div>`,
    })
      .then(() => {
        emailed = true;
      })
      .catch((error) => console.error("[invitation] envoi impossible", error));
  }
  return { link, emailed };
}

export async function updateUserName(id: string, fullName: unknown) {
  const name = typeof fullName === "string" ? fullName.trim().slice(0, 120) : "";
  if (!name) throw new UserError("Le nom est requis.");
  return prisma.user.update({ where: { id }, data: { fullName: name }, select: { id: true, email: true, fullName: true } });
}

export async function assertUserExists(id: string | null | undefined) {
  if (!id) return;
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  if (!user) throw new UserError("Utilisateur introuvable.");
}
