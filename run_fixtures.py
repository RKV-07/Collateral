"""run_fixtures.py
Test runner script executing all synthetic fake user accounts through the LangGraph v1 pipeline up to human_approval.
"""

import json
import logging
import os
import time
from dotenv import load_dotenv

# Load environment variables before test execution
load_dotenv(".env.local")

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

from agent import create_graph
from nodes import Recommendation

def main():
    fixtures_path = "fixtures/fake_users.json"
    with open(fixtures_path, "r", encoding="utf-8") as f:
        fake_users = json.load(f)

    print("==================================================================")
    print("      RUNNING COLLATERAL LANGGRAPH V1 FIXTURE SUITE")
    print("==================================================================\n")

    graph = create_graph(source_path=fixtures_path, use_live_prices=False)

    for idx, user_acc in enumerate(fake_users, 1):
        print(f"--- TEST FIXTURE {idx}: {user_acc['name']} ({user_acc['account_id']}) ---")

        # Run up to human_approval
        initial_state = {"account": user_acc}
        config = {"configurable": {"thread_id": f"thread_{user_acc['account_id']}"}}

        try:
            graph.invoke(initial_state, config=config)
        except Exception as e:
            # Only swallow the expected LangGraph interrupt — anything else is a real error
            try:
                from langgraph.errors import GraphInterrupt
                if isinstance(e, GraphInterrupt):
                    pass  # expected pause before human approval
                else:
                    raise
            except ImportError:
                # langgraph not installed — fallback graph uses None result to signal pause
                pass

        state_snapshot = graph.get_state(config)
        state_after_approval_pause = state_snapshot.values if hasattr(state_snapshot, "values") else state_snapshot

        risk_state = state_after_approval_pause.get("risk_state")
        headroom = state_after_approval_pause.get("headroom")
        ranked_lots = state_after_approval_pause.get("ranked_lots", [])
        recommendation = state_after_approval_pause.get("recommendation")
        result = state_after_approval_pause.get("result")

        # Convert Recommendation Pydantic object to dict for JSON printing if needed
        if isinstance(recommendation, Recommendation):
            rec_dict = recommendation.model_dump()
        elif hasattr(recommendation, "model_dump"):
            rec_dict = recommendation.model_dump()
        else:
            rec_dict = recommendation

        print(f"  > Risk State  : {risk_state}")
        print(f"  > Headroom ($): {headroom:,.2f}")
        print("  > Ranked Lots (Losses First):")
        for lot in ranked_lots:
            gain_loss = lot.get("unrealized_gain_loss", 0.0)
            wash = lot.get("wash_sale_caution", False)
            wash_tag = " [WASH SALE]" if wash else ""
            print(f"      - {lot['symbol']} ({lot['lot_id']}): Qty={lot['quantity']}, Gain/Loss=${gain_loss:,.2f}{wash_tag}")
        print(f"  > Recommendation (Validated Pydantic Model):\n{json.dumps(rec_dict, indent=6, default=str)}")
        print(f"  > Execution Result (Should be None before approval): {result}\n")

        # ASSERTIONS FOR DEFINITION OF DONE
        if user_acc["account_id"] == "c3d4e5f6-a7b8-4c9d-0e1f-2a3b4c5d6e7f":
            assert abs(headroom - (-500.0)) < 1e-5, f"ERROR: Expected headroom -500.0, got {headroom}"
            print("  ✓ VERIFIED: Fixture 3 (High Risk) produced headroom == -500.0 exactly!")

        if user_acc["account_id"] == "d4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f80":
            assert len(ranked_lots) >= 2, "ERROR: Expected at least 2 tax lots in ranked_lots"
            first_lot = ranked_lots[0]
            second_lot = ranked_lots[1]
            assert first_lot["unrealized_gain_loss"] < second_lot["unrealized_gain_loss"], "ERROR: TaxOptimizerNode failed to rank loss lot first"
            print("  ✓ VERIFIED: Fixture 4 (Mixed Lots) ranked loss lot before gain lot!")

        if user_acc["account_id"] == "e5f6a7b8-c9d0-4e1f-2a3b-4c5d6e7f8091":
            loss_lot = next(l for l in ranked_lots if l["unrealized_gain_loss"] < 0)
            assert loss_lot["wash_sale_caution"] is True, "ERROR: wash-sale check failed to flag same-symbol lot within 30 days"
            gain_lot = next(l for l in ranked_lots if l["unrealized_gain_loss"] > 0)
            assert gain_lot["wash_sale_caution"] is False, "ERROR: gain lot should not have wash_sale_caution"
            print("  ✓ VERIFIED: Wash-sale caution correctly flagged for same-symbol lot within 30 days!")

        if user_acc["account_id"] == "f6a7b8c9-d0e1-4f2a-3b4c-5d6e7f809142":
            assert abs(headroom - (-2200.0)) < 1e-5, f"ERROR: Expected headroom -2200.0, got {headroom}"
            print("  ✓ VERIFIED: Fixture 6 (Non-Standard Limit 35%) produced headroom == -2200.0 exactly!")

        assert result is None, f"ERROR: ExecutionNode executed before human approval! Result: {result}"
        print("  ✓ VERIFIED: Graph paused before ExecutionNode as required.\n")

        # Rate-limit: wait 2 seconds between fixtures to avoid Groq 429s
        if idx < len(fake_users):
            time.sleep(2)

    print("==================================================================")
    print("      ALL FIXTURES COMPLETED & VERIFIED SUCCESSFULLY! ✓")
    print("==================================================================")

if __name__ == "__main__":
    main()
