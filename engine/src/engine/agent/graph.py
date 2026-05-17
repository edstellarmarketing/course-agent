"""LangGraph wiring for the seven-node pipeline.

Step 1 wires a linear graph: each node is a logging stub. Subsequent
steps (2-8) replace stubs with real implementations and Step 5 may
swap the single ``research`` edge for a parallel ``Send``-driven
fan-out over targeted categories — Step 1 keeps the topology trivial
so the dry-run can be reasoned about without ceremony.

The graph is compiled once per CLI invocation via ``build_graph()``
and then ``invoke()``'d with the initial state from ``cli.py``.
"""

from __future__ import annotations

from langgraph.graph import END, START, StateGraph

from engine.agent.nodes import (
    cross_batch_dedupe,
    feedback_ingest,
    gap_analyze,
    inventory_read,
    persist,
    research,
    rule_engine,
)
from engine.agent.state import AgentState


def build_graph():
    """Compile and return the runnable LangGraph for one agent run."""
    g = StateGraph(AgentState)

    g.add_node("feedback_ingest", feedback_ingest.run)
    g.add_node("inventory_read", inventory_read.run)
    g.add_node("gap_analyze", gap_analyze.run)
    g.add_node("research", research.run)
    g.add_node("rule_engine", rule_engine.run)
    g.add_node("cross_batch_dedupe", cross_batch_dedupe.run)
    g.add_node("persist", persist.run)

    g.add_edge(START, "feedback_ingest")
    g.add_edge("feedback_ingest", "inventory_read")
    g.add_edge("inventory_read", "gap_analyze")
    g.add_edge("gap_analyze", "research")
    g.add_edge("research", "rule_engine")
    g.add_edge("rule_engine", "cross_batch_dedupe")
    g.add_edge("cross_batch_dedupe", "persist")
    g.add_edge("persist", END)

    return g.compile()
