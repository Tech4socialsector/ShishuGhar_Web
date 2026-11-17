import frappe
import re
import json
import os
from frappe.utils.xlsxutils import make_xlsx
from frappe.utils import now_datetime, add_days, get_datetime


# ==========================================
# CHILD ID
# ==========================================

@frappe.whitelist()
def fix_duplicate_child_ids(export_excel=False, dry_run=1):
    """
    API to find/fix duplicate child_id in 'Child Enrollment and Exit'.
    dry_run=1 -> only report duplicates, no updates.
    dry_run=0 -> actually update duplicate records.
    """

    result = {
        "status": "success",
        "total_duplicate_ids": 0,
        "total_duplicate_records": 0,
        "total_updated": 0,
        "total_skipped": 0,
        "updated_records": [],
        "duplicate_records": [],
        "duplicate_groups": [],
        "errors": []
    }

    dry_run = frappe.utils.cint(dry_run)

    try:
        # 1. Identify duplicate child_id values
        query = """
            SELECT child_id, COUNT(*) AS cnt
            FROM `tabChild Enrollment and Exit`
            WHERE child_id IS NOT NULL AND child_id != ''
            GROUP BY child_id
            HAVING COUNT(*) > 1;
        """
        duplicates = frappe.db.sql(query, as_dict=True)
        result["total_duplicate_ids"] = len(duplicates)

        for dup in duplicates:
            original_child_id = dup.child_id
            count = dup.cnt
            result["total_duplicate_records"] += count

            # Fetch all records sharing this duplicate child_id
            # Order by creation ASC so the oldest record keeps the original ID
            records = frappe.db.get_all(
                "Child Enrollment and Exit",
                filters={"child_id": original_child_id},
                fields=["name", "child_name", "child_id"],
                order_by="creation asc"
            )

            for r in records:
                result["duplicate_records"].append({
                    "name": r.name,
                    "child_name": r.child_name,
                    "child_id": r.child_id
                })

            result["duplicate_groups"].append({
                "id_value": original_child_id,
                "count": count,
                "names": [r.child_name for r in records],
                "records": [{"name": r.name, "child_name": r.child_name, "child_id": r.child_id} for r in records]
            })

            if dry_run:
                continue

            # Skip the first record (keep original ID), update the rest
            for i in range(1, len(records)):
                record = records[i]
                old_id = record.child_id

                # 2. Get sequential unique ID
                new_id = get_next_available_id("Child Enrollment and Exit", "child_id", old_id)

                if not new_id:
                    result["errors"].append(f"Could not parse/generate ID for {old_id} (Record: {record.name})")
                    result["total_skipped"] += 1
                    continue

                # 3. Update the record
                try:
                    frappe.db.set_value("Child Enrollment and Exit", record.name, "child_id", new_id)

                    log_id_change(
                        doctype="Child Enrollment and Exit",
                        docname=record.name,
                        old_name_value=record.child_name,
                        new_name_value=record.child_name,
                        old_id_value=old_id,
                        new_id_value=new_id,
                        source="auto_fix"
                    )

                    result["updated_records"].append({
                        "name": record.name,
                        "child_name": record.child_name,
                        "old_child_id": old_id,
                        "new_child_id": new_id
                    })
                    result["total_updated"] += 1
                except Exception as e:
                    result["errors"].append(f"Failed to update {record.name}: {str(e)}")
                    result["total_skipped"] += 1

        if not dry_run:
            frappe.db.commit()

        # 4. Optional Excel Export Handling
        if frappe.utils.cint(export_excel):
            rows = result["updated_records"] if not dry_run else result["duplicate_records"]
            if rows:
                return export_to_excel(rows)

    except Exception as e:
        frappe.db.rollback()
        result["status"] = "error"
        result["errors"].append(str(e))
        frappe.log_error(frappe.get_traceback(), "Deduplicate Child IDs Error")

    return result


# ==========================================
# CRECHE ID
# ==========================================

@frappe.whitelist()
def fix_duplicate_creche_ids(export_excel=False, dry_run=1):
    """
    API to find/fix duplicate creche_id in 'Creche'.
    dry_run=1 -> only report duplicates, no updates.
    dry_run=0 -> actually update duplicate records.
    """

    result = {
        "status": "success",
        "total_duplicate_ids": 0,
        "total_duplicate_records": 0,
        "total_updated": 0,
        "total_skipped": 0,
        "updated_records": [],
        "duplicate_records": [],
        "duplicate_groups": [],
        "errors": []
    }

    dry_run = frappe.utils.cint(dry_run)

    try:
        # 1. Identify duplicate creche_id values
        query = """
            SELECT creche_id, COUNT(*) AS cnt
            FROM `tabCreche`
            WHERE creche_id IS NOT NULL AND creche_id != ''
            GROUP BY creche_id
            HAVING COUNT(*) > 1;
        """
        duplicates = frappe.db.sql(query, as_dict=True)
        result["total_duplicate_ids"] = len(duplicates)

        for dup in duplicates:
            original_creche_id = dup.creche_id
            count = dup.cnt
            result["total_duplicate_records"] += count

            # Order by creation ASC so the oldest record keeps the original ID
            records = frappe.db.get_all(
                "Creche",
                filters={"creche_id": original_creche_id},
                fields=["name", "creche_name", "creche_id"],
                order_by="creation asc"
            )

            for r in records:
                result["duplicate_records"].append({
                    "name": r.name,
                    "creche_name": r.creche_name,
                    "creche_id": r.creche_id
                })

            result["duplicate_groups"].append({
                "id_value": original_creche_id,
                "count": count,
                "names": [r.creche_name for r in records],
                "records": [{"name": r.name, "creche_name": r.creche_name, "creche_id": r.creche_id} for r in records]
            })

            if dry_run:
                continue

            # Skip the first record (keep original ID), update the rest
            for i in range(1, len(records)):
                record = records[i]
                old_id = record.creche_id

                new_id = get_next_available_id("Creche", "creche_id", old_id)

                if not new_id:
                    result["errors"].append(f"Could not parse/generate ID for {old_id} (Record: {record.name})")
                    result["total_skipped"] += 1
                    continue

                try:
                    frappe.db.set_value("Creche", record.name, "creche_id", new_id)

                    log_id_change(
                        doctype="Creche",
                        docname=record.name,
                        old_name_value=record.creche_name,
                        new_name_value=record.creche_name,
                        old_id_value=old_id,
                        new_id_value=new_id,
                        source="auto_fix"
                    )

                    result["updated_records"].append({
                        "name": record.name,
                        "creche_name": record.creche_name,
                        "old_creche_id": old_id,
                        "new_creche_id": new_id
                    })
                    result["total_updated"] += 1
                except Exception as e:
                    result["errors"].append(f"Failed to update {record.name}: {str(e)}")
                    result["total_skipped"] += 1

        if not dry_run:
            frappe.db.commit()

        if frappe.utils.cint(export_excel):
            rows = result["updated_records"] if not dry_run else result["duplicate_records"]
            if rows:
                return export_to_excel(rows)

    except Exception as e:
        frappe.db.rollback()
        result["status"] = "error"
        result["errors"].append(str(e))
        frappe.log_error(frappe.get_traceback(), "Deduplicate Creche IDs Error")

    return result


# ==========================================
# CRECHE CAREGIVER ID
# ==========================================
# caregiver_code is not a simple incrementing number like child_id/creche_id.
# It's a composite built from the PARENT Creche record's location hierarchy:
#   state_id + district_id + block_id + gp_id + village_id + creche_id
# (see build_caregiver_code below). Regenerating a duplicate re-derives this
# composite from the caregiver's own parent Creche; if two caregivers share
# the same parent Creche the composite collides again, so a running -2, -3
# suffix is appended to keep it unique.

CAREGIVER_PARENT_LOCATION_FIELDS = ["state_id", "district_id", "block_id", "gp_id", "village_id", "creche_id"]


def build_caregiver_code(creche_doc):
    """
    Rebuilds caregiver_code from its parent Creche's location hierarchy,
    mirroring: str(state_id)+str(district_id)+str(block_id)+str(gp_id)+str(village_id)+str(creche_id)
    """
    parts = [str(creche_doc.get(f) or "") for f in CAREGIVER_PARENT_LOCATION_FIELDS]
    return "".join(parts)


