-- CreateTable
CREATE TABLE "ReturnProcessEvent" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "eventDate" TIMESTAMP(3) NOT NULL,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReturnProcessEvent_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ReturnProcessEvent" ADD CONSTRAINT "ReturnProcessEvent_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
