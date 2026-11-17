from datetime import date, timedelta
import calendar

import frappe
from frappe.apf.user_scope import scoped
from frappe.utils import getdate

# Roles permitted to read Review Card data (same list as the Creche Report Card).
# This page is fully self-contained: its three files import nothing from other pages.
ALLOWED_ROLES = {
    "Full Admin",
    "Foundation Central Team",
    "APF State Admin",
    "APF State",
    "APF District",
    "APF Block",
    "APPI Administrator",
    "Partner Administrator",
    "M&E Manager",
    "Program Manager",
    "Accounts and Logistics Manager",
    "Capacity and Building Manager",
    "Cluster Coordinator",
}


def check_report_card_access():
    """Reject guests and any logged-in user without a report card role.

    The data is scoped by the caller's User Geography Mapping, so an
    unauthenticated session has no meaningful scope and must never reach the queries.
    """
    if frappe.session.user == "Guest":
        raise frappe.AuthenticationError("Authentication required.")

    if frappe.session.user == "Administrator":
        return

    if not ALLOWED_ROLES.intersection(frappe.get_roles()):
        raise frappe.PermissionError("You are not permitted to access Review Card data.")


# ---------------------------------------------------------------------------
# Business rules. Everything the review cards treat as a threshold lives here
# so it can be tuned without touching the SQL below.
# ---------------------------------------------------------------------------
OPERATIONAL_STATUS = 3          # Creche Status: Active / Operational
LOW_ENROLMENT_LIMIT = 10        # "Creches with enrolled children 10 or less"
ELIGIBLE_MIN_MONTHS = 6         # same window as the Creche Report Card
ELIGIBLE_MAX_MONTHS = 36
OVERAGE_MONTHS = 36             # "completed 36 months but not exited"
INFANT_MONTHS = 24              # < 24 months -> Infantometer, otherwise Stadiometer
ATT_LOW_PCT = 50                # attendance % below this is "low"
ATT_DAILY_MIN = 10              # average children present per open day below this is "low"
CLOSED_DAYS_MAX = 7             # "closed for more than 7 days" in the month
MISSED_DAYS_MAX = 5             # "not submitted for more than 5 days" in the month

# Malnutrition Management (same flags as the Malnutrition Prevalence report, child wise)
GF_DROP = 0.5                   # z-score fall that makes GF1+ / GF2 / Zig-Zag
NORMAL, MODERATE, SEVERE = 3, 2, 1   # weight_for_age / weight_for_height categories

# Check-In indicators (users are told apart by User.type, as in the Check-in report cadre wise)
SUPERVISOR_TYPE = "Creche Supervisor"
SUP_MIN_CHECKINS = 3            # "fewer than 3 supervisor check-ins in a month"
ENGAGEMENT_MIN_HOURS = 2        # supervisor presence on a day shorter than this is "less engagement"
CHECKIN_WINDOW_MINUTES = 60     # "during opening / closing hours": within this long of the creche's time
# card id prefix -> (User.type, check-ins a user needs in the month)
CADRE_CHECKINS = {
    "cc": ("Cluster Coordinator", 40),
    "tc": ("Capacity and Building Manager", 20),    # the training coordinators
    "mis": ("MIS Manager", 20),
    "sc": ("Safety Coordinator", 20),
    "lc": ("Accounts and Logistics Manager", 20),   # the logistics coordinators
}

# Safety indicators (Safety Indicators audits; the report is safety_status). Answers are links to the
# Yes / No / Not observed / Other master, so they are stored as 1, 2, 3 and 4.
SAFETY_YES, SAFETY_NO = 1, 2
SAFETY_MONTH_DAYS = 30          # one "month" of age in the Safety age filter (1 month = up to 30 days)
SAFETY_MAX_AGE = 7              # age filter 1-6 = that many months, 7 = more than 6 months

# Logistics indicators (reports: lpg_report, fire_extinguisher_status, stock_report, cashbook_report)
LPG_FUEL = "LPG"
LPG_LOW_AFTER_DAYS = 90         # LPG report: supplied more than 90 days ago = 0-1 month of fuel left
REFILL_WAIT_MONTHS = 1          # "awaiting refilling for more than one month"
STOCK_YEAR_OFFSET = 2019        # Year master id of a stock row = year - 2019 (2020 -> 1 ... 2026 -> 7), as in the stock report
NO_WEEK = date(9999, 12, 31)    # week 5 of a month with fewer than 29 days: never due

# A creche counts as "profile submitted" once its Gram Sabha consent form is
# attached (same test the Creche Profile report uses).
PROFILE_NOT_SUBMITTED = "(cr.gram_consent_form IS NULL OR TRIM(cr.gram_consent_form) = '')"

WELCOME_ANTHRO_MISSING = """(
    IFNULL(cee.measurement_taken, 0) = 0
    OR IFNULL(cee.weight, 0) <= 0
    OR IFNULL(cee.height, 0) <= 0
)"""

# weight_exit / height_exit are Float columns, stored as decimals (0 reads back as 0.000000000), so a zero is
# tested as a number; comparing the text of the column with '0' would miss it.
EXIT_ANTHRO_MISSING = """(
    IFNULL(cee.weight_exit, 0) <= 0
    OR IFNULL(cee.height_exit, 0) <= 0
)"""

# Enrolled children per creche, computed once for all creches (one grouped pass)
# instead of a correlated COUNT(*) subquery per creche.
ENROLLED_COUNTS_JOIN = """
    LEFT JOIN (
        SELECT e.creche_id, COUNT(*) AS cnt
        FROM `tabChild Enrollment and Exit` e
        WHERE e.date_of_enrollment <= %(end_date)s
          AND (e.date_of_exit IS NULL OR e.date_of_exit > %(end_date)s)
        GROUP BY e.creche_id
    ) en ON en.creche_id = cr.name
"""

# Creches with at least one household form visited (or, without a visit date,
# created) in the quarter. Plain range tests on the date columns, evaluated once
# for all creches, instead of COALESCE(...) inside a per-creche EXISTS.
HH_VISITED_THIS_QUARTER = """
    LEFT JOIN (
        SELECT DISTINCT hf.creche_id
        FROM `tabHousehold Form` hf
        WHERE IFNULL(hf.is_deleted, 0) = 0
          AND (
              hf.date_of_visit BETWEEN %(quarter_start)s AND %(quarter_end)s
              OR (hf.date_of_visit IS NULL
                  AND hf.app_created_on >= %(quarter_start)s
                  AND hf.app_created_on < %(quarter_end_next)s)
          )
    ) hv ON hv.creche_id = cr.name
"""

ELIGIBLE_CHILD_WHERE = f"""
    hhc.is_dob_available = 1
    AND (hhc.child_status IS NULL OR TRIM(hhc.child_status) = '')
    AND hhc.child_dob BETWEEN DATE_SUB(%(eligible_ref_date)s, INTERVAL {ELIGIBLE_MAX_MONTHS} MONTH)
                          AND DATE_SUB(%(eligible_ref_date)s, INTERVAL {ELIGIBLE_MIN_MONTHS} MONTH)
"""

# Attendance % of one child in the month: days attended / open days, and a child
# with no attendance records counts as 0% (same as average_attendance_child_wise).
CHILD_ATT_PCT = "IFNULL(ROUND(att.days_attended * 100.0 / NULLIF(att.open_days, 0), 2), 0)"

GEO_JOINS = """
    LEFT JOIN `tabPartner` p ON p.name = cr.partner_id
    LEFT JOIN `tabState` s ON s.name = cr.state_id
    LEFT JOIN `tabDistrict` d ON d.name = cr.district_id
    LEFT JOIN `tabBlock` b ON b.name = cr.block_id
    LEFT JOIN `tabGram Panchayat` g ON g.name = cr.gp_id
"""

CRECHE_ID_COLS = 'cr.creche_name AS "Creche"'

AREA_COLS = """
    g.gp_name AS "GP",
    b.block_name AS "Block",
    d.district_name AS "District",
    s.state_name AS "State",
    p.partner_name AS "Partner"
"""

CHILD_FROM = (
    "`tabChild Enrollment and Exit` cee "
    "INNER JOIN `tabCreche` cr ON cr.name = cee.creche_id"
)

ELIGIBLE_FROM = (
    "`tabHousehold Child Form` hhc "
    "INNER JOIN `tabHousehold Form` hf ON hf.name = hhc.parent "
    "INNER JOIN `tabCreche` cr ON cr.name = hf.creche_id"
)


def clean_date(value):
    try:
        return getdate(value) if value else None
    except Exception:
        return None


