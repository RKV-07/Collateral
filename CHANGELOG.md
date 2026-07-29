# Changelog

## [Unreleased]

### Added
- **Conditional graph branching** (`agent.py`): `SafeSkipNode` + `add_conditional_edges` — Safe portfolios with no cash_need skip the tax optimizer, LLM, and human approval entirely. Saves LLM tokens for healthy portfolios. Fallback runner updated with `_next_node` graph walker to support conditional edges.
- **Short-term vs long-term capital gain analysis** (`nodes.py`): `TaxOptimizerNode` computes `days_held` and `is_short_term` (<=365 days) per lot. Serialized into `lot_dict` (avoids `@property` serialization bug). `holding_period_days` added to `AgentState`. SYSTEM_PROMPT rule 10 prefers selling short-term losses (higher tax offset against ordinary income).
- **Sector concentration analysis** (`nodes.py`): GICS-like sector mapping for 60+ tickers. `TaxOptimizerNode` computes per-sector portfolio weight with configurable threshold (default 40%). `sector_concentration` dict and `concentration_warning` message added to state. Empty-holdings guard prevents division-by-zero. Does NOT overwrite `risk_state` (owned by `LTVMonitorNode`).
- **`SafeSkipNode`** (`nodes.py`): New branch node — generates a benign `Recommendation` with `risk_state="Safe"`, `proposed_lots=[]`, and `result["status"]="skipped"`. Sets `approved=True` so execution node logs "skipped" without human approval.
- **SYSTEM_PROMPT rules 10-11** (`nodes.py`): Rule 10 — prefer selling short-term loss lots. Rule 11 — acknowledge sector concentration warnings in rationale.
- **TypeScript sector concentration** (`src/utils.ts`): `SECTOR_MAP` with 60+ tickers, `getDaysHeld()`, sector concentration analysis, short/long-term loss totals in `calculateOptimizer()` output.
- **TypeScript holding period** (`src/types.ts`): `ProposedLot` gains `is_short_term` and `days_held` optional fields. `ProposalOutput` gains `sector_concentration`, `concentration_warning`, `short_term_loss_total`, `long_term_loss_total`.
- **12 new tests** (`tests/test_nodes.py`): `TestSafeSkipNode` (4 tests), holding period short/long-term (2 tests), sector concentration warning/no-warning/empty (3 tests), conditional branching e2e (3 tests). Total: 66 node tests + 8 MCP tests = 74 passing.
- **Groq provider** (`nodes.py`, `server.ts`): Replaced Google AI Studio (Gemini direct API) with Groq as primary LLM provider (`api.groq.com/openai/v1`). Model `llama-3.3-70b-versatile` — fast inference, free tier ~14,400 req/day, excellent structured output support. Fallback chain: Groq → Poolside → OpenRouter → deterministic.
- **yfinance live prices** (`nodes.py`): `IngestPortfolioNode` fetches real-time market prices via `yfinance` for each holding symbol. Falls back to static fixture prices per-symbol if yfinance is unavailable or the API call fails. Web UI also gets a `/api/portfolio/prices` endpoint for live price lookups.
- **FastMCP server** (`mcp_server.py`): Exposes `check_ltv` and `optimize_sale` as MCP tools callable from Claude Desktop / Claude Code. Run with `python mcp_server.py` or `mcp run mcp_server.py`. Node instances built at module level for reuse across calls.
- **Slack webhook alerts** (`nodes.py`): `LTVMonitorNode` sends a proactive Slack incoming webhook notification the moment `risk_state` is "High Risk" — fires immediately on detection, not after human approval. Set `SLACK_WEBHOOK_URL` in `.env.local`.
- **Export audit trail** (`server.ts`, `OptimizationProposal.tsx`): New `POST /api/portfolio/audit` endpoint returns full decision trail (input, computed metrics, optimizer output, metadata) as JSON with `Content-Disposition: attachment`. Client-side "Export Audit Trail" button downloads the same data directly from the browser.
- **Pre-flight health check** (`check_providers.py`): Script pings Groq, Poolside, OpenRouter APIs, yfinance, and Slack webhook. Reports which providers/integrations are alive before a demo.
- **Poolside API fallback** (`nodes.py`): Second LLM provider via `POOLSIDE_API_KEY`, uses `poolside/laguna-s-2.1` at `inference.poolside.ai`. Thinking disabled via `{"thinking": {"type": "disabled"}}`.
- **System/user prompt split** (`nodes.py`): `SYSTEM_PROMPT` constant with 9 hard rules, sent as separate system message via `.invoke([system, user])` for better structured-output adherence.
- **`cash_need` threading** (`nodes.py`): Added to `AgentState`, included in `ReasoningAgentNode` user prompt, deterministic fallback computes `needed_proceeds = deficit_proceeds + cash_need`.
- **Hallucinated lot_id guard** (`nodes.py`): Validates LLM-proposed `lot_id`s against `ranked_lots` before accepting. Discards LLM output and falls back to deterministic if any unknown ID is found.
- **`resulting_ltv_if_executed`** (`nodes.py`): New field on `Recommendation`. Computed in deterministic fallback accounting for shrinking collateral (proceeds reduce both collateral and loan).
- **Pydantic field constraints** (`nodes.py`): `Lot.quantity > 0`, `Lot.cost_basis >= 0`, `Lot.current_price >= 0`, `Account.loan_balance >= 0`, `Account.max_ltv_limit` in `(0, 1]`, `Account.cash >= 0`. Malformed fixtures now fail at ingest.
- **Wash-sale detection** (`nodes.py`): Deterministic same-symbol-within-30-days check in `TaxOptimizerNode` (Node 3). Carried through to `ReasoningAgentNode` and `LotProposal`.
- **Wash-sale caveat rule** (`nodes.py`): Rule 9 in `SYSTEM_PROMPT` — single-lot still warns about post-sale repurchase risk.
- **Shrinking-collateral rule** (`server.ts`, `nodes.py`): Rule 8 — LLM must cite precomputed `resulting_ltv_if_executed`, never re-derive LTV freehand.
- **Configurable checkpointer** (`agent.py`): `create_graph()` accepts `checkpointer_type` ("memory"/"postgres"/"sqlite") and `db_url`.
- **`get_state()` for fallback graph** (`agent.py`): `CompiledGraph` stores state keyed by `thread_id`, returns `_StateSnapshot`.
- **Logging throughout** (`nodes.py`, `agent.py`, `run_fixtures.py`): `logging` module replaces silent `except Exception: pass` blocks.
- **UUID validation** (`nodes.py`): `Lot.lot_id`, `Account.account_id`, `LotProposal.lot_id` use `UUID` type with `default_factory=uuid4`.
- **Non-standard limit fixture** (`fake_users.json`): Fixture 6 with `max_ltv_limit: 0.35` to test formula correctness.
- **Wash-sale fixture** (`fake_users.json`): Fixture 5 with two XYZ lots 9 days apart.
- **`langchain-openai`** (`requirements.txt`): Required for OpenRouter/Poolside OpenAI-compatible fallback.
- **`.env.local` loading** (`agent.py`, `run_fixtures.py`, `server.ts`): All entry points now load `.env.local` explicitly.
- **`allowedHosts: true`** (`vite.config.ts`): Allows Cloudflare tunnel hosts.
- **Poolside fallback in web UI** (`server.ts`): Added `generateViaPoolside()` function and wired into both `/api/portfolio/analyze` (rationale) and `/api/portfolio/chat` endpoints as fallback tier.
- **Health endpoint** (`server.ts`): `/api/health` now reports `hasPoolsideKey` alongside Groq and OpenRouter.

