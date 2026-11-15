-- CreateEnum
CREATE TYPE "ShopKind" AS ENUM ('ozon', 'wildberries', 'market', 'magnit');

-- CreateTable
CREATE TABLE "ShopProduct" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "shop" "ShopKind" NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "canonicalUrl" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "priceText" TEXT,
    "imageUrl" TEXT,
    "consumedAt" TIMESTAMP(3),
    "postId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopPartnerCredential" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "shop" "ShopKind" NOT NULL,
    "encryptedToken" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'connected',
    "lastError" TEXT,
    "connectedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopPartnerCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopProduct_postId_key" ON "ShopProduct"("postId");

-- CreateIndex
CREATE UNIQUE INDEX "ShopProduct_projectId_canonicalUrl_key" ON "ShopProduct"("projectId", "canonicalUrl");

-- CreateIndex
CREATE INDEX "ShopProduct_workspaceId_projectId_consumedAt_idx" ON "ShopProduct"("workspaceId", "projectId", "consumedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ShopPartnerCredential_projectId_shop_key" ON "ShopPartnerCredential"("projectId", "shop");

-- CreateIndex
CREATE INDEX "ShopPartnerCredential_workspaceId_projectId_idx" ON "ShopPartnerCredential"("workspaceId", "projectId");

-- AddForeignKey
ALTER TABLE "ShopProduct" ADD CONSTRAINT "ShopProduct_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopProduct" ADD CONSTRAINT "ShopProduct_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopProduct" ADD CONSTRAINT "ShopProduct_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopPartnerCredential" ADD CONSTRAINT "ShopPartnerCredential_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopPartnerCredential" ADD CONSTRAINT "ShopPartnerCredential_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopPartnerCredential" ADD CONSTRAINT "ShopPartnerCredential_connectedById_fkey" FOREIGN KEY ("connectedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
