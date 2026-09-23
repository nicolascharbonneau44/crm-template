import nodemailer, { type Transporter } from "nodemailer";

export function isMailConfigured() {
  return Boolean(process.env.SMTP_HOST?.trim() && process.env.SMTP_USER?.trim() && process.env.SMTP_PASS);
}

export function mailSender() {
  return process.env.MAIL_FROM?.trim() || process.env.SMTP_USER?.trim() || "";
}

let transporter: Transporter | null = null;

function getTransporter() {
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT || 587);
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transporter;
}

export async function sendMail(message: { to: string; subject: string; text: string; html: string }) {
  if (!isMailConfigured()) throw new Error("Envoi d'email non configuré (variables SMTP_* manquantes)");
  await getTransporter().sendMail({ from: mailSender(), ...message });
}
