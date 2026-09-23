import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { isMailConfigured, sendMail } from "@/lib/mailer";
import { publicBaseUrl, sha256 } from "@/lib/oauth";

const RESET_TTL_MS = 60 * 60 * 1000;
const RESEND_DELAY_MS = 60 * 1000;
export const MIN_PASSWORD_LENGTH = 8;

export class PasswordError extends Error {}

export function validateNewPassword(password: unknown): string {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    throw new PasswordError(`Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`);
  }
  if (password.length > 200) throw new PasswordError("Mot de passe trop long.");
  return password;
}

/**
 * Adresse publique utilisée dans les emails. Jamais dérivée seule de la requête
 * quand une valeur de confiance existe (évite qu'un en-tête Host forgé détourne le lien).
 */
function trustedBaseUrl(headers: Headers) {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  const railway = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
  if (railway) return `https://${railway}`;
  return publicBaseUrl(headers);
}

/** Ne révèle jamais si l'email existe : l'appelant répond toujours la même chose. */
export async function requestPasswordReset(rawEmail: unknown, headers: Headers) {
  const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
  if (!email) return;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return;

  const recent = await prisma.passwordResetToken.findFirst({
    where: { userId: user.id, createdAt: { gt: new Date(Date.now() - RESEND_DELAY_MS) } },
  });
  if (recent) return;

  const token = randomBytes(32).toString("base64url");
  await prisma.$transaction([
    prisma.passwordResetToken.deleteMany({ where: { userId: user.id } }),
    prisma.passwordResetToken.create({
      data: { tokenHash: sha256(token), userId: user.id, expiresAt: new Date(Date.now() + RESET_TTL_MS) },
    }),
  ]);

  const link = `${trustedBaseUrl(headers)}/reset-password?token=${token}`;
  if (!isMailConfigured()) {
    // Sans SMTP, seul l'administrateur Railway (accès aux logs) peut récupérer le lien.
    console.warn(`[mot de passe] SMTP non configuré — lien de réinitialisation pour ${email} : ${link}`);
    return;
  }

  const name = user.fullName?.trim() || "Bonjour";
  await sendMail({
    to: user.email,
    subject: "Réinitialisation de votre mot de passe CRM",
    text: [
      `${name},`,
      "",
      "Vous avez demandé à réinitialiser votre mot de passe du CRM.",
      `Choisissez un nouveau mot de passe ici (lien valable 1 heure) : ${link}`,
      "",
      "Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet email : votre mot de passe reste inchangé.",
    ].join("\n"),
    html: `<div style="font-family:system-ui,-apple-system,sans-serif;color:#37352f;max-width:480px">
<p>${escapeHtml(name)},</p>
<p>Vous avez demandé à réinitialiser votre mot de passe du CRM.</p>
<p><a href="${link}" style="display:inline-block;background:#37352f;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Choisir un nouveau mot de passe</a></p>
<p style="font-size:13px;color:#6b6b69">Ce lien est valable 1 heure et ne peut servir qu'une fois.<br>Si vous n'êtes pas à l'origine de cette demande, ignorez cet email : votre mot de passe reste inchangé.</p>
</div>`,
  });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export async function isResetTokenValid(token: string) {
  if (!token) return false;
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });
  return Boolean(record && record.expiresAt > new Date());
}

export async function resetPassword(token: unknown, newPassword: unknown) {
  const password = validateNewPassword(newPassword);
  if (typeof token !== "string" || !token) throw new PasswordError("Lien invalide.");
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!record || record.expiresAt < new Date()) {
    throw new PasswordError("Ce lien a expiré ou a déjà été utilisé. Faites une nouvelle demande.");
  }
  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash: await hashPassword(password), passwordChangedAt: new Date() },
    }),
    prisma.passwordResetToken.deleteMany({ where: { userId: record.userId } }),
  ]);
}

export async function changePassword(userId: string, currentPassword: unknown, newPassword: unknown) {
  const password = validateNewPassword(newPassword);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || typeof currentPassword !== "string" || !(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new PasswordError("Mot de passe actuel incorrect.");
  }
  return prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(password), passwordChangedAt: new Date() },
  });
}
