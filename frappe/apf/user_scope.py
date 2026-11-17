"""Server-side partner / geography scope enforcement for whitelisted endpoints.

Why this exists
---------------
Many dashboard / report endpoints accept ``partner_id``, ``state_id`` ...
``creche_id`` straight from the request and let them *override* the caller's own
``User.partner`` and ``User Geography Mapping``. Any logged-in user could
therefore read any partner's or region's data (and the child endpoints accepted a
child id with no ownership check at all).

How to use
----------
* ``@scoped()`` under ``@frappe.whitelist()`` for endpoints whose SQL already
  falls back to the user's mapping when a filter is empty.
* ``@scoped(mode="inject")`` for endpoints whose SQL has no mapping logic: the
  user's own partner / geography is injected and broader requests are rejected.
* ``authorize_creche()`` / ``authorize_child()`` for endpoints that act on one
  record.
* ``scope_conditions()`` for raw-SQL endpoints that need the scope in the WHERE.

The decision logic is framework free and unit tested:
``frappe/apf/scope_logic.py`` / ``frappe/tests/test_scope_logic.py``.

Who is unrestricted?
--------------------
* ``Administrator`` and anyone with the ``System Manager`` role.
* Legacy behaviour (kept so existing national users do not break): a *System
  User* with no partner and no geography mapping. To tighten this, set
  ``user_scope_unrestricted_roles`` in site_config.json, e.g.
  ``["Foundation Central Team", "Full Admin"]``; then only users holding one of
  those roles (or System Manager) stay unrestricted. Everyone else with no
  partner/mapping is denied.
"""

import functools
import inspect

import frappe
from frappe import _
from frappe.apf import scope_logic as sl

# request argument / filter-key name -> canonical scope key.
# NOTE: every one of these carries a record *id* (the auto-increment ``name``).
_ALIASES = {
	"partner_id": "partner_id",
	"partner": "partner_id",
	"state_id": "state_id",
	"state": "state_id",
	"district_id": "district_id",
	"district": "district_id",
	"block_id": "block_id",
	"block": "block_id",
	"gp_id": "gp_id",
	"gp": "gp_id",
	"village_id": "village_id",
	"village": "village_id",
	"creche_id": "creche_id",
	"creche": "creche_id",
}

_GEO_DOCTYPES = {
	"state_id": ("State", []),
	"district_id": ("District", ["state_id"]),
	"block_id": ("Block", ["state_id", "district_id"]),
	"gp_id": ("Gram Panchayat", ["state_id", "district_id", "block_id"]),
	"village_id": ("Village", ["state_id", "district_id", "block_id", "gp_id"]),
}
_CRECHE_FIELDS = ["partner_id", "state_id", "district_id", "block_id", "gp_id", "village_id"]
_CHILD_FIELDS = _CRECHE_FIELDS  # Child Enrollment and Exit carries the same columns

_DENIED_MSG = "You are not permitted to access data outside your assigned partner or geography."


def _deny(exc=None):
	frappe.throw(_(_DENIED_MSG), frappe.PermissionError)


def _invalid():
	frappe.throw(_("Invalid filter value."), frappe.ValidationError)


def _request_cache(name):
	cache = getattr(frappe.local, name, None)
	if cache is None:
		cache = {}
		setattr(frappe.local, name, cache)
	return cache


