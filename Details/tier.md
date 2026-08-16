# Collateral — Build with Gemini XPRIZE Tier Map

> **Competition:** Build with Gemini XPRIZE (XPRIZE × Google, $2M pool, 25 winners)
> **Category:** Money & Financial Access
> **Build window:** May 19 – Aug 17, 2026 · **Judging:** Aug 18 – Sep 15 · **Finals:** Sep 25, 2026 (LA)
> **Today:** Aug 07, 2026 → **~10 days to submission.**
> **Purpose of this file:** everything we solve, everything we do, every tier of XPRIZE readiness, mapped 1:1 to code (`file:line`). Analysis only — no implementation code.

---

## §1 Overview & Category Fit

**What we built (one line):** An AI agent that watches a portfolio's collateral-to-loan ratio in real time, fires the instant a margin call is imminent, and proposes which tax lots to sell so liquidation harvests the largest possible tax loss while obeying IRS wash-sale rules and the shrinking-collateral math.

**Category justification — Money & Financial Access:** "Breaking down barriers to banking, capital, and financial freedom." Margin lending is how under-banked retail investors and small traders access capital without selling assets. Collateral automates the monitoring/sizing/explanation layer that today is manual, spreadsheet-driven, and opaque — and prevents catastrophic forced liquidation (sell-at-the-worst-price events that wipe out retail accounts).

| | |
|---|---|
| Product | Collateral — Portfolio Liquidity & Tax Optimizer Agent |
| Core stack | Python LangGraph agent (`agent.py`, `nodes.py`) + React/Express dashboard (`src/`, `server.ts`) + MCP server (`mcp_server.py`) |
| LLM providers today | Gemini (primary) → Groq → Poolside → OpenRouter → deterministic (`nodes.py`, `server.ts`) |
| Gemini API calls | **WIRED** — Gemini is the primary provider (web: `@google/genai` SDK; Python: direct REST `responseSchema`) — §5.1 ✅ |
| Google Cloud products | **0** (critical gap — see §5.5) |
| Tests | 80 node + 10 MCP = 90 (`tests/`) |
| Audit/compliance | Append-only SQLite trail (`nodes.py:319-401`) |

---

## §2 Tier 0 — The Problem We Solve (mapped to code)

Each problem → the code that solves it.

| # | Problem | Solution | Code map |
|---|---------|----------|----------|
| P1 | **Margin-call blindness.** Retail investors borrow against stocks, then get liquidated at the worst prices because nobody watched the LTV ratio. | Continuous LTV / headroom / risk-state computation; Slack alert fires the moment `High Risk` is detected — before human approval, before any sale. | `LTVMonitorNode` — `nodes.py:166-254`; Slack alert `nodes.py:180-205`; risk thresholds `nodes.py:233-244` |
| P2 | **Tax-inefficient forced liquidation.** In a margin call, brokers sell whatever, realizing avoidable taxable gains. | Sells biggest tax losses first (tax-loss harvesting), short-term losses before long-term, with wash-sale flagging. | `TaxOptimizerNode` — `nodes.py:440-562`; short-term sort `nodes.py:548-554`; wash-sale `nodes.py:504-512` |
| P3 | **The shrinking-collateral feedback loop.** Selling $1 of stock to pay $1 of debt barely fixes the LTV because collateral shrinks too. Naive sizing is wrong. | Correct sizing formula: `Liquidation Required = Deficit / (1 − Maintenance LTV Limit)`; post-sale LTV precomputed, never LLM-recomputed. | `nodes.py:766` (deterministic), `nodes.py:789-795` (pro-forma LTV), rule 8 in `SYSTEM_PROMPT` `nodes.py:577`; TS mirror `src/utils.ts:114-124` |
| P4 | **IRS wash-sale trap (IRC §1091).** Selling a losing lot, then repurchasing within 30 days, disallows the tax loss. | Deterministic same-symbol-within-30-days detection; single-lot caveat still warns. | `nodes.py:504-512`, `_day_difference` `nodes.py:430-437`; rule 9 `nodes.py:578` |
| P5 | **Blind sector concentration.** A margin breach hidden behind a diversified-looking account. | GICS-like sector map for 60+ tickers; flags any sector > 40% of portfolio. | `_SECTOR_MAP` `nodes.py:405-427`, concentration `nodes.py:514-539` |
| P6 | **No audit trail for decisions.** A financial agent with no record = unusable in practice. | Append-only SQLite audit log per pipeline run (incl. which provider produced the recommendation). | `AuditLogger` `nodes.py:319-401`; wired in `ExecutionNode` `nodes.py:865-910`; export endpoint `server.ts:288-340` |

