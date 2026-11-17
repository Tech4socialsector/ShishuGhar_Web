"""Unit tests for frappe.apf.scope_logic (framework free).

Run standalone:  python -I -m unittest frappe/tests/test_scope_logic.py
"""

import importlib.util
import os
import sys
import unittest

_PATH = os.path.join(os.path.dirname(__file__), "..", "apf", "scope_logic.py")
_spec = importlib.util.spec_from_file_location("scope_logic_under_test", _PATH)
sl = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = sl  # @dataclass needs the module to be registered
_spec.loader.exec_module(sl)

# --- a tiny fake geography ------------------------------------------------
#   state 1 -> district 10 -> block 100 -> gp 1000 -> village 10000
#   state 1 -> district 10 -> block 101 -> gp 1010
#   state 1 -> district 11 -> block 110
#   state 2 -> district 20 -> block 200 -> gp 2000
PATHS = {
	("state_id", "1"): {"state_id": "1"},
	("state_id", "2"): {"state_id": "2"},
	("district_id", "10"): {"state_id": "1", "district_id": "10"},
	("district_id", "11"): {"state_id": "1", "district_id": "11"},
	("district_id", "20"): {"state_id": "2", "district_id": "20"},
	("block_id", "100"): {"state_id": "1", "district_id": "10", "block_id": "100"},
	("block_id", "101"): {"state_id": "1", "district_id": "10", "block_id": "101"},
	("block_id", "200"): {"state_id": "2", "district_id": "20", "block_id": "200"},
	("gp_id", "1000"): {"state_id": "1", "district_id": "10", "block_id": "100", "gp_id": "1000"},
	("gp_id", "2000"): {"state_id": "2", "district_id": "20", "block_id": "200", "gp_id": "2000"},
	("creche_id", "7"): {
		"partner_id": "5", "state_id": "1", "district_id": "10", "block_id": "100",
		"gp_id": "1000", "village_id": "10000",
	},
	("creche_id", "8"): {
		"partner_id": "6", "state_id": "2", "district_id": "20", "block_id": "200",
		"gp_id": "2000", "village_id": None,
	},
}


def lookup(key, token):
	return PATHS.get((key, token))


def row(**kw):
	return sl.normalise_row(kw)


def ev(scope, requested, mode="mapping"):
	return sl.evaluate_request(scope, requested, lookup, mode)


class TestParseIds(unittest.TestCase):
	def test_scalars_and_lists(self):
		self.assertEqual(sl.parse_ids("5"), ["5"])
		self.assertEqual(sl.parse_ids(5), ["5"])
		self.assertEqual(sl.parse_ids("1, 2,3"), ["1", "2", "3"])
		self.assertEqual(sl.parse_ids(["7", 8]), ["7", "8"])
		self.assertEqual(sl.parse_ids("007"), ["7"])

	def test_unset_values_ignored(self):
		for v in (None, "", "null", "None", "undefined", "0", " "):
			self.assertEqual(sl.parse_ids(v), [], v)

	def test_non_numeric_rejected(self):
		for v in ("abc", "1' OR '1'='1", "1;DROP TABLE x", "1 2", "-1", "1.5", "²", "1,x"):
			with self.assertRaises(sl.InvalidFilter, msg=v):
				sl.parse_ids(v)

	def test_is_set(self):
		self.assertFalse(sl.is_set(None))
		self.assertFalse(sl.is_set(""))
		self.assertFalse(sl.is_set("null"))
		self.assertTrue(sl.is_set("3"))
		self.assertTrue(sl.is_set(3))


class TestClassify(unittest.TestCase):
	def test_state_row_covers_everything_in_state(self):
		rows = [row(state_id="1")]
		self.assertEqual(sl.classify(rows, PATHS[("gp_id", "1000")], 3), "full")
		self.assertEqual(sl.classify(rows, PATHS[("state_id", "1")], 0), "full")
		self.assertEqual(sl.classify(rows, PATHS[("state_id", "2")], 0), "none")
		self.assertEqual(sl.classify(rows, PATHS[("gp_id", "2000")], 3), "none")

	def test_gp_row_only_partially_covers_ancestors(self):
		rows = [row(state_id="1", district_id="10", block_id="100", gp_id="1000")]
		self.assertEqual(sl.classify(rows, PATHS[("state_id", "1")], 0), "partial")
		self.assertEqual(sl.classify(rows, PATHS[("block_id", "100")], 2), "partial")
		self.assertEqual(sl.classify(rows, PATHS[("gp_id", "1000")], 3), "full")
		self.assertEqual(sl.classify(rows, PATHS[("block_id", "101")], 2), "none")
		self.assertEqual(sl.classify(rows, PATHS[("state_id", "2")], 0), "none")

	def test_full_wins_over_partial_across_rows(self):
		rows = [row(state_id="1", district_id="10", block_id="100"), row(state_id="1")]
		self.assertEqual(sl.classify(rows, PATHS[("district_id", "10")], 1), "full")


