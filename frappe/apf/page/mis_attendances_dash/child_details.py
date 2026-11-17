"""
Child Details popup APIs for the MIS dashboard (mis_attendances_dash.js).

Clicking the number above a bar opens a list of the children / households
behind that number. Each endpoint below calls the SAME query builder that
produced the bar in indicator.py (`*_query(args, ..., detail=True)`), which
applies identical joins and filters and then narrows to the clicked bar
(a level group, or a month of the trend). The popup's `total` is the same
COUNT the bar shows, and the listed rows are exactly those counted.

All endpoints are paginated. Pages after the first may pass `known_total`
(returned by the first page) to skip re-counting.
"""

from datetime import date

import frappe
from frappe.apf.user_scope import scoped

from .indicator import (
    ANTHRO_COLS,
    ANTHRO_LEVELS,
    ATTENDANCE_BANDS,
    COHORT_ENDPOINTS,
    COHORT_TRANSITIONS,
    ENROLLED_AT_MONTH_END,
    ENROLLMENT_EVENT_INDICATORS,
    GF_MODES,
    HH_INDICATORS,
    anthro_measured_query,
    apply_bar_scope,
    attendance_band_query,
    cohort_query,
    cohort_transition_sql,
    enrollment_event_query,
    get_args,
    gf_query,
    hh_enrollment_query,
    parse_level,
    parse_month_label,
    reg_hh_query,
    selected_month,
    snapshot_ref,
    to_int,
)

DEFAULT_PAGE_LENGTH = 500
MAX_PAGE_LENGTH = 2000  # the XLSX export pages through in chunks of this size

# ==============================================================================
# SHARED HELPERS
# ==============================================================================

CRECHE_DISPLAY_SELECT = """
    p.partner_name AS partner, s.state_name AS state, d.district_name AS district,
    b.block_name AS block, g.gp_name AS gp, usr.full_name AS supervisor,
    cr.creche_name AS creche, cr.creche_id AS creche_id
"""
CRECHE_DISPLAY_JOINS = """
    LEFT JOIN `tabUser` usr ON usr.name = cr.supervisor_id
    LEFT JOIN `tabPartner` p ON p.name = cr.partner_id
    LEFT JOIN `tabState` s ON s.name = cr.state_id
    LEFT JOIN `tabDistrict` d ON d.name = cr.district_id
    LEFT JOIN `tabBlock` b ON b.name = cr.block_id
    LEFT JOIN `tabGram Panchayat` g ON g.name = cr.gp_id
"""
CRECHE_DISPLAY_FIELDS = ("partner", "state", "district", "block", "gp", "supervisor", "creche", "creche_id")


def _gender_case(alias):
    return (f"(CASE WHEN {alias}.gender_id = '1' THEN 'M' WHEN {alias}.gender_id = '2' THEN 'F' "
            f"ELSE {alias}.gender_id END)")


def _pagination(args):
    length = to_int(args.get("page_length"), DEFAULT_PAGE_LENGTH) or DEFAULT_PAGE_LENGTH
    length = max(1, min(length, MAX_PAGE_LENGTH))
    start = max(0, to_int(args.get("start"), 0))
    return start, length


def _response(rows, total, start, length, columns, message=None):
    return {"rows": rows, "total": total, "start": start, "page_length": length,
            "columns": columns, "message": message}


def _empty(start, length, columns=None, message=None):
    return _response([], 0, start, length, columns or [], message)


def _known_total(args):
    known = to_int(args.get("known_total"), -1)
    return known if known >= 0 else None


def _count(q, key, distinct):
    expr = f"COUNT(DISTINCT {key})" if distinct else "COUNT(*)"
    row = frappe.db.sql(f"SELECT {expr} FROM {q.from_sql()} WHERE {q.where_sql()}", q.params)
    return int(row[0][0] or 0) if row else 0


