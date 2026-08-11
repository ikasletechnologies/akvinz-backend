import dotenv from "dotenv";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "@prisma/client";

dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Sample customers covering the states the admin dashboard needs to display:
// a fresh signup, an active rental subscriber, and a customer mid-return/refund.
const customers: Prisma.CustomerCreateInput[] = [
  {
    fullName: "Ravi Kumar",
    mobileNumber: "9000000001",
    email: "ravi.kumar@example.com",
    addressLine1: "12 MG Road",
    city: "Chennai",
    state: "Tamil Nadu",
    pincode: "600001",
    planDuration: 12,
    houseType: "rent",
    paymentStatus: "PENDING",
  },
  {
    fullName: "Anitha Suresh",
    mobileNumber: "9000000002",
    email: "anitha.suresh@example.com",
    addressLine1: "45 Anna Nagar",
    city: "Chennai",
    state: "Tamil Nadu",
    pincode: "600040",
    planDuration: 24,
    houseType: "permanent",
    paymentStatus: "COMPLETED",
    rentalPlanDuration: 12,
    rentalAmount: 699,
    subscriptionStatus: "ACTIVE",
    subscriptionStart: new Date(),
    subscriptionEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    lastPaymentDate: new Date(),
  },
  {
    fullName: "Mohammed Iqbal",
    mobileNumber: "9000000003",
    email: "mohammed.iqbal@example.com",
    addressLine1: "8 Beach Road",
    city: "Chennai",
    state: "Tamil Nadu",
    pincode: "600028",
    planDuration: 12,
    houseType: "rent",
    paymentStatus: "PENDING_REFUND",
    subscriptionStatus: "CANCELLED",
    returnRequested: true,
    returnRequestedAt: new Date(),
  },
];

async function main() {
  for (const customer of customers) {
    await prisma.customer.upsert({
      where: { email: customer.email },
      update: {},
      create: customer,
    });
  }
  console.log(`Seeded ${customers.length} customers.`);
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