**Bottom line:** Collateral is not "an LLM that chats about stocks." The math is deterministic and correct (LLM is allowed zero financial computation); the agent is a supervised autopilot for one specific, expensive retail-finance failure mode.

---

## §3 Tier 1 — Capability Inventory (what we do, mapped to code)

Feature → code → why it matters to the judges.

| Feature | Code map | XPRIZE relevance |
|---|---|---|
| **6-node LangGraph pipeline** `ingest → ltv → tax → reasoning → approval → execution` | Graph builder `agent.py:93-142`; state schema `AgentState` `nodes.py:67-81`; node classes `nodes.py:84-910` | Demonstrates a real agent workflow (not a single prompt call) — AI-native architecture. |
| **Conditional branching (SafeSkip)** — safe portfolios skip tax optimizer, LLM, and human approval entirely | Route fn `agent.py:84-91`; `SafeSkipNode` `nodes.py:257-288`; conditional edges `agent.py:126-133` | Cost-aware AI: LLM tokens only spent when a decision is actually needed. Judges see production-grade optimization. |
| **LLM confined to one node** — only Node 4 invokes an LLM; all math/wash-sale/state is deterministic Python | `ReasoningAgentNode` `nodes.py:585-836`; SYSTEM_PROMPT rule 1 `nodes.py:567` | AI "governs" the loop but cannot invent numbers — safety and trust story. |
| **Structured output w/ schema + anti-hallucination** — LLM bound to `Recommendation` schema; hallucinated `lot_id`s rejected | `with_structured_output` `nodes.py:627-629,647-649,667-669`; validation `nodes.py:738-741` | Reliability engineering — exactly what a financial agent needs. |
| **Multi-provider fallback chain** Groq → Poolside → OpenRouter → deterministic | Provider init `nodes.py:614-671`; chain loop `nodes.py:724-756` | Resilient "never fails in the demo" story. |
| **Circuit breaker** — skips a dead provider after 3 failures for 60s | `CircuitBreaker` `nodes.py:291-317`; usage `nodes.py:731,755` | Production operational maturity. |
| **Disk cache** — 24h SHA-256 cache of identical LLM prompts | `nodes.py:604-610,709-722,752-753` | Cost control; free-tier quota friendliness. |
| **Human-in-the-loop** — graph pauses via `interrupt()`, resumes on approval; no auto trades | `HumanApprovalNode` `nodes.py:839-862`; resume logic `agent.py:203-204` | Trust + regulatory posture; "human approves, AI proposes." |
| **Cost-basis methods** FIFO / LIFO / HIFO / TLH / Specific | Enum `nodes.py:35-40`; sort `nodes.py:541-555` | Financial domain depth beyond the boilerplate. |
| **Real-time market prices** via yfinance, per-symbol fallback | `IngestPortfolioNode._fetch_live_prices` `nodes.py:95-120`; web endpoint `server.ts:118-176` (`execFileSync` + regex = no injection) | Live-data agent, not a static toy. |
| **Slack proactive alerts** with cooldown rate-limiting | `nodes.py:180-205` | Agent reaches the user in the channel they live in — an ops-loop not a website. |
| **MCP server** — `check_ltv`, `optimize_sale` callable from Claude Desktop / Claude Code | `mcp_server.py:46-108` | Tool ecosystem interop (agents calling our agent). |
| **Audit export + compliance trail** | `AuditLogger.query` `nodes.py:390-401`; `/api/portfolio/audit` `server.ts:288-340`; client export `src/components/OptimizationProposal.tsx:249-272` | "Evidence your product runs in production" (§6) — ready-made telemetry. |
| **Interactive web dashboard** — presets, market-shock sliders, live prices, model selector, chat | `src/App.tsx`; `src/presets.ts`; `src/utils.ts`; `src/components/{HoldingsTable,OptimizationProposal,ChatAssistant}.tsx` | Demo surface for the <3 min video; judges can click and test. |
| **Dual implementation parity** Python + TypeScript produce identical math | TS `calculateOptimizer` `src/utils.ts:62-305` vs Python `nodes.py` | Cross-verified correctness. |
| **90 automated tests** including wash-sale, cost-basis, circuit breaker, Slack cooldown, MCP safe-skip | `tests/test_nodes.py`, `tests/test_mcp.py` | Engineering rigor → AI-Native Operations credibility. |