@frappe.whitelist()
def fix_duplicate_caregiver_ids(export_excel=False, dry_run=1):
    """
    API to find/fix duplicate caregiver_code in the 'Creche Caregiver' child table.
    dry_run=1 -> only report duplicates, no updates.
    dry_run=0 -> actually update duplicate records.
    """

    result = {
        "status": "success",
        "total_duplicate_ids": 0,
        "total_duplicate_records": 0,
        "total_updated": 0,
        "total_skipped": 0,
        "updated_records": [],
        "duplicate_records": [],
        "duplicate_groups": [],
        "errors": []
    }

    dry_run = frappe.utils.cint(dry_run)

    try:
        # 1. Identify duplicate caregiver_code values
        query = """
            SELECT caregiver_code, COUNT(*) AS cnt
            FROM `tabCreche Caregiver`
            WHERE caregiver_code IS NOT NULL AND caregiver_code != ''
            GROUP BY caregiver_code
            HAVING COUNT(*) > 1;
        """
        duplicates = frappe.db.sql(query, as_dict=True)
        result["total_duplicate_ids"] = len(duplicates)

        for dup in duplicates:
            original_code = dup.caregiver_code
            count = dup.cnt
            result["total_duplicate_records"] += count

            # Order by creation ASC so the oldest row keeps the original code
            records = frappe.db.get_all(
                "Creche Caregiver",
                filters={"caregiver_code": original_code},
                fields=["name", "caregiver_name", "caregiver_code", "parent"],
                order_by="creation asc"
            )

            for r in records:
                result["duplicate_records"].append({
                    "name": r.name,
                    "caregiver_name": r.caregiver_name,
                    "caregiver_code": r.caregiver_code
                })

            result["duplicate_groups"].append({
                "id_value": original_code,
                "count": count,
                "names": [r.caregiver_name for r in records],
                "records": [{"name": r.name, "caregiver_name": r.caregiver_name, "caregiver_code": r.caregiver_code} for r in records]
            })

            if dry_run:
                continue

            # Skip the first record (keep original code), regenerate the rest
            for i in range(1, len(records)):
                record = records[i]
                old_code = record.caregiver_code

                if not record.parent:
                    result["errors"].append(f"No parent Creche found for caregiver row {record.name}")
                    result["total_skipped"] += 1
                    continue

                creche_doc = frappe.db.get_value(
                    "Creche", record.parent, CAREGIVER_PARENT_LOCATION_FIELDS, as_dict=True
                )
                if not creche_doc:
                    result["errors"].append(f"Parent Creche {record.parent} not found for caregiver row {record.name}")
                    result["total_skipped"] += 1
                    continue

                base_code = build_caregiver_code(creche_doc)
                if not base_code:
                    result["errors"].append(f"Could not derive caregiver_code for {record.name} (missing location fields on {record.parent})")
                    result["total_skipped"] += 1
                    continue

                # Append a running suffix if the derived code collides
                # (e.g. two caregivers under the same parent Creche).
                new_code = base_code
                suffix = 2
                while frappe.db.exists("Creche Caregiver", {"caregiver_code": new_code, "name": ["!=", record.name]}):
                    new_code = f"{base_code}-{suffix}"
                    suffix += 1

                try:
                    frappe.db.set_value("Creche Caregiver", record.name, "caregiver_code", new_code)

                    log_id_change(
                        doctype="Creche Caregiver",
                        docname=record.name,
                        old_name_value=record.caregiver_name,
                        new_name_value=record.caregiver_name,
                        old_id_value=old_code,
                        new_id_value=new_code,
                        source="auto_fix"
                    )

                    result["updated_records"].append({
                        "name": record.name,
                        "caregiver_name": record.caregiver_name,
                        "old_caregiver_code": old_code,
                        "new_caregiver_code": new_code
                    })
                    result["total_updated"] += 1
                except Exception as e:
                    result["errors"].append(f"Failed to update {record.name}: {str(e)}")
                    result["total_skipped"] += 1

        if not dry_run:
            frappe.db.commit()

        if frappe.utils.cint(export_excel):
            rows = result["updated_records"] if not dry_run else result["duplicate_records"]
            if rows:
                return export_to_excel(rows)

    except Exception as e:
        frappe.db.rollback()
        result["status"] = "error"
        result["errors"].append(str(e))
        frappe.log_error(frappe.get_traceback(), "Deduplicate Creche Caregiver IDs Error")

    return result


# ==========================================
# SHARED: MANUAL EDIT
# ==========================================

ID_FIELD_BY_DOCTYPE = {
    "Child Enrollment and Exit": "child_id",
    "Creche": "creche_id",
    "Creche Caregiver": "caregiver_code",
}


NAME_FIELD_BY_DOCTYPE = {
    "Child Enrollment and Exit": "child_name",
    "Creche": "creche_name",
    "Creche Caregiver": "caregiver_name",
}


@frappe.whitelist()
def search_records(doctype, search_term=""):
    """
    Search records by ID or name for the 'Edit ID Manual' tab,
    independent of a prior Find Duplicate scan.
    """
    if doctype not in ID_FIELD_BY_DOCTYPE:
        frappe.throw(f"Editing IDs for doctype '{doctype}' is not supported.")

    id_field = ID_FIELD_BY_DOCTYPE[doctype]
    name_field = NAME_FIELD_BY_DOCTYPE[doctype]
    search_term = (search_term or "").strip()

    filters = {}
    or_filters = None
    if search_term:
        or_filters = [
            [id_field, "like", f"%{search_term}%"],
            [name_field, "like", f"%{search_term}%"],
        ]

    records = frappe.db.get_list(
        doctype,
        filters=filters,
        or_filters=or_filters,
        fields=["name", id_field, name_field],
        order_by="modified desc",
        limit_page_length=50
    )

    return {"status": "success", "records": records}


@frappe.whitelist()
def update_record_id(doctype, docname, new_id):
    """
    Manually edit the ID field of a single record.
    Used by the 'Edit' action in the duplicate ID panel.
    """
    if doctype not in ID_FIELD_BY_DOCTYPE:
        frappe.throw(f"Editing IDs for doctype '{doctype}' is not supported.")

    id_field = ID_FIELD_BY_DOCTYPE[doctype]
    name_field = NAME_FIELD_BY_DOCTYPE[doctype]
    new_id = (new_id or "").strip()

    if not new_id:
        frappe.throw("New ID cannot be empty.")

    existing_record = frappe.db.get_value(doctype, docname, [name_field, id_field], as_dict=True)
    if not existing_record:
        frappe.throw(f"Record {docname} not found in {doctype}.")

    old_id = existing_record.get(id_field)
    record_name_value = existing_record.get(name_field)

    # Prevent creating a fresh collision with another record
    existing = frappe.db.exists(doctype, {id_field: new_id, "name": ["!=", docname]})
    if existing:
        frappe.throw(f"{id_field} '{new_id}' is already used by another record ({existing}).")

    frappe.db.set_value(doctype, docname, id_field, new_id)
    frappe.db.commit()

    log_id_change(
        doctype=doctype,
        docname=docname,
        old_name_value=record_name_value,
        new_name_value=record_name_value,
        old_id_value=old_id,
        new_id_value=new_id,
        source="manual"
    )

    return {
        "status": "success",
        "name": docname,
        "id_field": id_field,
        "new_id": new_id
    }


# ==========================================
# HELPERS
# ==========================================

def get_next_available_id(doctype, id_field, base_id):
    """
    Extracts the trailing digits of an ID, increments it, and verifies it doesn't already exist.
    """
    # Regex to split the text prefix and the trailing numbers
    # Example: "BL111111214401" -> group 1: "BL", group 2: "111111214401"
    match = re.search(r'^(\D*)(\d+)$', base_id)

    if not match:
        return None  # Cannot process strings without numeric suffixes

    prefix = match.group(1)
    num_str = match.group(2)
    current_num = int(num_str)
    length = len(num_str)  # To maintain leading zeros if any

    while True:
        current_num += 1

        # Format back with leading zeros (if original had them)
        new_id = f"{prefix}{str(current_num).zfill(length)}"

        # Verify it doesn't already exist in the database
        exists = frappe.db.exists(doctype, {id_field: new_id})
        if not exists:
            return new_id


def export_to_excel(records):
    """
    Builds an Excel file response out of a list of record dicts.
    """
    if not records:
        data = [["No Data"]]
    else:
        headers = list(records[0].keys())
        data = [headers]
        for r in records:
            data.append([r.get(h) for h in headers])

    xlsx_file = make_xlsx(data, "Records")

    frappe.response['filename'] = 'duplicate_id_results.xlsx'
    frappe.response['filecontent'] = xlsx_file.getvalue()
    frappe.response['type'] = 'binary'


# ==========================================
# SCHEDULER
# ==========================================
# Config + run history are persisted as JSON files on the site's private
# files path so they survive cache clears / redis restarts without needing
# a new DocType + migration.

WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

SCHEDULER_MODULES = {
    "creche_id": {
        "label": "Creche ID",
        "fn": "fix_duplicate_creche_ids",
    },
    "child_id": {
        "label": "Child ID",
        "fn": "fix_duplicate_child_ids",
    },
    "caregiver_id": {
        "label": "Creche Caregiver ID",
        "fn": "fix_duplicate_caregiver_ids",
    },
}

DEFAULT_SCHEDULER_CONFIG = {
    "enabled": 0,
    "day": "Sunday",
    "time": "02:00",  # 24h HH:MM, server local time
}

LOG_RETENTION_DAYS = 90


def _scheduler_dir():
    path = frappe.get_site_path("private", "files", "duplicate_id_scheduler")
    os.makedirs(path, exist_ok=True)
    return path


def _config_path():
    return os.path.join(_scheduler_dir(), "config.json")


def _logs_path():
    return os.path.join(_scheduler_dir(), "logs.json")


def _read_json(path, default):
    if not os.path.exists(path):
        return default
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (ValueError, OSError):
        return default


def _write_json(path, data):
    tmp_path = f"{path}.tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, default=str)
    os.replace(tmp_path, path)


def _load_config():
    config = _read_json(_config_path(), {})
    merged = dict(DEFAULT_SCHEDULER_CONFIG)
    merged.update(config or {})
    return merged


def _load_logs():
    logs = _read_json(_logs_path(), [])
    return logs if isinstance(logs, list) else []


def _prune_old_logs(logs):
    cutoff = add_days(now_datetime(), -LOG_RETENTION_DAYS)
    pruned = []
    for entry in logs:
        try:
            if get_datetime(entry.get("run_at")) >= cutoff:
                pruned.append(entry)
        except Exception:
            continue
    return pruned


def _append_log(entry):
    logs = _load_logs()
    logs.insert(0, entry)
    logs = _prune_old_logs(logs)
    _write_json(_logs_path(), logs)


@frappe.whitelist()
def get_scheduler_settings():
    """
    Returns the current weekly-scheduler configuration.
    """
    return {"status": "success", "config": _load_config()}


@frappe.whitelist()
def save_scheduler_settings(enabled=0, day="Sunday", time="02:00"):
    """
    Save the weekly scheduler configuration (single schedule shared by all
    enabled duplicate-ID modules).
    """
    day = (day or "").strip()
    time = (time or "").strip()

    if day not in WEEKDAYS:
        frappe.throw(f"Invalid day '{day}'. Must be one of {', '.join(WEEKDAYS)}.")

    if not re.match(r'^([01]\d|2[0-3]):([0-5]\d)$', time):
        frappe.throw("Invalid time format. Use 24-hour HH:MM (e.g. 02:00).")

    config = {
        "enabled": frappe.utils.cint(enabled),
        "day": day,
        "time": time,
    }
    _write_json(_config_path(), config)

    return {"status": "success", "config": config}


