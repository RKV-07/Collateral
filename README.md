# Collateral — The Watchman for Stock-Backed Loans

> A full-stack AI agent that watches your collateral-to-loan ratio, alerts you the instant a margin call is near, and tells you — in plain English — which shares to sell first so the forced liquidation harvests the biggest tax loss instead of the biggest tax bill.

---

## 1. The Story

Imagine you borrowed money against your stocks — a home mortgage, but your shares are the house. The bank agrees to lend you up to half the value of your portfolio. Now the market dips. Your shares shrink, your loan doesn't, and the ratio between them starts creeping toward the limit.

When you cross that line, the bank doesn't call you for a chat. It issues a **margin call**: *"Your collateral is too thin — post more money, or we sell your shares at whatever price we can get."* In a panic, forced selling happens at the worst prices, and the tax bill lands exactly when you can afford it least.

**Collateral is the watchman between you and that moment.** It measures your loan-to-value ratio every time prices move, pings you on Slack the instant you're in danger, and — when a sale is genuinely necessary — tells you **which lots to sell first**: the ones that harvest the largest capital loss, that avoid the "buy-it-back-too-soon" wash-sale penalty, and that restore your headroom by selling the smallest amount necessary.

It does all of this with **mathematics as the source of truth and AI as the explainer** — a design choice we're proud of, and one that makes the difference between a chatbot and a trustworthy financial agent. No automated trades, ever. The agent proposes; you approve.

---

## 2. What It Gives You

- **Live risk monitoring** — fetches real-time prices for every holding and recomputes your LTV, headroom, and risk state on every run.
- **Proactive margin-call alerts** — fires a Slack notification the *moment* you cross into High Risk, before anyone has to ask.
- **Tax-efficient "what to sell first"** — ranks your tax lots by cost-basis method (default: tax-loss harvesting), preferring short-term losses, and flags wash-sale risk (IRC §1091).
- **Plain-English reasoning** — an AI explains the recommendation in language you can read, question, and understand before approving anything.
- **Human-in-the-loop approval** — the pipeline pauses and waits for *you*. Nothing is executed without consent.
- **Audit trail for everything** — every run, decision, and provider used is appended to a compliance-ready SQLite log you can export as JSON.
- **Works where you work** — an interactive web dashboard, a Python batch runner, and MCP tools you can call straight from Claude Desktop / Claude Code.

---

## 3. How It Works

The agent is a six-node pipeline. Each node has one job, and only one of them is allowed to touch an AI model:

```
ingest → ltv_monitor ──→ tax_optimizer → reasoning_agent → human_approval → execution → end
                     └──→ safe_skip → end        (when Safe + no cash need)
```

1. **Ingest** — validates your portfolio JSON and pulls live prices for each holding.
2. **LTV Monitor** — computes collateral value, current LTV, headroom, and a risk state (`Safe` / `Warning` / `High Risk`). Fires the Slack alert on High Risk.
3. **Tax Optimizer** — ranks your lots, detects wash sales, classifies short vs. long term, and measures sector concentration. Pure math.
4. **Reasoning Agent** — *the only LLM node*. Synthesizes everything upstream into a structured recommendation and writes the human-readable rationale.
5. **Human Approval** — pauses the graph and waits for a yes or no.
6. **Execution** — records the approved (or rejected) decision to the audit log.

**A clever shortcut:** if your portfolio is `Safe` and you're not asking for cash, the pipeline *skips* the tax optimizer, the LLM, and the approval step entirely — saving tokens and time when nothing needs doing.

---

## 4. The Technical Deep-Dive

This section is where we geek out — for developers, reviewers, and anyone who wants to know *why this isn't just a chatbot with a calculator.*

### 4.1 How we fetch data

Prices come from **yfinance**, with a deliberate ladder of fallbacks so a flaky network never bricks a run:

- **Live prices** — `IngestPortfolioNode` fetches `ticker.fast_info.last_price` per symbol (`nodes.py`). Each symbol is wrapped in its own try/except, so one failing ticker never takes down the rest.
- **Static fixture fallback** — if yfinance isn't installed, a symbol returns no price, or the API errors, that lot silently keeps its fixture price. Tests and the MCP server run with `use_live_prices=False` for reproducibility.
- **Web app path** — the dashboard hits `POST /api/portfolio/prices`, which shells out to a Python subprocess via `execFileSync` (no shell, no command injection) after validating every symbol against `/^[A-Z0-9.\-]{1,10}$/`.
- **Market-stress what-ifs** — the UI's crash sliders feed `getAdjustedSnapshot`, which applies per-symbol or global price shocks so you can answer *"what happens if the market drops 20%?"* before it happens.

### 4.2 How the AI determines risk

Here's the part we're most proud of: **the AI doesn't decide risk. It explains it.**

