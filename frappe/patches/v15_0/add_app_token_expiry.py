import frappe
from frappe.api_token import EXPIRY_FIELD, new_expiry


def execute():
	"""Give the mobile app's existing API tokens an expiry and drop ``User.token``.

	* ``User.api_token_expires_on`` is new. Tokens that were issued by the mobile login before it
	  existed would otherwise never expire. They are recognised by ``app_device_id`` (only the
	  mobile login sets it) and get the normal lifetime counted from now, so field staff are not
	  logged out by the deploy. To force every mobile user to log in again immediately instead, run
	  ``bench --site <site> execute frappe.api_token.revoke_all`` afterwards.
	* ``User.token`` was an unused leftover of the old clear-text token copy (see
	  ``clear_plaintext_user_token``). Drop the field and its column.

	Hand-made integration keys (no ``app_device_id``) keep working without an expiry.
	"""
	frappe.reload_doc("core", "doctype", "user")

	expires_on = new_expiry()
	if expires_on and frappe.db.has_column("User", EXPIRY_FIELD):
		frappe.db.sql(
			"""UPDATE `tabUser` SET `api_token_expires_on` = %s
			WHERE `api_token_expires_on` IS NULL AND IFNULL(`app_device_id`, '') != ''""",
			(expires_on,),
		)

	if frappe.db.has_column("User", "token"):
		frappe.model.delete_fields({"User": ["token"]}, delete=1)
