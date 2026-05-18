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
import sys
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
def _safe_observation(name: str, **attrs: Any) -> Iterator[Any]:
    """Internal helper. Wrap a Langfuse observation so SDK-side
    failures (init, network, schema) never abort the agent run, while
    user exceptions inside the ``with`` block still propagate and are
    recorded against the span via ``__exit__(*exc_info)``.

    Always yields exactly once per code path — the contract a
    ``@contextlib.contextmanager`` generator must honour. Yielding
    twice (e.g. once in the happy path and again from an ``except``
    branch) raises ``generator didn't stop after throw()`` and masks
    the original exception.
    """
    client = _get_client()
    if client is None:
        yield None
        return

    try:
        cm = client.start_as_current_observation(
            name=name, as_type="span", metadata=attrs
        )
    except Exception as exc:  # noqa: BLE001 — telemetry never blocks
        log.warning("langfuse %s create failed: %s — continuing", name, exc)
        yield None
        return

    entered = False
    obs: Any = None
    try:
        obs = cm.__enter__()
        entered = True
    except Exception as exc:  # noqa: BLE001
        log.warning("langfuse %s enter failed: %s — continuing", name, exc)

    if not entered:
        yield None
        return

    exc_info: Any = (None, None, None)
    try:
        yield obs
    except BaseException:
        exc_info = sys.exc_info()
        raise
    finally:
        try:
            cm.__exit__(*exc_info)
        except Exception as exc:  # noqa: BLE001
            log.warning("langfuse %s exit failed: %s — continuing", name, exc)


def maybe_langfuse_trace(name: str, **attrs: Any) -> contextlib.AbstractContextManager[Any]:
    """Top-level trace. Wrap the agent invocation in this; every
    nested ``maybe_langfuse_span`` lands underneath."""
    return _safe_observation(name, **attrs)


def maybe_langfuse_span(name: str, **attrs: Any) -> contextlib.AbstractContextManager[Any]:
    """Nested observation. Use inside a graph node or sub-step."""
    return _safe_observation(name, **attrs)


def flush_langfuse() -> None:
    """Drain the background sender. Call once at process exit."""
    client = _get_client()
    if client is None:
        return
    try:
        client.flush()
    except Exception as exc:  # noqa: BLE001
        log.warning("langfuse flush failed: %s", exc)