@frappe.whitelist()
def get_scheduler_logs():
    """
    Returns execution history for the last 90 days, most recent first.
    """
    logs = _prune_old_logs(_load_logs())
    return {"status": "success", "logs": logs}


@frappe.whitelist()
def run_scheduler_now():
    """
    Manually trigger a scheduler run immediately (used by a 'Run Now' button
    in the UI), independent of the weekly cron check.
    """
    return run_weekly_duplicate_id_fix(manual=True)


def run_weekly_duplicate_id_fix(manual=False):
    """
    Entry point invoked by the Frappe scheduler (hourly cron, see hooks.py)
    or manually via run_scheduler_now(). Checks whether the configured
    weekly slot matches "now" (skipped when manual=True) and, if so, runs
    fix_duplicate_* for every configured module with dry_run=0.
    """
    config = _load_config()

    if not manual:
        if not frappe.utils.cint(config.get("enabled")):
            return {"status": "skipped", "reason": "disabled"}

        now = now_datetime()
        current_day = WEEKDAYS[now.weekday()]

        if current_day != config.get("day"):
            return {"status": "skipped", "reason": "not_scheduled_day"}

        try:
            scheduled_hour, scheduled_minute = [int(p) for p in config.get("time", "02:00").split(":")]
        except (ValueError, AttributeError):
            scheduled_hour, scheduled_minute = 2, 0

        # The tick runs every 5 minutes (see hooks.py); fire once the current
        # time has reached the scheduled slot, guarded by a "last run" marker
        # so we don't re-fire every tick for the rest of that day.
        scheduled_today = now.replace(hour=scheduled_hour, minute=scheduled_minute, second=0, microsecond=0)
        if now < scheduled_today:
            return {"status": "skipped", "reason": "not_yet_time"}

        last_run_marker = config.get("_last_run_marker")
        this_week_marker = now.strftime("%G-W%V")  # ISO year-week, stable per calendar week
        if last_run_marker == this_week_marker:
            return {"status": "skipped", "reason": "already_ran_this_week"}

        config["_last_run_marker"] = this_week_marker
        _write_json(_config_path(), config)

    run_started = now_datetime()
    module_results = {}
    overall_status = "success"

    for key, module in SCHEDULER_MODULES.items():
        fn = globals().get(module["fn"])
        if not fn:
            continue
        try:
            result = fn(export_excel=False, dry_run=0)
            module_results[key] = {
                "label": module["label"],
                "status": result.get("status", "success"),
                "total_duplicate_ids": result.get("total_duplicate_ids", 0),
                "total_updated": result.get("total_updated", 0),
                "errors": result.get("errors", []),
            }
            if result.get("status") != "success":
                overall_status = "error"
        except Exception as e:
            module_results[key] = {
                "label": module["label"],
                "status": "error",
                "errors": [str(e)],
            }
            overall_status = "error"
            frappe.log_error(frappe.get_traceback(), "Weekly Duplicate ID Scheduler Error")

    log_entry = {
        "run_at": str(run_started),
        "trigger": "manual" if manual else "scheduled",
        "status": overall_status,
        "modules": module_results,
    }
    _append_log(log_entry)

    return {"status": overall_status, "log": log_entry}


def scheduler_tick():
    """
    Registered in hooks.py under scheduler_events (hourly cadence).
    Cheap no-op unless the configured day/time matches the current minute
    window, in which case it performs the weekly fix run.
    """
    try:
        run_weekly_duplicate_id_fix(manual=False)
    except Exception:
        frappe.log_error(frappe.get_traceback(), "Duplicate ID Scheduler Tick Error")


# ==========================================
# ID CHANGE LOGS
# ==========================================
# Every time an ID field is changed (manual edit, Fix Duplicate, or the
# weekly Scheduler) a before/after snapshot is appended here so there is a
# full audit trail independent of the scheduler's own run history.

ID_CHANGE_LOG_RETENTION_DAYS = 90

DISPLAY_LABEL_BY_DOCTYPE = {
    "Child Enrollment and Exit": {"record": "Child ID", "name_label": "Child Name", "id_label": "Child ID"},
    "Creche": {"record": "Creche ID", "name_label": "Creche Name", "id_label": "Creche ID"},
    "Creche Caregiver": {"record": "Caregiver Code", "name_label": "Caregiver Name", "id_label": "Caregiver Code"},
}


def _id_change_log_path():
    return os.path.join(_scheduler_dir(), "id_change_logs.json")


def _load_id_change_logs():
    logs = _read_json(_id_change_log_path(), [])
    return logs if isinstance(logs, list) else []


def _prune_id_change_logs(logs):
    cutoff = add_days(now_datetime(), -ID_CHANGE_LOG_RETENTION_DAYS)
    pruned = []
    for entry in logs:
        try:
            if get_datetime(entry.get("changed_at")) >= cutoff:
                pruned.append(entry)
        except Exception:
            continue
    return pruned


def log_id_change(doctype, docname, old_name_value, new_name_value, old_id_value, new_id_value, source="manual"):
    """
    Appends one before/after ID-change record.

    docname is the Frappe document name (record identifier) and stays the
    same across the change; old_name_value/new_name_value are the
    doctype's own "name" field (e.g. child_name); old_id_value/new_id_value
    are the doctype's own ID field (e.g. child_id).
    """
    labels = DISPLAY_LABEL_BY_DOCTYPE.get(doctype, {"record": "ID", "name_label": "Name", "id_label": "ID"})

    entry = {
        "changed_at": str(now_datetime()),
        "doctype": doctype,
        "source": source,
        "old_record": docname,
        "new_record": docname,
        "old_name": old_name_value,
        "new_name": new_name_value,
        "old_id": old_id_value,
        "new_id": new_id_value,
        "labels": labels,
    }

    logs = _load_id_change_logs()
    logs.insert(0, entry)
    logs = _prune_id_change_logs(logs)
    _write_json(_id_change_log_path(), logs)


@frappe.whitelist()
def get_id_change_logs(doctype=None):
    """
    Returns ID change history for the last 90 days, most recent first.
    Optionally filter by doctype ("Child Enrollment and Exit" or "Creche").
    """
    logs = _prune_id_change_logs(_load_id_change_logs())
    if doctype:
        logs = [l for l in logs if l.get("doctype") == doctype]
    return {"status": "success", "logs": logs}


# ==========================================
# CRECHE TRANSFER
# ==========================================
# Bulk-moves every record tied to one Creche over to another Creche, across
# all 11 listed doctypes. Runs as a background RQ job (frappe.enqueue) since
# a single creche can have lakhs of related rows -- far beyond what one HTTP
# request can process before timing out. Progress is written to a JSON
# status file on every batch so the browser can poll it live. Every changed
# row's OLD values are also written to a per-transfer JSONL snapshot file so
# the transfer can be reverted exactly, field by field.
#
# Only "Household Form" has no creche_id -- it's matched/updated purely via
# its geography fields (state/district/block/gp/village), taken from the
# OLD and NEW Creche's own location values. Every other doctype is matched
# by creche_id = OLD, and each selected checkbox field is overwritten with
# the NEW Creche's corresponding value in that same UPDATE.

# fieldname on the target doctype -> fieldname on Creche to source the "new" value from.
TRANSFERABLE_FIELDS = {
    "partner_id": {"label": "Partner", "creche_field": "partner_id"},
    "state_id": {"label": "State", "creche_field": "state_id"},
    "district_id": {"label": "District", "creche_field": "district_id"},
    "block_id": {"label": "Block", "creche_field": "block_id"},
    "gp_id": {"label": "GP", "creche_field": "gp_id"},
    "village_id": {"label": "Village", "creche_field": "village_id"},
    "creche_id": {"label": "Creche", "creche_field": "creche_id"},
}

# doctype -> which of TRANSFERABLE_FIELDS actually exist as columns there,
# and how matching is done:
#   "creche_id"    -> WHERE creche_id = OLD (the normal case)
#   "geography"    -> Household Form has no creche_id; matched via its own
#                     state/district/block/gp/village columns instead.
#   "child_profile_via_cee" -> Child Profile has neither creche_id nor
#                     partner_id, only state/district/block/gp/village_id.
#                     It's matched via a JOIN through Child Enrollment and
#                     Exit (which does have creche_id), linked by
#                     Child Profile.chhguid = Child Enrollment and Exit.hhcguid.
CRECHE_TRANSFER_TARGETS = [
    {"doctype": "Household Form", "match_by": "geography",
     "fields": ["partner_id", "state_id", "district_id", "block_id", "gp_id", "village_id"]},
    {"doctype": "Child Profile", "match_by": "child_profile_via_cee",
     "fields": ["state_id", "district_id", "block_id", "gp_id", "village_id"]},
    {"doctype": "Child Enrollment and Exit", "match_by": "creche_id",
     "fields": ["partner_id", "state_id", "district_id", "block_id", "gp_id", "village_id", "creche_id"]},
    # Child Growth Monitoring and Child Attendance are NOT handled by the
    # generic batch-UPDATE loop below -- both have child tables keyed to a
    # specific child (Anthropromatic Data / Child Attendance List) that must
    # be merged into the target creche's own parent record per-child rather
    # than blanket-reassigned. See transfer_child_attendance() and
    # transfer_child_growth_monitoring() and their dedicated call sites in
    # run_creche_transfer().
    {"doctype": "Creche Check In", "match_by": "creche_id",
     "fields": ["partner_id", "state_id", "district_id", "block_id", "gp_id", "village_id", "creche_id"]},
    {"doctype": "Child Health", "match_by": "creche_id",
     "fields": ["partner_id", "state_id", "district_id", "block_id", "gp_id", "village_id", "creche_id"]},
    {"doctype": "Child Event", "match_by": "creche_id",
     "fields": ["partner_id", "state_id", "district_id", "block_id", "gp_id", "village_id", "creche_id"]},
    {"doctype": "Child Immunization", "match_by": "creche_id",
     "fields": ["partner_id", "state_id", "district_id", "block_id", "gp_id", "village_id", "creche_id"]},
    {"doctype": "Child Referral", "match_by": "creche_id",
     "fields": ["partner_id", "state_id", "district_id", "block_id", "gp_id", "village_id", "creche_id"]},
    {"doctype": "Child Follow up", "match_by": "creche_id",
     "fields": ["partner_id", "state_id", "district_id", "block_id", "gp_id", "village_id", "creche_id"]},
]

