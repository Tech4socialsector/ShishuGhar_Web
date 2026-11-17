"""Tests for frappe.apf.user_scope against a stubbed ``frappe`` module.

Runs standalone (no bench):  python -I frappe/tests/test_user_scope_decorator.py
Skipped automatically when the real frappe is already imported (bench runner).
"""

import importlib.util
import json
import os
import sys
import types
import unittest

_REAL_FRAPPE = "frappe" in sys.modules and not getattr(sys.modules["frappe"], "_IS_STUB", False)
_HERE = os.path.dirname(os.path.abspath(__file__))
_APF = os.path.join(_HERE, "..", "apf")


class _dict(dict):
	__getattr__ = dict.get

	def __setattr__(self, k, v):
		self[k] = v


class _PermissionError(Exception):
	pass


class _ValidationError(Exception):
	pass


class _DoesNotExistError(Exception):
	pass


class FakeDB:
	"""Minimal frappe.db: users, geography and creches held in dicts."""

	def __init__(self):
		self.users = {}  # user -> {"partner":..., "user_type":...}
		self.mapping = {}  # user -> [rows]
		self.records = {}  # (doctype, name) -> dict

	def get_value(self, doctype, name, fields=None, as_dict=False):
		if doctype == "User":
			rec = self.users.get(name)
			if rec is None:
				return None
			return rec.get(fields) if isinstance(fields, str) else rec
		rec = self.records.get((doctype, str(name)))
		if rec is None:
			return None
		if isinstance(fields, str):
			return rec.get(fields)
		out = {f: rec.get(f) for f in fields}
		return _dict(out) if as_dict else out

	def exists(self, doctype, name):
		return (doctype, str(name)) in self.records

	def sql(self, query, values=(), as_dict=False):
		assert "User Geography Mapping" in query
		return [dict(r) for r in self.mapping.get(values[0], [])]


def _load_modules():
	frappe = types.ModuleType("frappe")
	frappe._IS_STUB = True
	frappe._dict = _dict
	frappe.PermissionError = _PermissionError
	frappe.ValidationError = _ValidationError
	frappe.DoesNotExistError = _DoesNotExistError
	frappe._ = lambda s: s
	frappe.form_dict = _dict()
	frappe.local = types.SimpleNamespace()
	frappe.session = _dict(user="Guest")
	frappe.conf = _dict()
	frappe.db = FakeDB()
	frappe.parse_json = json.loads
	frappe.get_roles = lambda user=None: frappe._roles.get(user, ["All"])
	frappe._roles = {}

	def throw(msg, exc=None, **_):
		raise (exc or Exception)(msg)

	frappe.throw = throw

	apf = types.ModuleType("frappe.apf")
	frappe.apf = apf
	sys.modules["frappe"] = frappe
	sys.modules["frappe.apf"] = apf

	def load(name, path):
		spec = importlib.util.spec_from_file_location(name, path)
		mod = importlib.util.module_from_spec(spec)
		sys.modules[name] = mod
		spec.loader.exec_module(mod)
		return mod

	apf.scope_logic = load("frappe.apf.scope_logic", os.path.join(_APF, "scope_logic.py"))
	apf.user_scope = load("frappe.apf.user_scope", os.path.join(_APF, "user_scope.py"))
	return frappe, apf.user_scope


