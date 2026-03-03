-- CreateTable
CREATE TABLE "attendance_rules" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'default',
    "attendedSymbols" TEXT[] DEFAULT ARRAY['Y', 'L']::TEXT[],
    "excusedSymbols" TEXT[] DEFAULT ARRAY['BZ', 'VA']::TEXT[],
    "absentSymbols" TEXT[] DEFAULT ARRAY['N', 'C']::TEXT[],
    "includeExcusedInAttendance" BOOLEAN NOT NULL DEFAULT true,
    "totalSessionsField" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "attendance_rules_companyId_name_key" ON "attendance_rules"("companyId", "name");

-- AddForeignKey
ALTER TABLE "attendance_rules" ADD CONSTRAINT "attendance_rules_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