# --------------------------------------------------------------------------
# scope of the current user
# --------------------------------------------------------------------------
def get_user_scope(user=None) -> sl.Scope:
	user = user or frappe.session.user
	cache = _request_cache("_apf_user_scope_cache")
	if user in cache:
		return cache[user]

	if user == "Guest":
		scope = sl.Scope(denied=True)
	elif user == "Administrator":
		scope = sl.Scope(unrestricted=True)
	else:
		roles = set(frappe.get_roles(user))
		partner = sl._clean(frappe.db.get_value("User", user, "partner"))
		rows = frappe.db.sql(
			"""SELECT state_id, district_id, block_id, gp_id, village_id
			FROM `tabUser Geography Mapping` WHERE parent = %s""",
			(user,),
			as_dict=True,
		)
		rows = [r for r in (sl.normalise_row(r) for r in rows) if any(r.values())]

		if "System Manager" in roles:
			scope = sl.Scope(unrestricted=True)
		elif partner or rows:
			scope = sl.Scope(partner=partner, rows=rows)
		else:
			# no partner and no mapping: legacy "national" user
			allowed_roles = set(frappe.conf.get("user_scope_unrestricted_roles") or [])
			is_system_user = frappe.db.get_value("User", user, "user_type") == "System User"
			legacy_ok = is_system_user and (not allowed_roles or bool(roles & allowed_roles))
			scope = sl.Scope(unrestricted=legacy_ok, denied=not legacy_ok)

	cache[user] = scope
	return scope


# --------------------------------------------------------------------------
# record look-ups (ancestry paths), cached per request
# --------------------------------------------------------------------------
def _lookup(key, token):
	cache = _request_cache("_apf_scope_lookup_cache")
	ck = (key, token)
	if ck in cache:
		return cache[ck]

	if key == "creche_id":
		row = frappe.db.get_value("Creche", token, _CRECHE_FIELDS, as_dict=True)
		path = None if row is None else {k: v for k, v in row.items()}
	else:
		doctype, ancestors = _GEO_DOCTYPES[key]
		if ancestors:
			row = frappe.db.get_value(doctype, token, ancestors, as_dict=True)
			path = None if row is None else {k: v for k, v in row.items()}
		else:
			path = {} if frappe.db.exists(doctype, token) else None
		if path is not None:
			path[key] = token

	cache[ck] = path
	return path


# --------------------------------------------------------------------------
# decorator for whitelisted endpoints
# --------------------------------------------------------------------------
def _filters_as_dict(value):
	if isinstance(value, str):
		try:
			value = frappe.parse_json(value)
		except Exception:
			return None
	if isinstance(value, dict):
		return frappe._dict(value)
	return None


def scoped(mode="mapping"):
	"""Enforce the caller's partner / geography scope on a whitelisted endpoint.

	Put it *under* ``@frappe.whitelist()``. See the module docstring for ``mode``.
	"""

	def decorator(fn):
		signature = inspect.signature(fn)
		varkw = next(
			(n for n, p in signature.parameters.items() if p.kind is inspect.Parameter.VAR_KEYWORD),
			None,
		)

		@functools.wraps(fn)
		def wrapper(*args, **kwargs):
			bound = signature.bind_partial(*args, **kwargs)
			arguments = bound.arguments

			# ``usr`` / ``pw`` arguments were trusted as identity. The caller is
			# always the authenticated session user.
			if "usr" in signature.parameters:
				arguments["usr"] = frappe.session.user

			scope = get_user_scope()
			if scope.unrestricted:
				return fn(*bound.args, **bound.kwargs)
			if scope.denied:
				_deny()

			# normalise a ``filters`` argument (dict or JSON string) to a private dict
			filters = None
			if "filters" in arguments:
				filters = _filters_as_dict(arguments["filters"])
				if filters is not None:
					arguments["filters"] = filters

			form = frappe.form_dict

			# endpoints declared as fn(**kwargs) receive everything in one bag
			# (bind_partial omits the bag when no extra argument was passed)
			kw_bag = None
			if varkw:
				kw_bag = arguments.get(varkw)
				if not isinstance(kw_bag, dict):
					kw_bag = arguments[varkw] = {}

			# gather every scope-relevant value the request carries
			found = []  # (canonical key, holder, key)
			for name, value in arguments.items():
				canon = _ALIASES.get(name)
				if canon and name != varkw and sl.is_set(value):
					found.append((canon, arguments, name))
			if kw_bag is not None:
				for name, value in list(kw_bag.items()):
					canon = _ALIASES.get(name)
					if canon and sl.is_set(value):
						found.append((canon, kw_bag, name))
			if filters is not None:
				for name, value in list(filters.items()):
					canon = _ALIASES.get(name)
					if canon and sl.is_set(value):
						found.append((canon, filters, name))
			for name, canon in _ALIASES.items():
				if name in form and sl.is_set(form.get(name)):
					found.append((canon, form, name))

			requested = {}
			try:
				for canon, holder, name in found:
					tokens = sl.parse_ids(holder[name])
					bucket = requested.setdefault(canon, [])
					bucket.extend(t for t in tokens if t not in bucket)
			except sl.InvalidFilter:
				_invalid()

			try:
				decision = sl.evaluate_request(scope, requested, _lookup, mode)
			except sl.ScopeViolation:
				_deny()

			for canon, holder, name in found:
				if canon in decision.drop:
					holder[name] = None

			for canon, value in decision.inject.items():
				for name in signature.parameters:
					if _ALIASES.get(name) == canon:
						arguments[name] = value
				form[canon] = value  # endpoints that read frappe.form_dict directly
				if kw_bag is not None:
					kw_bag[canon] = value
				if filters is not None:
					# reports key their filters as "state" / "district" / ... as well as "state_id"
					for alias, alias_canon in _ALIASES.items():
						if alias_canon == canon:
							filters[alias] = value

			return fn(*bound.args, **bound.kwargs)

		return wrapper

	return decorator


