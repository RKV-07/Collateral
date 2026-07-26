"""Collateral — LangGraph v1 (KISS)
Linear state graph execution pipeline for tax-optimized liquidity management.
"""

import logging
import os
from dotenv import load_dotenv

# Load environment variables before node instantiation
load_dotenv(".env.local")

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

from nodes import (
    AgentState,
    IngestPortfolioNode,
    LTVMonitorNode,
    TaxOptimizerNode,
    ReasoningAgentNode,
    HumanApprovalNode,
    ExecutionNode,
)

# Attempt to import official LangGraph components
try:
    from langgraph.graph import StateGraph, START, END
    from langgraph.checkpoint.memory import InMemorySaver
    HAS_LANGGRAPH = True
except ImportError as e:
    logger.warning("langgraph not installed or import failed: %r — using fallback runner", e)
    HAS_LANGGRAPH = False


def _build_checkpointer(checkpointer_type: str = "memory", db_url: str = None):
    """Factory for checkpointer backends.

    checkpointer_type:
        "memory"   — InMemorySaver (default, no persistence)
        "postgres" — PostgresSaver (requires langgraph-checkpoint-postgres + psycopg)
        "sqlite"   — SqliteSaver (requires langgraph-checkpoint-sqlite)
    db_url:
        Connection string for postgres/sqlite. Ignored for "memory".
    """
    if not HAS_LANGGRAPH:
        # No real langgraph installed — return a dummy object the fallback
        # CompiledGraph can accept (it ignores the checkpointer entirely).
        class _DummyCheckpointer:
            pass
        return _DummyCheckpointer()

    if checkpointer_type == "postgres":
        try:
            from langgraph.checkpoint.postgres import PostgresSaver
            checkpointer = PostgresSaver.from_conn_string(db_url)
            checkpointer.setup()
            logger.info("Using PostgresSaver checkpointer (db_url=%s)", db_url)
            return checkpointer
        except ImportError as e:
            logger.error("postgres checkpointer unavailable: %r — falling back to InMemorySaver", e)
        except Exception as e:
            logger.error("postgres checkpointer setup failed: %r — falling back to InMemorySaver", e)

    elif checkpointer_type == "sqlite":
        try:
            from langgraph.checkpoint.sqlite import SqliteSaver
            conn_str = db_url or "checkpoints.db"
            checkpointer = SqliteSaver.from_conn_string(conn_str)
            checkpointer.setup()
            logger.info("Using SqliteSaver checkpointer (db=%s)", conn_str)
            return checkpointer
        except ImportError as e:
            logger.error("sqlite checkpointer unavailable: %r — falling back to InMemorySaver", e)
        except Exception as e:
            logger.error("sqlite checkpointer setup failed: %r — falling back to InMemorySaver", e)

    # Default: in-memory (no persistence across runs)
    logger.info("Using InMemorySaver checkpointer (no persistence)")
    return InMemorySaver()


if HAS_LANGGRAPH:
    def create_graph(
        source_path: str = "fixtures/fake_users.json",
        checkpointer_type: str = "memory",
        db_url: str = None,
    ):
        builder = StateGraph(AgentState)

        # Instantiate nodes
        ingest = IngestPortfolioNode(source_path=source_path)
        ltv_monitor = LTVMonitorNode()
        tax_optimizer = TaxOptimizerNode()
        reasoning_agent = ReasoningAgentNode()
        human_approval = HumanApprovalNode()
        execution = ExecutionNode()

        # Add nodes
        builder.add_node("ingest", ingest)
        builder.add_node("ltv_monitor", ltv_monitor)
        builder.add_node("tax_optimizer", tax_optimizer)
        builder.add_node("reasoning_agent", reasoning_agent)
        builder.add_node("human_approval", human_approval)
        builder.add_node("execution", execution)

        # Connect linear edges
        builder.add_edge(START, "ingest")
        builder.add_edge("ingest", "ltv_monitor")
        
        # BRANCH POINT (later): skip tax/LLM steps if risk_state == "Safe"
        
        builder.add_edge("ltv_monitor", "tax_optimizer")
        builder.add_edge("tax_optimizer", "reasoning_agent")
        builder.add_edge("reasoning_agent", "human_approval")
        builder.add_edge("human_approval", "execution")
        builder.add_edge("execution", END)

        checkpointer = _build_checkpointer(checkpointer_type, db_url)
        return builder.compile(checkpointer=checkpointer)

