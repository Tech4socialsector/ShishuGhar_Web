"""Tests for the mobile-app auth helpers in frappe/val/api.py (stubbed frappe).

Runs standalone:  python -I frappe/tests/test_val_api.py
Skipped automatically when the real frappe is already imported (bench runner).
"""

import importlib.util
import os
import sys
import types
import unittest

_REAL_FRAPPE = "frappe" in sys.modules and not getattr(sys.modules["frappe"], "_IS_STUB", False)
_API = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "val", "api.py")


class _dict(dict):
	__getattr__ = dict.get

	def __setattr__(self, k, v):
		self[k] = v


class _AuthError(Exception):
	pass


class _PermError(Exception):
	pass


class _Throw(Exception):
	pass


class FakeUser(dict):
	__getattr__ = dict.get

	def __setattr__(self, k, v):
		self[k] = v

	def save(self):
		self["_saved"] = True


def _build():
	f = types.ModuleType("frappe")
	f._IS_STUB = True
	f._dict = _dict
	f.AuthenticationError = _AuthError
	f.PermissionError = _PermError
	f.response = _dict()
	f.local = types.SimpleNamespace(response={}, request=None)
	f.session = _dict(user="sup@x", sid="SID")
	f.logged = []
	f.log_error = lambda *a, **k: f.logged.append(a)
	f.get_traceback = lambda: "tb"
	f.generate_hash = lambda length=15: "x" * length
	f.whitelist = lambda **kw: (lambda fn: fn)

	def throw(msg=None, exc=None, title=None, **kw):
		raise _Throw(kw.get("msg") or msg)

	f.throw = throw

	class LoginManager:
		calls = []
		fail = None

		def authenticate(self, user=None, pwd=None):
			LoginManager.calls.append("authenticate")
			if LoginManager.fail:
				raise LoginManager.fail

		def post_login(self):
			LoginManager.calls.append("post_login")

	f.auth = types.SimpleNamespace(LoginManager=LoginManager)
	f.db = types.SimpleNamespace(
		get_value=lambda dt, name, field: {"api_key": "KEY"}.get(field),
		sql=lambda *a, **k: [(3,)],
		commit=lambda: None,
	)
	f.get_doc = lambda d: types.SimpleNamespace(insert=lambda: None)  # device-change log
	user = FakeUser(
		name="sup@x", app_device_id="dev", app_device_version="2.1.8", api_key="KEY", type="sup",
		partner=5, mobile_no="9", mapping=[],
	)
	f.get_cached_doc = lambda dt, name: user

	apf = types.ModuleType("frappe.apf")
	us = types.ModuleType("frappe.apf.user_scope")
	us.authorize_creche = lambda cid: {"partner_id": "5", "state_id": "1", "district_id": "10", "block_id": "100", "gp_id": "1000", "village_id": None}
	rl = types.ModuleType("frappe.rate_limiter")
	rl.rate_limit = lambda **kw: (lambda fn: fn)
	ut = types.ModuleType("frappe.utils")
	ut.getdate = lambda v: v
	pw = types.ModuleType("frappe.utils.password")
	pw.secret = "SECRET"
	pw.get_decrypted_password = lambda dt, name, field, raise_exception=True: pw.secret

	mods = {
		"frappe": f, "frappe.apf": apf, "frappe.apf.user_scope": us,
		"frappe.rate_limiter": rl, "frappe.utils": ut, "frappe.utils.password": pw,
	}
	return mods, f, pw, user, LoginManager


