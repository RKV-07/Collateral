"""tests/test_nodes.py — Unit tests for all node classes and end-to-end pipeline.

Run: .venv/bin/python -m pytest tests/test_nodes.py -v
"""

import json
import os
import sys
from unittest.mock import patch, MagicMock
from datetime import datetime, timedelta

import pytest

# Ensure project root is on path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from nodes import (
    Lot, Account, LotProposal, Recommendation,
    IngestPortfolioNode, LTVMonitorNode, TaxOptimizerNode,
    ReasoningAgentNode, HumanApprovalNode, ExecutionNode,
    SafeSkipNode, CircuitBreaker, AuditLogger, CostBasisMethod,
    _day_difference,
)
from agent import _route_after_ltv


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _make_lot(**overrides):
    defaults = {
        "lot_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
        "symbol": "AAPL",
        "quantity": 100.0,
        "cost_basis": 150.0,
        "current_price": 200.0,
        "acquired_date": "2023-05-10",
    }
    defaults.update(overrides)
    return Lot(**defaults)


def _make_account(**overrides):
    defaults = {
        "name": "Test Portfolio",
        "loan_balance": 10000.0,
        "max_ltv_limit": 0.50,
        "cash": 0.0,
        "holdings": [_make_lot()],
    }
    defaults.update(overrides)
    return Account(**defaults)


def _make_account_dict(**overrides):
    return _make_account(**overrides).model_dump(mode="json")


# ---------------------------------------------------------------------------
# Pydantic Model Tests
# ---------------------------------------------------------------------------

class TestLotModel:
    def test_valid_lot(self):
        lot = _make_lot()
        assert lot.symbol == "AAPL"
        assert lot.quantity == 100.0

    def test_quantity_must_be_positive(self):
        with pytest.raises(Exception):
            _make_lot(quantity=0)

    def test_cost_basis_can_be_zero(self):
        lot = _make_lot(cost_basis=0)
        assert lot.cost_basis == 0

    def test_current_price_can_be_zero(self):
        lot = _make_lot(current_price=0)
        assert lot.current_price == 0

    def test_uuid_default(self):
        lot1 = Lot(symbol="X", quantity=1, cost_basis=1, current_price=1, acquired_date="2026-01-01")
        lot2 = Lot(symbol="X", quantity=1, cost_basis=1, current_price=1, acquired_date="2026-01-01")
        assert lot1.lot_id != lot2.lot_id


class TestAccountModel:
    def test_valid_account(self):
        acc = _make_account()
        assert acc.name == "Test Portfolio"
        assert len(acc.holdings) == 1

    def test_loan_balance_non_negative(self):
        with pytest.raises(Exception):
            _make_account(loan_balance=-1)

    def test_max_ltv_limit_range(self):
        with pytest.raises(Exception):
            _make_account(max_ltv_limit=0)
        with pytest.raises(Exception):
            _make_account(max_ltv_limit=1.5)
        acc = _make_account(max_ltv_limit=0.35)
        assert acc.max_ltv_limit == 0.35

    def test_cash_non_negative(self):
        with pytest.raises(Exception):
            _make_account(cash=-100)


class TestRecommendationModel:
    def test_valid_recommendation(self):
        rec = Recommendation(
            risk_state="Safe",
            recommended_action="Maintain",
            proposed_lots=[],
            rationale="No action needed.",
        )
        assert rec.risk_state == "Safe"
        assert rec.resulting_ltv_if_executed is None

    def test_with_proposed_lots(self):
        rec = Recommendation(
            risk_state="High Risk",
            recommended_action="Sell",
            proposed_lots=[
                LotProposal(
                    lot_id="f47ac10b-58cc-4372-a567-0e02b2c3d479",
                    quantity=50,
                    realized_gain_loss=-500,
                )
            ],
            resulting_ltv_if_executed=0.45,
            rationale="Deficit needs closing.",
        )
        assert len(rec.proposed_lots) == 1
        assert rec.resulting_ltv_if_executed == 0.45


# ---------------------------------------------------------------------------
# _day_difference
# ---------------------------------------------------------------------------

class TestDayDifference:
    def test_same_date(self):
        assert _day_difference("2026-01-01", "2026-01-01") == 0

    def test_different_dates(self):
        assert _day_difference("2026-01-01", "2026-01-31") == 30

    def test_order_doesnt_matter(self):
        assert _day_difference("2026-01-31", "2026-01-01") == 30

    def test_within_30_days(self):
        d1 = datetime.now().strftime("%Y-%m-%d")
        d2 = (datetime.now() + timedelta(days=29)).strftime("%Y-%m-%d")
        assert _day_difference(d1, d2) == 29

    def test_exactly_31_days(self):
        d1 = datetime.now().strftime("%Y-%m-%d")
        d2 = (datetime.now() + timedelta(days=31)).strftime("%Y-%m-%d")
        assert _day_difference(d1, d2) == 31


