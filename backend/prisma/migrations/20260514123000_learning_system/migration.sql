-- CreateEnum
CREATE TYPE "LearningTopicSource" AS ENUM ('catalog', 'custom', 'suggested');

-- CreateEnum
CREATE TYPE "LearningPackSourceKind" AS ENUM ('textbook', 'paper_based');

-- CreateEnum
CREATE TYPE "LearningPackStatus" AS ENUM ('queued', 'processing', 'ready', 'failed');

-- CreateEnum
CREATE TYPE "LearningJobKind" AS ENUM ('source_discovery', 'document_ingestion', 'pack_generation', 'pack_regeneration');

-- CreateEnum
CREATE TYPE "LearningJobStatus" AS ENUM ('queued', 'running', 'completed', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "LearningLicenseMode" AS ENUM ('commercial_safe', 'expanded_oer');

-- CreateEnum
CREATE TYPE "QuizDifficulty" AS ENUM ('easy', 'medium', 'hard');

-- CreateEnum
CREATE TYPE "QuizArtifactType" AS ENUM ('image', 'graph');

-- AlterTable
ALTER TABLE "ActivitySession" ALTER COLUMN "secondaryTagKeys" DROP DEFAULT;

-- AlterTable
ALTER TABLE "FocusSession" ALTER COLUMN "secondaryTagKeys" DROP DEFAULT;

-- CreateTable
CREATE TABLE "LearningSubject" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningSubject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningTopic" (
    "id" TEXT NOT NULL,
    "subjectId" TEXT,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningTopic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserLearningTopic" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "source" "LearningTopicSource" NOT NULL DEFAULT 'catalog',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserLearningTopic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningSource" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "sourceKind" "LearningPackSourceKind" NOT NULL,
    "licenseMode" "LearningLicenseMode" NOT NULL,
    "sourceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningDocument" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT,
    "sourceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningChapter" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningChapter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizPack" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "sourceId" TEXT,
    "title" TEXT NOT NULL,
    "sourceKind" "LearningPackSourceKind" NOT NULL,
    "status" "LearningPackStatus" NOT NULL DEFAULT 'queued',
    "canonical" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuizPack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizPackVersion" (
    "id" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "licenseMode" "LearningLicenseMode" NOT NULL,
    "generatedNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuizPackVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizQuestion" (
    "id" TEXT NOT NULL,
    "packVersionId" TEXT NOT NULL,
    "chapterId" TEXT,
    "ordinal" INTEGER NOT NULL,
    "difficulty" "QuizDifficulty" NOT NULL,
    "prompt" TEXT NOT NULL,
    "choices" JSONB NOT NULL,
    "correctChoiceId" TEXT NOT NULL,
    "hint" TEXT,
    "explanation" TEXT,
    "wrongAnswerExplanations" JSONB NOT NULL,
    "artifactType" "QuizArtifactType",
    "artifactData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuizQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserQuizProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "seenCount" INTEGER NOT NULL DEFAULT 0,
    "correctStreak" INTEGER NOT NULL DEFAULT 0,
    "ease" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "lastSeenAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastWasCorrect" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserQuizProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "selectedChoiceId" TEXT,
    "correct" BOOLEAN NOT NULL,
    "pointsAwarded" INTEGER NOT NULL DEFAULT 0,
    "dueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuizSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "LearningJobKind" NOT NULL,
    "status" "LearningJobStatus" NOT NULL DEFAULT 'queued',
    "topicId" TEXT,
    "packId" TEXT,
    "packVersionId" TEXT,
    "payload" JSONB,
    "lastError" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LearningSubject_key_key" ON "LearningSubject"("key");

-- CreateIndex
CREATE UNIQUE INDEX "LearningTopic_key_key" ON "LearningTopic"("key");

-- CreateIndex
CREATE INDEX "LearningTopic_subjectId_label_idx" ON "LearningTopic"("subjectId", "label");

-- CreateIndex
CREATE INDEX "UserLearningTopic_userId_active_updatedAt_idx" ON "UserLearningTopic"("userId", "active", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserLearningTopic_userId_topicId_key" ON "UserLearningTopic"("userId", "topicId");

-- CreateIndex
CREATE INDEX "LearningSource_topicId_createdAt_idx" ON "LearningSource"("topicId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LearningChapter_documentId_ordinal_key" ON "LearningChapter"("documentId", "ordinal");

-- CreateIndex
CREATE INDEX "QuizPack_topicId_updatedAt_idx" ON "QuizPack"("topicId", "updatedAt");

-- CreateIndex
CREATE INDEX "QuizPackVersion_packId_createdAt_idx" ON "QuizPackVersion"("packId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "QuizPackVersion_packId_versionNumber_key" ON "QuizPackVersion"("packId", "versionNumber");

-- CreateIndex
CREATE INDEX "QuizQuestion_chapterId_idx" ON "QuizQuestion"("chapterId");

-- CreateIndex
CREATE UNIQUE INDEX "QuizQuestion_packVersionId_ordinal_key" ON "QuizQuestion"("packVersionId", "ordinal");

-- CreateIndex
CREATE INDEX "UserQuizProgress_userId_dueAt_idx" ON "UserQuizProgress"("userId", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserQuizProgress_userId_questionId_key" ON "UserQuizProgress"("userId", "questionId");

-- CreateIndex
CREATE INDEX "QuizSession_userId_createdAt_idx" ON "QuizSession"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "LearningJob_status_createdAt_idx" ON "LearningJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "LearningJob_userId_kind_createdAt_idx" ON "LearningJob"("userId", "kind", "createdAt");

-- AddForeignKey
ALTER TABLE "LearningTopic" ADD CONSTRAINT "LearningTopic_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "LearningSubject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserLearningTopic" ADD CONSTRAINT "UserLearningTopic_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserLearningTopic" ADD CONSTRAINT "UserLearningTopic_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "LearningTopic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningSource" ADD CONSTRAINT "LearningSource_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "LearningTopic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningDocument" ADD CONSTRAINT "LearningDocument_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "LearningSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningChapter" ADD CONSTRAINT "LearningChapter_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "LearningDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizPack" ADD CONSTRAINT "QuizPack_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "LearningTopic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizPack" ADD CONSTRAINT "QuizPack_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "LearningSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizPackVersion" ADD CONSTRAINT "QuizPackVersion_packId_fkey" FOREIGN KEY ("packId") REFERENCES "QuizPack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizQuestion" ADD CONSTRAINT "QuizQuestion_packVersionId_fkey" FOREIGN KEY ("packVersionId") REFERENCES "QuizPackVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizQuestion" ADD CONSTRAINT "QuizQuestion_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "LearningChapter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserQuizProgress" ADD CONSTRAINT "UserQuizProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserQuizProgress" ADD CONSTRAINT "UserQuizProgress_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "QuizQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizSession" ADD CONSTRAINT "QuizSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizSession" ADD CONSTRAINT "QuizSession_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "QuizQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningJob" ADD CONSTRAINT "LearningJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningJob" ADD CONSTRAINT "LearningJob_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "LearningTopic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningJob" ADD CONSTRAINT "LearningJob_packId_fkey" FOREIGN KEY ("packId") REFERENCES "QuizPack"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningJob" ADD CONSTRAINT "LearningJob_packVersionId_fkey" FOREIGN KEY ("packVersionId") REFERENCES "QuizPackVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