CRECHE_TRANSFER_BATCH_SIZE = 2000
CRECHE_TRANSFER_LOG_RETENTION_DAYS = 90

# Doctypes handled by dedicated merge functions instead of the generic
# batch-UPDATE loop (see transfer_child_attendance / transfer_child_growth_monitoring).
CRECHE_TRANSFER_SPECIAL_DOCTYPES = ["Child Attendance", "Child Growth Monitoring"]

CHILD_ATTENDANCE_LIST_FIELDS = [
    "name_of_child", "attendance", "childenrolledguid", "childattenguid",
    "date_of_attendance", "child_profile_id",
]

ANTHROPROMATIC_DATA_FIELDS = [
    "measurement_equipment", "measurement_position", "child_id", "do_you_have_height_weight",
    "measurement_taken_date", "measurement_reason", "height", "weight", "age_months",
    "weight_for_age", "weight_for_height", "height_for_age",
    "weight_for_age_zscore", "weight_for_height_zscore", "height_for_age_zscore",
    "any_medical_major_illness", "fever", "vomitting", "diarrhea", "illness_other",
    "awc", "thr", "vhsnd", "cgmguid", "chhguid", "childenrollguid",
    "re_measurement_equipment", "re_measurement_position", "re_do_you_have_height_weight",
    "re_measurement_taken_date", "re_measurement_reason", "re_height", "re_weight", "re_age_months",
    "re_weight_for_age", "re_weight_for_height", "re_height_for_age",
    "re_weight_for_age_zscore", "re_weight_for_height_zscore", "re_height_for_age_zscore",
    "dob_when_measurement_taken", "flag", "s_flag",
]

CRECHE_PARENT_LOCATION_FIELDS = ["partner_id", "state_id", "district_id", "block_id", "gp_id", "village_id"]


CRECHE_TRANSFER_BULK_CHUNK = 5000  # rows per bulk INSERT/DELETE/query round-trip


def _reserve_names(doctype, count):
    """
    Generates `count` document names for `doctype` without going through
    frappe.get_doc().insert() for each one -- autoincrement doctypes reserve
    a block of sequence values (one lightweight round-trip per name, still
    orders of magnitude cheaper than a full ORM insert); everything else
    (hash-named child tables) generates names locally with no DB round-trip
    at all.
    """
    from frappe.model.naming import is_autoincremented

    if is_autoincremented(doctype):
        return [str(frappe.db.get_next_sequence_val(doctype)) for _ in range(count)]
    return [frappe.generate_hash(length=10) for _ in range(count)]


def _bulk_snapshot_insert_rows(snapshot_file, doctype, names, parent):
    """
    Writes one JSONL "insert" snapshot line per newly-created row, batched
    into a single string join + write instead of N individual write() +
    flush() calls (flush() forces a syscall per row at 6M-row scale).
    """
    lines = [
        json.dumps({"doctype": doctype, "action": "insert", "docname": name, "parent": parent, "old_values": None}, default=str)
        for name in names
    ]
    snapshot_file.write("\n".join(lines) + "\n")
    snapshot_file.flush()


def _bulk_snapshot_delete_parents(snapshot_file, doctype, parent_docs, children_by_parent, child_doctype, child_parentfield):
    """
    Batched equivalent of the old per-row _snapshot_and_delete_old_parent:
    writes one JSONL "delete_parent" line per old parent (each carrying its
    full row + all its already-fetched child rows, so revert can resurrect
    it without re-querying), then bulk-deletes every parent and child row
    in a small, fixed number of statements instead of one delete_doc() call
    per parent.
    """
    lines = []
    for parent_doc in parent_docs:
        full_doc = dict(parent_doc)
        full_doc["doctype"] = doctype
        pname = str(parent_doc["name"])
        full_doc[child_parentfield] = [dict(c) for c in children_by_parent.get(pname, [])]
        for child_row in full_doc[child_parentfield]:
            child_row["doctype"] = child_doctype
        lines.append(json.dumps({
            "doctype": doctype,
            "action": "delete_parent",
            "docname": parent_doc["name"],
            "old_values": None,
            "full_doc": full_doc,
        }, default=str))
    snapshot_file.write("\n".join(lines) + "\n")
    snapshot_file.flush()

    parent_names = [p["name"] for p in parent_docs]
    child_table = f"tab{child_doctype}"
    parent_table = f"tab{doctype}"
    for i in range(0, len(parent_names), CRECHE_TRANSFER_BULK_CHUNK):
        batch = parent_names[i:i + CRECHE_TRANSFER_BULK_CHUNK]
        placeholders = ", ".join(["%s"] * len(batch))
        frappe.db.sql(f"DELETE FROM `{child_table}` WHERE parent IN ({placeholders})", batch)
        frappe.db.sql(f"DELETE FROM `{parent_table}` WHERE name IN ({placeholders})", batch)
        frappe.db.commit()


def transfer_child_attendance(from_creche, to_creche, snapshot_file, status, per_doctype_entry):
    """
    Bulk/set-based version: Child Attendance can't be moved with a blanket
    UPDATE because each parent's Child Attendance List holds per-child rows
    for one date, and the target creche may already have its own record
    for that date. At 60L+ rows, doing this per-row via frappe.get_doc()
    is far too slow, so this operates in whole-table passes instead:
      1. Bulk-fetch every old parent (creche_id = from_creche) and every
         one of their child rows in a couple of queries (chunked).
      2. Group by date_of_attendance; for each date, find-or-bulk-create
         the one target parent (creche_id = to_creche, same date).
      3. Bulk-fetch each target parent's existing child_profile_ids.
      4. Compute the rows that actually need copying (skip dupes) in
         Python, reserve names for them, and INSERT them with
         frappe.db.bulk_insert -- no per-row ORM/hook overhead.
      5. Snapshot + bulk-delete every drained old parent (and its children).
    Returns (processed_count, old_parent_count).
    """
    new_creche = frappe.db.get_value("Creche", to_creche, CRECHE_PARENT_LOCATION_FIELDS + ["creche_id"], as_dict=True) or {}

    old_parents = frappe.db.get_all(
        "Child Attendance",
        filters={"creche_id": from_creche},
        fields=["name", "date_of_attendance", "childattenguid"] + CRECHE_PARENT_LOCATION_FIELDS + ["creche_id"],
    )
    if not old_parents:
        return 0, 0

    old_parent_by_name = {str(p.name).strip(): p for p in old_parents}
    dates_needed = sorted({p.date_of_attendance for p in old_parents if p.date_of_attendance})

    # Step 1: find existing target parents for every date in one query,
    # then bulk-create whichever dates are still missing.
    existing_targets = frappe.db.get_all(
        "Child Attendance",
        filters={"creche_id": to_creche, "date_of_attendance": ["in", dates_needed]},
        fields=["name", "date_of_attendance", "childattenguid"],
    ) if dates_needed else []
    target_by_date = {t.date_of_attendance: {"name": str(t.name).strip(), "guid": t.childattenguid} for t in existing_targets}

    missing_dates = [d for d in dates_needed if d not in target_by_date]
    if missing_dates:
        new_names = _reserve_names("Child Attendance", len(missing_dates))
        new_guids = [frappe.generate_hash(length=16) for _ in missing_dates]
        parent_fields = ["name", "partner_id", "state_id", "district_id", "block_id", "gp_id", "village_id",
                          "creche_id", "date_of_attendance", "childattenguid", "owner", "creation", "modified", "modified_by", "docstatus"]
        now = now_datetime()
        user = frappe.session.user
        rows = [
            (name, new_creche.get("partner_id"), new_creche.get("state_id"), new_creche.get("district_id"),
             new_creche.get("block_id"), new_creche.get("gp_id"), new_creche.get("village_id"),
             to_creche, date, guid, user, now, now, user, 0)
            for name, guid, date in zip(new_names, new_guids, missing_dates)
        ]
        frappe.db.bulk_insert("Child Attendance", fields=parent_fields, values=rows, chunk_size=CRECHE_TRANSFER_BULK_CHUNK)
        frappe.db.commit()
        _bulk_snapshot_insert_rows(snapshot_file, "Child Attendance", new_names, parent=None)
        for name, guid, date in zip(new_names, new_guids, missing_dates):
            target_by_date[date] = {"name": str(name), "guid": guid}

    # Step 2: bulk-fetch old children and target-side existing child_profile_ids.
    old_parent_names = list(old_parent_by_name.keys())
    old_children = []
    for i in range(0, len(old_parent_names), CRECHE_TRANSFER_BULK_CHUNK):
        batch = old_parent_names[i:i + CRECHE_TRANSFER_BULK_CHUNK]
        old_children.extend(frappe.db.get_all(
            "Child Attendance List",
            filters={"parent": ["in", batch], "parenttype": "Child Attendance"},
            fields=["name", "parent", "idx"] + CHILD_ATTENDANCE_LIST_FIELDS, # Fetches exact 'idx' to save in snapshot
        ))

    target_parent_names = list({t["name"] for t in target_by_date.values()})
    existing_by_target = {}
    for i in range(0, len(target_parent_names), CRECHE_TRANSFER_BULK_CHUNK):
        batch = target_parent_names[i:i + CRECHE_TRANSFER_BULK_CHUNK]
        for row in frappe.db.get_all(
            "Child Attendance List",
            filters={"parent": ["in", batch], "parenttype": "Child Attendance"},
            fields=["parent", "child_profile_id"],
        ):
            existing_by_target.setdefault(str(row.parent).strip(), set()).add(row.child_profile_id)

    # Step 3: decide which old child rows actually need copying.
    to_insert = []
    for child in old_children:
        # Replaced dictionary bracket syntax with .get() to avoid any possible KeyErrors
        old_parent = old_parent_by_name.get(str(child.parent).strip())
        if not old_parent:
            continue
        
        target = target_by_date.get(old_parent.date_of_attendance)
        if not target:
            continue
        
        existing_ids = existing_by_target.setdefault(target["name"], set())
        if child.child_profile_id and child.child_profile_id in existing_ids:
            continue
        
        to_insert.append((child, target))
        if child.child_profile_id:
            existing_ids.add(child.child_profile_id)

    processed = len(old_children)

    # Step 4: bulk-insert every row that needs copying.
    if to_insert:
        names = _reserve_names("Child Attendance List", len(to_insert))
        fields = ["name", "parent", "parenttype", "parentfield", "idx", "owner", "creation", "modified", "modified_by", "docstatus"] + CHILD_ATTENDANCE_LIST_FIELDS
        now = now_datetime()
        user = frappe.session.user
        
        # PREVENT IDX RESETTING
        idx_counters = {}
        affected_parents = list(set([str(target["name"]) for child, target in to_insert]))
        
        for i in range(0, len(affected_parents), CRECHE_TRANSFER_BULK_CHUNK):
            batch = affected_parents[i:i + CRECHE_TRANSFER_BULK_CHUNK]
            placeholders = ", ".join(["%s"] * len(batch))
            max_idxs = frappe.db.sql(
                f"SELECT parent, MAX(idx) as max_idx FROM `tabChild Attendance List` WHERE parent IN ({placeholders}) GROUP BY parent",
                batch, as_dict=True
            )
            for r in max_idxs:
                # Cast the database r.parent to string strictly before storing the max_idx
                idx_counters[str(r.parent).strip()] = int(r.max_idx or 0)
        
        rows = []
        for name, (child, target) in zip(names, to_insert):
            target_name_str = str(target["name"]).strip()
            idx_counters[target_name_str] = idx_counters.get(target_name_str, 0) + 1
            
            row_values = [child.get(f) for f in CHILD_ATTENDANCE_LIST_FIELDS]
            row_values[CHILD_ATTENDANCE_LIST_FIELDS.index("childattenguid")] = target["guid"]
            rows.append((name, target_name_str, "Child Attendance", "childattendancelist",
                         idx_counters[target_name_str], user, now, now, user, 0) + tuple(row_values))
                         
        frappe.db.bulk_insert("Child Attendance List", fields=fields, values=rows, chunk_size=CRECHE_TRANSFER_BULK_CHUNK)
        frappe.db.commit()

        by_parent = {}
        for name, (child, target) in zip(names, to_insert):
            by_parent.setdefault(str(target["name"]).strip(), []).append(name)
        for parent_name, child_names in by_parent.items():
            _bulk_snapshot_insert_rows(snapshot_file, "Child Attendance List", child_names, parent=parent_name)

    status["records_processed"] += processed
    per_doctype_entry["processed"] = processed
    _write_transfer_status(status)

    # Step 5: every old parent's children have now been migrated or
    # confirmed already present on the target -- snapshot + bulk-delete them.
    children_by_old_parent = {}
    for child in old_children:
        children_by_old_parent.setdefault(str(child.parent).strip(), []).append(dict(child))
    parent_dicts = [dict(p) for p in old_parents]
    for p in parent_dicts:
        p["name"] = str(p["name"]).strip()
    _bulk_snapshot_delete_parents(
        snapshot_file, "Child Attendance", parent_dicts, children_by_old_parent,
        child_doctype="Child Attendance List", child_parentfield="childattendancelist",
    )

    return processed, len(old_parents)


