-- CreateTable
CREATE TABLE "WorkspaceAiConnection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "encryptedApiKey" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "imageModel" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'connected',
    "lastError" TEXT,
    "connectedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceAiConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceAiConnection_workspaceId_key" ON "WorkspaceAiConnection"("workspaceId");

-- CreateIndex
CREATE INDEX "WorkspaceAiConnection_connectedById_idx" ON "WorkspaceAiConnection"("connectedById");

-- AddForeignKey
ALTER TABLE "WorkspaceAiConnection" ADD CONSTRAINT "WorkspaceAiConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceAiConnection" ADD CONSTRAINT "WorkspaceAiConnection_connectedById_fkey" FOREIGN KEY ("connectedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
