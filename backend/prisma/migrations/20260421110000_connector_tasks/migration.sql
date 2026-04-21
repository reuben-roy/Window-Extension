-- CreateEnum
CREATE TYPE "AssistantConnectorType" AS ENUM ('openclaw');

-- CreateEnum
CREATE TYPE "AssistantTaskStatus" AS ENUM ('queued', 'running', 'completed', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "TaskNotificationMode" AS ENUM ('immediate', 'after_focus', 'inbox_only');

-- CreateEnum
CREATE TYPE "AssistantFocusContextType" AS ENUM ('none', 'window_task', 'calendar_event');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "selectedConnectorId" TEXT;

-- AlterTable
ALTER TABLE "OpenClawConnection"
ADD COLUMN "key" TEXT,
ADD COLUMN "connectorType" "AssistantConnectorType" NOT NULL DEFAULT 'openclaw',
ADD COLUMN "description" TEXT;

WITH ranked_connections AS (
    SELECT "id", ROW_NUMBER() OVER (ORDER BY "createdAt", "id") AS row_num
    FROM "OpenClawConnection"
)
UPDATE "OpenClawConnection"
SET "key" = CASE
    WHEN ranked_connections.row_num = 1 THEN 'primary-openclaw'
    ELSE 'openclaw-' || ranked_connections.row_num::TEXT
END
FROM ranked_connections
WHERE ranked_connections."id" = "OpenClawConnection"."id"
  AND "OpenClawConnection"."key" IS NULL;

ALTER TABLE "OpenClawConnection" ALTER COLUMN "key" SET NOT NULL;

-- AlterTable
ALTER TABLE "OpenClawSession" ADD COLUMN "connectorId" TEXT;

WITH default_connector AS (
    SELECT "id"
    FROM "OpenClawConnection"
    ORDER BY "createdAt", "id"
    LIMIT 1
)
UPDATE "OpenClawSession"
SET "connectorId" = (SELECT "id" FROM default_connector)
WHERE "connectorId" IS NULL;

WITH default_connector AS (
    SELECT "id"
    FROM "OpenClawConnection"
    ORDER BY "createdAt", "id"
    LIMIT 1
)
UPDATE "User"
SET "selectedConnectorId" = (SELECT "id" FROM default_connector)
WHERE "selectedConnectorId" IS NULL;

-- DropIndex
DROP INDEX "OpenClawSession_remoteSessionId_key";

-- CreateTable
CREATE TABLE "AssistantTask" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "connectorId" TEXT,
    "prompt" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "preferredModel" TEXT,
    "assistantNotes" TEXT,
    "status" "AssistantTaskStatus" NOT NULL DEFAULT 'queued',
    "notificationMode" "TaskNotificationMode" NOT NULL DEFAULT 'after_focus',
    "focusContextType" "AssistantFocusContextType" NOT NULL DEFAULT 'none',
    "focusContextId" TEXT,
    "lastError" TEXT,
    "sessionId" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssistantTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistantTaskJob" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "remoteJobId" TEXT,
    "status" "AssistantTaskStatus" NOT NULL DEFAULT 'queued',
    "lastError" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssistantTaskJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistantTaskResult" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "output" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssistantTaskResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OpenClawConnection_key_key" ON "OpenClawConnection"("key");

-- CreateIndex
CREATE UNIQUE INDEX "OpenClawSession_connectorId_remoteSessionId_key" ON "OpenClawSession"("connectorId", "remoteSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "AssistantTaskJob_taskId_key" ON "AssistantTaskJob"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "AssistantTaskResult_taskId_key" ON "AssistantTaskResult"("taskId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_selectedConnectorId_fkey" FOREIGN KEY ("selectedConnectorId") REFERENCES "OpenClawConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenClawSession" ADD CONSTRAINT "OpenClawSession_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "OpenClawConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantTask" ADD CONSTRAINT "AssistantTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantTask" ADD CONSTRAINT "AssistantTask_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "OpenClawConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantTask" ADD CONSTRAINT "AssistantTask_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "OpenClawSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantTaskJob" ADD CONSTRAINT "AssistantTaskJob_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AssistantTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantTaskResult" ADD CONSTRAINT "AssistantTaskResult_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AssistantTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
