"""Unit tests for the free / cheap rule modules.

Tests cover rules 3, 4, 5+8 (structural), 6, and rule 10 layers (a)+(b).
The expensive rules (2, 7, 9 — Voyage embeddings + URL fetch + LLM
judges) get their own integration coverage in the E2E run.

Cert-name layer (c) tests live in test_rule_10_layer_c.py once the
OpenRouter wrapper mock fixture stabilizes — Phase 6 Step 7 work.
"""

from __future__ import annotations

import numpy as np
import pytest

from engine.agent.candidate import CandidateReference, RawCandidate
from engine.rules import (
    rule_03_price,
    rule_04_format,
    rule_05_08_structural,
    rule_06_category,
    rule_10_cert_name,
)
from engine.rules.dispatcher import RuleContext


def _ctx(category_names: set[str] | None = None) -> RuleContext:
    return RuleContext(
        category_names=category_names or {"Data Privacy and Security", "Cybersecurity"},
        courses_matrix=np.zeros((0, 1024), dtype=np.float32),
        course_ids=[],
        course_names=[],
        recent_rejection_matrix=None,
        or_client=None,
        ledger=None,
    )


def _make(**overrides) -> RawCandidate:
    base = {
        "title": "European Data Privacy & GDPR Compliance for Enterprise Teams",
        "rationale": "Sustained Q4 demand from EU clients; catalogue under-supplied.",
        "proposed_subcategory": "GDPR Compliance",
        "target_audience": "DPOs, Legal & compliance leads",
        "duration_days": 3,
        "delivery_format": "instructor-led",
        "suggested_price_usd": 3200,
        "price_basis": "Two market comparables at $2,900 and $3,400; both 3-day.",
        "references": [
            CandidateReference(name="IAPP", url="https://iapp.org/cert/cippe/"),
            CandidateReference(name="ICO", url="https://ico.org.uk/"),
            CandidateReference(name="EU Commission", url="https://commission.europa.eu/"),
        ],
        "category": "Data Privacy and Security",
    }
    base.update(overrides)
    return RawCandidate(**base)


# ── Rule 3: price ─────────────────────────────────────────────
class TestRule03:
    def test_passes_above_2500(self) -> None:
        result = rule_03_price.check(_make(suggested_price_usd=2501), _ctx())
        assert result.ok

    def test_fails_at_2500_exactly(self) -> None:
        result = rule_03_price.check(_make(suggested_price_usd=2500), _ctx())
        assert not result.ok
        assert "$2500" in result.reason

    def test_fails_below_2500(self) -> None:
        result = rule_03_price.check(_make(suggested_price_usd=1800), _ctx())
        assert not result.ok


# ── Rule 4: format ────────────────────────────────────────────
class TestRule04:
    def test_passes_exact_match(self) -> None:
        assert rule_04_format.check(_make(delivery_format="instructor-led"), _ctx()).ok

    def test_passes_case_or_whitespace(self) -> None:
        assert rule_04_format.check(_make(delivery_format="Instructor Led"), _ctx()).ok
        assert rule_04_format.check(_make(delivery_format="  INSTRUCTOR-LED "), _ctx()).ok

    def test_fails_self_paced(self) -> None:
        r = rule_04_format.check(_make(delivery_format="self-paced"), _ctx())
        assert not r.ok
        assert "self-paced" in r.reason

    def test_fails_e_learning(self) -> None:
        assert not rule_04_format.check(_make(delivery_format="e-learning"), _ctx()).ok


# ── Rule 6: category mapping ──────────────────────────────────
class TestRule06:
    def test_passes_known_category(self) -> None:
        assert rule_06_category.check(_make(category="Cybersecurity"), _ctx()).ok

    def test_fails_unknown_category(self) -> None:
        r = rule_06_category.check(_make(category="Made Up Topic"), _ctx())
        assert not r.ok
        assert "Made Up Topic" in r.reason

    def test_fails_when_category_none(self) -> None:
        c = _make()
        c = c.model_copy(update={"category": None})
        assert not rule_06_category.check(c, _ctx()).ok


# ── Rule 5/8: structural ──────────────────────────────────────
class TestRule05_08:
    def test_passes_with_three_refs_and_two_prices(self) -> None:
        assert rule_05_08_structural.check(_make(), _ctx()).ok

    def test_fails_under_three_refs(self) -> None:
        c = _make(
            references=[
                CandidateReference(name="A", url="https://a.com/"),
                CandidateReference(name="B", url="https://b.com/"),
            ]
        )
        r = rule_05_08_structural.check(c, _ctx())
        assert not r.ok
        assert "references count" in r.reason

    def test_fails_when_price_basis_has_zero_dollar_amounts(self) -> None:
        c = _make(price_basis="Vendors charge a premium in this niche.")
        r = rule_05_08_structural.check(c, _ctx())
        assert not r.ok
        assert "dollar amount" in r.reason

    def test_fails_when_price_basis_has_only_one_dollar_amount(self) -> None:
        c = _make(price_basis="One comparable at $2,800.")
        r = rule_05_08_structural.check(c, _ctx())
        assert not r.ok

    def test_passes_with_two_distinct_prices(self) -> None:
        c = _make(price_basis="Vendor A charges $3,200; Vendor B charges $2,800.")
        assert rule_05_08_structural.check(c, _ctx()).ok


# ── Rule 10: cert name (layers a + b) ─────────────────────────
@pytest.fixture(autouse=True)
def _reset_cert_cache() -> None:
    rule_10_cert_name.reset_cache()


class TestRule10:
    def test_passes_clean_title(self) -> None:
        assert rule_10_cert_name.check(_make(), _ctx()).ok

    def test_fails_blocklist_acronym(self) -> None:
        r = rule_10_cert_name.check(_make(title="CIPP/E Exam Prep Workshop"), _ctx())
        assert not r.ok
        # Either blocklist or regex can fire first — both are layer (a/b) catches.
        assert "cert" in r.reason.lower()

    def test_fails_certified_prefix(self) -> None:
        r = rule_10_cert_name.check(_make(title="Certified Privacy Officer Bootcamp"), _ctx())
        assert not r.ok
        assert "cert" in r.reason.lower()

    def test_fails_certification_suffix(self) -> None:
        r = rule_10_cert_name.check(_make(title="GDPR Foundation Certification Course"), _ctx())
        assert not r.ok

    def test_fails_certifying_body_name(self) -> None:
        r = rule_10_cert_name.check(
            _make(title="IAPP-aligned Privacy Training for Enterprises"),
            _ctx(),
        )
        assert not r.ok
        assert "iapp" in r.reason.lower() or "IAPP" in r.reason

    def test_short_acronym_matched_as_whole_word_only(self) -> None:
        # 'CISA' must not false-positive against words like 'civilian'.
        r = rule_10_cert_name.check(_make(title="Civilian Cyber Defence Programme"), _ctx())
        assert r.ok

    def test_passes_when_credential_only_in_references(self) -> None:
        c = _make(
            title="European Data Privacy Compliance for Enterprise Teams",
            references=[
                CandidateReference(name="IAPP CIPP/E", url="https://iapp.org/cert/cippe/"),
                CandidateReference(name="ICO", url="https://ico.org.uk/"),
                CandidateReference(name="EU Commission", url="https://commission.europa.eu/"),
            ],
        )
        assert rule_10_cert_name.check(c, _ctx()).ok
