"""#159 — every 6 months (`semiannual`) steps and rolls forward like the other month cadences."""
import datetime

import pytest

from app.services.cadence import CADENCES, roll_forward, step

D = datetime.date


def test_semiannual_is_an_allowed_cadence():
    assert "semiannual" in CADENCES


@pytest.mark.parametrize("anchor, n, expected", [
    (D(2026, 3, 6), 0, D(2026, 3, 6)),
    (D(2026, 3, 6), 1, D(2026, 9, 6)),
    (D(2026, 3, 6), 2, D(2027, 3, 6)),
    (D(2026, 3, 6), -1, D(2025, 9, 6)),
    (D(2026, 8, 31), 1, D(2027, 2, 28)),   # month-end anchor clamps to the short month
    (D(2027, 2, 28), 1, D(2027, 8, 28)),   # ...and stepping from the clamped date does not recover the 31st
    (D(2026, 8, 31), 2, D(2027, 8, 31)),   # stepping from the anchor always does
])
def test_step_six_months(anchor, n, expected):
    assert step("semiannual", None, anchor, n) == expected


@pytest.mark.parametrize("as_of, expected", [
    (D(2026, 8, 31), D(2026, 8, 31)),
    (D(2026, 9, 1), D(2027, 2, 28)),
    (D(2027, 2, 28), D(2027, 2, 28)),
    (D(2027, 3, 1), D(2027, 8, 31)),
])
def test_roll_forward_six_months_from_a_month_end_anchor(as_of, expected):
    assert roll_forward("semiannual", None, D(2026, 8, 31), as_of=as_of) == expected


def test_an_unknown_cadence_is_still_not_allowed():
    assert "biannual" not in CADENCES
