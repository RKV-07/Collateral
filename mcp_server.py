"""mcp_server.py — Expose Collateral optimizer as MCP tools.

Run: python mcp_server.py
Or:  mcp run mcp_server.py

Provides two tools callable from Claude Desktop / Claude Code:
  - check_ltv: Check loan-to-value ratio and margin call risk
  - optimize_sale: Recommend which asset to sell to minimize tax
"""

import json
import logging
import os
import sys

from dotenv import load_dotenv
load_dotenv(".env.local")

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

from nodes import (
    Account, IngestPortfolioNode, LTVMonitorNode,
    TaxOptimizerNode, ReasoningAgentNode, Recommendation,
)

try:
    from fastmcp import FastMCP
except ImportError:
    print("fastmcp not installed. Install with: pip install fastmcp")
    print("Then re-run: python mcp_server.py")
    sys.exit(1)

app = FastMCP("collateral-optimizer")

# Build node instances once at module level — reuse across tool calls
_ingest = IngestPortfolioNode(use_live_prices=False)
_ltv_node = LTVMonitorNode()
_tax_node = TaxOptimizerNode()
_reasoning = ReasoningAgentNode()


@app.tool()
def check_ltv(account_json: str) -> str:
    """Check loan-to-value ratio and margin call risk for a portfolio.

    Args:
        account_json: JSON string of an account with holdings, loan_balance, max_ltv_limit, cash.
                      Example: {"name": "My Portfolio", "loan_balance": 10000, "max_ltv_limit": 0.50, "cash": 0, "holdings": [{"symbol": "AAPL", "quantity": 100, "cost_basis": 150, "current_price": 200, "acquired_date": "2023-05-10"}]}

    Returns:
        JSON string with current_ltv, risk_state, headroom, collateral_value, and net_debt.
    """
    try:
        account = json.loads(account_json)
        state = _ingest({"account": account})
        result = _ltv_node(state)

        return json.dumps({
            "current_ltv": round(result["current_ltv"], 4),
            "risk_state": result["risk_state"],
            "headroom": round(result["headroom"], 2),
            "collateral_value": round(result["collateral_value"], 2),
            "net_debt": round(state["account"].loan_balance - state["account"].cash, 2),
        }, indent=2)
    except Exception as e:
        logger.error("[check_ltv] failed: %s", str(e))
        return json.dumps({"error": str(e)})


@app.tool()
def optimize_sale(account_json: str, cash_need: float = 0.0) -> str:
    """Recommend which asset to sell to minimize tax impact and restore borrowing headroom.

    Args:
        account_json: JSON string of an account with holdings, loan_balance, max_ltv_limit, cash.
        cash_need: Cash amount the account holder wants to withdraw (default 0).
                   The optimizer will sell enough to cover both any deficit AND this cash need.

    Returns:
        JSON string with risk_state, recommended_action, proposed_lots, resulting_ltv_if_executed, and rationale.
    """
    try:
        account = json.loads(account_json)
        state = _ingest({"account": account})
        state.update(_ltv_node(state))
        state.update(_tax_node(state))

        # Thread cash_need into state so ReasoningAgentNode can use it
        state["cash_need"] = cash_need
        state.update(_reasoning(state))

        rec = state.get("recommendation")
        if isinstance(rec, Recommendation):
            rec_dict = rec.model_dump(mode="json")
        else:
            rec_dict = rec

        return json.dumps(rec_dict, indent=2, default=str)
    except Exception as e:
        logger.error("[optimize_sale] failed: %s", str(e))
        return json.dumps({"error": str(e)})


if __name__ == "__main__":
    app.run()