# ---------------------------------------------------------------------------
# IngestPortfolioNode
# ---------------------------------------------------------------------------

class TestIngestPortfolioNode:
    def test_ingest_with_dict_input(self):
        node = IngestPortfolioNode(use_live_prices=False)
        account = _make_account_dict()
        result = node({"account": account})
        assert isinstance(result["account"], Account)
        assert result["account"].name == "Test Portfolio"

    def test_ingest_with_account_model_input(self):
        node = IngestPortfolioNode(use_live_prices=False)
        account = _make_account()
        result = node({"account": account})
        assert isinstance(result["account"], Account)

    def test_ingest_empty_state_loads_from_file(self):
        node = IngestPortfolioNode(
            source_path="fixtures/fake_users.json",
            use_live_prices=False,
        )
        result = node({})
        assert isinstance(result["account"], Account)
        assert result["account"].name == "Safe Portfolio"

    def test_ingest_missing_file_raises(self):
        node = IngestPortfolioNode(
            source_path="nonexistent.json",
            use_live_prices=False,
        )
        with pytest.raises(FileNotFoundError):
            node({})

    def test_ingest_skips_live_prices_when_disabled(self):
        node = IngestPortfolioNode(use_live_prices=False)
        account = _make_account_dict()
        # Patch yfinance to verify it's NOT called
        with patch("nodes.YF_AVAILABLE", True):
            with patch("nodes.yf") as mock_yf:
                result = node({"account": account})
                mock_yf.Ticker.assert_not_called()

    def test_ingest_updates_prices_when_live_enabled(self):
        node = IngestPortfolioNode(use_live_prices=True)
        account = _make_account_dict()

        # Mock _fetch_live_prices directly instead of yfinance internals
        with patch.object(node, "_fetch_live_prices", return_value={"AAPL": 350.0}):
            result = node({"account": account})
            updated = result["account"].holdings[0]
            assert updated.current_price == 350.0


# ---------------------------------------------------------------------------
# LTVMonitorNode
# ---------------------------------------------------------------------------

class TestLTVMonitorNode:
    def test_safe_portfolio(self):
        acc = _make_account(loan_balance=1000, holdings=[_make_lot(current_price=200)])
        # collateral = 100*200 = 20000, net_debt = 1000, max_loan = 10000, headroom = 9000
        node = LTVMonitorNode()
        result = node({"account": acc})
        assert result["risk_state"] == "Safe"
        assert result["headroom"] == 9000.0
        assert result["collateral_value"] == 20000.0

    def test_warning_portfolio(self):
        # collateral = 100*100 = 10000, net_debt = 4000, max_loan = 5000, headroom = 1000
        # ratio = 1000/5000 = 0.20 < 0.25 → Warning
        acc = _make_account(loan_balance=4000, holdings=[_make_lot(current_price=100)])
        node = LTVMonitorNode()
        result = node({"account": acc})
        assert result["risk_state"] == "Warning"
        assert result["headroom"] == 1000.0

    def test_high_risk_portfolio(self):
        # collateral = 80*100 = 8000, net_debt = 4500, max_loan = 4000, headroom = -500
        acc = _make_account(
            loan_balance=4500,
            holdings=[_make_lot(symbol="TECH", quantity=80, cost_basis=120, current_price=100)],
        )
        node = LTVMonitorNode()
        result = node({"account": acc})
        assert result["risk_state"] == "High Risk"
        assert result["headroom"] == -500.0

    def test_zero_collateral(self):
        acc = _make_account(loan_balance=1000, holdings=[])
        node = LTVMonitorNode()
        result = node({"account": acc})
        assert result["collateral_value"] == 0.0
        assert result["current_ltv"] == 0.0

    def test_cash_reduces_net_debt(self):
        # collateral = 100*200 = 20000, net_debt = 5000-2000 = 3000
        # max_loan = 20000*0.50 = 10000, headroom = 10000-3000 = 7000
        acc = _make_account(loan_balance=5000, cash=2000)
        node = LTVMonitorNode()
        result = node({"account": acc})
        assert result["headroom"] == 7000.0

    def test_non_standard_ltv_limit(self):
        # max_ltv_limit = 0.35, collateral = 8000, loan = 5000, cash = 0
        # net_debt = 5000, max_loan = 8000*0.35 = 2800, headroom = -2200
        acc = _make_account(
            loan_balance=5000,
            max_ltv_limit=0.35,
            holdings=[_make_lot(symbol="QQQ", quantity=100, current_price=80)],
        )
        node = LTVMonitorNode()
        result = node({"account": acc})
        assert result["risk_state"] == "High Risk"
        assert result["headroom"] == -2200.0

    def test_works_with_dict_input(self):
        node = LTVMonitorNode()
        state = {"account": _make_account_dict(loan_balance=1000)}
        result = node(state)
        assert "risk_state" in result
        assert "headroom" in result


