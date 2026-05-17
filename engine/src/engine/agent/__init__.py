"""LangGraph agent pipeline for the course-discovery engine.

Phase 6 wires the seven-node state machine called out in the
architectural plan §4: feedback_ingest → inventory_read →
gap_analyze → research → rule_engine → cross_batch_dedupe → persist.

Phase 6 Step 1 is the skeleton: every node logs its name and returns
the shared state unchanged. Subsequent steps fill the nodes in.
"""

from engine.agent.graph import build_graph

__all__ = ["build_graph"]
