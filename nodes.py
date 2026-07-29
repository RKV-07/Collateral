import json
import logging
import os
from datetime import datetime
from typing import TypedDict, List, Dict, Any, Optional, Union
from uuid import UUID, uuid4
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

# Optional yfinance import — falls back to static prices if unavailable
try:
    import yfinance as yf
    YF_AVAILABLE = True
except ImportError:
    YF_AVAILABLE = False
    logger.warning("yfinance not installed — using static prices from fixtures. Install with: pip install yfinance")

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
    cash_need: float                          # optional: cash withdrawal request
    holding_period_days: List[Dict[str, Any]] # set by node 3 (lot_id → days held)
    sector_concentration: Dict[str, float]    # set by node 3 (sector → % of portfolio)
    concentration_warning: str                # set by node 3 (warning message if any)
    recommendation: Recommendation            # set by node 4 (Pydantic model)
    approved: bool                            # set by node 5
    result: Dict[str, Any]                    # set by node 6


class IngestPortfolioNode:
    """Node 1 — IngestPortfolioNode
    Solves: fragmented asset liquidity.
    Normalizes raw account JSON and validates into a Pydantic Account model.
    If yfinance is installed, fetches real-time market prices for each holding.
    A malformed fixture fails loudly at ingest instead of downstream math.
    """
    def __init__(self, source_path: str = "fixtures/fake_users.json", use_live_prices: bool = True):
        self.source_path = source_path
        self.use_live_prices = use_live_prices

    def _fetch_live_prices(self, holdings: List[Dict[str, Any]]) -> Dict[str, float]:
        """Fetch real-time prices via yfinance for a list of holdings.
        Returns {symbol: price} dict. Falls back to empty dict on failure.
        """
        if not YF_AVAILABLE:
            return {}

        symbols = list({h.get("symbol") for h in holdings if h.get("symbol")})
        if not symbols:
            return {}

        prices = {}
        for symbol in symbols:
            try:
                ticker = yf.Ticker(symbol)
                info = ticker.fast_info
                price = getattr(info, "last_price", None) or getattr(info, "previous_close", None)
                if price and price > 0:
                    prices[symbol] = float(price)
                    logger.info("[IngestPortfolioNode] Fetched live price for %s: $%.2f", symbol, price)
                else:
                    logger.warning("[IngestPortfolioNode] No price data for %s — using static price", symbol)
            except Exception as e:
                logger.warning("[IngestPortfolioNode] yfinance failed for %s: %s", symbol, str(e))

        return prices

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

        # Fetch live prices and update holdings
        holdings_dicts = [h.model_dump() if isinstance(h, Lot) else h for h in account_model.holdings]
        live_prices = self._fetch_live_prices(holdings_dicts) if self.use_live_prices else {}

        if live_prices:
            updated_holdings = []
            for lot in account_model.holdings:
                lot_dict = lot.model_dump() if isinstance(lot, Lot) else dict(lot)
                symbol = lot_dict.get("symbol", "")
                if symbol in live_prices:
                    old_price = lot_dict["current_price"]
                    lot_dict["current_price"] = live_prices[symbol]
                    logger.info("[IngestPortfolioNode] Updated %s: $%.2f → $%.2f", symbol, old_price, live_prices[symbol])
                updated_holdings.append(Lot.model_validate(lot_dict))
            account_model = Account(
                account_id=account_model.account_id,
                name=account_model.name,
                loan_balance=account_model.loan_balance,
                max_ltv_limit=account_model.max_ltv_limit,
                cash=account_model.cash,
                holdings=updated_holdings,
            )

        return {"account": account_model}


class LTVMonitorNode:
    """Node 2 — LTVMonitorNode
    Solves: manual LTV tracking.
    Computes collateral_value, current_ltv, headroom, and risk_state.
    Sends Slack webhook immediately when risk_state is "High Risk".
    Pure deterministic Python math.
    """
    def __init__(self, slack_webhook_url: str = None):
        self.slack_webhook = slack_webhook_url or os.getenv("SLACK_WEBHOOK_URL")

    def _send_slack_alert(self, current_ltv: float, headroom: float, risk_state: str) -> None:
        """Send Slack webhook immediately when High Risk is detected."""
        if not self.slack_webhook or risk_state != "High Risk":
            return

        message = {
            "text": f"High Risk — Margin Call Risk Detected\n"
                    f"Current LTV: {current_ltv:.1%}\n"
                    f"Headroom: ${headroom:,.0f}\n"
                    f"Action required: Sell holdings or post collateral to restore headroom.\n"
                    f"_This is an automated alert from Collateral. Not financial advice._"
        }

        try:
            import requests as _requests
            _requests.post(self.slack_webhook, json=message, timeout=10)
            logger.info("[LTVMonitorNode] Slack alert sent for High Risk state")
        except Exception as e:
            logger.error("[LTVMonitorNode] Slack webhook failed: %s", str(e))

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

        # Proactive alert: fire immediately when High Risk is detected
        self._send_slack_alert(current_ltv, headroom, risk_state)

        return {
            "collateral_value": collateral_value,
            "current_ltv": current_ltv,
            "headroom": headroom,
            "risk_state": risk_state
        }


