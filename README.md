# Collateral — Portfolio Liquidity & Tax Optimizer Agent

A full-stack AI agent that monitors portfolio loan-to-value ratios, proposes tax-efficient lot sales, and explains its reasoning in plain English.

## Architecture

Six-node linear graph (`ingest → ltv_monitor → tax_optimizer → reasoning_agent → human_approval → execution`), implemented in both **Python LangGraph** (batch/test) and **TypeScript Express/React** (interactive web UI).

Only Node 4 (`ReasoningAgentNode`) is allowed to invoke an LLM. All other nodes are deterministic Python — no LLM inference for math, wash-sale detection, or state derivation.

### Nodes

| # | Node | Role |
|---|---|---|
| 1 | `IngestPortfolioNode` | Validates raw JSON into Pydantic `Account` model. Malformed fixtures fail loudly here. |
| 2 | `LTVMonitorNode` | Computes `collateral_value`, `current_ltv`, `headroom`, `risk_state`. Deterministic math. |
| 3 | `TaxOptimizerNode` | Ranks lots (losses first), detects wash sales (same-symbol-within-30-days), produces `ranked_lots`. |
| 4 | `ReasoningAgentNode` | **Only LLM node.** Synthesizes risk/headroom/lots into a structured `Recommendation`. 3-provider fallback chain. |
| 5 | `HumanApprovalNode` | Pauses via `interrupt()` for human review. On resume, sets `approved`. |
| 6 | `ExecutionNode` | Logs the final decision (dry-run; no live trades). |

## LLM Provider Chain

`ReasoningAgentNode` tries providers in order, falling through on failure:

1. **Gemini** (`gemini-2.5-flash`) — primary (thinking disabled via `thinking_budget=0`)
2. **OpenRouter** (`google/gemma-4-26b-a4b-it:free`) — fallback 1
3. **Poolside** (`poolside/laguna-s-2.1` at `inference.poolside.ai`) — fallback 2 (thinking disabled for clean structured output)
4. **Deterministic** — no LLM needed; computes a safe fallback recommendation

All providers use `with_structured_output(Recommendation, method="function_calling")` for schema-constrained output. LLM output is validated against known lot IDs to reject hallucinated references.

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
#   GEMINI_API_KEY=...
#   OPENROUTER_API_KEY=...  (optional, for fallback)
#   POOLSIDE_API_KEY=...    (optional, for fallback)
npm run dev
```

Open `http://localhost:5173`.

### Python Batch Runner

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
# Copy .env.local keys as above
python run_fixtures.py
```

Runs all 6 fixtures through the graph and prints pass/fail assertions.

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | Yes (for LLM) | Google Gemini API key |
| `OPENROUTER_API_KEY` | No | OpenRouter API key (free-tier models) |
| `POOLSIDE_API_KEY` | No | Poolside API key (`poolside/laguna-s-2.1`) |

All keys go in `.env.local` (loaded by both Python and Node entry points).

## Key Files

| File | Purpose |
|---|---|
| `nodes.py` | Pydantic models (`Lot`, `Account`, `LotProposal`, `Recommendation`), all 6 node classes, `SYSTEM_PROMPT` (9 rules) |
| `agent.py` | LangGraph `StateGraph` builder, configurable checkpointer (memory/postgres/sqlite), fallback `CompiledGraph` |
| `run_fixtures.py` | Test runner — builds graph once, iterates 6 fixtures, asserts correctness |
| `server.ts` | Express backend — Gemini + OpenRouter fallback, chat + analyze endpoints |
| `src/utils.ts` | TypeScript reference implementation of LTV/wash-sale math |
| `fixtures/fake_users.json` | 6 synthetic test accounts |
| `requirements.txt` | Python deps including `langchain-openai` |
