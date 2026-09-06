import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const key = await prisma.developerApiKey.findFirst({
    where: { keyPrefix: 'pb_live_eAl4' }
  });

  if (!key) {
    console.log('Key not found!');
    const all = await prisma.developerApiKey.findMany({
      select: { id: true, name: true, keyPrefix: true }
    });
    console.log('All keys:', JSON.stringify(all, null, 2));
    return;
  }

  console.log('Found:', key.name);

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

  console.log('Done! Origins updated.');
}

main().catch(console.error).finally(() => prisma.$disconnect());