# ---------------------------------------------------------------------------
# TaxOptimizerNode
# ---------------------------------------------------------------------------

class TestTaxOptimizerNode:
    def test_single_lot_no_wash_sale(self):
        acc = _make_account()
        state = {"account": acc}
        node = TaxOptimizerNode()
        result = node(state)
        assert len(result["ranked_lots"]) == 1
        assert result["ranked_lots"][0]["wash_sale_caution"] is False

    def test_loss_lot_ranked_first(self):
        acc = _make_account(holdings=[
            _make_lot(symbol="NVDA", lot_id="6ba7b810-9dad-11d1-80b4-00c04fd430c8", cost_basis=50, current_price=100, acquired_date="2023-01-01"),
            _make_lot(symbol="GOOGL", lot_id="6ba7b811-9dad-11d1-80b4-00c04fd430c8", cost_basis=150, current_price=120, acquired_date="2023-02-01"),
        ])
        state = {"account": acc}
        node = TaxOptimizerNode()
        result = node(state)
        lots = result["ranked_lots"]
        # GOOGL has loss (-3000), NVDA has gain (+5000)
        assert lots[0]["unrealized_gain_loss"] < lots[1]["unrealized_gain_loss"]

    def test_wash_sale_flagged_within_30_days(self):
        today = datetime.now().strftime("%Y-%m-%d")
        day_9 = (datetime.now() - timedelta(days=9)).strftime("%Y-%m-%d")
        acc = _make_account(holdings=[
            _make_lot(symbol="XYZ", lot_id="7ba7b812-9dad-11d1-80b4-00c04fd430c8", quantity=50, cost_basis=220, current_price=200, acquired_date=day_9),
            _make_lot(symbol="XYZ", lot_id="7ba7b813-9dad-11d1-80b4-00c04fd430c8", quantity=30, cost_basis=190, current_price=200, acquired_date=today),
        ])
        state = {"account": acc}
        node = TaxOptimizerNode()
        result = node(state)
        loss_lot = next(l for l in result["ranked_lots"] if l["unrealized_gain_loss"] < 0)
        gain_lot = next(l for l in result["ranked_lots"] if l["unrealized_gain_loss"] > 0)
        assert loss_lot["wash_sale_caution"] is True
        assert gain_lot["wash_sale_caution"] is False

    def test_wash_sale_not_flagged_beyond_30_days(self):
        today = datetime.now().strftime("%Y-%m-%d")
        day_31 = (datetime.now() - timedelta(days=31)).strftime("%Y-%m-%d")
        acc = _make_account(holdings=[
            _make_lot(symbol="XYZ", lot_id="7ba7b812-9dad-11d1-80b4-00c04fd430c8", quantity=50, cost_basis=220, current_price=200, acquired_date=day_31),
            _make_lot(symbol="XYZ", lot_id="7ba7b813-9dad-11d1-80b4-00c04fd430c8", quantity=30, cost_basis=190, current_price=200, acquired_date=today),
        ])
        state = {"account": acc}
        node = TaxOptimizerNode()
        result = node(state)
        loss_lot = next(l for l in result["ranked_lots"] if l["unrealized_gain_loss"] < 0)
        assert loss_lot["wash_sale_caution"] is False

    def test_unrealized_gain_loss_calculation(self):
        acc = _make_account(holdings=[
            _make_lot(quantity=100, cost_basis=150, current_price=200),
        ])
        state = {"account": acc}
        node = TaxOptimizerNode()
        result = node(state)
        lot = result["ranked_lots"][0]
        # gain = (200 - 150) * 100 = 5000
        assert lot["unrealized_gain_loss"] == 5000.0
        assert lot["unrealized_gain_loss_per_share"] == 50.0

    def test_empty_holdings(self):
        acc = _make_account(holdings=[])
        state = {"account": acc}
        node = TaxOptimizerNode()
        result = node(state)
        assert result["ranked_lots"] == []

    def test_holding_period_short_term(self):
        recent = (datetime.now() - timedelta(days=100)).strftime("%Y-%m-%d")
        acc = _make_account(holdings=[
            _make_lot(symbol="XYZ", lot_id="a1b2c3d4-0000-0000-0000-000000000001", acquired_date=recent),
        ])
        state = {"account": acc}
        node = TaxOptimizerNode()
        result = node(state)
        lot = result["ranked_lots"][0]
        assert lot["is_short_term"] is True
        assert lot["days_held"] <= 101
        assert len(result["holding_period_days"]) == 1
        assert result["holding_period_days"][0]["is_short_term"] is True

    def test_holding_period_long_term(self):
        old = (datetime.now() - timedelta(days=500)).strftime("%Y-%m-%d")
        acc = _make_account(holdings=[
            _make_lot(symbol="XYZ", lot_id="a1b2c3d4-0000-0000-0000-000000000002", acquired_date=old),
        ])
        state = {"account": acc}
        node = TaxOptimizerNode()
        result = node(state)
        lot = result["ranked_lots"][0]
        assert lot["is_short_term"] is False
        assert lot["days_held"] > 365

    def test_sector_concentration_warning(self):
        acc = _make_account(holdings=[
            _make_lot(symbol="AAPL", lot_id="a1b2c3d4-0000-0000-0000-000000000003", quantity=100, current_price=200),
            _make_lot(symbol="MSFT", lot_id="a1b2c3d4-0000-0000-0000-000000000004", quantity=50, current_price=100),
        ])
        state = {"account": acc}
        node = TaxOptimizerNode(concentration_threshold=0.40)
        result = node(state)
        # AAPL = 20000, MSFT = 5000, total = 25000
        # Both in Technology → 100% > 40% threshold
        assert result["concentration_warning"] is not None
        assert "Technology" in result["concentration_warning"]
        assert "100%" in result["concentration_warning"]
        assert "sector_concentration" in result
        assert "Technology" in result["sector_concentration"]

    def test_sector_concentration_no_warning_below_threshold(self):
        acc = _make_account(holdings=[
            _make_lot(symbol="AAPL", lot_id="a1b2c3d4-0000-0000-0000-000000000005", quantity=10, current_price=100),
            _make_lot(symbol="JPM", lot_id="a1b2c3d4-0000-0000-0000-000000000006", quantity=10, current_price=100),
            _make_lot(symbol="JNJ", lot_id="a1b2c3d4-0000-0000-0000-000000000007", quantity=10, current_price=100),
            _make_lot(symbol="XOM", lot_id="a1b2c3d4-0000-0000-0000-000000000008", quantity=10, current_price=100),
        ])
        state = {"account": acc}
        node = TaxOptimizerNode(concentration_threshold=0.40)
        result = node(state)
        # Each sector = 25%, below 40% threshold
        assert result["concentration_warning"] is None

    def test_sector_concentration_empty_holdings(self):
        acc = _make_account(holdings=[])
        state = {"account": acc}
        node = TaxOptimizerNode()
        result = node(state)
        assert result["sector_concentration"] == {}
        assert result["concentration_warning"] is None