def _page_keys(q, key, sort_expr, start, length, distinct):
    """Keys of one page, newest first. `distinct` collapses several matching rows per key."""
    params = dict(q.params, _start=start, _length=length)
    if distinct:
        sql = (f"SELECT {key} AS k, MAX({sort_expr}) AS s FROM {q.from_sql()} WHERE {q.where_sql()} "
               f"GROUP BY k ORDER BY s DESC, k LIMIT %(_length)s OFFSET %(_start)s")
    else:
        sql = (f"SELECT {key} AS k FROM {q.from_sql()} WHERE {q.where_sql()} "
               f"ORDER BY {sort_expr} DESC, {key} LIMIT %(_length)s OFFSET %(_start)s")
    return [r[0] for r in frappe.db.sql(sql, params)]


def _keyed_query(q, key, sort_expr, start, length, distinct, args):
    """(total, page_keys) for a Q built by an indicator query builder."""
    total = _known_total(args)
    if total is None:
        total = _count(q, key, distinct)
    if total == 0:
        return 0, []
    return total, _page_keys(q, key, sort_expr, start, length, distinct)


def _key(value):
    """
    Normalised dict key. tabCreche.name is an auto-increment integer while the
    creche_id columns on other tables hold the same value as text; SQL matches
    them, a Python dict lookup would not (123 != '123').
    """
    return None if value is None else str(value)


def _creche_info(creche_names):
    names = tuple({_key(n) for n in creche_names if n not in (None, "")})
    if not names:
        return {}
    rows = frappe.db.sql(f"""
        SELECT cr.name AS k, {CRECHE_DISPLAY_SELECT}
        FROM `tabCreche` cr {CRECHE_DISPLAY_JOINS}
        WHERE cr.name IN %(names)s
    """, {"names": names}, as_dict=True)
    return {_key(r.k): r for r in rows}


def _child_info(cee_names, age_ref=None):
    """Display fields for enrollment records (tabChild Enrollment and Exit.name)."""
    names = tuple({_key(n) for n in cee_names if n not in (None, "")})
    if not names:
        return {}
    rows = frappe.db.sql(f"""
        SELECT cee.name AS k, cee.creche_id AS cee_creche,
               cee.child_id AS child_id, cee.child_name AS child_name,
               {_gender_case('cee')} AS gender,
               TIMESTAMPDIFF(MONTH, cee.child_dob, %(age_ref)s) AS age_months,
               DATE_FORMAT(cee.child_dob, '%%d-%%m-%%Y') AS child_dob,
               DATE_FORMAT(cee.date_of_enrollment, '%%d-%%m-%%Y') AS date_of_enrollment,
               DATE_FORMAT(cee.date_of_exit, '%%d-%%m-%%Y') AS date_of_exit,
               IFNULL(rfe.add_reasons, '') AS exit_reason
        FROM `tabChild Enrollment and Exit` cee
        LEFT JOIN `tabReason for child exit` rfe ON rfe.name = cee.reason_for_exit
        WHERE cee.name IN %(names)s
    """, {"names": names, "age_ref": age_ref or date.today()}, as_dict=True)
    return {_key(r.k): r for r in rows}


def _with_creche(row, creche_map, creche_name):
    info = creche_map.get(_key(creche_name)) or {}
    for f in CRECHE_DISPLAY_FIELDS:
        row[f] = info.get(f)
    return row


def _bar_month(args):
    """Month the clicked bar represents: the selected month for a level bar, else the clicked trend month."""
    year, month = selected_month(args)
    if parse_level(args.get("level")):
        return date(year, month, 1)
    return parse_month_label(args.get("bar_label")) or date(year, month, 1)


# ==============================================================================
# 1. DEMOGRAPHY -> Registered Households
# ==============================================================================

REG_HH_COLUMNS = [
    {"label": "Partner", "fieldname": "partner"},
    {"label": "State", "fieldname": "state"},
    {"label": "District", "fieldname": "district"},
    {"label": "Block", "fieldname": "block"},
    {"label": "Gram Panchayat", "fieldname": "gp"},
    {"label": "Creche", "fieldname": "creche"},
    {"label": "Creche ID", "fieldname": "creche_id"},
    {"label": "Household ID", "fieldname": "household_id"},
    {"label": "Household Head", "fieldname": "household_head_name"},
    {"label": "Family Members", "fieldname": "number_of_family_members"},
    {"label": "Registered On", "fieldname": "registered_on"},
]