class SafeSkipNode:
    """Branch node — reached when risk_state == "Safe" and no cash_need.
    Generates a benign Recommendation and skips the tax optimizer, LLM, and human approval.
    Avoids wasting LLM tokens on portfolios that need no action.
    """
    def __init__(self):
        pass

    def __call__(self, state: Dict[str, Any]) -> Dict[str, Any]:
        headroom = state.get("headroom", 0.0)
        recommendation = Recommendation(
            risk_state="Safe",
            recommended_action="No action required",
            proposed_lots=[],
            resulting_ltv_if_executed=None,
            rationale=(
                f"Portfolio is Safe with ${headroom:,.2f} in headroom. "
                f"No liquidation or tax optimization needed."
            ),
        )
        return {
            "recommendation": recommendation,
            "approved": True,
            "result": {
                "status": "skipped",
                "message": "Portfolio is Safe with no cash need — tax optimizer and LLM skipped.",
            },
        }


# Sector mapping for concentration analysis (simplified GICS-like)
_SECTOR_MAP = {
    "AAPL": "Technology", "MSFT": "Technology", "GOOGL": "Technology", "GOOG": "Technology",
    "META": "Technology", "NVDA": "Technology", "AMD": "Technology", "INTC": "Technology",
    "CRM": "Technology", "ORCL": "Technology", "ADBE": "Technology", "SNOW": "Technology",
    "PLTR": "Technology", "UBER": "Technology", "SQ": "Technology", "SHOP": "Technology",
    "AMZN": "Consumer Discretionary", "TSLA": "Consumer Discretionary",
    "HD": "Consumer Discretionary", "NKE": "Consumer Discretionary",
    "MCD": "Consumer Discretionary", "SBUX": "Consumer Discretionary",
    "JPM": "Financials", "BAC": "Financials", "WFC": "Financials", "GS": "Financials",
    "MS": "Financials", "V": "Financials", "MA": "Financials", "AXP": "Financials",
    "JNJ": "Healthcare", "UNH": "Healthcare", "PFE": "Healthcare", "ABBV": "Healthcare",
    "MRK": "Healthcare", "LLY": "Healthcare", "TMO": "Healthcare", "ABT": "Healthcare",
    "XOM": "Energy", "CVX": "Energy", "COP": "Energy", "SLB": "Energy", "EOG": "Energy",
    "PG": "Consumer Staples", "KO": "Consumer Staples", "PEP": "Consumer Staples",
    "COST": "Consumer Staples", "WMT": "Consumer Staples",
    "NEE": "Utilities", "DUK": "Utilities", "SO": "Utilities", "D": "Utilities",
    "AMT": "Real Estate", "PLD": "Real Estate", "CCI": "Real Estate", "SPG": "Real Estate",
    "CAT": "Industrials", "BA": "Industrials", "HON": "Industrials", "UPS": "Industrials",
    "GE": "Industrials", "RTX": "Industrials", "LMT": "Industrials",
    "NFLX": "Communication Services", "DIS": "Communication Services",
    "CMCSA": "Communication Services", "T": "Communication Services",
    "VZ": "Communication Services",
}


def _day_difference(date_str1: str, date_str2: str) -> int:
    """Absolute day difference between two ISO date strings."""
    d1 = datetime.fromisoformat(date_str1)
    d2 = datetime.fromisoformat(date_str2)
    return abs((d1 - d2).days)


