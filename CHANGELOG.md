# Changelog

## [Unreleased]

### Added
- **Circuit breaker** (`nodes.py`): `CircuitBreaker` class — tracks consecutive failures per LLM provider, opens circuit after 3 failures for 60s, auto-retries. Wired into `ReasoningAgentNode` to avoid hammering dead providers during demos.
- **Disk cache** (`nodes.py`): `ReasoningAgentNode` uses `diskcache` (optional) to cache LLM responses for 24h. Cache key = SHA-256 of messages. Skips cache for `cash_need` queries (they vary). Avoids burning quota on identical prompts.
- **Persistent audit log** (`nodes.py`): `AuditLogger` — append-only SQLite trail (`collateral_audit.db`). `ExecutionNode` writes every run (timestamp, account_id, risk_state, headroom, recommended_action, approved, result_status, provider). `query()` method for retrieval.
- **Cost basis method selection** (`nodes.py`): `CostBasisMethod` enum — FIFO, LIFO, HIFO, TLH (default), SPECIFIC. `Account.cost_basis_method` field. `TaxOptimizerNode` sorts by the chosen method: FIFO (oldest first), LIFO (newest first), HIFO (highest cost first), TLH (losses before gains, short-term before long-term).
- **LotProposal.is_long_term** (`nodes.py`): New field on `LotProposal` — populated from `holding_period_days` in both LLM and deterministic paths.
- **Conditional graph branching** (`agent.py`): `SafeSkipNode` + `add_conditional_edges` — Safe portfolios with no cash_need skip the tax optimizer, LLM, and human approval entirely. Saves LLM tokens for healthy portfolios. Fallback runner updated with `_next_node` graph walker to support conditional edges.
- **Short-term vs long-term capital gain analysis** (`nodes.py`): `TaxOptimizerNode` computes `days_held` and `is_short_term` (<=365 days) per lot. Ranked lots now sort losses before gains, short-term before long-term, biggest loss first — regardless of which path serves the recommendation (LLM or deterministic).
- **Sector concentration analysis** (`nodes.py`): GICS-like sector mapping for 60+ tickers. `TaxOptimizerNode` computes per-sector portfolio weight with configurable threshold (default 40%). `sector_concentration` dict and `concentration_warning` message added to state. Empty-holdings guard prevents division-by-zero. Does NOT overwrite `risk_state` (owned by `LTVMonitorNode`). Warning now reports the most concentrated sector (not first-match).
- **`SafeSkipNode`** (`nodes.py`): New branch node — generates a benign `Recommendation` with `risk_state="Safe"`, `proposed_lots=[]`, and `result["status"]="skipped"`. Sets `approved=True` so execution node logs "skipped" without human approval.
- **SYSTEM_PROMPT rules 10-12** (`nodes.py`): Rule 10 — prefer selling short-term loss lots. Rule 11 — acknowledge concentration warnings (key name fixed to `concentration_warning`). Rule 12 — ranked lots are pre-sorted by cost_basis_method, do not re-sort.
- **TypeScript sector concentration** (`src/utils.ts`): `SECTOR_MAP` with 60+ tickers, `getDaysHeld()`, sector concentration analysis, short/long-term loss totals in `calculateOptimizer()` output. Sort now prefers losses before gains, short-term before long-term.
- **TypeScript holding period** (`src/types.ts`): `ProposedLot` gains `is_short_term` and `days_held` optional fields. `ProposalOutput` gains `sector_concentration`, `concentration_warning`, `short_term_loss_total`, `long_term_loss_total`.
- **14 new tests** (`tests/test_nodes.py`): `TestCircuitBreaker` (4 tests), `TestAuditLogger` (2 tests), `TestCostBasisMethod` (5 tests), `TestSlackRateLimiting` (2 tests), `TestDayDifferenceMalformed` (1 test). Total: 80 node tests + 8 MCP tests = 88 passing.
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
- **CRITICAL: Command injection** (`server.ts`): `/api/portfolio/prices` used `execSync` with string-interpolated user input — a symbol like `AAPL'; rm -rf /; echo '` could execute arbitrary commands. Fixed to `execFileSync` (no shell) + symbol format regex validation (`/^[A-Z0-9.\-]{1,10}$/`).
- **Sort order not short-term-aware** (`nodes.py`, `src/utils.ts`): TaxOptimizerNode sort was plain gain/loss ascending — short-term preference only happened in SYSTEM_PROMPT (LLM-dependent). Now sorts deterministically: losses before gains, short-term before long-term, biggest loss first. Works on both LLM and deterministic paths.
- **Concentration warning in deterministic fallback** (`nodes.py`): Deterministic fallback rationale now appends `concentration_warning` when present — previously only the LLM path acknowledged it.
- **Concentration max sector** (`nodes.py`): Warning now reports the most concentrated sector (`max()` by pct) instead of first dict-iteration match.
- **Slack alert spam** (`nodes.py`): `LTVMonitorNode` now has `cooldown_seconds` (default 300) — prevents repeated alerts on rapid queries. `notify=False` param disables alerts for read-only/test contexts (MCP `check_ltv`, `run_fixtures.py`).
- **MCP safe-skip bypass** (`mcp_server.py`): `optimize_sale` now checks `risk_state == "Safe" && cash_need <= 0` before calling `_reasoning` — previously burned an LLM call on every Safe query via MCP.
- **Fallback graph resume** (`agent.py`): `CompiledGraph.invoke()` no longer unconditionally restarts from `ingest` — detects resume (prior state + `approved` in input) and starts from `human_approval`.
- **SYSTEM_PROMPT rule 11 key name** (`nodes.py`): Rule referenced `sector_concentration_warning` but data uses `concentration_warning`. Fixed to match.
- **`_day_difference` crash** (`nodes.py`): No try/except around `datetime.fromisoformat()` — malformed `acquired_date` crashed wash-sale detection. Now returns 0 on parse failure.
- **Decommissioned model removed** (`src/App.tsx`): Removed `mixtral-8x7b-32768` from `AVAILABLE_MODELS` — model is decommissioned by Groq and returns 404.
- **Chat default model** (`server.ts`): Fixed chat endpoint default from `gemini-3-flash-preview` to `llama-3.3-70b-versatile`.
- **`marketEvent` logic** (`src/utils.ts`): Now checks `headroom < 0` before escalating to High Risk — previously any market event unconditionally set `risk_state = "High Risk"` regardless of actual headroom.
- **Fixture rate limiting** (`run_fixtures.py`): Added 2-second delay between fixture iterations to avoid Groq 429 rate limits.
- **`run_fixtures.py` assertion for SafeSkip** (`run_fixtures.py`): Final assertion now checks `result.get("status") == "skipped"` before asserting `result is None` — previously failed unconditionally on Safe portfolios that short-circuited via `SafeSkipNode`.
- **`_provider_used` not written to state** (`nodes.py`): `ReasoningAgentNode.__call__` now returns `_provider_used` in the state dict, populated with the provider label that succeeded (e.g., "groq", "poolside", "cache", or "deterministic"). Audit log `provider` column now reflects actual provenance.
- **`cost_basis_method` missing from LLM prompt** (`nodes.py`): `ReasoningAgentNode.__call__` now includes `cost_basis_method` in the `user_data` string sent to the LLM. SYSTEM_PROMPT rule 12 can now be followed correctly — the LLM knows which sort order was applied.
- **Deterministic fallback rationale hardcodes TLH text** (`nodes.py`): Rationale text now dynamically reflects the active `cost_basis_method` (FIFO, LIFO, HIFO, TLH, or Specific) instead of always claiming "short-term losses first."
- **SafeSkipNode bypasses audit log** (`nodes.py`, `agent.py`): `SafeSkipNode` now calls `self.audit.log(state)` so Safe portfolios are compliance-logged. `agent.py` passes a shared `AuditLogger` instance to both `SafeSkipNode` and `ExecutionNode`.
- **`is_long_term` correction asymmetric** (`nodes.py`): LLM-proposed `is_long_term` values are now unconditionally overwritten with the deterministic `lot_term_map` — previously only corrected `False` → `True`, leaving incorrect `True` values uncorrected.
- **`test_mcp.py` tests stale reimplemented logic** (`tests/test_mcp.py`): Tests now call the actual `check_ltv` and `optimize_sale` functions (with shared node instances mirroring `mcp_server.py`) instead of reimplementing the pipeline separately. Added `test_safe_skip_bypass` and `test_safe_with_cash_need_calls_llm` to validate the MCP safe-skip branch.
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
