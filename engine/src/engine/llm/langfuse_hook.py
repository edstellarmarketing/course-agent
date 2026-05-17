"""Optional Langfuse span context manager.

When ``LANGFUSE_PUBLIC_KEY`` is set, every call to
``maybe_langfuse_span("name", k=v)`` wraps the with-block in a real
Langfuse span so production runs appear as one trace with per-call
detail. When the key is absent, the context manager is a no-op so
local dev runs have zero Langfuse overhead and don't need the SDK
configured.

Phase 9 will graduate this to a richer trace/observation pattern;
Phase 6 only needs the cheap on/off switch.
"""

from __future__ import annotations

import contextlib
import logging
from collections.abc import Iterator
from typing import Any

from engine.config import settings

log = logging.getLogger(__name__)


@contextlib.contextmanager
def maybe_langfuse_span(name: str, **attrs: Any) -> Iterator[None]:
    cfg = settings()
    if not cfg.langfuse_public_key or not cfg.langfuse_secret_key:
        yield
        return

    # Lazy import: keeps `langfuse` out of the hot path when it's not
    # configured, and avoids paying its import cost in unit tests.
    try:
        from langfuse import Langfuse  # type: ignore[import-not-found]
    except ImportError:
        log.debug("langfuse not installed; span %s skipped", name)
        yield
        return

    client = _get_client(Langfuse, cfg)
    if client is None:
        yield
        return

    # The Langfuse 4.x API exposes a `start_as_current_span` context
    # manager. We pass the call name as the span name and attrs as
    # the span's metadata so the dashboard can filter by them.
    try:
        with client.start_as_current_span(name=name, metadata=attrs):
            yield
    except Exception as exc:  # noqa: BLE001 — telemetry never blocks the run
        log.warning("langfuse span %s failed: %s — continuing", name, exc)
        yield


_client_cache: Any = None


def _get_client(LangfuseCls: Any, cfg: Any) -> Any:
    """Initialize once per process; never raise into the run."""
    global _client_cache
    if _client_cache is not None:
        return _client_cache
    try:
        _client_cache = LangfuseCls(
            public_key=cfg.langfuse_public_key,
            secret_key=cfg.langfuse_secret_key,
            host=str(cfg.langfuse_host) if cfg.langfuse_host else None,
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("langfuse init failed: %s — continuing without traces", exc)
        _client_cache = None
    return _client_cache
