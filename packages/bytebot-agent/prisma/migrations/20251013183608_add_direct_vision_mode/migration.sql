-- DropIndex
DROP INDEX "public"."Task_lockedAt_idx";

-- DropIndex
DROP INDEX "public"."Task_lockedBy_idx";

-- AlterTable
ALTER TABLE "ApiKey" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "directVisionMode" BOOLEAN NOT NULL DEFAULT false;
