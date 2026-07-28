# Collateral — Portfolio Liquidity & Tax Optimizer Agent

A full-stack AI agent that monitors portfolio loan-to-value ratios, proposes tax-efficient lot sales, and explains its reasoning in plain English.

## Features

- **Real-time market data** — yfinance integration fetches live prices for all holdings (falls back to static fixtures)
- **Tax-efficient lot optimization** — Sells biggest losses first to harvest tax deductions, with wash-sale detection (IRC §1091)
- **Multi-provider LLM fallback** — Groq → Poolside → OpenRouter → deterministic (never fails)
- **MCP tools** — Call `check_ltv` or `optimize_sale` directly from Claude Desktop / Claude Code
- **Slack alerts** — Proactive webhook notifications on High Risk / margin call detection (fires immediately, before human approval)
- **Export audit trail** — Download full decision log as JSON for compliance / record-keeping
- **Human-in-the-loop** — Agent proposes, human approves. No automated trades without consent.

## Architecture

Six-node linear graph (`ingest → ltv_monitor → tax_optimizer → reasoning_agent → human_approval → execution`), implemented in both **Python LangGraph** (batch/test) and **TypeScript Express/React** (interactive web UI).

Only Node 4 (`ReasoningAgentNode`) is allowed to invoke an LLM. All other nodes are deterministic Python — no LLM inference for math, wash-sale detection, or state derivation.

### Nodes

| # | Node | Role |
|---|---|---|
| 1 | `IngestPortfolioNode` | Validates raw JSON into Pydantic `Account` model. Fetches live prices via yfinance. Malformed fixtures fail loudly here. |
| 2 | `LTVMonitorNode` | Computes `collateral_value`, `current_ltv`, `headroom`, `risk_state`. Sends Slack alert immediately on High Risk. Deterministic math. |
| 3 | `TaxOptimizerNode` | Ranks lots (losses first), detects wash sales (same-symbol-within-30-days), produces `ranked_lots`. |
| 4 | `ReasoningAgentNode` | **Only LLM node.** Synthesizes risk/headroom/lots into a structured `Recommendation`. 3-provider fallback chain. |
| 5 | `HumanApprovalNode` | Pauses via `interrupt()` for human review. On resume, sets `approved`. |
| 6 | `ExecutionNode` | Logs the final decision (dry-run; no live trades). |

## LLM Provider Chain

`ReasoningAgentNode` tries providers in order, falling through on failure:

1. **Groq** (`llama-3.3-70b-versatile`) — primary (fast inference, free tier ~14,400 req/day, OpenAI-compatible)
2. **Poolside** (`poolside/laguna-s-2.1` at `inference.poolside.ai`) — fallback 1 (thinking disabled via `{"thinking": {"type": "disabled"}}`)
3. **OpenRouter** (`google/gemma-4-26b-a4b-it:free`) — fallback 2 (free-tier ~20 RPM / 200 RPD)
4. **Deterministic** — no LLM needed; computes a safe fallback recommendation

All providers use `with_structured_output(Recommendation, method="function_calling")` for schema-constrained output. LLM output is validated against known lot IDs to reject hallucinated references.

### Available Models (via Groq)

| Model ID | Context | Best For |
|---|---|---|
| `llama-3.3-70b-versatile` | 128K tokens | Structured output, function calling (recommended) |
| `llama-3.1-8b-instant` | 128K tokens | Ultra-low latency, quick responses |
| `mixtral-8x7b-32768` | 32K tokens | Long context, multi-turn conversations |
| `gemma2-9b-it` | 8K tokens | Lightweight, efficient for simple tasks |

## Correct LTV Formula

```
Liquidation Required = Deficit / (1 − Maintenance LTV Limit)
```

This accounts for the **shrinking-collateral feedback loop**: selling collateral reduces both collateral value and loan balance simultaneously. The `resulting_ltv_if_executed` field on `Recommendation` captures the post-sale LTV, and the LLM is instructed never to recompute it freehand.

## Wash-Sale Detection

