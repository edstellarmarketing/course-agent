"""Langfuse trace + span helpers for the course-agent engine.

Phase 9 commits to a specific Langfuse 4.x API surface
(``start_as_current_observation``) and validates traces land in the
dashboard. When ``LANGFUSE_PUBLIC_KEY``/``LANGFUSE_SECRET_KEY`` are
unset the helpers no-op so dev runs don't need Langfuse configured.

Three public symbols:

- ``maybe_langfuse_trace(name, **attrs)`` — wraps the top-level
  ``agent.run`` invocation. Every nested span attaches under it.
- ``maybe_langfuse_span(name, **attrs)`` — wraps a node or sub-step
  inside an existing trace.
- ``flush_langfuse()`` — must be called once before the process exits.
  Without it, the background sender thread is torn down before queued
  spans ship, and the dashboard goes intermittently empty.
"""

from __future__ import annotations

import contextlib
import logging
from collections.abc import Iterator
from typing import Any

from engine.config import settings

log = logging.getLogger(__name__)

_client_cache: Any = None


def _langfuse_configured() -> bool:
    cfg = settings()
    return bool(cfg.langfuse_public_key and cfg.langfuse_secret_key)


def _get_client() -> Any:
    """Initialize once per process; never raise into the run."""
    global _client_cache
    if _client_cache is not None:
        return _client_cache
    if not _langfuse_configured():
        return None
    cfg = settings()
    try:
        from langfuse import Langfuse  # type: ignore[import-not-found]

        _client_cache = Langfuse(
            public_key=cfg.langfuse_public_key,
            secret_key=cfg.langfuse_secret_key,
            host=str(cfg.langfuse_host) if cfg.langfuse_host else None,
        )
    except Exception as exc:  # noqa: BLE001 — telemetry never blocks the run
        log.warning("langfuse init failed: %s — continuing without traces", exc)
        _client_cache = None
    return _client_cache


@contextlib.contextmanager
def maybe_langfuse_trace(name: str, **attrs: Any) -> Iterator[Any]:
    """Top-level trace. Wrap the agent invocation in this; every
    nested ``maybe_langfuse_span`` lands underneath."""
    client = _get_client()
    if client is None:
        yield None
        return
    try:
        with client.start_as_current_observation(
            name=name, as_type="span", metadata=attrs
        ) as obs:
            yield obs
    except Exception as exc:  # noqa: BLE001
        log.warning("langfuse trace %s failed: %s — continuing", name, exc)
        yield None


@contextlib.contextmanager
def maybe_langfuse_span(name: str, **attrs: Any) -> Iterator[Any]:
    """Nested observation. Use inside a graph node or sub-step."""
    client = _get_client()
    if client is None:
        yield None
        return
    try:
        with client.start_as_current_observation(
            name=name, as_type="span", metadata=attrs
        ) as obs:
            yield obs
    except Exception as exc:  # noqa: BLE001
        log.warning("langfuse span %s failed: %s — continuing", name, exc)
        yield None


def flush_langfuse() -> None:
    """Drain the background sender. Call once at process exit."""
    client = _get_client()
    if client is None:
        return
    try:
        client.flush()
    except Exception as exc:  # noqa: BLE001
        log.warning("langfuse flush failed: %s", exc)
