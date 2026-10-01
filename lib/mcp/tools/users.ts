import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { dayBounds, endOfWeek } from "@/lib/dates";
import { contactDisplayName } from "@/lib/labels";
import { listUsers, userDisplayName } from "@/lib/users";
import { optionalBoolean, optionalEnum, userRefArg, userRefSchema, type McpTool } from "@/lib/mcp/types";

const PERIODS = ["today", "overdue", "week", "all"] as const;

export const userTools: McpTool[] = [
  {
    name: "list_users",
    title: "Utilisateurs du CRM",
    kind: "read",
    description:
      "Liste les utilisateurs du CRM (nom, email) et indique lequel est l'utilisateur connecté (isMe). Sert à attribuer des contacts ou des relances à quelqu'un.",
    inputSchema: { type: "object", properties: {} },
    async handler(_args, ctx) {
      const users = await listUsers();
      return users.map((u) => ({ id: u.id, nom: userDisplayName(u), email: u.email, isMe: u.id === ctx.userId }));
    },
  },
  {
    name: "list_followups",
    title: "Relances à faire",
    kind: "read",
    description:
      "Relances (actions non terminées) d'un utilisateur, groupées : en retard, aujourd'hui, plus tard. Par défaut : celles de l'utilisateur connecté (« mes relances ») pour aujourd'hui, retards inclus. À utiliser pour « mes relances du jour », « ce que Virginie doit faire cette semaine »…",
    inputSchema: {
      type: "object",
      properties: {
        user: { ...userRefSchema, description: `${userRefSchema.description} Par défaut « me ».` },
        period: {
          type: "string",
          enum: PERIODS,
          description: "today (défaut : aujourd'hui + retards), overdue (retards seuls), week (jusqu'à dimanche), all (toutes, y compris sans date)",
        },
        includeUndated: { type: "boolean", description: "Inclure les relances sans échéance (incluses d'office pour period=all)" },
      },
    },
    async handler(args, ctx) {
      const userId = await userRefArg({ user: args.user === undefined ? "me" : args.user }, "user", ctx);
      const period = optionalEnum(args, "period", PERIODS) ?? "today";
      const includeUndated = period === "all" || optionalBoolean(args, "includeUndated") === true;
      const now = new Date();
      const today = dayBounds(now);
      const limit = period === "today" ? today.end : period === "week" ? endOfWeek(now) : period === "overdue" ? today.start : null;

      const dateFilter: Prisma.ActionWhereInput[] = [];
      if (limit) dateFilter.push({ datePrevue: period === "overdue" ? { lt: limit } : { lte: limit } });
      else dateFilter.push({ datePrevue: { not: null } });
      if (includeUndated) dateFilter.push({ datePrevue: null });

      const actions = await prisma.action.findMany({
        where: { userId: userId ?? null, statut: { not: "termine" }, OR: dateFilter },
        orderBy: [{ datePrevue: "asc" }, { createdAt: "asc" }],
        take: 300,
        include: { contact: { include: { company: { select: { id: true, nom: true } } } } },
      });

      const user = userId ? await prisma.user.findUnique({ where: { id: userId } }) : null;
      const item = (a: (typeof actions)[number]) => ({
        id: a.id,
        titre: a.titre,
        canal: a.channel,
        statut: a.statut,
        datePrevue: a.datePrevue,
        extrait: a.contenu.slice(0, 240),
        contact: {
          id: a.contact.id,
          nom: contactDisplayName(a.contact),
          entreprise: a.contact.company?.nom ?? null,
          email: a.contact.email,
          telephone: a.contact.telephone,
        },
      });
      const lateList = actions.filter((a) => a.datePrevue && a.datePrevue < today.start);
      const todayList = actions.filter((a) => a.datePrevue && a.datePrevue >= today.start && a.datePrevue <= today.end);
      const laterList = actions.filter((a) => a.datePrevue && a.datePrevue > today.end);
      const undatedList = actions.filter((a) => !a.datePrevue);

      return {
        utilisateur: user ? userDisplayName(user) : "Non attribuées",
        date: today.isoDate,
        periode: period,
        total: actions.length,
        enRetard: lateList.map(item),
        aujourdhui: todayList.map(item),
        ...(laterList.length ? { plusTard: laterList.map(item) } : {}),
        ...(undatedList.length ? { sansEcheance: undatedList.map(item) } : {}),
      };
    },
  },
];
