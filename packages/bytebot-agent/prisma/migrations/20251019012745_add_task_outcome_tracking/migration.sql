-- CreateTable
CREATE TABLE "TaskOutcome" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "modelProvider" TEXT NOT NULL,
    "finalStatus" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "totalDurationMs" INTEGER NOT NULL,
    "toolCallCount" INTEGER NOT NULL DEFAULT 0,
    "cvDetectionCount" INTEGER NOT NULL DEFAULT 0,
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "taskDescription" TEXT NOT NULL,
    "taskComplexity" TEXT,
    "blockerTypes" TEXT[],
    "requiredHelp" BOOLEAN NOT NULL DEFAULT false,
    "firstAttempt" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "TaskOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaskOutcome_taskId_key" ON "TaskOutcome"("taskId");

-- CreateIndex
CREATE INDEX "TaskOutcome_modelName_idx" ON "TaskOutcome"("modelName");

-- CreateIndex
CREATE INDEX "TaskOutcome_outcome_idx" ON "TaskOutcome"("outcome");

-- CreateIndex
CREATE INDEX "TaskOutcome_createdAt_idx" ON "TaskOutcome"("createdAt");

-- CreateIndex
CREATE INDEX "TaskOutcome_modelProvider_idx" ON "TaskOutcome"("modelProvider");

-- AddForeignKey
ALTER TABLE "TaskOutcome" ADD CONSTRAINT "TaskOutcome_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
