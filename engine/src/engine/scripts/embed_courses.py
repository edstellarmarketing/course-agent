"""Phase 4 Checkpoint 1 — backfill 1024-dim Voyage embeddings for the
``course-agent.courses`` table.

Walks every row where ``embedding IS NULL``, builds a short document
string (``{name}. Category: {category}. Subcategory: {subcategory}.``),
embeds it with Voyage ``voyage-3-large`` in batches of 128, and writes
the vector back via upsert on ``num`` (the natural key set up by
migration 0003).

  uv --directory engine run embed_courses

After the run finishes, jump into Supabase SQL Editor and:

  vacuum analyze "course-agent".courses;

so the ``ivfflat`` index gets built properly. Then validate with a
cosine-similarity probe:

  select id, name,
         1 - (embedding <=> (select embedding from "course-agent".courses where num = 1)) as sim
  from "course-agent".courses
  order by sim desc
  limit 5;

Should return the seed course as #1 and semantically-similar courses
after it.
"""

from __future__ import annotations

import sys
from typing import Any

import httpx

from engine.config import settings
from engine.supabase import supabase

# Voyage's documented per-request cap is 128 inputs. Each input is a
# short sentence (~30 tokens) so we're nowhere near the 32k-token-per-
# input limit; the rate-limit envelope is what we plan around.
VOYAGE_BATCH_SIZE = 128
VOYAGE_MODEL = "voyage-3-large"
VOYAGE_DIMS = 1024

# How many candidate rows to pull from Supabase per page. PostgREST
# silently caps result sets at 1000 by default, so we set the explicit
# limit just under it. Loop termination is driven by an empty response,
# not by short pages.
DB_PAGE_SIZE = 1000


def _ensure_utf8_console() -> None:
    """Windows' default cp1252 chokes on ✓/✗; force UTF-8 to match the
    smoke test's behaviour."""
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]


def _document_for(row: dict[str, Any]) -> str:
    """Compact embedding input. Keeps the most discriminating fields and
    gives Voyage enough surrounding context for short/ambiguous names
    like '5G Security' or 'UNIX Fundamentals'."""
    sub = row.get("subcategory") or "general"
    return f"{row['name']}. Category: {row['category']}. Subcategory: {sub}."


def _format_vector(values: list[float]) -> str:
    """pgvector accepts the literal '[v1,v2,...]' string and casts it to
    ``vector(n)``. Supabase-py JSON-encodes whatever we pass; this string
    form survives the round-trip unambiguously."""
    return "[" + ",".join(repr(float(v)) for v in values) + "]"


def _embed_batch(client: httpx.Client, api_key: str, docs: list[str]) -> list[list[float]]:
    response = client.post(
        "https://api.voyageai.com/v1/embeddings",
        headers={"Authorization": f"Bearer {api_key}"},
        json={
            "input": docs,
            "model": VOYAGE_MODEL,
            "input_type": "document",
        },
        timeout=60.0,
    )
    response.raise_for_status()
    payload = response.json()
    rows = sorted(payload["data"], key=lambda r: r["index"])
    embeddings = [r["embedding"] for r in rows]
    for emb in embeddings:
        if len(emb) != VOYAGE_DIMS:
            raise RuntimeError(
                f"expected {VOYAGE_DIMS}-dim embedding, got {len(emb)}"
            )
    return embeddings


def main() -> None:
    _ensure_utf8_console()
    cfg = settings()
    sb = supabase()

    total_updated = 0
    page = 0
    with httpx.Client() as voyage_client:
        while True:
            page += 1
            response = (
                sb.table("courses")
                .select("num,name,category,subcategory")
                .is_("embedding", "null")
                .order("num")
                .limit(DB_PAGE_SIZE)
                .execute()
            )
            pending: list[dict[str, Any]] = response.data
            if not pending:
                break

            print(f"page {page}: {len(pending)} rows to embed")

            for i in range(0, len(pending), VOYAGE_BATCH_SIZE):
                batch = pending[i : i + VOYAGE_BATCH_SIZE]
                docs = [_document_for(r) for r in batch]
                embeddings = _embed_batch(voyage_client, cfg.voyage_api_key, docs)

                # Per-row UPDATE keyed on num. supabase-py's upsert+on_conflict
                # path doesn't reliably translate to PostgREST's
                # `Prefer: resolution=merge-duplicates` semantics, so it
                # ends up doing INSERTs and trips the NOT NULL on name.
                # 1623 single-row updates is the safe, boring path; ~50ms
                # each, so a few seconds per batch on top of the Voyage
                # call. Fine for a one-shot backfill.
                for row, emb in zip(batch, embeddings, strict=True):
                    sb.table("courses").update(
                        {"embedding": _format_vector(emb)}
                    ).eq("num", row["num"]).execute()

                total_updated += len(batch)
                print(
                    f"  batch {i // VOYAGE_BATCH_SIZE + 1}: "
                    f"+{len(batch)} (running total {total_updated})"
                )

    print(f"\n✓ embedded {total_updated} courses")
    print(
        "Next: in Supabase SQL Editor run\n"
        '  vacuum analyze "course-agent".courses;\n'
        "so the ivfflat index rebuilds against the populated vectors."
    )


if __name__ == "__main__":
    main()
