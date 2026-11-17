"""Pure (framework-free) logic for server-side data-scope enforcement.

This module deliberately does NOT import frappe so it can be unit tested
anywhere. ``frappe.apf.user_scope`` wraps it with the database lookups and the
decorator used on whitelisted endpoints.

Vocabulary
----------
* A user's *scope* is an optional partner plus zero or more geography
  *mapping rows* (rows of the ``User Geography Mapping`` child table). Each row
  is a path such as ``(state, district, block, gp, village)`` where trailing
  levels may be empty (a state-level row covers the whole state).
* A *requested* value (partner / state / district / block / gp / village /
  creche) is checked against that scope. Because the UI may legitimately ask for
  a coarser level than the user is mapped to (a GP-mapped user opening the state
  dropdown), a request is classified as:

    ``full``     some mapping row fully contains the requested entity
    ``partial``  rows only cover *part* of it (request is an ancestor of a row)
    ``none``     no row touches the requested entity -> reject

Modes
-----
``mapping``  the endpoint's SQL already falls back to the user's mapping when a
             level is empty, so a *partial* request is narrowed by dropping that
             filter.
``inject``   the endpoint's SQL has no mapping logic, so a *partial* request is
             rejected and, when the user supplies nothing, the user's own
             partner / geography is injected (only possible when the user has a
             single mapping row; otherwise the user must pick a region).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

GEO_LEVELS = ("state_id", "district_id", "block_id", "gp_id", "village_id")
LEVEL_RANK = {level: i for i, level in enumerate(GEO_LEVELS)}
# a creche sits at the deepest level (it has a village)
CRECHE_RANK = len(GEO_LEVELS) - 1

# values the UI (or a lazy client) sends to mean "no filter"
_UNSET = {"", "0", "none", "null", "undefined"}
_DIGITS = re.compile(r"[0-9]+")


class ScopeViolation(Exception):
    """The request asks for data outside the caller's scope."""


class InvalidFilter(Exception):
    """A filter value is not a valid record id."""


@dataclass
class Scope:
    partner: str | None = None
    rows: list = field(default_factory=list)  # list[dict[level -> str | None]]
    unrestricted: bool = False
    denied: bool = False


@dataclass
class Decision:
    drop: set = field(default_factory=set)  # canonical keys to blank out
    inject: dict = field(default_factory=dict)  # canonical key -> value to set


def parse_ids(value) -> list:
    """Return the list of normalised id tokens in ``value``.

    Accepts a scalar, a comma separated string, or a list/tuple/set. Empty and
    "null-like" tokens are ignored. Anything else that is not purely numeric
    raises :class:`InvalidFilter` (every id in this app is an auto-increment
    integer, so a non-numeric value can only be a mistake or an attack).
    """
    if value is None or value is False:
        return []
    if isinstance(value, (list, tuple, set, frozenset)):
        tokens = list(value)
    else:
        tokens = str(value).split(",")

    out = []
    for token in tokens:
        token = str(token).strip()
        if token.lower() in _UNSET:
            continue
        if not _DIGITS.fullmatch(token):
            raise InvalidFilter(token)
        out.append(str(int(token)))
    return out


def is_set(value) -> bool:
    """True when ``value`` carries a real filter (not None/''/'null'/...)."""
    if value is None or value is False:
        return False
    if isinstance(value, (list, tuple, set, frozenset, dict)):
        return bool(value)
    return str(value).strip().lower() not in _UNSET


def _clean(value):
    if value is None:
        return None
    value = str(value).strip()
    return None if value.lower() in _UNSET else str(int(value)) if value.isdigit() else value


def normalise_row(row) -> dict:
    return {level: _clean(row.get(level)) for level in GEO_LEVELS}


def classify(rows, path, rank) -> str:
    """Classify an entity (``path`` = known ancestry up to level ``rank``).

    Returns ``"full"``, ``"partial"`` or ``"none"``. See module docstring.
    """
    best = "none"
    for row in rows:
        intersects = True
        deeper = False
        for level, rk in LEVEL_RANK.items():
            row_value = row.get(level)
            if row_value is None:
                continue
            if rk <= rank:
                if _clean(path.get(level)) != row_value:
                    intersects = False
                    break
            else:
                deeper = True
        if not intersects:
            continue
        if not deeper:
            return "full"
        best = "partial"
    return best


