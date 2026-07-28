"""tests/test_mcp.py — Unit tests for MCP server tools.

Run: .venv/bin/python -m pytest tests/test_mcp.py -v
"""

import json
import os
import sys
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _check_ltv(account_json: str) -> str:
    """Mirrors mcp_server.check_ltv with try/except error handling."""
    try:
        from nodes import IngestPortfolioNode, LTVMonitorNode
        account = json.loads(account_json)
        ingest = IngestPortfolioNode(use_live_prices=False)
        state = ingest({"account": account})
        ltv_node = LTVMonitorNode()
        result = ltv_node(state)
        return json.dumps({
            "current_ltv": round(result["current_ltv"], 4),
            "risk_state": result["risk_state"],
            "headroom": round(result["headroom"], 2),
            "collateral_value": round(result["collateral_value"], 2),
            "net_debt": round(state["account"].loan_balance - state["account"].cash, 2),
        }, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)})


def _optimize_sale(account_json: str, cash_need: float = 0.0) -> str:
    """Mirrors mcp_server.optimize_sale with try/except error handling."""
    try:
        from nodes import (
            IngestPortfolioNode, LTVMonitorNode, TaxOptimizerNode,
            ReasoningAgentNode, Recommendation,
        )
        account = json.loads(account_json)
        ingest = IngestPortfolioNode(use_live_prices=False)
        state = ingest({"account": account})
        ltv_node = LTVMonitorNode()
        state.update(ltv_node(state))
        tax_node = TaxOptimizerNode()
        state.update(tax_node(state))
        reasoning = ReasoningAgentNode()
        state.update(reasoning(state))
        rec = state.get("recommendation")
        if isinstance(rec, Recommendation):
            rec_dict = rec.model_dump(mode="json")
        else:
            rec_dict = rec
        return json.dumps(rec_dict, indent=2, default=str)
    except Exception as e:
        return json.dumps({"error": str(e)})


# ---------------------------------------------------------------------------
# Test check_ltv
# ---------------------------------------------------------------------------

class TestCheckLTV:
    def _safe_account_json(self):
        return json.dumps({
            "name": "MCP Test",
            "loan_balance": 1000,
            "max_ltv_limit": 0.50,
            "cash": 0,
            "holdings": [
                {
                    "symbol": "AAPL",
                    "quantity": 100,
                    "cost_basis": 150,
                    "current_price": 200,
                    "acquired_date": "2023-05-10",
                }
            ],
        })

    def _high_risk_account_json(self):
        return json.dumps({
            "name": "MCP High Risk",
            "loan_balance": 4500,
            "max_ltv_limit": 0.50,
            "cash": 0,
            "holdings": [
                {
                    "symbol": "TECH",
                    "quantity": 80,
                    "cost_basis": 120,
                    "current_price": 100,
                    "acquired_date": "2024-01-15",
                }
            ],
        })

    def test_returns_valid_json(self):
        result = json.loads(_check_ltv(self._safe_account_json()))
        assert "current_ltv" in result
        assert "risk_state" in result
        assert "headroom" in result
        assert "collateral_value" in result
        assert "net_debt" in result

    def test_correct_ltv_safe(self):
        result = json.loads(_check_ltv(self._safe_account_json()))
        # collateral = 20000, net_debt = 1000, ltv = 0.05
        assert result["current_ltv"] == 0.05
        assert result["risk_state"] == "Safe"

    def test_correct_ltv_high_risk(self):
        result = json.loads(_check_ltv(self._high_risk_account_json()))
        assert result["risk_state"] == "High Risk"

    def test_invalid_json_returns_error(self):
        result = json.loads(_check_ltv("not valid json"))
        assert "error" in result

    def test_missing_holdings_returns_error(self):
        account = json.dumps({"name": "Bad", "loan_balance": 1000, "holdings": []})
        result = json.loads(_check_ltv(account))
        # Should not error, just return empty collateral
        assert "risk_state" in result


# ---------------------------------------------------------------------------
# Test optimize_sale
# ---------------------------------------------------------------------------

class TestOptimizeSale:
    def _high_risk_json(self):
        return json.dumps({
            "name": "MCP Optimize Test",
            "loan_balance": 4500,
            "max_ltv_limit": 0.50,
            "cash": 0,
            "holdings": [
                {
                    "symbol": "TECH",
                    "quantity": 80,
                    "cost_basis": 120,
                    "current_price": 100,
                    "acquired_date": "2024-01-15",
                }
            ],
        })

    def test_returns_valid_recommendation(self):
        result = json.loads(_optimize_sale(self._high_risk_json()))
        assert "risk_state" in result
        assert "recommended_action" in result
        assert "proposed_lots" in result
        assert "rationale" in result

    def test_high_risk_produces_proposals(self):
        result = json.loads(_optimize_sale(self._high_risk_json()))
        assert result["risk_state"] == "High Risk"
        assert len(result["proposed_lots"]) > 0

    def test_invalid_json_returns_error(self):
        result = json.loads(_optimize_sale("bad json"))
        assert "error" in result
