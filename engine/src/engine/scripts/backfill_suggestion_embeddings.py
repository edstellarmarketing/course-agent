"""Phase 8 Step 1 — populate ``suggestions.embedding`` for legacy rows.

Walks every row where ``embedding IS NULL``, builds the same
``"{title}. {rationale}"`` document text Rule 2 uses, embeds with
Voyage ``voyage-3-large``, and writes the vector back. Idempotent —
re-running is a no-op once every row has an embedding.

  uv --directory engine run backfill_suggestions

Why this script exists
----------------------

Migration 0006's 10 seed suggestions and any rows persisted before
Phase 6 wired ``persist.py`` to embed-on-write have NULL embeddings.
Rule 9's cosine probe against the recent-rejection matrix needs
vectors on the rejected-status rows to be load-bearing, so this
backfill is gating for Phase 8 Step 2.

Cost
----

Voyage ``voyage-3-large`` is ~$0.18 per 1M input tokens. With ~20
backfill rows averaging ~300 chars (~75 tokens) each, total cost
is well under one cent. Tracked through the same ``RunCostLedger``
the live runs use so the spend shows up in audit logs.

Vector format on the wire
-------------------------

pgvector accepts the column value as a literal string
``"[v1,v2,...]"`` over PostgREST. We render with 6-digit precision
to match ``persist.py``'s convention.
"""

from __future__ import annotations

import logging
import sys

import numpy as np

from engine.llm.openrouter import RunCostLedger
from engine.llm.voyage import embed_one
from engine.supabase import supabase

# Match the existing Windows-console UTF-8 setup used by smoke_test.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]

log = logging.getLogger("backfill_suggestions")

# PostgREST 1k-row cap; we paginate even though the backfill set is
# tiny today — keeps the script honest if it's ever re-run after
# Phase 9's scheduler accumulates more history.
PAGE_SIZE = 500


def _vector_to_pg_string(vec: np.ndarray) -> str:
    return "[" + ",".join(f"{x:.6f}" for x in vec.tolist()) + "]"


def _build_doc_text(row: dict) -> str:
    title = (row.get("title") or "").strip()
    rationale = (row.get("rationale") or "").strip()
    return f"{title}. {rationale}".strip()


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)sZ %(levelname)s %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
        stream=sys.stdout,
    )
    sb = supabase()
    ledger = RunCostLedger()

    # ── Pull every NULL-embedding row. ──────────────────────────
    pending: list[dict] = []
    start = 0
    while True:
        page = (
            sb.table("suggestions")
            .select("id,title,rationale")
            .is_("embedding", "null")
            .order("created_at")
            .range(start, start + PAGE_SIZE - 1)
            .execute()
        )
        if not page.data:
            break
        pending.extend(page.data)
        if len(page.data) < PAGE_SIZE:
            break
        start += PAGE_SIZE

    if not pending:
        log.info("nothing to backfill — every row already has an embedding")
        return 0

    log.info("backfilling %d row(s)", len(pending))

    failures: list[tuple[str, str]] = []
    for i, row in enumerate(pending, 1):
        doc = _build_doc_text(row)
        if not doc:
            failures.append((row["id"], "empty doc text"))
            continue
        try:
            vec = embed_one(doc, ledger=ledger, input_type="document")
        except Exception as exc:  # noqa: BLE001 — surface any voyage error
            log.warning("embed failed for %s: %s", row["id"], exc)
            failures.append((row["id"], str(exc)))
            continue

        emb_str = _vector_to_pg_string(vec)
        upd = (
            sb.table("suggestions")
            .update({"embedding": emb_str})
            .eq("id", row["id"])
            .select("id")
            .execute()
        )
        if not upd.data:
            failures.append((row["id"], "update returned 0 rows"))
            continue

        log.info(
            "[%d/%d] %s — embedded %d chars",
            i,
            len(pending),
            row["id"][:8],
            len(doc),
        )

    log.info(
        "backfill done: success=%d failed=%d cost=$%0.6f",
        len(pending) - len(failures),
        len(failures),
        ledger.total_usd,
    )
    if failures:
        for rid, reason in failures:
            log.warning("  failed %s — %s", rid[:8], reason)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
