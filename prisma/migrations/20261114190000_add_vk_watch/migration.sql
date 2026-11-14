-- CreateTable
CREATE TABLE "VkWatchCredential" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "encryptedToken" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'connected',
    "lastError" TEXT,
    "connectedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VkWatchCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VkWatchCommunity" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "screenName" TEXT NOT NULL,
    "externalId" TEXT NOT NULL DEFAULT '',
    "displayName" TEXT NOT NULL,
    "lastFetchedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VkWatchCommunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VkWatchSnapshot" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postsJson" TEXT NOT NULL,

    CONSTRAINT "VkWatchSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VkWatchCredential_workspaceId_key" ON "VkWatchCredential"("workspaceId");

-- CreateIndex
CREATE INDEX "VkWatchCredential_connectedById_idx" ON "VkWatchCredential"("connectedById");

-- CreateIndex
CREATE UNIQUE INDEX "VkWatchCommunity_workspaceId_screenName_key" ON "VkWatchCommunity"("workspaceId", "screenName");

-- CreateIndex
CREATE INDEX "VkWatchCommunity_workspaceId_createdAt_idx" ON "VkWatchCommunity"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "VkWatchSnapshot_communityId_fetchedAt_idx" ON "VkWatchSnapshot"("communityId", "fetchedAt");

-- AddForeignKey
ALTER TABLE "VkWatchCredential" ADD CONSTRAINT "VkWatchCredential_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VkWatchCredential" ADD CONSTRAINT "VkWatchCredential_connectedById_fkey" FOREIGN KEY ("connectedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VkWatchCommunity" ADD CONSTRAINT "VkWatchCommunity_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VkWatchSnapshot" ADD CONSTRAINT "VkWatchSnapshot_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "VkWatchCommunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
