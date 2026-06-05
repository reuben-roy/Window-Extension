-- AlterTable
ALTER TABLE "QuizSession" ADD COLUMN "difficultySelfRating" TEXT;

-- CreateTable
CREATE TABLE "UserTopicChapterProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "currentChapterOrdinal" INTEGER NOT NULL DEFAULT 1,
    "consecutiveTooHardCount" INTEGER NOT NULL DEFAULT 0,
    "correctInCurrentChapter" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserTopicChapterProgress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserTopicChapterProgress_userId_idx" ON "UserTopicChapterProgress"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserTopicChapterProgress_userId_topicId_key" ON "UserTopicChapterProgress"("userId", "topicId");

-- AddForeignKey
ALTER TABLE "UserTopicChapterProgress" ADD CONSTRAINT "UserTopicChapterProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTopicChapterProgress" ADD CONSTRAINT "UserTopicChapterProgress_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "LearningTopic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