### Fixed
- **Decommissioned model removed** (`src/App.tsx`): Removed `mixtral-8x7b-32768` from `AVAILABLE_MODELS` — model is decommissioned by Groq and returns 404.
- **Chat default model** (`server.ts`): Fixed chat endpoint default from `gemini-3-flash-preview` to `llama-3.3-70b-versatile`.
- **`marketEvent` logic** (`src/utils.ts`): Now checks `headroom < 0` before escalating to High Risk — previously any market event unconditionally set `risk_state = "High Risk"` regardless of actual headroom.
- **Fixture rate limiting** (`run_fixtures.py`): Added 2-second delay between fixture iterations to avoid Groq 429 rate limits.
- **Fallback order** (`nodes.py`, `check_providers.py`): Poolside now falls back before OpenRouter — chain is Groq → Poolside → OpenRouter → deterministic. Poolside is more reliable for structured output; OpenRouter free tier has aggressive rate limits.
- **yfinance reinstall** (`.venv`): Corrupted yfinance install (missing `__init__.py`, only `__pycache__/`) — recreated venv from scratch with `uv venv --python 3.10` and `uv pip install -r requirements.txt`. yfinance 1.5.2 verified working (`AAPL` price: $339.78).
- **Python 3.14 hang** (`.venv`): Recreated venv on Python 3.10 — `langchain_core.messages` imports hung indefinitely on Python 3.14.
- **`vite.config.ts` type error** (`allowedHosts: true`): Fixed with `as const` — Vite expects literal `true`, not `boolean`.
- **Deterministic fallback formula** (`nodes.py`): Was `deficit / 0.50` (hardcoded). Now `deficit / (1 - max_ltv_limit)` using the account's actual limit.
- **Exception swallowing** (`nodes.py`, `run_fixtures.py`): All `except Exception: pass` blocks now log the error. `run_fixtures.py` catches only `GraphInterrupt`.
- **`get_state()` crash** (`agent.py`): Fallback `CompiledGraph` now implements `get_state()` instead of throwing `AttributeError`.
- **`.env` vs `.env.local` mismatch**: All entry points load `.env.local` explicitly.
- **Fixture JSON serialization** (`run_fixtures.py`): `json.dumps(default=str)` handles UUID objects.
- **Poolside thinking format** (`nodes.py`): Fixed `extra_body` from `{"thinking": false}` to `{"thinking": {"type": "disabled"}}` — API expects a struct with `type` field, not a boolean.
- **OpenRouter model slug** (`nodes.py`): Fixed to `google/gemma-4-26b-a4b-it:free` (was missing `-it` suffix).
- **UUID serialization for checkpointers** (`nodes.py`): `HumanApprovalNode` now uses `model_dump(mode="json")` so UUIDs serialize to strings regardless of checkpointer backend.
- **MCP error logging** (`mcp_server.py`): `logger.error()` before returning error JSON (was silently swallowing).
- **ExecutionNode None-check** (`nodes.py`): Handles `rec is None`, `isinstance(rec, Recommendation)`, `isinstance(rec, dict)`, and fallback `str(rec)`.
- **Slack alert moved** (`nodes.py`): Removed from `ExecutionNode`, moved to `LTVMonitorNode` — fires proactively the moment High Risk is detected, not after human approval.
- **fastmcp version pin** (`requirements.txt`): Pinned to `>=3.0.0,<4.0.0` (was `>=2.0.0` — would break on fresh install landing v2).

