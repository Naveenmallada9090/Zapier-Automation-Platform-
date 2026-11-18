-- AlterTable
-- Bumped whenever a password changes, so tokens handed out before a reset stop working.
ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
