-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "district" TEXT;

-- CreateTable
CREATE TABLE "LocationChangeRequest" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "oldFullAddress" TEXT NOT NULL,
    "oldCity" TEXT NOT NULL,
    "oldDistrict" TEXT,
    "oldState" TEXT NOT NULL,
    "oldPincode" TEXT NOT NULL,
    "oldResidenceStatus" TEXT NOT NULL,
    "newFullAddress" TEXT NOT NULL,
    "newCity" TEXT NOT NULL,
    "newDistrict" TEXT NOT NULL,
    "newState" TEXT NOT NULL,
    "newPincode" TEXT NOT NULL,
    "newResidenceStatus" TEXT NOT NULL,
    "proofType" TEXT NOT NULL,
    "proofDocUrl" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocationChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LocationChangeRequest_customerId_status_idx" ON "LocationChangeRequest"("customerId", "status");

-- AddForeignKey
ALTER TABLE "LocationChangeRequest" ADD CONSTRAINT "LocationChangeRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