---

## §4 Tier 2 — The Three Judging Criteria (strengths / gaps / evidence)

Judges score three equally-weighted criteria. Current posture:

### C1 · Business Viability (generate real revenue + real users)
- **Strengths:** A real pain point with a correct, defensible math engine; a SaaS-shaped model (monitor → alert → propose → approve); audit trail already makes it compliance-plausible for actual brokerages/RIAs.
- **Gaps (today):**
  - **No revenue** — nothing is monetized.
  - **No real users** — 6 synthetic fixtures only (`fixtures/fake_users.json`); presets (`src/presets.ts`) are sandbox.
  - **No pricing model or GTM** documented.
  - **No brokerage integration** — "execution" is a simulated dry-run log (`ExecutionNode` `nodes.py:892-905`).
- **Evidence needed by Aug 17:** revenue ledger (even $), user list, pricing, acquisition spend disclosure (can be $0), related-party disclosure.

### C2 · AI-Native Operations (AI is live in production and executes key decisions)
- **Strengths:** This is our strongest axis — AI genuinely *operates* the loop: ingests live prices (`nodes.py:95-120`), computes risk (`nodes.py:220-254`), decides when to skip the LLM entirely (`agent.py:84-91`), proposes the trade (`nodes.py:676-836`), and is gated by human approval (`nodes.py:839-862`). Continuous op evidence exists: audit log (`nodes.py:319-401`), provider provenance column (`nodes.py:385`).
- **Gaps:**
  - **The AI that makes the key recommendation is not Gemini** — violates the rules and weakens the "Built with Gemini" narrative (see §5.1).
  - **No scheduled/continuous operation** — the agent only runs when invoked; an autopilot that runs on a cron/event loop is the difference between "tool" and "business operated by AI."
  - **No live production traces** — audit DB exists but no dashboard/API-usage monitor to screenshot for the evidence pack.
- **Evidence needed:** scheduled-run logs, agent execution traces, API usage monitor, dashboard screenshots.

### C3 · Category Impact (moves the needle in Money & Financial Access)
- **Strengths:** Directly attacks a documented retail-investor harm (forced liquidation at the bottom) with tax-loss harvesting (IRC §1091) and correct pro-forma sizing — a niche no generic chatbot enters. Deterministic math + human approval = a compliance-credible framing for a category full of liability.
- **Gaps:** No real-world deployment/testimonials; impact is currently hypothetical (fixtures), so "reaching scale / redefining the workflow" is unproven.
- **Evidence needed:** at least 1–3 real users with feedback; a case study narrative ("what happened when the market dropped X%").

---

## §5 Tier 3 — Standout Strategy (ranked; code-mapped; no code written)

Priority order within the ~10-day window.

