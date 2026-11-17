-- CreateEnum
CREATE TYPE "ActionExecutionStatus" AS ENUM ('PENDING', 'SENT', 'CONFIRMED', 'FAILED');

-- CreateTable
CREATE TABLE "ActionExecution" (
    "id" TEXT NOT NULL,
    "zapRunId" TEXT NOT NULL,
    "actionRowId" TEXT NOT NULL,
    "stage" INTEGER NOT NULL,
    "actionId" TEXT NOT NULL,
    "status" "ActionExecutionStatus" NOT NULL DEFAULT 'PENDING',
    "reference" TEXT NOT NULL,
    "signature" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActionExecution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ActionExecution_reference_key" ON "ActionExecution"("reference");

-- CreateIndex
CREATE INDEX "ActionExecution_zapRunId_stage_idx" ON "ActionExecution"("zapRunId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "ActionExecution_zapRunId_actionRowId_key" ON "ActionExecution"("zapRunId", "actionRowId");