class TaxOptimizerNode:
    """Node 3 — TaxOptimizerNode
    Solves: tax-inefficient rebalancing.
    Computes unrealized gain/loss per lot, wash-sale risk, holding period classification,
    sector concentration, and ranks them (biggest loss first).
    Pure deterministic Python math — no LLM.
    """
    def __init__(self, concentration_threshold: float = 0.40):
        self.concentration_threshold = concentration_threshold

    def __call__(self, state: Dict[str, Any]) -> Dict[str, Any]:
        account = state.get("account")
        if isinstance(account, Account):
            holdings = account.holdings
            cash = account.cash
        else:
            holdings = account.get("holdings", []) if account else []
            cash = float(account.get("cash", 0.0)) if account else 0.0

        ranked = []
        holding_period_entries = []
        today = datetime.now().date()

        for lot in holdings:
            if isinstance(lot, Lot):
                qty = lot.quantity
                cost = lot.cost_basis
                price = lot.current_price
                lot_dict = lot.model_dump()
                acquired_date = lot.acquired_date
            else:
                qty = float(lot.get("quantity", 0.0))
                cost = float(lot.get("cost_basis", 0.0))
                price = float(lot.get("current_price", 0.0))
                lot_dict = dict(lot)
                acquired_date = lot.get("acquired_date", "2023-01-01")

            current_val = qty * price
            cost_total = qty * cost
            unrealized_gain_loss = current_val - cost_total

            lot_dict["unrealized_gain_loss"] = unrealized_gain_loss
            lot_dict["unrealized_gain_loss_per_share"] = price - cost

            # Holding period classification
            try:
                acquired = datetime.fromisoformat(acquired_date).date()
                days_held = (today - acquired).days
            except (ValueError, TypeError):
                days_held = 0
            is_short_term = days_held <= 365
            lot_dict["is_short_term"] = is_short_term
            lot_dict["days_held"] = days_held
            holding_period_entries.append({
                "lot_id": str(lot_dict.get("lot_id", "")),
                "symbol": lot_dict.get("symbol", ""),
                "days_held": days_held,
                "is_short_term": is_short_term,
            })

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

        # Sector concentration analysis
        sector_values = {}
        total_value = sum(
            (lot.get("quantity", 0) * lot.get("current_price", 0))
            for lot in ranked
        )
        for lot in ranked:
            symbol = lot.get("symbol", "")
            sector = _SECTOR_MAP.get(symbol.upper(), "Unknown")
            value = lot.get("quantity", 0) * lot.get("current_price", 0)
            sector_values[sector] = sector_values.get(sector, 0.0) + value

        sector_concentration = {
            s: (v / total_value if total_value > 0 else 0.0)
            for s, v in sector_values.items()
        }

        concentration_warning = None
        for sector, pct in sector_concentration.items():
            if pct > self.concentration_threshold:
                concentration_warning = (
                    f"Sector '{sector}' represents {pct:.0%} of portfolio "
                    f"(threshold: {self.concentration_threshold:.0%}). "
                    f"Consider diversifying to reduce concentration risk."
                )
                break

        # Sort ascending by unrealized gain/loss (largest loss first)
        ranked.sort(key=lambda x: x["unrealized_gain_loss"])

        return {
            "ranked_lots": ranked,
            "holding_period_days": holding_period_entries,
            "sector_concentration": sector_concentration,
            "concentration_warning": concentration_warning,
        }


SYSTEM_PROMPT = """You are the Reasoning node in a deterministic financial-agent pipeline called Collateral.

Your ONLY job: synthesize the risk_state, headroom, ranked_lots, holding_period_days, and sector_concentration values you are given into a structured Recommendation. You do not have access to markets, cannot execute trades, and must not invent numbers.

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
10. When proposing lot sales, prefer selling short-term loss lots over long-term loss lots (short-term losses offset ordinary income at higher rates). Note holding period in your rationale when relevant.
11. If sector_concentration_warning is provided, acknowledge it in your rationale and note that diversification may be advisable.
"""