- Nodes 1–3 compute every number — LTV, headroom, risk state, ranked lots, wash-sale flags, holding periods, sector concentration — as **deterministic Python**. No LLM inference for math, ever.
- The LLM is confined to a single node (`ReasoningAgentNode`). Its only job is to turn those precomputed numbers into a schema-constrained `Recommendation` and a readable rationale.
- A **12-rule system prompt** makes the boundary explicit: never recompute LTV or gain/loss, never invent a `lot_id`, reflect precomputed wash-sale flags, prefer short-term losses, and never re-derive post-sale LTV freehand (the shrinking-collateral feedback loop is easy to get wrong — `Liquidation Required = Deficit / (1 − Maintenance LTV Limit)`).
- Output is **schema-constrained** (`with_structured_output(..., method="function_calling")` for OpenAI-compatible providers, `responseSchema` for Gemini) and then **validated against the actual lot IDs** — a hallucinated reference is discarded and the run falls back to deterministic math.
- Risk classification itself is plain arithmetic: `Safe` when headroom ≥ 25% of max allowed loan, `Warning` below that, `High Risk` when headroom < 0.

**Resilience that never fails the demo:**

| Tier | Provider | Notes |
|---|---|---|
| 1 | **Gemini** (`gemini-3-flash-preview`) | Primary. `@google/genai` SDK (web) / direct REST with `responseSchema` (Python). |
| 2 | **Groq** (`llama-3.3-70b-versatile`) | Fast OpenAI-compatible fallback. |
| 3 | **Poolside** (`poolside/laguna-s-2.1`) | Thinking disabled for structured output. |
| 4 | **OpenRouter** (`google/gemma-4-26b-a4b-it:free`) | Free-tier fallback. |
| 5 | **Deterministic** | No LLM needed — the fallback that guarantees an answer. |

A **circuit breaker** skips any provider after 3 consecutive failures for 60 seconds, and a **24-hour disk cache** (SHA-256 of the prompt) stops identical queries from burning quota. Providers and models can even be added at runtime from the web UI, persisted server-side in `model-config.json` — no code changes, and API keys never leave the server.

### 4.3 Deterministic math as the fallback

If every LLM provider is down, quota'd, or returns garbage, the pipeline **still produces a correct answer**. The deterministic fallback in `ReasoningAgentNode` computes the recommendation directly:

- **Sizing** — `Liquidation Required = Deficit / (1 − Maintenance LTV Limit)`, which accounts for the fact that selling collateral shrinks both your collateral *and* your loan at once. Naive sizing (`deficit / limit`) understates what you must sell.
- **Ordering** — sells lots in rank order (losses before gains, short-term before long-term, biggest loss first) until the proceeds target is met, tracking realized gain/loss per lot.
- **Post-sale LTV** — computes `resulting_ltv_if_executed` from the pro-forma portfolio so you can see the account *after* the sale, not just before.
- **The same math runs in TypeScript** — `calculateOptimizer` in `src/utils.ts` is the parity engine behind the web dashboard. The Python and TypeScript implementations are cross-verified to produce identical numbers.

This is why we call the design **"AI governs, math decides."** The LLM adds judgment and explanation; it can never override arithmetic.

### 4.4 Why this design is trustworthy

- **The LLM is forbidden from computing** — a system-prompt rule *and* an anti-hallucination guard enforce it.
- **Human-in-the-loop** — the graph pauses via `interrupt()` and resumes only on your approval.
- **Append-only audit trail** — every run records timestamp, account, risk state, headroom, recommendation, approval, result status, and **which provider** produced it. Export it as JSON for compliance or record-keeping.
- **Cost-aware branching** — safe portfolios skip the LLM and approval entirely.
- **Domain correctness** — wash-sale detection (IRC §1091, same-symbol-within-30-days), short/long-term classification (≤ 365 days), five cost-basis methods (FIFO/LIFO/HIFO/TLH/Specific), and GICS-like sector-concentration warnings (> 40%).

---

## 5. Quick Start

### Web App (interactive dashboard)

```bash
npm install
# Set keys in .env.local — see §6
npm run dev
```

Open `http://localhost:5173`. Pick a preset account, stress-test it with the market sliders, and click **Audit Portfolio**.

**Admin panel:** sign in at `http://localhost:5173/login` with `ADMIN_EMAIL` + the password behind `ADMIN_PASSWORD_HASH` (default dev creds: `admin@collateral.dev` / `admin123` — change them), then visit `/admin` for a full-system view (users, portfolios, global audit trail, AI usage). In dev the server binds to `127.0.0.1` only; in production it binds `0.0.0.0` (required for Docker/Cloud Run) but enforces `SESSION_SECRET`, Helmet headers, and login rate-limiting.