### 5.1 [DONE] Re-wire the Gemini API into the live app
- **Why:** The official rules state: *"Projects that include LLM functionality must use the Gemini API for at least one LLM call in the deployed application."* This gap is now closed — Gemini is the **primary** provider in both stacks.
- **Done (Aug 09, 2026):**
  - `server.ts` — `generateViaGemini` via the already-installed `@google/genai` SDK (`GoogleGenAI.models.generateContent`); Gemini leads the registry-driven fallback chain.
  - `nodes.py` — `ReasoningAgentNode._call_gemini` (direct REST `:generateContent` with `responseSchema` + `responseMimeType: application/json`), tried before Groq in the provider loop.
  - `src/providers.ts` — provider registry; Gemini default model `gemini-3-flash-preview` (`GEMINI_MODEL` override).
  - `check_providers.py` — Gemini health check added.
  - `requirements.txt` — `langchain-google-genai` intentionally left commented; Gemini uses the already-installed `requests` package (no new dependency).
  - `.env.example` — added `GEMINI_API_KEY` / `GEMINI_MODEL`.
  - UI — the AI Model Engine card + "Manage Models" panel let users add providers/models at runtime (server-side `model-config.json`), so reviewers can switch providers without code changes.
- **Next:** capture a real Gemini-call screenshot + audit-log provenance for the evidence pack (§5.6).

### 5.2 Turn it into an autopilot business (the actual "AI-operated business")
- **Why:** The #2 judging criterion rewards *continuous* AI operation. Today the agent runs only when called.
- **How:** Schedule the LangGraph pipeline on a loop/event (market close cron, price-move webhooks) using the checkpointer already built (`agent.py:37-81`, postgres/sqlite supported) — every run appends to the audit trail (`nodes.py:319-401`) automatically. Slack becomes the delivery channel (already built, `nodes.py:180-205`). Result: "a business that runs itself, humans only approve."
- **Files to touch (future):** new scheduler module; reuse `create_graph()` from `agent.py:93-142`; nothing in the graph changes.

### 5.3 Go multi-agent (agent team, not single agent)
- **Why:** XPRIZE stories win on breadth of agents. We have one brain (`ReasoningAgentNode`). The graph structure makes expansion cheap.
- **How:** sibling agents sharing the same deterministic core — a **Market-Event agent** (react to crash scenarios — the shock sliders already exist in `src/App.tsx:432-474`), a **Tax-Season agent** (year-end TLH run — cost-basis engine already exists `nodes.py:541-555`), a **Diversification agent** (sector concentration already computed `nodes.py:514-539`).

### 5.4 Declare more Gemini capabilities
- **Why:** `metadata.json:5` declares only server-side Gemini API. The Gemini tools stack offers voice/live capability flags; a voice interface (ask "am I about to get a margin call?") is a memorable demo differentiator.
- **Files to touch:** `metadata.json` (add voice/live capability), front-end `src/` for a voice control, backend `server.ts`/new Gemini Live route.

### 5.5 Deploy on Google Cloud (satisfy "at least one Google Cloud product")
- **Why:** The rules also require ≥1 Google Cloud product. We currently use none (yfinance, Slack, SQLite only).
- **How:** Deploy the Express server to **Cloud Run** (build script already exists — `package.json:8`), keep the audit trail in **Firestore** instead of local SQLite for the live app. This is likely a 1–2 day task and converts two rule violations (§5.1 + §5.5) into two eligibility wins.

### 5.6 Ship the production-evidence pack
- **Why:** Submission requires *"evidence of your product running — agent execution logs, API usage records, screenshots of dashboards."*
- **How:** Expose the audit DB (`AuditLogger.query` `nodes.py:390-401`) behind a `/api/audit/live` endpoint; add an API-usage counter; screenshot the dashboard. Material already exists — it's an assembly job, not a build job.

### 5.7 Land the impact narrative for Money & Financial Access
- **Why:** Category Impact needs a story that "redefines how something works."
- **How:** Framing = "the watchman that prevents forced liquidation + the tax optimizer that turns a forced sale into a tax event." Get even 1–3 real pilot users (fintech friends, small advisory firms) to generate testimonials and a case study. Wire their accounts through the real pipeline (fixtures already prove correctness: `run_fixtures.py:80-110`).

