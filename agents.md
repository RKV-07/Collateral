# Collateral Agents

## Folder Structure
```
src/pages/        — React route pages (Home, Login, Dashboard, Demo, Admin, Stocks, Pricing, Solutions, WhatsNew)
src/components/   — Presentational components (HoldingsTable, OptimizationProposal, ChatAssistant, ModelManager, etc.)
src/api.ts        — API client, types (UserDTO, PortfolioDTO, HoldingInput, PriceInfo)
src/utils.ts      — Deterministic engine (calculateOptimizer, getAdjustedSnapshot, LTV math)
src/types.ts      — Data models (AccountSnapshot, HoldingLot, ProposalOutput, PublicRegistry)
src/providers.ts  — Provider/model registry, fallback chain
src/servers.ts    — Express backend (middleware, auth, portfolio/audit/chat endpoints)
src/audit-store.ts— Append-only audit storage (SQLite/Firestore)
src/session-store.ts — Prisma-backed sessions
src/useAuth.tsx   — React auth context (Google OAuth + dev login)
nodes.py          — 6-node LangGraph pipeline (Ingest → LTV monitor → Tax optimizer → Reasoning → Approval → Execution)
agent.py          — LangGraph StateGraph builder with safe-skip conditional branching
mcp_server.py     — FastMCP exposing check_ltv/optimize_sale tools
models.json       — Provider/config, persisted at runtime
fixtures/fake_users.json — 6 test scenarios
Details/          — Docs (Design.md, QUICKSTART.md, tier.md, live.md)
```

## Technologies
- **Frontend**: TypeScript (React 19, Vite, Tailwind CSS, Lucide icons)
- **Backend**: TypeScript (Express 4, Prisma 6, SQLite)
- **Agent**: Python 3.10 (LangGraph v1, LangChain, yfinance, requests)
- **LLM Stack**: Gemini (primary) → Groq → Poolside → OpenRouter → deterministic fallback
- **Auth**: Google OAuth, passport.js, express-session
- **Deployment**: Docker, Docker Compose, Caddy, optional Cloud Run + Firestore