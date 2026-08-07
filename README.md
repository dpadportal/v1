# ARTA Submission Form (Concern / Complaint / Request)

A bilingual (English/Tagalog) submission and tracking platform deployed on Cloudflare Workers + D1 + KV, with ARTA-compliant reference numbers (`ARTA-YYYY-XXXXX`).

## Stack

- **Frontend:** Static HTML + Tailwind CSS (CDN), served from Cloudflare assets
- **Backend:** Cloudflare Worker (Hono, TypeScript)
- **Database:** Cloudflare D1 (SQLite)
- **KV:** OTP codes and CAPTCHA sessions (5-minute TTL)
- **Email:** Resend REST API (falls back to console logging in dev)

## Getting started

```bash
npm install
npm run db:init        # create the tickets table in local D1
npm run dev            # wrangler dev at http://localhost:8787
```

The OTP code is logged to the terminal (no email needed while developing). To enable real email, create a `.dev.vars` file:

```
RESEND_API_KEY=re_xxxx
```

(`EMAIL_FROM` is set as a var in `wrangler.jsonc`.)

## API

| Route | Method | Purpose |
|---|---|---|
| `/api/send-otp` | POST | Validates email, stores a 6-digit code in KV (5-min TTL, 60-s cooldown), emails it |
| `/api/captcha` | POST | Generates a math problem, stores the hashed answer in KV, returns `{ sessionId, problem }` |
| `/api/submit` | POST | Validates payload, verifies OTP + CAPTCHA, inserts ticket into D1, emails the ARTA reference |
| `/api/track/:ref` | GET | Looks up a ticket by `ARTA-YYYY-XXXXX` and returns its status |

## Deploying

1. Create resources:

```bash
wrangler d1 create arta-db        # copy the returned database_id
wrangler kv namespace create kv   # copy the returned id
```

2. Paste both IDs into `wrangler.jsonc` (the `REPLACE_WITH_*` placeholders).
3. Apply the schema remotely and set the secret:

```bash
npm run db:init:remote
wrangler secret put RESEND_API_KEY
```

> The schema (`schema.sql`) is **destructive** (`DROP TABLE IF EXISTS tickets`).
> It must only be applied manually — never automatically.

4. Deploy:

```bash
npm run deploy
```

### Continuous deployment (GitHub Actions)

Pushes to `main` trigger an automatic deploy via `.github/workflows/deploy.yml`.
Add these repository secrets on GitHub (Settings → Secrets and variables → Actions):

- `CLOUDFLARE_API_TOKEN` — Cloudflare API token with `Workers Scripts: Edit` permission
- `CLOUDFLARE_ACCOUNT_ID` — your Cloudflare account ID

The workflow runs `npm ci`, `npm run typecheck`, and `wrangler deploy`. It does
**not** run database migrations; apply `schema.sql` manually.

## Data model (`tickets`)

`arta_reference_no` (unique, `ARTA-2026-00001`), `full_name` (optional), `cellphone_number` (optional), `email_address`, `district` (optional), `school_name`, `nature_of_request` (`concern-complaint` / `request` / `inquiry`), `description`, `privacy_consent`, `status` (`Pending` / `Under Review` / `Resolved`), `created_at`, `updated_at`.

Status starts as `Pending`; update it in D1 to reflect progress:

```sql
UPDATE tickets SET status = 'Resolved', updated_at = datetime('now') WHERE arta_reference_no = 'ARTA-2026-00001';
```
