# Changelog

## [Unreleased]

### Added
- **Poolside API fallback** (`nodes.py`): Third LLM provider via `POOLSIDE_API_KEY`, uses `poolside/laguna-s-2.1` at `inference.poolside.ai`. Chains Gemini → OpenRouter → Poolside → deterministic fallback.
- **System/user prompt split** (`nodes.py`): `SYSTEM_PROMPT` constant with 9 hard rules, sent as separate system message via `.invoke([system, user])` for better structured-output adherence.
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
- **OpenRouter rate-limit comment** (`nodes.py`): Documents free-tier ~20 RPM / 200 RPD quota to prevent confusion during heavy dev iteration.
- **Poolside fallback in web UI** (`server.ts`): Added `generateViaPoolside()` function and wired into both `/api/portfolio/analyze` (rationale) and `/api/portfolio/chat` endpoints as third fallback tier.
- **Health endpoint** (`server.ts`): `/api/health` now reports `hasPoolsideKey` alongside Gemini and OpenRouter.

### Fixed
- **Deterministic fallback formula** (`nodes.py`): Was `deficit / 0.50` (hardcoded). Now `deficit / (1 - max_ltv_limit)` using the account's actual limit.
- **Exception swallowing** (`nodes.py`, `run_fixtures.py`): All `except Exception: pass` blocks now log the error. `run_fixtures.py` catches only `GraphInterrupt`.
- **`get_state()` crash** (`agent.py`): Fallback `CompiledGraph` now implements `get_state()` instead of throwing `AttributeError`.
- **Gemini model name**: Updated to `gemini-2.5-flash` everywhere (was `gemini-3.1-flash-lite` in `server.ts`, which doesn't exist).
- **`.env` vs `.env.local` mismatch**: All entry points load `.env.local` explicitly.
- **Mojibake in comments** (`agent.py`, `vite.config.ts`): Cleaned `参数` and `â` artifacts.
- **Fixture JSON serialization** (`run_fixtures.py`): `json.dumps(default=str)` handles UUID objects.
- **Gemini thinking mode** (`nodes.py`): Disabled via `thinking_budget=0` to prevent thinking-token overhead from truncating structured output.
- **Poolside thinking format** (`nodes.py`): Fixed `extra_body` from `{"thinking": false}` to `{"thinking": {"type": "disabled"}}` — API expects a struct with `type` field, not a boolean.
- **OpenRouter model slug** (`nodes.py`): Fixed to `google/gemma-4-26b-a4b-it:free` (was missing `-it` suffix).
- **UUID serialization for checkpointers** (`nodes.py`): `HumanApprovalNode` now uses `model_dump(mode="json")` so UUIDs serialize to strings regardless of checkpointer backend.

### Changed
- **OpenRouter fallback model**: Updated to `google/gemma-4-26b-a4b-it:free` (native structured output support, slug verified against OpenRouter API).
- **Temperature**: Lowered from 0.2 to 0.1 for structured output reliability.
- **`max_retries=2`**, **`max_tokens=2048`** on all LLM init calls.
- **Graph built once** (`run_fixtures.py`): Moved `create_graph()` outside the fixture loop.

---

## Known Issues / Current Provider Status

| Provider | Status (2026-07-26) | Notes |
|---|---|---|
| Gemini (`gemini-2.5-flash`) | Quota exhausted, thinking disabled | Free-tier limit of 20 requests/day. Thinking disabled via `thinking_budget=0`. Falls through to OpenRouter/Poolside/deterministic. |
| OpenRouter (`google/gemma-4-26b-a4b-it:free`) | Slug verified, quota exhausted | Slug fixed (was missing `-it`). Free-tier ~20 RPM / 200 RPD — daily limit hit during testing. Key works. |
| Poolside (`poolside/laguna-s-2.1`) | Working | Thinking disabled via `{"thinking": {"type": "disabled"}}`. `method="function_calling"` confirmed working. All 6 fixtures pass with LLM-generated recommendations. |
| Deterministic fallback | Working | All 6 fixtures pass. Formula: `deficit / (1 - max_ltv_limit)`. Accounts for shrinking-collateral feedback loop. |

**Free-tier caution**: Free model slugs can change without notice. Re-verify slugs against live API catalogs (`openrouter.ai/api/v1/models`, `platform.poolside.ai`) if a provider starts returning 400/404.

---

## [0.1.0] - 2026-07-26

### Initial release
- 6-node LangGraph pipeline: ingest → LTV monitor → tax optimizer → reasoning agent → human approval → execution.
- React dashboard with interactive holdings table, optimization proposal, and AI chat.
- Express backend with `/api/portfolio/analyze` and `/api/portfolio/chat` endpoints.
- Gemini AI integration with structured output.
- 4 synthetic test fixtures.
- Deterministic fallback when LLM is unavailable.
