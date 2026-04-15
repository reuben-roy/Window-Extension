ALTER TABLE "User" ADD COLUMN "supabaseUserId" TEXT;

CREATE UNIQUE INDEX "User_supabaseUserId_key" ON "User"("supabaseUserId");