@unittest.skipIf(_REAL_FRAPPE, "real frappe loaded; stub-based test skipped")
class TestValApi(unittest.TestCase):
	@classmethod
	def setUpClass(cls):
		cls._saved = {}
		mods, cls.f, cls.pw, cls.user, cls.LM = _build()
		for k, v in mods.items():
			cls._saved[k] = sys.modules.get(k)
			sys.modules[k] = v
		spec = importlib.util.spec_from_file_location("val_api_under_test", _API)
		cls.api = importlib.util.module_from_spec(spec)
		spec.loader.exec_module(cls.api)

	@classmethod
	def tearDownClass(cls):
		for k, v in cls._saved.items():
			if v is None:
				sys.modules.pop(k, None)
			else:
				sys.modules[k] = v

	def setUp(self):
		self.LM.calls.clear()
		self.LM.fail = None
		self.f.response.clear()
		self.f.local.response = {}
		self.f.logged.clear()
		self.f.session = _dict(user="sup@x", sid="SID")
		self.pw.secret = "SECRET"

	def request(self, header):
		headers = {} if header is None else {"Authorization": header}
		self.f.local.request = types.SimpleNamespace(headers=headers)

	# ---- version comparison (bug: string compare) ---------------------------
	def test_version_compare_is_numeric(self):
		ok = self.api._app_version_ok
		self.assertTrue(ok("d", "2.1.10"))  # a string compare says 2.1.10 < 2.1.8
		self.assertTrue(ok("d", "2.1.8"))
		self.assertTrue(ok("d", "2.2"))
		self.assertTrue(ok("d", "10.0.0"))
		self.assertTrue(ok("d", "v2.1.9"))
		self.assertFalse(ok("d", "2.1.7"))
		self.assertFalse(ok("d", "2.0.99"))
		self.assertFalse(ok("d", "1.9.9"))
		self.assertFalse(ok("d", "2.1"))
		self.assertFalse(ok(None, "2.1.8"))
		self.assertFalse(ok("d", None))
		self.assertFalse(ok("d", ""))
		self.assertEqual(self.api._version_tuple("2.1.x"), (2, 1, 0))

	# ---- token check ----------------------------------------------------------
	def test_token_header_validated(self):
		check = self.api._require_app_token
		self.request("token KEY:SECRET")
		self.assertTrue(check())
		for bad in ("token KEY:WRONG", "token WRONG:SECRET", "KEY:SECRET", "Bearer KEY:SECRET",
		            "token KEY", "token :SECRET", "token KEY:", "", "token"):
			self.request(bad)
			self.assertFalse(check(), bad)

	def test_missing_header_no_longer_passes(self):
		# old code: data_usr.token(None) == auth(None) -> True
		self.request(None)
		self.assertFalse(self.api._require_app_token())

	def test_no_stored_secret_or_guest_fails(self):
		self.request("token KEY:SECRET")
		self.pw.secret = None
		self.assertFalse(self.api._require_app_token())
		self.pw.secret = "SECRET"
		self.f.session = _dict(user="Guest")
		self.assertFalse(self.api._require_app_token())
		self.f.local.request = None
		self.f.session = _dict(user="sup@x")
		self.assertFalse(self.api._require_app_token())

	def test_token_is_never_stored_in_clear_text(self):
		self.api.generate_keys("sup@x")
		self.assertNotIn("token", self.user)
		self.assertTrue(self.user.get("_saved"))
		self.assertEqual(self.user["api_secret"], "x" * 15)

	# ---- login flow -----------------------------------------------------------
	def test_outdated_app_gets_no_session(self):
		self.api.login("sup@x", "pw", "dev", "2.1.7")
		self.assertEqual(self.LM.calls, ["authenticate"])  # post_login() never ran
		self.assertEqual(self.f.local.response["http_status_code"], 403)
		self.assertIn("update", self.f.response["message"])

	def test_missing_device_info_gets_no_session(self):
		self.api.login("sup@x", "pw")
		self.assertEqual(self.LM.calls, ["authenticate"])
		self.assertEqual(self.f.local.response["http_status_code"], 403)

	def test_version_2_1_10_is_allowed(self):
		self.api.login("sup@x", "pw", "dev", "2.1.10")
		self.assertEqual(self.LM.calls, ["authenticate", "post_login"])
		self.assertEqual(self.f.response["auth"]["success_key"], 1)
		self.assertEqual(self.f.response["auth"]["api_secret"], "x" * 15)

	def test_bad_credentials_keep_generic_message_without_error_log(self):
		self.LM.fail = _AuthError("bad")
		with self.assertRaises(_Throw) as cm:
			self.api.login("sup@x", "bad", "dev", "2.1.8")
		self.assertEqual(str(cm.exception), "Invalid ID or Password")
		self.assertEqual(self.f.logged, [])
		self.assertEqual(self.LM.calls, ["authenticate"])

	def test_unexpected_errors_are_logged_not_hidden(self):
		self.LM.fail = RuntimeError("db down")
		with self.assertRaises(_Throw) as cm:
			self.api.login("sup@x", "pw", "dev", "2.1.8")
		self.assertEqual(str(cm.exception), "Invalid ID or Password")  # client-facing message unchanged
		self.assertEqual(len(self.f.logged), 1)  # ...but the cause is now in the Error Log

	# ---- write API scope --------------------------------------------------------
	def test_client_geography_is_overwritten_by_the_creche(self):
		data = _dict(creche_id="7", partner_id="999", state_id="9", district_id="9", block_id="9", gp_id="9", village_id="9")
		self.api._apply_creche_scope(data)
		self.assertEqual(
			(data.partner_id, data.state_id, data.district_id, data.block_id, data.gp_id, data.village_id),
			("5", "1", "10", "100", "1000", None),
		)


if __name__ == "__main__":
	unittest.main()