@frappe.whitelist()
@scoped()
def get_registered_households_details(**kwargs):
    """Child-Details twin of indicator.get_reg_HH."""
    args = get_args(kwargs)
    start, length = _pagination(args)

    q, _, _ = reg_hh_query(args, detail=True)
    total, keys = _keyed_query(q, "hh.name", "hh.creation", start, length, False, args)
    if not keys:
        return _response([], total, start, length, REG_HH_COLUMNS)

    data = frappe.db.sql("""
        SELECT hh.name AS k, hh.creche_id AS hh_creche, hh.hhid AS household_id,
               hh.hosuehold_head_name AS household_head_name,
               hh.number_of_family_members AS number_of_family_members,
               DATE_FORMAT(hh.creation, '%%Y-%%m-%%d') AS registered_on
        FROM `tabHousehold Form` hh WHERE hh.name IN %(keys)s
    """, {"keys": tuple(keys)}, as_dict=True)
    by_key = {_key(r.k): r for r in data}
    creches = _creche_info(r.hh_creche for r in data)

    rows = []
    for k in keys:
        r = by_key.get(_key(k))
        if not r:
            continue
        row = _with_creche({}, creches, r.hh_creche)
        row.update({f: r.get(f) for f in ("household_id", "household_head_name", "number_of_family_members", "registered_on")})
        rows.append(row)
    return _response(rows, total, start, length, REG_HH_COLUMNS)


# ==============================================================================
# 2. ATTENDANCE (100% / 0% / >= 70% / <= 50% bands)
# ==============================================================================

ATTENDANCE_COLUMNS = [
    {"label": "Partner", "fieldname": "partner"},
    {"label": "State", "fieldname": "state"},
    {"label": "District", "fieldname": "district"},
    {"label": "Block", "fieldname": "block"},
    {"label": "Gram Panchayat", "fieldname": "gp"},
    {"label": "Supervisor", "fieldname": "supervisor"},
    {"label": "Creche", "fieldname": "creche"},
    {"label": "Creche ID", "fieldname": "creche_id"},
    {"label": "Child ID", "fieldname": "child_id"},
    {"label": "Child Name", "fieldname": "child_name"},
    {"label": "Gender", "fieldname": "gender"},
    {"label": "Eligible Days", "fieldname": "eligible_days"},
    {"label": "Days Attended", "fieldname": "days_attended"},
    {"label": "Attendance (%)", "fieldname": "attendance_percentage"},
]


@frappe.whitelist()
@scoped()
def get_attendance_details(**kwargs):
    """Child-Details twin of full_attendance / zero_attendance / seventy_attendance / fivety_attendance."""
    args = get_args(kwargs)
    start, length = _pagination(args)

    band = args.get("indicator_key")
    if band not in ATTENDANCE_BANDS:
        return _empty(start, length, ATTENDANCE_COLUMNS, f"Unsupported indicator: {band}")

    from_sql, where_sql, params, _, _ = attendance_band_query(args, band, detail=True)

    total = _known_total(args)
    if total is None:
        row = frappe.db.sql(f"SELECT COUNT(*) FROM {from_sql} WHERE {where_sql}", params)
        total = int(row[0][0] or 0) if row else 0
    if total == 0:
        return _response([], 0, start, length, ATTENDANCE_COLUMNS)

    page = frappe.db.sql(f"""
        SELECT cee.name AS cee_name, cs.att_creche AS att_creche,
               cs.eligible_days AS eligible_days, cs.days_attended AS days_attended,
               ROUND(cs.days_attended * 100.0 / cs.eligible_days, 2) AS attendance_percentage
        FROM {from_sql}
        WHERE {where_sql}
        ORDER BY attendance_percentage DESC, cee.child_name ASC, cee.name ASC
        LIMIT %(_length)s OFFSET %(_start)s
    """, dict(params, _start=start, _length=length), as_dict=True)

    children = _child_info(r.cee_name for r in page)
    creches = _creche_info(r.att_creche for r in page)
    rows = []
    for r in page:
        child = children.get(_key(r.cee_name)) or {}
        row = _with_creche({}, creches, r.att_creche)
        row.update({
            "child_id": child.get("child_id"), "child_name": child.get("child_name"), "gender": child.get("gender"),
            "eligible_days": r.eligible_days, "days_attended": r.days_attended,
            "attendance_percentage": r.attendance_percentage,
        })
        rows.append(row)
    return _response(rows, total, start, length, ATTENDANCE_COLUMNS)


