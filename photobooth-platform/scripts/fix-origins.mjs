import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Find the key by prefix
  const key = await prisma.developerApiKey.findFirst({
    where: { keyPrefix: 'pb_live_N1ZM' }
  });

  if (!key) {
    console.log('Key not found with prefix pb_live_N1ZM');
    console.log('Listing all keys...');
    const allKeys = await prisma.developerApiKey.findMany({
      select: { id: true, name: true, keyPrefix: true, allowedOrigins: true }
    });
    console.log(JSON.stringify(allKeys, null, 2));
    return;
  }

  console.log('Found key:', key.id, key.name);
  console.log('Current origins:', key.allowedOrigins);

  await prisma.developerApiKey.update({
    where: { id: key.id },
    data: {
      allowedOrigins: [
        "http://localhost:3001",
        "http://localhost:3002",
        "http://localhost:3000",
        "http://192.168.0.101:3001",
        "http://192.168.0.101:3002"
      ]
    }
  });

  console.log('Origins updated successfully!');

  // Verify
  const updated = await prisma.developerApiKey.findUnique({
    where: { id: key.id },
    select: { allowedOrigins: true }
  });
  console.log('New origins:', updated.allowedOrigins);
}

main().catch(console.error).finally(() => prisma.$disconnect());
