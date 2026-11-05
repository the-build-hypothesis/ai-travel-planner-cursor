# Infrastructure

## Cloudflare resources

| Resource | Name | Binding | Notes |
|---|---|---|---|
| Worker | `ai-travel-planner-cursor` | (primary) | Existing worker; not replaced |
| D1 | `bh-travel-v1-claude-cursor-db` | `DB` | id `d529e416-261f-41de-817d-bfc1391b0310` |
| KV | `bh-travel-v1-claude-cursor-ratelimit` | `RATE_LIMIT` | id `90fd7e4420114d1e9f81548b296821df` |
| Email | send binding | `EMAIL` | Domain preconfigured by admin |
| Assets | `./dist/client` | `ASSETS` | SPA via Workers Assets |

## Administrator-managed runtime config

Do not modify via agent secret commands:

- `OPENAI_API_KEY`
- `GOOGLE_MAPS_API_KEY`
- `LLM_PROVIDER`
- `LLM_MODEL`
- `EMAIL_FROM`

## Non-secret vars (wrangler.toml)

- `APP_NAME`
- `APP_PUBLIC_URL`

## Time zone convention

All administrative reporting timestamps and date-range filters use **UTC**.

## User deletion policy

Deleting a registered user:

1. Cascades and removes owned trips and messages.
2. Retains historical `usage_records` with `owner_user_id` cleared and `owner_type='unattributed'` for cost accounting.
