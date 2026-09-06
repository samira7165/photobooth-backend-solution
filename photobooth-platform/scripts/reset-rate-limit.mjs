import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Reset all developer API keys usage counters
  const result = await prisma.developerApiKey.updateMany({
    data: { usageToday: 0 }
  });
  console.log(`Reset ${result.count} API key(s) usage counters`);

  // Show current state
  const keys = await prisma.developerApiKey.findMany({
    select: { id: true, name: true, keyPrefix: true, usageToday: true, rateLimit: true, isActive: true }
  });
  console.log('Current key states:', JSON.stringify(keys, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