class TestEvaluate(unittest.TestCase):
	def test_unrestricted_passes_everything(self):
		d = ev(sl.Scope(unrestricted=True), {"partner_id": ["99"], "state_id": ["2"]})
		self.assertEqual((d.drop, d.inject), (set(), {}))

	def test_denied_user_rejected(self):
		with self.assertRaises(sl.ScopeViolation):
			ev(sl.Scope(denied=True), {})

	def test_partner_cannot_be_overridden(self):
		scope = sl.Scope(partner="5")
		ev(scope, {"partner_id": ["5"]})
		with self.assertRaises(sl.ScopeViolation):
			ev(scope, {"partner_id": ["6"]})
		with self.assertRaises(sl.ScopeViolation):
			ev(scope, {"partner_id": ["5", "6"]})

	def test_partner_only_user_geography_unrestricted_but_creche_partner_checked(self):
		scope = sl.Scope(partner="5")
		ev(scope, {"state_id": ["2"]})  # partner-only: no geo rows
		ev(scope, {"creche_id": ["7"]})
		with self.assertRaises(sl.ScopeViolation):
			ev(scope, {"creche_id": ["8"]})  # belongs to partner 6

	def test_state_mapped_user(self):
		scope = sl.Scope(rows=[row(state_id="1")])
		ev(scope, {"state_id": ["1"], "district_id": ["10"], "gp_id": ["1000"]})
		ev(scope, {"creche_id": ["7"]})
		for bad in ({"state_id": ["2"]}, {"district_id": ["20"]}, {"gp_id": ["2000"]}, {"creche_id": ["8"]}):
			with self.assertRaises(sl.ScopeViolation, msg=str(bad)):
				ev(scope, bad)

	def test_gp_mapped_user_coarse_request_is_narrowed_in_mapping_mode(self):
		scope = sl.Scope(rows=[row(state_id="1", district_id="10", block_id="100", gp_id="1000")])
		d = ev(scope, {"state_id": ["1"]})
		self.assertEqual(d.drop, {"state_id"})
		# only coarse levels, none fully covered -> narrowed to the mapping
		d = ev(scope, {"state_id": ["1"], "district_id": ["10"]})
		self.assertEqual(d.drop, {"state_id", "district_id"})

	def test_full_cascade_from_dropdowns_is_accepted_untouched(self):
		scope = sl.Scope(rows=[row(state_id="1", district_id="10", block_id="100", gp_id="1000")])
		cascade = {"state_id": ["1"], "district_id": ["10"], "block_id": ["100"], "gp_id": ["1000"]}
		for mode in ("mapping", "inject"):
			d = ev(scope, cascade, mode)
			self.assertEqual((d.drop, d.inject), (set(), {}), mode)
		# a covered creche also makes the coarse levels harmless
		d = ev(scope, {"state_id": ["1"], "creche_id": ["7"]}, "inject")
		self.assertEqual(d.drop, set())

	def test_coarse_level_is_not_excused_by_a_partial_finer_level(self):
		scope = sl.Scope(rows=[row(state_id="1", district_id="10", block_id="100", gp_id="1000")])
		d = ev(scope, {"state_id": ["1"], "block_id": ["100"]})  # block is partial too
		self.assertEqual(d.drop, {"state_id", "block_id"})

	def test_injected_values_pass_a_second_evaluation(self):
		# a nested decorated call sees the injected path in frappe.form_dict
		scope = sl.Scope(rows=[row(state_id="1", district_id="10", block_id="100", gp_id="1000")])
		injected = ev(scope, {}, "inject").inject
		again = {level: [value] for level, value in injected.items()}
		d = ev(scope, again, "inject")
		self.assertEqual((d.drop, d.inject), (set(), {}))

	def test_gp_mapped_user_coarse_request_rejected_in_inject_mode(self):
		scope = sl.Scope(rows=[row(state_id="1", district_id="10", block_id="100", gp_id="1000")])
		with self.assertRaises(sl.ScopeViolation):
			ev(scope, {"state_id": ["1"]}, "inject")
		ev(scope, {"gp_id": ["1000"]}, "inject")  # fully covered is fine

	def test_nonexistent_record_rejected(self):
		with self.assertRaises(sl.ScopeViolation):
			ev(sl.Scope(rows=[row(state_id="1")]), {"district_id": ["999"]})
		with self.assertRaises(sl.ScopeViolation):
			ev(sl.Scope(partner="5"), {"creche_id": ["999"]})

	def test_inject_partner_with_single_row(self):
		scope = sl.Scope(partner="5", rows=[row(state_id="1", district_id="10")])
		d = ev(scope, {}, "inject")
		self.assertEqual(d.inject, {"partner_id": "5", "state_id": "1", "district_id": "10"})

	def test_inject_never_widens_a_multi_row_mapping(self):
		# two districts of one state: injecting state 1 would widen the mapping
		scope = sl.Scope(partner="5", rows=[row(state_id="1", district_id="10"), row(state_id="1", district_id="11")])
		with self.assertRaises(sl.ScopeViolation):
			ev(scope, {}, "inject")
		d = ev(scope, {"district_id": ["10"]}, "inject")  # an explicit, fully covered choice is fine
		self.assertEqual(d.inject, {"partner_id": "5"})

	def test_inject_single_row_injects_every_level(self):
		scope = sl.Scope(rows=[row(state_id="1", district_id="10", block_id="100", gp_id="1000")])
		d = ev(scope, {}, "inject")
		self.assertEqual(
			d.inject, {"state_id": "1", "district_id": "10", "block_id": "100", "gp_id": "1000"}
		)

	def test_inject_multi_state_user_must_choose(self):
		scope = sl.Scope(rows=[row(state_id="1"), row(state_id="2")])
		with self.assertRaises(sl.ScopeViolation):
			ev(scope, {}, "inject")
		ev(scope, {"state_id": ["2"]}, "inject")  # choosing one is fine

	def test_inject_not_applied_when_caller_supplied_filters(self):
		scope = sl.Scope(partner="5", rows=[row(state_id="1")])
		d = ev(scope, {"partner_id": ["5"], "district_id": ["10"]}, "inject")
		self.assertEqual(d.inject, {})

	def test_mapping_mode_never_injects(self):
		d = ev(sl.Scope(partner="5", rows=[row(state_id="1")]), {}, "mapping")
		self.assertEqual((d.drop, d.inject), (set(), {}))

	def test_multiple_tokens_all_checked(self):
		scope = sl.Scope(rows=[row(state_id="1")])
		with self.assertRaises(sl.ScopeViolation):
			ev(scope, {"district_id": ["10", "20"]})