def transfer_child_growth_monitoring(from_creche, to_creche, snapshot_file, status, per_doctype_entry):
    """
    Bulk/set-based version of the Child Growth Monitoring / Anthropromatic
    Data merge, matched per-child by child_id instead of by date (there is
    naturally one target parent per creche here, not one per date). Same
    five-step shape as transfer_child_attendance -- see that function's
    docstring for the general strategy.
    """
    new_creche = frappe.db.get_value("Creche", to_creche, CRECHE_PARENT_LOCATION_FIELDS + ["creche_id"], as_dict=True) or {}

    old_parents = frappe.db.get_all(
        "Child Growth Monitoring",
        filters={"creche_id": from_creche},
        fields=["name", "cgmguid"] + CRECHE_PARENT_LOCATION_FIELDS + ["creche_id"],
    )
    if not old_parents:
        return 0, 0

    old_parent_names = [str(p.name).strip() for p in old_parents]

    # Step 1: find-or-create the single target parent for this creche.
    target = frappe.db.get_value(
        "Child Growth Monitoring", {"creche_id": to_creche}, ["name", "cgmguid"], as_dict=True
    )
    if not target:
        new_name = _reserve_names("Child Growth Monitoring", 1)[0]
        new_guid = frappe.generate_hash(length=16)
        now = now_datetime()
        user = frappe.session.user
        frappe.db.bulk_insert(
            "Child Growth Monitoring",
            fields=["name", "partner_id", "state_id", "district_id", "block_id", "gp_id", "village_id",
                    "creche_id", "cgmguid", "owner", "creation", "modified", "modified_by", "docstatus"],
            values=[(new_name, new_creche.get("partner_id"), new_creche.get("state_id"), new_creche.get("district_id"),
                     new_creche.get("block_id"), new_creche.get("gp_id"), new_creche.get("village_id"),
                     to_creche, new_guid, user, now, now, user, 0)],
        )
        frappe.db.commit()
        _bulk_snapshot_insert_rows(snapshot_file, "Child Growth Monitoring", [new_name], parent=None)
        target = {"name": str(new_name), "cgmguid": new_guid}
    else:
        target = {"name": str(target["name"]).strip(), "cgmguid": target["cgmguid"]}

    target_parent_name = target["name"]
    target_cgmguid = target["cgmguid"]

    # Step 2: bulk-fetch old children and the target's existing child_ids.
    old_children = []
    for i in range(0, len(old_parent_names), CRECHE_TRANSFER_BULK_CHUNK):
        batch = old_parent_names[i:i + CRECHE_TRANSFER_BULK_CHUNK]
        old_children.extend(frappe.db.get_all(
            "Anthropromatic Data",
            filters={"parent": ["in", batch], "parenttype": "Child Growth Monitoring"},
            fields=["name", "parent", "idx"] + ANTHROPROMATIC_DATA_FIELDS, # Fetches exact 'idx' to save in snapshot
        ))

    existing_child_ids = set(frappe.db.get_all(
        "Anthropromatic Data",
        filters={"parent": target_parent_name, "parenttype": "Child Growth Monitoring"},
        pluck="child_id",
    ))

    # Step 3: decide which rows actually need copying.
    to_insert = []
    for child in old_children:
        if child.child_id and child.child_id in existing_child_ids:
            continue
        to_insert.append(child)
        if child.child_id:
            existing_child_ids.add(child.child_id)

    processed = len(old_children)

    # Step 4: bulk-insert.
    if to_insert:
        names = _reserve_names("Anthropromatic Data", len(to_insert))
        fields = ["name", "parent", "parenttype", "parentfield", "idx", "owner", "creation", "modified", "modified_by", "docstatus"] + ANTHROPROMATIC_DATA_FIELDS
        now = now_datetime()
        user = frappe.session.user
        cgmguid_idx = ANTHROPROMATIC_DATA_FIELDS.index("cgmguid")
        
        # PREVENT IDX RESETTING 
        # Explicitly passing string parent name and forcefully converting to integer max_idx
        max_idx_res = frappe.db.sql(
            "SELECT MAX(idx) FROM `tabAnthropromatic Data` WHERE parent = %s",
            (str(target_parent_name),)
        )
        current_max_idx = int(max_idx_res[0][0]) if (max_idx_res and max_idx_res[0][0] is not None) else 0

        rows = []
        for name, child in zip(names, to_insert):
            current_max_idx += 1
            row_values = [child.get(f) for f in ANTHROPROMATIC_DATA_FIELDS]
            row_values[cgmguid_idx] = target_cgmguid
            rows.append((name, target_parent_name, "Child Growth Monitoring", "anthropromatic_details",
                         current_max_idx, user, now, now, user, 0) + tuple(row_values))
        frappe.db.bulk_insert("Anthropromatic Data", fields=fields, values=rows, chunk_size=CRECHE_TRANSFER_BULK_CHUNK)
        frappe.db.commit()
        _bulk_snapshot_insert_rows(snapshot_file, "Anthropromatic Data", names, parent=target_parent_name)

    status["records_processed"] += processed
    per_doctype_entry["processed"] = processed
    _write_transfer_status(status)

    # Step 5: snapshot + bulk-delete every drained old parent.
    children_by_old_parent = {}
    for child in old_children:
        children_by_old_parent.setdefault(str(child.parent).strip(), []).append(dict(child))
    parent_dicts = [dict(p) for p in old_parents]
    for p in parent_dicts:
        p["name"] = str(p["name"]).strip()
    _bulk_snapshot_delete_parents(
        snapshot_file, "Child Growth Monitoring", parent_dicts, children_by_old_parent,
        child_doctype="Anthropromatic Data", child_parentfield="anthropromatic_details",
    )

    return processed, len(old_parents)


def _creche_transfer_dir():
    path = frappe.get_site_path("private", "files", "creche_transfer")
    os.makedirs(path, exist_ok=True)
    return path


def _creche_transfer_status_path():
    return os.path.join(_creche_transfer_dir(), "status.json")


def _creche_transfer_history_path():
    return os.path.join(_creche_transfer_dir(), "history.json")


def _creche_transfer_snapshot_path(transfer_id):
    return os.path.join(_creche_transfer_dir(), f"snapshot_{transfer_id}.jsonl")


def _load_transfer_status():
    return _read_json(_creche_transfer_status_path(), None)