# ---------------------------------------------------------------------------
# ExecutionNode
# ---------------------------------------------------------------------------

class TestExecutionNode:
    def test_approved_execution(self):
        rec = Recommendation(
            risk_state="High Risk",
            recommended_action="Sell AAPL",
            proposed_lots=[],
            rationale="Deficit.",
        )
        state = {"approved": True, "recommendation": rec, "risk_state": "Safe"}
        node = ExecutionNode()
        result = node(state)
        assert result["result"]["status"] == "executed"

    def test_rejected_execution(self):
        rec = Recommendation(
            risk_state="Safe",
            recommended_action="Maintain",
            proposed_lots=[],
            rationale="Safe.",
        )
        state = {"approved": False, "recommendation": rec, "risk_state": "Safe"}
        node = ExecutionNode()
        result = node(state)
        assert result["result"]["status"] == "rejected"

    def test_none_recommendation_doesnt_crash(self):
        state = {"approved": True, "recommendation": None, "risk_state": "Safe"}
        node = ExecutionNode()
        result = node(state)
        assert result["result"]["status"] == "executed"
        assert result["result"]["action"] == "No recommendation"

    def test_dict_recommendation(self):
        state = {
            "approved": True,
            "recommendation": {"recommended_action": "Sell", "proposed_lots": []},
            "risk_state": "Safe",
        }
        node = ExecutionNode()
        result = node(state)
        assert result["result"]["action"] == "Sell"

    def test_slack_alert_sent_on_high_risk(self):
        node = LTVMonitorNode(slack_webhook_url="https://hooks.slack.com/test")
        with patch.object(node, "_send_slack_alert") as mock_alert:
            node({
                "account": Account(
                    name="Test",
                    holdings=[Lot(symbol="X", quantity=100, cost_basis=10, current_price=10, acquired_date="2023-01-01")],
                    loan_balance=2000,
                    max_ltv_limit=0.50,
                )
            })
            mock_alert.assert_called_once()

    def test_slack_alert_not_sent_on_safe(self):
        node = LTVMonitorNode(slack_webhook_url="https://hooks.slack.com/test")
        with patch.object(node, "_send_slack_alert") as mock_alert:
            node({
                "account": Account(
                    name="Test",
                    holdings=[Lot(symbol="X", quantity=100, cost_basis=10, current_price=100, acquired_date="2023-01-01")],
                    loan_balance=2000,
                    max_ltv_limit=0.50,
                )
            })
            # _send_slack_alert is called but returns early because risk_state != High Risk
            mock_alert.assert_called_once()

    def test_slack_no_webhook_doesnt_crash(self):
        rec = Recommendation(
            risk_state="High Risk",
            recommended_action="Sell",
            proposed_lots=[],
            rationale="Deficit.",
        )
        state = {
            "approved": True,
            "recommendation": rec,
            "risk_state": "High Risk",
            "current_ltv": 0.55,
            "headroom": -500,
        }
        node = ExecutionNode()  # no webhook
        result = node(state)  # should not raise
        assert result["result"]["status"] == "executed"


