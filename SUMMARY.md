# DPAD Portal — Project Handoff Summary

**Live site:** https://arta-submission-form.dpacportal.workers.dev
**Repo:** https://github.com/dpacportal-2026/app1 (branch `main`)

---

## Admin access (current, live)

| Username | Role | Password | Notes |
|---|---|---|---|
| `admin` | superadmin | `dpac-admin-2026` | Recovery Q: "What was your first pet name?" / A: `Rex the Labrador` (use "Forgot password?" on /admin) |
| `testadmin` | admin | unknown (reset via superadmin: PATCH `/api/admin/accounts/:id` password) | Test leftover; deletable |

Passwords are PBKDF2-hashed in D1 — never recoverable, only resettable.

## Cloudflare

- Worker: `arta-submission-form` — account `fe3278049f522689f0df3ae803747865`
- D1 `arta-db`: `8dc992be-05bc-462e-8a4c-0b555374269f` (tables: `tickets`, `admin_users`, `activity_log`)
- KV: `f34a5c6722254b9c93db3e4584daa3d4` (OTP/CAPTCHA 5-min, `backup:*` snapshots, `backup:index`, `meta:last_archive`, `secret:gdrive-oauth`, `gdrive:token`, `gdrive:folder-id`)
- Env secrets: `ADMIN_USER=admin`, `ADMIN_PASSWORD=dpac-admin-2026`, `SMTP_USER=dpacportal@gmail.com`, `SMTP_PASSWORD=ylln scin jnql byja` (Gmail App Password)
- `EMAIL_FROM` var: "DPAD Portal <dpacportal@gmail.com>" (in `wrangler.jsonc`)
- Cron Trigger: `0 3 * * SUN` (weekly auto-backup, keeps last 12 KV snapshots)
- **wranger 4.119 quirk:** `wrangler kv` commands default to **LOCAL** mode; always pass `--remote`. `--ttl` is broken (writes instantly-expired keys) — omit it.

## Google Drive evidence upload (v17+)

- Optional proof/evidence file (≤10 MB: PNG/JPG/GIF/WebP/PDF) on the filing form → uploaded to Google Drive folder **"DPAD Evidence"** as `dpacportal@gmail.com`, public link saved on the ticket (evidence_file_* columns).
- Auth: **OAuth2 refresh token**, NOT a service account (Google gives SAs 0 quota on consumer accounts — `storageQuota.limit = 0`, SA uploads 403 forever).
- Config lives in KV `secret:gdrive-oauth` = `{client_id, client_secret, refresh_token}` (OAuth client "Desktop app" `281209627404-rk6frvn5ukqcoargi3q34ddg70m9r9d8...` in GCP project `dpac-portal`).
- Backup of the config: `%TEMP%\opencode\gdrive-oauth-config.json` (temp may be wiped — re-run consent flow if lost). Refresh token currently expires after **7 days** (app in Testing mode); when ready, publish the OAuth app in Google Console (Audience → Publishing status → In production) so tokens stop expiring.
- If the folder upload ever 403s, code falls back to uploading without a parent folder.
- `ticket_archive` table exists in D1 (archive feature NOT yet implemented — backup/restore does not include it yet).

## Version history (git)

| Commit | What |
|---|---|
| `da84f4a` | Initial: Hono worker + D1 + KV + landing page |
| `v5` `d317fda` | Gmail SMTP, EMAIL_FROM |
| `v6` `c02059e` | Admin panel + auth-guarded API |
| `v7` `5412f15` | Intake form (/intake), PDF via pdfmake |
| `v8`–`v10` | Charts, CSV export, clickable rows |
| `v12` `875d90a` | DB-backed accounts, PBKDF2, /accounts page |
| `v13` `5973bb1` | Superadmin roles + recovery q + activity log + /logs + CSV |
| `v14` `5fdcf07` | PWA (manifest/sw/icons) + signed APK (packageId `ne.dpacportal.app`, launcher **DPAD**) |
| `v15` `b2550e1` | Hero "Track a Ticket" dark green, footer credits |
| `v16` `4cdcfe4` | Notifications bell, backup/restore system |
| `v16.1` `d2db995` | Rate limiter only counts failed logins |
| `v17` `d8fdb60` | Evidence upload (multipart form, Drive link, admin/intake UI, CSV/PDF) |
| `v18` (this batch) | GDrive auth switched to OAuth refresh token; token/permission fixes |

## APK / signing (IMPORTANT)

- APK served at `/dpac-portal.apk` (~1.3 MB signed TWA, package `ne.dpacportal.app`).
- Icon placeholder: `public/app-icon.png` → replace + run `scripts/gen-icons.ps1`, redeploy. Site is a PWA (`manifest.webmanifest`, `sw.js`, icon set).
- **Signing keystore** (`dpac-signed-package.zip` + `-INFO.txt`, alias `dpac-key`) is **gitignored** — only exists in project root of THIS machine. Back it up to Google Drive/OneDrive. Critical: Future APK updates MUST use the same keystore.
- `.well-known/assetlinks.json` served for TWA verification.

## API surface (paths under `/api/admin`, Basic Auth)

`/stats`, `/tickets` (+`/export`), `/tickets/:id` GET/PATCH, `/tickets/:id/email`, `/login`, `/me`, `/activity`, `/activity-log` (+`/export`), `/accounts` GET/POST/DELETE/PATCH, `/accounts/recovery` GET/POST (public, rate-limited), `/notifications`, `/backup` GET/POST, `/backup/download`, `/backup/restore`, `/archive`. Public: `/api/send-otp`, `/api/captcha`, `/api/submit`, `/api/track/:ref`, `/api/health`.

## Themed UI decisions

- Colors: brand `#2e6b27`, brand-dark `#1d4518`, brand-light `#4c9a42` (all pages + Pillidge).
- Hero buttons: "File a Feedback" (solid green), "Track a Ticket" (glass w/ dark-green fill, no glow).
- Footer: "An innovative Project Developed by John Christian V. Villanueva, Ivy Rose V. Hipolito & Erickson N. Glodo. 2026"

## Known quirks (developing here)

1. **PowerShell → curl JSON:** `-d "{\"a\":\"b\"}"` breaks on `:` strings; use `-d @file.json` for reliability.
2. **Edge propagation:** after deploy, new routes can 404 for ~20–60 s; re-issue with `?x=<timestamp>`.
3. **Git push TLS:** network MITMs GitHub certs (`SEC_E_UNTRUSTED_ROOT`); workaround `git -c http.sslVerify=false push`. PAT went stale once — renew at github.com/settings/tokens (scopes: `repo`).
4. **SW caching:** cache-first on shell; bump `CACHE = "dpac-portal-vN"` in `public/sw.js` whenever landing/index changes so phones get the update.
5. **KV eventually-consistent reads:** keys written via API/CLI may be invisible to the Worker at a given edge for 10–60 s — retry instead of "fixing" something.
6. **Gmail OAuth:** client created before the consent screen existed → device flow fails `invalid_client`; use the localhost redirect flow instead (http://localhost/?code=…).

## Moving to another computer

- `git clone` + `node` + `npm install`; `npx wrangler login` with the dpacportal Cloudflare account; PAT for pushes; copy keystore zip manually (gitignored!)
- Everything remote (D1/KV/email) needs no migration.

## Backup/restore (self-serve DB insurance)

- Bell → superadmin panel: "Archives" snapshot (KV) + "Download backup" (JSON) + "Restore…" (safety snapshot taken first).
- Recents reminders: monthly archive (28-day snooze via "I archived data"); auto backup weekly Sunday 03:00 UTC.