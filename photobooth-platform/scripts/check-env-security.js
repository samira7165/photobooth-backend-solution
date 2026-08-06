// Standalone security audit for .env — run manually (`node scripts/check-env-security.js`)
// or in CI before a deploy. Never blocks/exits non-zero; it's a report, not a gate
// (main.ts has the boot-time version of the placeholder/length checks below).
const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '..', '.env');

function loadEnv() {
  if (!fs.existsSync(ENV_PATH)) {
    console.error(`No .env found at ${ENV_PATH}`);
    process.exit(1);
  }
  const env = {};
  for (const line of fs.readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

function checkSecret(name, value, minLength) {
  if (!value) {
    console.warn(`⚠️  ${name} is missing.`);
    return false;
  }
  let ok = true;
  if (value.length < minLength) {
    console.warn(`⚠️  ${name} is only ${value.length} chars — should be at least ${minLength}.`);
    ok = false;
  }
  if (value.includes('change-this')) {
    console.warn(`⚠️  ${name} still contains the default placeholder text — rotate it before production.`);
    ok = false;
  }
  if (ok) console.log(`✅ ${name} looks reasonable (${value.length} chars, no placeholder text).`);
  return ok;
}

async function checkDefaultAdminPassword() {
  let PrismaClient, bcrypt;
  try {
    ({ PrismaClient } = require('@prisma/client'));
    bcrypt = require('bcrypt');
  } catch {
    console.warn('⚠️  Could not load @prisma/client or bcrypt — skipping default-password check.');
    return;
  }

  const prisma = new PrismaClient();
  try {
    const users = await prisma.user.findMany({ select: { email: true, passwordHash: true } });
    const matches = [];
    for (const user of users) {
      if (await bcrypt.compare('admin123456', user.passwordHash)) {
        matches.push(user.email);
      }
    }
    if (matches.length > 0) {
      console.warn(`⚠️  ${matches.length} user(s) still using the seed script's default password ("admin123456"): ${matches.join(', ')}`);
      console.warn('   Change these before production — this password is public (it is committed in prisma/seed.ts).');
    } else {
      console.log('✅ No user is using the default seeded password.');
    }
  } catch (err) {
    console.warn(`⚠️  Could not reach the database to check for the default admin password: ${err.message}`);
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  console.log('=== Environment security audit ===\n');
  const env = loadEnv();

  checkSecret('JWT_SECRET', env.JWT_SECRET, 32);
  checkSecret('JWT_REFRESH_SECRET', env.JWT_REFRESH_SECRET, 32);
  checkSecret('ENCRYPTION_SECRET', env.ENCRYPTION_SECRET, 32);

  console.log('');
  await checkDefaultAdminPassword();

  console.log('\n=== Done ===');
}

main();
