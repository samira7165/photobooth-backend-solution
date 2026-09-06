// Generates fresh secrets for JWT_SECRET / JWT_REFRESH_SECRET / ENCRYPTION_SECRET.
// Run manually before a deploy: node scripts/generate-secrets.js
const crypto = require('crypto');

console.log('=== Copy these values to your .env file ===\n');
console.log(`JWT_SECRET=${crypto.randomBytes(64).toString('hex')}`);
console.log(`JWT_REFRESH_SECRET=${crypto.randomBytes(64).toString('hex')}`);
console.log(`ENCRYPTION_SECRET=${crypto.randomBytes(32).toString('hex')}`);
console.log(`\n=== Done ===`);
