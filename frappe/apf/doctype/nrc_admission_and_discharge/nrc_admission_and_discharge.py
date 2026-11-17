# Copyright (c) 2026, Frappe Technologies and contributors
# For license information, please see license.txt

# import frappe
from frappe.model.document import Document


class NRCAdmissionandDischarge(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.apf.doctype.lama_child_table.lama_child_table import LAMAchildtable
		from frappe.apf.doctype.referral_higher_center_child_table.referral_higher_center_child_table import ReferralHigherCenterchildtable
		from frappe.types import DF

		actual_duration_of_stay_days: DF.Int
		age_in_months: DF.Int
		any_medicines_prescribed: DF.Check
		app_updated_by: DF.Data | None
		app_updated_on: DF.Data | None
		appcreated_by: DF.Data | None
		appcreated_on: DF.Data | None
		appetite_test_results: DF.Link | None
		block_id: DF.Link
		cause_of_death: DF.Data | None
		cgmguid: DF.Data | None
		child_admitted_to_nrc: DF.Link
		child_condition_at_referral: DF.Link | None
		child_dob: DF.Date | None
		child_id: DF.Data | None
		child_name: DF.Data | None
		childenrollguid: DF.Data | None
		con_guid: DF.Data | None
		counseling_done_before_lama: DF.Link | None
		creche_id: DF.Link
		date_of_admission: DF.Date | None
		date_of_death: DF.Date | None
		date_of_discharge: DF.Date | None
		date_of_identification: DF.Date | None
		date_of_leaving: DF.Date | None
		date_of_referral: DF.Date | None
		date_of_referral_higher_center: DF.Date | None
		death_certificate_issued: DF.Link | None
		death_reported_to_authorities: DF.Link | None
		did_the_supervisor_purchase_medicines_from_pharmacy: DF.Check
		discharge_status: DF.Link | None
		discharge_summary_provided: DF.Check
		district_id: DF.Link
		do_you_want_to_discharge: DF.Check
		duration_from_admission_to_death_days: DF.Int
		duration_of_stay_before_lama_days: DF.Int
		expected_duration_of_stay: DF.Int
		gender_id: DF.Link | None
		gp_id: DF.Link
		haz_at_discharge: DF.Float
		haz_at_identification: DF.Data | None
		haz_at_identification_cat: DF.Float
		height_at_admission_cm: DF.Float
		height_at_discharge_cm: DF.Float
		height_for_age: DF.Float
		height_for_age_d: DF.Float
		heightlength_at_growth_monitoring_cm: DF.Float
		if_no_nrc_admission: DF.Link | None
		if_no_nrc_admission_other: DF.Data | None
		if_others_specify: DF.Data | None
		ill_guid: DF.Data | None
		is_the_the_medicines_fully_distributed_to_the_mother: DF.Check
		lama_form_signed: DF.Link | None
		lama_other: DF.Data | None
		medicine_administration_explained_to_parents: DF.Check
		medicine_list_shared_with_parents: DF.Check
		medicines_provided: DF.Link | None
		name: DF.Int | None
		nrc_ad_guid: DF.Data | None
		parents_understanding_of_treatment_plan: DF.Check
		partner_id: DF.Link
		rc_guid: DF.Data | None
		reason_for_lama: DF.TableMultiSelect[LAMAchildtable]
		reason_for_referral_higher_center: DF.TableMultiSelect[ReferralHigherCenterchildtable]
		reason_for_referral_higher_center_other: DF.Data | None
		referral_letter_provided: DF.Check
		referral_slipletter_provided: DF.Check
		referral_to: DF.Link | None
		referred_from: DF.Link | None
		referred_to_facility_name: DF.Link | None
		referred_to_facility_name_other: DF.Data | None
		reffral_counsulation_guid: DF.Data | None
		state_id: DF.Link
		time_of_death: DF.Time | None
		village_id: DF.Link
		waz_at_admission: DF.Data | None
		waz_at_discharge: DF.Float
		waz_at_identification: DF.Data | None
		waz_at_identification_cat: DF.Float
		weight_at_admission_kg: DF.Float
		weight_at_discharge_kg: DF.Float
		weight_at_growth_monitoring_kg: DF.Float
		weight_at_time_of_leaving_kg: DF.Int
		weight_for_age: DF.Float
		weight_for_age_d: DF.Float
		weight_for_height: DF.Float
		weight_for_height_d: DF.Float
		weight_gain_during_stay_kg: DF.Float
		whz_at_admission: DF.Data | None
		whz_at_discharge: DF.Float
		whz_at_identification: DF.Data | None
		whz_at_identification_cat: DF.Float
	# end: auto-generated types

	pass