def months_before(year, month, count):
    """First day of the month `count` months before (year, month)."""
    index = year * 12 + (month - 1) - count
    return date(index // 12, index % 12 + 1, 1)


def cashbook_weeks(year, month):
    """The weeks of the Cashbook report: days 1-7, 8-14, 15-21, 22-28 and 29 to the end of the month."""
    last_day = calendar.monthrange(year, month)[1]
    bounds = [(1, 7), (8, 14), (15, 21), (22, 28), (29, last_day)]
    weeks = {}
    for number, (first, last) in enumerate(bounds, 1):
        exists = first <= last_day
        weeks[f"wk{number}_start"] = date(year, month, first) if exists else NO_WEEK
        weeks[f"wk{number}_end"] = date(year, month, min(last, last_day)) if exists else NO_WEEK
    return weeks


def build_review_params(partner_id=None, state_id=None, district_id=None, gp_id=None, block_id=None, creche_id=None, year=None, month=None, supervisor_id=None, cstart_date=None, cend_date=None, c_status=None, phases=None, sf_age=None, from_date=None, to_date=None):
    """Validate the caller and turn the request filters into SQL parameters."""
    check_report_card_access()

    today = date.today()
    year = int(year) if year and str(year).isdigit() else today.year
    month = int(month) if month and str(month).isdigit() else today.month
    try:
        start_date = date(year, month, 1)
    except ValueError:
        year, month = today.year, today.month
        start_date = date(year, month, 1)
    end_date = date(year, month, calendar.monthrange(year, month)[1])

    # A From-To date range replaces the year and month. start_date / end_date then become the range, which is
    # what every date-based card reads. The cards that work month by month (growth history, quarter comparison,
    # stock, weekly cashbook) read month_start / month_end, the month of the To date, instead.
    range_start, range_end = clean_date(from_date), clean_date(to_date)
    date_range = bool(range_start and range_end and range_start <= range_end)
    if date_range:
        year, month = range_end.year, range_end.month
    month_start = date(year, month, 1)
    month_end = date(year, month, calendar.monthrange(year, month)[1])
    if date_range:
        start_date, end_date = range_start, range_end
    else:
        start_date, end_date = month_start, month_end

    quarter_first_month = 3 * ((month - 1) // 3) + 1
    quarter_last_month = quarter_first_month + 2
    quarter_start = date(year, quarter_first_month, 1)
    quarter_end = date(year, quarter_last_month, calendar.monthrange(year, quarter_last_month)[1])
    quarter_end_next = quarter_end + timedelta(days=1)

    # "As of" date: today while the period is still running, otherwise its last day.
    if date_range:
        eligible_ref_date = min(today, end_date)
    else:
        eligible_ref_date = today if (year, month) == (today.year, today.month) else end_date

    partner_id = partner_id or frappe.db.get_value("User", frappe.session.user, "partner")

    geography = frappe.db.sql(
        """
        SELECT state_id, district_id, block_id, gp_id
        FROM `tabUser Geography Mapping`
        WHERE parent = %s
        ORDER BY state_id, district_id, block_id, gp_id
        """,
        frappe.session.user,
        as_dict=True,
    )
    state_ids = [str(r["state_id"]) for r in geography if r.get("state_id")]
    district_ids = [str(r["district_id"]) for r in geography if r.get("district_id")]
    block_ids = [str(r["block_id"]) for r in geography if r.get("block_id")]
    gp_ids = [str(r["gp_id"]) for r in geography if r.get("gp_id")]

    phases = ",".join(p.strip() for p in phases.split(",") if p.strip().isdigit()) if phases else None

    cadre_params = {}
    for key, (user_type, minimum) in CADRE_CHECKINS.items():
        cadre_params[f"{key}_type"] = user_type
        cadre_params[f"{key}_min"] = minimum

    return {
        "start_date": start_date,
        "end_date": end_date,
        "month_start": month_start,
        "month_end": month_end,
        "year": year,
        "month": month,
        "quarter_start": quarter_start,
        "quarter_end": quarter_end,
        "quarter_end_next": quarter_end_next,
        # Malnutrition Management: the four months before the selected one (growth history),
        # the quarter before the selected quarter, and the last three months
        "m1_start": months_before(year, month, 1),
        "m2_start": months_before(year, month, 2),
        "m3_start": months_before(year, month, 3),
        "m4_start": months_before(year, month, 4),
        "zz_enroll_cutoff": months_before(year, month, 3) - timedelta(days=1),
        "prev_quarter_start": months_before(year, quarter_first_month, 3),
        "prev_quarter_end": quarter_start - timedelta(days=1),
        "last3_start": months_before(year, month, 2),
        # Check-In indicators
        "sup_type": SUPERVISOR_TYPE,
        "sup_min_checkins": SUP_MIN_CHECKINS,
        "engage_min_seconds": ENGAGEMENT_MIN_HOURS * 3600,
        "window_seconds": CHECKIN_WINDOW_MINUTES * 60,
        **cadre_params,
        # Safety and Logistics: "as of" date (today for the current month, otherwise month end),
        # the age bucket asked for on the Safety age cards (1-6 months, 7 = more than 6), the Year master id of
        # the stock rows and the weeks of the cashbook (a week is due once it is over, see add_logistics_sources)
        "ref_date": eligible_ref_date,
        "sf_age": int(sf_age) if sf_age and str(sf_age).isdigit() and 1 <= int(sf_age) <= SAFETY_MAX_AGE else None,
        "stock_year_id": year - STOCK_YEAR_OFFSET,
        "cb_cutoff": month_end + timedelta(days=1) if (year, month) < (today.year, today.month) else today,
        **cashbook_weeks(year, month),
        "eligible_ref_date": eligible_ref_date,
        "low_limit": LOW_ENROLMENT_LIMIT,
        "att_ref_date": eligible_ref_date,
        "att_low_pct": ATT_LOW_PCT,
        "att_daily_min": ATT_DAILY_MIN,
        "closed_days_max": CLOSED_DAYS_MAX,
        "missed_days_max": MISSED_DAYS_MAX,
        "partner_id": partner_id or None,
        "state_id": state_id or None,
        "state_ids": ",".join(state_ids) if state_ids else None,
        "district_id": district_id or None,
        "district_ids": ",".join(district_ids) if district_ids else None,
        "block_id": block_id or None,
        "block_ids": ",".join(block_ids) if block_ids else None,
        "gp_id": gp_id or None,
        "gp_ids": ",".join(gp_ids) if gp_ids else None,
        "creche_id": creche_id or None,
        "supervisor_id": supervisor_id or None,
        "cstart_date": clean_date(cstart_date),
        "cend_date": clean_date(cend_date),
        "c_status": c_status if str(c_status) in ("1", "2", "3", "4") else None,
        "phases": phases or None,
    }


def _in_list(column, values):
    return f"{column} IN ({', '.join(frappe.db.escape(v) for v in dict.fromkeys(values))})"


def creche_scope(params, a="cr"):
    """The filter block every Creche Report Card query repeats, for one alias.

    Only the filters that are actually set are written into the SQL, so MySQL
    can use the indexes on the creche columns instead of evaluating
    "(param IS NULL OR column = param)" for every row.

    Planned creches (status 1) have no opening date, so they bypass the
    opening-date rules; a blank status filter therefore returns every status
    instead of nothing.
    """
    conditions = []

    if params["partner_id"]:
        conditions.append(f"{a}.partner_id = %(partner_id)s")

    # An explicit filter wins; otherwise fall back to the user's geography mapping.
    for level in ("state", "district", "block", "gp"):
        column = f"{a}.{level}_id"
        if params[f"{level}_id"]:
            conditions.append(f"{column} = %({level}_id)s")
        elif params[f"{level}_ids"]:
            conditions.append(_in_list(column, params[f"{level}_ids"].split(",")))

    if params["supervisor_id"]:
        conditions.append(f"{a}.supervisor_id = %(supervisor_id)s")
    if params["creche_id"]:
        conditions.append(f"{a}.name = %(creche_id)s")
    if params["c_status"]:
        conditions.append(f"{a}.creche_status_id = %(c_status)s")
    if params["phases"]:
        # digits only (validated in build_review_params)
        conditions.append(f"{a}.phase IN ({params['phases']})")

    opening_rules = [f"({a}.creche_opening_date IS NULL OR {a}.creche_opening_date <= %(end_date)s)"]
    if params["cstart_date"] and params["cend_date"]:
        opening_rules.append(f"{a}.creche_opening_date BETWEEN %(cstart_date)s AND %(cend_date)s")
    opening = " AND ".join(opening_rules)

    if params["c_status"] == "1":
        pass
    elif params["c_status"]:
        conditions.append(opening)
    else:
        conditions.append(f"({a}.creche_status_id = 1 OR ({opening}))")

    return " AND ".join(conditions)


def operational_scope(params, a="cr"):
    """Creches the cards report on: the creche filters plus the status.

    A status picked in the filter (Planned, Closed, ...) already sits in
    creche_scope, so the Active/Operational default is added only when no
    status was picked. Adding both would ask for two statuses at once.
    """
    scope = creche_scope(params, a)
    if params["c_status"]:
        return scope
    return f"{a}.creche_status_id = {OPERATIONAL_STATUS} AND {scope}"


def is_infant(ref):
    return f"cee.child_dob > DATE_SUB({ref}, INTERVAL {INFANT_MONTHS} MONTH)"


def wrong_equipment(ref, equipment_col):
    """Infantometer (2) is only right under 24 months, Stadiometer (1) from 24 months."""
    infant = is_infant(ref)
    return f"(({infant} AND {equipment_col} = 1) OR (NOT ({infant}) AND {equipment_col} = 2))"


WELCOME_REF = "COALESCE(cee.measurement_date, cee.date_of_enrollment)"
EXIT_REF = "cee.date_of_exit"


# ---------------------------------------------------------------------------
# Malnutrition Management and Check-In
#
# The FROM / WHERE of the 20 cards of the Malnutrition Management tab. The
# growth rules (GF1, GF2, Zig-Zag, SAM, SUW) are the ones of the Malnutrition
# Prevalence report (child wise), laid out the way the Creche Report Card
# reads them: one row per child (`c`, the latest measurement of the month)
# and one row per child with the z-scores of the four months before (`h`).
# The check-in rules follow the Check-in reports (cadre wise / individual).
# ---------------------------------------------------------------------------
IN_MONTH = (
    "cee.date_of_enrollment <= %(month_end)s "
    "AND (cee.date_of_exit IS NULL OR cee.date_of_exit > %(month_start)s)"
)

GF1_REF = "COALESCE(h.m1, h.m2)"        # previous month, else 2 months back
GF2_REF = "COALESCE(h.m2, h.m3)"        # 2 months back, else 3 months back
ZZ_MAX = "GREATEST(h.m1, h.m2, h.m3, h.m4)"

# Growth faltering of the selected month ...
GF1_NOW = f"(c.waz IS NOT NULL AND {GF1_REF} - c.waz > 0)"
GF1_PLUS_NOW = f"(c.waz IS NOT NULL AND {GF1_REF} - c.waz >= {GF_DROP})"   # GF1 with a fall of 0.5 or more
GF2_NOW = f"(c.waz IS NOT NULL AND c.waz - {GF2_REF} <= -{GF_DROP})"
ZIGZAG_NOW = (
    "(c.waz IS NOT NULL AND h.m1 IS NOT NULL AND h.m2 IS NOT NULL AND h.m3 IS NOT NULL AND h.m4 IS NOT NULL"
    f" AND cee.date_of_enrollment <= %(zz_enroll_cutoff)s AND c.waz - {ZZ_MAX} <= -{GF_DROP})"
)
# ... and of the month before it: that month is `h.m1`, and its own history starts at `h.m2`.
GF1_PREV = "(h.m1 IS NOT NULL AND COALESCE(h.m2, h.m3) - h.m1 > 0)"
GF2_PREV = f"(h.m1 IS NOT NULL AND h.m1 - COALESCE(h.m3, h.m4) <= -{GF_DROP})"


# Zig-Zag as the report counts it inside SNC: the z-score also rose and fell along the way.
ZZ_ALTERNATES = (
    "(c.waz > h.m1 OR h.m1 > h.m2 OR h.m2 > h.m3 OR h.m3 > h.m4)"
    " AND (c.waz < h.m1 OR h.m1 < h.m2 OR h.m2 < h.m3 OR h.m3 < h.m4)"
)
ZIGZAG_PATTERN_NOW = f"({ZIGZAG_NOW} AND {ZZ_ALTERNATES})"

# SNC: any growth faltering (GF1; GF1+ is a subset of it), GF2, Zig-Zag, or a severe weight-for-height / weight-for-age.
SNC_NOW = (
    f"({GF1_NOW} OR {GF2_NOW} OR {ZIGZAG_PATTERN_NOW} "
    f"OR c.weight_for_age = {SEVERE} OR c.weight_for_height = {SEVERE})"
)


def flag(condition):
    """1 / 0, never NULL, so a flag can be negated safely."""
    return f"COALESCE({condition}, 0)"


# ---- plausibility of the measurements (WHO limits, as in the Malnutrition Prevalence report) ----
# Lowest and highest plausible value by age in months (-4 SD to +3 SD); weight in kg, height in cm.
WHO_WEIGHT_BOYS = {
    6:  (5.1, 11.0),  7:  (5.4, 11.4),  8:  (5.6, 11.9),  9:  (5.8, 12.3),
    10: (5.9, 12.7),  11: (6.1, 13.0),  12: (6.2, 13.3),  13: (6.3, 13.7),
    14: (6.5, 14.0),  15: (6.6, 14.3),  16: (6.7, 14.6),  17: (6.8, 14.9),
    18: (6.9, 15.1),  19: (7.1, 15.4),  20: (7.2, 15.7),  21: (7.3, 16.0),
    22: (7.4, 16.2),  23: (7.6, 16.5),  24: (7.7, 16.8),  25: (7.8, 17.1),
    26: (7.9, 17.3),  27: (8.0, 17.6),  28: (8.1, 17.9),  29: (8.2, 18.2),
    30: (8.3, 18.4),  31: (8.4, 18.7),  32: (8.5, 19.0),  33: (8.6, 19.3),
    34: (8.7, 19.6),  35: (8.8, 19.8),  36: (8.9, 20.1),
}
WHO_WEIGHT_GIRLS = {
    6:  (4.5, 10.2),  7:  (4.7, 10.6),  8:  (4.9, 11.1),  9:  (5.0, 11.4),
    10: (5.2, 11.8),  11: (5.3, 12.2),  12: (5.4, 12.5),  13: (5.6, 12.8),
    14: (5.7, 13.1),  15: (5.8, 13.4),  16: (5.9, 13.7),  17: (6.0, 14.0),
    18: (6.1, 14.3),  19: (6.2, 14.6),  20: (6.3, 14.9),  21: (6.5, 15.2),
    22: (6.6, 15.5),  23: (6.7, 15.8),  24: (6.8, 16.1),  25: (6.9, 16.4),
    26: (7.0, 16.7),  27: (7.1, 17.0),  28: (7.2, 17.3),  29: (7.3, 17.6),
    30: (7.4, 17.9),  31: (7.5, 18.2),  32: (7.6, 18.5),  33: (7.7, 18.8),
    34: (7.8, 19.1),  35: (7.9, 19.4),  36: (8.0, 19.7),
}
WHO_HEIGHT_BOYS = {
    6:  (60.4, 75.4),  7:  (61.7, 77.1),  8:  (63.0, 78.7),  9:  (64.3, 80.3),
    10: (65.4, 81.7),  11: (66.5, 83.2),  12: (67.6, 84.5),  13: (68.6, 85.9),
    14: (69.6, 87.1),  15: (70.6, 88.4),  16: (71.6, 89.6),  17: (72.5, 90.8),
    18: (73.4, 92.0),  19: (74.3, 93.1),  20: (75.2, 94.2),  21: (76.0, 95.3),
    22: (76.8, 96.4),  23: (77.7, 97.4),  24: (78.0, 97.7),  25: (78.6, 98.7),
    26: (79.3, 99.6),  27: (79.9, 100.5), 28: (80.5, 101.4), 29: (81.1, 102.3),
    30: (81.7, 103.1), 31: (82.3, 104.0), 32: (82.8, 104.8), 33: (83.4, 105.6),
    34: (83.9, 106.4), 35: (84.4, 107.2), 36: (85.0, 108.0),
}
WHO_HEIGHT_GIRLS = {
    6:  (58.6, 73.5),  7:  (59.9, 75.3),  8:  (61.2, 76.9),  9:  (62.5, 78.5),
    10: (63.7, 80.0),  11: (64.9, 81.5),  12: (66.0, 82.9),  13: (67.0, 84.3),
    14: (68.0, 85.7),  15: (69.0, 87.0),  16: (70.0, 88.2),  17: (70.9, 89.4),
    18: (71.8, 90.7),  19: (72.8, 91.9),  20: (73.7, 93.1),  21: (74.5, 94.2),
    22: (75.2, 95.4),  23: (76.0, 96.5),  24: (76.0, 96.9),  25: (76.8, 98.0),
    26: (77.5, 99.0),  27: (78.1, 100.1), 28: (78.8, 101.1), 29: (79.5, 102.0),
    30: (80.1, 103.0), 31: (80.7, 103.9), 32: (81.3, 104.9), 33: (81.9, 105.8),
    34: (82.5, 106.7), 35: (83.1, 107.5), 36: (83.6, 108.4),
}


def who_ranges_sql():
    """The four WHO tables as one derived table: gender (1 boy, 2 girl), age, weight and height limits."""
    rows = []
    for gender, weights, heights in ((1, WHO_WEIGHT_BOYS, WHO_HEIGHT_BOYS), (2, WHO_WEIGHT_GIRLS, WHO_HEIGHT_GIRLS)):
        for age, (w_low, w_high) in weights.items():
            h_low, h_high = heights[age]
            rows.append(f"SELECT {gender} AS g, {age} AS age, {w_low} AS wmin, {w_high} AS wmax, {h_low} AS hmin, {h_high} AS hmax")
    return " UNION ALL ".join(rows)


# The age the report checks with: months at the end of the selected month (today for the current month),
# a part month counting as a whole one. Gender 1 is a boy; any other value uses the girls' limits, as the report does.
CURRENT_AGE = (
    "(TIMESTAMPDIFF(MONTH, cee.child_dob, %(eligible_ref_date)s) + "
    "IF(DATE_ADD(cee.child_dob, INTERVAL TIMESTAMPDIFF(MONTH, cee.child_dob, %(eligible_ref_date)s) MONTH) "
    "< %(eligible_ref_date)s, 1, 0))"
)
WHO_JOIN = f"LEFT JOIN ({who_ranges_sql()}) who ON who.g = IF(cee.gender_id = 1, 1, 2) AND who.age = {CURRENT_AGE}"
# Both the weight and the height are outside the plausible range. Only ages 6-36 months have limits.
IMPLAUSIBLE = (
    "(c.weight > 0 AND c.height > 0 AND who.age IS NOT NULL "
    "AND (c.weight < who.wmin OR c.weight > who.wmax) AND (c.height < who.hmin OR c.height > who.hmax))"
)


# Children to be referred: GF2, Zig-Zag, SAM (severe wasting), SUW (severe underweight) or an illness.
TO_REFER = (
    f"({flag(GF2_NOW)} = 1 OR {flag(ZIGZAG_NOW)} = 1 "
    f"OR c.weight_for_height = {SEVERE} OR c.weight_for_age = {SEVERE} "
    "OR ill.childenrollguid IS NOT NULL)"
)


def creche_names_in_scope(params, operational=False):
    """Subquery of the creches the filters allow, to keep the big tables to the current selection."""
    scope = operational_scope(params, "cr2") if operational else creche_scope(params, "cr2")
    return f"SELECT cr2.name FROM `tabCreche` cr2 WHERE {scope}"


def month_measurement_join(params):
    """`c`: each child's latest height/weight measurement of the selected month."""
    return f"""
        LEFT JOIN (
            SELECT ranked.childenrollguid, ranked.weight_for_age, ranked.weight_for_height, ranked.height_for_age, ranked.waz,
                   ranked.whz, ranked.weight, ranked.height, ranked.measurement_equipment, ranked.measured_on
            FROM (
                SELECT ad.childenrollguid, ad.weight_for_age, ad.weight_for_height, ad.height_for_age,
                       CAST(ad.weight_for_age_zscore AS DECIMAL(10,4)) AS waz,
                       ad.weight_for_height_zscore AS whz, ad.weight, ad.height, ad.measurement_equipment,
                       COALESCE(ad.measurement_taken_date, cg.measurement_date) AS measured_on,
                       ROW_NUMBER() OVER (
                           PARTITION BY ad.childenrollguid
                           ORDER BY cg.measurement_date DESC, ad.modified DESC, ad.name DESC
                       ) AS rn
                FROM `tabChild Growth Monitoring` cg
                INNER JOIN `tabAnthropromatic Data` ad ON ad.parent = cg.name
                WHERE cg.measurement_date BETWEEN %(month_start)s AND %(month_end)s
                  AND ad.do_you_have_height_weight = 1
                  AND cg.creche_id IN ({creche_names_in_scope(params)})
            ) ranked
            WHERE ranked.rn = 1
        ) c ON c.childenrollguid = cee.childenrollguid
    """


def history_join(params):
    """`h`: each child's weight-for-age z-score in the four months before the selected one (m1 = last month)."""
    z = "CAST(hist.weight_for_age_zscore AS DECIMAL(10,4))"
    return f"""
        LEFT JOIN (
            SELECT hist.childenrollguid,
                   MAX(CASE WHEN hist.measurement_taken_date >= %(m1_start)s THEN {z} END) AS m1,
                   MAX(CASE WHEN hist.measurement_taken_date >= %(m2_start)s
                             AND hist.measurement_taken_date < %(m1_start)s THEN {z} END) AS m2,
                   MAX(CASE WHEN hist.measurement_taken_date >= %(m3_start)s
                             AND hist.measurement_taken_date < %(m2_start)s THEN {z} END) AS m3,
                   MAX(CASE WHEN hist.measurement_taken_date < %(m3_start)s THEN {z} END) AS m4
            FROM `tabAnthropromatic Data` hist
            WHERE hist.do_you_have_height_weight = 1
              AND hist.weight_for_age_zscore IS NOT NULL
              AND hist.measurement_taken_date >= %(m4_start)s
              AND hist.measurement_taken_date < %(month_start)s
              AND hist.childenrollguid IN (
                  SELECT ce.childenrollguid FROM `tabChild Enrollment and Exit` ce
                  WHERE ce.creche_id IN ({creche_names_in_scope(params)})
              )
            GROUP BY hist.childenrollguid
        ) h ON h.childenrollguid = cee.childenrollguid
    """


def illness_join(params):
    """`ill`: children with a medical complication / major illness recorded at this month's growth monitoring."""
    return f"""
        LEFT JOIN (
            SELECT DISTINCT ad.childenrollguid
            FROM `tabChild Growth Monitoring` cg
            INNER JOIN `tabAnthropromatic Data` ad ON ad.parent = cg.name
            WHERE cg.measurement_date BETWEEN %(month_start)s AND %(month_end)s
              AND ad.any_medical_major_illness = 1
              AND cg.creche_id IN ({creche_names_in_scope(params)})
        ) ill ON ill.childenrollguid = cee.childenrollguid
    """


# `rf`: children with a referral in the month (Child Referral, any facility, as the report's referral columns).
REFERRED_JOIN = """
    LEFT JOIN (
        SELECT DISTINCT cf.childenrolledguid
        FROM `tabChild Referral` cf
        WHERE cf.date_of_referral BETWEEN %(month_start)s AND %(month_end)s
    ) rf ON rf.childenrolledguid = cee.childenrollguid
"""

# `nr`: children admitted to an NRC in the month.
NRC_ADMITTED_JOIN = """
    LEFT JOIN (
        SELECT DISTINCT na.childenrollguid
        FROM `tabNRC Admission and Discharge` na
        INNER JOIN `tabYesNo` yn ON yn.name = na.child_admitted_to_nrc
        WHERE yn.option_name = 'Yes'
          AND na.date_of_admission BETWEEN %(month_start)s AND %(month_end)s
    ) nr ON nr.childenrollguid = cee.childenrollguid
"""


def quarter_status_join(params):
    """`qs`: each child's weight-for-age / weight-for-height category at the latest measurement of the
    previous and of the selected calendar quarter (3 normal, 2 moderate, 1 severe)."""
    def latest(column, start, end):
        return (
            "CAST(SUBSTRING_INDEX(GROUP_CONCAT("
            f"CASE WHEN ad.measurement_taken_date BETWEEN {start} AND {end} "
            f"AND ad.{column} IN ({SEVERE}, {MODERATE}, {NORMAL}) THEN CAST(ad.{column} AS SIGNED) END "
            "ORDER BY ad.measurement_taken_date DESC, ad.name DESC), ',', 1) AS SIGNED)"
        )

    prev = ("%(prev_quarter_start)s", "%(prev_quarter_end)s")
    cur = ("%(quarter_start)s", "%(quarter_end)s")
    return f"""
        LEFT JOIN (
            SELECT ad.childenrollguid,
                   {latest('weight_for_age', *prev)} AS waz_prev,
                   {latest('weight_for_age', *cur)} AS waz_cur,
                   {latest('weight_for_height', *prev)} AS whz_prev,
                   {latest('weight_for_height', *cur)} AS whz_cur
            FROM `tabAnthropromatic Data` ad
            INNER JOIN `tabChild Growth Monitoring` cg ON cg.name = ad.parent
            WHERE ad.do_you_have_height_weight = 1
              AND ad.measurement_taken_date BETWEEN %(prev_quarter_start)s AND %(quarter_end)s
              AND cg.creche_id IN ({creche_names_in_scope(params)})
            GROUP BY ad.childenrollguid
        ) qs ON qs.childenrollguid = cee.childenrollguid
    """


def last_three_months_join(params):
    """`l3`: severe wasting (SAM) and severe underweight (SUW) measurements of each child in the last 3 months."""
    return f"""
        LEFT JOIN (
            SELECT ad.childenrollguid,
                   SUM(CASE WHEN ad.weight_for_height = {SEVERE} THEN 1 ELSE 0 END) AS sam_n,
                   MAX(CASE WHEN ad.weight_for_height = {SEVERE} THEN ad.measurement_taken_date END) AS sam_last,
                   SUM(CASE WHEN ad.weight_for_age = {SEVERE} THEN 1 ELSE 0 END) AS suw_n,
                   MAX(CASE WHEN ad.weight_for_age = {SEVERE} THEN ad.measurement_taken_date END) AS suw_last
            FROM `tabAnthropromatic Data` ad
            INNER JOIN `tabChild Growth Monitoring` cg ON cg.name = ad.parent
            WHERE ad.do_you_have_height_weight = 1
              AND ad.measurement_taken_date BETWEEN %(last3_start)s AND %(month_end)s
              AND cg.creche_id IN ({creche_names_in_scope(params)})
            GROUP BY ad.childenrollguid
        ) l3 ON l3.childenrollguid = cee.childenrollguid
    """


def supervisor_checkin_join(params):
    """`sci`: per creche, the month's check-ins by creche supervisors and how many of them fall within
    the check-in window of the creche's opening time / closing time. `last_visit` is the date and time
    ('YYYY-MM-DD HH:MM:SS') of the latest of those check-ins."""
    clock = "TIME(chi.appcreated_on)"
    window = "SEC_TO_TIME(%(window_seconds)s)"
    return f"""
        LEFT JOIN (
            SELECT chi.creche_id,
                   COUNT(*) AS sup_checkins,
                   MAX(CONCAT(chi.date_of_checkin, ' ', {clock})) AS last_visit,
                   SUM(CASE WHEN {clock} BETWEEN SUBTIME(c2.creche_openning_time, {window})
                                             AND ADDTIME(c2.creche_openning_time, {window}) THEN 1 ELSE 0 END) AS open_hits,
                   SUM(CASE WHEN {clock} BETWEEN SUBTIME(c2.creche_closing_time, {window})
                                             AND ADDTIME(c2.creche_closing_time, {window}) THEN 1 ELSE 0 END) AS close_hits
            FROM `tabCreche Check In` chi
            INNER JOIN `tabUser` tu ON tu.name = chi.appcreated_by AND tu.type = %(sup_type)s
            INNER JOIN `tabCreche` c2 ON c2.name = chi.creche_id
            WHERE chi.date_of_checkin BETWEEN %(start_date)s AND %(end_date)s
              AND chi.creche_id IN ({creche_names_in_scope(params, operational=True)})
            GROUP BY chi.creche_id
        ) sci ON sci.creche_id = cr.name
    """


# How long a supervisor stayed at a creche on a day. Creche Check In holds no check-out, so this is the
# time between the first and the last supervisor check-in of the day at that creche (`dd`).
ENGAGEMENT_SECONDS = "TIME_TO_SEC(TIMEDIFF(dd.last_time, dd.first_time))"


def short_engagement_source(params):
    return {
        "from": f"""
            `tabCreche Check In` chi
            INNER JOIN `tabUser` tu ON tu.name = chi.appcreated_by AND tu.type = %(sup_type)s
            INNER JOIN `tabCreche` cr ON cr.name = chi.creche_id
            INNER JOIN (
                SELECT chd.creche_id, chd.appcreated_by, chd.date_of_checkin,
                       MIN(TIME(chd.appcreated_on)) AS first_time, MAX(TIME(chd.appcreated_on)) AS last_time
                FROM `tabCreche Check In` chd
                INNER JOIN `tabUser` tud ON tud.name = chd.appcreated_by AND tud.type = %(sup_type)s
                WHERE chd.date_of_checkin BETWEEN %(start_date)s AND %(end_date)s
                  AND chd.creche_id IN ({creche_names_in_scope(params, operational=True)})
                GROUP BY chd.creche_id, chd.appcreated_by, chd.date_of_checkin
            ) dd ON dd.creche_id = chi.creche_id
                AND dd.appcreated_by = chi.appcreated_by
                AND dd.date_of_checkin = chi.date_of_checkin
        """,
        "where": (
            "chi.date_of_checkin BETWEEN %(start_date)s AND %(end_date)s "
            f"AND {operational_scope(params, 'cr')} "
            f"AND {ENGAGEMENT_SECONDS} < %(engage_min_seconds)s"
        ),
    }


def cadre_scope(params, a="u"):
    """Active staff of the selection, found the way the HR dashboard counts them:
    by partner and by the states / districts / blocks they are mapped to."""
    conditions = [
        f"{a}.enabled = 1",
        f"({a}.date_of_joining IS NULL OR {a}.date_of_joining <= %(end_date)s)",
    ]
    if params["partner_id"]:
        conditions.append(f"{a}.partner = %(partner_id)s")

    geography = []
    for level in ("state", "district", "block"):
        column = f"ugm.{level}_id"
        if params[f"{level}_id"]:
            geography.append(f"{column} = %({level}_id)s")
        elif params[f"{level}_ids"]:
            geography.append(_in_list(column, params[f"{level}_ids"].split(",")))
    if geography:
        conditions.append(
            "EXISTS (SELECT 1 FROM `tabUser Geography Mapping` ugm "
            f"WHERE ugm.parent = {a}.name AND {' AND '.join(geography)})"
        )
    return " AND ".join(conditions)


# `uc`: each user's check-ins in the month, whichever creche they were made at.
CADRE_FROM = """
    `tabUser` u
    LEFT JOIN (
        SELECT chu.appcreated_by AS user_id, COUNT(*) AS checkins
        FROM `tabCreche Check In` chu
        WHERE chu.date_of_checkin BETWEEN %(start_date)s AND %(end_date)s
        GROUP BY chu.appcreated_by
    ) uc ON uc.user_id = u.name
"""


def add_group(sources, name, from_sql, base_where, cases):
    """Register cards that share one FROM / base WHERE.

    `cases` maps a card id to the condition that picks its rows, so the cards of a group are counted in
    one pass (see count_cases) while each one still has its own FROM / WHERE for the drill-down.
    """
    sources.setdefault("groups", {})[name] = {"from": from_sql, "where": base_where, "cases": cases}
    for card_id, condition in cases.items():
        sources[card_id] = {"from": from_sql, "where": f"{base_where} AND ({condition})"}


def add_malnutrition_sources(sources, params, scope):
    month_children = f"{IN_MONTH} AND {scope}"

    # To be referred -> referred -> admitted to NRC. The last two only count children of the first.
    add_group(
        sources, "mm_referral",
        f"{CHILD_FROM} {month_measurement_join(params)} {history_join(params)} {illness_join(params)} "
        f"{REFERRED_JOIN} {NRC_ADMITTED_JOIN}",
        month_children,
        {
            "mm_to_refer": TO_REFER,
            "mm_referred": f"{TO_REFER} AND rf.childenrolledguid IS NOT NULL",
            "mm_nrc_admitted": f"{TO_REFER} AND nr.childenrollguid IS NOT NULL",
        },
    )

    # Category changes between the previous and the selected quarter.
    add_group(
        sources, "mm_quarter",
        f"{CHILD_FROM} {quarter_status_join(params)}",
        scope,
        {
            "mm_uw_worse": f"qs.waz_prev = {NORMAL} AND qs.waz_cur IN ({MODERATE}, {SEVERE})",
            "mm_wasting_worse": f"qs.whz_prev = {NORMAL} AND qs.whz_cur IN ({MODERATE}, {SEVERE})",
            "mm_uw_better": f"qs.waz_prev = {SEVERE} AND qs.waz_cur IN ({NORMAL}, {MODERATE})",
            "mm_wasting_better": f"qs.whz_prev = {SEVERE} AND qs.whz_cur IN ({NORMAL}, {MODERATE})",
        },
    )

    # GF1 / GF2 of the previous month against the selected month; a child that is both is counted as GF2.
    add_group(
        sources, "mm_gf",
        f"{CHILD_FROM} {month_measurement_join(params)} {history_join(params)}",
        month_children,
        {
            "mm_gf1_to_gf2": f"{flag(GF1_PREV)} = 1 AND {flag(GF2_PREV)} = 0 AND {flag(GF2_NOW)} = 1",
            "mm_gf2_to_gf1": f"{flag(GF2_PREV)} = 1 AND {flag(GF1_NOW)} = 1 AND {flag(GF2_NOW)} = 0",
        },
    )

    # SAM / SUW at any measurement in the last 3 months (the selected month and the two before it).
    add_group(
        sources, "mm_last3",
        f"{CHILD_FROM} {last_three_months_join(params)}",
        (
            "cee.date_of_enrollment <= %(month_end)s "
            f"AND (cee.date_of_exit IS NULL OR cee.date_of_exit >= %(last3_start)s) AND {scope}"
        ),
        {
            "mm_sam_3m": "IFNULL(l3.sam_n, 0) > 0",
            "mm_suw_3m": "IFNULL(l3.suw_n, 0) > 0",
        },
    )


def coverage_join(params):
    """`cov`: per creche, the children enrolled at any time in the month and how many of them have a
    measurement taken in a growth monitoring entry dated in the month (as the Creche Report Card counts it)."""
    return f"""
        LEFT JOIN (
            SELECT cee.creche_id, COUNT(*) AS enrolled, COUNT(mt.childenrollguid) AS measured
            FROM `tabChild Enrollment and Exit` cee
            LEFT JOIN (
                SELECT ad.childenrollguid
                FROM `tabChild Growth Monitoring` cg
                INNER JOIN `tabAnthropromatic Data` ad ON ad.parent = cg.name
                WHERE cg.measurement_date BETWEEN %(month_start)s AND %(month_end)s
                  AND ad.do_you_have_height_weight = 1
                GROUP BY ad.childenrollguid
            ) mt ON mt.childenrollguid = cee.childenrollguid
            WHERE {IN_MONTH} AND cee.creche_id IN ({creche_names_in_scope(params)})
            GROUP BY cee.creche_id
        ) cov ON cov.creche_id = cr.name
    """


def growth_monitoring_join(params):
    """`gm`: creches with a growth monitoring entry dated in the month."""
    return f"""
        LEFT JOIN (
            SELECT DISTINCT cg.creche_id
            FROM `tabChild Growth Monitoring` cg
            WHERE cg.measurement_date BETWEEN %(month_start)s AND %(month_end)s
              AND cg.creche_id IN ({creche_names_in_scope(params)})
        ) gm ON gm.creche_id = cr.name
    """


def add_prevalence_sources(sources, params, scope, operational):
    month_children = f"{IN_MONTH} AND {scope}"

    add_group(
        sources, "mp_creche",
        f"`tabCreche` cr {coverage_join(params)} {growth_monitoring_join(params)}",
        operational,
        {
            "mp_measure_below_100": "cov.enrolled > 0 AND cov.measured < cov.enrolled",
            "mp_not_submitted": "gm.creche_id IS NULL",
        },
    )

    # Creches count once however many of their children were measured with the wrong equipment;
    # the rows are the children (see prevalence_wrong_equipment_item).
    sources["mp_wrong_equipment"] = {
        "from": f"{CHILD_FROM} {month_measurement_join(params)}",
        "where": f"{month_children} AND {wrong_equipment('c.measured_on', 'c.measurement_equipment')}",
    }

    # Children measured in the month, flagged on their latest measurement: one pass for all seven cards.
    add_group(
        sources, "mp_flags",
        f"{CHILD_FROM} {month_measurement_join(params)} {history_join(params)} {illness_join(params)} {WHO_JOIN}",
        month_children,
        {
            "mp_snc": SNC_NOW,
            "mp_sam": f"c.weight_for_height = {SEVERE}",
            "mp_suw": f"c.weight_for_age = {SEVERE}",
            "mp_gf2": f"{flag(GF2_NOW)} = 1",
            "mp_zigzag": f"{flag(ZIGZAG_NOW)} = 1",
            "mp_to_refer": TO_REFER,
            "mp_implausible": IMPLAUSIBLE,
        },
    )


def add_checkin_sources(sources, params, operational):
    add_group(
        sources, "ci_creche",
        f"`tabCreche` cr {supervisor_checkin_join(params)}",
        operational,
        {
            "ci_sup_lt3": "IFNULL(sci.sup_checkins, 0) < %(sup_min_checkins)s",
            "ci_sup_none": "IFNULL(sci.sup_checkins, 0) = 0",
            "ci_not_opening": "cr.creche_openning_time IS NOT NULL AND IFNULL(sci.open_hits, 0) = 0",
            "ci_not_closing": "cr.creche_closing_time IS NOT NULL AND IFNULL(sci.close_hits, 0) = 0",
        },
    )

    sources["ci_short_engagement"] = short_engagement_source(params)

    user_types = ", ".join(f"%({key}_type)s" for key in CADRE_CHECKINS)
    add_group(
        sources, "ci_cadre",
        CADRE_FROM,
        f"u.type IN ({user_types}) AND {cadre_scope(params)}",
        {
            f"ci_{key}_low": f"u.type = %({key}_type)s AND IFNULL(uc.checkins, 0) < %({key}_min)s"
            for key in CADRE_CHECKINS
        },
    )


# ---------------------------------------------------------------------------
# Safety
#
# The questions and the answers that count as an issue follow the Safety Indicators report
# (safety_status): Yes is the safe answer to every question but the well one, where Yes is the
# issue. "Not observed" and "Other" are not issues. Each question is
# (field, the answer that is an issue, the issue as it is shown, the question that must be Yes for it to apply).
# ---------------------------------------------------------------------------
SAFETY_WELL = "is_any_welltube_well_within_20_m_radius_of_the_creche"

SAFETY_CATEGORIES = {
    "sf_infra": ("Infrastructural & Environmental Safety", [
        ("is_the_structural_safety_of_the_creches_roof_and_walls_ensured", SAFETY_NO, "Structural safety of the roof and walls not ensured", None),
        ("is_the_creche_protected_from_rainwater_leakage", SAFETY_NO, "Creche not protected from rainwater leakage", None),
        (SAFETY_WELL, SAFETY_YES, "Well / tube well within 20 m of the creche", None),
        ("properly_covered_with_iron_net_inside_out_side", SAFETY_NO, "Well / tube well not covered with an iron net", SAFETY_WELL),
        ("are_sharp_edge_cutters_or_machinery_kept_away_from_the_creche", SAFETY_NO, "Sharp edge cutters or machinery not kept away from the creche", None),
    ]),
    "sf_physical": ("Physical Safety & Security", [
        ("external_fencing_around", SAFETY_NO, "No external fencing around the creche", None),
        ("safety_the_main_entrance", SAFETY_NO, "No safety gate at the main entrance", None),
        ("safety_gate_kitchen_entrance", SAFETY_NO, "No safety gate at the kitchen entrance", None),
        ("creche_secured_against_animals", SAFETY_NO, "Creche not secured against poisonous and domestic animals", None),
        ("parents_recorded_visitor_register", SAFETY_NO, "Entry of persons other than parents not recorded in the visitor register", None),
    ]),
    "sf_fire": ("Fire Safety", [
        ("positioned_above_cylinder_height", SAFETY_NO, "Gas stove slab / table not positioned above cylinder height", None),
        ("fire_extinguisher_available_working_condition", SAFETY_NO, "Fire extinguisher not available or not in working condition", None),
        ("kitchen_fire_related_emergencies", SAFETY_NO, "No fire blankets and fire buckets in the kitchen", None),
        ("confident_handling_pressure_cooker", SAFETY_NO, "Caregiver not confident in handling a pressure cooker", None),
    ]),
    "sf_electrical": ("Electrical Safety", [
        ("electrical_connections_positioned_out_children_reach", SAFETY_NO, "Electrical connections within reach of children", None),
        ("fans_and_lights_installed_safe_location_height", SAFETY_NO, "Fans and lights not at a safe location and height", None),
        ("solar_batteries_kept_out_children_reach", SAFETY_NO, "Solar panels or batteries within reach of children", None),
        ("lightening_installed_creche", SAFETY_NO, "No lightning arrestor installed in the creche building", None),
    ]),
    "sf_food": ("Food Safety", [
        ("food_utilized_first_out_manner", SAFETY_NO, "Food grains and rice not used first come first out", None),
        ("egg_floating_tests_doneperiodically_check_quality_eggs", SAFETY_NO, "Egg floating test not done periodically", None),
        ("is_leftover_food_disposed_of_properly_every_day", SAFETY_NO, "Leftover food not disposed of properly every day", None),
        ("water_filter_being_safe_drinking_water", SAFETY_NO, "Water filter not used for safe drinking water", None),
    ]),
    "sf_other": ("Others", [
        ("creche_running_two_caregivers", SAFETY_NO, "Creche not running with two caregivers", None),
        ("first_aid_available_creche", SAFETY_NO, "No fully equipped first-aid box in the creche", None),
        ("emergency_contact_numbers_clearly_displayed", SAFETY_NO, "Emergency contact numbers not clearly displayed", None),
    ]),
}

# The question each field asks, as the Safety Indicators report (safety_status) words it, and the names of the answers.
SAFETY_QUESTIONS = {
    "is_the_structural_safety_of_the_creches_roof_and_walls_ensured": "Is the structural safety of the creche's roof and walls ensured?",
    "is_the_creche_protected_from_rainwater_leakage": "Is the creche protected from rainwater leakage?",
    SAFETY_WELL: "Is any well/tube well within 20 m radius of the creche?",
    "properly_covered_with_iron_net_inside_out_side": "If yes is it properly covered with an iron net (inside & outside)?",
    "are_sharp_edge_cutters_or_machinery_kept_away_from_the_creche": "Are sharp edge cutters or machinery kept away from the creche?",
    "external_fencing_around": "Is there external fencing around the creche?",
    "safety_the_main_entrance": "Is there a safety gate at the main entrance?",
    "safety_gate_kitchen_entrance": "Is there a safety gate at the kitchen entrance?",
    "creche_secured_against_animals": "Is the creche secured against the entry of poisonous animals (snakes, scorpions) as well as domestic animals (dogs, cats, cows, hens)?",
    "parents_recorded_visitor_register": "Is the entry of any person other than parents in the creche recorded in the visitor's register?",
    "positioned_above_cylinder_height": "Is there a separate slab or table for the gas stove positioned above cylinder height?",
    "fire_extinguisher_available_working_condition": "Is a fire extinguisher available and in working condition?",
    "kitchen_fire_related_emergencies": "Are fire blankets and fire buckets available in the kitchen for fire related emergencies?",
    "confident_handling_pressure_cooker": "Is the caregiver confident in handling a pressure cooker?",
    "electrical_connections_positioned_out_children_reach": "Are all electrical connections positioned out of children's reach?",
    "fans_and_lights_installed_safe_location_height": "Are fans and lights installed at a safe location and height?",
    "solar_batteries_kept_out_children_reach": "Are solar panels or batteries kept out of children's reach?",
    "lightening_installed_creche": "Is lightening arrestors installed in the creche building",
    "food_utilized_first_out_manner": "Are food grains and rice utilized in first come first out manner?",
    "egg_floating_tests_doneperiodically_check_quality_eggs": "Are egg floating tests done periodically to check the quality of eggs?",
    "is_leftover_food_disposed_of_properly_every_day": "Is leftover food disposed of properly every day?",
    "water_filter_being_safe_drinking_water": "Is water filter being used for safe drinking water?",
    "creche_running_two_caregivers": "During your visit, is the creche running with two caregivers?",
    "first_aid_available_creche": "Is a fully equipped first-aid box available in the creche?",
    "emergency_contact_numbers_clearly_displayed": "Are emergency contact numbers clearly displayed?",
}
SAFETY_ANSWER_NAMES = {1: "Yes", 2: "No", 3: "Not Observed", 4: "Other"}


def safety_audit_issues(audit, categories=None):
    """{field: unsafe answer} of the questions an audit (a Safety Indicators row) answered with the unsafe answer, in the
    given categories (all of them by default). The same rule as safety_conditions, which counts them in SQL."""
    issues = {}
    for category in categories or SAFETY_CATEGORIES:
        for field, answer, _, needs in SAFETY_CATEGORIES[category][1]:
            if str(audit.get(field)) == str(answer) and (not needs or str(audit.get(needs)) == str(SAFETY_YES)):
                issues[field] = answer
    return issues


def safety_conditions(category, a="si"):
    """[(condition, issue text)] of a category, on the Safety Indicators table aliased `a`."""
    conditions = []
    for field, answer, text, needs in SAFETY_CATEGORIES[category][1]:
        condition = f"{a}.{field} = {answer}"
        if needs:
            condition = f"({condition} AND {a}.{needs} = {SAFETY_YES})"
        conditions.append((condition, text))
    return conditions


def safety_flag(category, a="si"):
    """1 when the audit has at least one issue in the category, else 0."""
    return flag("(" + " OR ".join(condition for condition, _ in safety_conditions(category, a)) + ")")


def safety_issue_count(category, a="si"):
    return "(" + " + ".join(flag(condition) for condition, _ in safety_conditions(category, a)) + ")"


def safety_any_issue(a="si"):
    return "GREATEST(" + ", ".join(safety_flag(category, a) for category in SAFETY_CATEGORIES) + ")"


def safety_age_bucket(date_expr):
    """Age of an issue in 30-day months, from `date_expr` to the reference date: 1 (up to 30 days) ... 6, 7 (more than 6 months)."""
    return f"CAST(LEAST({SAFETY_MAX_AGE}, GREATEST(1, CEIL(DATEDIFF(%(ref_date)s, {date_expr}) / {SAFETY_MONTH_DAYS}))) AS SIGNED)"


# Unresolved: the creche's latest audit still has issues (no clean audit after the last one with issues).
SAFETY_UNRESOLVED = "sh.last_issue IS NOT NULL AND sh.last_issue > IFNULL(sh.last_clean, CAST('1000-01-01' AS DATE))"


def safety_month_join(params):
    """`sm`: per creche audited in the selected month, whether any audit of the month has an issue in each category."""
    flags = ", ".join(f"MAX({safety_flag(category)}) AS {category}" for category in SAFETY_CATEGORIES)
    return f"""
        LEFT JOIN (
            SELECT si.creche_id, {flags}
            FROM `tabSafety Indicators` si
            WHERE si.date_of_visit BETWEEN %(start_date)s AND %(end_date)s
              AND si.creche_id IN ({creche_names_in_scope(params, operational=True)})
            GROUP BY si.creche_id
        ) sm ON sm.creche_id = cr.name
    """


def safety_history_join(params):
    """`sh`: per creche, over every audit up to the end of the selected month: the latest audit, the latest one
    with issues, the latest clean one and the first audit of the current run of audits with issues."""
    return f"""
        LEFT JOIN (
            SELECT t.creche_id,
                   MAX(t.visit) AS last_audit,
                   MAX(CASE WHEN t.has_issue = 1 THEN t.visit END) AS last_issue,
                   MAX(t.last_clean) AS last_clean,
                   MIN(CASE WHEN t.has_issue = 1 AND (t.last_clean IS NULL OR t.visit > t.last_clean) THEN t.visit END) AS open_since
            FROM (
                SELECT a.creche_id, a.visit, a.has_issue,
                       MAX(CASE WHEN a.has_issue = 0 THEN a.visit END) OVER (PARTITION BY a.creche_id) AS last_clean
                FROM (
                    SELECT si.creche_id, si.date_of_visit AS visit, {safety_any_issue()} AS has_issue
                    FROM `tabSafety Indicators` si
                    WHERE si.date_of_visit <= %(end_date)s
                      AND si.creche_id IN ({creche_names_in_scope(params, operational=True)})
                ) a
            ) t
            GROUP BY t.creche_id
        ) sh ON sh.creche_id = cr.name
    """


def add_safety_sources(sources, params, operational):
    # Audits of the selected month, as the Safety Indicators report reads them.
    add_group(
        sources, "sf_month",
        f"`tabCreche` cr {safety_month_join(params)}",
        operational,
        {
            "sf_not_audited": "sm.creche_id IS NULL",
            **{category: f"IFNULL(sm.{category}, 0) = 1" for category in SAFETY_CATEGORIES},
        },
    )

    # Issues over the audit history, optionally only those of one age (params["sf_age"]).
    history_from = f"`tabCreche` cr {safety_history_join(params)}"
    identified_age = f" AND {safety_age_bucket('sh.last_issue')} = %(sf_age)s" if params["sf_age"] else ""
    unresolved_age = f" AND {safety_age_bucket('sh.open_since')} = %(sf_age)s" if params["sf_age"] else ""
    sources["sf_identified"] = {"from": history_from, "where": f"{operational} AND sh.last_issue IS NOT NULL{identified_age}"}
    sources["sf_unresolved"] = {"from": history_from, "where": f"{operational} AND {SAFETY_UNRESOLVED}{unresolved_age}"}


# ---------------------------------------------------------------------------
# Logistics
# ---------------------------------------------------------------------------
# A fire extinguisher is expired once its expiry date has passed (a record marked "Not Available" has no
# extinguisher) and is awaiting refilling when it was sent for refilling (Gone for Refilling Date) more than a month
# ago; a record without that date falls back to the date it was last saved.
FIRE_EXPIRED = "fe.date_of_expiry < %(ref_date)s AND IFNULL(fe.fire_extingusher_status, '') <> 'Not Available'"


def refilling_date_column():
    """`fe.gone_for_refilling_date`, or NULL where the Fire Extinguisher table has no such column.

    The Fire Extinguisher Status report only needs the status, the delivery and the expiry date, so the table may
    not have this column. Naming a column that is missing fails the whole query, and with it all six Logistics fuel
    cards; the date saved (`modified`) then stands in for the date it was sent for refilling.
    """
    return "fe.gone_for_refilling_date" if "gone_for_refilling_date" in frappe.db.get_table_columns("Fire Extinguisher") else "NULL"


def fire_refill_pending(refilled_on):
    return (
        "fe.fire_extingusher_status = 'Gone for Refilling' "
        f"AND COALESCE({refilled_on}, DATE(fe.modified)) < DATE_SUB(%(ref_date)s, INTERVAL {REFILL_WAIT_MONTHS} MONTH)"
    )

# Same rules as the LPG report: the latest supply record of the creche; alternative fuel when the
# current source of fuel is set and differs from the supplied one; LPG with 0-1 month left when the
# current source is LPG and the supply is more than 90 days old.
LPG_ALTERNATIVE = (
    "lp.current_source_of_fuel IS NOT NULL AND lp.current_source_of_fuel != '' "
    "AND lp.current_source_of_fuel != lp.supplied_fuel_source"
)
LPG_ONE_MONTH_LEFT = (
    f"lp.current_source_of_fuel = '{LPG_FUEL}' AND DATEDIFF(%(ref_date)s, lp.date_of_supply) > {LPG_LOW_AFTER_DAYS}"
)

# The weeks of the Cashbook report, as days of the month.
CASHBOOK_WEEK_DAYS = [(1, 7), (8, 14), (15, 21), (22, 28), (29, 31)]


def lpg_latest_join(params):
    """`lp`: each creche's latest LPG supply record up to the reference date."""
    return f"""
        LEFT JOIN (
            SELECT ranked.creche_id, ranked.supplied_fuel_source, ranked.if_lpg_what_type,
                   ranked.current_source_of_fuel, ranked.other, ranked.date_of_supply
            FROM (
                SELECT l.creche_id, l.supplied_fuel_source, l.if_lpg_what_type, l.current_source_of_fuel, l.other, l.date_of_supply,
                       ROW_NUMBER() OVER (
                           PARTITION BY l.creche_id ORDER BY l.date_of_supply DESC, l.modified DESC, l.name DESC
                       ) AS rn
                FROM `tabLPG` l
                WHERE l.date_of_supply <= %(ref_date)s
                  AND l.creche_id IN ({creche_names_in_scope(params, operational=True)})
            ) ranked
            WHERE ranked.rn = 1
        ) lp ON lp.creche_id = cr.name
    """


def fire_extinguisher_join(params):
    """`fx`: per creche with fire extinguisher records, how many are expired / awaiting refilling and since when."""
    refilled_on = refilling_date_column()
    refill_pending = fire_refill_pending(refilled_on)
    return f"""
        LEFT JOIN (
            SELECT fe.creche_id,
                   COUNT(*) AS extinguishers,
                   SUM(CASE WHEN {FIRE_EXPIRED} THEN 1 ELSE 0 END) AS expired,
                   MIN(CASE WHEN {FIRE_EXPIRED} THEN fe.date_of_expiry END) AS first_expiry,
                   MIN(CASE WHEN {FIRE_EXPIRED} THEN {refilled_on} END) AS expired_dispatch,
                   SUM(CASE WHEN {refill_pending} THEN 1 ELSE 0 END) AS refill_pending,
                   MIN(CASE WHEN {refill_pending} THEN COALESCE({refilled_on}, DATE(fe.modified)) END) AS refill_since,
                   MIN(CASE WHEN {refill_pending} THEN {refilled_on} END) AS refill_dispatch,
                   MIN(CASE WHEN {refill_pending} THEN fe.date_of_expiry END) AS refill_expiry
            FROM `tabFire Extinguisher` fe
            WHERE fe.creche_id IN ({creche_names_in_scope(params, operational=True)})
            GROUP BY fe.creche_id
        ) fx ON fx.creche_id = cr.name
    """


def stock_join(params):
    """`stk`: the creches that have stock rows for the selected month."""
    return f"""
        LEFT JOIN (
            SELECT DISTINCT cs.creche_id
            FROM `tabCreche Stock` cs
            INNER JOIN `tabStock Child table` csc ON csc.parent = cs.name
            WHERE csc.year = %(stock_year_id)s AND csc.month = %(month)s
              AND cs.creche_id IN ({creche_names_in_scope(params, operational=True)})
        ) stk ON stk.creche_id = cr.name
    """


# Cash in hand of a creche, as the Cashbook report works it out: the opening balance entered in the cashbook
# + the receipts before the month - the expenses before the month, then the month's receipts and the month's
# expenses up to the reference date. Only creches with cashbook data are in that report, so only they are here.
CASHBOOK_BALANCE = (
    "(IFNULL(bal_e.seed, 0) + IFNULL(bal_r.past_receipts, 0) - IFNULL(bal_e.past_expenses, 0)"
    " + IFNULL(bal_r.month_receipts, 0) - IFNULL(bal_e.month_expenses, 0))"
)


def cashbook_balance_join(params):
    """`bal_r` / `bal_e`: per creche, the cashbook receipts and the cashbook expenses that make up its balance."""
    scope = creche_names_in_scope(params, operational=True)
    return f"""
        LEFT JOIN (
            SELECT r.creche_id,
                   SUM(CASE WHEN r.date < %(start_date)s THEN COALESCE(r.amount, 0) ELSE 0 END) AS past_receipts,
                   SUM(CASE WHEN r.date BETWEEN %(start_date)s AND %(end_date)s THEN COALESCE(r.amount, 0) ELSE 0 END) AS month_receipts
            FROM `tabCashbook Receipt` r
            WHERE r.creche_id IN ({scope})
            GROUP BY r.creche_id
        ) bal_r ON bal_r.creche_id = cr.name
        LEFT JOIN (
            SELECT cb.creche_id, MAX(cb.opening_balance) AS seed,
                   SUM(CASE WHEN cb.date < %(start_date)s THEN COALESCE(cb.expense_amount, 0) ELSE 0 END) AS past_expenses,
                   SUM(CASE WHEN cb.date BETWEEN %(start_date)s AND %(ref_date)s THEN COALESCE(cb.expense_amount, 0) ELSE 0 END) AS month_expenses
            FROM `tabCashbook` cb
            WHERE cb.creche_id IN ({scope})
            GROUP BY cb.creche_id
        ) bal_e ON bal_e.creche_id = cr.name
    """


def cashbook_weeks_join(params):
    """`cbw`: per creche, the cashbook entries of each week (w1 ... w5) of the selected month."""
    weeks = ", ".join(
        f"SUM(CASE WHEN DAY(cb.date) BETWEEN {first} AND {last} THEN 1 ELSE 0 END) AS w{number}"
        for number, (first, last) in enumerate(CASHBOOK_WEEK_DAYS, 1)
    )
    return f"""
        LEFT JOIN (
            SELECT cb.creche_id, {weeks}
            FROM `tabCashbook` cb
            WHERE cb.date BETWEEN %(month_start)s AND %(month_end)s
              AND cb.creche_id IN ({creche_names_in_scope(params, operational=True)})
            GROUP BY cb.creche_id
        ) cbw ON cbw.creche_id = cr.name
    """


def cashbook_week_due(number):
    """The week must have an entry once it is over and the creche was open for all of it."""
    return f"(%(wk{number}_end)s < %(cb_cutoff)s AND cr.creche_opening_date <= %(wk{number}_start)s)"


def add_logistics_sources(sources, params, operational):
    add_group(
        sources, "lg_fuel",
        f"`tabCreche` cr {lpg_latest_join(params)} {fire_extinguisher_join(params)}",
        operational,
        {
            "lg_lpg_not_updated": "lp.creche_id IS NULL",
            "lg_fire_not_updated": "fx.creche_id IS NULL",
            "lg_alt_fuel": LPG_ALTERNATIVE,
            "lg_lpg_one_month": LPG_ONE_MONTH_LEFT,
            "lg_fire_expired": "IFNULL(fx.expired, 0) > 0",
            "lg_fire_refill_pending": "IFNULL(fx.refill_pending, 0) > 0",
        },
    )

    sources["lg_stock_not_updated"] = {
        "from": f"`tabCreche` cr {stock_join(params)}",
        "where": f"{operational} AND stk.creche_id IS NULL",
    }

    sources["lg_zero_balance"] = {
        "from": f"`tabCreche` cr {cashbook_balance_join(params)}",
        "where": (
            f"{operational} AND (bal_r.creche_id IS NOT NULL OR bal_e.creche_id IS NOT NULL) "
            f"AND {CASHBOOK_BALANCE} <= 0"
        ),
    }

    # A creche has not updated the weekly cashbook when a week that is over has no entry.
    week_missing = " OR ".join(
        f"({cashbook_week_due(number)} AND IFNULL(cbw.w{number}, 0) = 0)" for number in range(1, len(CASHBOOK_WEEK_DAYS) + 1)
    )
    sources["lg_cashbook_not_updated"] = {
        "from": f"`tabCreche` cr {cashbook_weeks_join(params)}",
        "where": f"{operational} AND ({week_missing})",
    }


# ---------------------------------------------------------------------------
# Community Engagement (reports: gramsabha_community_resolution_report, cmc_meeting)
# ---------------------------------------------------------------------------
def add_community_sources(sources, operational):
    # No Gram Sabha / community resolution attached to the creche (the "Not submitted" column of the
    # Gramsabha/Community Resolution report).
    sources["ce_gram_sabha_not_submitted"] = {
        "from": "`tabCreche` cr",
        "where": f"{operational} AND {PROFILE_NOT_SUBMITTED}",
    }

    # No Creche Committee Meeting dated in the selected month (the "Creches Not Conducted CMC Meeting"
    # column of the CMC Meeting report).
    sources["ce_cmc_not_done"] = {
        "from": f"""`tabCreche` cr
            LEFT JOIN (
                SELECT DISTINCT ccm.creche_id
                FROM `tabCreche Committee Meeting` ccm
                WHERE ccm.meeting_date BETWEEN %(start_date)s AND %(end_date)s
            ) cmc ON cmc.creche_id = cr.name""",
        "where": f"{operational} AND cmc.creche_id IS NULL",
    }


def get_sources(params):
    """FROM / WHERE fragments, one per indicator.

    The counts in this module and the drill-down tables in
    review_cards_details.py are both built from these, so a card and the table
    behind it can never disagree.
    """
    scope = creche_scope(params, "cr")
    operational = operational_scope(params, "cr")

    enrolled_now = (
        "cee.date_of_enrollment <= %(end_date)s "
        "AND (cee.date_of_exit IS NULL OR cee.date_of_exit > %(end_date)s)"
    )
    enrolled_month = "cee.date_of_enrollment BETWEEN %(start_date)s AND %(end_date)s"
    exited_month = "cee.date_of_exit BETWEEN %(start_date)s AND %(end_date)s"

    # ---- attendance --------------------------------------------------------
    # Every attendance aggregate only reads the creches inside the current scope,
    # whatever the denormalised geography on the attendance rows says.
    att_creches = f"ca.creche_id IN (SELECT cr2.name FROM `tabCreche` cr2 WHERE {creche_scope(params, 'cr2')})"
    att_month = "ca.date_of_attendance BETWEEN %(start_date)s AND %(end_date)s"

    # per child: days attended and open days (children without records are absent -> 0%)
    child_att_join = f"""
        LEFT JOIN (
            SELECT cal.childenrolledguid, SUM(cal.attendance) AS days_attended, COUNT(*) AS open_days
            FROM `tabChild Attendance` ca
            INNER JOIN `tabChild Attendance List` cal ON cal.parent = ca.name
            WHERE ca.is_shishu_ghar_is_closed_for_the_day = 0 AND {att_month} AND {att_creches}
            GROUP BY cal.childenrolledguid
        ) att ON att.childenrolledguid = cee.childenrollguid
    """
    # same population as average_attendance_child_wise: enrolled at any time in the month
    att_children = (
        "cee.date_of_enrollment <= %(end_date)s "
        "AND (cee.date_of_exit IS NULL OR cee.date_of_exit >= %(start_date)s)"
    )

    # Per operational creche: open days (od) and children present / child-days listed (pr).
    # Only operational creches are read, open days are counted on the small attendance
    # table alone (no COUNT(DISTINCT) over the ~800k child rows), and the big child
    # table is read exactly once.
    att_operational = (
        "ca.creche_id IN (SELECT cr2.name FROM `tabCreche` cr2 "
        f"WHERE {operational_scope(params, 'cr2')})"
    )
    creche_att_join = f"""
        LEFT JOIN (
            SELECT ca.creche_id, COUNT(*) AS open_days
            FROM `tabChild Attendance` ca
            WHERE ca.is_shishu_ghar_is_closed_for_the_day = 0 AND {att_month} AND {att_operational}
            GROUP BY ca.creche_id
        ) od ON od.creche_id = cr.name
        LEFT JOIN (
            SELECT ca.creche_id, SUM(cal.attendance) AS present, COUNT(*) AS child_days
            FROM `tabChild Attendance` ca
            INNER JOIN `tabChild Attendance List` cal ON cal.parent = ca.name
            WHERE ca.is_shishu_ghar_is_closed_for_the_day = 0 AND {att_month} AND {att_operational}
            GROUP BY ca.creche_id
        ) pr ON pr.creche_id = cr.name
    """
    att_avg_cond = "pr.child_days > 0 AND ROUND(pr.present * 100.0 / pr.child_days, 2) < %(att_low_pct)s"
    att_daily_cond = "od.open_days > 0 AND ROUND(IFNULL(pr.present, 0) / od.open_days, 1) < %(att_daily_min)s"
    closed_days_join = f"""
        LEFT JOIN (
            SELECT ca.creche_id, COUNT(DISTINCT ca.date_of_attendance) AS closed_days
            FROM `tabChild Attendance` ca
            WHERE ca.is_shishu_ghar_is_closed_for_the_day = 1 AND {att_month} AND {att_creches}
            GROUP BY ca.creche_id
        ) cld ON cld.creche_id = cr.name
    """
    # attendance records submitted (open or closed) in the month, as on the Creche Report Card
    submitted_join = f"""
        LEFT JOIN (
            SELECT ca.creche_id, COUNT(*) AS submitted_days
            FROM `tabChild Attendance` ca
            WHERE {att_month} AND {att_creches}
            GROUP BY ca.creche_id
        ) sbm ON sbm.creche_id = cr.name
    """
    eligible_days = "(DATEDIFF(%(att_ref_date)s, GREATEST(cr.creche_opening_date, %(start_date)s)) + 1)"
    missed_days = f"({eligible_days} - IFNULL(sbm.submitted_days, 0))"
    has_eligible_days = "cr.creche_opening_date IS NOT NULL AND cr.creche_opening_date <= %(att_ref_date)s"

    welcome_wrong = f"{enrolled_month} AND {wrong_equipment(WELCOME_REF, 'cee.measurement_equipment')} AND {scope}"
    exit_wrong = f"{exited_month} AND {wrong_equipment(EXIT_REF, 'cee.measurement_equipment_exit')} AND {scope}"

    sources = {
        "op_creches": {"from": "`tabCreche` cr", "where": operational},
        "profile_not_submitted": {
            "from": "`tabCreche` cr",
            "where": f"{operational} AND {PROFILE_NOT_SUBMITTED}",
        },
        "hh_not_done": {
            "from": f"`tabCreche` cr {HH_VISITED_THIS_QUARTER}",
            "where": f"{operational} AND hv.creche_id IS NULL",
        },
        "low_enrolment": {
            "from": f"`tabCreche` cr {ENROLLED_COUNTS_JOIN}",
            "where": f"{operational} AND IFNULL(en.cnt, 0) <= %(low_limit)s",
        },
        # Cumulative: every child enrolled on or before the end of the period, not only those of the period.
        "no_welcome_anthro": {
            "from": CHILD_FROM,
            "where": f"cee.date_of_enrollment <= %(end_date)s AND {WELCOME_ANTHRO_MISSING} AND {scope}",
        },
        # Cumulative: every child who exited on or before the end of the period, not only those who exited in it.
        # A child counts as exited with an exit date up to the end of the period, or flagged exited (is_exited)
        # with no exit date saved. A child who has not exited has neither.
        "no_exit_anthro": {
            "from": CHILD_FROM,
            "where": (
                "(cee.date_of_exit <= %(end_date)s OR (cee.date_of_exit IS NULL AND cee.is_exited = 1)) "
                f"AND {EXIT_ANTHRO_MISSING} AND {scope}"
            ),
        },
        "wrong_equipment_welcome": {"from": CHILD_FROM, "where": welcome_wrong},
        "wrong_equipment_exit": {"from": CHILD_FROM, "where": exit_wrong},
        "eligible": {
            "from": ELIGIBLE_FROM,
            "where": f"{ELIGIBLE_CHILD_WHERE} AND {scope}",
        },
        "current_enrolled": {"from": CHILD_FROM, "where": f"{enrolled_now} AND {scope}"},
        "enrolled_month": {"from": CHILD_FROM, "where": f"{enrolled_month} AND {scope}"},
        "exited_month": {"from": CHILD_FROM, "where": f"{exited_month} AND {scope}"},
        "overage_not_exited": {
            "from": CHILD_FROM,
            "where": (
                f"{enrolled_now} "
                f"AND TIMESTAMPDIFF(MONTH, cee.child_dob, %(end_date)s) >= {OVERAGE_MONTHS} "
                f"AND {scope}"
            ),
        },
        "att_avg_below_50": {
            "from": f"`tabCreche` cr {creche_att_join}",
            "where": f"{operational} AND {att_avg_cond}",
        },
        "att_daily_below_10": {
            "from": f"`tabCreche` cr {creche_att_join}",
            "where": f"{operational} AND {att_daily_cond}",
        },
        "att_children_zero": {
            "from": f"{CHILD_FROM} {child_att_join}",
            "where": f"{att_children} AND {scope} AND IFNULL(att.days_attended, 0) = 0",
        },
        "att_children_below_50": {
            "from": f"{CHILD_FROM} {child_att_join}",
            "where": f"{att_children} AND {scope} AND {CHILD_ATT_PCT} < %(att_low_pct)s",
        },
        "att_closed_over_7": {
            "from": f"`tabCreche` cr {closed_days_join}",
            "where": f"{operational} AND IFNULL(cld.closed_days, 0) > %(closed_days_max)s",
        },
        "att_missed_over_5": {
            "from": f"`tabCreche` cr {submitted_join}",
            "where": f"{operational} AND {has_eligible_days} AND {missed_days} > %(missed_days_max)s",
        },
        "att_missed_all": {
            "from": f"`tabCreche` cr {submitted_join}",
            "where": f"{operational} AND {has_eligible_days} AND {missed_days} > 0",
        },
        "att_creche_from": f"`tabCreche` cr {creche_att_join}",
        "att_avg_cond": att_avg_cond,
        "att_daily_cond": att_daily_cond,
        "operational": operational,
        "eligible_days": eligible_days,
        "missed_days": missed_days,
        "scope": scope,
    }

    # Community Engagement tab
    add_community_sources(sources, operational)

    # Malnutrition Prevalence, Malnutrition Management and Check-In tabs
    add_prevalence_sources(sources, params, scope, operational)
    add_malnutrition_sources(sources, params, scope)
    add_checkin_sources(sources, params, operational)
    add_safety_sources(sources, params, operational)
    add_logistics_sources(sources, params, operational)
    return sources


def count_rows(source, params, expr="COUNT(*)"):
    rows = frappe.db.sql(
        f"SELECT {expr} AS cnt FROM {source['from']} WHERE {source['where']}",
        params,
        as_dict=True,
    )
    return int((rows[0]["cnt"] if rows else 0) or 0)


def count_cases(group, params):
    """The counts of every card of a group (see add_group), from a single pass."""
    selects = ", ".join(
        f"SUM(CASE WHEN ({condition}) THEN 1 ELSE 0 END) AS {card_id}" for card_id, condition in group["cases"].items()
    )
    rows = frappe.db.sql(
        f"SELECT {selects} FROM {group['from']} WHERE {group['where']}",
        params,
        as_dict=True,
    )
    return {card_id: int((rows[0][card_id] if rows else 0) or 0) for card_id in group["cases"]}


def item(item_id, title, value, extra=""):
    return {"id": item_id, "title": title, "value": value, "extra": extra}


@frappe.whitelist()
@scoped()
def review_section_overview(partner_id=None, state_id=None, district_id=None, gp_id=None, block_id=None, creche_id=None, year=None, month=None, supervisor_id=None, cstart_date=None, cend_date=None, c_status=None, phases=None, from_date=None, to_date=None):
    params = build_review_params(partner_id, state_id, district_id, gp_id, block_id, creche_id, year, month, supervisor_id, cstart_date, cend_date, c_status, phases, from_date=from_date, to_date=to_date)
    source = get_sources(params)["op_creches"]

    row = frappe.db.sql(
        f"""
        SELECT
            COUNT(*) AS creches,
            COUNT(DISTINCT cr.partner_id) AS partners,
            COUNT(DISTINCT cr.block_id) AS blocks,
            COUNT(DISTINCT cr.district_id) AS districts,
            SUM(CASE WHEN {PROFILE_NOT_SUBMITTED} THEN 1 ELSE 0 END) AS profile_pending
        FROM {source['from']}
        WHERE {source['where']}
        """,
        params,
        as_dict=True,
    )[0]

    frappe.response["data"] = {
        "Overview": [
            item("op_creches", "No. of operational creches", int(row["creches"] or 0)),
            item("op_partners", "No. of partner organizations", int(row["partners"] or 0)),
            item("op_blocks", "No. of operational blocks", int(row["blocks"] or 0)),
            item("op_districts", "No. of operational districts", int(row["districts"] or 0)),
            item("profile_not_submitted", "No. of creches not submitted creche profile", int(row["profile_pending"] or 0)),
        ]
    }


# Plain count cards: card id -> (title, source key).
CHECK_CARDS = {
    "hh_not_done": ("No of Creches Quarterly HH Not Done", "hh_not_done"),
    "no_exit_anthro": ("No. of children without exit anthro", "no_exit_anthro"),
    "no_welcome_anthro": ("No. of children without welcome anthro", "no_welcome_anthro"),
    "low_enrolment": ("No. of Creches with Enrolled Children 10 or Less than 10", "low_enrolment"),
    "att_children_zero": ("No. of Enrolled Children with 0% Attendance", "att_children_zero"),
    "att_children_below_50": ("No. of Enrolled Children with Below 50% Attendance", "att_children_below_50"),
    "att_closed_over_7": ("No. of Creches Closed for More Than 7 Days – Attendance", "att_closed_over_7"),
    "att_missed_over_5": ("No. of Creches That Have Not Submitted Attendance for More Than 5 Days – Attendance", "att_missed_over_5"),
    "att_missed_all": ("No. of Creches That Have Not Submitted Attendance for All Days", "att_missed_all"),
    "ci_short_engagement": ("No. of check-ins with less than 2 hours of engagement by the supervisor", "ci_short_engagement"),
    # Safety: these two take an age filter (the `age` request parameter, see SAFETY_MAX_AGE)
    "sf_identified": ("No. of Creches with Safety Issues Identified", "sf_identified"),
    "sf_unresolved": ("No. of Creches with Unresolved Safety Issues", "sf_unresolved"),
    "lg_stock_not_updated": ("No. of Creches Where Monthly Stock Details Have Not Been Updated", "lg_stock_not_updated"),
    "lg_cashbook_not_updated": ("No. of Creches Where the Weekly Cashbook Has Not Been Updated", "lg_cashbook_not_updated"),
    "lg_zero_balance": ("No. of Creches Operating with Zero or Negative Balance", "lg_zero_balance"),
    "ce_gram_sabha_not_submitted": ("No. of Creches Not Submitted Community/Gram Sabha Resolutions", "ce_gram_sabha_not_submitted"),
    "ce_cmc_not_done": ("No. of Creches Where CMC Meeting Not Done for the Month", "ce_cmc_not_done"),
}
ATT_AVG_TITLE = "No. of Creches with Average Attendance Below 50%"
ATT_DAILY_TITLE = "No. of Creches with Daily Average Attendance Below 10"
WRONG_EQUIPMENT_TITLE = "No of Creches where Wrong Equipment is Chosen for Welcome Anthro/Exit Anthro"


def wrong_equipment_item(params, sources):
    """Creches / children with the wrong equipment, from two single-date-range branches.

    A single WHERE with two date ranges joined by OR cannot use a date index;
    two UNION ALL branches can.
    """
    welcome, exit_ = sources["wrong_equipment_welcome"], sources["wrong_equipment_exit"]
    row = frappe.db.sql(
        f"""
        SELECT COUNT(DISTINCT u.creche) AS creches, COUNT(DISTINCT u.child) AS children
        FROM (
            SELECT cr.name AS creche, cee.name AS child
            FROM {welcome['from']} WHERE {welcome['where']}
            UNION ALL
            SELECT cr.name AS creche, cee.name AS child
            FROM {exit_['from']} WHERE {exit_['where']}
        ) u
        """,
        params,
        as_dict=True,
    )[0]
    children = int(row["children"] or 0)
    return item("wrong_equipment", WRONG_EQUIPMENT_TITLE, int(row["creches"] or 0), f"({children:,} children)" if children else "")


PREVALENCE_WRONG_EQUIPMENT_TITLE = "No of Creches where wrong Measurement Equipment Used"


def prevalence_wrong_equipment_item(params, sources):
    """Creches where a child was measured with equipment that does not suit the child's age; the children are shown beneath."""
    source = sources["mp_wrong_equipment"]
    row = frappe.db.sql(
        f"SELECT COUNT(DISTINCT cr.name) AS creches, COUNT(DISTINCT cee.name) AS children FROM {source['from']} WHERE {source['where']}",
        params,
        as_dict=True,
    )[0]
    children = int(row["children"] or 0)
    return item("mp_wrong_equipment", PREVALENCE_WRONG_EQUIPMENT_TITLE, int(row["creches"] or 0), f"({children:,} children)" if children else "")


@frappe.whitelist()
@scoped()
def review_card_count(card=None, partner_id=None, state_id=None, district_id=None, gp_id=None, block_id=None, creche_id=None, year=None, month=None, supervisor_id=None, cstart_date=None, cend_date=None, c_status=None, phases=None, age=None, from_date=None, to_date=None):
    """One data-quality card per request, so each card appears as soon as its own query finishes."""
    if card not in ("wrong_equipment", "mp_wrong_equipment") and card not in CHECK_CARDS:
        frappe.throw("Unknown card")

    params = build_review_params(partner_id, state_id, district_id, gp_id, block_id, creche_id, year, month, supervisor_id, cstart_date, cend_date, c_status, phases, age, from_date=from_date, to_date=to_date)
    sources = get_sources(params)

    if card == "wrong_equipment":
        result = wrong_equipment_item(params, sources)
    elif card == "mp_wrong_equipment":
        result = prevalence_wrong_equipment_item(params, sources)
    else:
        title, key = CHECK_CARDS[card]
        result = item(card, title, count_rows(sources[key], params))

    frappe.response["data"] = {"Enrolment": [result]}


@frappe.whitelist()
@scoped()
def review_section_enrolment_counts(partner_id=None, state_id=None, district_id=None, gp_id=None, block_id=None, creche_id=None, year=None, month=None, supervisor_id=None, cstart_date=None, cend_date=None, c_status=None, phases=None, from_date=None, to_date=None):
    """Child counts for the Enrolment section (same rules as the Creche Report Card)."""
    params = build_review_params(partner_id, state_id, district_id, gp_id, block_id, creche_id, year, month, supervisor_id, cstart_date, cend_date, c_status, phases, from_date=from_date, to_date=to_date)
    sources = get_sources(params)

    frappe.response["data"] = {
        "Enrolment": [
            item("eligible", "No. of current eligible children", count_rows(sources["eligible"], params, "COUNT(hhc.name)")),
            item("enrolled", "No. of current enrolled children", count_rows(sources["current_enrolled"], params)),
            item("enrolled_month", "No. of children enrolled this month", count_rows(sources["enrolled_month"], params)),
            item("exited_month", "No. of children exited this month", count_rows(sources["exited_month"], params)),
            item("overage_not_exited", "No. of children completed 36 months but not exited", count_rows(sources["overage_not_exited"], params)),
        ]
    }


@frappe.whitelist()
@scoped()
def review_attendance_creche_cards(partner_id=None, state_id=None, district_id=None, gp_id=None, block_id=None, creche_id=None, year=None, month=None, supervisor_id=None, cstart_date=None, cend_date=None, c_status=None, phases=None, from_date=None, to_date=None):
    """"Average attendance below 50%" and "daily average below 10", from a single pass.

    Both need the same per-creche attendance totals, so they share one query
    instead of reading the month's attendance twice.
    """
    params = build_review_params(partner_id, state_id, district_id, gp_id, block_id, creche_id, year, month, supervisor_id, cstart_date, cend_date, c_status, phases, from_date=from_date, to_date=to_date)
    s = get_sources(params)

    row = frappe.db.sql(
        f"""
        SELECT
            SUM(CASE WHEN {s['att_avg_cond']} THEN 1 ELSE 0 END) AS low_avg,
            SUM(CASE WHEN {s['att_daily_cond']} THEN 1 ELSE 0 END) AS low_daily
        FROM {s['att_creche_from']}
        WHERE {s['operational']}
        """,
        params,
        as_dict=True,
    )[0]

    frappe.response["data"] = {
        "Attendance": [
            item("att_avg_below_50", ATT_AVG_TITLE, int(row["low_avg"] or 0)),
            item("att_daily_below_10", ATT_DAILY_TITLE, int(row["low_daily"] or 0)),
        ]
    }


# Malnutrition Prevalence, Malnutrition Management, Check-In, Safety and Logistics cards that share one query:
# group -> [(card id, title)].
CARD_GROUPS = {
    "mp_creche": [
        ("mp_measure_below_100", "No of Creches with less than 100% measurement"),
        ("mp_not_submitted", "No. of creches not submitted anthro"),
    ],
    "mp_flags": [
        ("mp_snc", "No. of SNC Children"),
        ("mp_sam", "No. of SAM children"),
        ("mp_suw", "No. of SUW children"),
        ("mp_gf2", "No. of GF2 children"),
        ("mp_zigzag", "No. of Zig Zag children"),
        ("mp_to_refer", "No. of children to be referred (GF2, Zig Zag, SAM, SUW, Illness)"),
        ("mp_implausible", "No. of children with implausible measurements (both height and weight)"),
    ],
    "mm_referral": [
        ("mm_to_refer", "No. of children to be referred (GF2, Zig-Zag, SAM, SUW and Illness)"),
        ("mm_referred", "No. of children actually referred"),
        ("mm_nrc_admitted", "No. of children admitted to NRC"),
    ],
    "mm_quarter": [
        ("mm_uw_worse", "No. of children who moved from Normal to Moderate or Severe Underweight (quarterly)"),
        ("mm_wasting_worse", "No. of children who moved from Normal to Moderate or Severe Wasting (quarterly)"),
        ("mm_uw_better", "No. of children who moved from Severe to Normal or Moderate Underweight (quarterly)"),
        ("mm_wasting_better", "No. of children who moved from Severe to Normal or Moderate Wasting (quarterly)"),
    ],
    "mm_gf": [
        ("mm_gf1_to_gf2", "No. of children who moved from GF1 to GF2"),
        ("mm_gf2_to_gf1", "No. of children who moved from GF2 to GF1"),
    ],
    "mm_last3": [
        ("mm_sam_3m", "No. of children in the SAM category during the last 3 months"),
        ("mm_suw_3m", "No. of children in the SUW category during the last 3 months"),
    ],
    "ci_creche": [
        ("ci_sup_lt3", "No. of Creches with fewer than 3 supervisor check-ins in a month"),
        ("ci_sup_none", "No. of Creches with no supervisor check-ins in a month"),
        ("ci_not_opening", "No. of Creches where check-in was not performed during opening hours (for the month)"),
        ("ci_not_closing", "No. of Creches where check-in was not performed during closing hours (for the month)"),
    ],
    "ci_cadre": [
        ("ci_cc_low", "No. of Cluster Coordinators with fewer than 40 check-ins"),
        ("ci_tc_low", "No. of Training Coordinators with fewer than 20 check-ins"),
        ("ci_mis_low", "No. of MIS Coordinators with fewer than 20 check-ins"),
        ("ci_sc_low", "No. of Safety Coordinators with fewer than 20 check-ins"),
        ("ci_lc_low", "No. of Logistics Coordinators with fewer than 20 check-ins"),
    ],
    "sf_month": [
        ("sf_not_audited", "No. of Creches That Have Not Completed Safety Audits"),
        ("sf_infra", "No. of Creches with Infrastructural and Environmental Safety Issues"),
        ("sf_physical", "No. of Creches with Physical Safety and Security Issues"),
        ("sf_fire", "No. of Creches with Fire Safety Issues"),
        ("sf_electrical", "No. of Creches with Electrical Safety Issues"),
        ("sf_food", "No. of Creches with Food Safety Issues"),
        ("sf_other", "No. of Creches with Other Safety Issues"),
    ],
    "lg_fuel": [
        ("lg_lpg_not_updated", "No. of Creches with LPG Status Not Updated"),
        ("lg_fire_not_updated", "No. of Creches with Fire Extinguisher Status Not Updated"),
        ("lg_alt_fuel", "No. of Creches Operating Using Alternative Fuel Sources"),
        ("lg_lpg_one_month", "No. of Creches with LPG Remaining for One Month"),
        ("lg_fire_expired", "No. of Creches with Expired Fire Extinguishers"),
        ("lg_fire_refill_pending", "No. of Creches Where Fire Extinguishers Have Been Awaiting Refilling for More Than One Month"),
    ],
}


@frappe.whitelist()
@scoped()
def review_card_group(group=None, partner_id=None, state_id=None, district_id=None, gp_id=None, block_id=None, creche_id=None, year=None, month=None, supervisor_id=None, cstart_date=None, cend_date=None, c_status=None, phases=None, from_date=None, to_date=None):
    """The cards of a section that read the same data, counted together in one query."""
    if group not in CARD_GROUPS:
        frappe.throw("Unknown card group")

    params = build_review_params(partner_id, state_id, district_id, gp_id, block_id, creche_id, year, month, supervisor_id, cstart_date, cend_date, c_status, phases, from_date=from_date, to_date=to_date)
    counts = count_cases(get_sources(params)["groups"][group], params)

    section = {
        "mp": "Malnutrition Prevalence", "mm": "Malnutrition Management", "ci": "Check-In Indicators",
        "sf": "Safety", "lg": "Logistics",
    }[group[:2]]
    frappe.response["data"] = {
        section: [item(card_id, title, counts[card_id]) for card_id, title in CARD_GROUPS[group]]
    }