# ==============================================================================
# 3. ENROLLMENT
# ==============================================================================

ENROLLMENT_COLUMNS = [
    {"label": "Partner", "fieldname": "partner"},
    {"label": "State", "fieldname": "state"},
    {"label": "District", "fieldname": "district"},
    {"label": "Block", "fieldname": "block"},
    {"label": "Gram Panchayat", "fieldname": "gp"},
    {"label": "Supervisor", "fieldname": "supervisor"},
    {"label": "Creche", "fieldname": "creche"},
    {"label": "Creche ID", "fieldname": "creche_id"},
    {"label": "Child ID", "fieldname": "child_id"},
    {"label": "Child Name", "fieldname": "child_name"},
    {"label": "Gender", "fieldname": "gender"},
    {"label": "Age (months)", "fieldname": "age_months"},
    {"label": "Date of Birth", "fieldname": "child_dob"},
    {"label": "Date of Enrollment", "fieldname": "date_of_enrollment"},
    {"label": "Date of Exit", "fieldname": "date_of_exit"},
    {"label": "Exit Reason", "fieldname": "exit_reason"},
]

HH_ENROLLMENT_COLUMNS = [
    {"label": "Partner", "fieldname": "partner"},
    {"label": "State", "fieldname": "state"},
    {"label": "District", "fieldname": "district"},
    {"label": "Block", "fieldname": "block"},
    {"label": "Gram Panchayat", "fieldname": "gp"},
    {"label": "Creche", "fieldname": "creche"},
    {"label": "Creche ID", "fieldname": "creche_id"},
    {"label": "Household ID", "fieldname": "household_id"},
    {"label": "Child Name", "fieldname": "child_name"},
    {"label": "Gender", "fieldname": "gender"},
    {"label": "Age (months)", "fieldname": "age_months"},
    {"label": "Date of Birth", "fieldname": "child_dob"},
    {"label": "Status", "fieldname": "status_label"},
]

CHILD_FIELDS = ("child_id", "child_name", "gender", "age_months", "child_dob",
                "date_of_enrollment", "date_of_exit", "exit_reason")


@frappe.whitelist()
@scoped()
def get_enrollment_details(**kwargs):
    """Child-Details twin of Total Exited / Exit (reason) / New Enrolment."""
    args = get_args(kwargs)
    start, length = _pagination(args)

    indicator = args.get("indicator_key")
    if indicator not in ENROLLMENT_EVENT_INDICATORS:
        return _empty(start, length, ENROLLMENT_COLUMNS, f"Unsupported indicator: {indicator}")

    q, date_col, _, months = enrollment_event_query(args, indicator, detail=True)
    total, keys = _keyed_query(q, "cee.name", date_col, start, length, False, args)
    if not keys:
        return _response([], total, start, length, ENROLLMENT_COLUMNS)

    children = _child_info(keys, snapshot_ref(months[0]))
    creches = _creche_info(c.cee_creche for c in children.values())
    rows = []
    for k in keys:
        child = children.get(_key(k))
        if not child:
            continue
        row = _with_creche({}, creches, child.cee_creche)
        row.update({f: child.get(f) for f in CHILD_FIELDS})
        rows.append(row)
    return _response(rows, total, start, length, ENROLLMENT_COLUMNS)


