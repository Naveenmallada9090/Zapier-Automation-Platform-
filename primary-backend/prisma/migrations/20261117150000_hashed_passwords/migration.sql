-- AlterTable
-- The column now stores a bcrypt hash instead of the plaintext password.
-- A rename keeps the existing values, the hash-passwords script converts them.
ALTER TABLE "User" RENAME COLUMN "password" TO "passwordHash";
