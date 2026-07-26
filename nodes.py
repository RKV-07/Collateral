import json
import logging
import os
from typing import TypedDict, List, Dict, Any, Optional, Union
from uuid import UUID, uuid4
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

# --- Pydantic Data & Schema Models ---

class Lot(BaseModel):
    lot_id: UUID = Field(default_factory=uuid4)
    symbol: str
    quantity: float
    cost_basis: float
    current_price: float
    acquired_date: str

class Account(BaseModel):
    account_id: UUID = Field(default_factory=uuid4)
    name: str
    loan_balance: float
    max_ltv_limit: float = 0.50
    cash: float = 0.0
    holdings: List[Lot]

class LotProposal(BaseModel):
    lot_id: UUID
    quantity: float
    realized_gain_loss: float
    wash_sale_caution: bool = Field(default=False)

class Recommendation(BaseModel):
    risk_state: str
    recommended_action: str
    proposed_lots: List[LotProposal]
    rationale: str

# Shared State Definition
class AgentState(TypedDict, total=False):
    account: Union[Account, Dict[str, Any]]  # set by node 1 (validated Account model)
    collateral_value: float                   # set by node 2
    current_ltv: float                        # set by node 2
    headroom: float                           # set by node 2
    risk_state: str                           # "Safe" | "Warning" | "High Risk" — node 2
    ranked_lots: List[Dict[str, Any]]         # set by node 3
    recommendation: Recommendation            # set by node 4 (Pydantic model)
    approved: bool                            # set by node 5
    result: Dict[str, Any]                    # set by node 6


