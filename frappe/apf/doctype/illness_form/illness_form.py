# Copyright (c) 2026, Frappe Technologies and contributors
# For license information, please see license.txt

# import frappe
from frappe.model.document import Document


class Illnessform(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		age_in_months: DF.Int
		app_updated_on: DF.Data | None
		appcreated_by: DF.Data | None
		appcreated_on: DF.Data | None
		block_id: DF.Link
		cgmguid: DF.Data | None
		child_dob: DF.Date | None
		child_id: DF.Data | None
		child_name: DF.Data | None
		childenrollguid: DF.Data | None
		creche_id: DF.Link
		date_of_identification: DF.Date | None
		date_of_referral: DF.Date
		district_id: DF.Link
		gender_id: DF.Link | None
		gp_id: DF.Link
		heightlength_at_growth_monitoring_cm: DF.Float
		ill_guid: DF.Data | None
		name: DF.Int | None
		other: DF.Data | None
		partner_id: DF.Link
		referral_to: DF.Link
		state_id: DF.Link
		type_of_illness: DF.Link
		village_id: DF.Link
		weight_at_growth_monitoring_kg: DF.Float
	# end: auto-generated types

	pass