@frappe.whitelist()
@scoped()
def get_household_enrollment_details(**kwargs):
    """Child-Details twin of Total Not Enrolled / Not Enrolled (status) / To Be Enrolled."""
    args = get_args(kwargs)
    start, length = _pagination(args)

    indicator = args.get("indicator_key")
    if indicator not in HH_INDICATORS:
        return _empty(start, length, HH_ENROLLMENT_COLUMNS, f"Unsupported indicator: {indicator}")

    q, _, ref_months, population = hh_enrollment_query(args, indicator, detail=True)
    q.where(population[0])
    total, keys = _keyed_query(q, "hcf.name", "hf.creation", start, length, False, args)
    if not keys:
        return _response([], total, start, length, HH_ENROLLMENT_COLUMNS)

    data = frappe.db.sql(f"""
        SELECT hcf.name AS k, hf.name AS household_id, hf.creche_id AS hh_creche,
               hcf.child_name AS child_name, {_gender_case('hcf')} AS gender,
               TIMESTAMPDIFF(MONTH, hcf.child_dob, %(ref)s) AS age_months,
               DATE_FORMAT(hcf.child_dob, '%%d-%%m-%%Y') AS child_dob,
               hcs.hh_child_status AS status_label
        FROM `tabHousehold Child Form` hcf
        INNER JOIN `tabHousehold Form` hf ON hf.name = hcf.parent
        LEFT JOIN `tabHH Child Status` hcs ON hcs.name = hcf.child_status
        WHERE hcf.name IN %(keys)s
    """, {"keys": tuple(keys), "ref": snapshot_ref(ref_months[0])}, as_dict=True)
    by_key = {_key(r.k): r for r in data}
    creches = _creche_info(r.hh_creche for r in data)

    rows = []
    for k in keys:
        r = by_key.get(_key(k))
        if not r:
            continue
        row = _with_creche({}, creches, r.hh_creche)
        row.update({f: r.get(f) for f in ("household_id", "child_name", "gender", "age_months", "child_dob")})
        row["status_label"] = r.status_label or "To Be Enrolled"
        rows.append(row)
    return _response(rows, total, start, length, HH_ENROLLMENT_COLUMNS)


# ==============================================================================
# 4. MALNUTRITION
# ==============================================================================

MALNUTRITION_COLUMNS = [
    {"label": "Partner", "fieldname": "partner"},
    {"label": "State", "fieldname": "state"},
    {"label": "District", "fieldname": "district"},
    {"label": "Block", "fieldname": "block"},
    {"label": "Gram Panchayat", "fieldname": "gp"},
    {"label": "Supervisor", "fieldname": "supervisor"},
    {"label": "Creche", "fieldname": "creche"},
    {"label": "Creche ID", "fieldname": "creche_id"},
    {"label": "Child ID", "fieldname": "child_id"},
    {"label": "Child Name", "fieldname": "child_name"},
    {"label": "Gender", "fieldname": "gender"},
    {"label": "Age (months)", "fieldname": "age_months"},
    {"label": "Height (cm)", "fieldname": "height"},
    {"label": "Weight (kg)", "fieldname": "weight"},
    {"label": "Measurement Date", "fieldname": "measurement_date"},
    {"label": "WFA Z-Score", "fieldname": "weight_for_age_zscore"},
    {"label": "WFA Status", "fieldname": "weight_for_age_status", "type": "status"},
    {"label": "WFH Z-Score", "fieldname": "weight_for_height_zscore"},
    {"label": "WFH Status", "fieldname": "weight_for_height_status", "type": "status"},
    {"label": "HFA Z-Score", "fieldname": "height_for_age_zscore"},
    {"label": "HFA Status", "fieldname": "height_for_age_status", "type": "status"},
]
GF_SNC_COLUMNS = MALNUTRITION_COLUMNS

MEASUREMENT_FIELDS = ("age_months", "height", "weight", "measurement_date",
                      "weight_for_age_zscore", "weight_for_age_status",
                      "weight_for_height_zscore", "weight_for_height_status",
                      "height_for_age_zscore", "height_for_age_status")

# indicator endpoint -> (Anthropromatic Data column, status code); 3 Normal, 2 Moderate, 1 Severe
ANTHRO_STATUS_MAP = {
    f"get_{cat}_{lvl}_data": (col, code)
    for cat, col in ANTHRO_COLS.items()
    for lvl, code in ANTHRO_LEVELS.items()
}


def _status_case(col):
    return f"CASE WHEN {col} = 3 THEN 'Normal' WHEN {col} = 2 THEN 'Moderate' WHEN {col} = 1 THEN 'Severe' ELSE '' END"


def _measurement_select(alias):
    return f"""
        {alias}.age_months AS age_months, {alias}.height AS height, {alias}.weight AS weight,
        DATE_FORMAT({alias}.measurement_taken_date, '%%d-%%m-%%Y') AS measurement_date,
        {alias}.weight_for_age_zscore AS weight_for_age_zscore,
        {_status_case(f'{alias}.weight_for_age')} AS weight_for_age_status,
        {alias}.weight_for_height_zscore AS weight_for_height_zscore,
        {_status_case(f'{alias}.weight_for_height')} AS weight_for_height_status,
        {alias}.height_for_age_zscore AS height_for_age_zscore,
        {_status_case(f'{alias}.height_for_age')} AS height_for_age_status
    """