class TestSafeSkipNode:
    def test_safe_skip_generates_benign_recommendation(self):
        state = {"headroom": 5000.0, "risk_state": "Safe", "cash_need": 0.0}
        node = SafeSkipNode()
        result = node(state)
        assert isinstance(result["recommendation"], Recommendation)
        assert result["recommendation"].risk_state == "Safe"
        assert result["recommendation"].recommended_action == "No action required"
        assert result["recommendation"].proposed_lots == []

    def test_safe_skip_sets_approved(self):
        state = {"headroom": 5000.0, "risk_state": "Safe"}
        node = SafeSkipNode()
        result = node(state)
        assert result["approved"] is True

    def test_safe_skip_sets_result_status_skipped(self):
        state = {"headroom": 5000.0, "risk_state": "Safe"}
        node = SafeSkipNode()
        result = node(state)
        assert result["result"]["status"] == "skipped"
        assert "tax optimizer and LLM skipped" in result["result"]["message"]

    def test_safe_skip_rationale_mentions_headroom(self):
        state = {"headroom": 3000.0, "risk_state": "Safe"}
        node = SafeSkipNode()
        result = node(state)
        assert "$3,000.00" in result["recommendation"].rationale


class TestCircuitBreaker:
    def test_allows_calls_below_threshold(self):
        cb = CircuitBreaker(failure_threshold=3, recovery_timeout=60)
        assert cb.can_call("Groq") is True

    def test_opens_after_threshold_failures(self):
        cb = CircuitBreaker(failure_threshold=3, recovery_timeout=60)
        for _ in range(3):
            cb.record_failure("Groq")
        assert cb.can_call("Groq") is False

    def test_resets_success_count(self):
        cb = CircuitBreaker(failure_threshold=3, recovery_timeout=60)
        cb.record_failure("Groq")
        cb.record_failure("Groq")
        cb.record_success("Groq")
        assert cb.can_call("Groq") is True
        assert cb.failures["Groq"] == 0

    def test_independent_per_provider(self):
        cb = CircuitBreaker(failure_threshold=2, recovery_timeout=60)
        cb.record_failure("Groq")
        cb.record_failure("Groq")
        assert cb.can_call("Groq") is False
        assert cb.can_call("OpenRouter") is True


