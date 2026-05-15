// Celles API — Cloudflare Worker
// Proxies all Supabase access through a server with the service-role key,
// guarded by a shared-password login that returns an HMAC-signed bearer token.

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const allowedOrigins = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);

    if (request.method === 'OPTIONS') {
      return preflight(origin, allowedOrigins);
    }

    let res;
    try {
      if (url.pathname === '/api/login' && request.method === 'POST') {
        res = await handleLogin(request, env);
      } else if (url.pathname === '/api/planning' && request.method === 'GET') {
        res = await requireAuth(request, env, () => handleGetPlanning(url, env));
      } else if (url.pathname === '/api/planning' && request.method === 'POST') {
        res = await requireAuth(request, env, (user) => handleSavePlanning(request, env, user));
      } else if (url.pathname === '/api/historie' && request.method === 'GET') {
        res = await requireAuth(request, env, () => handleGetHistorie(env));
      } else if (url.pathname === '/api/health' && request.method === 'GET') {
        res = json({ ok: true });
      } else {
        res = json({ error: 'not_found' }, 404);
      }
    } catch (err) {
      res = json({ error: 'server_error', detail: String(err && err.message || err) }, 500);
    }

    return withCors(res, origin, allowedOrigins);
  }
};

// ── HANDLERS ────────────────────────────────────────────────────────────────

async function handleLogin(request, env) {
  const body = await safeJson(request);
  if (!body || typeof body.password !== 'string' || typeof body.name !== 'string') {
    return json({ error: 'invalid_body' }, 400);
  }
  const name = body.name.trim().slice(0, 80);
  if (!name) return json({ error: 'name_required' }, 400);

  const ok = await verifyPassword(body.password, env.APP_PASSWORD_HASH);
  if (!ok) return json({ error: 'invalid_credentials' }, 401);

  const ttlDays = parseInt(env.SESSION_TTL_DAYS || '30', 10);
  const exp = Math.floor(Date.now() / 1000) + ttlDays * 86400;
  const token = await signToken({ name, exp }, env.SESSION_SECRET);
  return json({ token, name, exp });
}

async function handleGetPlanning(url, env) {
  const jaar = url.searchParams.get('jaar');
  if (!jaar || !/^\d{4}$/.test(jaar)) return json({ error: 'invalid_jaar' }, 400);
  const r = await supa(env, `/rest/v1/planning?jaar=eq.${jaar}&order=week.asc&select=*`);
  if (!r.ok) return passthrough(r);
  return json(await r.json());
}

async function handleSavePlanning(request, env, user) {
  const body = await safeJson(request);
  if (!body) return json({ error: 'invalid_body' }, 400);
  const { jaar, week, current, next } = body;
  if (!Number.isInteger(jaar) || !Number.isInteger(week)) return json({ error: 'invalid_jaar_week' }, 400);
  if (!current || !next) return json({ error: 'missing_state' }, 400);

  const historieRow = {
    gewijzigd_door: user.name,
    jaar, week,
    wie_oud: current.wie || null, wie_nieuw: next.wie || null,
    status_oud: current.status || null, status_nieuw: next.status || null,
    bijz_oud: current.bijz || null, bijz_nieuw: next.bijz || null,
    opmerking_oud: current.opmerking || null, opmerking_nieuw: next.opmerking || null,
  };
  const planningRow = {
    jaar, week,
    wie: next.wie || null,
    status: next.status || null,
    bijz: next.bijz || null,
    opmerking: next.opmerking || null,
  };

  const hRes = await supa(env, '/rest/v1/planning_historie', {
    method: 'POST',
    headers: { ...JSON_HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify(historieRow),
  });
  if (!hRes.ok) return passthrough(hRes);

  const pRes = await supa(env, '/rest/v1/planning?on_conflict=jaar,week', {
    method: 'POST',
    headers: { ...JSON_HEADERS, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(planningRow),
  });
  if (!pRes.ok) return passthrough(pRes);

  return json({ ok: true });
}

async function handleGetHistorie(env) {
  const r = await supa(env, '/rest/v1/planning_historie?order=gewijzigd_op.desc&limit=60&select=*');
  if (!r.ok) return passthrough(r);
  return json(await r.json());
}

// ── AUTH MIDDLEWARE ─────────────────────────────────────────────────────────

async function requireAuth(request, env, next) {
  const auth = request.headers.get('Authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return json({ error: 'unauthorized' }, 401);
  const payload = await verifyToken(m[1], env.SESSION_SECRET);
  if (!payload) return json({ error: 'unauthorized' }, 401);
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return json({ error: 'expired' }, 401);
  return next(payload);
}

// ── SUPABASE PROXY ──────────────────────────────────────────────────────────

async function supa(env, path, init = {}) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    ...(init.headers || {}),
  };
  return fetch(env.SUPABASE_URL + path, { ...init, headers });
}

async function passthrough(r) {
  const text = await r.text();
  return new Response(text, { status: r.status, headers: JSON_HEADERS });
}

// ── CRYPTO: PASSWORDS (PBKDF2-SHA256) ──────────────────────────────────────
// Stored format: "iterations:saltB64:hashB64"

async function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const parts = stored.split(':');
  if (parts.length !== 3) return false;
  const iterations = parseInt(parts[0], 10);
  const salt = b64decode(parts[1]);
  const expected = b64decode(parts[2]);
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key, expected.length * 8
  );
  return timingSafeEqual(new Uint8Array(bits), expected);
}

// ── CRYPTO: SESSION TOKENS (HMAC-SHA256 over base64url payload) ────────────
// Format: <base64url(payload)>.<base64url(hmac)>

async function signToken(payload, secret) {
  const json = JSON.stringify(payload);
  const head = b64urlEncode(new TextEncoder().encode(json));
  const mac = await hmac(secret, head);
  return `${head}.${b64urlEncode(mac)}`;
}

async function verifyToken(token, secret) {
  try {
    const i = token.indexOf('.');
    if (i < 0) return null;
    const head = token.slice(0, i);
    const sig = token.slice(i + 1);
    const expected = await hmac(secret, head);
    if (!timingSafeEqual(b64urlDecode(sig), expected)) return null;
    return JSON.parse(new TextDecoder().decode(b64urlDecode(head)));
  } catch {
    return null;
  }
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ── BASE64 HELPERS ──────────────────────────────────────────────────────────

function b64decode(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64urlEncode(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return b64decode(s);
}

// ── HTTP HELPERS ────────────────────────────────────────────────────────────

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

async function safeJson(request) {
  try { return await request.json(); } catch { return null; }
}

function preflight(origin, allowed) {
  const res = new Response(null, { status: 204 });
  return withCors(res, origin, allowed);
}

function withCors(res, origin, allowed) {
  const headers = new Headers(res.headers);
  if (allowed.includes(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    headers.set('Access-Control-Max-Age', '86400');
  }
  return new Response(res.body, { status: res.status, headers });
}