Deterministic same-symbol-within-30-day comparison in `TaxOptimizerNode` (Node 3). Applied to all symbols with 2+ lots. Single-lot symbols still carry a caveat (Rule 9 in `SYSTEM_PROMPT`): wash-sale risk from post-sale repurchase cannot be evaluated from current data alone.

## Test Fixtures

Six fixtures in `fixtures/fake_users.json`:

| # | Name | Key Property |
|---|---|---|
| 1 | Safe Portfolio | `headroom > 0` — no action needed |
| 2 | Warning Portfolio | Low headroom — monitor |
| 3 | High Risk (Breached) | `headroom < 0` — liquidate |
| 4 | Mixed Tax Lots | Multiple symbols — prioritize losses |
| 5 | Wash Sale Risk | Two XYZ lots 9 days apart — wash-sale flag |
| 6 | Non-Standard Limit | 35% LTV limit — formula correctness test |

## Quick Start

### Web App (TypeScript)

```bash
npm install
# Set keys in .env.local:
#   GROQ_API_KEY=...          (primary — free tier ~14,400 req/day)
#   POOLSIDE_API_KEY=...      (optional, fallback 1)
#   OPENROUTER_API_KEY=...    (optional, fallback 2)
#   SLACK_WEBHOOK_URL=...     (optional, for High Risk alerts)
npm run dev
```

Open `http://localhost:5173`.

### Python Batch Runner

```bash
uv venv --python 3.10 .venv
source .venv/bin/activate
uv pip install -r requirements.txt
# Copy .env.local keys as above
python run_fixtures.py
```

Runs all 6 fixtures through the graph and prints pass/fail assertions.

### MCP Server (Claude Desktop / Claude Code)

```bash
python mcp_server.py
# Or: mcp run mcp_server.py
```

Exposes two tools callable from any Claude interface:
- `check_ltv(account_json)` — Check LTV ratio and margin call risk
- `optimize_sale(account_json, cash_need)` — Recommend tax-efficient lot sales

### Pre-flight Health Check

```bash
python check_providers.py
```

Pings Groq, Poolside, OpenRouter, yfinance, and Slack. Reports which providers/integrations are available before a demo.

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `GROQ_API_KEY` | Yes (for LLM) | Groq API key (`api.groq.com/openai/v1`) — free tier ~14,400 req/day |
| `POOLSIDE_API_KEY` | No | Poolside API key (`poolside/laguna-s-2.1`) |
| `OPENROUTER_API_KEY` | No | OpenRouter API key (free-tier models) |
| `SLACK_WEBHOOK_URL` | No | Slack incoming webhook URL for High Risk margin call alerts |

All keys go in `.env.local` (loaded by both Python and Node entry points).

## Key Files

| File | Purpose |
|---|---|
| `nodes.py` | Pydantic models (`Lot`, `Account`, `LotProposal`, `Recommendation`), all 6 node classes, `SYSTEM_PROMPT` (9 rules), `AgentState` (includes `cash_need`) |
| `agent.py` | LangGraph `StateGraph` builder, configurable checkpointer (memory/postgres/sqlite), fallback `CompiledGraph` |
| `run_fixtures.py` | Test runner — builds graph once, iterates 6 fixtures, asserts correctness |
| `server.ts` | Express backend — Groq + Poolside + OpenRouter fallback chain, chat + analyze + audit + live-prices endpoints, `/api/health` |
| `mcp_server.py` | FastMCP v3 server — exposes `check_ltv` and `optimize_sale` as MCP tools for Claude Desktop / Claude Code |
| `src/utils.ts` | TypeScript reference implementation of LTV/wash-sale math |
| `check_providers.py` | Pre-flight health check — pings all 3 providers + yfinance + Slack |
| `fixtures/fake_users.json` | 6 synthetic test accounts |
| `requirements.txt` | Python deps including `langchain-openai`, `yfinance>=1.5.0`, `fastmcp>=3.0.0,<4.0.0` (requires Python 3.10+) |