def single_row(rows) -> dict:
    """The user's mapping as one filter set, or ``{}`` when it cannot be.

    Only when every mapping row is the *same* path can the mapping be expressed
    as plain single-valued filters without widening it. (A common prefix of
    several different rows would be broader than the user's real mapping.)
    """
    distinct = {tuple(row.get(level) for level in GEO_LEVELS) for row in rows}
    if len(distinct) != 1:
        return {}
    only = next(iter(distinct))
    return {level: value for level, value in zip(GEO_LEVELS, only) if value is not None}


def authorize_entity(scope: Scope, path: dict) -> None:
    """Check one fully resolved record (a creche, a child, ...).

    ``path`` carries ``partner_id`` plus every geography level of the record.
    :raises ScopeViolation: if the record is outside the caller's scope.
    """
    if scope.unrestricted:
        return
    if scope.denied:
        raise ScopeViolation("no data scope is assigned to this user")
    if scope.partner and _clean(path.get("partner_id")) != scope.partner:
        raise ScopeViolation("record belongs to another partner")
    if scope.rows and classify(scope.rows, path, CRECHE_RANK) == "none":
        raise ScopeViolation("record is outside the user's geography")


def evaluate_request(scope: Scope, requested: dict, lookup, mode: str = "mapping") -> Decision:
    """Validate ``requested`` against ``scope``.

    :param requested: canonical key (``partner_id``, ``state_id`` .. ``village_id``,
        ``creche_id``) -> list of id tokens (already passed through ``parse_ids``).
    :param lookup: ``lookup(canonical_key, token) -> dict | None`` returning the
        entity's ancestry path (and ``partner_id`` for a creche) or ``None`` if the
        record does not exist.
    :raises ScopeViolation: when the request is out of scope.
    """
    if mode not in ("mapping", "inject"):
        raise ValueError(mode)

    decision = Decision()
    if scope.unrestricted:
        return decision
    if scope.denied:
        raise ScopeViolation("no data scope is assigned to this user")

    # ---- partner -----------------------------------------------------------
    for token in requested.get("partner_id", []):
        if scope.partner and token != scope.partner:
            raise ScopeViolation("partner is outside the user's scope")

    # ---- creche ------------------------------------------------------------
    for token in requested.get("creche_id", []):
        path = lookup("creche_id", token)
        if path is None:
            raise ScopeViolation("creche not found or outside the user's scope")
        authorize_entity(scope, path)

    # ---- geography ---------------------------------------------------------
    supplied_geo = False
    verdicts = {}  # level -> "full" | "partial"
    for level in GEO_LEVELS:
        tokens = requested.get(level, [])
        if not tokens:
            continue
        supplied_geo = True
        level_verdict = "full"
        for token in tokens:
            path = lookup(level, token)
            if path is None:
                raise ScopeViolation(f"{level} not found or outside the user's scope")
            if not scope.rows:
                continue  # partner-only user: geography is unrestricted
            verdict = classify(scope.rows, path, LEVEL_RANK[level])
            if verdict == "none":
                raise ScopeViolation(f"{level} is outside the user's geography")
            if verdict == "partial":
                level_verdict = "partial"
        verdicts[level] = level_verdict

    # A coarse level that only partly overlaps the user's mapping is harmless
    # when a *finer* level (or a creche) in the same request is fully covered:
    # every filter is ANDed, so the result stays inside that finer entity. This is
    # exactly what the cascading dropdowns send (state, district, block, gp).
    finest_full = max(
        [LEVEL_RANK[lvl] for lvl, v in verdicts.items() if v == "full"]
        + ([CRECHE_RANK] if requested.get("creche_id") and scope.rows else []),
        default=-1,
    )
    for level, verdict in verdicts.items():
        if verdict != "partial" or LEVEL_RANK[level] < finest_full:
            continue
        if mode == "inject":
            raise ScopeViolation(
                f"{level} is broader than the user's geography; select a narrower one"
            )
        decision.drop.add(level)

    # ---- inject the user's own scope when the endpoint can't derive it -------
    if mode == "inject":
        if scope.partner and not requested.get("partner_id"):
            decision.inject["partner_id"] = scope.partner
        if scope.rows and not supplied_geo and not requested.get("creche_id"):
            only = single_row(scope.rows)
            if not only:
                raise ScopeViolation(
                    "this user is mapped to several regions; select a state/district first"
                )
            decision.inject.update(only)

    return decision
