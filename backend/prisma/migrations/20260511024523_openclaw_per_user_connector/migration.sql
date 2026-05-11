-- AlterTable
ALTER TABLE "OpenClawConnection" ADD COLUMN     "apiToken" TEXT,
ADD COLUMN     "userId" TEXT;

-- CreateIndex
CREATE INDEX "OpenClawConnection_userId_idx" ON "OpenClawConnection"("userId");

-- AddForeignKey
ALTER TABLE "OpenClawConnection" ADD CONSTRAINT "OpenClawConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
