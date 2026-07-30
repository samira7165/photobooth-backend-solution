// AES-256-GCM encrypt/decrypt for AI provider API keys at rest (see
// AiProvidersService). GCM's auth tag means decrypt() throws if the
// ciphertext was tampered with, not just if the key is wrong.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';

// Derives a 32-byte key from the env secret. scrypt (not a raw hash) makes
// brute-forcing the secret itself expensive even if the derived key leaked.
function getKey(): Buffer {
  const secret = process.env.ENCRYPTION_SECRET || process.env.JWT_SECRET;
  return scryptSync(secret, 'photobooth-salt', 32);
}

// Output format is "iv:authTag:ciphertext" (all hex), so decrypt() can pull
// the IV and auth tag back out without a separate column in the database.
export function encrypt(text: string): string {
  const iv = randomBytes(16);
  const key = getKey();
  const cipher = createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return iv.toString('hex') + ':' + authTag + ':' + encrypted;
}

export function decrypt(encryptedText: string): string {
  const parts = encryptedText.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted format');
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];
  const key = getKey();
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
