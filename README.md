# AI Travel Planner

Conversational AI travel planning on Cloudflare Workers: guest + registered users, structured itineraries, maps, email verification/password reset, and a separate admin console with usage/cost monitoring.

## Stack

- **Runtime:** Cloudflare Workers + Workers Assets (SPA)
- **API:** Hono
- **DB:** Cloudflare D1
- **Rate limits:** Cloudflare KV
- **Email:** Cloudflare Email Service (`EMAIL` binding, `EMAIL_FROM`)
- **LLM:** Provider adapter (OpenAI via `LLM_PROVIDER` / `LLM_MODEL`)
- **Places:** Google Places / Geocoding (server-side)
- **Maps UI:** Leaflet + OpenStreetMap
- **Frontend:** React 19 + Vite + React Router

## Public URL

Configured via `APP_PUBLIC_URL` / `APP_PUBLIC_HOSTNAME` (see `cloudflare.env.example`).

## Local setup

```bash
cp .dev.vars.example .dev.vars   # fill local keys
cp cloudflare.env.example cloudflare.env
npm install --legacy-peer-deps
npm run db:migrate:local
npm run build
npx wrangler dev
```

In another terminal for Vite HMR against the worker proxy:

```bash
npm run dev
```

## Environment variables

### Development / ops (`cloudflare.env`)

| Variable | Purpose |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | Account |
| `CLOUDFLARE_API_TOKEN` | Infra ops |
| `CLOUDFLARE_WORKER_NAME` | Primary worker name |
| `EXPERIMENT_RESOURCE_PREFIX` | Resource naming prefix |
| `APP_PUBLIC_HOSTNAME` | Custom hostname |
| `APP_PUBLIC_URL` | Canonical URL |

### Worker runtime (administrator-managed)

| Variable | Purpose |
|---|---|
| `LLM_PROVIDER` | e.g. `openai` |
| `LLM_MODEL` | e.g. `gpt-4o-mini` |
| `OPENAI_API_KEY` | OpenAI secret |
| `GOOGLE_MAPS_API_KEY` | Places/geocode |
| `EMAIL_FROM` | Transactional sender |

Do **not** manage production secrets from this repo’s agent workflow.

## Authentication

- **Users:** email/password, PBKDF2 password hashes, HTTP-only `atp_session` cookie (14 days).
- **Guests:** HTTP-only `atp_guest` cookie holding an unguessable token; server stores only the hash.
- **Email verification & password reset:** hashed single-use tokens; reset ≤ 30 minutes; sessions revoked on reset.
- **Guest → account:** on register/login, trips + usage for the current guest id migrate to the user.
- **Admins:** separate tables/sessions (`atp_admin_session`). No public admin registration.

### Administrator bootstrap

1. Visit `/admin`
2. Sign in with username `admin` / password `admin` (initial bootstrap only; stored hashed)
3. You **must** change the password before any admin functionality is available
4. Bootstrap account is created once; deleting it does not recreate it
5. Cannot disable/delete the last active administrator

Default credentials are not shown in the public application UI.

## Email

Uses Cloudflare Email Service Worker binding `EMAIL` and sender `EMAIL_FROM`. Templates cover verification and password reset. Delivery failures return an error rather than claiming success.

## Database

Migrations live in `migrations/`. Apply with:

```bash
npm run db:migrate:local
npm run db:migrate:remote
```

## Testing

```bash
npm test
npm run typecheck
```

## Deployment

GitHub → Cloudflare Workers Builds for the worker `ai-travel-planner-cursor`.

```bash
npm run build
# push to main for Workers Builds, or:
npx wrangler deploy
```

Preserve administrator-managed secrets/vars during deploy.

## Monitoring & costs

Admin dashboard (`/admin`) reports estimated LLM and Google Places costs from per-request `usage_records`. Pricing assumptions are versioned (`src/shared/pricing.ts`). Costs are **estimates**, not invoices. Unattributed usage (no trip) is tracked separately. Reporting timezone: **UTC**.

## Known limitations

- Only the OpenAI provider adapter is implemented (per config; no silent fallback).
- Map tiles use OSM; Places enrichment requires `GOOGLE_MAPS_API_KEY`.
- Client does not embed Google Maps JS API keys (server-side Places only).
