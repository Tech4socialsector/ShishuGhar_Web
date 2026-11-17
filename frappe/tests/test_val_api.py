"""Tests for the mobile-app auth helpers in frappe/val/api.py (stubbed frappe).

Runs standalone:  python -I frappe/tests/test_val_api.py
Skipped automatically when the real frappe is already imported (bench runner).
"""

import datetime
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


class _TooMany(Exception):
	pass


class FakeCache:
	"""Just enough of frappe.cache for the per-account throttle."""

	def __init__(self):
		self.store = {}

	def make_key(self, key):
		return "site|" + key

	def get(self, key):
		return self.store.get(key)

	def setex(self, key, seconds, value):
		self.store[key] = value

	def incrby(self, key, n):
		self.store[key] = int(self.store.get(key) or 0) + n
		return self.store[key]


class FakeDoc(dict):
	"""Records what the write APIs do to documents."""

	log = []

	def __init__(self, doctype=None, **values):
		super().__init__(values)
		self["doctype"] = doctype
		self.name = values.get("name") or "NEW"

	def __getattr__(self, k):
		return self.get(k)

	def __setattr__(self, k, v):
		if k == "name":
			object.__setattr__(self, k, v)
		else:
			self[k] = v

	def insert(self):
		FakeDoc.log.append(("insert", self["doctype"]))

	def save(self, **kw):
		FakeDoc.log.append(("save", self["doctype"], self.name))

	def update(self, values=None, **kw):
		dict.update(self, values or {})

	def as_dict(self):
		return dict(self)


class FakeDB:
	def __init__(self):
		self.reset()

	def reset(self):
		self.children = []  # (name, childenrollguid, creche_id)
		self.existing_gm = []  # rows for the "growth monitoring of this month" query
		self.anthro_row = None  # what the global (cgmguid, childenrollguid) lookup finds
		self.gm_creche = {}  # growth monitoring sheet name -> creche_id
		self.sql_log = []

	def get_value(self, dt, name, fields=None, as_dict=False):
		if dt == "User":
			return {"api_key": "KEY"}.get(fields)
		if dt == "Anthropromatic Data":
			return self.anthro_row
		if dt == "Child Growth Monitoring":
			return self.gm_creche.get(str(name))
		return None

	def sql(self, query, params=None, as_dict=False):
		self.sql_log.append((query, params))
		if "tabChild Enrollment and Exit" in query:
			wanted = set(params[0])
			col = 1 if "childenrollguid IN" in query else 0
			return [(str(c[0]), c[2]) for c in self.children if str(c[col]) in wanted]
		if "tabChild Growth Monitoring" in query:
			return self.existing_gm
		return [(3,)]  # household count at login

	def exists(self, *a, **k):
		return None

	def commit(self):
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
	f.TooManyRequestsError = _TooMany
	f._ = lambda text, *a, **k: text
	f.cache = FakeCache()
	f.roles = ["Sales User"]
	f.get_roles = lambda user=None: list(f.roles)
	f.whitelisted = {}

	def whitelist(**kw):
		def deco(fn):
			f.whitelisted[fn.__name__] = kw
			return fn

		return deco

	f.whitelist = whitelist

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
	f.db = FakeDB()

	def get_doc(doc, name=None):
		if isinstance(doc, str):  # get_doc("Doctype", name): an existing record
			return FakeDoc(doc, name=name)
		return FakeDoc(**doc)

	f.get_doc = get_doc
	f.form_dict = {}
	user = FakeUser(
		name="sup@x", app_device_id="dev", app_device_version="2.1.8", api_key="KEY", type="sup",
		partner=5, mobile_no="9", mapping=[],
	)
	f.get_cached_doc = lambda dt, name: user

	apf = types.ModuleType("frappe.apf")
	us = types.ModuleType("frappe.apf.user_scope")
	us.authorize_creche = lambda cid: {"partner_id": "5", "state_id": "1", "district_id": "10", "block_id": "100", "gp_id": "1000", "village_id": None, "creche_id": str(int(cid))}
	at = types.ModuleType("frappe.api_token")
	at.usable = True
	at.revoked = []
	at.new_expiry = lambda: "EXPIRES"
	at.token_usable = lambda user: at.usable
	at.revoke = lambda user, only_app_issued=False: at.revoked.append(user)
	rl = types.ModuleType("frappe.rate_limiter")
	rl.rate_limit = lambda **kw: (lambda fn: fn)
	ut = types.ModuleType("frappe.utils")
	ut.getdate = lambda v: datetime.date.fromisoformat(str(v))
	pw = types.ModuleType("frappe.utils.password")
	pw.secret = "SECRET"
	pw.get_decrypted_password = lambda dt, name, field, raise_exception=True: pw.secret

	mods = {
		"frappe": f, "frappe.apf": apf, "frappe.apf.user_scope": us, "frappe.api_token": at,
		"frappe.rate_limiter": rl, "frappe.utils": ut, "frappe.utils.password": pw,
	}
	return mods, f, pw, user, LoginManager, at


