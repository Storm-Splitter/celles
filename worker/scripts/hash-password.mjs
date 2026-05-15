// Generate APP_PASSWORD_HASH for the Worker.
// Usage:  node scripts/hash-password.mjs '<chosen-password>'
// Output format: "iterations:saltB64:hashB64"  — paste this into `wrangler secret put APP_PASSWORD_HASH`.

import { webcrypto as crypto } from 'node:crypto';

const password = process.argv[2];
if (!password) {
  console.error("Usage: node scripts/hash-password.mjs '<password>'");
  process.exit(1);
}

const ITER = 100_000;
const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey(
  'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
);
const bits = await crypto.subtle.deriveBits(
  { name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' },
  key, 256
);
const b64 = (u8) => Buffer.from(u8).toString('base64');
console.log(`${ITER}:${b64(salt)}:${b64(new Uint8Array(bits))}`);
