/*
  Warnings:

  - You are about to drop the column `address` on the `Customer` table. All the data in the column will be lost.
  - Added the required column `addressLine1` to the `Customer` table without a default value. This is not possible if the table is not empty.
  - Added the required column `city` to the `Customer` table without a default value. This is not possible if the table is not empty.
  - Added the required column `pincode` to the `Customer` table without a default value. This is not possible if the table is not empty.
  - Added the required column `state` to the `Customer` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Customer" DROP COLUMN "address",
ADD COLUMN     "addressLine1" TEXT NOT NULL,
ADD COLUMN     "addressLine2" TEXT,
ADD COLUMN     "city" TEXT NOT NULL,
ADD COLUMN     "lastPaymentDate" TIMESTAMP(3),
ADD COLUMN     "pincode" TEXT NOT NULL,
ADD COLUMN     "rentalAmount" INTEGER,
ADD COLUMN     "rentalPlanDuration" INTEGER,
ADD COLUMN     "state" TEXT NOT NULL,
ADD COLUMN     "subscriptionEnd" TIMESTAMP(3),
ADD COLUMN     "subscriptionStart" TIMESTAMP(3),
ADD COLUMN     "subscriptionStatus" TEXT NOT NULL DEFAULT 'INACTIVE';
