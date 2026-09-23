import { prisma } from "@/lib/prisma";
import {
  ACTION_CHANNEL_LABELS,
  ACTION_STATUT_LABELS,
  PERSON_CATEGORIES,
  PERSON_CATEGORY_LABELS,
  PERSON_STATE_LABELS,
} from "@/lib/labels";

export async function getCrmStats() {
  const now = new Date();
  const since30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const overdueWhere = { statut: { not: "termine" as const }, datePrevue: { lt: now } };

  const [
    contacts,
    companies,
    actions,
    withoutCompany,
    newContacts30,
    doneActions30,
    byCategory,
    byState,
    byStatut,
    byChannel,
    overdueCount,
    overdueActions,
    recentChanges,
  ] = await Promise.all([
    prisma.contact.count(),
    prisma.company.count(),
    prisma.action.count(),
    prisma.contact.count({ where: { companyId: null } }),
    prisma.contact.count({ where: { createdAt: { gte: since30 } } }),
    prisma.action.count({ where: { statut: "termine", dateRealisation: { gte: since30 } } }),
    prisma.contact.groupBy({ by: ["category"], _count: { _all: true } }),
    prisma.contact.groupBy({ by: ["state"], _count: { _all: true } }),
    prisma.action.groupBy({ by: ["statut"], _count: { _all: true } }),
    prisma.action.groupBy({ by: ["channel"], _count: { _all: true } }),
    prisma.action.count({ where: overdueWhere }),
    prisma.action.findMany({
      where: overdueWhere,
      orderBy: { datePrevue: "asc" },
      take: 10,
      select: {
        id: true,
        titre: true,
        channel: true,
        datePrevue: true,
        contact: { select: { id: true, prenom: true, nom: true } },
      },
    }),
    prisma.contactStateHistory.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        createdAt: true,
        previousState: true,
        newState: true,
        contact: { select: { id: true, prenom: true, nom: true } },
      },
    }),
  ]);

  const categoryCounts = new Map(byCategory.map((r) => [r.category, r._count._all]));

  return {
    genereLe: now.toISOString(),
    totaux: { contacts, entreprises: companies, actions, contactsSansEntreprise: withoutCompany },
    contactsParCategorie: PERSON_CATEGORIES.map((category) => ({
      categorie: category,
      label: PERSON_CATEGORY_LABELS[category],
      nombre: categoryCounts.get(category) ?? 0,
    })),
    contactsParEtat: byState
      .map((r) => ({ etat: r.state, label: PERSON_STATE_LABELS[r.state], nombre: r._count._all }))
      .sort((a, b) => b.nombre - a.nombre),
    actionsParStatut: byStatut.map((r) => ({
      statut: r.statut,
      label: ACTION_STATUT_LABELS[r.statut],
      nombre: r._count._all,
    })),
    actionsParCanal: byChannel.map((r) => ({
      canal: r.channel,
      label: ACTION_CHANNEL_LABELS[r.channel],
      nombre: r._count._all,
    })),
    sur30Jours: { nouveauxContacts: newContacts30, actionsTerminees: doneActions30 },
    actionsEnRetard: { nombre: overdueCount, premieres: overdueActions },
    derniersChangementsEtat: recentChanges,
  };
}
