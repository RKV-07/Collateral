# Quick Start Guide

## Prerequisites

- **Node.js** 18+ (for the web app)
- **Python** 3.10 (required — 3.11+ has import hangs with LangGraph)
- **uv** (Python package manager — `curl -LsSf https://astral.sh/uv/install.sh | sh`)
- **Groq API key** (free tier — [console.groq.com](https://console.groq.com))

Optional:
- Poolside API key (fallback LLM)
- OpenRouter API key (fallback LLM)
- Slack webhook URL (High Risk alerts)

---

## Setup

### 1. Clone & Install

```bash
cd /home/manu/project

# Python venv (MUST be Python 3.10)
uv venv --python 3.10 .venv
source .venv/bin/activate
uv pip install -r requirements.txt

# Node dependencies
npm install
```

### 2. Configure API Keys

```bash
cp .env.example .env.local
```

Edit `.env.local` and add your keys:

```
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxx
POOLSIDE_API_KEY=psk_xxxxxxxx         # optional
OPENROUTER_API_KEY=sk-or-xxxxxxxx     # optional
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...  # optional
```

### 3. Verify Everything Works

```bash
python check_providers.py
```

This pings Groq, Poolside, OpenRouter, yfinance, and Slack. You should see checkmarks next to each service you've configured.

---

## Run

### Web App (Interactive UI)

```bash
npm run dev
```

Open **http://localhost:5173** in your browser. Select a preset account, pick a Groq model, and click **Audit Portfolio**.

### Python Batch Runner

```bash
python run_fixtures.py
```

Runs all 6 test fixtures through the LangGraph pipeline and prints pass/fail results. Uses `use_live_prices=False` (static prices for reproducibility).

### MCP Server (Claude Desktop / Claude Code)

```bash
python mcp_server.py
# Or: mcp run mcp_server.py
```

Exposes two tools callable from Claude:
- `check_ltv(account_json)` — Check LTV ratio and margin call risk
- `optimize_sale(account_json, cash_need)` — Recommend tax-efficient lot sales

### Pre-flight Health Check

```bash
python check_providers.py
```

---

## File Guide

### Core Python (LangGraph Agent)

| File | What It Does |
|---|---|
| `nodes.py` | All Pydantic models (`Lot`, `Account`, `LotProposal`, `Recommendation`), 6 node classes, `SYSTEM_PROMPT` (9 rules), `AgentState` |
| `agent.py` | Builds the LangGraph `StateGraph`, configurable checkpointer, exports `run_portfolio_audit()` |
| `run_fixtures.py` | Test runner — iterates 6 fixtures, asserts correctness |
| `mcp_server.py` | FastMCP v3 server — exposes `check_ltv` and `optimize_sale` as MCP tools |
| `check_providers.py` | Pre-flight health check — pings all providers + yfinance + Slack |
| `requirements.txt` | Python dependencies |
| `.env.example` | Template for API keys |

### TypeScript (Web App)

| File | What It Does |
|---|---|
| `server.ts` | Express backend — Groq/Poolside/OpenRouter fallback chain, chat, analyze, audit, live-prices endpoints, `/api/health` |
| `src/App.tsx` | Main React app — model selector, preset configs, audit workflow |
| `src/components/OptimizationProposal.tsx` | Renders proposals — tax lots, LTV gauge, wash-sale warnings, export audit trail |
| `src/components/ChatAssistant.tsx` | Chat interface — ask questions about portfolio, uses Groq |
| `src/utils.ts` | TypeScript reference implementation of LTV/wash-sale math |

### Config & Data

| File | What It Does |
|---|---|
| `.env.local` | Your actual API keys (gitignored — never commit) |
| `.env.example` | Template showing which keys are needed |
| `.gitignore` | Ignores `.venv/`, `__pycache__/`, `.env*`, `node_modules/`, `PROJECT_DUMP.txt` |
| `fixtures/fake_users.json` | 6 synthetic test accounts (Safe, Warning, High Risk, Mixed Lots, Wash Sale, Non-Standard Limit) |
| `package.json` | Node dependencies and scripts (`dev`, `build`, `lint`) |
| `tsconfig.json` | TypeScript configuration |

### Tests

| File | What It Does |
|---|---|
| `tests/test_nodes.py` | 54 unit + e2e tests for all Python nodes |
| `tests/test_mcp.py` | 8 tests for MCP server tools |

### Docs

| File | What It Does |
|---|---|
| `README.md` | Full project docs — architecture, LTV formula, provider chain |
| `QUICKSTART.md` | This file — setup and run instructions |
| `CHANGELOG.md` | Version history and changes |
| `Design.md` | Architecture spec — node graph, provider chain, integrations |

---

## Test Fixtures

| # | Name | What It Tests |
|---|---|---|
| 1 | Safe Portfolio | `headroom > 0` — no action needed |
| 2 | Warning Portfolio | Low headroom — monitor only |
| 3 | High Risk (Breached) | `headroom < 0` — liquidate, Slack alert fires |
| 4 | Mixed Tax Lots | Multiple symbols — prioritize biggest losses |
| 5 | Wash Sale Risk | Two XYZ lots 9 days apart — wash-sale flag |
| 6 | Non-Standard Limit | 35% LTV limit — formula correctness |

---

## Troubleshooting

**Python import hangs?**
You're probably on Python 3.11+. Recreate the venv with 3.10:
```bash
rm -rf .venv
uv venv --python 3.10 .venv
source .venv/bin/activate
uv pip install -r requirements.txt
```

**Groq 401 error?**
Check your `GROQ_API_KEY` in `.env.local`. Free tier requires email verification at [console.groq.com](https://console.groq.com).

**OpenRouter 429/422?**
Free-tier rate limit hit. The agent falls back to Groq/Poolside automatically.

**yfinance not loading prices?**
Check internet connection. yfinance fetches from Yahoo Finance. Per-symbol errors are caught individually — one failing ticker won't break others.