---

## §6 Eligibility Checklist (official rules, pass/fail, with evidence)

| Rule | Status | Evidence / Gap |
|---|---|---|
| Project falls in ≥1 category | ✅ | Money & Financial Access — §1 |
| Newly created after May 19, 2026 | ✅ | Repo history begins ~Jul 2026 (`git log`) |
| Uses ≥1 Google Cloud product | ❌ | **None deployed** — §5.5 |
| LLM functionality uses Gemini API for ≥1 call in deployed app | ✅ | **Gemini is primary** — `server.ts` (`@google/genai`), `nodes.py` `_call_gemini`, UI model selector — §5.1 |
| Repo URL public or shared with testing@devpost.com / judging@hacker.fund | ⚠️ | Public or private-with-access not yet configured |
| Text description + category relevance | ⚠️ | Not drafted (README.md is technical, not narrative) |
| <3 min demo video | ❌ | None |
| Revenue evidence (total, by month, costs, marketing spend, related-party) | ❌ | No revenue — §C1 |
| User evidence + testimonials | ❌ | Synthetic fixtures only |
| Product-running evidence (agent logs, API usage, dashboards) | ⚠️ | Audit log exists (`nodes.py:319-401`) but no live dashboard/usage monitor — §5.6 |
| Business entity / corporate ID (if org) | ⚠️ | TBD |

---

## §7 Competitive Standing (vs. a typical XPRIZE entry)

**Where we are clearly ahead (technical/trust axis):**
- Deterministic math engine with the LLM explicitly forbidden from recomputing numbers (`SYSTEM_PROMPT` rules 1–2, `nodes.py:567-568`) — most entries are prompt-only and unverifiable.
- Anti-hallucination guard rejects LLM lot references not in the data (`nodes.py:738-741`).
- Human-in-the-loop gate (`nodes.py:839-862`) — a regulatory-grade posture most hackathon entries lack.
- Full audit trail with provider provenance (`nodes.py:385`).
- 90 passing tests covering the actual domain rules.
- Correct shrinking-collateral formula — easy for reviewers to spot-check and hard to find in competitors.

**Where we are behind (XPRIZE axis):**
- **No GCP** — one hard rule violation left (deploy to Cloud Run + Firestore, §5.5). Gemini rule is now satisfied (§5.1).
- **No revenue, no users, no video, no narrative** — three of the four scored axes (Viability, Impact) currently empty.
- Single-agent (narrow scope) vs. competitor "agent-team" stories.
- No continuous/scheduled operation — not yet a "business that operates with AI," just a strong demo.

**Net positioning:** exceptional *engineering readiness*, near-zero *competition readiness* — the hardest rule violation (no Gemini) is now fixed; GCP deployment is the remaining cheap eligibility win.

---

## §8 Risk Table + Priority Action Plan (Aug 07 → Aug 17)

### Risk matrix

| Risk | Severity | Likelihood | Mitigation |
|---|---|---|---|
| Disqualified: no Gemini call in deployed app | ✅ Fixed (Aug 09) | §5.1 — Gemini is primary in web + Python; SDK now used |
| Disqualified: no Google Cloud product | 🔴 Critical | Certain (100%) | §5.5 — deploy to Cloud Run + Firestore audit |
| Stage Two flunks on Business Viability (no revenue) | 🟠 High | High | Launch a paid alert tier ($5–$20/mo) with at least 1 paying pilot; document $0 honestly otherwise |
| Video/narrative/evidence incomplete at deadline | 🟠 High | Medium | §5.6 evidence pack + record <3 min screen-capture demo from existing dashboard |
| Free Gemini quota/rate limits during demo | 🟡 Medium | Medium | Keep Groq/Poolside fallback chain intact (`nodes.py:724-756`) |
| Market-data (yfinance) flaky in demo | 🟡 Medium | Medium | Static fixture fallback already per-symbol (`nodes.py:116-118`) |

