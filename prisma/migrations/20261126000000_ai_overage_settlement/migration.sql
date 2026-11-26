-- CreateTable
CREATE TABLE "AiOverageSettlement" (
    "id" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "units" INTEGER NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "recovered" BOOLEAN NOT NULL DEFAULT false,
    "lastError" TEXT,
    "sourceError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recoveredAt" TIMESTAMP(3),

    CONSTRAINT "AiOverageSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiOverageSettlement_settlementId_key" ON "AiOverageSettlement"("settlementId");

-- CreateIndex
CREATE INDEX "AiOverageSettlement_workspaceId_createdAt_idx" ON "AiOverageSettlement"("workspaceId", "createdAt");

-- AddForeignKey
ALTER TABLE "AiOverageSettlement" ADD CONSTRAINT "AiOverageSettlement_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
