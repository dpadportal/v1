# ARTA Submission Form (Concern / Complaint / Request)

A bilingual (English/Tagalog) submission and tracking platform deployed on Cloudflare Workers + D1 + KV, with ARTA-compliant reference numbers (`ARTA-YYYY-XXXXX`).

## Stack

- **Frontend:** Static HTML + Tailwind CSS (CDN), served from Cloudflare assets
- **Backend:** Cloudflare Worker (Hono, TypeScript)
- **Database:** Cloudflare D1 (SQLite)
- **KV:** OTP codes and CAPTCHA sessions (5-minute TTL)
- **Email:** Gmail SMTP (falls back to console logging in dev)

## Getting started

```bash
npm install
npm run db:init        # create the tickets table in local D1
npm run dev            # wrangler dev at http://localhost:8787
```

The OTP code is logged to the terminal (no email needed while developing). To enable real email, create a `.dev.vars` file:

```
SMTP_USER=dpacportal@gmail.com
SMTP_PASSWORD=your-gmail-app-password
```

Use a [Gmail App Password](https://support.google.com/accounts/answer/185833) (requires 2-Step Verification on the account) — not your normal account password. (`EMAIL_FROM` is set as a var in `wrangler.jsonc`.)

## Admin panel

Visit `/admin` on the deployed site (Basic Auth, no separate page server):

- **Sign in:** username/password from the `ADMIN_USER` / `ADMIN_PASSWORD` secrets
- **Features:** stats cards (total per status), filter by status + free-text search, pagination, full ticket details, and status changes — each change emails the submitter a bilingual status update
- **Roles:** the env-configured `ADMIN_USER` bootstraps as the **superadmin** (auto-promoted on first login if no superadmin exists). Only the superadmin can create/delete accounts or set their own recovery question; superadmin accounts are undeletable and recoverable via a challenge question.
- **Recovery:** `Forgot password?` on the login page fetches the superadmin's security question, then resets the password when the answer matches.
- **Activity log:** `/logs` shows audit events (sign-ins, modal views, status changes, exports, account ops) with a **Download report (CSV)** button. Modal views are recorded client-side via `/api/admin/activity`.
- **Notifications (bell in the header):** shows new submissions from the last 24 hours (click a reference to open it), the monthly **archive reminder** (archiving should happen before the bi-annual cleanup — acknowledge with "I archived data", which snoozes it for 28 days), and backup status.
- **Backups & restore (superadmin only, in the notifications panel):**
  - *Manual:* "Back up now" saves a full snapshot (tickets + admin accounts + activity log) to KV; "Download backup" streams the whole database as a JSON file.
  - *Automatic:* a Cron Trigger (`0 3 * * SUN`, Sundays 03:00 UTC) snapshots the database; the last 12 snapshots are kept automatically.
  - *Restore:* pick a snapshot and confirm — a **safety snapshot of the current state is taken first**, then all three tables are replaced from the snapshot. Activity log entries are recorded for every backup/restore/archive action.
- **Auth requirements:** all `/api/admin/*` (except `recovery` endpoints) require Basic Auth.

Set the secrets:

```bash
wrangler secret put ADMIN_USER
wrangler secret put ADMIN_PASSWORD
```

## API

| Route | Method | Purpose |
|---|---|---|
| `/api/send-otp` | POST | Validates email, stores a 6-digit code in KV (5-min TTL, 60-s cooldown), emails it |
| `/api/captcha` | POST | Generates a math problem, stores the hashed answer in KV, returns `{ sessionId, problem }` |
| `/api/submit` | POST | Validates payload, verifies OTP + CAPTCHA, inserts ticket into D1, emails the ARTA reference |
| `/api/track/:ref` | GET | Looks up a ticket by `ARTA-YYYY-XXXXX` and returns its status |
| `/api/admin/tickets` | GET | Lists tickets (filter: `status`, `q`; page: `limit`, `offset`) — requires Basic Auth |
| `/api/admin/tickets/export` | GET | Downloads matching tickets as CSV (respects `status` + `q` filters) — requires Basic Auth |
| `/api/admin/tickets/:id` | GET | Returns one full ticket — requires Basic Auth |
| `/api/admin/tickets/:id` | PATCH | Updates a ticket's status and emails the submitter — requires Basic Auth |
| `/api/admin/tickets/:id/email` | POST | Emails the filled intake form (PDF attachment) to an address — requires Basic Auth |
| `/api/admin/stats` | GET | Counts per status — requires Basic Auth |
| `/api/admin/login` | POST | Validates credentials and records a sign-in event — requires Basic Auth |
| `/api/admin/me` | GET | Returns the signed-in user's role and recovery status — requires Basic Auth |
| `/api/admin/activity` | POST | Records a client-side activity event (e.g. modal views) — requires Basic Auth |
| `/api/admin/activity-log` | GET | Lists recent activity, paginated (`limit`, `offset`) — requires Basic Auth |
| `/api/admin/activity-log/export` | GET | Downloads the full activity log as CSV — requires Basic Auth |
| `/api/admin/accounts` | GET | Lists admin accounts (incl. recovery question) — requires Basic Auth |
| `/api/admin/accounts` | POST | Creates an admin account — **superadmin only** |
| `/api/admin/accounts/:id` | DELETE | Deletes an admin account — **superadmin only**, superadmin accounts protected |
| `/api/admin/accounts/:id` | PATCH | Changes own password, or recovery question (superadmin self) |
| `/api/admin/accounts/recovery` | GET | Returns the superadmin's security question (`?username=`) — public, rate-limited |
| `/api/admin/accounts/recovery` | POST | Resets the superadmin password if the answer is correct — public, rate-limited |
| `/api/admin/notifications` | GET | New submissions (24h), last backup, archive-reminder state — requires Basic Auth |
| `/api/admin/backup` | GET | Lists snapshots + auto-backup info — **superadmin only** |
| `/api/admin/backup` | POST | Creates a manual snapshot in KV — **superadmin only** |
| `/api/admin/backup/download` | GET | Downloads the full database dump as JSON — **superadmin only** |
| `/api/admin/backup/restore` | POST | Restores a snapshot (safety snapshot taken first) — **superadmin only** |
| `/api/admin/archive` | POST | Acknowledges the monthly archive reminder (28-day snooze) — **superadmin only** |

## Deploying

1. Create resources:

```bash
wrangler d1 create arta-db        # copy the returned database_id
wrangler kv namespace create kv   # copy the returned id
```

2. Paste both IDs into `wrangler.jsonc` (the `REPLACE_WITH_*` placeholders).
3. Apply the schema remotely and set the secrets:

```bash
npm run db:init:remote
wrangler secret put SMTP_USER
wrangler secret put SMTP_PASSWORD
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

## Mobile app (PWA + Android APK)

The site is installable as an app on any device:

- **PWA:** `/manifest.webmanifest` + `/sw.js` (offline shell) + icon set under `/icons/`. A "Get the DPAC app" pill appears on mobile — Chrome/Edge Android install natively, iPhone uses Safari Share → *Add to Home Screen*.
- **Android APK:** `/dpac-portal.apk` (1.3 MiB, package id `ne.dpacportal.app`, launcher name **DPAC**). It's a signed Trusted Web Activity (TWA) built through the [PWABuilder CloudAPK service](https://pwabuilder-cloudapk.azurewebsites.net/) (`POST /enqueuePackageJob` → poll `/getPackageJob?id=` → download `/downloadPackageZip?id=`).
- **Icon:** replace `public/app-icon.png` with your own 512x512 design and re-run `scripts/gen-icons.ps1` to regenerate all sizes (512/192/180/64 + maskable), then redeploy.
- **Signing key (IMPORTANT):** the APK is signed with a keystore generated by CloudAPK. Backups live in `dpac-signed-package.zip` (+ `dpac-signed-package-INFO.txt`) at the repo root — **gitignored, do not delete or commit**. Future APK/AAB updates must be signed with that same keystore (alias `dpac-key`), or users can't upgrade.
- **TWA verification:** `/.well-known/assetlinks.json` is served from the site root so the TWA opens the portal in full-screen mode.

## Data model (`tickets`)

`arta_reference_no` (unique, `ARTA-2026-00001`), `full_name` (optional), `cellphone_number` (optional), `email_address`, `district` (optional), `school_name`, `nature_of_request` (`complaint` / `suggestions` / `praise`), `description`, `privacy_consent`, `status` (`Pending` / `Under Review` / `Resolved`), `created_at`, `updated_at`.

Status starts as `Pending`; update it in D1 to reflect progress:

```sql
UPDATE tickets SET status = 'Resolved', updated_at = datetime('now') WHERE arta_reference_no = 'ARTA-2026-00001';
```
