"""Tests for frappe/api_token.py (expiry / revocation of the mobile app's API token), stubbed frappe.

Runs standalone:  python -I frappe/tests/test_api_token.py
Skipped automatically when the real frappe is already imported (bench runner).
"""

import datetime
import importlib.util
import os
import sys
import types
import unittest

_REAL_FRAPPE = "frappe" in sys.modules and not getattr(sys.modules["frappe"], "_IS_STUB", False)
_MODULE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "api_token.py")
NOW = datetime.datetime(2026, 11, 17, 12, 0, 0)


class _AuthError(Exception):
	pass


class _Throw(Exception):
	pass


class _Row(dict):
	__getattr__ = dict.get


def _build():
	f = types.ModuleType("frappe")
	f._IS_STUB = True
	f.AuthenticationError = _AuthError
	f._ = lambda s, *a, **k: s
	f.conf = {}
	f.cleared = []
	f.clear_document_cache = lambda dt, name: f.cleared.append((dt, name))

	def throw(msg, exc=None, **kw):
		raise (exc or _Throw)(msg)

	f.throw = throw

	class DB:
		def __init__(self):
			self.reset()

		def reset(self):
			self.column = True
			self.users = {}  # name -> {"enabled": 1, "api_token_expires_on": datetime | None}
			self.set_calls = []

		def has_column(self, dt, col):
			return self.column

		def get_value(self, dt, name, fields, as_dict=False):
			row = self.users.get(name)
			if row is None:
				return None
			if isinstance(fields, str):
				return row.get(fields)
			return _Row({k: row.get(k) for k in fields})

		def set_value(self, dt, name, field, value, update_modified=True):
			self.set_calls.append((name, field, value, update_modified))
			self.users[name][field] = value

		def commit(self):
			pass

	f.db = DB()
	f.get_all = lambda dt, filters=None, pluck=None: [n for n, r in f.db.users.items() if r.get("api_token_expires_on")]

	ut = types.ModuleType("frappe.utils")
	ut.cint = lambda v, default=0: int(v) if str(v).lstrip("-").isdigit() else default
	ut.now_datetime = lambda: NOW
	ut.get_datetime = lambda v: v
	ut.add_to_date = lambda d, days=0: d + datetime.timedelta(days=days)

	pw = types.ModuleType("frappe.utils.password")
	pw.removed = []
	pw.remove_encrypted_password = lambda dt, name, fieldname="password": pw.removed.append((dt, name, fieldname))

	mods = {"frappe": f, "frappe.utils": ut, "frappe.utils.password": pw}
	return mods, f, pw


@unittest.skipIf(_REAL_FRAPPE, "real frappe loaded; stub-based test skipped")
class TestApiToken(unittest.TestCase):
	@classmethod
	def setUpClass(cls):
		cls._saved = {}
		mods, cls.f, cls.pw = _build()
		for k, v in mods.items():
			cls._saved[k] = sys.modules.get(k)
			sys.modules[k] = v
		spec = importlib.util.spec_from_file_location("api_token_under_test", _MODULE)
		cls.at = importlib.util.module_from_spec(spec)
		spec.loader.exec_module(cls.at)

	@classmethod
	def tearDownClass(cls):
		for k, v in cls._saved.items():
			if v is None:
				sys.modules.pop(k, None)
			else:
				sys.modules[k] = v

	def setUp(self):
		self.f.db.reset()
		self.f.conf.clear()
		self.f.cleared.clear()
		self.pw.removed.clear()

	def user(self, name="u@x", enabled=1, expires=None):
		self.f.db.users[name] = {"enabled": enabled, "api_token_expires_on": expires}
		return name

	# ---- expiry ---------------------------------------------------------------------
	def test_default_lifetime_and_override(self):
		self.assertEqual(self.at.expiry_days(), self.at.DEFAULT_EXPIRY_DAYS)
		self.assertEqual(self.at.new_expiry(), NOW + datetime.timedelta(days=self.at.DEFAULT_EXPIRY_DAYS))
		self.f.conf["app_token_expiry_days"] = 7
		self.assertEqual(self.at.new_expiry(), NOW + datetime.timedelta(days=7))

	def test_zero_switches_expiry_off(self):
		self.f.conf["app_token_expiry_days"] = 0
		self.assertIsNone(self.at.new_expiry())

	def test_token_expires_at_the_stamped_moment(self):
		day = datetime.timedelta(days=1)
		self.assertTrue(self.at.token_usable(self.user(expires=NOW + day)))
		self.assertFalse(self.at.token_usable(self.user(expires=NOW - day)))
		self.assertFalse(self.at.token_usable(self.user(expires=NOW)))  # exactly now counts as expired

	def test_no_expiry_means_no_expiry(self):
		# hand-made integration keys carry no expiry and must keep working
		self.assertTrue(self.at.token_usable(self.user(expires=None)))

	def test_disabled_or_unknown_user_is_rejected(self):
		self.assertFalse(self.at.token_usable(self.user(enabled=0)))
		self.assertFalse(self.at.token_usable("nobody@x"))

	def test_unmigrated_database_does_not_lock_everybody_out(self):
		self.f.db.column = False  # api_token_expires_on does not exist yet
		self.assertTrue(self.at.token_usable(self.user(expires=NOW - datetime.timedelta(days=9))))

	def test_assert_raises_authentication_error(self):
		self.at.assert_token_usable(self.user(expires=NOW + datetime.timedelta(days=1)))
		with self.assertRaises(_AuthError):
			self.at.assert_token_usable(self.user("old@x", expires=NOW - datetime.timedelta(days=1)))

	# ---- revocation -----------------------------------------------------------------
	def test_revoke_deletes_secret_and_expiry(self):
		self.at.revoke(self.user(expires=NOW + datetime.timedelta(days=5)))
		self.assertEqual(self.pw.removed, [("User", "u@x", "api_secret")])
		self.assertIsNone(self.f.db.users["u@x"]["api_token_expires_on"])
		self.assertEqual(self.f.cleared, [("User", "u@x")])
		self.assertFalse(self.f.db.set_calls[0][3])  # modified timestamp untouched

	def test_automatic_revoke_leaves_integration_keys_alone(self):
		# e.g. a password change: only tokens issued by the mobile login (they carry an expiry)
		integration = self.user("api@x", expires=None)
		self.at.revoke(integration, only_app_issued=True)
		self.assertEqual(self.pw.removed, [])
		mobile = self.user("m@x", expires=NOW + datetime.timedelta(days=5))
		self.at.revoke(mobile, only_app_issued=True)
		self.assertEqual(self.pw.removed, [("User", "m@x", "api_secret")])

	def test_revoke_all_only_touches_expiring_tokens(self):
		self.user("api@x", expires=None)
		self.user("m1@x", expires=NOW + datetime.timedelta(days=1))
		self.user("m2@x", expires=NOW - datetime.timedelta(days=1))
		self.assertEqual(self.at.revoke_all(), 2)
		self.assertEqual({r[1] for r in self.pw.removed}, {"m1@x", "m2@x"})

	def test_revoke_all_without_the_column_is_a_noop(self):
		self.f.db.column = False
		self.user("m@x", expires=NOW)
		self.assertEqual(self.at.revoke_all(), 0)
		self.assertEqual(self.pw.removed, [])


if __name__ == "__main__":
	unittest.main()
