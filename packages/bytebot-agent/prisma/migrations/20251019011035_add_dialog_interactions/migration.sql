-- CreateTable
CREATE TABLE "DialogInteraction" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "dialogType" TEXT NOT NULL,
    "dialogText" TEXT NOT NULL,
    "buttonClicked" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DialogInteraction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DialogInteraction_taskId_idx" ON "DialogInteraction"("taskId");

-- CreateIndex
CREATE INDEX "DialogInteraction_timestamp_idx" ON "DialogInteraction"("timestamp");

-- AddForeignKey
ALTER TABLE "DialogInteraction" ADD CONSTRAINT "DialogInteraction_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
