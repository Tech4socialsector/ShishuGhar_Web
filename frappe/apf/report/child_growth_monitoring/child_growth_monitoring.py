# Copyright (c) 2024, Frappe Technologies and contributors
# For license information, please see license.txt

# import frappe


from frappe.apf.user_scope import scoped
@scoped()
def execute(filters=None):
	columns, data = [], []
	return columns, data
