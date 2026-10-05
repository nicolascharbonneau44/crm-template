-- CreateTable
CREATE TABLE "WebhookEndpoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'meetmagnet',
    "token" TEXT NOT NULL,
    "sourceLabel" TEXT NOT NULL DEFAULT 'MeetMagnet',
    "defaultCategory" TEXT NOT NULL DEFAULT 'lead',
    "defaultState" TEXT NOT NULL DEFAULT 'new_lead',
    "defaultOwnerId" TEXT,
    "createTask" BOOLEAN NOT NULL DEFAULT true,
    "mapping" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- Le webhook MeetMagnet existant devient le premier point d'entrée (même URL, mêmes réglages).
INSERT INTO "WebhookEndpoint" ("id", "name", "provider", "token", "sourceLabel", "defaultCategory", "defaultState", "defaultOwnerId", "createTask", "mapping", "createdAt", "updatedAt")
SELECT "id", 'MeetMagnet — réponses', "source", "token", 'MeetMagnet', "defaultCategory", "defaultState", "defaultOwnerId", "createTask", NULL, "createdAt", "updatedAt"
FROM "InboundWebhook";

-- DropTable
DROP TABLE "InboundWebhook";

-- AlterTable
ALTER TABLE "WebhookDelivery" ADD COLUMN "endpointId" TEXT;
UPDATE "WebhookDelivery" SET "endpointId" = (SELECT "id" FROM "WebhookEndpoint" ORDER BY "createdAt" ASC LIMIT 1);

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEndpoint_token_key" ON "WebhookEndpoint"("token");