class ReasoningAgentNode:
    """Node 4 — ReasoningAgentNode
    Solves: synthesizes risk_state, headroom, and ranked_lots into a recommendation.
    Uses init_chat_model and with_structured_output(Recommendation).
    This is the ONLY node allowed to invoke an LLM.
    """
    def __init__(self, model_name: str = "llama-3.3-70b-versatile", temperature: float = 0.1):
        self.model_name = model_name
        self.temperature = temperature
        self.llm = None
        self.structured_llm = None
        self.fallback_llm = None
        self.fallback_structured_llm = None
        self.poolside_llm = None
        self.poolside_structured_llm = None

        from langchain.chat_models import init_chat_model

        # Primary: Groq (fast inference, free tier ~14,400 req/day)
        groq_key = os.environ.get("GROQ_API_KEY")
        if groq_key:
            try:
                self.llm = init_chat_model(
                    "llama-3.3-70b-versatile",
                    model_provider="openai",
                    temperature=self.temperature,
                    base_url="https://api.groq.com/openai/v1",
                    api_key=groq_key,
                    max_retries=2,
                    max_tokens=2048,
                )
                self.structured_llm = self.llm.with_structured_output(
                    Recommendation, method="function_calling"
                )
            except Exception as e:
                logger.error("[ReasoningAgentNode] Groq init failed: %s", str(e))

        # Fallback 1: Poolside
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
                    extra_body={"thinking": {"type": "disabled"}},
                )
                self.poolside_structured_llm = self.poolside_llm.with_structured_output(
                    Recommendation, method="function_calling"
                )
            except Exception as e:
                logger.error("[ReasoningAgentNode] Poolside init failed: %s", str(e))

        # Fallback 2: OpenRouter (google/gemma-4-26b-a4b-it:free — slug verified 2026-07-26)
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

        if not any([self.structured_llm, self.fallback_structured_llm, self.poolside_structured_llm]):
            logger.warning("[ReasoningAgentNode] No LLM providers initialized — will use deterministic fallback only")

    def __call__(self, state: Dict[str, Any]) -> Dict[str, Any]:
        risk_state = state.get("risk_state", "Safe")
        headroom = state.get("headroom", 0.0)
        ranked_lots = state.get("ranked_lots", [])
        cash_need = float(state.get("cash_need", 0.0))
        holding_period_days = state.get("holding_period_days", [])
        sector_concentration = state.get("sector_concentration", {})
        concentration_warning = state.get("concentration_warning")
        valid_lot_ids = {str(lot["lot_id"]) for lot in ranked_lots}

        user_data = (
            f"risk_state: {risk_state}\n"
            f"headroom_dollars: {headroom:.2f}\n"
            f"cash_need_requested: {cash_need:.2f}\n"
            f"sector_concentration: {json.dumps(sector_concentration, default=str)}\n"
            f"concentration_warning: {concentration_warning or 'None'}\n"
            f"holding_period_days (lot_id, days_held, is_short_term):\n"
            f"{json.dumps(holding_period_days, indent=2, default=str)}\n"
            f"ranked_lots (losses first, wash_sale_caution precomputed, is_short_term precomputed):\n"
            f"{json.dumps(ranked_lots, indent=2, default=str)}"
        )
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_data},
        ]

        recommendation = None

        for label, structured_llm in [
            ("Groq", self.structured_llm),
            ("Poolside", self.poolside_structured_llm),
            ("OpenRouter", self.fallback_structured_llm),
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
            account_obj = state.get("account")
            max_ltv_limit = account_obj.max_ltv_limit if isinstance(account_obj, Account) else float(account_obj.get("max_ltv_limit", 0.50)) if isinstance(account_obj, dict) else 0.50

            # Total proceeds needed = deficit remediation + cash withdrawal
            deficit = abs(headroom) if headroom < 0 else 0.0
            deficit_proceeds = deficit / (1 - max_ltv_limit) if deficit > 0 else 0.0
            needed_proceeds = deficit_proceeds + cash_need

            if needed_proceeds > 0:
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
            else:
                resulting_ltv = None

            # Build action and rationale based on what triggered the sale
            if deficit > 0 and cash_need > 0:
                rec_action = "Liquidate holdings to restore headroom and fulfill cash withdrawal."
                rationale = f"Account is in {risk_state} with a ${deficit:.2f} deficit plus a ${cash_need:.2f} cash withdrawal request. Total needed: ${needed_proceeds:.2f}. Proposed selling short-term losses first to maximize tax harvesting."
            elif deficit > 0:
                rec_action = "Liquidate tax-loss holdings to restore borrowing headroom."
                rationale = f"Account is in {risk_state} with a ${deficit:.2f} deficit. Proposed selling short-term losses first to maximize tax harvesting."
            elif cash_need > 0:
                rec_action = f"Sell holdings to fulfill ${cash_need:.2f} cash withdrawal request."
                rationale = f"Portfolio is {risk_state} but holder requested ${cash_need:.2f} cash. Selling least-tax-cost lots to fulfill while maintaining headroom."
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

        if rec is None:
            rec_action = "No recommendation"
            proposed = []
        elif isinstance(rec, Recommendation):
            rec_action = rec.recommended_action
            proposed = [p.model_dump() for p in rec.proposed_lots]
        elif isinstance(rec, dict):
            rec_action = rec.get("recommended_action", "No recommendation")
            proposed = rec.get("proposed_lots", [])
        else:
            rec_action = str(rec)
            proposed = []

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