### Python Batch Runner

```bash
uv venv --python 3.10 .venv
source .venv/bin/activate
uv pip install -r requirements.txt
python run_fixtures.py
```

Runs all 6 fixtures through the graph with static prices and prints pass/fail assertions (Python 3.10 required — 3.11+ has known import hangs with LangGraph).

### MCP Server (Claude Desktop / Claude Code)

```bash
python mcp_server.py        # or: mcp run mcp_server.py
```

Exposes two tools callable from any Claude interface:
- `check_ltv(account_json)` — LTV ratio and margin-call risk
- `optimize_sale(account_json, cash_need)` — tax-efficient lot sales

### Pre-flight Health Check

```bash
python check_providers.py
```

Pings Gemini, Groq, Poolside, OpenRouter, yfinance, and Slack — confirms what's live before a demo.

---

## 6. Configuration

All keys live in `.env.local` (copied from `.env.example`, gitignored). Providers can also be added at runtime from the web UI's **Manage Models** panel.

| Variable | Required | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | Yes (for LLM) | Primary provider (Google AI Studio) |
| `GEMINI_MODEL` | No | Default `gemini-3-flash-preview` |
| `GROQ_API_KEY` | No | Fallback 1 (free tier ~14,400 req/day) |
| `POOLSIDE_API_KEY` | No | Fallback 2 |
| `OPENROUTER_API_KEY` | No | Fallback 3 (free-tier models) |
| `SLACK_WEBHOOK_URL` | No | High Risk margin-call alerts |
| `AUDIT_STORAGE` | No | Audit backend — `sqlite` (default, dev/tests) or `firestore` (production) |
| `ADMIN_EMAIL` | No | Admin login email (`/login`, coexists with Google OAuth) |
| `ADMIN_PASSWORD_HASH` | No | bcrypt hash of the admin password — generate with `npm run hash:admin <password>` |
| `SESSION_SECRET` | Yes (prod) | Session-cookie signing secret; the server refuses to boot in production without it |

---

## 7. Repository Map

| File | Purpose |
|---|---|
| `nodes.py` | Pydantic models, 8 node classes, LTV/tax/wash-sale math, circuit breaker, audit logger, 12-rule `SYSTEM_PROMPT`, LLM chain + deterministic fallback |
| `agent.py` | LangGraph `StateGraph` builder with conditional `SafeSkip` branching and configurable checkpointer |
| `server.ts` | Express backend — provider fallback chain, model management, live prices, analyze/chat/audit endpoints |
| `src/utils.ts` | TypeScript parity engine — the same deterministic math for the web UI |
| `src/audit-store.ts` | Audit trail backends — local SQLite (dev/tests) or Firestore (production, via `AUDIT_STORAGE=firestore`) |
| `mcp_server.py` | FastMCP server exposing `check_ltv` / `optimize_sale` |
| `fixtures/fake_users.json` | 6 synthetic accounts used by `run_fixtures.py` |

---

## 8. Try It — Fixtures

Six synthetic accounts in `fixtures/fake_users.json` cover the full risk spectrum:

| # | Fixture | Key property |
|---|---|---|
| 1 | Safe Portfolio | `headroom > 0` — short-circuits via `SafeSkipNode` |
| 2 | Warning Portfolio | Thin headroom — monitor only |
| 3 | High Risk (Breached) | Negative headroom — liquidate, Slack alert fires |
| 4 | Mixed Tax Lots | Loss lot ranked before gain lot |
| 5 | Wash Sale Risk | Two XYZ lots 9 days apart — wash-sale flag |
| 6 | Non-Standard Limit | 35% LTV limit — formula correctness |

---

## 9. Honest Caveats

- **No live trading.** Execution is a simulated dry-run logged to the audit trail. Real broker integration is future work.
- **Not financial advice.** The agent says so itself, on every recommendation — it's a monitoring and planning tool, not an advisor.
- **Market data availability.** Live prices come from yfinance and are subject to its availability; the system degrades gracefully to fixture prices.
- **Wash-sale limits.** Detection covers same-symbol lots within 30 days; risk from a *post-sale repurchase* of a single lot can't be evaluated from current data alone.

---

## 10. Further Reading

- [`Details/Design.md`](Details/Design.md) — full architecture spec, formulas, and edge cases
- [`Details/QUICKSTART.md`](Details/QUICKSTART.md) — setup and troubleshooting deep-dive
- [`Details/live.md`](Details/live.md) — deploy & go live (self-hosted Docker Compose default, Google OAuth, Oracle free tier, optional Cloud Run + Firestore)
- [`Details/CHANGELOG.md`](Details/CHANGELOG.md) — version history
- [`Details/tier.md`](Details/tier.md) — Build with Gemini XPRIZE readiness map