@frappe.whitelist()
@scoped()
def get_malnutrition_details(**kwargs):
    """Child-Details twin of Measurement (%) and WFA/WFH/HFA Normal/Moderate/Severe (one row per child)."""
    args = get_args(kwargs)
    start, length = _pagination(args)

    indicator = args.get("indicator_key")
    if indicator not in ANTHRO_STATUS_MAP and indicator != "get_measured_data":
        return _empty(start, length, MALNUTRITION_COLUMNS, f"Unsupported indicator: {indicator}")

    q, _, months = anthro_measured_query(args, detail=True)
    if indicator == "get_measured_data":
        # The bar is numerator / enrolled; the list is the numerator.
        q.where(ENROLLED_AT_MONTH_END)
    else:
        col, code = ANTHRO_STATUS_MAP[indicator]
        q.where(f"ad.{col} = %(status_code)s")
        q.params["status_code"] = code

    total, keys = _keyed_query(q, "cee.name", "ad.measurement_taken_date", start, length, True, args)
    if not keys:
        return _response([], total, start, length, MALNUTRITION_COLUMNS)

    # Latest qualifying measurement of each child on this page.
    measurements = frappe.db.sql(f"""
        SELECT cee.name AS k, {_measurement_select('ad')}
        FROM {q.from_sql()}
        WHERE {q.where_sql()} AND cee.name IN %(_keys)s
        ORDER BY ad.measurement_taken_date DESC, ad.name DESC
    """, dict(q.params, _keys=tuple(keys)), as_dict=True)
    latest = {}
    for m in measurements:
        latest.setdefault(_key(m.k), m)

    children = _child_info(keys, snapshot_ref(months[0]))
    creches = _creche_info(c.cee_creche for c in children.values())
    rows = []
    for k in keys:
        child = children.get(_key(k)) or {}
        row = _with_creche({}, creches, child.get("cee_creche"))
        row.update({"child_id": child.get("child_id"), "child_name": child.get("child_name"), "gender": child.get("gender")})
        m = latest.get(_key(k)) or {}
        row.update({f: m.get(f) for f in MEASUREMENT_FIELDS})
        rows.append(row)
    return _response(rows, total, start, length, MALNUTRITION_COLUMNS)


@frappe.whitelist()
@scoped()
def get_gf_snc_details(**kwargs):
    """Child-Details twin of GF1 / GF1+ / GF2 / Zig-Zag / SNC (one row per counted measurement)."""
    args = get_args(kwargs)
    start, length = _pagination(args)

    api_mode = args.get("indicator_key")
    if api_mode not in GF_MODES:
        return _empty(start, length, GF_SNC_COLUMNS, "indicator_key must be one of: " + ", ".join(sorted(GF_MODES)))

    q, _, _ = gf_query(args, api_mode, detail=True)
    total, keys = _keyed_query(q, "ad_current.name", "ad_current.measurement_taken_date", start, length, True, args)
    if not keys:
        return _response([], total, start, length, GF_SNC_COLUMNS)

    data = frappe.db.sql(f"""
        SELECT ad_current.name AS k, cee.name AS cee_name, cgm.creche_id AS cgm_creche,
               {_measurement_select('ad_current')}
        FROM `tabAnthropromatic Data` ad_current
        INNER JOIN `tabChild Growth Monitoring` cgm ON cgm.name = ad_current.parent
        INNER JOIN `tabChild Enrollment and Exit` cee ON cee.childenrollguid = ad_current.childenrollguid
        WHERE ad_current.name IN %(keys)s
    """, {"keys": tuple(keys)}, as_dict=True)
    by_key = {}
    for r in data:
        by_key.setdefault(_key(r.k), r)

    children = _child_info((r.cee_name for r in by_key.values()))
    creches = _creche_info(r.cgm_creche for r in by_key.values())
    rows = []
    for k in keys:
        r = by_key.get(_key(k))
        if not r:
            continue
        child = children.get(_key(r.cee_name)) or {}
        row = _with_creche({}, creches, r.cgm_creche)
        row.update({"child_id": child.get("child_id"), "child_name": child.get("child_name"), "gender": child.get("gender")})
        row.update({f: r.get(f) for f in MEASUREMENT_FIELDS})
        rows.append(row)
    return _response(rows, total, start, length, GF_SNC_COLUMNS)


