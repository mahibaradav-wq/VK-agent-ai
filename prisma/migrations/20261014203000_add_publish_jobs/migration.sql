-- AlterTable
ALTER TABLE "PostTarget" ADD COLUMN "externalId" TEXT;
ALTER TABLE "PostTarget" ADD COLUMN "lastError" TEXT;

-- CreateEnum
CREATE TYPE "PublishJobStatus" AS ENUM ('pending', 'claimed', 'processing', 'completed', 'failed', 'requires_manual_check');

-- CreateEnum
CREATE TYPE "PublishAttemptKind" AS ENUM ('success', 'temporary_failure', 'permanent_failure', 'unknown');

-- CreateTable
CREATE TABLE "PublishJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "postVersionId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "PublishJobStatus" NOT NULL DEFAULT 'pending',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "claimedAt" TIMESTAMP(3),
    "claimedBy" TEXT,
    "nextAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublishJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublishAttempt" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "kind" "PublishAttemptKind" NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "externalId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublishAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PublishJob_idempotencyKey_key" ON "PublishJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PublishJob_workspaceId_status_nextAttemptAt_idx" ON "PublishJob"("workspaceId", "status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "PublishJob_postId_status_idx" ON "PublishJob"("postId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PublishAttempt_jobId_targetId_attemptNumber_key" ON "PublishAttempt"("jobId", "targetId", "attemptNumber");

-- CreateIndex
CREATE INDEX "PublishAttempt_targetId_startedAt_idx" ON "PublishAttempt"("targetId", "startedAt");

-- AddForeignKey
ALTER TABLE "PublishJob" ADD CONSTRAINT "PublishJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishJob" ADD CONSTRAINT "PublishJob_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishJob" ADD CONSTRAINT "PublishJob_postVersionId_fkey" FOREIGN KEY ("postVersionId") REFERENCES "PostVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishJob" ADD CONSTRAINT "PublishJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishAttempt" ADD CONSTRAINT "PublishAttempt_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "PublishJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishAttempt" ADD CONSTRAINT "PublishAttempt_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "PostTarget"("id") ON DELETE CASCADE ON UPDATE CASCADE;
