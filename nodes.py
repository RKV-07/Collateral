import json
import logging
import os
from datetime import datetime
from typing import TypedDict, List, Dict, Any, Optional, Union
from uuid import UUID, uuid4
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

# --- Pydantic Data & Schema Models ---

class Lot(BaseModel):
    lot_id: UUID = Field(default_factory=uuid4)
    symbol: str
    quantity: float = Field(gt=0)
    cost_basis: float = Field(ge=0)
    current_price: float = Field(ge=0)
    acquired_date: str

class Account(BaseModel):
    account_id: UUID = Field(default_factory=uuid4)
    name: str
    loan_balance: float = Field(ge=0)
    max_ltv_limit: float = Field(gt=0, le=1, default=0.50)
    cash: float = Field(ge=0, default=0.0)
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
    resulting_ltv_if_executed: Optional[float] = None
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


def _day_difference(date_str1: str, date_str2: str) -> int:
    """Absolute day difference between two ISO date strings."""
    d1 = datetime.fromisoformat(date_str1)
    d2 = datetime.fromisoformat(date_str2)
    return abs((d1 - d2).days)


class TaxOptimizerNode:
    """Node 3 — TaxOptimizerNode
    Solves: tax-inefficient rebalancing.
    Computes unrealized gain/loss per lot, wash-sale risk, and ranks them (biggest loss first).
    Pure deterministic Python math — no LLM.
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

        # Deterministic wash-sale check: same symbol acquired within 30 days
        for lot_dict in ranked:
            is_loss = lot_dict["unrealized_gain_loss"] < 0
            lot_dict["wash_sale_caution"] = is_loss and any(
                other["lot_id"] != lot_dict["lot_id"]
                and other["symbol"] == lot_dict["symbol"]
                and _day_difference(lot_dict["acquired_date"], other["acquired_date"]) <= 30
                for other in ranked
            )

        # Sort ascending by unrealized gain/loss (largest loss first)
        ranked.sort(key=lambda x: x["unrealized_gain_loss"])

        return {"ranked_lots": ranked}


SYSTEM_PROMPT = """You are the Reasoning node in a deterministic financial-agent pipeline called Collateral.

Your ONLY job: synthesize the risk_state, headroom, and ranked_lots values you are given into a structured Recommendation. You do not have access to markets, cannot execute trades, and must not invent numbers.

