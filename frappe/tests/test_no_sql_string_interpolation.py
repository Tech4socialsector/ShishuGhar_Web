"""Static guard: request-derived values must not be pasted into SQL as '{value}'.

Walks the custom app code (apf, creche_module, val), finds f-strings that look like
SQL and contain a *quoted* placeholder (``'{x}'`` / ``"{x}"``) whose value traces
back to a function argument, ``filters``, ``frappe.form_dict`` or ``kwargs``.
Use bound parameters (``%(name)s``) or ``frappe.db.escape(value)`` instead.

Pure standard library (no frappe import) so it runs anywhere:
    python -I frappe/tests/test_no_sql_string_interpolation.py
"""

import ast
import os
import re
import unittest

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
DIRS = ("apf", "creche_module", "val")
SRC = ("filters", "form_dict", "request", "kwargs")
SQLISH = re.compile(r"(=|<|>|\bIN\b|BETWEEN|LIKE|SELECT|WHERE|\bAND\b|\bOR\b|FIND_IN_SET|INTERVAL|LIMIT)", re.I)
MESSAGE_CALLS = {"throw", "msgprint", "log_error", "_", "print", "debug", "info", "error", "warning"}

# Reviewed false positives: the "tainted" value is not request text, or the
# string is not SQL. Add to this list ONLY after reading the code.
REVIEWED = {
	"apf/page/creche_report_card/web_report_card_detail.py": "column aliases built from calendar ints",
	"apf/page/creche_dashboard/web_report_card_detail.py": "column aliases built from calendar ints",
	"val/ph_report_card_detail.py": "column aliases built from calendar ints",
	"apf/page/mis_attendances_dash/indicator.py": "loops over a fixed category list",
	"apf/page/review_card/review_cards_details.py": "label from a constant mapping",
	"apf/page/review_report_card/review_apis.py": "fixed trend symbol via str.replace",
	"apf/report/cohort_child_wise/cohort_child_wise.py": "month_end computed from a date",
	"apf/report/nutrition_status_(child_wise)/nutrition_status_(child_wise).py": "month_end computed from a date",
	"apf/report/gramsabha_community_resolution_report/gramsabha_community_resolution_report.py": "HTML data-* attributes, not SQL",
}


def _taint_names(tree):
	tainted = set()
	for fn in (n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)):
		for a in fn.args.args + fn.args.kwonlyargs:
			if a.arg not in ("self", "cls"):
				tainted.add(a.arg)
		if fn.args.kwarg:
			tainted.add(fn.args.kwarg.arg)
	assigns = [n for n in ast.walk(tree) if isinstance(n, (ast.Assign, ast.AugAssign, ast.AnnAssign, ast.NamedExpr))]
	changed = True
	while changed:
		changed = False
		for n in assigns:
			value = getattr(n, "value", None)
			if value is None:
				continue
			names = {x.id for x in ast.walk(value) if isinstance(x, ast.Name)}
			if not (any(t in ast.unparse(value) for t in SRC) or names & tainted):
				continue
			targets = n.targets if isinstance(n, ast.Assign) else [getattr(n, "target", None)]
			for t in targets:
				for x in ast.walk(t) if t is not None else ():
					if isinstance(x, ast.Name) and x.id not in tainted:
						tainted.add(x.id)
						changed = True
	return tainted


def _in_message_call(parents, node):
	p = parents.get(node)
	while p is not None:
		if isinstance(p, ast.Call):
			f = p.func
			if (f.attr if isinstance(f, ast.Attribute) else getattr(f, "id", "")) in MESSAGE_CALLS:
				return True
		p = parents.get(p)
	return False


def quoted_tainted_placeholders(path):
	"""[(lineno, expression)] for quoted, request-tainted placeholders in SQL-like f-strings."""
	with open(path, encoding="utf-8", errors="ignore") as fh:
		text = fh.read()
	text = text[1:] if text.startswith("﻿") else text
	tree = ast.parse(text)
	parents = {c: p for p in ast.walk(tree) for c in ast.iter_child_nodes(p)}
	tainted = _taint_names(tree)
	lines = text.encode("utf-8").split(b"\n")
	found = []
	for js in (n for n in ast.walk(tree) if isinstance(n, ast.JoinedStr)):
		literal = "".join(v.value for v in js.values if isinstance(v, ast.Constant) and isinstance(v.value, str))
		if not SQLISH.search(literal) or _in_message_call(parents, js):
			continue
		for v in js.values:
			if not isinstance(v, ast.FormattedValue) or v.value.lineno != v.value.end_lineno:
				continue
			expr = ast.unparse(v.value)
			names = {x.id for x in ast.walk(v.value) if isinstance(x, ast.Name)}
			if not (names & tainted) or expr.startswith(("int(", "float(", "len(")) or "escape(" in expr:
				continue
			line = lines[v.value.lineno - 1]
			i, j = v.value.col_offset - 1, v.value.end_col_offset
			while i >= 0 and line[i : i + 1] == b" ":
				i -= 1
			while j < len(line) and line[j : j + 1] == b" ":
				j += 1
			if (
				i >= 1
				and line[i : i + 1] == b"{"
				and line[j : j + 1] == b"}"
				and line[i - 1 : i] in (b"'", b'"')
				and line[j + 1 : j + 2] == line[i - 1 : i]
			):
				found.append((v.value.lineno, expr))
	return found


class TestNoSqlStringInterpolation(unittest.TestCase):
	def test_no_quoted_request_values_in_sql(self):
		offenders = []
		for d in DIRS:
			for dirpath, _dirs, files in os.walk(os.path.join(ROOT, d)):
				if "node_modules" in dirpath or "__pycache__" in dirpath:
					continue
				for name in files:
					if not name.endswith(".py"):
						continue
					path = os.path.join(dirpath, name)
					rel = os.path.relpath(path, ROOT).replace("\\", "/")
					if rel in REVIEWED:
						continue
					try:
						hits = quoted_tainted_placeholders(path)
					except SyntaxError:
						continue
					offenders += [f"{rel}:{ln}  '{{{expr}}}'" for ln, expr in hits]
		self.assertEqual(
			offenders,
			[],
			"Request-derived values pasted into SQL as '{value}' (SQL injection). Use bound "
			"parameters (%(name)s) or frappe.db.escape(value):\n  " + "\n  ".join(offenders),
		)

	def test_reviewed_list_has_no_stale_entries(self):
		for rel in REVIEWED:
			self.assertTrue(os.path.exists(os.path.join(ROOT, rel)), f"remove stale allowlist entry: {rel}")


if __name__ == "__main__":
	unittest.main()
