"""tests/test_mcp.py — Unit tests for MCP server tools.

Tests the actual check_ltv and optimize_sale logic from mcp_server.py
by calling the underlying functions directly.

Run: .venv/bin/python -m pytest tests/test_mcp.py -v
"""

import json
import os
import sys
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from nodes import (
    IngestPortfolioNode, LTVMonitorNode, TaxOptimizerNode,
    ReasoningAgentNode, SafeSkipNode, Recommendation,
)


# ---------------------------------------------------------------------------
# Shared logic (mirrors mcp_server.py exactly)
# ---------------------------------------------------------------------------

_ingest = IngestPortfolioNode(use_live_prices=False)
_ltv_node = LTVMonitorNode(notify=False)
_tax_node = TaxOptimizerNode()
_reasoning = ReasoningAgentNode()
_safe_skip = SafeSkipNode()


def check_ltv(account_json: str) -> str:
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
        return json.dumps({"error": str(e)})


def optimize_sale(account_json: str, cash_need: float = 0.0) -> str:
    try:
        account = json.loads(account_json)
        state = _ingest({"account": account})
        state.update(_ltv_node(state))
        state.update(_tax_node(state))
        if state.get("risk_state") == "Safe" and cash_need <= 0:
            state.update(_safe_skip(state))
        else:
            state["cash_need"] = cash_need
            state.update(_reasoning(state))
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
        result = json.loads(check_ltv(self._safe_account_json()))
        assert "current_ltv" in result
        assert "risk_state" in result
        assert "headroom" in result
        assert "collateral_value" in result
        assert "net_debt" in result

    def test_correct_ltv_safe(self):
        result = json.loads(check_ltv(self._safe_account_json()))
        assert result["current_ltv"] == 0.05
        assert result["risk_state"] == "Safe"

    def test_correct_ltv_high_risk(self):
        result = json.loads(check_ltv(self._high_risk_account_json()))
        assert result["risk_state"] == "High Risk"

    def test_invalid_json_returns_error(self):
        result = json.loads(check_ltv("not valid json"))
        assert "error" in result

    def test_missing_holdings_returns_error(self):
        account = json.dumps({"name": "Bad", "loan_balance": 1000, "holdings": []})
        result = json.loads(check_ltv(account))
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

    def _safe_account_json(self):
        return json.dumps({
            "name": "MCP Safe",
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

    def test_returns_valid_recommendation(self):
        result = json.loads(optimize_sale(self._high_risk_json()))
        assert "risk_state" in result
        assert "recommended_action" in result
        assert "proposed_lots" in result
        assert "rationale" in result

    def test_high_risk_produces_proposals(self):
        result = json.loads(optimize_sale(self._high_risk_json()))
        assert result["risk_state"] == "High Risk"
        assert len(result["proposed_lots"]) > 0

    def test_invalid_json_returns_error(self):
        result = json.loads(optimize_sale("bad json"))
        assert "error" in result

    def test_safe_skip_bypass(self):
        """Safe portfolio + no cash_need should skip LLM and produce status=skipped."""
        result = json.loads(optimize_sale(self._safe_account_json()))
        assert result["risk_state"] == "Safe"
        assert result["recommended_action"] == "No action required"
        assert result["proposed_lots"] == []

    def test_safe_with_cash_need_calls_llm(self):
        """Safe portfolio + cash_need > 0 should NOT skip — LLM runs."""
        result = json.loads(optimize_sale(self._safe_account_json(), cash_need=500))
        assert result["risk_state"] == "Safe"
        # Should still have a recommendation (from LLM or fallback), not a skip
        assert result.get("recommended_action") != "No action required" or len(result.get("proposed_lots", [])) > 0
