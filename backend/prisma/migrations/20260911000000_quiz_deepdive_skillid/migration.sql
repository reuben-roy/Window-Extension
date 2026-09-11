-- Curated quiz rebuild: per-question deep-dive explanations and spaced-repetition skill IDs.
-- Idempotent (safe to run on databases where `prisma db push` already applied these).
ALTER TABLE "QuizQuestion" ADD COLUMN IF NOT EXISTS "deepDive" TEXT;
ALTER TABLE "QuizQuestion" ADD COLUMN IF NOT EXISTS "skillId" TEXT;
