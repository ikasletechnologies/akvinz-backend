-- CreateTable
CREATE TABLE "CustomerDraft" (
    "id" TEXT NOT NULL,
    "fullName" TEXT,
    "mobileNumber" TEXT,
    "email" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pincode" TEXT,
    "planDuration" INTEGER,
    "houseType" TEXT,
    "residenceDocType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerDraft_pkey" PRIMARY KEY ("id")
);
