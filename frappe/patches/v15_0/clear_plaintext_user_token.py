import frappe


def execute():
	"""Remove the clear-text ``token <api_key>:<api_secret>`` copies from ``User.token``.

	The mobile login (``frappe.val.api.generate_keys``) used to store the full
	credential in this plain Data field, readable by anyone who can read User
	records. Requests are now verified against the user's ``api_key`` and the
	*encrypted* ``api_secret`` instead, so the copy is no longer needed.

	Existing app installs keep working: the key/secret they already hold are
	still valid, only the redundant clear-text copy is deleted.
	"""
	if not frappe.db.has_column("User", "token"):
		return

	frappe.db.sql("UPDATE `tabUser` SET `token` = NULL WHERE `token` IS NOT NULL")
