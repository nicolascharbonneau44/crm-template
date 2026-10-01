const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL || "admin@example.com";
  const adminPassword = process.env.ADMIN_PASSWORD || "admin123!";

  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!existingAdmin) {
    await prisma.user.create({
      data: {
        email: adminEmail,
        fullName: process.env.ADMIN_NAME?.trim() || "Administrateur",
        role: "admin",
        passwordHash: await bcrypt.hash(adminPassword, 10),
      },
    });
    console.log(`Admin créé : ${adminEmail} / ${adminPassword}`);
  }

  const existing = await prisma.contact.count();
  if (existing > 0) {
    console.log("Base déjà peuplée (contacts), seed démo ignoré.");
    return;
  }

  const dupont = await prisma.company.create({
    data: {
      nom: "Dupont SAS",
      email: "contact@dupont-sas.fr",
      telephone: "01 42 00 00 01",
      adresse: "12 rue de la Paix, 75002 Paris",
      siteWeb: "https://dupont-sas.example",
      siret: "12345678900012",
      notes: "Client historique, renouvellement contrat Q4.",
    },
  });

  const atelier = await prisma.company.create({
    data: {
      nom: "Atelier Lumière",
      email: "hello@atelier-lumiere.fr",
      telephone: "04 78 00 00 02",
      adresse: "8 quai Saint-Antoine, 69002 Lyon",
      siteWeb: "https://atelier-lumiere.example",
    },
  });

  const technord = await prisma.company.create({
    data: {
      nom: "TechNord",
      email: "info@technord.fr",
      telephone: "03 20 00 00 03",
      adresse: "45 avenue du Capitole, 59000 Lille",
    },
  });

  const marie = await prisma.contact.create({
    data: {
      prenom: "Marie",
      nom: "Dupont",
      email: "marie.dupont@dupont-sas.fr",
      telephone: "06 12 34 56 01",
      poste: "Directrice commerciale",
      category: "client",
      state: "kickoff",
      companyId: dupont.id,
      source: "Site web",
    },
  });

  const lucas = await prisma.contact.create({
    data: {
      prenom: "Lucas",
      nom: "Bernard",
      email: "lucas.bernard@atelier-lumiere.fr",
      telephone: "06 12 34 56 02",
      poste: "CEO",
      category: "prospect",
      state: "rdv_decouverte",
      companyId: atelier.id,
      source: "LinkedIn",
    },
  });

  const sofia = await prisma.contact.create({
    data: {
      prenom: "Sofia",
      nom: "Martin",
      email: "sofia.martin@technord.fr",
      telephone: "06 12 34 56 03",
      category: "lead",
      state: "lead_en_cours",
      companyId: technord.id,
    },
  });

  await prisma.contact.create({
    data: {
      prenom: "Hugo",
      nom: "Petit",
      email: "hugo.petit@example.fr",
      telephone: "06 12 34 56 04",
      category: "lead",
      state: "new_lead",
    },
  });

  await prisma.contact.create({
    data: {
      prenom: "Camille",
      nom: "Roux",
      email: "camille.roux@example.fr",
      telephone: "06 12 34 56 05",
      category: "ex_clients",
      state: "perdu",
      companyId: technord.id,
    },
  });

  await prisma.contactStateHistory.createMany({
    data: [
      { contactId: marie.id, newState: "kickoff", newCategory: "client" },
      { contactId: lucas.id, newState: "rdv_decouverte", newCategory: "prospect" },
      { contactId: sofia.id, newState: "lead_en_cours", newCategory: "lead" },
    ],
  });

  await prisma.action.createMany({
    data: [
      {
        contactId: marie.id,
        channel: "email",
        titre: "Envoi du contrat annuel",
        contenu: "Contrat 2026 envoyé pour signature.",
        statut: "termine",
        dateRealisation: new Date(),
      },
      {
        contactId: lucas.id,
        channel: "meeting",
        titre: "Démo produit",
        contenu: "Présentation du module pipeline, 45 min.",
        statut: "a_faire",
        datePrevue: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      },
      {
        contactId: sofia.id,
        channel: "phone",
        titre: "Relance commerciale",
        contenu: "Reprendre le devis envoyé la semaine dernière.",
        statut: "en_cours",
        datePrevue: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
      {
        contactId: marie.id,
        channel: "note",
        titre: "Préférence de contact",
        contenu: "Préfère les échanges par e-mail le mardi matin.",
        statut: "termine",
        dateRealisation: new Date(),
      },
    ],
  });

  await prisma.contact.update({
    where: { id: lucas.id },
    data: {
      prochaineActionTitre: "Démo produit",
      prochaineActionDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    },
  });
  await prisma.contact.update({
    where: { id: sofia.id },
    data: {
      prochaineActionTitre: "Relance commerciale",
      prochaineActionDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  console.log("Données de démo créées.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