### Changed
- **Primary LLM provider**: Replaced Google AI Studio (Gemini direct API) with Groq (`api.groq.com/openai/v1`). Model `llama-3.3-70b-versatile` — fast inference, free tier ~14,400 req/day, excellent structured output support.
- **Fallback order**: Groq → Poolside → OpenRouter → deterministic.
- **Temperature**: Lowered from 0.2 to 0.1 for structured output reliability.
- **`max_retries=2`**, **`max_tokens=2048`** on all LLM init calls.
- **Graph built once** (`run_fixtures.py`): Moved `create_graph()` outside the fixture loop.
- **`requirements.txt`**: Added `yfinance>=1.5.0`, pinned `fastmcp>=3.0.0,<4.0.0`.

---

## Known Issues / Current Provider Status

| Provider | Status | Notes |
|---|---|---|
| Groq (`llama-3.3-70b-versatile`) | Primary | Fast inference, free tier ~14,400 req/day. OpenAI-compatible at `api.groq.com/openai/v1`. |
| OpenRouter (`google/gemma-4-26b-a4b-it:free`) | Slug verified, quota exhausted | Free-tier ~20 RPM / 200 RPD — daily limit hit during testing. Key works. |
| Poolside (`poolside/laguna-s-2.1`) | Working | Thinking disabled via `{"thinking": {"type": "disabled"}}`. `method="function_calling"` confirmed working. All 6 fixtures pass with LLM-generated recommendations. |
| Deterministic fallback | Working | All 6 fixtures pass. Formula: `deficit / (1 - max_ltv_limit)`. Accounts for shrinking-collateral feedback loop. |

**Free-tier caution**: Free model slugs can change without notice. Re-verify slugs against live API catalogs if a provider starts returning 400/404.

---

## [0.1.0] - 2026-07-26

### Initial release
- 6-node LangGraph pipeline: ingest → LTV monitor → tax optimizer → reasoning agent → human approval → execution.
- React dashboard with interactive holdings table, optimization proposal, and AI chat.
- Express backend with `/api/portfolio/analyze` and `/api/portfolio/chat` endpoints.
- Google AI Studio (Gemini) integration with structured output.
- 4 synthetic test fixtures.
- Deterministic fallback when LLM is unavailable.