class IngestPortfolioNode:
    """Node 1 — IngestPortfolioNode
    Solves: fragmented asset liquidity.
    Normalizes raw account JSON and validates into a Pydantic Account model.
    A malformed fixture fails loudly at ingest instead of downstream math.
    """
    def __init__(self, source_path: str = "fixtures/fake_users.json"):
        self.source_path = source_path

    def __call__(self, state: Dict[str, Any]) -> Dict[str, Any]:
        if "account" in state and state["account"]:
            raw_data = state["account"]
            if isinstance(raw_data, Account):
                account_model = raw_data
            elif isinstance(raw_data, dict):
                account_model = Account.model_validate(raw_data)
            else:
                account_model = Account.model_validate(raw_data)
        else:
            if not os.path.exists(self.source_path):
                raise FileNotFoundError(f"Source file not found: {self.source_path}")
            with open(self.source_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            raw_data = data[0] if isinstance(data, list) else data
            account_model = Account.model_validate(raw_data)

        return {"account": account_model}


class LTVMonitorNode:
    """Node 2 — LTVMonitorNode
    Solves: manual LTV tracking.
    Computes collateral_value, current_ltv, headroom, and risk_state.
    Pure deterministic Python math.
    """
    def __init__(self):
        pass

    def __call__(self, state: Dict[str, Any]) -> Dict[str, Any]:
        account = state.get("account")
        if isinstance(account, Account):
            holdings = account.holdings
            loan_balance = account.loan_balance
            cash = account.cash
            max_ltv_limit = account.max_ltv_limit
        else:
            holdings = account.get("holdings", [])
            loan_balance = float(account.get("loan_balance", 0.0))
            cash = float(account.get("cash", 0.0))
            max_ltv_limit = float(account.get("max_ltv_limit", 0.50))

        net_debt = loan_balance - cash

        collateral_value = sum(
            lot.quantity * lot.current_price
            if isinstance(lot, Lot)
            else float(lot.get("quantity", 0.0)) * float(lot.get("current_price", 0.0))
            for lot in holdings
        )

        current_ltv = (net_debt / collateral_value) if collateral_value > 0 else 0.0
        max_loan_allowed = collateral_value * max_ltv_limit
        headroom = max_loan_allowed - net_debt

        # Classification logic:
        # Safe: headroom / max_loan_allowed >= 0.25
        # Warning: 0 <= ratio < 0.25
        # High Risk: headroom < 0
        ratio = (headroom / max_loan_allowed) if max_loan_allowed > 0 else 0.0

        if headroom < 0:
            risk_state = "High Risk"
        elif 0 <= ratio < 0.25:
            risk_state = "Warning"
        else:
            risk_state = "Safe"

        return {
            "collateral_value": collateral_value,
            "current_ltv": current_ltv,
            "headroom": headroom,
            "risk_state": risk_state
        }


class TaxOptimizerNode:
    """Node 3 — TaxOptimizerNode
    Solves: tax-inefficient rebalancing.
    Computes unrealized gain/loss per lot and ranks them (biggest loss first).
    Pure deterministic Python math.
    """
    def __init__(self):
        pass

    def __call__(self, state: Dict[str, Any]) -> Dict[str, Any]:
        account = state.get("account")
        if isinstance(account, Account):
            holdings = account.holdings
        else:
            holdings = account.get("holdings", [])

        ranked = []

        for lot in holdings:
            if isinstance(lot, Lot):
                qty = lot.quantity
                cost = lot.cost_basis
                price = lot.current_price
                lot_dict = lot.model_dump()
            else:
                qty = float(lot.get("quantity", 0.0))
                cost = float(lot.get("cost_basis", 0.0))
                price = float(lot.get("current_price", 0.0))
                lot_dict = dict(lot)

            current_val = qty * price
            cost_total = qty * cost
            unrealized_gain_loss = current_val - cost_total

            lot_dict["unrealized_gain_loss"] = unrealized_gain_loss
            lot_dict["unrealized_gain_loss_per_share"] = price - cost
            ranked.append(lot_dict)

        # Sort ascending by unrealized gain/loss (largest loss first)
        ranked.sort(key=lambda x: x["unrealized_gain_loss"])

        return {"ranked_lots": ranked}


class ReasoningAgentNode:
    """Node 4 — ReasoningAgentNode
    Solves: synthesizes risk_state, headroom, and ranked_lots into a recommendation.
    Uses init_chat_model and with_structured_output(Recommendation).
    This is the ONLY node allowed to invoke an LLM.
    """
    def __init__(self, model_name: str = "gemini-2.5-flash", temperature: float = 0.2):
        self.model_name = model_name
        self.temperature = temperature
        self.llm = None
        self.structured_llm = None

        try:
            from langchain.chat_models import init_chat_model
            # Synchronize GOOGLE_API_KEY environment variable
            if "GEMINI_API_KEY" in os.environ and "GOOGLE_API_KEY" not in os.environ:
                os.environ["GOOGLE_API_KEY"] = os.environ["GEMINI_API_KEY"]

            api_key = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
            if api_key:
                self.llm = init_chat_model(
                    self.model_name,
                    model_provider="google_genai",
                    temperature=self.temperature,
                )
                self.structured_llm = self.llm.with_structured_output(Recommendation)
            else:
                logger.warning("[ReasoningAgentNode] No GOOGLE_API_KEY/GEMINI_API_KEY found — falling back to deterministic recommendation")
        except Exception as e:
            logger.error("[ReasoningAgentNode] LLM init failed: %r", e)
            self.llm = None
            self.structured_llm = None

    def __call__(self, state: Dict[str, Any]) -> Dict[str, Any]:
        risk_state = state.get("risk_state", "Safe")
        headroom = state.get("headroom", 0.0)
        ranked_lots = state.get("ranked_lots", [])

        prompt_text = (
            f"You are a Tax-Minimized Liquidity Assistant.\n"
            f"Risk State: {risk_state}\n"
            f"Headroom ($): {headroom:.2f}\n"
            f"Ranked Tax Lots (Losses first):\n{json.dumps(ranked_lots, indent=2, default=str)}\n\n"
            f"Synthesize risk state, headroom, and tax-loss lots into a structured Recommendation."
        )

        recommendation: Optional[Recommendation] = None

        if self.structured_llm is not None:
            try:
                result = self.structured_llm.invoke(prompt_text)
                if isinstance(result, Recommendation):
                    recommendation = result
            except Exception as e:
                logger.error("[ReasoningAgentNode] LLM invoke failed: %r", e)
                recommendation = None

        # Fallback structured calculation if LLM call is unavailable or fails
        if recommendation is None:
            proposed = []
            if headroom < 0:
                deficit = abs(headroom)
                needed_proceeds = deficit / 0.50
                accumulated = 0.0
                for lot in ranked_lots:
                    if accumulated >= needed_proceeds:
                        break
                    sell_qty = min(lot["quantity"], (needed_proceeds - accumulated) / lot["current_price"])
                    realized_gl = sell_qty * lot["unrealized_gain_loss_per_share"]
                    proposed.append(
                        LotProposal(
                            lot_id=str(lot["lot_id"]),
                            quantity=round(sell_qty, 4),
                            realized_gain_loss=round(realized_gl, 2),
                            wash_sale_caution=False
                        )
                    )
                    accumulated += sell_qty * lot["current_price"]

                rec_action = "Liquidate tax-loss holdings to restore borrowing headroom."
                rationale = f"Account is in {risk_state} with a ${deficit:.2f} deficit. Proposed selling losses first to maximize tax harvesting."
            elif risk_state == "Warning":
                rec_action = "Monitor portfolio leverage. Optional minor deleveraging."
                rationale = f"Headroom is low (${headroom:.2f}). No immediate liquidation enforced."
            else:
                rec_action = "Maintain current positions."
                rationale = f"Portfolio is Safe with ${headroom:.2f} in headroom."

            recommendation = Recommendation(
                risk_state=risk_state,
                recommended_action=rec_action,
                proposed_lots=proposed,
                rationale=rationale
            )

        return {"recommendation": recommendation}


class HumanApprovalNode:
    """Node 5 — HumanApprovalNode
    Solves: human-in-the-loop control.
    Uses LangGraph's interrupt() to pause graph execution and surface state["recommendation"].
    On resume, sets state["approved"].
    """
    def __init__(self):
        pass

    def __call__(self, state: Dict[str, Any]) -> Dict[str, Any]:
        if "approved" in state and state["approved"] is not None:
            return {"approved": bool(state["approved"])}

        rec = state.get("recommendation")
        rec_data = rec.model_dump() if isinstance(rec, Recommendation) else rec

        try:
            from langgraph.types import interrupt
            human_decision = interrupt(rec_data)
            approved = bool(human_decision)
        except ImportError:
            approved = state.get("approved", True)

        return {"approved": approved}


class ExecutionNode:
    """Node 6 — ExecutionNode
    Solves: closing the loop.
    Logs execution intention if approved, or rejection if denied.
    """
    def __init__(self, logger=None):
        self.logger = logger if logger is not None else print

    def __call__(self, state: Dict[str, Any]) -> Dict[str, Any]:
        approved = state.get("approved", False)
        rec = state.get("recommendation")
        rec_action = rec.recommended_action if isinstance(rec, Recommendation) else (rec.get("recommended_action") if isinstance(rec, dict) else str(rec))
        proposed = [p.model_dump() for p in rec.proposed_lots] if isinstance(rec, Recommendation) else (rec.get("proposed_lots", []) if isinstance(rec, dict) else [])

        if approved:
            self.logger(f"[EXECUTION] APPROVED: Would execute trades for action: {rec_action}")
            result = {
                "status": "executed",
                "message": "Simulated trade order routed to brokerage queue.",
                "action": rec_action,
                "proposed_lots": proposed
            }
        else:
            self.logger("[EXECUTION] REJECTED: Human supervisor rejected recommendation. No trades routed.")
            result = {
                "status": "rejected",
                "message": "Execution cancelled by human supervisor."
            }

        return {"result": result}
