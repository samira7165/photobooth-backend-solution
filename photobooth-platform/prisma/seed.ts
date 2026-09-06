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

  // Create a demo prompt-option campaign — no reference-image templates,
  // just booth-selectable text prompts (see the PromptOption model comment
  // in schema.prisma). Admin still needs to link an AI provider key
  // (aiConfig.keyChain) before this can actually generate anything.
  const dreamJobCampaign = await prisma.campaign.upsert({
    where: { slug: 'dream-job' },
    update: {},
    create: {
      name: 'Dream Job Photobooth',
      slug: 'dream-job',
      status: 'ACTIVE',
      processingMode: 'ai',
      aiConfig: {
        promptMode: 'prompt-option',
        keyChain: [], // admin links keys later, via /api/v1/ai-providers
        fallbackProviders: ['gemini'],
      },
      photoSettings: {
        orientation: 'portrait',
        outputWidth: 1080,
        outputHeight: 1920,
      },
      backgroundConfig: {
        removal: false,
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
      collectFields: ['name'],
      outputMode: 'qr',
    },
  });

  console.log(`Demo campaign created: ${dreamJobCampaign.name} (slug: ${dreamJobCampaign.slug})`);

  const existingPromptOptions = await prisma.promptOption.count({ where: { campaignId: dreamJobCampaign.id } });
  if (existingPromptOptions === 0) {
    const promptOptions = [
      {
        name: 'Doctor',
        description: 'Become a professional doctor',
        prompt:
          'Transform this person into a professional doctor wearing a white lab coat with a stethoscope around their neck, standing in a modern hospital corridor. Keep their face exactly the same, maintain their exact facial features. Professional studio lighting, photorealistic, high quality, 4K detail.',
      },
      {
        name: 'Astronaut',
        description: 'Explore outer space',
        prompt:
          'Transform this person into an astronaut wearing a detailed NASA spacesuit, standing on the surface of the moon with Earth visible in the starry background. Keep their face exactly the same, maintain their exact facial features. Cinematic dramatic lighting, photorealistic, high quality, 4K detail.',
      },
      {
        name: 'Firefighter',
        description: 'Save lives as a firefighter',
        prompt:
          'Transform this person into a brave firefighter wearing full firefighter turnout gear and helmet, standing heroically in front of a red fire truck. Keep their face exactly the same, maintain their exact facial features. Dramatic golden hour lighting, photorealistic, high quality, 4K detail.',
      },
      {
        name: 'Pilot',
        description: 'Fly across the world',
        prompt:
          'Transform this person into an airline captain wearing a professional pilot uniform with captain stripes and wings badge, standing in a modern airplane cockpit with instruments visible. Keep their face exactly the same, maintain their exact facial features. Professional lighting, photorealistic, high quality, 4K detail.',
      },
      {
        name: 'Chef',
        description: 'Cook like a master chef',
        prompt:
          'Transform this person into a professional chef wearing a traditional white chef coat and tall chef hat (toque), standing in a luxury restaurant kitchen with stainless steel equipment. Keep their face exactly the same, maintain their exact facial features. Warm kitchen lighting, photorealistic, high quality, 4K detail.',
      },
    ];

    for (let i = 0; i < promptOptions.length; i++) {
      await prisma.promptOption.create({
        data: {
          campaignId: dreamJobCampaign.id,
          name: promptOptions[i].name,
          description: promptOptions[i].description,
          prompt: promptOptions[i].prompt,
          sortOrder: i,
        },
      });
    }
    console.log(`Prompt options created: ${promptOptions.length} options for ${dreamJobCampaign.slug}`);
  } else {
    console.log(`Prompt options already exist for ${dreamJobCampaign.slug}, skipping`);
  }

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