else:
    # Lightweight LangGraph-compatible runner if langgraph package is absent
    class _StateSnapshot:
        """Mimics langgraph's StateSnapshot for the fallback path."""
        def __init__(self, values: dict):
            self.values = values

    class CustomStateGraph:
        def __init__(self, state_schema):
            self.state_schema = state_schema
            self.nodes = {}
            self.edges = []

        def add_node(self, name, node_inst):
            self.nodes[name] = node_inst

        def add_edge(self, source, target):
            self.edges.append((source, target))

        def compile(self, checkpointer=None):
            return CompiledGraph(self.nodes, checkpointer=checkpointer)

    class CompiledGraph:
        def __init__(self, nodes, checkpointer=None):
            self.nodes = nodes
            self.checkpointer = checkpointer
            self._state_store = {}  # thread_id -> dict (simulates persistence)

        def invoke(self, initial_state, config=None, stop_before=None):
            state = dict(initial_state or {})
            thread_id = (config or {}).get("configurable", {}).get("thread_id", "default")

            # Linear execution order (walks self.edges would be better, but
            # this matches the hardcoded sequence for now)
            sequence = [
                "ingest",
                "ltv_monitor",
                "tax_optimizer",
                "reasoning_agent",
                "human_approval",
                "execution"
            ]

            for name in sequence:
                if stop_before and name == stop_before:
                    break
                
                # Check interrupt condition for human approval node
                if name == "human_approval" and "approved" not in state:
                    # Pause before execution node if human approval not yet provided
                    break

                node_fn = self.nodes[name]
                updates = node_fn(state)
                if updates:
                    state.update(updates)

            # Persist state keyed by thread_id so get_state() works
            self._state_store[thread_id] = dict(state)
            return state

        def get_state(self, config=None):
            """Mimics CompiledGraph.get_state() — returns a _StateSnapshot."""
            thread_id = (config or {}).get("configurable", {}).get("thread_id", "default")
            values = self._state_store.get(thread_id, {})
            return _StateSnapshot(values)

    def create_graph(
        source_path: str = "fixtures/fake_users.json",
        checkpointer_type: str = "memory",
        db_url: str = None,
    ):
        builder = CustomStateGraph(AgentState)

        ingest = IngestPortfolioNode(source_path=source_path)
        ltv_monitor = LTVMonitorNode()
        tax_optimizer = TaxOptimizerNode()
        reasoning_agent = ReasoningAgentNode()
        human_approval = HumanApprovalNode()
        execution = ExecutionNode()

        builder.add_node("ingest", ingest)
        builder.add_node("ltv_monitor", ltv_monitor)
        builder.add_node("tax_optimizer", tax_optimizer)
        builder.add_node("reasoning_agent", reasoning_agent)
        builder.add_node("human_approval", human_approval)
        builder.add_node("execution", execution)

        builder.add_edge("START", "ingest")
        builder.add_edge("ingest", "ltv_monitor")

        # BRANCH POINT (later): skip tax/LLM steps if risk_state == "Safe"

        builder.add_edge("ltv_monitor", "tax_optimizer")
        builder.add_edge("tax_optimizer", "reasoning_agent")
        builder.add_edge("reasoning_agent", "human_approval")
        builder.add_edge("human_approval", "execution")
        builder.add_edge("execution", "END")

        # Fallback runner ignores checkpointer_type/db_url (no real persistence),
        # but accepts the param for API compatibility.
        if checkpointer_type != "memory":
            logger.warning("Fallback runner does not support %s checkpointer — using in-memory", checkpointer_type)
        checkpointer = _build_checkpointer("memory")
        return builder.compile(checkpointer=checkpointer)