# ==============================================================================
# 5. COHORT
# ==============================================================================

COHORT_COLUMNS = [
    {"label": "Partner", "fieldname": "partner"},
    {"label": "State", "fieldname": "state"},
    {"label": "District", "fieldname": "district"},
    {"label": "Block", "fieldname": "block"},
    {"label": "Gram Panchayat", "fieldname": "gp"},
    {"label": "Supervisor", "fieldname": "supervisor"},
    {"label": "Creche", "fieldname": "creche"},
    {"label": "Creche ID", "fieldname": "creche_id"},
    {"label": "Child ID", "fieldname": "child_id"},
    {"label": "Child Name", "fieldname": "child_name"},
    {"label": "Gender", "fieldname": "gender"},
    {"label": "Date of Birth", "fieldname": "child_dob"},
    {"label": "First Measurement Date", "fieldname": "first_measurement_date"},
    {"label": "First Z-Score", "fieldname": "first_zscore"},
    {"label": "First Category", "fieldname": "initial_category", "type": "status"},
    {"label": "Last Measurement Date", "fieldname": "last_measurement_date"},
    {"label": "Last Z-Score", "fieldname": "last_zscore"},
    {"label": "Last Category", "fieldname": "final_category", "type": "status"},
]


@frappe.whitelist()
@scoped()
def get_cohort_details(**kwargs):
    """Child-Details twin of the cohort transition indicators."""
    args = get_args(kwargs)
    start, length = _pagination(args)

    indicator_key = args.get("indicator_key")
    api_mode = COHORT_ENDPOINTS.get(indicator_key, (indicator_key, None))[0]
    if api_mode not in COHORT_TRANSITIONS:
        return _empty(start, length, COHORT_COLUMNS, "Unrecognized cohort indicator_key")

    def scope(q):
        apply_bar_scope(q, args)
        return "1"

    cte, params = cohort_query(args, _bar_month(args), scope, with_scores=True)
    body = f"""
        FROM rc INNER JOIN st ON st.childenrollguid = rc.childenrollguid
        WHERE st.first_date != st.last_date AND {cohort_transition_sql(api_mode)}
    """

    total = _known_total(args)
    if total is None:
        row = frappe.db.sql(f"{cte} SELECT COUNT(*) {body}", params)
        total = int(row[0][0] or 0) if row else 0
    if total == 0:
        return _response([], 0, start, length, COHORT_COLUMNS)

    page = frappe.db.sql(f"""
        {cte}
        SELECT rc.cee_name AS cee_name, rc.creche_id AS rc_creche,
               DATE_FORMAT(st.first_date, '%%d-%%m-%%Y') AS first_measurement_date,
               st.first_zscore AS first_zscore, st.initial_category AS initial_category,
               DATE_FORMAT(st.last_date, '%%d-%%m-%%Y') AS last_measurement_date,
               st.last_zscore AS last_zscore, st.final_category AS final_category
        {body}
        ORDER BY rc.cee_name
        LIMIT %(_length)s OFFSET %(_start)s
    """, dict(params, _start=start, _length=length), as_dict=True)

    children = _child_info(r.cee_name for r in page)
    creches = _creche_info(r.rc_creche for r in page)
    rows = []
    for r in page:
        child = children.get(_key(r.cee_name)) or {}
        row = _with_creche({}, creches, r.rc_creche)
        row.update({"child_id": child.get("child_id"), "child_name": child.get("child_name"),
                    "gender": child.get("gender"), "child_dob": child.get("child_dob")})
        row.update({f: r.get(f) for f in ("first_measurement_date", "first_zscore", "initial_category",
                                          "last_measurement_date", "last_zscore", "final_category")})
        rows.append(row)
    return _response(rows, total, start, length, COHORT_COLUMNS)
