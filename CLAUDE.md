# Celles — project context

Personal/family vacation-planner at **www.celles.nl** for three couples — Fons & Simone, Paul & Merlijn, Wouter & Rinske — sharing a holiday house in Celles. Low-stakes, ~3 active users, intentionally simple.

**Not PKW.** Cloudflare account is `woutervandenacker@proton.me` (account ID `c7c4ce83d5375f757050952093be5ba6`). Do NOT use the `wouter@pkw.nl` Cloudflare or any PKW Supabase project for celles work.

## The year-cycle workflow (drives every UX decision)

This is **non-obvious** from reading the code:

1. **End of each year**: Wouter manually pre-assigns every week of the next year to one of the three couples. After this, every week has a `wie` filled in.
2. **During the year**: each couple sets status per week:
   - `ZEKER` = we will use it
   - `MISSCHIEN` = maybe
   - `GEEN GEBRUIK` = we won't go → **releases the week for someone else**
   - (empty) = still undecided

So the question "is the house free?" really means **"which weeks are released or unassigned?"** — NOT "which weeks have no `wie`". The whole UX is built around that.

## "Beschikbaar" — the load-bearing concept

A week is **Beschikbaar** iff: not in the past AND (`status === 'GEEN GEBRUIK'` OR `!wie`).

- `isAvail(w)` in `index.html` is the single source of truth.
- Stats card, filter chip, banner, and row styling all derive from this.
- DB value stays `GEEN GEBRUIK`. Display label was renamed to "Beschikbaar" (calendar pill, legenda, edit modal). Data unchanged.

## UX decisions worth remembering

- **Past weeks hidden** in the current year, but **fully shown** for past years (so historical context is preserved). Driven by `isPast(w)` which respects `YEAR`.
- **Vacation name** is a centered bar across the 7 day-columns (`grid-column: 2 / 9`), always rendered (uniform row height).
- **Holiday names** are absolutely positioned within day cells so they don't shift day-number alignment. All day numbers live in a uniform 27×27 `.day-mark` container.
- **All 7 day columns are 1fr** on both desktop and mobile — weekends used to be fixed-width.
- **`bijz` filtered against feestdagen**: if someone typed "HEMELVAARTSDAG" into `bijz` but that feestdag is already shown per-day, suppress it from the bar (substring match, case-insensitive). Data unchanged; display only.
- **Stat cards at the bottom**, below the calendar — summary/navigation, not the primary view.
- **Stat cards are clickable** — they filter the calendar.
- **Mobile**: wie as initials (`F&S` / `P&M` / `W&R`) via splitting on `" en "`. Status pill shows "Vrij" (short) instead of "Beschikbaar" for space.

## Scoping rules

- Default to **low rigor** — over-engineering this app is wasted effort. 3 users, no compliance, no SLAs.
- Single static `index.html` + a thin Cloudflare Worker. **Don't propose framework rewrites** (React, Nuxt, etc.) — the simplicity is the point.

## Infra

- **Frontend**: GitHub repo `Storm-Splitter/celles`, GitHub Pages with CNAME `www.celles.nl`. Single-file `index.html`.
- **API**: Cloudflare Worker `celles-api` at `https://celles-api.vandenacker.workers.dev`. Source in `worker/`. Workers.dev subdomain: `vandenacker`.
- **Database**: Supabase project `jnnbawgcztqafrwfvpsm` ("Storm-Splitter's Org").
  - Real-data tables `planning`, `planning_historie`: RLS on, **no** anon policies — service-role only (worker bypasses RLS).
  - `heartbeat`: throwaway ping table (`id` + `pinged_at`), tapped 2×/week by the `supabase-heartbeat.yml` GitHub Action **with the anon key** to keep the free-tier project from auto-pausing. RLS on, with permissive anon insert/select/delete policies so the Action keeps working. Deliberately **not** switched to the service-role key — don't spread that key into GitHub for a throwaway table. `/api/health` does NOT touch the DB, so it can't replace the heartbeat.

### Worker secrets (Wrangler)
- `APP_PASSWORD_HASH` — PBKDF2-100k. **Workers cap iterations at 100k; do NOT raise.** Format `iter:saltB64:hashB64`.
- `SESSION_SECRET` — HMAC-SHA256 key, 32 random bytes base64.
- `SUPABASE_SERVICE_ROLE_KEY` — legacy service_role JWT.

### Worker env vars (`wrangler.toml [vars]`)
- `ALLOWED_ORIGINS` — includes `localhost:8000` for local previews; harmless in prod.
- `SUPABASE_URL`, `SESSION_TTL_DAYS=30`.

### Endpoints
- `POST /api/login` — `{name, password}` → `{token, name, exp}`
- `GET /api/planning?jaar=YYYY` — bearer-gated
- `POST /api/planning` — bearer-gated; body `{jaar, week, current, next}`; atomically writes historie + upserts planning
- `GET /api/historie` — bearer-gated
- `GET /api/health` — public

### Common commands
```powershell
cd C:\Users\woute\sites\celles\worker
npx wrangler deploy
npx wrangler secret put NAME            # interactive
node scripts/hash-password.mjs '<pwd>'  # produces APP_PASSWORD_HASH
node scripts/gen-secret.mjs             # produces SESSION_SECRET
```

Local preview: `python -m http.server 8000` in repo root → `http://localhost:8000/`.

### Supabase Management API
- Endpoint: `https://api.supabase.com/v1/projects/jnnbawgcztqafrwfvpsm/...`
- Auth: PAT from https://supabase.com/dashboard/account/tokens. Wouter revokes after each use (good hygiene). Ask for a new one when needed.
- Useful: `/api-keys` (returns anon + service_role), `/database/query` (run SQL).

## Working with Wouter

When SaaS setup gets multi-step (Supabase, Cloudflare, etc.) and per-click instructions start piling up, **offer to do it via Management API with a Personal Access Token** rather than walking him through dashboard clicks. He chose this path explicitly when first offered. Tell him upfront he can revoke the token after — that lowers the ask.
