# Collateral — Agent Instructions

## Language Runtimes

- **Python: 3.10 required** — 3.11+ has import hangs with LangGraph
- **Node.js: 18+** — for web app

## Setup

```bash
# Python (uv package manager)
uv venv --python 3.10 .venv
source .venv/bin/activate
uv pip install -r requirements.txt

# Node.js
npm install
cp .env.example .env.local  # edit with API keys
```

## Common Commands

| Task | Command |
|------|---------|
| Type check | `npm run lint` |
| Build | `npm run build` |
| Dev server | `npm run dev` |
| Web app only | `npm run dev` → http://localhost:5173 |
| Python tests | `.venv/bin/python -m pytest tests/test_nodes.py -v` |
| MCP tests | `.venv/bin/python -m pytest tests/test_mcp.py -v` |
| Fixture runner | `python run_fixtures.py` |
| Health check | `python check_providers.py` |
| Admin hash | `npm run hash:admin <password>` |

## Environment

- Keys live in `.env.local` (gitignored)
- Required for production: `SESSION_SECRET`
- Primary LLM: `GEMINI_API_KEY` or `GROQ_API_KEY`
- `npm run lint` runs `tsc --noEmit` (no separate typecheck command)

## Project Structure

| Directory | Purpose |
|-----------|---------|
| Root Python | `nodes.py`, `agent.py`, `run_fixtures.py`, `mcp_server.py` |
| `src/` | TypeScript React app |
| `tests/` | Python unit/e2e tests |
| `Details/` | Design docs |

## Testing Notes

- `tests/test_nodes.py` — 80 tests for all node classes
- `tests/test_mcp.py` — 10 tests for MCP tools
- Use `use_live_prices=False` in tests/fixtures for reproducibility
- MCP server uses static prices; web app can fetch live via yfinance

## Gotchas

- MCP tools: `check_ltv(account_json)` and `optimize_sale(account_json, cash_need)`
- Server dev binds to `127.0.0.1` only; production binds `0.0.0.0`
- Admin login: dev creds `admin@collateral.dev` / `admin123`
- TypeScript paths: `@/*` maps to `./*`