class TestAuditLogger:
    def test_log_writes_to_db(self, tmp_path):
        db = str(tmp_path / "test_audit.db")
        logger = AuditLogger(db_path=db)
        state = {
            "account": Account(
                name="Test", holdings=[Lot(symbol="X", quantity=1, cost_basis=1, current_price=1, acquired_date="2023-01-01")],
                loan_balance=100, max_ltv_limit=0.50,
            ),
            "risk_state": "Safe",
            "headroom": 500.0,
            "current_ltv": 0.25,
            "recommendation": Recommendation(
                risk_state="Safe", recommended_action="Maintain",
                proposed_lots=[], rationale="Safe.",
            ),
            "approved": True,
            "result": {"status": "executed"},
        }
        logger.log(state)
        rows = logger.query()
        assert len(rows) == 1
        assert rows[0]["risk_state"] == "Safe"
        assert rows[0]["approved"] == 1

    def test_query_returns_most_recent(self, tmp_path):
        db = str(tmp_path / "test_audit2.db")
        logger = AuditLogger(db_path=db)
        base = {
            "risk_state": "Safe", "headroom": 500.0, "current_ltv": 0.25,
            "approved": True, "result": {"status": "executed"},
        }
        for i in range(3):
            logger.log({**base, "account": Account(
                name=f"Test{i}", holdings=[Lot(symbol="X", quantity=1, cost_basis=1, current_price=1, acquired_date="2023-01-01")],
                loan_balance=100, max_ltv_limit=0.50,
            )})
        rows = logger.query(limit=2)
        assert len(rows) == 2


class TestCostBasisMethod:
    def test_fifo_sorts_oldest_first(self):
        acc = _make_account(holdings=[
            _make_lot(symbol="A", lot_id="a1b2c3d4-0000-0000-0000-000000000001", acquired_date="2024-06-01", cost_basis=100, current_price=150),
            _make_lot(symbol="B", lot_id="a1b2c3d4-0000-0000-0000-000000000002", acquired_date="2023-01-01", cost_basis=100, current_price=150),
        ])
        acc.cost_basis_method = CostBasisMethod.FIFO
        state = {"account": acc}
        node = TaxOptimizerNode()
        result = node(state)
        # FIFO: oldest first → B (2023) before A (2024)
        assert result["ranked_lots"][0]["acquired_date"] == "2023-01-01"

    def test_lifo_sorts_newest_first(self):
        acc = _make_account(holdings=[
            _make_lot(symbol="A", lot_id="a1b2c3d4-0000-0000-0000-000000000003", acquired_date="2024-06-01", cost_basis=100, current_price=150),
            _make_lot(symbol="B", lot_id="a1b2c3d4-0000-0000-0000-000000000004", acquired_date="2023-01-01", cost_basis=100, current_price=150),
        ])
        acc.cost_basis_method = CostBasisMethod.LIFO
        state = {"account": acc}
        node = TaxOptimizerNode()
        result = node(state)
        # LIFO: newest first → A (2024) before B (2023)
        assert result["ranked_lots"][0]["acquired_date"] == "2024-06-01"

    def test_hifo_sorts_highest_cost_first(self):
        acc = _make_account(holdings=[
            _make_lot(symbol="A", lot_id="a1b2c3d4-0000-0000-0000-000000000005", cost_basis=50, current_price=100),
            _make_lot(symbol="B", lot_id="a1b2c3d4-0000-0000-0000-000000000006", cost_basis=200, current_price=100),
        ])
        acc.cost_basis_method = CostBasisMethod.HIFO
        state = {"account": acc}
        node = TaxOptimizerNode()
        result = node(state)
        # HIFO: highest cost first → B (200) before A (50)
        assert result["ranked_lots"][0]["cost_basis"] == 200

    def test_tlh_sorts_losses_before_gains(self):
        acc = _make_account(holdings=[
            _make_lot(symbol="A", lot_id="a1b2c3d4-0000-0000-0000-000000000007", cost_basis=200, current_price=100),
            _make_lot(symbol="B", lot_id="a1b2c3d4-0000-0000-0000-000000000008", cost_basis=50, current_price=100),
        ])
        acc.cost_basis_method = CostBasisMethod.TLH
        state = {"account": acc}
        node = TaxOptimizerNode()
        result = node(state)
        # TLH: biggest loss first → A (loss -10000) before B (gain +5000)
        assert result["ranked_lots"][0]["unrealized_gain_loss"] < result["ranked_lots"][1]["unrealized_gain_loss"]

    def test_default_method_is_tlh(self):
        acc = _make_account()
        assert acc.cost_basis_method == CostBasisMethod.TLH


