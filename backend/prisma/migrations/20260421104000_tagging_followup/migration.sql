ALTER TABLE "TaskTag"
ADD COLUMN "archivedAt" TIMESTAMP(3);

ALTER TABLE "FocusSession"
ADD COLUMN "secondaryTagKeys" JSONB NOT NULL DEFAULT '[]';

ALTER TABLE "ActivitySession"
ADD COLUMN "secondaryTagKeys" JSONB NOT NULL DEFAULT '[]';