def _write_transfer_status(status):
    _write_json(_creche_transfer_status_path(), status)


def _transfer_log(status, message, level="info"):
    entry = {"timestamp": str(now_datetime()), "message": message, "level": level}
    status.setdefault("log", [])
    status["log"].append(entry)
    status["log"] = status["log"][-1000:]
    _write_transfer_status(status)


def _load_transfer_history():
    history = _read_json(_creche_transfer_history_path(), [])
    return history if isinstance(history, list) else []


def _prune_transfer_history(history):
    cutoff = add_days(now_datetime(), -CRECHE_TRANSFER_LOG_RETENTION_DAYS)
    pruned = []
    for entry in history:
        try:
            if get_datetime(entry.get("started_at")) >= cutoff:
                pruned.append(entry)
        except Exception:
            continue
    return pruned


def _append_transfer_history(entry):
    history = _load_transfer_history()
    history.insert(0, entry)
    history = _prune_transfer_history(history)
    _write_json(_creche_transfer_history_path(), history)


def _update_transfer_history_entry(transfer_id, updates):
    history = _load_transfer_history()
    for entry in history:
        if entry.get("transfer_id") == transfer_id:
            entry.update(updates)
            break
    _write_json(_creche_transfer_history_path(), history)


def _resolve_active_fields(target, selected_fields):
    """
    Intersects the user's checkbox selection with the fields that actually
    exist on this doctype, preserving TRANSFER_TARGETS field order.
    """
    return [f for f in target["fields"] if f in selected_fields]


CRECHE_LIST_PAGE_SIZE = 100


@frappe.whitelist()
def list_creches(search_term="", page=1, page_size=CRECHE_LIST_PAGE_SIZE):
    """
    Paginated, search-aware Creche list for the Creche Transfer picker.
    Search matches creche_name or creche_id and runs against the full
    table (not just the currently loaded page), so results are never
    limited to whatever page happens to be in the browser already.
    """
    search_term = (search_term or "").strip()
    page = max(1, frappe.utils.cint(page) or 1)
    page_size = frappe.utils.cint(page_size) or CRECHE_LIST_PAGE_SIZE

    or_filters = None
    if search_term:
        or_filters = [
            ["creche_name", "like", f"%{search_term}%"],
            ["creche_id", "like", f"%{search_term}%"],
        ]

    # frappe.db.count() only ANDs a list of filter triplets, so an OR
    # search (name-or-id match) is counted with a direct query instead.
    if search_term:
        total = frappe.db.sql(
            """
                SELECT COUNT(*) FROM `tabCreche`
                WHERE creche_name LIKE %(term)s OR creche_id LIKE %(term)s
            """,
            {"term": f"%{search_term}%"},
        )[0][0]
    else:
        total = frappe.db.count("Creche")

    creches = frappe.db.get_list(
        "Creche",
        or_filters=or_filters,
        fields=["name", "creche_name", "creche_id"],
        order_by="creche_name asc",
        limit_start=(page - 1) * page_size,
        limit_page_length=page_size,
    )

    return {
        "status": "success",
        "creches": creches,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": max(1, (total + page_size - 1) // page_size),
    }


@frappe.whitelist()
def get_transferable_fields():
    """
    Returns the list of checkbox fields the UI can offer, in display order.
    """
    fields = [{"fieldname": fn, "label": meta["label"]} for fn, meta in TRANSFERABLE_FIELDS.items()]
    return {"status": "success", "fields": fields}


@frappe.whitelist()
def get_creche_transfer_preview(from_creche, fields=None):
    """
    Returns a per-doctype record count for the given creche, so the UI can
    show what a transfer would move before the user commits.
    """
    selected_fields = _parse_selected_fields(fields)

    # creche_id on every target doctype is a Link field to Creche, so it
    # stores the Creche's docNAME (e.g. "1"), not the Creche's own
    # creche_id Data field (e.g. "1976"). Matching/writing on creche_id
    # must therefore use from_creche/to_creche directly, unchanged.
    counts = []
    total = 0
    for target in CRECHE_TRANSFER_TARGETS:
        active_fields = _resolve_active_fields(target, selected_fields)
        if not active_fields:
            continue

        if target["match_by"] == "geography":
            old_creche = frappe.db.get_value("Creche", from_creche, active_fields, as_dict=True) or {}
            filters = {f: old_creche.get(f) for f in active_fields if old_creche.get(f)}
            count = frappe.db.count(target["doctype"], filters) if filters else 0
        elif target["match_by"] == "child_profile_via_cee":
            count = frappe.db.sql(
                """
                    SELECT COUNT(*) FROM `tabChild Profile` cp
                    INNER JOIN `tabChild Enrollment and Exit` cee ON cee.hhcguid = cp.chhguid
                    WHERE cee.creche_id = %s
                """,
                (from_creche,),
            )[0][0]
        else:
            count = frappe.db.count(target["doctype"], {"creche_id": from_creche})

        counts.append({"doctype": target["doctype"], "count": count, "fields": active_fields})
        total += count

    # Child Attendance / Child Growth Monitoring are handled by dedicated
    # merge functions (see transfer_child_attendance / transfer_child_growth_monitoring)
    # rather than the generic loop above, but their counts still belong in
    # the preview whenever "creche_id" is one of the selected fields.
    if "creche_id" in selected_fields:
        attendance_count = frappe.db.sql(
            """
                SELECT COUNT(*) FROM `tabChild Attendance List` cal
                INNER JOIN `tabChild Attendance` ca ON ca.name = cal.parent
                WHERE ca.creche_id = %s
            """,
            (from_creche,),
        )[0][0]
        counts.append({"doctype": "Child Attendance", "count": attendance_count, "fields": ["creche_id"]})
        total += attendance_count

        growth_count = frappe.db.sql(
            """
                SELECT COUNT(*) FROM `tabAnthropromatic Data` ad
                INNER JOIN `tabChild Growth Monitoring` cgm ON cgm.name = ad.parent
                WHERE cgm.creche_id = %s
            """,
            (from_creche,),
        )[0][0]
        counts.append({"doctype": "Child Growth Monitoring", "count": growth_count, "fields": ["creche_id"]})
        total += growth_count

    return {"status": "success", "counts": counts, "total": total}


def _parse_selected_fields(fields):
    if isinstance(fields, str):
        try:
            fields = json.loads(fields)
        except ValueError:
            fields = [f.strip() for f in fields.split(",") if f.strip()]
    if not fields:
        return list(TRANSFERABLE_FIELDS.keys())
    return [f for f in fields if f in TRANSFERABLE_FIELDS]


@frappe.whitelist()
def start_creche_transfer(from_creche, to_creche, fields=None):
    """
    Kicks off a background job that moves every record referencing
    from_creche over to to_creche, across all CRECHE_TRANSFER_TARGETS,
    updating only the selected fields. Returns immediately; poll
    get_creche_transfer_status for progress.
    """
    from_creche = (from_creche or "").strip()
    to_creche = (to_creche or "").strip()
    selected_fields = _parse_selected_fields(fields)

    if not from_creche or not to_creche:
        frappe.throw("Both Transfer From and Transfer To creches are required.")
    if from_creche == to_creche:
        frappe.throw("Transfer From and Transfer To must be different creches.")
    if not frappe.db.exists("Creche", from_creche):
        frappe.throw(f"Creche {from_creche} not found.")
    if not frappe.db.exists("Creche", to_creche):
        frappe.throw(f"Creche {to_creche} not found.")
    if not selected_fields:
        frappe.throw("Select at least one field to transfer.")

    existing = _load_transfer_status()
    if existing and existing.get("state") == "running":
        frappe.throw("A creche transfer is already in progress. Please wait for it to finish.")

    transfer_id = frappe.generate_hash(length=12)

    status = {
        "transfer_id": transfer_id,
        "state": "running",
        "from_creche": from_creche,
        "to_creche": to_creche,
        "selected_fields": selected_fields,
        "started_at": str(now_datetime()),
        "finished_at": None,
        "current_doctype": None,
        "doctypes_total": 0,
        "doctypes_done": 0,
        "records_total": 0,
        "records_processed": 0,
        "per_doctype": [],
        "log": [],
        "error": None,
        "revertible": False,
        "reverted": False,
    }
    _write_transfer_status(status)

    _append_transfer_history({
        "transfer_id": transfer_id,
        "from_creche": from_creche,
        "to_creche": to_creche,
        "selected_fields": selected_fields,
        "started_at": status["started_at"],
        "finished_at": None,
        "state": "running",
        "records_processed": 0,
        "revertible": False,
        "reverted": False,
    })

    frappe.enqueue(
        method="frappe.apf.page.duplicate_id_panel.duplicate_id_panel.run_creche_transfer",
        queue="long",
        timeout=21600,
        is_async=True,
        transfer_id=transfer_id,
        from_creche=from_creche,
        to_creche=to_creche,
        selected_fields=selected_fields,
    )

    return {"status": "success", "message": "Transfer started.", "transfer_id": transfer_id}


@frappe.whitelist()
def get_creche_transfer_status():
    """
    Polled by the browser every couple of seconds to render the live
    progress bar and terminal output during a transfer.
    """
    status = _load_transfer_status()
    if not status:
        return {"status": "success", "transfer": None}
    return {"status": "success", "transfer": status}


@frappe.whitelist()
def get_creche_transfer_history():
    """
    Returns transfer run history for the last 90 days, most recent first.
    """
    history = _prune_transfer_history(_load_transfer_history())
    return {"status": "success", "history": history}


