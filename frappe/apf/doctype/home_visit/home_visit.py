# Copyright (c) 2026, Frappe Technologies and contributors
# For license information, please see license.txt

# import frappe
from frappe.model.document import Document


class HomeVisit(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		activity_level_of_child: DF.Link | None
		age_in_months: DF.Int
		any_illness_reported_by_motherfamily_member: DF.Link | None
		app_updated_on: DF.Data | None
		appcreated_by: DF.Data | None
		appcreated_on: DF.Data | None
		block_id: DF.Link
		cgmguid: DF.Data | None
		child_dob: DF.Date | None
		child_id: DF.Data | None
		child_name: DF.Data | None
		childenrollguid: DF.Data | None
		counselling: DF.Link | None
		counselling_on_diet: DF.Link | None
		counselling_on_hygiene: DF.Link | None
		creche_id: DF.Link
		current_month_weight: DF.Data | None
		date_of_identification: DF.Date | None
		district_id: DF.Link
		gender_id: DF.Link | None
		gp_id: DF.Link
		hv_guid: DF.Data | None
		months_of_follow_up: DF.Data | None
		name: DF.Int | None
		partner_id: DF.Link
		state_id: DF.Link
		village_id: DF.Link
	# end: auto-generated types

	pass
