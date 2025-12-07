-- CreateTable
CREATE TABLE "mapping_profiles" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "headerHash" TEXT,
    "headerCount" INTEGER NOT NULL DEFAULT 0,
    "sampleHeaders" JSONB,
    "mappings" JSONB NOT NULL,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mapping_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mapping_profiles_companyId_sourceType_idx" ON "mapping_profiles"("companyId", "sourceType");

-- CreateIndex
CREATE INDEX "mapping_profiles_headerHash_idx" ON "mapping_profiles"("headerHash");

-- AddForeignKey
ALTER TABLE "mapping_profiles" ADD CONSTRAINT "mapping_profiles_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
