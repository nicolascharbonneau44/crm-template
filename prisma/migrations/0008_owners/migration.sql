-- AlterTable
ALTER TABLE "InboundWebhook" ADD COLUMN "defaultOwnerId" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Contact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "civilite" TEXT,
    "prenom" TEXT NOT NULL DEFAULT '',
    "nom" TEXT NOT NULL DEFAULT '',
    "email" TEXT,
    "telephone" TEXT,
    "poste" TEXT,
    "linkedinUrl" TEXT,
    "description" TEXT,
    "adresse" TEXT,
    "pays" TEXT,
    "source" TEXT,
    "category" TEXT NOT NULL DEFAULT 'lead',
    "state" TEXT NOT NULL DEFAULT 'new_lead',
    "companyId" TEXT,
    "ownerId" TEXT,
    "prochaineActionTitre" TEXT,
    "prochaineActionDate" DATETIME,
    "customFields" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Contact_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Contact_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Contact" ("adresse", "category", "civilite", "companyId", "createdAt", "customFields", "description", "email", "id", "linkedinUrl", "nom", "pays", "poste", "prenom", "prochaineActionDate", "prochaineActionTitre", "source", "state", "telephone", "updatedAt") SELECT "adresse", "category", "civilite", "companyId", "createdAt", "customFields", "description", "email", "id", "linkedinUrl", "nom", "pays", "poste", "prenom", "prochaineActionDate", "prochaineActionTitre", "source", "state", "telephone", "updatedAt" FROM "Contact";
DROP TABLE "Contact";
ALTER TABLE "new_Contact" RENAME TO "Contact";
CREATE INDEX "Contact_category_idx" ON "Contact"("category");
CREATE INDEX "Contact_state_idx" ON "Contact"("state");
CREATE INDEX "Contact_companyId_idx" ON "Contact"("companyId");
CREATE INDEX "Contact_ownerId_idx" ON "Contact"("ownerId");
CREATE INDEX "Contact_nom_idx" ON "Contact"("nom");
CREATE INDEX "Contact_prenom_idx" ON "Contact"("prenom");
CREATE INDEX "Contact_prochaineActionDate_idx" ON "Contact"("prochaineActionDate");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Action_userId_idx" ON "Action"("userId");

-- Données existantes : attribuées au premier utilisateur (seul compte avant le multi-utilisateurs).
UPDATE "Contact" SET "ownerId" = (SELECT "id" FROM "User" ORDER BY "createdAt" ASC LIMIT 1) WHERE "ownerId" IS NULL;
UPDATE "Action" SET "userId" = (SELECT "id" FROM "User" ORDER BY "createdAt" ASC LIMIT 1) WHERE "userId" IS NULL;
