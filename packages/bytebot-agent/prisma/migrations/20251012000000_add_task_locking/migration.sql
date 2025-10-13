-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "lockedBy" TEXT,
ADD COLUMN     "lockedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Task_lockedBy_idx" ON "Task"("lockedBy");

-- CreateIndex
CREATE INDEX "Task_lockedAt_idx" ON "Task"("lockedAt");