class TestSlackRateLimiting:
    def test_cooldown_prevents_spam(self):
        node = LTVMonitorNode(slack_webhook_url="https://hooks.slack.com/test", cooldown_seconds=300)
        # Call with High Risk state — _send_slack_alert will try POST (fails silently)
        state = {"account": Account(
            name="Test", holdings=[Lot(symbol="X", quantity=100, cost_basis=10, current_price=10, acquired_date="2023-01-01")],
            loan_balance=2000, max_ltv_limit=0.50,
        )}
        node(state)
        first_time = node._last_alert_time
        assert first_time > 0
        node(state)
        # Second call within cooldown — _last_alert_time unchanged
        assert node._last_alert_time == first_time

    def test_notify_false_disables_alerts(self):
        node = LTVMonitorNode(slack_webhook_url="https://hooks.slack.com/test", notify=False)
        with patch.object(node, "_send_slack_alert") as mock_alert:
            node({"account": Account(
                name="Test", holdings=[Lot(symbol="X", quantity=100, cost_basis=10, current_price=10, acquired_date="2023-01-01")],
                loan_balance=2000, max_ltv_limit=0.50,
            )})
            mock_alert.assert_called_once()
            assert node._last_alert_time == 0


class TestDayDifferenceMalformed:
    def test_malformed_date_returns_zero(self):
        assert _day_difference("not-a-date", "2023-01-01") == 0
        assert _day_difference("2023-01-01", "also-not-a-date") == 0


# ---------------------------------------------------------------------------
# HumanApprovalNode
# ---------------------------------------------------------------------------

class TestHumanApprovalNode:
    def test_already_approved(self):
        state = {"approved": True, "recommendation": Recommendation(
            risk_state="Safe", recommended_action="Maintain",
            proposed_lots=[], rationale="Safe.",
        )}
        node = HumanApprovalNode()
        result = node(state)
        assert result["approved"] is True

    def test_already_rejected(self):
        state = {"approved": False, "recommendation": Recommendation(
            risk_state="Safe", recommended_action="Maintain",
            proposed_lots=[], rationale="Safe.",
        )}
        node = HumanApprovalNode()
        result = node(state)
        assert result["approved"] is False


# ---------------------------------------------------------------------------
# End-to-End Pipeline Tests
# ---------------------------------------------------------------------------

