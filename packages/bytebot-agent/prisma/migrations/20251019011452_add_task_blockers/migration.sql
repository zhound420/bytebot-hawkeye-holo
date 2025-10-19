-- CreateTable
CREATE TABLE "TaskBlocker" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "blockerType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "screenshotId" TEXT,
    "failedModels" TEXT[],
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolutionNotes" TEXT,
    "metadata" JSONB,

    CONSTRAINT "TaskBlocker_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskBlocker_taskId_idx" ON "TaskBlocker"("taskId");

-- CreateIndex
CREATE INDEX "TaskBlocker_detectedAt_idx" ON "TaskBlocker"("detectedAt");

-- CreateIndex
CREATE INDEX "TaskBlocker_resolved_idx" ON "TaskBlocker"("resolved");

-- AddForeignKey
ALTER TABLE "TaskBlocker" ADD CONSTRAINT "TaskBlocker_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
