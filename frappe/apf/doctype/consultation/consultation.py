# Copyright (c) 2026, Frappe Technologies and contributors
# For license information, please see license.txt

# import frappe
from frappe.model.document import Document


class Consultation(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.apf.doctype.diagnosed_conditions_child_table.diagnosed_conditions_child_table import DiagnosedConditionschildtable
		from frappe.apf.doctype.lab_form_specify_child_table.lab_form_specify_child_table import LabFormspecifychildtable
		from frappe.apf.doctype.laboratory_tests_child_table.laboratory_tests_child_table import LaboratoryTestschildtable
		from frappe.types import DF

		age_in_months: DF.Int
		any_conditions_diagnosed: DF.TableMultiSelect[DiagnosedConditionschildtable]
		any_conditions_diagnosed_other: DF.Data | None
		any_current_laboratory_tests_ordered: DF.TableMultiSelect[LaboratoryTestschildtable]
		app_updated_by: DF.Data | None
		app_updated_on: DF.Data | None
		appcreated_by: DF.Data | None
		appcreated_on: DF.Data | None
		block_id: DF.Link
		cgmguid: DF.Data | None
		child_dob: DF.Date | None
		child_id: DF.Data | None
		child_name: DF.Data | None
		childenrollguid: DF.Data | None
		con_guid: DF.Data | None
		consultation_completed: DF.Check
		creche_id: DF.Link
		date_of_consultation: DF.Date | None
		date_of_identification: DF.Date | None
		date_of_referral: DF.Date | None
		did_the_supervisor_purchase_medicines_from_pharmacy: DF.Check
		district_id: DF.Link
		facility_visited_to: DF.Link | None
		facility_visited_to_other: DF.Data | None
		follow_up: DF.Check
		follow_up_date_given_by_doctor: DF.Date | None
		follow_up_date_recommended_by_doctor: DF.Check
		gender_id: DF.Link | None
		gm_categories: DF.Link | None
		gp_id: DF.Link
		haz_at_identification: DF.Data | None
		haz_at_identification_cat: DF.Float
		height_for_age: DF.Float
		height_for_age_zscore: DF.Data | None
		heightlength_at_growth_monitoring_cm: DF.Float
		heightlength_measured_at_facility_value: DF.Float
		heightlength_position: DF.Link | None
		if_no_reason: DF.Link | None
		if_no_reason_other: DF.Data | None
		if_no_specify_reason_other: DF.Data | None
		if_no_specify_reasons: DF.TableMultiSelect[LabFormspecifychildtable]
		if_yes_facility_name: DF.Link | None
		if_yes_facility_name_other: DF.Data | None
		ill_guid: DF.Data | None
		is_the_the_medicines_fully_distributed_to_the_mother: DF.Check
		lab: DF.Check
		lab_test_prescribed: DF.Check
		laboratory_tests_ordered_other: DF.Data | None
		medicine_administration_explained_to_parents: DF.Check
		medicine_list_shared_with_parents: DF.Check
		medicines: DF.Check
		medicines_prescribed: DF.Check
		medicines_provided: DF.Link | None
		name: DF.Int | None
		nrc_facility_categories: DF.Link | None
		parents_consented: DF.Check
		parents_understanding_of_treatment_plan: DF.Link | None
		partner_id: DF.Link
		place_of_referral: DF.Link | None
		r_c_guid: DF.Data | None
		reason_for_referral: DF.Link | None
		reason_for_referral_other: DF.Data | None
		referral: DF.Check
		referral_slip_given: DF.Check
		reffral_counsulation_guid: DF.Data | None
		reschedule_followup: DF.Data | None
		special_nutrition_care_snc_instructions_given_by_doctor: DF.Check
		state_id: DF.Link
		test_conducted: DF.Check
		village_id: DF.Link
		waz_at_identification: DF.Data | None
		waz_at_identification_cat: DF.Float
		weight_and_heightlength_measured_at_the_facility: DF.Check
		weight_at_growth_monitoring_kg: DF.Float
		weight_for_age: DF.Float
		weight_for_age_zscore: DF.Data | None
		weight_for_height: DF.Float
		weight_for_height_zscore: DF.Data | None
		weight_measured_at_facility_value: DF.Float
		whz_at_identification: DF.Data | None
		whz_at_identification_cat: DF.Float
	# end: auto-generated types

	pass
