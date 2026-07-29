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
    SafeSkipNode,
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


def _route_after_ltv(state: dict) -> str:
    """Conditional edge: skip tax optimizer + LLM if Safe and no cash need."""
    risk = state.get("risk_state", "Safe")
    cash_need = float(state.get("cash_need", 0.0))
    if risk == "Safe" and cash_need == 0.0:
        return "safe_skip"
    return "tax_optimizer"


if HAS_LANGGRAPH:
    def create_graph(
        source_path: str = "fixtures/fake_users.json",
        checkpointer_type: str = "memory",
        db_url: str = None,
        use_live_prices: bool = True,
    ):
        builder = StateGraph(AgentState)

        # Instantiate nodes
        ingest = IngestPortfolioNode(source_path=source_path, use_live_prices=use_live_prices)
        ltv_monitor = LTVMonitorNode()
        tax_optimizer = TaxOptimizerNode()
        reasoning_agent = ReasoningAgentNode()
        human_approval = HumanApprovalNode()
        execution = ExecutionNode()
        safe_skip = SafeSkipNode()

        # Add nodes
        builder.add_node("ingest", ingest)
        builder.add_node("ltv_monitor", ltv_monitor)
        builder.add_node("tax_optimizer", tax_optimizer)
        builder.add_node("reasoning_agent", reasoning_agent)
        builder.add_node("human_approval", human_approval)
        builder.add_node("execution", execution)
        builder.add_node("safe_skip", safe_skip)

        # Connect edges
        builder.add_edge(START, "ingest")
        builder.add_edge("ingest", "ltv_monitor")

        # Conditional branch: skip tax/LLM/approval if Safe + no cash need
        builder.add_conditional_edges(
            "ltv_monitor",
            _route_after_ltv,
            {
                "tax_optimizer": "tax_optimizer",
                "safe_skip": "safe_skip",
            },
        )

        builder.add_edge("tax_optimizer", "reasoning_agent")
        builder.add_edge("reasoning_agent", "human_approval")
        builder.add_edge("human_approval", "execution")
        builder.add_edge("execution", END)
        builder.add_edge("safe_skip", END)

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
            self.conditional_edges = []

        def add_node(self, name, node_inst):
            self.nodes[name] = node_inst

        def add_edge(self, source, target):
            self.edges.append((source, target))

        def add_conditional_edges(self, source, condition_fn, mapping):
            self.conditional_edges.append((source, condition_fn, mapping))

        def compile(self, checkpointer=None):
            return CompiledGraph(self.nodes, self.edges, self.conditional_edges, checkpointer=checkpointer)

    class CompiledGraph:
        def __init__(self, nodes, edges, conditional_edges, checkpointer=None):
            self.nodes = nodes
            self.edges = edges
            self.conditional_edges = conditional_edges
            self.checkpointer = checkpointer
            self._state_store = {}  # thread_id -> dict (simulates persistence)

        def _next_node(self, current: str, state: dict) -> str:
            """Determine next node given current node and state."""
            # Check conditional edges first
            for src, cond_fn, mapping in self.conditional_edges:
                if src == current:
                    key = cond_fn(state)
                    target = mapping.get(key)
                    if target:
                        return target

            # Fall back to linear edges
            for src, tgt in self.edges:
                if src == current:
                    return tgt
            return None

        def invoke(self, initial_state, config=None, stop_before=None):
            thread_id = (config or {}).get("configurable", {}).get("thread_id", "default")
            prior = self._state_store.get(thread_id)

            # Resume from prior state if available, merge in new keys
            state = dict(prior) if prior else {}
            state.update(initial_state or {})

            # If resuming (had prior state + new input like "approved"), start from human_approval
            if prior and initial_state and "approved" in initial_state:
                current = "human_approval"
            else:
                current = "ingest"
            visited = set()

            while current:
                if stop_before and current == stop_before:
                    break
                if current in visited:
                    logger.error("Cycle detected at node %s — aborting", current)
                    break
                visited.add(current)

                # Check interrupt condition for human approval node
                if current == "human_approval" and "approved" not in state:
                    break

                node_fn = self.nodes[current]
                updates = node_fn(state)
                if updates:
                    state.update(updates)

                current = self._next_node(current, state)

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
        use_live_prices: bool = True,
    ):
        builder = CustomStateGraph(AgentState)

        ingest = IngestPortfolioNode(source_path=source_path, use_live_prices=use_live_prices)
        ltv_monitor = LTVMonitorNode()
        tax_optimizer = TaxOptimizerNode()
        reasoning_agent = ReasoningAgentNode()
        human_approval = HumanApprovalNode()
        execution = ExecutionNode()
        safe_skip = SafeSkipNode()

        builder.add_node("ingest", ingest)
        builder.add_node("ltv_monitor", ltv_monitor)
        builder.add_node("tax_optimizer", tax_optimizer)
        builder.add_node("reasoning_agent", reasoning_agent)
        builder.add_node("human_approval", human_approval)
        builder.add_node("execution", execution)
        builder.add_node("safe_skip", safe_skip)

        builder.add_edge("START", "ingest")
        builder.add_edge("ingest", "ltv_monitor")

        # Conditional branch: skip tax/LLM/approval if Safe + no cash need
        builder.add_conditional_edges(
            "ltv_monitor",
            _route_after_ltv,
            {
                "tax_optimizer": "tax_optimizer",
                "safe_skip": "safe_skip",
            },
        )

        builder.add_edge("tax_optimizer", "reasoning_agent")
        builder.add_edge("reasoning_agent", "human_approval")
        builder.add_edge("human_approval", "execution")
        builder.add_edge("execution", "END")
        builder.add_edge("safe_skip", "END")

        # Fallback runner ignores checkpointer_type/db_url (no real persistence),
        # but accepts the param for API compatibility.
        if checkpointer_type != "memory":
            logger.warning("Fallback runner does not support %s checkpointer — using in-memory", checkpointer_type)
        checkpointer = _build_checkpointer("memory")
        return builder.compile(checkpointer=checkpointer)
