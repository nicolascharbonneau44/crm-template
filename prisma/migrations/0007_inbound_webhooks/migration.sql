-- CreateTable
CREATE TABLE "InboundWebhook" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "defaultCategory" TEXT NOT NULL DEFAULT 'lead',
    "defaultState" TEXT NOT NULL DEFAULT 'new_lead',
    "createTask" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "externalId" TEXT,
    "status" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "contactId" TEXT,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "InboundWebhook_source_key" ON "InboundWebhook"("source");

-- CreateIndex
CREATE UNIQUE INDEX "InboundWebhook_token_key" ON "InboundWebhook"("token");

-- CreateIndex
CREATE INDEX "WebhookDelivery_receivedAt_idx" ON "WebhookDelivery"("receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDelivery_source_externalId_key" ON "WebhookDelivery"("source", "externalId");
