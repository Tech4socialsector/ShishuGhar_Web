"""Legacy image-upload endpoint -- deliberately NOT whitelisted any more.

It called ``upload()`` (which saves the file and adds an "Attachment" comment to whatever
``doctype`` / ``docname`` the caller names, with no permission check) and then
``update_image_to_field()``, a function that does not exist anywhere in the code base, so
every call failed after the side effects had already happened. Nothing in the repository
calls it. To bring image upload back, use Frappe's own ``/api/method/upload_file`` (it checks
permissions) or write a purpose-built endpoint that authorises the target document first.
"""
