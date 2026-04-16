CREATE TABLE "TaskTag" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "aliases" JSONB NOT NULL,
    "baselineDifficulty" INTEGER NOT NULL,
    "alignedDomains" JSONB NOT NULL,
    "supportiveDomains" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskTag_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FocusSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientSessionId" TEXT NOT NULL,
    "calendarEventId" TEXT NOT NULL,
    "eventTitle" TEXT NOT NULL,
    "scheduledStart" TIMESTAMP(3) NOT NULL,
    "scheduledEnd" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL,
    "sourceRuleType" TEXT NOT NULL,
    "sourceRuleName" TEXT,
    "tagKey" TEXT,
    "difficultyRank" INTEGER,
    "productiveMinutes" INTEGER NOT NULL DEFAULT 0,
    "supportiveMinutes" INTEGER NOT NULL DEFAULT 0,
    "distractedMinutes" INTEGER NOT NULL DEFAULT 0,
    "awayMinutes" INTEGER NOT NULL DEFAULT 0,
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "totalTrackedMinutes" INTEGER NOT NULL DEFAULT 0,
    "leftEarly" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FocusSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ActivitySession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientActivityId" TEXT NOT NULL,
    "focusSessionId" TEXT NOT NULL,
    "calendarEventId" TEXT NOT NULL,
    "eventTitle" TEXT NOT NULL,
    "domain" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL,
    "activityClass" TEXT NOT NULL,
    "tagKey" TEXT,
    "difficultyRank" INTEGER,
    "sourceRuleType" TEXT NOT NULL,
    "sourceRuleName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivitySession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DailyAnalyticsAggregate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "productiveMinutes" INTEGER NOT NULL DEFAULT 0,
    "supportiveMinutes" INTEGER NOT NULL DEFAULT 0,
    "distractedMinutes" INTEGER NOT NULL DEFAULT 0,
    "awayMinutes" INTEGER NOT NULL DEFAULT 0,
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "totalFocusSessions" INTEGER NOT NULL DEFAULT 0,
    "leftEarlyCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyAnalyticsAggregate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AnalyticsOverride" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "focusSessionId" TEXT NOT NULL,
    "tagKey" TEXT,
    "difficultyRank" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalyticsOverride_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TaskTag_userId_key_key" ON "TaskTag"("userId", "key");
CREATE INDEX "TaskTag_userId_updatedAt_idx" ON "TaskTag"("userId", "updatedAt");

CREATE UNIQUE INDEX "FocusSession_userId_clientSessionId_key" ON "FocusSession"("userId", "clientSessionId");
CREATE INDEX "FocusSession_userId_startedAt_idx" ON "FocusSession"("userId", "startedAt");
CREATE INDEX "FocusSession_userId_tagKey_startedAt_idx" ON "FocusSession"("userId", "tagKey", "startedAt");

CREATE UNIQUE INDEX "ActivitySession_userId_clientActivityId_key" ON "ActivitySession"("userId", "clientActivityId");
CREATE INDEX "ActivitySession_userId_startedAt_idx" ON "ActivitySession"("userId", "startedAt");
CREATE INDEX "ActivitySession_focusSessionId_startedAt_idx" ON "ActivitySession"("focusSessionId", "startedAt");

CREATE UNIQUE INDEX "DailyAnalyticsAggregate_userId_day_key" ON "DailyAnalyticsAggregate"("userId", "day");
CREATE INDEX "DailyAnalyticsAggregate_userId_day_idx" ON "DailyAnalyticsAggregate"("userId", "day");

CREATE UNIQUE INDEX "AnalyticsOverride_focusSessionId_key" ON "AnalyticsOverride"("focusSessionId");
CREATE INDEX "AnalyticsOverride_userId_updatedAt_idx" ON "AnalyticsOverride"("userId", "updatedAt");

ALTER TABLE "TaskTag" ADD CONSTRAINT "TaskTag_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FocusSession" ADD CONSTRAINT "FocusSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActivitySession" ADD CONSTRAINT "ActivitySession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActivitySession" ADD CONSTRAINT "ActivitySession_focusSessionId_fkey" FOREIGN KEY ("focusSessionId") REFERENCES "FocusSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DailyAnalyticsAggregate" ADD CONSTRAINT "DailyAnalyticsAggregate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnalyticsOverride" ADD CONSTRAINT "AnalyticsOverride_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnalyticsOverride" ADD CONSTRAINT "AnalyticsOverride_focusSessionId_fkey" FOREIGN KEY ("focusSessionId") REFERENCES "FocusSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