def run_creche_transfer(transfer_id, from_creche, to_creche, selected_fields):
    """
    Background worker (invoked via frappe.enqueue). Processes every
    CRECHE_TRANSFER_TARGETS doctype in CRECHE_TRANSFER_BATCH_SIZE chunks so
    lakhs of rows never need to be loaded into memory at once. Before each
    batch UPDATE, the current (old) values of every field about to change
    are written to a JSONL snapshot file so the transfer can be reverted.
    """
    status = _load_transfer_status() or {}
    snapshot_path = _creche_transfer_snapshot_path(transfer_id)

    try:
        old_creche = frappe.db.get_value(
            "Creche", from_creche, list(TRANSFERABLE_FIELDS.keys()), as_dict=True
        ) or {}
        new_creche = frappe.db.get_value(
            "Creche", to_creche, list(TRANSFERABLE_FIELDS.keys()), as_dict=True
        ) or {}

        # creche_id on every target doctype is a Link field to Creche, so it
        # stores the Creche's docNAME (e.g. "1"), not the Creche's own
        # creche_id Data field (e.g. "1976"). Matching/writing on creche_id
        # must therefore use from_creche/to_creche directly, unchanged.
        active_targets = []
        per_doctype = []
        records_total = 0

        for target in CRECHE_TRANSFER_TARGETS:
            active_fields = _resolve_active_fields(target, selected_fields)
            if not active_fields:
                continue

            if target["match_by"] == "geography":
                match_filters = {f: old_creche.get(f) for f in active_fields if old_creche.get(f)}
                count = frappe.db.count(target["doctype"], match_filters) if match_filters else 0
            elif target["match_by"] == "child_profile_via_cee":
                match_filters = None
                count = frappe.db.sql(
                    """
                        SELECT COUNT(*) FROM `tabChild Profile` cp
                        INNER JOIN `tabChild Enrollment and Exit` cee ON cee.hhcguid = cp.chhguid
                        WHERE cee.creche_id = %s
                    """,
                    (from_creche,),
                )[0][0]
            else:
                match_filters = {"creche_id": from_creche}
                count = frappe.db.count(target["doctype"], match_filters)

            if count == 0:
                continue

            active_targets.append({**target, "active_fields": active_fields, "match_filters": match_filters})
            per_doctype.append({
                "doctype": target["doctype"],
                "total": count,
                "processed": 0,
                "status": "pending",
            })
            records_total += count

        # Child Attendance / Child Growth Monitoring go through the
        # dedicated merge functions below, not the generic batch-UPDATE
        # loop -- but they still need per_doctype/records_total entries so
        # progress reporting covers them.
        special_active = "creche_id" in selected_fields
        if special_active:
            attendance_count = frappe.db.sql(
                """
                    SELECT COUNT(*) FROM `tabChild Attendance List` cal
                    INNER JOIN `tabChild Attendance` ca ON ca.name = cal.parent
                    WHERE ca.creche_id = %s
                """,
                (from_creche,),
            )[0][0]
            if attendance_count:
                per_doctype.append({"doctype": "Child Attendance", "total": attendance_count, "processed": 0, "status": "pending"})
                records_total += attendance_count

            growth_count = frappe.db.sql(
                """
                    SELECT COUNT(*) FROM `tabAnthropromatic Data` ad
                    INNER JOIN `tabChild Growth Monitoring` cgm ON cgm.name = ad.parent
                    WHERE cgm.creche_id = %s
                """,
                (from_creche,),
            )[0][0]
            if growth_count:
                per_doctype.append({"doctype": "Child Growth Monitoring", "total": growth_count, "processed": 0, "status": "pending"})
                records_total += growth_count

        status.update({
            "per_doctype": per_doctype,
            "doctypes_total": len(active_targets),
            "records_total": records_total,
            "records_processed": 0,
        })
        _write_transfer_status(status)
        _transfer_log(status, f"Starting transfer: {from_creche} -> {to_creche}. {records_total} total records across {len(active_targets)} doctypes. Fields: {', '.join(selected_fields)}.")

        with open(snapshot_path, "w", encoding="utf-8") as snapshot_file:
            for idx, target in enumerate(active_targets):
                doctype = target["doctype"]
                table = f"tab{doctype}"
                active_fields = target["active_fields"]
                match_filters = target["match_filters"]

                status["current_doctype"] = doctype
                per_doctype[idx]["status"] = "running"
                _write_transfer_status(status)
                _transfer_log(status, f"Processing {doctype} ({per_doctype[idx]['total']} records, fields: {', '.join(active_fields)})...")

                # creche_id is a Link to Creche -- its value must be the
                # target Creche's docname (to_creche), not the Creche doc's
                # own creche_id Data field. Every other transferable field
                # (partner_id/state_id/...) is sourced from the Creche doc
                # as usual via new_creche.get(f).
                new_values = [to_creche if f == "creche_id" else new_creche.get(f) for f in active_fields]
                set_clause = ", ".join([f"`{f}` = %s" for f in active_fields])

                is_child_profile_join = target["match_by"] == "child_profile_via_cee"
                if is_child_profile_join:
                    # The JOIN condition (cee.creche_id = from_creche) never
                    # changes as Child Profile rows get updated -- only
                    # Child Profile's own columns change, not CEE's -- so
                    # without excluding already-updated rows here, the same
                    # batch would be re-selected forever. Exclude any row
                    # whose fields already match the target values.
                    not_yet_updated = " OR ".join([f"cp.`{f}` <> %s OR cp.`{f}` IS NULL" for f in active_fields])
                    select_sql = f"""
                        SELECT cp.name AS name, {', '.join(f'cp.`{f}`' for f in active_fields)}
                        FROM `tabChild Profile` cp
                        INNER JOIN `tabChild Enrollment and Exit` cee ON cee.hhcguid = cp.chhguid
                        WHERE cee.creche_id = %s AND ({not_yet_updated})
                        LIMIT %s
                    """
                    select_values = [from_creche] + new_values + [CRECHE_TRANSFER_BATCH_SIZE]
                else:
                    where_clause = " AND ".join([f"`{f}` = %s" for f in match_filters.keys()])
                    where_values = list(match_filters.values())
                    select_sql = f"""
                        SELECT name, {', '.join(f'`{f}`' for f in active_fields)}
                        FROM `{table}`
                        WHERE {where_clause}
                        LIMIT %s
                    """
                    select_values = where_values + [CRECHE_TRANSFER_BATCH_SIZE]

                processed_for_doctype = 0
                batch_num = 0
                while True:
                    batch_num += 1
                    rows = frappe.db.sql(select_sql, select_values, as_dict=True)
                    if not rows:
                        break

                    # Snapshot OLD values before overwriting, one JSON line per row.
                    for row in rows:
                        snapshot_file.write(json.dumps({
                            "doctype": doctype,
                            "docname": row["name"],
                            "old_values": {f: row.get(f) for f in active_fields},
                        }, default=str) + "\n")
                    snapshot_file.flush()

                    names = [r["name"] for r in rows]
                    placeholders = ", ".join(["%s"] * len(names))
                    frappe.db.sql(
                        f"""
                            UPDATE `{table}`
                            SET {set_clause}
                            WHERE name IN ({placeholders})
                        """,
                        new_values + names
                    )
                    frappe.db.commit()

                    batch_count = len(names)
                    processed_for_doctype += batch_count
                    status["records_processed"] += batch_count
                    per_doctype[idx]["processed"] = processed_for_doctype
                    _write_transfer_status(status)
                    _transfer_log(status, f"{doctype}: batch {batch_num} - moved {processed_for_doctype}/{per_doctype[idx]['total']} records.")

                    if batch_count < CRECHE_TRANSFER_BATCH_SIZE:
                        break

                per_doctype[idx]["status"] = "done"
                status["doctypes_done"] += 1
                _write_transfer_status(status)
                _transfer_log(status, f"Finished {doctype}: {processed_for_doctype} records moved.", level="success")

            # Child Attendance and Child Growth Monitoring: per-child merge
            # into the target creche's own parent record(s), not a blanket
            # UPDATE (see module docstring at the top of transfer_child_attendance).
            for special_doctype, special_fn in (
                ("Child Attendance", transfer_child_attendance),
                ("Child Growth Monitoring", transfer_child_growth_monitoring),
            ):
                entry_idx = next((i for i, d in enumerate(per_doctype) if d["doctype"] == special_doctype), None)
                if entry_idx is None:
                    continue

                status["current_doctype"] = special_doctype
                per_doctype[entry_idx]["status"] = "running"
                _write_transfer_status(status)
                _transfer_log(status, f"Processing {special_doctype} ({per_doctype[entry_idx]['total']} child records, merging by child identity)...")

                processed, parent_count = special_fn(from_creche, to_creche, snapshot_file, status, per_doctype[entry_idx])

                per_doctype[entry_idx]["status"] = "done"
                status["doctypes_done"] += 1
                _write_transfer_status(status)
                _transfer_log(status, f"Finished {special_doctype}: {processed} child records processed across {parent_count} parent records.", level="success")

        status["state"] = "success"
        status["current_doctype"] = None
        status["finished_at"] = str(now_datetime())
        status["revertible"] = True
        _transfer_log(status, f"Transfer complete. {status['records_processed']} records moved from {from_creche} to {to_creche}.", level="success")

        _update_transfer_history_entry(transfer_id, {
            "finished_at": status["finished_at"],
            "state": "success",
            "records_processed": status["records_processed"],
            "revertible": True,
        })

    except Exception as e:
        frappe.db.rollback()
        status["state"] = "error"
        status["error"] = str(e)
        status["finished_at"] = str(now_datetime())
        # Whatever batches already committed before the error are still
        # revertible individually via the snapshot written so far.
        status["revertible"] = os.path.exists(snapshot_path) and os.path.getsize(snapshot_path) > 0
        _transfer_log(status, f"Transfer failed: {str(e)}", level="error")
        frappe.log_error(frappe.get_traceback(), "Creche Transfer Error")

        _update_transfer_history_entry(transfer_id, {
            "finished_at": status["finished_at"],
            "state": "error",
            "records_processed": status.get("records_processed", 0),
            "revertible": status["revertible"],
        })