# --------------------------------------------------------------------------
# single-record authorisation (write APIs, per-child endpoints)
# --------------------------------------------------------------------------
def authorize_creche(creche_id) -> dict:
	"""Return the creche's authoritative partner/geography, or raise PermissionError.

	Callers should write *these* values to new records instead of trusting the
	partner/state/district/... the client sent.
	"""
	try:
		tokens = sl.parse_ids(creche_id)
	except sl.InvalidFilter:
		_invalid()
	if len(tokens) != 1:
		_invalid()

	path = _lookup("creche_id", tokens[0])
	if path is None:
		frappe.throw(_("Creche not found."), frappe.DoesNotExistError)
	try:
		sl.authorize_entity(get_user_scope(), path)
	except sl.ScopeViolation:
		_deny()
	return path


def authorize_child(child_name):
	"""Ensure the *Child Enrollment and Exit* record is inside the caller's scope.

	``child_name`` is normally the record ``name`` (an integer id); for backwards
	compatibility a child's display name is resolved to its record first.
	Returns the record name (or ``None`` if there is no such child).
	"""
	doctype = "Child Enrollment and Exit"
	name = None if child_name is None else str(child_name).strip()
	if not name:
		return None
	if not name.isascii() or not name.isdigit():
		name = frappe.db.get_value(doctype, {"child_name": name}, "name")
		if not name:
			return None

	row = frappe.db.get_value(doctype, name, _CHILD_FIELDS, as_dict=True)
	if row is None:
		return None
	try:
		sl.authorize_entity(get_user_scope(), row)
	except sl.ScopeViolation:
		_deny()
	return str(name)


# --------------------------------------------------------------------------
# raw SQL helper
# --------------------------------------------------------------------------
def scope_conditions(alias, params) -> str:
	"""Return `` AND ...`` restricting ``alias`` (a table with partner_id and the
	geography id columns, e.g. ``tabCreche``) to the caller's scope.

	Bound parameters are added to ``params``. Empty string for unrestricted users.
	``alias`` must be a developer-supplied constant, never request data.
	"""
	scope = get_user_scope()
	if scope.unrestricted:
		return ""
	if scope.denied:
		return " AND 1 = 0"

	clauses = []
	if scope.partner:
		params["_sc_partner"] = scope.partner
		clauses.append(f"{alias}.partner_id = %(_sc_partner)s")

	ors = []
	for i, row in enumerate(scope.rows):
		ands = []
		for level in sl.GEO_LEVELS:
			if row.get(level) is not None:
				key = f"_sc_{level}_{i}"
				params[key] = row[level]
				ands.append(f"{alias}.{level} = %({key})s")
		if ands:
			ors.append("(" + " AND ".join(ands) + ")")
	if ors:
		clauses.append("(" + " OR ".join(ors) + ")")

	return "".join(f" AND {c}" for c in clauses)
