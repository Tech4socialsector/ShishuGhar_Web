"""Regression tests: report filters must never be able to break out of SQL strings.

Loads the real report modules against a recording stub of ``frappe.db`` and checks
the generated SQL. Runs standalone:  python -I frappe/tests/test_report_sql_escaping.py
Skipped automatically when the real frappe is already imported (bench runner).
"""

import importlib.util
import os
import re
import sys
import types
import unittest

_REAL_FRAPPE = "frappe" in sys.modules and not getattr(sys.modules["frappe"], "_IS_STUB", False)
_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")

PAYLOAD = "1' OR '1'='1' -- "
UNION = "1' UNION SELECT password FROM `__Auth` -- "


def _escape(value, percent=True):
	"""Same contract as frappe.db.escape: backslash-escape, wrap in quotes."""
	s = "" if value is None else str(value)
	s = s.replace("\\", "\\\\").replace("'", "\\'").replace('"', '\\"').replace("\n", "\\n").replace("\0", "\\0")
	if percent:
		s = s.replace("%", "%%")
	return "'" + s + "'"


class _dict(dict):
	__getattr__ = dict.get

	def __setattr__(self, k, v):
		self[k] = v


class RecordingDB:
	def __init__(self):
		self.queries = []

	def escape(self, value, percent=True):
		return _escape(value, percent)

	def sql(self, query, values=(), as_dict=False, **kw):
		self.queries.append(query)
		return []

	def get_value(self, *a, **k):
		return None


def _stub_frappe():
	f = types.ModuleType("frappe")
	f._IS_STUB = True
	f._dict = _dict
	f._ = lambda s: s
	f.whitelist = lambda **kw: (lambda fn: fn)
	f.session = _dict(user="Administrator")
	f.db = RecordingDB()
	f.throw = lambda *a, **k: (_ for _ in ()).throw(Exception(a))
	f.msgprint = lambda *a, **k: None
	f.local = types.SimpleNamespace()
	f.form_dict = _dict()
	f.utils = types.SimpleNamespace(nowdate=lambda: "2026-11-17", getdate=lambda v=None: v, cint=int, today=lambda: "2026-11-17")
	f.get_roles = lambda user=None: ["System Manager"]
	apf = types.ModuleType("frappe.apf")
	us = types.ModuleType("frappe.apf.user_scope")
	us.scoped = lambda mode="mapping": (lambda fn: fn)  # decorator is tested elsewhere
	us.scope_conditions = lambda alias, params: ""
	utils = types.ModuleType("frappe.utils")
	utils.nowdate = f.utils.nowdate
	utils.getdate = f.utils.getdate
	utils.cint = int
	utils.today = f.utils.today
	return {"frappe": f, "frappe.apf": apf, "frappe.apf.user_scope": us, "frappe.utils": utils}, f


@unittest.skipIf(_REAL_FRAPPE, "real frappe loaded; stub-based test skipped")
class TestReportSqlEscaping(unittest.TestCase):
	@classmethod
	def setUpClass(cls):
		mods, cls.f = _stub_frappe()
		cls._saved = {k: sys.modules.get(k) for k in mods}
		sys.modules.update(mods)

	@classmethod
	def tearDownClass(cls):
		for k, v in cls._saved.items():
			if v is None:
				sys.modules.pop(k, None)
			else:
				sys.modules[k] = v

	def load(self, rel):
		path = os.path.join(_ROOT, *rel.split("/"))
		spec = importlib.util.spec_from_file_location("report_under_test_" + re.sub(r"\W", "_", rel), path)
		mod = importlib.util.module_from_spec(spec)
		spec.loader.exec_module(mod)
		self.f.db.queries.clear()
		return mod

	def last_sql(self):
		self.assertTrue(self.f.db.queries, "report ran no SQL")
		return self.f.db.queries[-1]

	@staticmethod
	def has_broken_out(sql, payload_fragment="' OR '1'='1"):
		"""True if the payload's closing quote survived unescaped."""
		return payload_fragment in sql

	def check_report(self, rel, func, filters_ok, filters_bad_key):
		mod = self.load(rel)
		getattr(mod, func)(dict(filters_ok))
		benign = self.last_sql()
		self.assertNotIn("\\'", benign)
		for evil in (PAYLOAD, UNION):
			self.f.db.queries.clear()
			bad = dict(filters_ok)
			bad[filters_bad_key] = evil
			getattr(mod, func)(bad)
			sql = self.last_sql()
			self.assertFalse(self.has_broken_out(sql), f"{rel}: payload escaped its string literal:\n{sql[-600:]}")
			# the payload must sit inside ONE properly escaped literal (its quote backslash-escaped)
			self.assertIn(f"= {_escape(evil)}", sql, f"{rel}: value not emitted as an escaped literal")
			self.assertIn("\\'", sql)  # the quote was escaped, not dropped

	def test_creche_detail_report(self):
		for key in ("state", "district", "block", "gp", "village", "creche"):
			self.check_report("creche_module/report/creche_detail_report/creche_detail_report.py",
			                  "get_report_data", {"state": "1"}, key)

	def test_script_creche_details(self):
		for key in ("state", "district", "block", "gp", "village"):
			self.check_report("creche_module/report/script_creche_details/script_creche_details.py",
			                  "get_report_data", {"state": "1"}, key)

	def test_benign_values_produce_the_original_sql_shape(self):
		mod = self.load("creche_module/report/creche_detail_report/creche_detail_report.py")
		mod.get_report_data({"state": "1", "district": "10"})
		sql = self.last_sql()
		self.assertIn("AND creche.state_id = '1'", sql)
		self.assertIn("AND creche.district_id = '10'", sql)

	def test_percent_in_value_cannot_break_param_formatting(self):
		mod = self.load("creche_module/report/creche_detail_report/creche_detail_report.py")
		mod.get_report_data({"state": "5%s"})
		self.assertIn("'5%%s'", self.last_sql())  # doubled, so %-formatting treats it literally


if __name__ == "__main__":
	unittest.main()
