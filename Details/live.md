# Collateral — Deploying & Going Live

> The goal: a public, always-on deployment that **you run and own**. The default path is
> **self-hosted** — Docker Compose + Caddy + a local SQLite file on a free-tier VPS (e.g.
> Oracle Cloud Always Free). The optional Cloud Run + Firestore path is supported for
> managed hosting / XPRIZE evidence, but is never required.

**Today:** Aug 2026 · Submission deadline Aug 17.

---

## 1. Default deployment — self-hosted (Docker Compose + Caddy + SQLite)

```
Browser ──→ Caddy (HTTPS :443) ──→ collateral (node dist/server.cjs, :3000)
              │
              ├─ /api/portfolio/*       → deterministic optimizer (in-process)
              ├─ /api/portfolio/analyze → LLM chain (Gemini → Groq → Poolside → OpenRouter)
              ├─ /api/portfolio/prices  → python3 + yfinance (in-container venv)
              ├─ /api/portfolio/audit   → persists a record, then downloads JSON
              └─ /api/audit/live        → recent audit records + usage stats
              │
              └─ Persistence: Prisma + SQLite (data/collateral.db on a Docker volume)
```

### 1.1 One-time config

```bash
cp .env.example .env.local
```

Fill in `.env.local`:

| Var | Value |
|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth credentials (see §2) |
| `SESSION_SECRET` | Long random string (e.g. `openssl rand -hex 32`) |
| `APP_URL` | Your public https URL, e.g. `https://app.example.com` |
| `GEMINI_API_KEY` (or `GROQ_API_KEY` / `OPENROUTER_API_KEY` / `POOLSIDE_API_KEY`) | At least one LLM key |

### 1.2 Run

```bash
docker compose up -d --build
curl https://<your-domain>/api/health   # → {"status":"ok","auditStorage":"sqlite", ...}
```

- `prisma migrate deploy` runs on every boot and is idempotent (SQLite file on the
  `collateral_data` volume).
- **Backup:** SQLite is a single file (`data/collateral.db`). Back it up regularly
  (`sqlite3 data/collateral.db ".backup 'backup.db'"` or a plain copy) and it moves
  as-is to a bigger host when you outgrow the free tier.

### 1.3 Dev-only test login (no OAuth needed)

When `NODE_ENV != production` you can log in without Google:

```bash
curl -c /tmp/c -X POST http://localhost:3000/dev/login \
  -H 'Content-Type: application/json' -d '{"email":"you@example.com"}'
curl -b /tmp/c http://localhost:3000/api/me     # → {"user":{...}}
curl -b /tmp/c http://localhost:3000/api/portfolio
```

`/dev/login` returns 404 on production builds.

---

## 2. Google OAuth (real-user login)

The OAuth flow is already wired (passport `google` strategy + Prisma session store):

```
/auth/google → Google consent → /auth/google/callback → user upserted → session cookie
```

Setup (free, no billing):

1. Go to https://console.cloud.google.com/apis/credentials and **Create credentials → OAuth client ID → Web application**.
2. **Authorized JavaScript origins:** add your public origin (e.g. `https://app.example.com`) and `http://localhost:3000` for local dev.
3. **Authorized redirect URI:** add exactly `<APP_URL>/auth/google/callback`.
4. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, and `APP_URL` in `.env.local`.

If OAuth is unconfigured the app still runs; `/auth/google` shows a friendly error instead of crashing.

---

## 3. Oracle Cloud Free Tier (recommended free VPS)

Oracle **Always Free** ARM instances (Ampere A1, 4 OCPU / 24 GB RAM) comfortably run this stack:

1. Create the instance (Ubuntu 24.04).
2. Install Docker + Compose plugin.
3. In the VCN **security list**, add ingress rules for TCP **80** and **443**.
4. Point your domain's **A record** at the instance's public IP.
5. `docker compose up -d --build`
6. Terminate TLS with the repo's `Caddyfile` — run Caddy on the host (`caddy start --config ./Caddyfile`) or as a compose service; `reverse_proxy app:3000`.

From here, swap to a self-hosted VPS anytime by copying the `collateral_data` volume (or the single SQLite file) to the new host — no schema changes.

---

## 4. Optional: Cloud Run + Firestore (managed hosting / XPRIZE evidence)

The audit trail is the only piece that differs in production on Cloud Run. The app selects
storage purely via `AUDIT_STORAGE` (default `sqlite`) — no code changes.