class TestAuthorizeEntity(unittest.TestCase):
	def test_entity_checks(self):
		creche7, creche8 = PATHS[("creche_id", "7")], PATHS[("creche_id", "8")]
		sl.authorize_entity(sl.Scope(unrestricted=True), creche8)
		sl.authorize_entity(sl.Scope(partner="5", rows=[row(state_id="1")]), creche7)
		for scope in (
			sl.Scope(denied=True),
			sl.Scope(partner="5"),  # creche8 is partner 6
			sl.Scope(rows=[row(state_id="1")]),  # creche8 is state 2
			sl.Scope(partner="6", rows=[row(state_id="1")]),
		):
			with self.assertRaises(sl.ScopeViolation):
				sl.authorize_entity(scope, creche8)


class TestSingleRow(unittest.TestCase):
	def test_single_row(self):
		self.assertEqual(sl.single_row([row(state_id="1", district_id="10")]), {"state_id": "1", "district_id": "10"})
		self.assertEqual(sl.single_row([row(state_id="1"), row(state_id="1")]), {"state_id": "1"})  # duplicates collapse
		self.assertEqual(sl.single_row([row(state_id="1", district_id="10"), row(state_id="1", district_id="11")]), {})
		self.assertEqual(sl.single_row([row(state_id="1"), row(state_id="2")]), {})


if __name__ == "__main__":
	unittest.main()