@frappe.whitelist()
def start_creche_transfer_revert(transfer_id):
    """
    Kicks off a background job that restores every row changed by the given
    transfer_id back to its snapshotted OLD values.
    """
    transfer_id = (transfer_id or "").strip()
    if not transfer_id:
        frappe.throw("transfer_id is required.")

    snapshot_path = _creche_transfer_snapshot_path(transfer_id)
    if not os.path.exists(snapshot_path):
        frappe.throw("No revert data found for this transfer (snapshot missing or expired).")

    history = _load_transfer_history()
    entry = next((h for h in history if h.get("transfer_id") == transfer_id), None)
    if not entry:
        frappe.throw("Transfer record not found.")
    if not entry.get("revertible"):
        frappe.throw("This transfer is not revertible.")
    if entry.get("reverted"):
        frappe.throw("This transfer has already been reverted.")

    existing = _load_transfer_status()
    if existing and existing.get("state") == "running":
        frappe.throw("A creche transfer is already in progress. Please wait for it to finish.")

    status = {
        "transfer_id": transfer_id,
        "state": "running",
        "from_creche": entry.get("to_creche"),
        "to_creche": entry.get("from_creche"),
        "selected_fields": entry.get("selected_fields", []),
        "started_at": str(now_datetime()),
        "finished_at": None,
        "current_doctype": None,
        "doctypes_total": 0,
        "doctypes_done": 0,
        "records_total": 0,
        "records_processed": 0,
        "per_doctype": [],
        "log": [],
        "error": None,
        "revertible": False,
        "reverted": False,
        "is_revert": True,
    }
    _write_transfer_status(status)

    frappe.enqueue(
        method="frappe.apf.page.duplicate_id_panel.duplicate_id_panel.run_creche_transfer_revert",
        queue="long",
        timeout=21600,
        is_async=True,
        transfer_id=transfer_id,
    )

    return {"status": "success", "message": "Revert started."}


CHILD_PARENTFIELD_BY_PARENT_DOCTYPE = {
    "Child Attendance": ("childattendancelist", "Child Attendance List", CHILD_ATTENDANCE_LIST_FIELDS),
    "Child Growth Monitoring": ("anthropromatic_details", "Anthropromatic Data", ANTHROPROMATIC_DATA_FIELDS),
}


def _revert_doctype_rows(doctype, table, rows, status, per_doctype_entry):
    """
    Bulk-reverts every snapshot row for one doctype, split by action so
    each kind of change is undone with a small, fixed number of SQL
    statements instead of one per row -- matches the same batching
    philosophy as the forward bulk transfer, needed at 60L+ row scale.
    """
    insert_rows = [r for r in rows if r.get("action") == "insert" and r.get("docname")]
    delete_parent_rows = [r for r in rows if r.get("action") == "delete_parent"]
    update_rows = [r for r in rows if r.get("action") not in ("insert", "delete_parent")]

    processed = 0

    # 1. Rows the transfer inserted: bulk DELETE by name, chunked.
    if insert_rows:
        names = [r["docname"] for r in insert_rows]
        for i in range(0, len(names), CRECHE_TRANSFER_BULK_CHUNK):
            batch = names[i:i + CRECHE_TRANSFER_BULK_CHUNK]
            placeholders = ", ".join(["%s"] * len(batch))
            frappe.db.sql(f"DELETE FROM `{table}` WHERE name IN ({placeholders})", batch)
            frappe.db.commit()
            processed += len(batch)
            status["records_processed"] += len(batch)
            per_doctype_entry["processed"] = processed
            _write_transfer_status(status)
            _transfer_log(status, f"{doctype}: reverted {processed}/{len(rows)} records (deleted).")

    # 2. Parents the transfer deleted after merging: bulk re-INSERT the
    # parent rows, then bulk re-INSERT every child row underneath them,
    # strictly using their original names and idx values from the snapshot.
    if delete_parent_rows:
        parentfield, child_doctype, child_fields = CHILD_PARENTFIELD_BY_PARENT_DOCTYPE.get(doctype, (None, None, None))
        parent_meta_fields = ["partner_id", "state_id", "district_id", "block_id", "gp_id", "village_id", "creche_id"]
        if doctype == "Child Attendance":
            parent_meta_fields = parent_meta_fields + ["date_of_attendance", "childattenguid"]
        elif doctype == "Child Growth Monitoring":
            parent_meta_fields = parent_meta_fields + ["cgmguid"]

        now = now_datetime()
        user = frappe.session.user
        parent_insert_fields = ["name"] + parent_meta_fields + ["owner", "creation", "modified", "modified_by", "docstatus"]
        parent_rows = []
        all_child_rows = []

        for entry in delete_parent_rows:
            full_doc = entry.get("full_doc") or {}
            original_parent_name = entry.get("docname")
            
            parent_rows.append(
                (original_parent_name,) + tuple(full_doc.get(f) for f in parent_meta_fields) + (user, now, now, user, 0)
            )
            children = full_doc.get(parentfield) or [] if parentfield else []
            for child in children:
                all_child_rows.append((original_parent_name, child))

        frappe.db.bulk_insert(doctype, fields=parent_insert_fields, values=parent_rows, chunk_size=CRECHE_TRANSFER_BULK_CHUNK)
        frappe.db.commit()

        if all_child_rows and parentfield:
            child_insert_fields = ["name", "parent", "parenttype", "parentfield", "idx", "owner", "creation", "modified", "modified_by", "docstatus"] + child_fields
            child_rows_values = []
            
            for parent_name, child in all_child_rows:
                original_child_name = child.get("name")
                original_idx = child.get("idx", 0)
                
                child_rows_values.append(
                    (original_child_name, parent_name, doctype, parentfield, original_idx, user, now, now, user, 0)
                    + tuple(child.get(f) for f in child_fields)
                )
            frappe.db.bulk_insert(child_doctype, fields=child_insert_fields, values=child_rows_values, chunk_size=CRECHE_TRANSFER_BULK_CHUNK)
            frappe.db.commit()

        processed += len(delete_parent_rows)
        status["records_processed"] += len(delete_parent_rows)
        per_doctype_entry["processed"] = processed
        _write_transfer_status(status)
        _transfer_log(status, f"{doctype}: resurrected {len(delete_parent_rows)} deleted parent record(s) with {len(all_child_rows)} child row(s).")

    # 3. Plain field updates: old_values differ per row, so each still
    # needs its own UPDATE, but batched into fewer, larger transactions
    # (one commit + one status write per CRECHE_TRANSFER_BATCH_SIZE chunk
    # instead of unconditionally after every single row).
    for i in range(0, len(update_rows), CRECHE_TRANSFER_BATCH_SIZE):
        batch = update_rows[i:i + CRECHE_TRANSFER_BATCH_SIZE]
        for row_entry in batch:
            old_values = row_entry["old_values"]
            set_clause = ", ".join([f"`{f}` = %s" for f in old_values.keys()])
            frappe.db.sql(
                f"""UPDATE `{table}` SET {set_clause} WHERE name = %s""",
                list(old_values.values()) + [row_entry["docname"]]
            )
        frappe.db.commit()

        processed += len(batch)
        status["records_processed"] += len(batch)
        per_doctype_entry["processed"] = processed
        _write_transfer_status(status)
        _transfer_log(status, f"{doctype}: reverted {processed}/{len(rows)} records.")

    return processed


def run_creche_transfer_revert(transfer_id):
    """
    Background worker that reads the snapshot JSONL file for transfer_id
    and restores each row's fields to their pre-transfer values, in
    batches, with the same live progress/log pattern as the forward
    transfer.
    """
    status = _load_transfer_status() or {}
    snapshot_path = _creche_transfer_snapshot_path(transfer_id)

    try:
        # Group snapshot rows by doctype so progress can be reported the
        # same way as the forward transfer (per doctype).
        rows_by_doctype = {}
        with open(snapshot_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                entry = json.loads(line)
                rows_by_doctype.setdefault(entry["doctype"], []).append(entry)

        # Child-table doctypes must be reverted (deleted, for insert-action
        # rows) before their own parent doctype, so a parent row is never
        # removed while child rows still reference it via "parent".
        child_before_parent = {"Child Attendance List": 0, "Anthropromatic Data": 0, "Child Attendance": 1, "Child Growth Monitoring": 1}
        rows_by_doctype = dict(sorted(rows_by_doctype.items(), key=lambda kv: child_before_parent.get(kv[0], 0)))

        per_doctype = [
            {"doctype": dt, "total": len(rows), "processed": 0, "status": "pending"}
            for dt, rows in rows_by_doctype.items()
        ]
        records_total = sum(len(rows) for rows in rows_by_doctype.values())

        status.update({
            "per_doctype": per_doctype,
            "doctypes_total": len(rows_by_doctype),
            "records_total": records_total,
            "records_processed": 0,
        })
        _write_transfer_status(status)
        _transfer_log(status, f"Starting revert of transfer {transfer_id}. {records_total} records across {len(rows_by_doctype)} doctypes.")

        for idx, (doctype, rows) in enumerate(rows_by_doctype.items()):
            table = f"tab{doctype}"
            status["current_doctype"] = doctype
            per_doctype[idx]["status"] = "running"
            _write_transfer_status(status)
            _transfer_log(status, f"Reverting {doctype} ({len(rows)} records)...")

            processed_for_doctype = _revert_doctype_rows(doctype, table, rows, status, per_doctype[idx])

            per_doctype[idx]["status"] = "done"
            status["doctypes_done"] += 1
            _write_transfer_status(status)
            _transfer_log(status, f"Finished reverting {doctype}: {processed_for_doctype} records.", level="success")

        status["state"] = "success"
        status["current_doctype"] = None
        status["finished_at"] = str(now_datetime())
        status["reverted"] = True
        _transfer_log(status, f"Revert complete. {status['records_processed']} records restored.", level="success")

        _update_transfer_history_entry(transfer_id, {"reverted": True, "revertible": False})

    except Exception as e:
        frappe.db.rollback()
        status["state"] = "error"
        status["error"] = str(e)
        status["finished_at"] = str(now_datetime())
        _transfer_log(status, f"Revert failed: {str(e)}", level="error")
        frappe.log_error(frappe.get_traceback(), "Creche Transfer Revert Error")






