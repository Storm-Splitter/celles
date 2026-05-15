# celles-api

Cloudflare Worker that proxies Supabase access for the Celles vacation planner. Holds the Supabase **service-role** key server-side so the browser never sees it; the public anon key can be locked down via RLS.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/login` | – | Validates name + shared password, returns bearer token. |
| `GET`  | `/api/planning?jaar=YYYY` | Bearer | List planning rows for a year. |
| `POST` | `/api/planning` | Bearer | Atomically writes a `planning_historie` row + upserts `planning`. |
| `GET`  | `/api/historie` | Bearer | Last 60 history rows. |
| `GET`  | `/api/health` | – | Liveness probe. |

Body for `POST /api/planning`:
```json
{ "jaar": 2026, "week": 17, "current": {wie,status,bijz,opmerking}, "next": {wie,status,bijz,opmerking} }
```

## One-time setup

```powershell
cd C:\Users\woute\sites\celles\worker
npm install
npx wrangler login
```

### Generate and set secrets

```powershell
# 1) Choose a new shared password (NOT 'celles2026' — that's in git history)
node scripts/hash-password.mjs 'jouw-nieuwe-wachtwoord'
#   → copy output, then:
npx wrangler secret put APP_PASSWORD_HASH
#   → paste the iter:salt:hash string

# 2) Generate a random HMAC session secret
node scripts/gen-secret.mjs
npx wrangler secret put SESSION_SECRET
#   → paste the base64 string

# 3) Supabase service-role key (Supabase dashboard → Project Settings → API → service_role)
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
#   → paste the JWT
```

### Deploy

```powershell
npx wrangler deploy
```

Note the URL — something like `https://celles-api.<account>.workers.dev`. Plug that into `index.html` as the `API_BASE` constant.

## Local dev

Create `worker/.dev.vars` (already gitignored):

```
APP_PASSWORD_HASH=200000:....:....
SESSION_SECRET=....
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

```powershell
npx wrangler dev
```

## After deploy — enable RLS in Supabase

Only do this **after** the new `index.html` (using the Worker) is live and verified working:

```sql
alter table public.planning            enable row level security;
alter table public.planning_historie   enable row level security;
-- No policies: anon key is denied. Service role bypasses RLS, so the Worker still works.
```

## Rotating the leaked anon key (recommended)

The original anon key sat in `index.html` in git history. Once RLS is on with no anon policies it's effectively powerless, but you can rotate it via Supabase dashboard → Project Settings → API → "Reset anon/public key" for hygiene.
