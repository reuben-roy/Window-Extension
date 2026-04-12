-- CreateEnum
CREATE TYPE "IdeaStatus" AS ENUM ('queued', 'syncing', 'running', 'completed', 'failed', 'kept', 'discarded');

-- CreateEnum
CREATE TYPE "OpenClawSessionStatus" AS ENUM ('active', 'idle', 'closed');

-- CreateEnum
CREATE TYPE "OpenClawJobStatus" AS ENUM ('queued', 'running', 'completed', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "RecommendationKind" AS ENUM ('focus', 'calendar', 'interest', 'automation');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "googleSub" TEXT NOT NULL,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackendSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackendSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpenClawConnection" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "transport" TEXT NOT NULL,
    "host" TEXT,
    "baseUrl" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpenClawConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpenClawSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "remoteSessionId" TEXT,
    "title" TEXT NOT NULL,
    "status" "OpenClawSessionStatus" NOT NULL DEFAULT 'active',
    "modelLabel" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpenClawSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdeaCapture" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientLocalId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "preferredModel" TEXT,
    "assistantNotes" TEXT,
    "status" "IdeaStatus" NOT NULL DEFAULT 'queued',
    "saved" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "lastError" TEXT,
    "sessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdeaCapture_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchJob" (
    "id" TEXT NOT NULL,
    "ideaId" TEXT NOT NULL,
    "remoteJobId" TEXT,
    "status" "OpenClawJobStatus" NOT NULL DEFAULT 'queued',
    "title" TEXT NOT NULL,
    "lastError" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdeaReport" (
    "id" TEXT NOT NULL,
    "ideaId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "viability" TEXT NOT NULL,
    "competitionSnapshot" TEXT NOT NULL,
    "buildEffort" TEXT NOT NULL,
    "revenuePotential" TEXT NOT NULL,
    "risks" JSONB NOT NULL,
    "nextSteps" JSONB NOT NULL,
    "sourceLinks" JSONB NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdeaReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BreakVisitEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tabId" INTEGER,
    "domain" TEXT NOT NULL,
    "activeEventTitle" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BreakVisitEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterestProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "proficiency" INTEGER NOT NULL DEFAULT 0,
    "minutes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterestProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "RecommendationKind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_googleSub_key" ON "User"("googleSub");

-- CreateIndex
CREATE UNIQUE INDEX "BackendSession_tokenHash_key" ON "BackendSession"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "OpenClawSession_remoteSessionId_key" ON "OpenClawSession"("remoteSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "IdeaCapture_userId_clientLocalId_key" ON "IdeaCapture"("userId", "clientLocalId");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchJob_ideaId_key" ON "ResearchJob"("ideaId");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchJob_remoteJobId_key" ON "ResearchJob"("remoteJobId");

-- CreateIndex
CREATE UNIQUE INDEX "IdeaReport_ideaId_key" ON "IdeaReport"("ideaId");

-- CreateIndex
CREATE UNIQUE INDEX "InterestProfile_userId_key_key" ON "InterestProfile"("userId", "key");

-- AddForeignKey
ALTER TABLE "BackendSession" ADD CONSTRAINT "BackendSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenClawSession" ADD CONSTRAINT "OpenClawSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdeaCapture" ADD CONSTRAINT "IdeaCapture_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdeaCapture" ADD CONSTRAINT "IdeaCapture_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "OpenClawSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchJob" ADD CONSTRAINT "ResearchJob_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "IdeaCapture"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdeaReport" ADD CONSTRAINT "IdeaReport_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "IdeaCapture"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BreakVisitEvent" ADD CONSTRAINT "BreakVisitEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterestProfile" ADD CONSTRAINT "InterestProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
