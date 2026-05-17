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

    # Langfuse 4.x API varies across patch versions — probe a few
    # known span factories. If none work we silently no-op.
    span_factory = (
        getattr(client, "start_as_current_observation", None)
        or getattr(client, "start_as_current_span", None)
    )
    if span_factory is None:
        yield
        return

    # ExitStack so the inner yield isn't tangled with our own
    # try/except — caller exceptions must propagate cleanly, and
    # the contextmanager generator can yield exactly once.
    with contextlib.ExitStack() as stack:
        try:
            stack.enter_context(span_factory(name=name, metadata=attrs))
        except Exception as exc:  # noqa: BLE001 — telemetry never blocks the run
            log.warning("langfuse span %s setup failed: %s — continuing", name, exc)
            # Fall through without the span attached.
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
