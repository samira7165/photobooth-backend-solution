import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Create default admin user
  const passwordHash = await bcrypt.hash('admin123456', 12);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@xri.com.bd' },
    update: {},
    create: {
      email: 'admin@xri.com.bd',
      passwordHash,
      name: 'XRI Admin',
      role: 'SUPER_ADMIN',
      isActive: true,
    },
  });

  console.log(`Admin user created: ${admin.email} (role: ${admin.role})`);

  // Create default AI providers
  const providers = [
    { name: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com' },
    { name: 'dalle', baseUrl: 'https://api.openai.com' },
    { name: 'replicate', baseUrl: 'https://api.replicate.com' },
  ];

  for (const provider of providers) {
    await prisma.aiProvider.upsert({
      where: { name: provider.name },
      update: {},
      create: {
        name: provider.name,
        baseUrl: provider.baseUrl,
        isHealthy: true,
      },
    });
    console.log(`AI provider created: ${provider.name}`);
  }

  // Create a demo campaign
  const demo = await prisma.campaign.upsert({
    where: { slug: 'demo-campaign' },
    update: {},
    create: {
      slug: 'demo-campaign',
      name: 'Demo Campaign',
      status: 'DRAFT',
      processingMode: 'non-ai',
      photoSettings: {
        orientation: 'portrait',
        outputWidth: 1080,
        outputHeight: 1920,
      },
      backgroundConfig: {
        removal: true,
        allowCustomUpload: false,
        defaultBackgroundId: null,
      },
      frameConfig: {
        enabled: false,
        defaultFrameId: null,
      },
      propConfig: {
        enabled: false,
      },
      qrConfig: {
        enabled: true,
        position: { x: 900, y: 1750 },
        size: 150,
        contentType: 'download-link',
      },
      textConfig: {
        enabled: false,
      },
      collectFields: ['name', 'phone'],
      outputMode: 'qr',
    },
  });

  console.log(`Demo campaign created: ${demo.name} (slug: ${demo.slug})`);
  console.log('Seeding complete!');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
