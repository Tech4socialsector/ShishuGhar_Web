"""Static guard: every endpoint of the custom app enforces *some* server-side access rule.

Whitelisted functions are reachable at /api/method/<dotted path> by any logged-in user no matter
what the UI shows, so "nothing in the UI calls it" is not a defence. This test walks the custom
code (apf, creche_module, val, partner, geography) and fails when it finds

* a ``@frappe.whitelist()`` function that is not scoped / role-gated / token-checked and is not
  on the allow-list below (with the reason it is safe),
* a dynamically registered endpoint (``frappe.whitelist()(fn)``) that is not wrapped in ``scoped()``,
* a script report whose ``execute`` is not scoped (reports are served by the generic
  ``frappe.desk.query_report.run``, which only checks the report's *role*, not the caller's
  partner / geography),
* ``allow_guest=True`` anywhere outside the three intended guest endpoints.

Add a new endpoint properly (``@scoped()``, ``authorize_creche`` / ``authorize_child``,
``scope_conditions`` / ``scope_clauses``, or ``@admin_only``). Extend ALLOWED only for data that is
identical for every user, and write the reason down.

Pure standard library (no frappe import) so it runs anywhere:
    python -I frappe/tests/test_endpoint_scope_coverage.py
"""

import ast
import os
import unittest

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
DIRS = ("apf", "creche_module", "val", "partner", "geography")

# decorators that make an endpoint safe
GUARD_DECORATORS = ("scoped", "admin_only")
# calls inside the body that authorise the caller / restrict the data to the caller's scope
GUARD_CALLS = (
	"authorize_creche",
	"authorize_child",
	"scope_conditions",
	"scope_clauses",
	"get_user_scope",
	"only_for",
	"_require_app_token",  # mobile write APIs: token + _apply_creche_scope
	"_apply_creche_scope",
)

# anything in a function body that reads data
DATA_ACCESS = ("frappe.db.", "frappe.get_all", "frappe.get_list", "frappe.qb", "frappe.get_doc")

# file -> {function: reason} (an empty set of names means "every endpoint in the file")
ALLOWED = {
	"apf/page/child_report_card/growth_chart.py": {
		"*": "the six get_*_for_age/height tables are the static WHO growth standards, no child data"
	},
	"apf/page/growth_monitoring_ch/growth_chart.py": {
		"*": "the six get_*_for_age/height tables are the static WHO growth standards, no child data"
	},
	"apf/page/saturation_status_da/api_data.py": {
		"get_geolocation_config": "static map layout config",
		"get_filter_meta": "schema flag (does Block have is_active)",
		"get_active_states": "State master list, same for everybody",
		"get_active_districts": "District master list, same for everybody",
		"get_active_blocks": "Block master list, same for everybody",
		"get_active_state_names": "State master list, same for everybody",
		"get_gp_boundary_geojson": "public administrative boundary geometry",
		"get_district_gp_boundaries": "public administrative boundary geometry",
		"get_boundary_geojson": "public administrative boundary geometry",
	},
	"apf/report/vaccine_report/vaccine_report.py": {
		"download_report_logic_xlsx": "turns rows the CLIENT sent into an .xlsx; reads no server data"
	},
	"val/api.py": {
		"login": "credential endpoint: authenticates the caller itself, POST-only, rate-limited",
		"update_device_id": "credential endpoint: authenticates the caller itself, POST-only, rate-limited",
		"revoke_app_token": "acts on the caller's own token; another user's only for System Manager",
	},
	"val/privacy.py": {"privacy": "public privacy-policy page"},
}

# allow_guest=True is permitted only here
GUEST_ALLOWED = {
	"val/api.py": {"login", "update_device_id"},
	"val/privacy.py": {"privacy"},
}


def _rel(path):
	return os.path.relpath(path, ROOT).replace(os.sep, "/")


def _python_files():
	for d in DIRS:
		for dirpath, dirnames, filenames in os.walk(os.path.join(ROOT, d)):
			dirnames[:] = [x for x in dirnames if x != "__pycache__"]
			for name in filenames:
				if name.endswith(".py"):
					yield os.path.join(dirpath, name)


def _parse(path):
	with open(path, encoding="utf-8") as fh:
		src = fh.read()
	return src, ast.parse(src)


def _is_whitelist(dec):
	return "whitelist" in ast.unparse(dec).split("(")[0]


def _guarded(fn, src):
	decorators = [ast.unparse(d) for d in fn.decorator_list]
	if any(d.startswith(GUARD_DECORATORS) for d in decorators):
		return True
	body = ast.get_source_segment(src, fn) or ""
	return any(f"{call}(" in body for call in GUARD_CALLS)