Hard rules:
1. Do NOT recompute LTV, headroom, collateral value, or gain/loss — those are already computed upstream and correct. Use them as given.
2. Do NOT recompute wash_sale_caution — it is already computed deterministically per lot. Just reflect it accurately in your rationale; do not override it or guess about it.
3. proposed_lots must only include lots that were actually provided in ranked_lots — never invent a lot_id.
4. If risk_state is "High Risk", recommended_action must address closing the deficit — do not recommend "maintain current positions".
5. If risk_state is "Safe", proposed_lots should be an empty list unless the account holder explicitly needs liquidity.
6. rationale must be 2-4 plain-English sentences, no jargon without a one-line explanation, and must explicitly note that this is not licensed financial or tax advice.
7. Output must strictly conform to the Recommendation schema you were bound with — no extra fields, no prose outside the schema.
8. If asked to explain resulting LTV after a hypothetical sale, do not compute new LTV values yourself — collateral value decreases by the amount sold (shrinking-collateral feedback loop), which is easy to get wrong. Only speak in terms of the given risk_state/headroom, or explicitly state that a precise pro-forma figure requires re-running the optimizer.
9. When only one lot of a symbol currently exists, still note that a wash-sale risk could arise if the user repurchases the same or a substantially identical security within 30 days after this sale — that risk cannot be evaluated from current data alone.
"""


class ReasoningAgentNode:
    """Node 4 — ReasoningAgentNode
    Solves: synthesizes risk_state, headroom, and ranked_lots into a recommendation.
    Uses init_chat_model and with_structured_output(Recommendation).
    This is the ONLY node allowed to invoke an LLM.
    """
    def __init__(self, model_name: str = "gemini-2.5-flash", temperature: float = 0.1):
        self.model_name = model_name
        self.temperature = temperature
        self.llm = None
        self.structured_llm = None
        self.fallback_llm = None
        self.fallback_structured_llm = None
        self.poolside_llm = None
        self.poolside_structured_llm = None

        from langchain.chat_models import init_chat_model

        # Primary: Gemini
        if "GEMINI_API_KEY" in os.environ and "GOOGLE_API_KEY" not in os.environ:
            os.environ["GOOGLE_API_KEY"] = os.environ["GEMINI_API_KEY"]
        api_key = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
        if api_key:
            try:
                self.llm = init_chat_model(
                    self.model_name,
                    model_provider="google_genai",
                    temperature=self.temperature,
                    max_retries=2,
                    max_tokens=2048,
                    thinking_budget=0,
                )
                self.structured_llm = self.llm.with_structured_output(
                    Recommendation, method="function_calling"
                )
            except Exception as e:
                logger.error("[ReasoningAgentNode] Gemini init failed: %s", str(e))

        # Fallback 1: OpenRouter (google/gemma-4-26b-a4b-it:free — slug verified 2026-07-26)
        # NOTE: Free tier ~20 RPM / 200 RPD. If invoke() fails during heavy dev iteration, check quota first.
        openrouter_key = os.environ.get("OPENROUTER_API_KEY")
        if openrouter_key:
            try:
                self.fallback_llm = init_chat_model(
                    "google/gemma-4-26b-a4b-it:free",  # slug verified against openrouter.ai on 2026-07-26
                    model_provider="openai",
                    temperature=self.temperature,
                    base_url="https://openrouter.ai/api/v1",
                    api_key=openrouter_key,
                    max_retries=2,
                    max_tokens=2048,
                )
                self.fallback_structured_llm = self.fallback_llm.with_structured_output(
                    Recommendation, method="function_calling"
                )
            except Exception as e:
                logger.error("[ReasoningAgentNode] OpenRouter init failed: %s", str(e))

        # Fallback 2: Poolside
        poolside_key = os.environ.get("POOLSIDE_API_KEY")
        if poolside_key:
            try:
                self.poolside_llm = init_chat_model(
                    "poolside/laguna-s-2.1",
                    model_provider="openai",
                    temperature=self.temperature,
                    base_url="https://inference.poolside.ai/v1",
                    api_key=poolside_key,
                    max_retries=2,
                    max_tokens=2048,
                    extra_body={"thinking": False},
                )
                self.poolside_structured_llm = self.poolside_llm.with_structured_output(
                    Recommendation, method="function_calling"
                )
            except Exception as e:
                logger.error("[ReasoningAgentNode] Poolside init failed: %s", str(e))

        if not any([self.structured_llm, self.fallback_structured_llm, self.poolside_structured_llm]):
            logger.warning("[ReasoningAgentNode] No LLM providers initialized — will use deterministic fallback only")

    def __call__(self, state: Dict[str, Any]) -> Dict[str, Any]:
        risk_state = state.get("risk_state", "Safe")
        headroom = state.get("headroom", 0.0)
        ranked_lots = state.get("ranked_lots", [])
        valid_lot_ids = {str(lot["lot_id"]) for lot in ranked_lots}

        user_data = (
            f"risk_state: {risk_state}\n"
            f"headroom_dollars: {headroom:.2f}\n"
            f"ranked_lots (losses first, wash_sale_caution precomputed):\n"
            f"{json.dumps(ranked_lots, indent=2, default=str)}"
        )
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_data},
        ]

        recommendation = None

        for label, structured_llm in [
            ("Gemini", self.structured_llm),
            ("OpenRouter", self.fallback_structured_llm),
            ("Poolside", self.poolside_structured_llm),
        ]:
            if recommendation is not None or structured_llm is None:
                continue
            try:
                result = structured_llm.invoke(messages)
                if not isinstance(result, Recommendation):
                    continue
                hallucinated = [p for p in result.proposed_lots if str(p.lot_id) not in valid_lot_ids]
                if hallucinated:
                    logger.error("[ReasoningAgentNode] %s returned unknown lot_id(s) — discarding", label)
                    continue
                recommendation = result
                logger.info("[ReasoningAgentNode] %s produced valid recommendation", label)
            except Exception as e:
                logger.warning("[ReasoningAgentNode] %s invoke failed: %s", label, str(e))

        # Fallback structured calculation if LLM call is unavailable or fails
        if recommendation is None:
            proposed = []
            if headroom < 0:
                account_obj = state.get("account")
                max_ltv_limit = account_obj.max_ltv_limit if isinstance(account_obj, Account) else float(account_obj.get("max_ltv_limit", 0.50)) if isinstance(account_obj, dict) else 0.50
                deficit = abs(headroom)
                needed_proceeds = deficit / (1 - max_ltv_limit)
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
                            wash_sale_caution=lot.get("wash_sale_caution", False)
                        )
                    )
                    accumulated += sell_qty * lot["current_price"]

                # Compute resulting LTV after proposed sales (accounts for shrinking collateral)
                lot_price_map = {str(lot["lot_id"]): lot["current_price"] for lot in ranked_lots}
                total_proceeds = sum(p.quantity * lot_price_map.get(str(p.lot_id), 0) for p in proposed)
                collateral_after = sum(lot["quantity"] * lot["current_price"] for lot in ranked_lots) - total_proceeds
                loan_after = (account_obj.loan_balance if isinstance(account_obj, Account) else float(account_obj.get("loan_balance", 0))) - total_proceeds
                cash_after = (account_obj.cash if isinstance(account_obj, Account) else float(account_obj.get("cash", 0))) + total_proceeds
                net_debt_after = loan_after - cash_after
                resulting_ltv = (net_debt_after / collateral_after) if collateral_after > 0 else 0.0

                rec_action = "Liquidate tax-loss holdings to restore borrowing headroom."
                rationale = f"Account is in {risk_state} with a ${deficit:.2f} deficit. Proposed selling losses first to maximize tax harvesting."
            elif risk_state == "Warning":
                resulting_ltv = None
                rec_action = "Monitor portfolio leverage. Optional minor deleveraging."
                rationale = f"Headroom is low (${headroom:.2f}). No immediate liquidation enforced."
            else:
                resulting_ltv = None
                rec_action = "Maintain current positions."
                rationale = f"Portfolio is Safe with ${headroom:.2f} in headroom."

            recommendation = Recommendation(
                risk_state=risk_state,
                recommended_action=rec_action,
                proposed_lots=proposed,
                resulting_ltv_if_executed=resulting_ltv,
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
        rec_data = rec.model_dump(mode="json") if isinstance(rec, Recommendation) else rec

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
