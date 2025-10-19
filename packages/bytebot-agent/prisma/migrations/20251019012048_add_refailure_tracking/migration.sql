-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "lastNeedsHelpAt" TIMESTAMP(3),
ADD COLUMN     "lastResumedAt" TIMESTAMP(3),
ADD COLUMN     "needsHelpCount" INTEGER NOT NULL DEFAULT 0;