| Concern | Self-host / dev | Cloud Run |
|---|---|---|
| Audit trail | SQLite (`collateral_audit.db`, `AUDIT_STORAGE=sqlite`) | Firestore (`audit_trail`, `AUDIT_STORAGE=firestore`) |
| Server | `node dist/server.cjs` (serves `dist/`, :3000) | same container on Cloud Run |
| Live prices | python3 + yfinance in-container | same (venv in image) |

### 4.1 Prerequisites

```bash
gcloud auth login
gcloud config set project <YOUR_PROJECT_ID>
gcloud services enable run.googleapis.com firestore.googleapis.com artifactregistry.googleapis.com
```

### 4.2 Firestore

```bash
gcloud firestore databases create --location=us-central1 --type=firestore-native
```

The app reads/writes the `audit_trail` collection; no manual index needed for a single-field
`orderBy("timestamp","desc")`.

### 4.3 Build & push

```bash
docker build -t collateral .
docker run --rm -p 3000:3000 -e GEMINI_API_KEY=... collateral   # local check

export PROJECT_ID=$(gcloud config get-value project)
export REGION=us-central1
gcloud artifacts repositories create collateral --repository-format=docker \
  --location=$REGION --description="Collateral images" || true
export IMAGE=$REGION-docker.pkg.dev/$PROJECT_ID/collateral/collateral:latest
docker build -t $IMAGE .
docker push $IMAGE
```

### 4.4 Deploy

```bash
gcloud run deploy collateral \
  --image=$IMAGE --region=$REGION --platform=managed --port=3000 \
  --memory=512Mi --cpu=1 --min-instances=0 --max-instances=5 --concurrency=80 \
  --timeout=120 --allow-unauthenticated \
  --set-env-vars="NODE_ENV=production,AUDIT_STORAGE=firestore,APP_URL=$URL,GOOGLE_CLIENT_ID=...,GOOGLE_CLIENT_SECRET=...,SESSION_SECRET=..." \
  --set-secrets="GEMINI_API_KEY=gemini-api-key:latest" \
  --set-secrets="GROQ_API_KEY=groq-api-key:latest" \
  --set-secrets="POOLSIDE_API_KEY=poolside-api-key:latest" \
  --set-secrets="OPENROUTER_API_KEY=openrouter-api-key:latest"
```

> **No disk persistence:** Cloud Run filesystem is ephemeral — this is exactly why the audit
> trail moves to Firestore there. With `AUDIT_STORAGE=sqlite` on Cloud Run, records would be
> lost on instance recycle.

### 4.5 Verify on Cloud Run

```bash
URL=$(gcloud run services describe collateral --region=$REGION --format="value(status.url)")
curl -s $URL/api/health          # → {"status":"ok","auditStorage":"firestore", ...}
curl -s $URL/api/audit/live      # → {"total_stored":0,"usage":{...},"records":[]}
```

---

## 5. Costs (rough)

| Setup | Typical bill |
|---|---|
| Oracle Always Free ARM | **$0** (4 OCPU / 24 GB, free egress allowance) |
| Cloud Run (scale-to-zero demo) | ~$0 — first 180k vCPU-sec/month free |
| Firestore (native) | ~$0 — free tier 1 GiB / 50k reads per day |
| Gemini / Groq / OpenRouter free tiers | $0 for the demo |

A judging-demo deployment should cost **$0** on Oracle, or a few cents on Cloud Run.

---

## 6. Evidence pack (XPRIZE §5.6)

1. `/api/health` response showing `auditStorage` (sqlite or firestore) + provider config.
2. `/api/audit/live` response showing stored records + `usage` counts.
3. Screenshot of the dashboard after an Audit Portfolio run (LTV gauge, proposed lots, AI rationale, provider badge).
4. Screenshot of the storage console (Firestore `audit_trail`, or your VPS volume).
5. Optional 30–60s screencast hitting analyze → audit → live.

---

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| `ERR_MODULE_NOT_FOUND ... vite` | Old `dist/` — rebuild with `bun run build`. Vite is dev-only. |
| No live prices | `python3` + `yfinance` venv failed to install during image build; app still works with static prices. |
| OAuth "redirect_uri_mismatch" | `APP_URL` must exactly match the registered redirect URI `<APP_URL>/auth/google/callback`. |
| Deployment "not listening on port" | Server honors `PORT` (default 3000). Match `--port` with your env. |
| 429 from OpenRouter/Groq | Expected on free tiers — the chain falls through to the next provider automatically. |
| Empty audit/live after analyze | Firestore composite index pending — create it when prompted, wait ~1 min. |
