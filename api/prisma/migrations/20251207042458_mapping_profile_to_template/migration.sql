/*
  Warnings:

  - You are about to drop the column `companyId` on the `mapping_profiles` table. All the data in the column will be lost.
  - Added the required column `templateId` to the `mapping_profiles` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "mapping_profiles" DROP CONSTRAINT "mapping_profiles_companyId_fkey";

-- DropIndex
DROP INDEX "mapping_profiles_companyId_sourceType_idx";

-- DropIndex
DROP INDEX "mapping_profiles_headerHash_idx";

-- AlterTable
ALTER TABLE "mapping_profiles" DROP COLUMN "companyId",
ADD COLUMN     "templateId" TEXT NOT NULL,
ALTER COLUMN "sourceType" SET DEFAULT 'excel';

-- CreateIndex
CREATE INDEX "mapping_profiles_templateId_sourceType_idx" ON "mapping_profiles"("templateId", "sourceType");

-- CreateIndex
CREATE INDEX "mapping_profiles_templateId_headerHash_idx" ON "mapping_profiles"("templateId", "headerHash");

-- AddForeignKey
ALTER TABLE "mapping_profiles" ADD CONSTRAINT "mapping_profiles_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