@unittest.skipIf(_REAL_FRAPPE, "real frappe loaded; stub-based test skipped")
class TestValApi(unittest.TestCase):
	@classmethod
	def setUpClass(cls):
		cls._saved = {}
		mods, cls.f, cls.pw, cls.user, cls.LM, cls.at = _build()
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
		self.f.db.reset()
		self.f.cache.store.clear()
		self.f.roles = ["Sales User"]
		self.f.local.form_dict = {}
		self.at.usable = True
		self.at.revoked.clear()
		FakeDoc.log.clear()
		self.user.pop("_saved", None)
		self.user.update(app_device_id="dev", app_device_version="2.1.8")

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

	# ---- token lifecycle ----------------------------------------------------------
	def test_expired_or_revoked_token_is_rejected(self):
		self.request("token KEY:SECRET")
		self.assertTrue(self.api._require_app_token())
		self.at.usable = False  # expired, revoked or the user was disabled
		self.assertFalse(self.api._require_app_token())

	def test_login_stamps_an_expiry_on_the_token(self):
		self.api.generate_keys("sup@x")
		self.assertEqual(self.user["api_token_expires_on"], "EXPIRES")

	def test_user_can_revoke_own_token(self):
		self.api.revoke_app_token()
		self.assertEqual(self.at.revoked, ["sup@x"])

	def test_only_system_manager_can_revoke_someone_elses_token(self):
		with self.assertRaises(_Throw):
			self.api.revoke_app_token("other@x")
		self.assertEqual(self.at.revoked, [])
		self.f.roles = ["System Manager"]
		self.api.revoke_app_token("other@x")
		self.assertEqual(self.at.revoked, ["other@x"])

	# ---- login hardening ----------------------------------------------------------
	def test_credential_endpoints_are_post_only(self):
		for name in ("login", "update_device_id", "revoke_app_token"):
			self.assertEqual(self.f.whitelisted[name]["methods"], ["POST"], name)
		self.assertTrue(self.f.whitelisted["login"]["allow_guest"])

	def test_update_device_id_enforces_the_version_gate(self):
		self.api.update_device_id("sup@x", "pw", "dev", "2.1.7")
		self.assertEqual(self.LM.calls, ["authenticate"])  # no session for an outdated app
		self.assertEqual(self.f.local.response["http_status_code"], 403)
		self.assertNotIn("_saved", self.user)  # device not re-registered

	def test_update_device_id_current_app_still_works(self):
		self.api.update_device_id("sup@x", "pw", "dev2", "2.1.10")
		self.assertEqual(self.LM.calls, ["authenticate", "post_login"])
		self.assertEqual(self.f.local.response["http_status_code"], 200)
		self.assertEqual(self.user.app_device_id, "dev2")

	def test_login_is_throttled_per_account_not_only_per_ip(self):
		limit = self.api.LOGIN_ATTEMPTS_PER_ACCOUNT
		for _i in range(limit):
			self.api.login(usr="victim@x", pwd="guess", app_device_id="d", app_device_version="2.1.8")
		with self.assertRaises(_Throw) as cm:  # (the stub's frappe.throw raises _Throw for any exc class)
			self.api.login(usr="victim@x", pwd="guess", app_device_id="d", app_device_version="2.1.8")
		self.assertIn("Too many attempts", str(cm.exception))
		# case / whitespace variants share the counter ...
		with self.assertRaises(_Throw):
			self.api.login(usr="  Victim@X ", pwd="guess", app_device_id="d", app_device_version="2.1.8")
		# ... another account is unaffected, and so is the other endpoint's counter
		self.api.login(usr="someone-else@x", pwd="pw", app_device_id="d", app_device_version="2.1.8")
		self.api.update_device_id(usr="victim@x", pwd="pw", app_device_id="d", app_device_version="2.1.8")

	# ---- write APIs: child ownership --------------------------------------------------
	def test_child_of_another_creche_is_rejected(self):
		check = self.api._assert_children_in_creche
		self.f.db.children = [("50", "G-OWN", "7"), ("51", "G-FOREIGN", "8")]
		check("7", guids=["G-OWN"], child_ids=["50"])  # own children pass
		check("7", guids=["G-NOT-SYNCED-YET"])  # unknown to the server: accepted (offline sync)
		check("7", guids=[None, "", "  "], child_ids=[None, "abc", "1; DROP"])  # junk is ignored
		with self.assertRaises(_Throw):
			check("7", guids=["G-OWN", "G-FOREIGN"])
		with self.assertRaises(_Throw):
			check("7", child_ids=["51"])

	def test_child_check_binds_values_instead_of_formatting_sql(self):
		self.f.db.children = []
		self.api._assert_children_in_creche("7", guids=["x' OR '1'='1"], child_ids=["5"])
		for query, params in self.f.db.sql_log:
			self.assertNotIn("OR '1'", query)
			self.assertIn("%s", query)
			self.assertIsInstance(params[0], tuple)

	def _post(self, **fields):
		self.f.local.form_dict = {"creche_id": "7", **fields}
		self.request("token KEY:SECRET")

	def test_attendance_for_a_foreign_child_is_rejected(self):
		self.f.db.children = [("51", "G-FOREIGN", "8")]
		self._post(
			date_of_attendance="2026-11-05",
			childattendancelist=[{"childenrolledguid": "G-FOREIGN", "attendance": 1}],
		)
		with self.assertRaises(_Throw):
			self.api.child_attendance()
		self.assertEqual(FakeDoc.log, [])  # nothing written

	def test_immunization_for_a_foreign_child_is_rejected(self):
		self.f.db.children = [("51", "G-FOREIGN", "8")]
		self._post(childenrolledguid="G-FOREIGN", child_id="51", vaccine_details=[])
		with self.assertRaises(_Throw):
			self.api.child_immunization()
		self.assertEqual(FakeDoc.log, [])

	def test_growth_monitoring_cannot_overwrite_another_creches_child_record(self):
		# the audit finding: (cgmguid, childenrollguid) identify the row *globally*
		self.f.db.anthro_row = _dict(name="55", parent="900")
		self.f.db.gm_creche = {"900": "8"}  # ... and that row sits on creche 8's sheet
		self._post(
			measurement_date="2026-11-05",
			anthropromatic_details=[{"cgmguid": "CG1", "childenrollguid": "C-NEW", "weight": 1}],
		)
		with self.assertRaises(_Throw):
			self.api.growth_monitoring()
		self.assertNotIn(("save", "Anthropromatic Data", "55"), FakeDoc.log)

	def test_growth_monitoring_updates_the_callers_own_row(self):
		self.f.db.anthro_row = _dict(name="55", parent="900")
		self.f.db.gm_creche = {"900": "7"}
		self._post(
			measurement_date="2026-11-05",
			anthropromatic_details=[{"cgmguid": "CG1", "childenrollguid": "C-NEW", "weight": 1}],
		)
		self.api.growth_monitoring()  # no error: the row is on creche 7's own sheet
		self.assertIn(("save", "Anthropromatic Data", "55"), FakeDoc.log)


if __name__ == "__main__":
	unittest.main()
