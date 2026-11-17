# Copyright (c) 2026, Frappe Technologies and contributors
# For license information, please see license.txt

# import frappe
from frappe.model.document import Document


class NRCReferralandConsent(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.apf.doctype.counselling_topics_covered_child_table.counselling_topics_covered_child_table import CounsellingTopicscoveredchildtable
		from frappe.apf.doctype.facility_topics_covered_child_table.facility_topics_covered_child_table import FacilityTopicscoveredChildtable
		from frappe.types import DF

		age_in_months: DF.Data | None
		app_updated_by: DF.Data | None
		app_updated_on: DF.Data | None
		appcreated_by: DF.Data | None
		appcreated_on: DF.Data | None
		block_id: DF.Link
		cgmguid: DF.Data | None
		child_id: DF.Data | None
		child_name: DF.Data | None
		childenrollguid: DF.Data | None
		con_guid: DF.Data | None
		creche_id: DF.Link
		date_of_referral: DF.Date
		district_id: DF.Link
		facility_if_reason: DF.Link | None
		facility_topics_covered: DF.TableMultiSelect[FacilityTopicscoveredChildtable]
		facility_topics_covered_other: DF.Data | None
		gender_id: DF.Link | None
		gp_id: DF.Link
		haz_at_identification: DF.Data | None
		haz_at_identification_cat: DF.Float
		height_for_age: DF.Float
		heightlength_at_growth_monitoring_cm: DF.Float
		if_no_reason: DF.Link | None
		if_no_reason_other: DF.Data | None
		name: DF.Int | None
		nrc_rc_guid: DF.Data | None
		parentcaregiver_counseled_about_visit_to_higher_health_facility: DF.Link | None
		parents_consented_to_visit_higher_health_facility: DF.Link
		parents_consented_to_visit_nrc: DF.Link | None
		parents_counseled_about_nrc_admission: DF.Link
		partner_id: DF.Link
		referral_slipletter_provided: DF.Check
		referral_to: DF.Link | None
		referred_from: DF.Link | None
		state_id: DF.Link
		topics_covered: DF.TableMultiSelect[CounsellingTopicscoveredchildtable]
		topics_covered_other: DF.Data | None
		village_id: DF.Link
		waz_at_identification: DF.Data | None
		waz_at_identification_cat: DF.Float
		weight_at_growth_monitoring_kg: DF.Float
		weight_for_age: DF.Float
		weight_for_height: DF.Float
		whz_at_identification: DF.Data | None
		whz_at_identification_cat: DF.Float
	# end: auto-generated types

	pass
