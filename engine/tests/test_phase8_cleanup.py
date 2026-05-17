"""Tests for Phase 8 Step 9 cleanup work.

9a — Rule 7 majority-vote threshold math.
9b — Cert-name rename loop salvages a hit when the rename clears
     layers (a)-(c).
"""

from __future__ import annotations

import numpy as np
import pytest

from engine.agent.candidate import CandidateReference, RawCandidate
from engine.rules import rule_07_references, rule_10_cert_name
from engine.rules.dispatcher import RuleContext


# ── 9a: Rule 7 majority-vote arithmetic ─────────────────────────


class TestMajorityFailThreshold:
    @pytest.mark.parametrize(
        "total,threshold",
        [
            (0, 0),  # No refs at all → no threshold (rule passes).
            (1, 1),  # 1 ref → 1 no fails (degenerate; behaves like Phase 6).
            (2, 1),  # 2 refs → 1 no fails (majority).
            (3, 2),  # 3 refs → 2 nos fail. Phase 6 rule killed at 1.
            (4, 2),  # 4 refs → 2 nos fail.
            (5, 3),  # 5 refs → 3 nos fail.
        ],
    )
    def test_threshold(self, total: int, threshold: int) -> None:
        assert rule_07_references.majority_fail_threshold(total) == threshold

    def test_phase_6_regression_authoritative_source(self) -> None:
        """The architectural acceptance case: 3 refs, 1 'no' from
        an authoritative source like NIST. Phase 6 killed; Phase 8
        survives. The threshold math is the proof — for total=3 the
        threshold is 2, so 1 no is below threshold."""
        assert rule_07_references.majority_fail_threshold(3) == 2


# ── 9b: Cert-name rename loop ───────────────────────────────────


class FakeCompletion:
    def __init__(self, text: str) -> None:
        self.text = text
        self.cost_usd = 0.0
        self.tokens_in = 0
        self.tokens_out = 0


class FakeOrClient:
    """Records every prompt; returns canned replies based on the span tag."""

    def __init__(self, judge_returns_yes_for: set[str], rename_returns: str) -> None:
        self.judge_returns_yes_for = judge_returns_yes_for
        self.rename_returns = rename_returns
        self.calls: list[tuple[str, str]] = []  # (span, content_excerpt)

    def complete(self, messages, *, model=None, max_tokens=2048, temperature=0.3, span="t"):
        user = messages[-1]["content"]
        self.calls.append((span, user[:80]))
        if span == "rule_10.cert_judge":
            # Layer (c). messages[-1] is the judge prompt with the
            # title in it.
            for needle in self.judge_returns_yes_for:
                if needle in user:
                    return FakeCompletion("yes")
            return FakeCompletion("no")
        if span == "rule_10.rename":
            return FakeCompletion(self.rename_returns)
        raise AssertionError(f"unexpected span: {span}")


def _ctx(or_client) -> RuleContext:
    return RuleContext(
        category_names={"Cybersecurity"},
        courses_matrix=np.zeros((0, 1024), dtype=np.float32),
        course_ids=[],
        course_names=[],
        recent_rejection_matrix=None,
        or_client=or_client,
        ledger=None,
    )


def _make(title: str) -> RawCandidate:
    return RawCandidate(
        title=title,
        rationale="rationale text long enough.",
        proposed_subcategory=None,
        target_audience="DevSecOps engineers",
        duration_days=2,
        delivery_format="instructor-led",
        suggested_price_usd=3200,
        price_basis="Provider A and Provider B at $2,800 and $3,400.",
        references=[
            CandidateReference(name="A", url="https://a.example/"),
            CandidateReference(name="B", url="https://b.example/"),
            CandidateReference(name="C", url="https://c.example/"),
        ],
        category="Cybersecurity",
    )


class TestRule10RenameLoop:
    def setup_method(self) -> None:
        rule_10_cert_name.reset_cache()

    def test_layer_a_blocklist_with_clean_rename_salvages(self) -> None:
        """Title that hits the static blocklist (e.g. 'CISSP') gets
        renamed to a neutral title that clears all three layers.
        Result: rule_10 passes; candidate.title is the neutral one."""
        candidate = _make("CISSP Bootcamp for Security Architects")
        clean_rename = "Cloud Security Architecture for Enterprise Teams"
        fake = FakeOrClient(
            judge_returns_yes_for=set(),  # judge says no on the rename
            rename_returns=clean_rename,
        )
        result = rule_10_cert_name.check(candidate, _ctx(fake))
        assert result.ok, result.reason
        assert candidate.title == clean_rename
        # One rename call expected — no second-pass on the clean title.
        assert any(span == "rule_10.rename" for span, _ in fake.calls)

    def test_layer_c_flag_then_clean_rename_salvages(self) -> None:
        """Layer (c) flags the original; rename produces a clean
        title; layer (c) on the rename returns no. Candidate
        passes via the rename path."""
        candidate = _make("AWS Certified Solutions Architect Workshop")
        clean = "Cloud Architecture Strategy for Engineering Leaders"
        # Judge says yes on anything containing "Certified Solutions";
        # the clean rename doesn't contain it.
        fake = FakeOrClient(
            judge_returns_yes_for={"Certified Solutions"},
            rename_returns=clean,
        )
        result = rule_10_cert_name.check(candidate, _ctx(fake))
        assert result.ok, result.reason
        assert candidate.title == clean

    def test_rename_also_dirty_drops(self) -> None:
        """When the rename ALSO contains a blocklist token, the
        candidate is dropped (not infinite-recursed)."""
        candidate = _make("CISSP Exam Prep")
        dirty_rename = "Another CISSP Workshop"  # rename is still dirty
        fake = FakeOrClient(
            judge_returns_yes_for=set(),
            rename_returns=dirty_rename,
        )
        result = rule_10_cert_name.check(candidate, _ctx(fake))
        assert not result.ok
        assert "dropped" in result.reason.lower() or "cissp" in result.reason.lower()

    def test_rename_failure_drops(self) -> None:
        """When the rename call returns empty text, candidate is dropped."""
        candidate = _make("CISSP Bootcamp")
        fake = FakeOrClient(
            judge_returns_yes_for=set(),
            rename_returns="",  # empty rename — _ask_rename returns None
        )
        result = rule_10_cert_name.check(candidate, _ctx(fake))
        assert not result.ok
        assert "rename failed" in result.reason.lower() or "blocklist" in result.reason.lower()
