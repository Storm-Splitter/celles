// Generate SESSION_SECRET for HMAC-signing bearer tokens.
// Usage:  node scripts/gen-secret.mjs
// Output: 32 random bytes, base64. Paste into `wrangler secret put SESSION_SECRET`.

import { webcrypto as crypto } from 'node:crypto';
const bytes = crypto.getRandomValues(new Uint8Array(32));
console.log(Buffer.from(bytes).toString('base64'));
