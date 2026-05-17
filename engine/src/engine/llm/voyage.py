"""Voyage AI embedding client.

Wraps https://api.voyageai.com/v1/embeddings with the same shape the
existing ``embed_courses`` script uses (voyage-3-large, 1024-dim).
Embedding calls are cheap (~$0.00018 per 1k tokens), but the runtime
cost ceiling still wants them in the same RunCostLedger so the
total dollar figure across LLM + embedding + search is accurate.

Voyage publishes pricing per 1M tokens; we approximate token count
with len(text)/4 (a chars-per-token heuristic close enough for the
ledger's sub-cent precision).
"""

from __future__ import annotations

import logging

import httpx
import numpy as np

from engine.config import settings
from engine.llm.openrouter import RunCostLedger

log = logging.getLogger(__name__)

VOYAGE_URL = "https://api.voyageai.com/v1/embeddings"
VOYAGE_MODEL = "voyage-3-large"
VOYAGE_DIM = 1024
DEFAULT_TIMEOUT_S = 30.0

# Voyage voyage-3-large list price (Nov 2025): $0.18 per 1M input tokens.
# Updated when the contract changes.
VOYAGE_USD_PER_TOKEN = 0.18 / 1_000_000


def embed_one(
    text: str,
    *,
    ledger: RunCostLedger,
    input_type: str = "document",
    timeout_s: float = DEFAULT_TIMEOUT_S,
) -> np.ndarray:
    """Embed a single text; return a (1024,) float32 vector."""
    cfg = settings()
    resp = httpx.post(
        VOYAGE_URL,
        headers={"Authorization": f"Bearer {cfg.voyage_api_key}"},
        json={
            "input": text,
            "model": VOYAGE_MODEL,
            "input_type": input_type,
        },
        timeout=timeout_s,
    )
    resp.raise_for_status()
    payload = resp.json()
    data = payload.get("data") or []
    if not data:
        raise RuntimeError(f"Voyage returned no embeddings for input len={len(text)}")
    emb_list = data[0]["embedding"]
    if len(emb_list) != VOYAGE_DIM:
        raise RuntimeError(
            f"Expected {VOYAGE_DIM}-dim embedding, got {len(emb_list)}"
        )

    # Cost — voyage-3-large input pricing
    approx_tokens = max(1, len(text) // 4)
    cost = approx_tokens * VOYAGE_USD_PER_TOKEN
    ledger.record_external(
        span="voyage.embed",
        cost_usd=cost,
        chars=len(text),
        approx_tokens=approx_tokens,
    )
    log.info("voyage embed chars=%d approx_tokens=%d", len(text), approx_tokens)
    return np.asarray(emb_list, dtype=np.float32)


def cosine_similarity_against_matrix(
    vector: np.ndarray, matrix: np.ndarray
) -> np.ndarray:
    """Return per-row cosine similarity of ``vector`` against each row.

    Both inputs assumed to be unnormalized float32 of compatible dim.
    Output shape: (matrix.shape[0],).
    """
    if matrix.shape[0] == 0:
        return np.array([], dtype=np.float32)
    # Normalize once; cheap given matrix is held in cache.
    vec_norm = np.linalg.norm(vector)
    if vec_norm == 0:
        return np.zeros(matrix.shape[0], dtype=np.float32)
    mat_norms = np.linalg.norm(matrix, axis=1)
    # Avoid divide-by-zero for any null rows.
    mat_norms = np.where(mat_norms == 0, 1.0, mat_norms)
    return (matrix @ vector) / (mat_norms * vec_norm)
