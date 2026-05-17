"""Load courses + categories from Supabase into in-memory caches.

The whole inventory (~1,623 courses × 1024 dims = ~13 MB) fits
comfortably in process memory, so we load it once per run and hold
it for Rule 2 / Rule 9 to do a single batched matmul rather than
1,623 individual cosine queries.

The vector column comes back from PostgREST as a JSON-encoded string
like ``"[0.1,0.2,-0.3,...]"`` — supabase-py doesn't parse it for us.
We ``json.loads`` each row and stack into a single ``float32`` numpy
matrix. ``float32`` halves memory vs ``float64`` and is plenty for
cosine work.

PostgREST caps a single SELECT at 1,000 rows by default; we paginate
with ``.range()`` to pull the full 1,623.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any

import numpy as np

from engine.agent.state import AgentState
from engine.supabase import supabase

log = logging.getLogger(__name__)

# Page size for the .range() pagination; PostgREST default cap is
# 1,000 — 500 keeps any individual request comfortably under a
# second on the self-hosted Supabase.
PAGE_SIZE = 500

# Module-level cache. The agent process is single-run, so an LRU
# isn't necessary — a plain global flushed by ``reset_inventory()``
# (for tests) is enough. Holds an ``Inventory`` after the first
# ``load_inventory()`` call.
_inventory: "Inventory | None" = None


@dataclass(frozen=True)
class Inventory:
    """Snapshot of courses + categories at run start.

    ``courses_matrix`` rows are aligned to ``course_ids`` — index N
    in the matrix corresponds to the course whose id is at index N
    in ``course_ids``. Use this alignment for the cosine-similarity
    probe in Rule 2.
    """

    courses: list[dict[str, Any]]
    categories: list[dict[str, Any]]
    courses_matrix: np.ndarray  # shape (n_with_embedding, 1024), float32
    course_ids: list[str]


def reset_inventory() -> None:
    """Test hook — drops the cache so the next call re-fetches."""
    global _inventory
    _inventory = None


def load_inventory() -> Inventory:
    """Fetch courses + categories from Supabase; cache for the run."""
    global _inventory
    if _inventory is not None:
        return _inventory

    sb = supabase()

    # ── Categories ──────────────────────────────────────────────
    # Tiny table (43 rows); single request via the with-counts view
    # so gap_analyze can score under-supply without re-querying.
    cats_resp = (
        sb.table("categories_with_counts")
        .select("id,name,course_count,target_count,demand_score,is_pinned")
        .order("name")
        .execute()
    )
    categories: list[dict[str, Any]] = cats_resp.data

    # ── Courses (paginated) ─────────────────────────────────────
    courses: list[dict[str, Any]] = []
    start = 0
    while True:
        page = (
            sb.table("courses")
            .select("id,num,name,category,subcategory,link,embedding")
            .order("num")
            .range(start, start + PAGE_SIZE - 1)
            .execute()
        )
        if not page.data:
            break
        courses.extend(page.data)
        if len(page.data) < PAGE_SIZE:
            break
        start += PAGE_SIZE

    # ── Vector parsing + matrix build ───────────────────────────
    rows_with_emb: list[dict[str, Any]] = []
    vectors: list[list[float]] = []
    for c in courses:
        emb = c.get("embedding")
        if emb is None:
            continue
        # PostgREST returns vector(1024) as a JSON-encoded string.
        if isinstance(emb, str):
            parsed = json.loads(emb)
        else:
            # Defensive: future supabase-py / PostgREST versions might
            # parse vectors server-side.
            parsed = list(emb)
        rows_with_emb.append(c)
        vectors.append(parsed)

    if not rows_with_emb:
        raise RuntimeError(
            "No course embeddings present — run "
            "`uv --directory engine run embed_courses` first."
        )

    matrix = np.asarray(vectors, dtype=np.float32)
    if matrix.shape[1] != 1024:
        raise RuntimeError(
            f"Unexpected embedding dim {matrix.shape[1]} — Voyage "
            f"voyage-3-large should produce 1024-dim vectors."
        )

    course_ids = [c["id"] for c in rows_with_emb]

    _inventory = Inventory(
        courses=courses,
        categories=categories,
        courses_matrix=matrix,
        course_ids=course_ids,
    )
    return _inventory


def run(state: AgentState) -> AgentState:
    inv = load_inventory()
    log.info(
        "node=inventory_read courses=%d categories=%d matrix=%s",
        len(inv.courses),
        len(inv.categories),
        tuple(inv.courses_matrix.shape),
    )
    # State carries the lightweight metadata; the matrix lives in
    # the module cache. Nodes that need the matrix re-call
    # ``load_inventory()`` — cheap, no re-fetch.
    return {
        "courses": [
            {k: v for k, v in c.items() if k != "embedding"} for c in inv.courses
        ],
        "categories": inv.categories,
    }