def _allowed(rel, name):
	entry = ALLOWED.get(rel, {})
	return "*" in entry or name in entry


class TestEndpointScopeCoverage(unittest.TestCase):
	def test_every_whitelisted_endpoint_is_guarded_or_reviewed(self):
		offenders = []
		for path in _python_files():
			rel = _rel(path)
			src, tree = _parse(path)
			for node in ast.walk(tree):
				if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
					continue
				if not any(_is_whitelist(d) for d in node.decorator_list):
					continue
				if _guarded(node, src) or _allowed(rel, node.name):
					continue
				offenders.append(f"{rel}:{node.lineno} {node.name}")
		self.assertEqual(
			offenders,
			[],
			"whitelisted endpoints with no scope / role check (add @scoped(), authorize_*, "
			"scope_conditions, @admin_only, or a reasoned entry in ALLOWED):\n  " + "\n  ".join(offenders),
		)

	def test_dynamically_registered_endpoints_are_scoped(self):
		offenders = []
		for path in _python_files():
			rel = _rel(path)
			_, tree = _parse(path)
			for node in ast.walk(tree):
				# frappe.whitelist(...)(fn)
				if (
					isinstance(node, ast.Call)
					and isinstance(node.func, ast.Call)
					and _is_whitelist(node.func)
				):
					wrapped = node.args[0] if node.args else None
					# scoped()(fn)  ->  Call(func=Call(func=Name("scoped")), args=[fn])
					ok = (
						isinstance(wrapped, ast.Call)
						and isinstance(wrapped.func, ast.Call)
						and isinstance(wrapped.func.func, ast.Name)
						and wrapped.func.func.id in GUARD_DECORATORS
					)
					if not ok:
						offenders.append(f"{rel}:{node.lineno}")
		self.assertEqual(offenders, [], "frappe.whitelist()(fn) must wrap scoped(): " + ", ".join(offenders))

	def test_every_script_report_is_scoped(self):
		offenders = []
		for path in _python_files():
			rel = _rel(path)
			parts = rel.split("/")
			if "report" not in parts[:-1] or not (len(parts) >= 4 and parts[-3] == "report"):
				continue
			src, tree = _parse(path)
			module_funcs = {n.name: n for n in tree.body if isinstance(n, ast.FunctionDef)}
			executes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "execute"]
			for fn in executes:
				if _guarded(fn, src):
					continue
				# Accepted pattern: execute() only assembles columns and calls a helper in the same
				# file that is itself @scoped() -- as long as execute() reads no data on its own.
				calls = {
					n.func.id for n in ast.walk(fn) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
				}
				helper_guarded = any(
					name in module_funcs and module_funcs[name] is not fn and _guarded(module_funcs[name], src)
					for name in calls
				)
				body = ast.get_source_segment(src, fn) or ""
				touches_data = any(t in body for t in DATA_ACCESS)
				if not (helper_guarded and not touches_data):
					offenders.append(f"{rel}:{fn.lineno}")
		self.assertEqual(
			offenders,
			[],
			"script reports whose execute() has no @scoped() / scope_conditions / scope_clauses "
			"(the report role alone does not limit WHICH partner's data a user can read):\n  "
			+ "\n  ".join(offenders),
		)

	def test_allow_guest_only_on_the_intended_endpoints(self):
		offenders = []
		for path in _python_files():
			rel = _rel(path)
			src, tree = _parse(path)
			for node in ast.walk(tree):
				if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
					continue
				for dec in node.decorator_list:
					text = ast.unparse(dec).replace(" ", "")
					if _is_whitelist(dec) and "allow_guest=True" in text:
						if node.name not in GUEST_ALLOWED.get(rel, set()):
							offenders.append(f"{rel}:{node.lineno} {node.name}")
		self.assertEqual(offenders, [], "unexpected guest-callable endpoints: " + ", ".join(offenders))

	def test_allowlist_has_no_stale_entries(self):
		# An entry for a function that no longer exists would silently allow a future function of
		# that name, so keep the list honest.
		known = {}
		for path in _python_files():
			rel = _rel(path)
			if rel in ALLOWED:
				_, tree = _parse(path)
				known[rel] = {n.name for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)}
		for rel, entries in ALLOWED.items():
			self.assertIn(rel, known, f"{rel} no longer exists")
			for name in entries:
				if name != "*":
					self.assertIn(name, known[rel], f"{rel}: {name} no longer exists")


if __name__ == "__main__":
	unittest.main()