@unittest.skipIf(_REAL_FRAPPE, "real frappe loaded; stub-based test skipped")
class TestScopedDecorator(unittest.TestCase):
	@classmethod
	def setUpClass(cls):
		cls._saved = {k: sys.modules.get(k) for k in ("frappe", "frappe.apf", "frappe.apf.scope_logic", "frappe.apf.user_scope")}
		cls.frappe, cls.us = _load_modules()

	@classmethod
	def tearDownClass(cls):
		for k, v in cls._saved.items():
			if v is None:
				sys.modules.pop(k, None)
			else:
				sys.modules[k] = v

	def setUp(self):
		f = self.frappe
		f.local = types.SimpleNamespace()  # fresh per-request caches
		f.form_dict = _dict()
		f.conf = _dict()
		f._roles = {}
		db = f.db
		db.users, db.mapping, db.records = {}, {}, {}
		# geography: state 1 > district 10 > block 100 > gp 1000 ; state 2 > district 20
		for dt, name, rec in (
			("State", "1", {}), ("State", "2", {}),
			("District", "10", {"state_id": "1"}), ("District", "20", {"state_id": "2"}),
			("Block", "100", {"state_id": "1", "district_id": "10"}),
			("Gram Panchayat", "1000", {"state_id": "1", "district_id": "10", "block_id": "100"}),
		):
			db.records[(dt, name)] = rec
		db.records[("Creche", "7")] = dict(partner_id="5", state_id="1", district_id="10", block_id="100", gp_id="1000", village_id=None)
		db.records[("Creche", "8")] = dict(partner_id="6", state_id="2", district_id="20", block_id=None, gp_id=None, village_id=None)
		db.records[("Child Enrollment and Exit", "50")] = dict(partner_id="5", state_id="1", district_id="10", block_id="100", gp_id="1000", village_id=None)
		db.records[("Child Enrollment and Exit", "51")] = dict(partner_id="6", state_id="2", district_id="20", block_id=None, gp_id=None, village_id=None)

	def login(self, user, partner=None, rows=(), roles=("Creche Supervisor",), user_type="System User"):
		f = self.frappe
		f.session = _dict(user=user)
		f.db.users[user] = {"partner": partner, "user_type": user_type}
		empty = dict(state_id=None, district_id=None, block_id=None, gp_id=None, village_id=None)
		f.db.mapping[user] = [{**empty, **r} for r in rows]
		f._roles[user] = list(roles)

	def call(self, fn, *a, **k):
		return fn(*a, **k)

	# -- endpoints under test ------------------------------------------------
	def make(self, mode="mapping"):
		scoped = self.us.scoped

		@scoped(mode)
		def dashboard(partner_id=None, state_id=None, district_id=None, gp_id=None, creche_id=None, year=None):
			return dict(partner_id=partner_id, state_id=state_id, district_id=district_id, gp_id=gp_id, creche_id=creche_id)

		@scoped(mode)
		def report(filters=None):
			return dict(filters or {})

		@scoped(mode)
		def bag(**kwargs):
			return dict(kwargs)

		@scoped(mode)
		def form_reader():
			fd = self.frappe.form_dict
			return {k: fd.get(k) for k in ("partner_id", "state_id", "district_id", "creche_id")}

		@scoped(mode)
		def with_usr(usr=None, pw=None, state_id=None):
			return dict(usr=usr, pw=pw, state_id=state_id)

		return dashboard, report, bag, form_reader, with_usr

	# -- tests ---------------------------------------------------------------
	def test_guest_and_unscoped_website_user_denied(self):
		dash = self.make()[0]
		self.login("Guest")
		with self.assertRaises(_PermissionError):
			dash()
		self.login("web@x", user_type="Website User")
		with self.assertRaises(_PermissionError):
			dash(state_id="1")

	def test_admin_and_system_manager_unrestricted(self):
		dash = self.make()[0]
		self.login("Administrator")
		self.assertEqual(dash(partner_id="999", state_id="x' OR 1=1")["partner_id"], "999")
		self.login("boss@x", partner="5", roles=("System Manager",))
		self.assertEqual(dash(partner_id="999")["partner_id"], "999")

	def test_legacy_national_user_keeps_working_and_can_be_tightened(self):
		dash = self.make()[0]
		self.login("nat@x", roles=("Foundation Central Team",))
		self.assertEqual(dash(partner_id="6")["partner_id"], "6")
		self.frappe.local = types.SimpleNamespace()
		self.frappe.conf = _dict(user_scope_unrestricted_roles=["Full Admin"])
		with self.assertRaises(_PermissionError):
			dash(partner_id="6")
		self.login("nat@x", roles=("Full Admin",))
		self.frappe.local = types.SimpleNamespace()
		self.assertEqual(dash(partner_id="6")["partner_id"], "6")

	def test_partner_cannot_be_overridden(self):
		dash, report, bag, form_reader, _ = self.make()
		self.login("sup@x", partner="5")
		self.assertEqual(dash(partner_id="5")["partner_id"], "5")
		with self.assertRaises(_PermissionError):
			dash(partner_id="6")
		with self.assertRaises(_PermissionError):
			report(filters={"partner": "6"})
		with self.assertRaises(_PermissionError):
			bag(partner_id="6")
		self.frappe.form_dict = _dict(partner_id="6")
		with self.assertRaises(_PermissionError):
			form_reader()

	def test_non_numeric_values_rejected(self):
		dash, report = self.make()[:2]
		self.login("sup@x", partner="5")
		for bad in ("1' OR '1'='1", "abc", "1;DROP TABLE x"):
			with self.assertRaises(_ValidationError):
				dash(state_id=bad)
			with self.assertRaises(_ValidationError):
				report(filters={"state": bad})

	def test_geography_and_creche_scope(self):
		dash = self.make()[0]
		self.login("sup@x", partner="5", rows=[dict(state_id="1", district_id="10", block_id="100", gp_id="1000")])
		self.assertEqual(dash(gp_id="1000", creche_id="7")["creche_id"], "7")
		for kw in ({"state_id": "2"}, {"district_id": "20"}, {"creche_id": "8"}, {"creche_id": "999"}, {"gp_id": "1001"}):
			with self.assertRaises(_PermissionError, msg=str(kw)):
				dash(**kw)

	def test_mapping_mode_narrows_coarse_request(self):
		dash, report, bag, _, _ = self.make("mapping")
		self.login("sup@x", rows=[dict(state_id="1", district_id="10", block_id="100", gp_id="1000")])
		# the normal dropdown cascade is passed through untouched
		out = dash(state_id="1", district_id="10", gp_id="1000")
		self.assertEqual((out["state_id"], out["district_id"], out["gp_id"]), ("1", "10", "1000"))
		# a request broader than the mapping is narrowed (filter dropped -> SQL falls back to mapping)
		self.assertEqual(dash(state_id="1")["state_id"], None)
		self.assertEqual(report(filters={"state": "1", "partner": None})["state"], None)
		self.assertEqual(bag(state_id="1")["state_id"], None)

	def test_filters_as_json_string_and_original_not_mutated(self):
		report = self.make("mapping")[1]
		self.login("sup@x", rows=[dict(state_id="1", district_id="10", block_id="100", gp_id="1000")])
		self.assertEqual(report(filters=json.dumps({"state": "1"}))["state"], None)
		original = {"state": "1"}
		report(filters=original)
		self.assertEqual(original, {"state": "1"})

	def test_inject_mode_fills_in_user_scope(self):
		dash, report, bag, form_reader, _ = self.make("inject")
		self.login("sup@x", partner="5", rows=[dict(state_id="1", district_id="10")])
		new_request = lambda: setattr(self.frappe, "form_dict", _dict())  # noqa: E731  (each request gets a fresh form_dict)
		out = dash()
		self.assertEqual((out["partner_id"], out["state_id"], out["district_id"]), ("5", "1", "10"))
		new_request()
		self.assertEqual(report(filters={})["state"], "1")
		new_request()
		self.assertEqual(report(filters={})["state_id"], "1")
		new_request()
		self.assertEqual(bag()["district_id"], "10")
		new_request()
		fr = form_reader()
		self.assertEqual((fr["partner_id"], fr["state_id"]), ("5", "1"))

	def test_nested_decorated_call_accepts_already_injected_values(self):
		# e.g. download_report(filters) -> get_summary_data(filters): both decorated
		scoped = self.us.scoped

		@scoped("inject")
		def inner(filters=None):
			return dict(filters)

		@scoped("inject")
		def outer(filters=None):
			return inner(filters)

		self.login("sup@x", partner="5", rows=[dict(state_id="1", district_id="10", block_id="100", gp_id="1000")])
		out = outer(filters={})
		self.assertEqual((out["state"], out["district"], out["gp"]), ("1", "10", "1000"))

	def test_inject_mode_rejects_ambiguous_mapping_and_broad_request(self):
		dash = self.make("inject")[0]
		self.login("sup@x", rows=[dict(state_id="1"), dict(state_id="2")])
		with self.assertRaises(_PermissionError):
			dash()
		self.assertEqual(dash(state_id="2")["state_id"], "2")
		self.login("sup2@x", rows=[dict(state_id="1", district_id="10")])
		self.frappe.local = types.SimpleNamespace()
		with self.assertRaises(_PermissionError):
			dash(state_id="1")  # broader than the mapped district

	def test_usr_argument_cannot_impersonate(self):
		with_usr = self.make()[4]
		self.login("sup@x", partner="5")
		out = with_usr(usr="boss@x", pw="whatever")
		self.assertEqual(out["usr"], "sup@x")

	def test_positional_arguments_are_checked(self):
		dash = self.make()[0]
		self.login("sup@x", partner="5")
		with self.assertRaises(_PermissionError):
			dash("6")

	def test_authorize_creche(self):
		us = self.us
		self.login("sup@x", partner="5", rows=[dict(state_id="1")])
		path = us.authorize_creche("7")
		self.assertEqual(path["partner_id"], "5")
		for bad in ("8", "999"):
			with self.assertRaises((_PermissionError, _DoesNotExistError)):
				us.authorize_creche(bad)
		for bad in ("abc", "", "1,2"):
			with self.assertRaises(_ValidationError):
				us.authorize_creche(bad)

	def test_authorize_child(self):
		us = self.us
		self.login("sup@x", partner="5", rows=[dict(state_id="1")])
		self.assertEqual(us.authorize_child("50"), "50")
		self.assertIsNone(us.authorize_child("999"))
		with self.assertRaises(_PermissionError):
			us.authorize_child("51")

	def test_scope_conditions_sql(self):
		us = self.us
		self.login("sup@x", partner="5", rows=[dict(state_id="1", district_id="10"), dict(state_id="2")])
		params = {}
		sql = us.scope_conditions("c", params)
		self.assertIn("c.partner_id = %(_sc_partner)s", sql)
		self.assertIn("(c.state_id = %(_sc_state_id_0)s AND c.district_id = %(_sc_district_id_0)s)", sql)
		self.assertIn(" OR (c.state_id = %(_sc_state_id_1)s)", sql)
		self.assertEqual(params["_sc_partner"], "5")
		self.login("Administrator")
		self.frappe.local = types.SimpleNamespace()
		self.assertEqual(us.scope_conditions("c", {}), "")
		self.login("web@x", user_type="Website User")
		self.frappe.local = types.SimpleNamespace()
		self.assertEqual(us.scope_conditions("c", {}), " AND 1 = 0")

	def test_scope_conditions_for_tables_without_partner_or_village(self):
		us = self.us
		# a village-level mapping row on a table that has no village column (Creche Summary)
		self.login("sup@x", partner="5", rows=[dict(state_id="1", district_id="10", block_id="100", gp_id="1000", village_id="9000")])

		params = {}
		clauses = us.scope_clauses("cs", params, levels=us.LEVELS_TO_GP)
		self.assertEqual(len(clauses), 2)
		self.assertIn("cs.partner_id = %(_sc_partner)s", clauses[0])
		self.assertIn("cs.gp_id = %(_sc_gp_id_0)s", clauses[1])
		self.assertNotIn("village", " ".join(clauses))  # never reference a column the table lacks
		self.assertNotIn("_sc_village_id_0", params)

		# planning tables carry no partner at all: geography only
		self.frappe.local = types.SimpleNamespace()
		params = {}
		sql = us.scope_conditions("gp", params, partner=False, levels=("state_id", "district_id", "block_id"))
		self.assertNotIn("partner", sql)
		self.assertNotIn("gp_id", sql)
		self.assertIn("gp.block_id = %(_sc_block_id_0)s", sql)

	def test_scope_clauses_restrict_everyone_who_is_not_unrestricted(self):
		us = self.us
		self.login("web@x", user_type="Website User")  # no partner, no mapping, not a System User
		self.assertEqual(us.scope_clauses("c", {}, partner=False, levels=us.LEVELS_TO_GP), ["1 = 0"])
		self.frappe.local = types.SimpleNamespace()
		self.login("Administrator")
		self.assertEqual(us.scope_clauses("c", {}), [])
		self.assertEqual(us.LEVELS_TO_GP, ("state_id", "district_id", "block_id", "gp_id"))

	def test_authorize_creche_returns_the_canonical_id(self):
		us = self.us
		self.login("sup@x", partner="5", rows=[dict(state_id="1")])
		for raw in ("7", " 7 ", "007", 7):
			self.frappe.local = types.SimpleNamespace()
			self.assertEqual(us.authorize_creche(raw)["creche_id"], "7", raw)


if __name__ == "__main__":
	unittest.main()