### Priority action plan (ranked by rule-risk then impact)

| # | Action | Target | Owner | Files to touch | Depends on |
|---|---|---|---|---|---|
| 1 | ✅ **DONE — Gemini API wired as primary in web + Python** | Aug 09 | — | `server.ts`, `nodes.py`, `src/providers.ts`, `src/components/ModelManager.tsx`, `src/App.tsx`, `check_providers.py`, `.env.example` | Gemini API key |
| 1b | Add model/provider management to UI (runtime config) | Aug 09 | — | `server.ts`, `src/providers.ts`, `src/components/ModelManager.tsx`, `src/App.tsx` | — |
| 2 | Deploy to Cloud Run + Firestore audit trail | Aug 11 | — | `package.json:8-10`, new deploy config, `nodes.py:319-401` (storage swap for live app) | §1 |
| 3 | Build /api/audit/live + usage counter, screenshot dashboard | Aug 12 | — | `server.ts`, `AuditLogger.query` `nodes.py:390-401` | §1 |
| 4 | Add Gemini voice/Live capability to `metadata.json` | Aug 13 | — | `metadata.json:5` | §1 |
| 5 | Launch pilot: 1–3 real users + revenue tier | Aug 15 | — | — | §2, §3 |
| 6 | Write narrative, record <3 min video, submit Devpost | Aug 16–17 | — | new `SUBMISSION.md`, video | everything |

---

## Appendix — File Index (the full map in one place)

| File | What it owns | Key lines |
|---|---|---|
| `agent.py` | Graph construction, checkpointer factory, conditional routing, fallback runner | `93-142` (graph), `37-81` (checkpointer), `84-91` (route), `144-287` (fallback) |
| `nodes.py` | Models, 8 node classes, LTV math, tax/wash-sale logic, circuit breaker, audit, prompts | `26-62` (models), `67-81` (state), `84-163` (ingest), `166-254` (LTV), `257-288` (safe-skip), `291-317` (breaker), `319-401` (audit), `405-562` (tax), `565-582` (prompt), `585-836` (reasoning/LLM), `839-862` (approval), `865-910` (execution) |
| `server.ts` | Express API, provider fallbacks, model management, live prices, analyze/chat/audit | `17-120` (providers), `122-166` (models API), `168-175` (health), `177-235` (prices), `238-345` (analyze), `347-399` (audit), `402-496` (chat) |
| `src/providers.ts` | Provider/model registry (built-ins + `model-config.json`), CRUD, connection test | `1-320` |
| `mcp_server.py` | MCP tools `check_ltv` / `optimize_sale` | `46-108` |
| `run_fixtures.py` | 6-fixture e2e verification | `20-119` |
| `check_providers.py` | Pre-demo health check | `15-118` |
| `src/utils.ts` | TS parity engine | `62-305` |
| `src/types.ts` | Shared TS types | `1-51` |
| `src/App.tsx` | Dashboard shell, sliders, presets, provider/model selector, approval flow | `1-548` |
| `src/components/ModelManager.tsx` | Add/remove providers & models, test connections, set defaults | `1-330` |
| `src/presets.ts` | Sandbox scenarios | `3-101` |
| `src/components/HoldingsTable.tsx` | Lot CRUD + live prices | `1-353` |
| `src/components/OptimizationProposal.tsx` | Proposal render, approval, audit export | `1-275` |
| `src/components/ChatAssistant.tsx` | Advisor chat | `1-171` |
| `metadata.json` | Gemini capability declarations | `1-6` |
| `fixtures/fake_users.json` | 6 synthetic accounts | `1-120` |
| `tests/` | 90 tests | — |

**TL;DR:** Strong agent engineering, zero Gemini + zero GCP (two rule-breaking gaps), zero revenue/users (two scored-axis gaps). Fix order: **Gemini in → deploy GCP → evidence pack → pilot → submit.**
