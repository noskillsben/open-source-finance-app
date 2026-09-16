"""Archive/unarchive for non-ledger rows — one mechanism built against the shared `NonLedger`
mixin, not per-entity logic (DESIGN.md § General concepts → Non-ledger rows are archived,
never deleted). A new entity gets this behaviour the day its table exists.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Sequence

from sqlalchemy import ColumnElement, or_


def visible_as_of(model, as_of: date | None) -> ColumnElement[bool]:
    """The row-visibility half of DESIGN.md § General concepts → Non-ledger rows are
    archived: "A row is shown on a given picker date if `created_on <= date` and
    (`archived_on` is null or `date < archived_on`)." With no `as_of`, keep today's
    existing behaviour of excluding archived rows only — the picker date, never wall-clock
    "today", is the only thing this defaults against.
    """
    if as_of is None:
        return model.archived_on.is_(None)
    return (model.created_on <= as_of) & (or_(model.archived_on.is_(None), as_of < model.archived_on))


class ArchiveError(Exception):
    """A settings-surface rule refused the archive — a block, not a ledger validation
    (DESIGN.md § General concepts → The only thing the app refuses to record is money that
    does not exist: archiving is a planning surface, so blocks are allowed here).
    """


@dataclass
class Archivable:
    """One non-ledger entity wired up with what the archive rules need to know about it, so
    `archive()` never has to ask what kind of entity it is holding.
    """

    entity: object
    latest_ledger_date: date | None
    balance_cents: int | None = None
    children: Sequence["Archivable"] = field(default_factory=tuple)


def archive(target: Archivable, archived_on: date) -> list[str]:
    """Set `archived_on` on `target` and, recursively, on its children with the same date
    (DESIGN.md: "Archiving a category with children archives the children with the same
    date"). Returns warnings for a non-zero balance as of the archive date — a warning, never
    a block (DESIGN.md: "Archiving an account or category with a non-zero balance ... is a
    warning, not a block").
    """
    if target.latest_ledger_date is not None and archived_on <= target.latest_ledger_date:
        raise ArchiveError(
            f"cannot archive on {archived_on}: a ledger row dated {target.latest_ledger_date} "
            "still references it"
        )

    warnings = []
    if target.balance_cents:
        warnings.append(f"non-zero balance ({target.balance_cents} cents) as of {archived_on}")

    target.entity.archived_on = archived_on
    for child in target.children:
        warnings.extend(archive(child, archived_on))
    return warnings


def unarchive(entity) -> None:
    """Clear `archived_on` entirely — the entity reappears at every date since `created_on`,
    including periods during which it had been archived; the app remembers only the current
    state (DESIGN.md). A name now taken by another active row surfaces as an `IntegrityError`
    on flush, the same path `create` already uses.
    """
    entity.archived_on = None
