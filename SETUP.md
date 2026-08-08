# Setting up on a new computer

Step-by-step to get the project running on another (Windows) PC, fully connected
(live site, D1, KV, email, git).

## Step 1 — Prerequisites

```powershell
winget install OpenJS.NodeJS.LTS
winget install Git
npm install -g wrangler
```

## Step 2 — Get the code

```powershell
git clone https://github.com/dpacportal-2026/app1
cd app1
npm install
```

> `SUMMARY.md` in the repo contains all credentials and infrastructure IDs (admin
> logins, Cloudflare account, D1/KV ids, SMTP secrets). `README.md` has feature docs.

## Step 3 — Authorize Cloudflare (critical)

```powershell
npx wrangler login
```

Log in with the **same Cloudflare account** that owns `arta-submission-form`. This
connects the project to the existing Worker, D1 (`arta-db`) and KV — the bindings
are already declared in `wrangler.jsonc`, so nothing else needs configuring.

## Step 4 — Verify

```powershell
npm run typecheck
npm run dev          # http://localhost:8787
npm run deploy       # deploy to production
```

## Step 5 — Git push auth

1. Create a PAT at github.com → Settings → Developer settings → Personal access tokens
   (fine-grained: repo `dpacportal-2026/app1`, Contents: read and write).
2. Store it once:

```powershell
git remote set-url origin https://<USERNAME>:<TOKEN>@github.com/dpacportal-2026/app1.git
git config --global credential.helper manager
```

## Step 6 — Local dev secrets (optional)

Add `.dev.vars` (gitignored) so local `npm run dev` can email/deploy locally:

```
SMTP_USER=dpacportal@gmail.com
SMTP_PASSWORD=<gmail app password>
ADMIN_USER=admin
ADMIN_PASSWORD=dpac-admin-2026
```

Production secrets live in Cloudflare (unaffected). The local D1 schema can be
initialized with `npm run db:init`.

## Step 7 — APK signing keystore

Copy `dpac-signed-package.zip` + `dpac-signed-package-INFO.txt` into the project
root (they are **gitignored**; without them, future APK updates cannot be signed).

## What you do NOT need to do

- Create D1/KV/email resources (all cloud-hosted, already bound).
- Re-set production secrets (stored in Cloudflare).

## Known quirks to expect

- PowerShell + curl JSON: use `-d "@file.json"` bodies (inline quoting breaks on `:`).
- After `wrangler deploy`, new routes may 404 for 20–60 s (edge propagation) — retry with `?x=<timestamp>`.
- If `git push` fails with `SEC_E_UNTRUSTED_ROOT`: `git -c http.sslVerify=false push` (corporate TLS interception).
- Landing-page changes need a bump of `var CACHE = "dpac-portal-vN"` in `public/sw.js` so installed app users refresh (cache-first SW).