"""Unit tests for the per-category guardrail dominance logic.

Live DB calls live behind ``_dominant_rejection_tag``; tests exercise
the pure ``_count_dominant_tag`` helper instead so they run offline
in <1s.
"""

from __future__ import annotations

from engine.agent.guardrails import (
    MIN_DOMINANT_COUNT,
    _GUARDRAILS,
    _count_dominant_tag,
)


def _row(category: str, tags: list[str]) -> dict:
    return {"reason_tags": tags, "suggestions": {"category": category}}


class TestGuardrailJsonLoad:
    def test_loads_seed_categories(self) -> None:
        # The two Phase 8 doc-seeded entries are present.
        assert "Cybersecurity" in _GUARDRAILS
        assert "Data Analytics" in _GUARDRAILS

    def test_doc_field_filtered_out(self) -> None:
        # The `_doc` array exists in the JSON but must not show up
        # as a category — _load_guardrails strips underscore keys.
        assert "_doc" not in _GUARDRAILS

    def test_entries_have_required_fields(self) -> None:
        for name, entry in _GUARDRAILS.items():
            assert "trigger_tag" in entry, name
            assert "addendum" in entry, name
            assert len(entry["addendum"]) > 40, name  # non-trivial


class TestCountDominantTag:
    def test_returns_none_for_empty_rows(self) -> None:
        assert _count_dominant_tag([], "Cybersecurity") is None

    def test_returns_none_when_below_threshold(self) -> None:
        rows = [_row("Cybersecurity", ["too_niche"])]
        # Only one rejection → below MIN_DOMINANT_COUNT (2).
        assert _count_dominant_tag(rows, "Cybersecurity") is None

    def test_returns_dominant_tag_when_above_threshold(self) -> None:
        rows = [
            _row("Cybersecurity", ["not_instructor_led_market"]),
            _row("Cybersecurity", ["not_instructor_led_market", "too_niche"]),
            _row("Cybersecurity", ["not_instructor_led_market"]),
        ]
        result = _count_dominant_tag(rows, "Cybersecurity")
        assert result is not None
        tag, count = result
        assert tag == "not_instructor_led_market"
        assert count == 3
        # Sanity: meets threshold.
        assert count >= MIN_DOMINANT_COUNT

    def test_ignores_rows_from_other_categories(self) -> None:
        rows = [
            _row("Cybersecurity", ["too_niche"]),
            _row("Data Analytics", ["too_niche"]),
            _row("Data Analytics", ["too_niche"]),
        ]
        # Cybersecurity: only 1 hit → None. Data Analytics: 2 → fires.
        assert _count_dominant_tag(rows, "Cybersecurity") is None
        result = _count_dominant_tag(rows, "Data Analytics")
        assert result == ("too_niche", 2)

    def test_picks_most_common_when_ties_break_naturally(self) -> None:
        # Counter.most_common returns the most common; ties are
        # broken by insertion order. Either tag would be defensible
        # in a tie, but the function is deterministic — assert that.
        rows = [
            _row("Cybersecurity", ["a"]),
            _row("Cybersecurity", ["a"]),
            _row("Cybersecurity", ["b"]),
            _row("Cybersecurity", ["b"]),
        ]
        result = _count_dominant_tag(rows, "Cybersecurity")
        assert result is not None
        # Both tags hit count=2; the first-seen one wins.
        assert result[0] == "a"
        assert result[1] == 2

    def test_ignores_rows_with_no_tags(self) -> None:
        rows = [
            _row("Cybersecurity", []),
            _row("Cybersecurity", []),
        ]
        assert _count_dominant_tag(rows, "Cybersecurity") is None