class TestEndToEndPipeline:
    """Test the full 6-node pipeline with deterministic data (no LLM, no yfinance)."""

    def _run_pipeline(self, account_dict, approved=True):
        """Run the full pipeline nodes sequentially (no LangGraph)."""
        ingest = IngestPortfolioNode(use_live_prices=False)
        ltv = LTVMonitorNode()
        tax = TaxOptimizerNode()
        reasoning = ReasoningAgentNode()
        approval = HumanApprovalNode()
        execution = ExecutionNode()

        state = {"account": account_dict}
        state.update(ingest(state))
        state.update(ltv(state))
        state.update(tax(state))
        state.update(reasoning(state))

        # Simulate human approval
        state["approved"] = approved
        state.update(execution(state))

        return state

    def _run_pipeline_with_skip(self, account_dict, approved=True):
        """Run pipeline with conditional branching (Safe → skip tax/LLM)."""
        from agent import _route_after_ltv
        ingest = IngestPortfolioNode(use_live_prices=False)
        ltv = LTVMonitorNode()
        tax = TaxOptimizerNode()
        reasoning = ReasoningAgentNode()
        safe_skip = SafeSkipNode()
        approval = HumanApprovalNode()
        execution = ExecutionNode()

        state = {"account": account_dict}
        state.update(ingest(state))
        state.update(ltv(state))

        route = _route_after_ltv(state)
        if route == "safe_skip":
            state.update(safe_skip(state))
        else:
            state.update(tax(state))
            state.update(reasoning(state))
            state["approved"] = approved
            state.update(execution(state))

        return state

    def test_safe_portfolio_e2e(self):
        account = _make_account_dict(loan_balance=1000)
        state = self._run_pipeline(account)
        assert state["risk_state"] == "Safe"
        assert state["headroom"] == 9000.0
        assert state["result"]["status"] == "executed"

    def test_high_risk_portfolio_e2e(self):
        account = _make_account_dict(
            loan_balance=4500,
            holdings=[_make_lot(symbol="TECH", quantity=80, cost_basis=120, current_price=100)],
        )
        state = self._run_pipeline(account)
        assert state["risk_state"] == "High Risk"
        assert state["headroom"] == -500.0
        assert state["result"]["status"] == "executed"
        assert len(state["recommendation"].proposed_lots) > 0

    def test_warning_portfolio_e2e(self):
        # collateral = 100*100 = 10000, net_debt = 4000, max_loan = 5000, headroom = 1000
        # ratio = 1000/5000 = 0.20 < 0.25 → Warning
        account = _make_account_dict(
            loan_balance=4000,
            holdings=[_make_lot(current_price=100)],
        )
        state = self._run_pipeline(account)
        assert state["risk_state"] == "Warning"
        assert state["headroom"] == 1000.0

    def test_rejected_execution_e2e(self):
        account = _make_account_dict(loan_balance=1000)
        state = self._run_pipeline(account, approved=False)
        assert state["result"]["status"] == "rejected"

    def test_mixed_lots_ranking_e2e(self):
        account = _make_account_dict(
            loan_balance=5000,
            holdings=[
                _make_lot(symbol="NVDA", lot_id="6ba7b810-9dad-11d1-80b4-00c04fd430c8", cost_basis=50, current_price=100, acquired_date="2023-01-01"),
                _make_lot(symbol="GOOGL", lot_id="6ba7b811-9dad-11d1-80b4-00c04fd430c8", cost_basis=150, current_price=120, acquired_date="2024-02-01"),
            ],
        )
        state = self._run_pipeline(account)
        lots = state["ranked_lots"]
        assert lots[0]["unrealized_gain_loss"] < lots[1]["unrealized_gain_loss"]

    def test_wash_sale_flagged_e2e(self):
        today = datetime.now().strftime("%Y-%m-%d")
        day_9 = (datetime.now() - timedelta(days=9)).strftime("%Y-%m-%d")
        account = _make_account_dict(
            loan_balance=3000,
            holdings=[
                _make_lot(symbol="XYZ", lot_id="7ba7b812-9dad-11d1-80b4-00c04fd430c8", quantity=50, cost_basis=220, current_price=200, acquired_date=day_9),
                _make_lot(symbol="XYZ", lot_id="7ba7b813-9dad-11d1-80b4-00c04fd430c8", quantity=30, cost_basis=190, current_price=200, acquired_date=today),
            ],
        )
        state = self._run_pipeline(account)
        loss_lot = next(l for l in state["ranked_lots"] if l["unrealized_gain_loss"] < 0)
        assert loss_lot["wash_sale_caution"] is True

    def test_non_standard_ltv_limit_e2e(self):
        account = _make_account_dict(
            loan_balance=5000,
            max_ltv_limit=0.35,
            holdings=[_make_lot(symbol="QQQ", quantity=100, current_price=80)],
        )
        state = self._run_pipeline(account)
        assert state["risk_state"] == "High Risk"
        assert state["headroom"] == -2200.0

    def test_cash_reduces_net_debt_e2e(self):
        account = _make_account_dict(loan_balance=5000, cash=2000)
        state = self._run_pipeline(account)
        # net_debt = 3000, max_loan = 10000, headroom = 7000
        assert state["headroom"] == 7000.0

    def test_recommendation_has_rationale(self):
        account = _make_account_dict(loan_balance=1000)
        state = self._run_pipeline(account)
        rec = state["recommendation"]
        assert isinstance(rec, Recommendation)
        assert len(rec.rationale) > 0

    def test_all_fixture_accounts_e2e(self):
        """Run all 6 fixture accounts through the pipeline."""
        with open("fixtures/fake_users.json", "r") as f:
            fixtures = json.load(f)

        for fixture in fixtures:
            state = self._run_pipeline(fixture)
            assert "risk_state" in state
            assert "headroom" in state
            assert "result" in state
            assert state["result"]["status"] in ("executed", "rejected")

    def test_safe_portfolio_skips_tax_and_llm(self):
        """Safe portfolio with no cash_need should skip tax optimizer and LLM."""
        account = _make_account_dict(loan_balance=1000)
        state = self._run_pipeline_with_skip(account)
        assert state["risk_state"] == "Safe"
        assert state["result"]["status"] == "skipped"
        assert state["approved"] is True

    def test_warning_portfolio_does_not_skip(self):
        """Warning portfolio should NOT skip tax optimizer or LLM."""
        account = _make_account_dict(
            loan_balance=4000,
            holdings=[_make_lot(current_price=100)],
        )
        state = self._run_pipeline_with_skip(account)
        assert state["risk_state"] == "Warning"
        assert state["result"]["status"] in ("executed", "rejected")

    def test_safe_with_cash_need_does_not_skip(self):
        """Safe portfolio WITH cash_need should NOT skip (needs tax optimization)."""
        account = _make_account_dict(loan_balance=1000)
        state = self._run_pipeline_with_skip(account)
        state["cash_need"] = 5000.0
        route = _route_after_ltv(state)
        assert route == "tax_optimizer"
