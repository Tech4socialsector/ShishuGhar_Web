import json

import frappe
from frappe.apf.user_scope import scoped

from .review_card import (
    AREA_COLS,
    CADRE_CHECKINS,
    CASHBOOK_BALANCE,
    CHILD_ATT_PCT,
    CHILD_FROM,
    CRECHE_ID_COLS,
    CASHBOOK_WEEK_DAYS,
    CURRENT_AGE,
    ELIGIBLE_CHILD_WHERE,
    ENROLLED_COUNTS_JOIN,
    EXIT_REF,
    GEO_JOINS,
    GF1_NOW,
    GF1_PLUS_NOW,
    GF1_PREV,
    GF2_NOW,
    GF2_PREV,
    GF2_REF,
    MODERATE,
    NORMAL,
    OVERAGE_MONTHS,
    SAFETY_ANSWER_NAMES,
    SAFETY_CATEGORIES,
    SAFETY_QUESTIONS,
    SAFETY_UNRESOLVED,
    SEVERE,
    STOCK_YEAR_OFFSET,
    WELCOME_REF,
    ZIGZAG_NOW,
    ZIGZAG_PATTERN_NOW,
    ZZ_MAX,
    build_review_params,
    cashbook_week_due,
    flag,
    get_sources,
    is_infant,
    operational_scope,
    safety_audit_issues,
    safety_conditions,
    safety_flag,
    safety_issue_count,
)

# The UI turns these two into a link to the child's growth monitoring page and
# hides every column that starts with an underscore.
LINK_COLS = "cee.name AS _child_docname, cr.name AS _creche_docname"

CHILD_COLS = """
    cee.child_name AS "Child Name",
    DATE_FORMAT(cee.child_dob, '%%d-%%m-%%Y') AS "DOB",
    TIMESTAMPDIFF(MONTH, cee.child_dob, %(end_date)s) AS "Current Age",
    CASE WHEN cee.gender_id = 1 THEN 'M' ELSE 'F' END AS "Gender",
    DATE_FORMAT(cee.date_of_enrollment, '%%d-%%m-%%Y') AS "Date Of Enrollment"
"""

OPENING_DATE_COL = "DATE_FORMAT(cr.creche_opening_date, '%%d-%%m-%%Y') AS \"Opening Date\""

REASON_FOR_EXIT_COL = """
    CASE cee.reason_for_exit
        WHEN 1 THEN 'Migrated'
        WHEN 2 THEN 'Graduated'
        WHEN 3 THEN 'Not willing to Stay'
        WHEN 4 THEN 'Death'
        WHEN 5 THEN 'Other'
        ELSE 'Unknown'
    END AS "Reason For Exit"
"""

GEO_ORDER_COLS = ["p.partner_name", "s.state_name", "d.district_name", "b.block_name", "g.gp_name", "cr.creche_name"]


def equipment_name(column):
    return f"CASE {column} WHEN 1 THEN 'Stadiometer' WHEN 2 THEN 'Infantometer' ELSE '-' END"


def order_by(*tail):
    cols = GEO_ORDER_COLS + list(tail)
    return "ORDER BY " + ", ".join(f"TRIM(CONVERT({c} USING utf8mb4))" for c in cols)


def creche_list(source, extra_cols="", joins=""):
    extra = f", {extra_cols}" if extra_cols else ""
    return f"""
        SELECT {CRECHE_ID_COLS}, {OPENING_DATE_COL}{extra}, {AREA_COLS}
        FROM {source['from']} {joins} {GEO_JOINS}
        WHERE {source['where']}
        {order_by()}
    """


def child_list(source, extra_cols=""):
    extra = f"{extra_cols}," if extra_cols else ""
    return f"""
        SELECT {CHILD_COLS}, {extra} {CRECHE_ID_COLS}, {AREA_COLS}, {LINK_COLS}
        FROM {source['from']} {GEO_JOINS}
        WHERE {source['where']}
        {order_by('cee.child_name')}
    """


def build_op_creches(s):
    return creche_list(s["op_creches"])


def build_profile_not_submitted(s):
    return creche_list(s["profile_not_submitted"])


def build_hh_not_done(s):
    last_visit = """
        IFNULL((
            SELECT DATE_FORMAT(MAX(COALESCE(hf.date_of_visit, DATE(hf.app_created_on))), '%%d-%%m-%%Y')
            FROM `tabHousehold Form` hf
            WHERE hf.creche_id = cr.name AND IFNULL(hf.is_deleted, 0) = 0
        ), '-') AS "Last HH Visit"
    """
    return creche_list(s["hh_not_done"], last_visit)


def build_low_enrolment(s):
    return creche_list(s["low_enrolment"], 'IFNULL(en.cnt, 0) AS "Enrolled Children"')


# The first two attendance tables show both measures, so a creche can be read against either rule.
ATTENDANCE_COLS = """
    IFNULL(en.cnt, 0) AS "Enrolled Children",
    od.open_days AS "Open Days",
    IFNULL(pr.present, 0) AS "Children Present (Total)",
    pr.child_days AS "Child-Days Recorded",
    IFNULL(ROUND(IFNULL(pr.present, 0) * 100.0 / NULLIF(pr.child_days, 0), 2), 0) AS "Average Attendance (%%)",
    IFNULL(ROUND(IFNULL(pr.present, 0) / NULLIF(od.open_days, 0), 1), 0) AS "Daily Average Attendance"
"""


def build_att_avg_below_50(s):
    return creche_list(s["att_avg_below_50"], ATTENDANCE_COLS, ENROLLED_COUNTS_JOIN)


def build_att_daily_below_10(s):
    return creche_list(s["att_daily_below_10"], ATTENDANCE_COLS, ENROLLED_COUNTS_JOIN)


def _child_attendance_list(source):
    extra = f"""
        IFNULL(att.open_days, 0) AS "Eligible Open Days",
        IFNULL(att.days_attended, 0) AS "Days Attended",
        {CHILD_ATT_PCT} AS "Attendance (%%)"
    """
    return child_list(source, extra)


def build_att_children_zero(s):
    return _child_attendance_list(s["att_children_zero"])


def build_att_children_below_50(s):
    return _child_attendance_list(s["att_children_below_50"])


def build_att_closed_over_7(s):
    return creche_list(s["att_closed_over_7"], 'IFNULL(en.cnt, 0) AS "Enrolled Children", cld.closed_days AS "Days Closed"', ENROLLED_COUNTS_JOIN)


def _missed_days_list(source, s):
    extra = f"""
        IFNULL(en.cnt, 0) AS "Enrolled Children",
        {s['eligible_days']} AS "Days Attendance Due",
        IFNULL(sbm.submitted_days, 0) AS "Days Submitted",
        {s['missed_days']} AS "Days Not Submitted"
    """
    return creche_list(source, extra, ENROLLED_COUNTS_JOIN)


def build_att_missed_over_5(s):
    return _missed_days_list(s["att_missed_over_5"], s)


def build_att_missed_all(s):
    return _missed_days_list(s["att_missed_all"], s)


# One row per partner / block / district, so the table always has exactly as
# many rows as the card's distinct count. The related names are combined into
# one cell (alphabetical, comma separated) instead of one row per creche.
HIERARCHY_JOINS = """
    LEFT JOIN `tabPartner` p ON p.name = cr.partner_id
    LEFT JOIN `tabState` s ON s.name = cr.state_id
    LEFT JOIN `tabDistrict` d ON d.name = cr.district_id
    LEFT JOIN `tabBlock` b ON b.name = cr.block_id
"""

# Long name lists need more than MySQL's 1024-character GROUP_CONCAT default.
GROUP_CONCAT_QUERY_TYPES = {
    "op_partners", "op_blocks", "op_districts",
    # the children listed in the wrong-equipment table
    "mp_wrong_equipment",
    # the creche / geography lists of the coordinator tables
    *(f"ci_{key}_low" for key in CADRE_CHECKINS),
}


def names(column):
    return f"GROUP_CONCAT(DISTINCT {column} ORDER BY {column} SEPARATOR ', ')"


def hierarchy_list(source, key_column, columns, group_by, order):
    # The card counts COUNT(DISTINCT key), which skips NULL keys, so the table must too.
    return f"""
        SELECT {columns}
        FROM {source['from']} {HIERARCHY_JOINS}
        WHERE {source['where']} AND {key_column} IS NOT NULL
        GROUP BY {group_by}
        ORDER BY {order}
    """


def build_op_partners(s):
    columns = f"""
        p.partner_name AS "Partner",
        COUNT(DISTINCT cr.name) AS "Operational Creches",
        {names('s.state_name')} AS "States",
        {names('d.district_name')} AS "Districts",
        {names('b.block_name')} AS "Blocks"
    """
    return hierarchy_list(s["op_creches"], "cr.partner_id", columns, "cr.partner_id, p.partner_name", "p.partner_name")


def build_op_blocks(s):
    columns = f"""
        b.block_name AS "Block",
        MIN(d.district_name) AS "District",
        MIN(s.state_name) AS "State",
        {names('p.partner_name')} AS "Partners"
    """
    return hierarchy_list(s["op_creches"], "cr.block_id", columns, "cr.block_id, b.block_name", "MIN(s.state_name), MIN(d.district_name), b.block_name")


def build_op_districts(s):
    columns = f"""
        d.district_name AS "District",
        MIN(s.state_name) AS "State",
        {names('b.block_name')} AS "Blocks",
        {names('p.partner_name')} AS "Partners"
    """
    return hierarchy_list(s["op_creches"], "cr.district_id", columns, "cr.district_id, d.district_name", "MIN(s.state_name), d.district_name")


def build_no_welcome_anthro(s):
    extra = """
        CASE WHEN IFNULL(cee.measurement_taken, 0) = 1 THEN 'Yes' ELSE 'No' END AS "Measurement Taken",
        cee.weight AS "Weight (kg)",
        cee.height AS "Height (cm)"
    """
    return child_list(s["no_welcome_anthro"], extra)


def build_no_exit_anthro(s):
    extra = f"""
        DATE_FORMAT(cee.date_of_exit, '%%d-%%m-%%Y') AS "Date Of Exit",
        {REASON_FOR_EXIT_COL},
        cee.weight_exit AS "Weight At Exit (kg)",
        cee.height_exit AS "Height At Exit (cm)"
    """
    return child_list(s["no_exit_anthro"], extra)


def _wrong_equipment_branch(stage, ref, equipment_col, where):
    extra = f"""
        '{stage}' AS "Anthro Stage",
        DATE_FORMAT({ref}, '%%d-%%m-%%Y') AS "Measurement Date",
        TIMESTAMPDIFF(MONTH, cee.child_dob, {ref}) AS "Age At Measurement (Months)",
        {equipment_name(equipment_col)} AS "Equipment Used",
        CASE WHEN {is_infant(ref)} THEN 'Infantometer' ELSE 'Stadiometer' END AS "Expected Equipment"
    """
    return f"""
        SELECT {CHILD_COLS}, {extra}, {CRECHE_ID_COLS}, {AREA_COLS}, {LINK_COLS}
        FROM {CHILD_FROM} {GEO_JOINS}
        WHERE {where}
    """


def build_wrong_equipment(s):
    welcome = _wrong_equipment_branch("Welcome Anthro", WELCOME_REF, "cee.measurement_equipment", s["wrong_equipment_welcome"]["where"])
    exit_ = _wrong_equipment_branch("Exit Anthro", EXIT_REF, "cee.measurement_equipment_exit", s["wrong_equipment_exit"]["where"])
    return f"""
        SELECT * FROM ({welcome} UNION ALL {exit_}) w
        ORDER BY w.`Partner`, w.`State`, w.`District`, w.`Block`, w.`GP`, w.`Creche`, w.`Child Name`, w.`Anthro Stage`
    """


def build_eligible(s):
    src = s["eligible"]
    return f"""
        SELECT
            hhc.child_name AS "Child Name",
            DATE_FORMAT(hhc.child_dob, '%%d-%%m-%%Y') AS "DOB",
            TIMESTAMPDIFF(MONTH, hhc.child_dob, %(end_date)s) AS "Current Age",
            CASE WHEN hhc.gender_id = 1 THEN 'M' ELSE 'F' END AS "Gender",
            CASE WHEN EXISTS (
                SELECT 1 FROM `tabChild Enrollment and Exit` e
                WHERE e.hhcguid = hhc.hhcguid AND e.is_exited = 0
            ) THEN 'Yes' ELSE 'No' END AS "Is Enrolled?",
            {CRECHE_ID_COLS},
            {AREA_COLS}
        FROM {src['from']} {GEO_JOINS}
        WHERE {src['where']}
        {order_by('hhc.child_name')}
    """


def build_current_enrolled(s):
    return child_list(s["current_enrolled"])


def build_enrolled_month(s):
    return child_list(s["enrolled_month"])


def build_exited_month(s):
    extra = f"""
        DATE_FORMAT(cee.date_of_exit, '%%d-%%m-%%Y') AS "Date Of Exit",
        {REASON_FOR_EXIT_COL}
    """
    return child_list(s["exited_month"], extra)


def build_overage_not_exited(s):
    extra = f"""
        DATE_FORMAT(DATE_ADD(cee.child_dob, INTERVAL {OVERAGE_MONTHS} MONTH), '%%d-%%m-%%Y') AS "Completed 36 Months On"
    """
    return child_list(s["overage_not_exited"], extra)


def build_eligible_vs_enrolled(s):
    """One row per creche: eligible children, enrolled children and the enrolment %."""
    return f"""
        SELECT
            {CRECHE_ID_COLS},
            IFNULL(el.cnt, 0) AS "Current Eligible Children",
            IFNULL(en.cnt, 0) AS "Current Enrolled Children",
            CASE WHEN IFNULL(el.cnt, 0) = 0 THEN '-'
                 ELSE CONCAT(ROUND(IFNULL(en.cnt, 0) * 100 / el.cnt, 1), '%%') END AS "Enrolled / Eligible %%",
            {AREA_COLS}
        FROM `tabCreche` cr
        LEFT JOIN (
            SELECT hf.creche_id, COUNT(hhc.name) AS cnt
            FROM `tabHousehold Child Form` hhc
            INNER JOIN `tabHousehold Form` hf ON hf.name = hhc.parent
            WHERE {ELIGIBLE_CHILD_WHERE}
            GROUP BY hf.creche_id
        ) el ON el.creche_id = cr.name
        LEFT JOIN (
            SELECT cee.creche_id, COUNT(*) AS cnt
            FROM `tabChild Enrollment and Exit` cee
            WHERE cee.date_of_enrollment <= %(end_date)s
              AND (cee.date_of_exit IS NULL OR cee.date_of_exit > %(end_date)s)
            GROUP BY cee.creche_id
        ) en ON en.creche_id = cr.name
        {GEO_JOINS}
        WHERE {s['scope']}
          AND (IFNULL(el.cnt, 0) > 0 OR IFNULL(en.cnt, 0) > 0)
        {order_by()}
    """


def build_enrolment_exit_ratio(s):
    """One row per creche that enrolled or exited a child this month."""
    return f"""
        SELECT
            {CRECHE_ID_COLS},
            IFNULL(en.cnt, 0) AS "Enrolled",
            IFNULL(ex.cnt, 0) AS "Exited",
            IFNULL(tbe.cnt, 0) AS "Children to be Enrolled",
            {AREA_COLS}
        FROM `tabCreche` cr
        LEFT JOIN (
            SELECT cee.creche_id, COUNT(*) AS cnt
            FROM `tabChild Enrollment and Exit` cee
            WHERE cee.date_of_enrollment BETWEEN %(start_date)s AND %(end_date)s
            GROUP BY cee.creche_id
        ) en ON en.creche_id = cr.name
        LEFT JOIN (
            SELECT cee.creche_id, COUNT(*) AS cnt
            FROM `tabChild Enrollment and Exit` cee
            WHERE cee.date_of_exit BETWEEN %(start_date)s AND %(end_date)s
            GROUP BY cee.creche_id
        ) ex ON ex.creche_id = cr.name
        LEFT JOIN (
            SELECT hf.creche_id, COUNT(hhc.name) AS cnt
            FROM `tabHousehold Child Form` hhc
            INNER JOIN `tabHousehold Form` hf ON hf.name = hhc.parent
            WHERE {ELIGIBLE_CHILD_WHERE}
              AND NOT EXISTS (
                  SELECT 1 FROM `tabChild Enrollment and Exit` e
                  WHERE e.hhcguid = hhc.hhcguid AND e.is_exited = 0
              )
            GROUP BY hf.creche_id
        ) tbe ON tbe.creche_id = cr.name
        {GEO_JOINS}
        WHERE {s['scope']}
          AND (IFNULL(en.cnt, 0) > 0 OR IFNULL(ex.cnt, 0) > 0)
        {order_by()}
    """


# ---------------------------------------------------------------------------
# Malnutrition Management
# ---------------------------------------------------------------------------
def yes_no(condition, label):
    return f"CASE WHEN {condition} THEN 'Yes' ELSE 'No' END AS \"{label}\""


def category_name(column):
    return f"CASE {column} WHEN {NORMAL} THEN 'Normal' WHEN {MODERATE} THEN 'Moderate' WHEN {SEVERE} THEN 'Severe' ELSE '-' END"


def growth_faltering_name(gf1, gf2):
    """A child that is both GF1 and GF2 counts as GF2."""
    return f"CASE WHEN {flag(gf2)} = 1 THEN 'GF2' WHEN {flag(gf1)} = 1 THEN 'GF1' ELSE 'None' END"


# Why a child is to be referred.
REFER_REASON_COLS = [
    yes_no(flag(GF2_NOW) + " = 1", "GF2"),
    yes_no(flag(ZIGZAG_NOW) + " = 1", "Zig-Zag"),
    yes_no(f"c.weight_for_height = {SEVERE}", "SAM"),
    yes_no(f"c.weight_for_age = {SEVERE}", "SUW"),
    yes_no("ill.childenrollguid IS NOT NULL", "Illness"),
]


def build_referral_card(card):
    """To be referred / referred / admitted to NRC share one row layout, so the three tables can be compared."""
    def build(s):
        extra = ", ".join([
            *REFER_REASON_COLS,
            yes_no("rf.childenrolledguid IS NOT NULL", "Referred"),
            yes_no("nr.childenrollguid IS NOT NULL", "Admitted To NRC"),
        ])
        return child_list(s[card], extra)
    return build


def build_quarter_card(card, label, previous, current):
    def build(s):
        extra = (
            f"{category_name(previous)} AS \"{label} (Previous Quarter)\", "
            f"{category_name(current)} AS \"{label} (Current Quarter)\""
        )
        return child_list(s[card], extra)
    return build


def build_growth_faltering_card(card):
    def build(s):
        extra = f"""
            ROUND(h.m1, 2) AS "WAZ (Previous Month)",
            ROUND(c.waz, 2) AS "WAZ (Selected Month)",
            {growth_faltering_name(GF1_PREV, GF2_PREV)} AS "Growth Faltering (Previous Month)",
            {growth_faltering_name(GF1_NOW, GF2_NOW)} AS "Growth Faltering (Selected Month)"
        """
        return child_list(s[card], extra)
    return build


def build_last_three_months_card(card, label, count_column, last_column):
    def build(s):
        extra = f"""
            {count_column} AS "{label} Measurements (Last 3 Months)",
            DATE_FORMAT({last_column}, '%%d-%%m-%%Y') AS "Latest {label} Measurement"
        """
        return child_list(s[card], extra)
    return build


# ---------------------------------------------------------------------------
# Malnutrition Prevalence
#
# One layout for the whole tab: the partner and supervisor, the creche and its area, then (for the cards that
# count children) the child and what the card is about. The three status columns are shown in colour by the page
# (Normal green, Moderate yellow, Severe red). Child rows are the children's latest measurement of the month,
# as the cards count them.
# ---------------------------------------------------------------------------
MP_AREA = [
    ("cr.creche_name", "Creche Name"),
    ("p.partner_name", "Name of the partner"),
    ("(SELECT su.full_name FROM `tabUser` su WHERE su.name = cr.supervisor_id)", "Name of the supervisor"),
    ("s.state_name", "State"),
    ("d.district_name", "District"),
    ("b.block_name", "Block"),
    ("g.gp_name", "Gram Panchayat/Settlement"),
]


def mp_area_cols(aggregate=False):
    """The partner ... creche columns; wrapped in MAX() for a table that has one row per creche out of many child rows."""
    return ", ".join(
        f'{f"MAX({expression})" if aggregate else expression} AS "{label}"' for expression, label in MP_AREA
    )


MP_STATUS_COLS = f"""
    {category_name('c.weight_for_age')} AS "Weight-for-Age Status",
    {category_name('c.weight_for_height')} AS "Weight-for-Height Status",
    {category_name('c.height_for_age')} AS "Height-for-Age Status"
"""


def mp_creche_list(source, extra_cols=""):
    extra = f", {extra_cols}" if extra_cols else ""
    return f"""
        SELECT {mp_area_cols()}{extra}
        FROM {source['from']} {GEO_JOINS}
        WHERE {source['where']}
        {order_by()}
    """


def mp_child_list(source, extra_cols):
    return f"""
        SELECT cee.child_name AS "Name of the child", {mp_area_cols()}, {extra_cols}, {LINK_COLS}
        FROM {source['from']} {GEO_JOINS}
        WHERE {source['where']}
        {order_by('cee.child_name')}
    """


def build_mp_measure_below_100(s):
    return mp_creche_list(s["mp_measure_below_100"], 'ROUND(cov.measured * 100.0 / cov.enrolled, 2) AS "Measurement %%"')


def build_mp_not_submitted(s):
    return mp_creche_list(s["mp_not_submitted"])


def build_mp_wrong_equipment(s):
    """One row per creche (as the card counts), listing the children measured with the wrong equipment."""
    source = s["mp_wrong_equipment"]
    expected = f"CASE WHEN {is_infant('c.measured_on')} THEN 'Infantometer' ELSE 'Stadiometer' END"
    details = (
        "GROUP_CONCAT(CONCAT(cee.child_name, ' (', TIMESTAMPDIFF(MONTH, cee.child_dob, c.measured_on), ' months, measured ', "
        f"DATE_FORMAT(c.measured_on, '%%d-%%m-%%Y'), '): ', {equipment_name('c.measurement_equipment')}, ' used, ', {expected}, ' needed') "
        "ORDER BY cee.child_name SEPARATOR '; ') AS \"Details of wrong equipment used\""
    )
    return f"""
        SELECT {mp_area_cols(aggregate=True)}, {details}
        FROM {source['from']} {GEO_JOINS}
        WHERE {source['where']}
        GROUP BY cr.name
        ORDER BY `Name of the partner`, `State`, `District`, `Block`, `Gram Panchayat/Settlement`, `Creche Name`
    """


def build_mp_implausible(s):
    def outside(measure, low, high, unit):
        return (
            f"CASE WHEN c.{measure} < who.{low} OR c.{measure} > who.{high} THEN CONCAT('{measure.capitalize()} ', c.{measure}, ' {unit} is ', "
            f"IF(c.{measure} < who.{low}, 'below', 'above'), ' the plausible range of ', who.{low}, '-', who.{high}, ' {unit}') END"
        )
    details = (
        f"CONCAT_WS('; ', CONCAT('Age checked: ', {CURRENT_AGE}, ' months'), "
        f"{outside('weight', 'wmin', 'wmax', 'kg')}, {outside('height', 'hmin', 'hmax', 'cm')}) AS \"Details of the implausible data\""
    )
    return mp_child_list(s["mp_implausible"], details)


def build_mp_snc(s):
    # SNC is any one of these, so say which ones the child meets.
    status = f"""
        CONCAT_WS(', ',
            CASE WHEN {GF1_NOW} THEN 'GF1' END,
            CASE WHEN {GF1_PLUS_NOW} THEN 'GF1+' END,
            CASE WHEN {GF2_NOW} THEN 'GF2' END,
            CASE WHEN {ZIGZAG_PATTERN_NOW} THEN 'Zig-Zag' END,
            CASE WHEN c.weight_for_height = {SEVERE} THEN 'SAM' END,
            CASE WHEN c.weight_for_age = {SEVERE} THEN 'SUW' END
        ) AS "Malnutrition Status"
    """
    return mp_child_list(s["mp_snc"], f"{status}, {MP_STATUS_COLS}")


def build_mp_sam(s):
    return mp_child_list(s["mp_sam"], f'ROUND(CAST(c.whz AS DECIMAL(10,4)), 2) AS "WHZ", {MP_STATUS_COLS}')


def build_mp_suw(s):
    return mp_child_list(s["mp_suw"], f'ROUND(c.waz, 2) AS "WAZ", {MP_STATUS_COLS}')


# The weight-for-age z-score of the selected month and the two before it (the "last 3 months" of the cards), oldest first.
WAZ_LAST_THREE_MONTHS = (
    "CONCAT_WS(' | ', "
    "CONCAT(DATE_FORMAT(%(m2_start)s, '%%b %%Y'), ': ', IFNULL(CAST(ROUND(h.m2, 2) AS CHAR), '-')), "
    "CONCAT(DATE_FORMAT(%(m1_start)s, '%%b %%Y'), ': ', IFNULL(CAST(ROUND(h.m1, 2) AS CHAR), '-')), "
    "CONCAT(DATE_FORMAT(%(month_start)s, '%%b %%Y'), ': ', IFNULL(CAST(ROUND(c.waz, 2) AS CHAR), '-'))"
    ') AS "WAZ for last 3 months"'
)


def build_mp_gf2(s):
    return mp_child_list(s["mp_gf2"], f"{WAZ_LAST_THREE_MONTHS}, {MP_STATUS_COLS}")


def build_mp_zigzag(s):
    return mp_child_list(s["mp_zigzag"], f"{WAZ_LAST_THREE_MONTHS}, {MP_STATUS_COLS}")


def build_mp_to_refer(s):
    reasons = f"""
        CONCAT_WS(', ',
            CASE WHEN {flag(GF2_NOW)} = 1 THEN 'GF2' END,
            CASE WHEN {flag(ZIGZAG_NOW)} = 1 THEN 'Zig-Zag' END,
            CASE WHEN c.weight_for_height = {SEVERE} THEN 'SAM' END,
            CASE WHEN c.weight_for_age = {SEVERE} THEN 'SUW' END,
            CASE WHEN ill.childenrollguid IS NOT NULL THEN 'Illness' END
        ) AS "Reason to be referred"
    """
    return mp_child_list(s["mp_to_refer"], f"{reasons}, {MP_STATUS_COLS}")


# ---------------------------------------------------------------------------
# Check-In
#
# The tables of this tab have one layout: who (the supervisor or coordinator), the creche and its area, then
# what the card is about.
# ---------------------------------------------------------------------------
SUPERVISOR_COL = '(SELECT su.full_name FROM `tabUser` su WHERE su.name = cr.supervisor_id) AS "Supervisor"'

CHECKIN_AREA_COLS = """
    g.gp_name AS "GP",
    b.block_name AS "Block",
    d.district_name AS "District",
    s.state_name AS "State",
    p.partner_name AS "Partner"
"""

CHECKIN_TIME = "'%%h:%%i %%p'"


def checkin_list(source, extra_cols="", joins="", who=SUPERVISOR_COL, order=None):
    extra = f", {extra_cols}" if extra_cols else ""
    return f"""
        SELECT cr.creche_name AS "Creche", {date_col('cr.creche_opening_date', 'Creche Opening Date')}, {who}, {CHECKIN_AREA_COLS}{extra}
        FROM {source['from']} {joins} {GEO_JOINS}
        WHERE {source['where']}
        {order or order_by()}
    """


def build_ci_sup_lt3(s):
    return checkin_list(s["ci_sup_lt3"], 'IFNULL(sci.sup_checkins, 0) AS "No of check ins done"')


def build_ci_sup_none(s):
    return checkin_list(s["ci_sup_none"])


def build_ci_short_engagement(s):
    """One row per supervisor check-in on a day that adds up to less than the minimum engagement. The app records
    no check-out, so the check-out time is the last check-in of that day at that creche."""
    extra = f"""
        {date_col('chi.date_of_checkin', 'Date of visit')},
        TIME_FORMAT(TIME(chi.appcreated_on), {CHECKIN_TIME}) AS "Check in time",
        TIME_FORMAT(dd.last_time, {CHECKIN_TIME}) AS "Check out time"
    """
    return checkin_list(
        s["ci_short_engagement"], extra, who='tu.full_name AS "Supervisor"',
        order=order_by('chi.date_of_checkin', 'chi.appcreated_on'),
    )


def build_ci_not_opening(s):
    """The creche's opening and closing time, and the date of the supervisor's latest check-in of the month ('-' if none)."""
    extra = f"""
        IFNULL(DATE_FORMAT(sci.last_visit, '%%d-%%m-%%Y'), '-') AS "Date of visit",
        IFNULL(TIME_FORMAT(cr.creche_openning_time, {CHECKIN_TIME}), '-') AS "Creche opening time",
        IFNULL(TIME_FORMAT(cr.creche_closing_time, {CHECKIN_TIME}), '-') AS "Creche closing time"
    """
    return checkin_list(s["ci_not_opening"], extra)


def build_ci_not_closing(s):
    """The day of the supervisor's latest check-in of the month ('-' if none) with the first and last check-in of that day."""
    joins = """
        LEFT JOIN (
            SELECT chd.creche_id, chd.date_of_checkin AS visit_date,
                   MIN(TIME(chd.appcreated_on)) AS first_time, MAX(TIME(chd.appcreated_on)) AS last_time
            FROM `tabCreche Check In` chd
            INNER JOIN `tabUser` tud ON tud.name = chd.appcreated_by AND tud.type = %(sup_type)s
            WHERE chd.date_of_checkin BETWEEN %(start_date)s AND %(end_date)s
            GROUP BY chd.creche_id, chd.date_of_checkin
        ) lv ON lv.creche_id = cr.name AND lv.visit_date = LEFT(sci.last_visit, 10)
    """
    extra = f"""
        IFNULL(DATE_FORMAT(sci.last_visit, '%%d-%%m-%%Y'), '-') AS "Date of visit",
        IFNULL(TIME_FORMAT(lv.first_time, {CHECKIN_TIME}), '-') AS "Check in time",
        IFNULL(TIME_FORMAT(lv.last_time, {CHECKIN_TIME}), '-') AS "Check out time"
    """
    return checkin_list(s["ci_not_closing"], extra, joins)


CADRE_LABELS = {
    "cc": "Cluster Coordinator",
    "tc": "Training coordinator",
    "mis": "MIS coordinator",
    "sc": "Safety coordinator",
    "lc": "Logistics coordinator",
}

# The states, districts, blocks and gram panchayats a user is mapped to (`ug`).
USER_GEOGRAPHY_JOIN = """
    LEFT JOIN (
        SELECT ugm.parent AS user_id,
               GROUP_CONCAT(DISTINCT gg.gp_name ORDER BY gg.gp_name SEPARATOR ', ') AS gps,
               GROUP_CONCAT(DISTINCT bb.block_name ORDER BY bb.block_name SEPARATOR ', ') AS blocks,
               GROUP_CONCAT(DISTINCT dt.district_name ORDER BY dt.district_name SEPARATOR ', ') AS districts,
               GROUP_CONCAT(DISTINCT st.state_name ORDER BY st.state_name SEPARATOR ', ') AS states
        FROM `tabUser Geography Mapping` ugm
        LEFT JOIN `tabGram Panchayat` gg ON gg.name = ugm.gp_id
        LEFT JOIN `tabBlock` bb ON bb.name = ugm.block_id
        LEFT JOIN `tabDistrict` dt ON dt.name = ugm.district_id
        LEFT JOIN `tabState` st ON st.name = ugm.state_id
        GROUP BY ugm.parent
    ) ug ON ug.user_id = u.name
"""


def build_cadre_card(card, key):
    """One row per user with fewer check-ins than the cadre needs: the creches they checked in at this month,
    the geography they are mapped to and how many check-ins they made."""
    def build(s):
        source = s[card]
        return f"""
            SELECT u.full_name AS "{CADRE_LABELS[key]}",
                IFNULL(ck.creches, '-') AS "Creche",
                IFNULL(ug.gps, '-') AS "GP",
                IFNULL(ug.blocks, '-') AS "Block",
                IFNULL(ug.districts, '-') AS "District",
                IFNULL(ug.states, '-') AS "State",
                IFNULL(pt.partner_name, '-') AS "Partner",
                IFNULL(uc.checkins, 0) AS "No of check ins done"
            FROM {source['from']}
            LEFT JOIN `tabPartner` pt ON pt.name = u.partner
            {USER_GEOGRAPHY_JOIN}
            LEFT JOIN (
                SELECT chu.appcreated_by AS user_id,
                       GROUP_CONCAT(DISTINCT c3.creche_name ORDER BY c3.creche_name SEPARATOR ', ') AS creches
                FROM `tabCreche Check In` chu
                INNER JOIN `tabUser` tu2 ON tu2.name = chu.appcreated_by AND tu2.type = %({key}_type)s
                INNER JOIN `tabCreche` c3 ON c3.name = chu.creche_id
                WHERE chu.date_of_checkin BETWEEN %(start_date)s AND %(end_date)s
                GROUP BY chu.appcreated_by
            ) ck ON ck.user_id = u.name
            WHERE {source['where']}
            ORDER BY u.full_name, u.name
        """
    return build


# ---------------------------------------------------------------------------
# Safety
#
# One layout for the whole tab: the creche, its area and its supervisor, then the number(s) the card is about.
# The questions and the answer that is an issue are the ones of the Safety Indicators report (safety_status).
# ---------------------------------------------------------------------------
def date_col(expression, label):
    return f"DATE_FORMAT({expression}, '%%d-%%m-%%Y') AS \"{label}\""


# "Pending Since": since when an update or an issue has been pending. A creche that has never done the update
# has been pending since it opened.
SINCE_OPENING = "IFNULL(CONCAT(DATE_FORMAT(cr.creche_opening_date, '%%d-%%m-%%Y'), ' (since opening)'), '-')"


def since_month(last_done, label="Pending Since"):
    """The month after the last time it was done (`last_done` is a date), or the month the creche opened."""
    return (
        f"CASE WHEN {last_done} IS NOT NULL THEN DATE_FORMAT(DATE_ADD({last_done}, INTERVAL 1 MONTH), '%%b %%Y') "
        "WHEN cr.creche_opening_date IS NOT NULL THEN CONCAT(DATE_FORMAT(cr.creche_opening_date, '%%b %%Y'), ' (since opening)') "
        f"ELSE '-' END AS \"{label}\""
    )


SAFETY_AREA_COLS = """
    cr.creche_name AS "Creche Name",
    g.gp_name AS "Gram Panchayat",
    b.block_name AS "Block",
    d.district_name AS "District",
    s.state_name AS "State",
    p.partner_name AS "Partner",
    (SELECT su.full_name FROM `tabUser` su WHERE su.name = cr.supervisor_id) AS "Supervisor",
    cr.name AS _creche_docname
"""


def safety_list(source, extra_cols="", joins=""):
    extra = f", {extra_cols}" if extra_cols else ""
    return f"""
        SELECT {SAFETY_AREA_COLS}{extra}
        FROM {source['from']} {joins} {GEO_JOINS}
        WHERE {source['where']}
        {order_by()}
    """


def all_issue_count(a="si"):
    return "(" + " + ".join(safety_issue_count(category, a) for category in SAFETY_CATEGORIES) + ")"


def build_sf_not_audited(s):
    """The month the checklist has been pending since: the month after the creche's last audit."""
    joins = """
        LEFT JOIN (
            SELECT si.creche_id, MAX(si.date_of_visit) AS last_audit
            FROM `tabSafety Indicators` si
            WHERE si.date_of_visit <= %(end_date)s
            GROUP BY si.creche_id
        ) la ON la.creche_id = cr.name
    """
    return safety_list(s["sf_not_audited"], since_month("la.last_audit"), joins)


def build_safety_category(card):
    """How many of the category's questions had the unsafe answer in the audits of the selected month, and since when
    the category has had an issue: the first audit of its current run of audits with an issue in it (`cs`)."""
    def build(s):
        issues = " + ".join(f"MAX({flag(condition)})" for condition, _ in safety_conditions(card))
        joins = f"""
            LEFT JOIN (
                SELECT si.creche_id, ({issues}) AS issues
                FROM `tabSafety Indicators` si
                WHERE si.date_of_visit BETWEEN %(start_date)s AND %(end_date)s
                GROUP BY si.creche_id
            ) st ON st.creche_id = cr.name
            LEFT JOIN (
                SELECT t.creche_id,
                       MIN(CASE WHEN t.has_issue = 1 AND (t.last_ok IS NULL OR t.visit > t.last_ok) THEN t.visit END) AS since
                FROM (
                    SELECT a.creche_id, a.visit, a.has_issue,
                           MAX(CASE WHEN a.has_issue = 0 THEN a.visit END) OVER (PARTITION BY a.creche_id) AS last_ok
                    FROM (
                        SELECT si.creche_id, si.date_of_visit AS visit, {safety_flag(card)} AS has_issue
                        FROM `tabSafety Indicators` si
                        WHERE si.date_of_visit <= %(end_date)s
                    ) a
                ) t
                GROUP BY t.creche_id
            ) cs ON cs.creche_id = cr.name
        """
        extra = f'st.issues AS "Number of Issues Identified", {date_col("cs.since", "Pending Since")}'
        return safety_list(s[card], extra, joins)
    return build


# The number of issues found at a creche's latest audit with issues (`lt`).
LATEST_ISSUE_AUDIT_JOIN = f"""
    LEFT JOIN (
        SELECT si.creche_id, si.date_of_visit AS visit, MAX({all_issue_count()}) AS issues
        FROM `tabSafety Indicators` si
        WHERE si.date_of_visit <= %(end_date)s
        GROUP BY si.creche_id, si.date_of_visit
    ) lt ON lt.creche_id = cr.name AND lt.visit = sh.last_issue
"""


def safety_open_run_join():
    """`sr`: for a creche whose latest audit has issues, how many different issues were found in the current run of
    audits with issues (the audits after its last clean one) and how many of them are in the latest audit."""
    conditions = [condition for category in SAFETY_CATEGORIES for condition, _ in safety_conditions(category)]
    names = [f"q{i}" for i in range(len(conditions))]
    flags = ", ".join(f"{flag(condition)} AS {name}" for name, condition in zip(names, conditions))
    identified = " + ".join(f"IFNULL(MAX(CASE WHEN t.last_clean IS NULL OR t.visit > t.last_clean THEN t.{n} END), 0)" for n in names)
    unresolved = " + ".join(f"IFNULL(MAX(CASE WHEN t.visit = t.last_visit THEN t.{n} END), 0)" for n in names)
    return f"""
        LEFT JOIN (
            SELECT t.creche_id, ({identified}) AS identified, ({unresolved}) AS unresolved
            FROM (
                SELECT b.creche_id, b.visit, {", ".join("b." + n for n in names)},
                       MAX(CASE WHEN b.has_issue = 0 THEN b.visit END) OVER (PARTITION BY b.creche_id) AS last_clean,
                       MAX(b.visit) OVER (PARTITION BY b.creche_id) AS last_visit
                FROM (
                    SELECT a.creche_id, a.visit, {", ".join("a." + n for n in names)},
                           GREATEST({", ".join("a." + n for n in names)}) AS has_issue
                    FROM (
                        SELECT si.creche_id, si.date_of_visit AS visit, {flags}
                        FROM `tabSafety Indicators` si
                        WHERE si.date_of_visit <= %(end_date)s
                    ) a
                ) b
            ) t
            GROUP BY t.creche_id
        ) sr ON sr.creche_id = cr.name
    """


def build_sf_identified(s):
    """Issues found at the latest audit with issues; pending since the first audit of the current run of audits with
    issues, or 'Resolved' when a clean audit came after the last one with issues."""
    pending = (
        f"CASE WHEN {SAFETY_UNRESOLVED} THEN DATE_FORMAT(sh.open_since, '%%d-%%m-%%Y') ELSE 'Resolved' END "
        'AS "Pending Since"'
    )
    return safety_list(s["sf_identified"], f'lt.issues AS "Number of Issues Identified", {pending}', LATEST_ISSUE_AUDIT_JOIN)


def build_sf_unresolved(s):
    extra = (
        'sr.identified AS "Number of Issues Identified", sr.unresolved AS "Number of Issues Unresolved", '
        + date_col("sh.open_since", "Pending Since")
    )
    return safety_list(s["sf_unresolved"], extra, safety_open_run_join())


def safety_card_audits(card, params, audits):
    """The audits a Safety card reads for one creche, and the questions still unsafe at the creche's latest audit.

    `audits` are the creche's Safety Indicators rows up to the end of the period, oldest first. The result is
    ([(audit date, {question: unsafe answer})], {questions unsafe at the latest audit}), following the SQL of the card:
    the category cards read the audits of the period, 'Safety Issues Identified' the latest audit with issues (the one
    with most issues if there are several that day) and 'Unresolved Safety Issues' the creche's current run of audits
    with issues, that is the audits after the last clean one.
    """
    in_category = card in SAFETY_CATEGORIES
    issues = [(a["visit"], safety_audit_issues(a, [card] if in_category else None)) for a in audits]
    if not issues:
        return [], set()

    latest_visit = max(visit for visit, _ in issues)
    still_unsafe = {question for visit, found in issues if visit == latest_visit for question in found}

    if in_category:
        window = [(visit, found) for visit, found in issues if params["start_date"] <= visit <= params["end_date"]]
    elif card == "sf_identified":
        with_issues = [(visit, found) for visit, found in issues if found]
        if not with_issues:
            return [], set()
        last_issue = max(visit for visit, _ in with_issues)
        window = [(last_issue, max((found for visit, found in with_issues if visit == last_issue), key=len))]
    else:
        last_clean = max((visit for visit, found in issues if not found), default=None)
        window = [(visit, found) for visit, found in issues if last_clean is None or visit > last_clean]
    return window, still_unsafe


@frappe.whitelist()
@scoped()
def fetch_safety_questions(card=None, creche_id=None, partner_id=None, state_id=None, district_id=None, gp_id=None, block_id=None, year=None, month=None, supervisor_id=None, cstart_date=None, cend_date=None, c_status=None, phases=None, from_date=None, to_date=None):
    """The questions behind the 'Number of Issues Identified' of a creche in a Safety card's detail, so the page can show
    them in place of opening the Safety status report. One row per question with the unsafe answer."""
    if card not in SAFETY_CATEGORIES and card not in ("sf_identified", "sf_unresolved"):
        frappe.throw("Unknown card")
    if not creche_id:
        frappe.throw("Creche is required")

    params = build_review_params(
        partner_id=partner_id, state_id=state_id, district_id=district_id, gp_id=gp_id, block_id=block_id,
        creche_id=creche_id, year=year, month=month, supervisor_id=supervisor_id, cstart_date=cstart_date,
        cend_date=cend_date, c_status=c_status, phases=phases, from_date=from_date, to_date=to_date,
    )

    # Only a creche the caller's filters and geography allow, as in the card's detail table.
    if not frappe.db.sql(f"SELECT cr.name FROM `tabCreche` cr WHERE {operational_scope(params)}", params):
        frappe.response["data"] = []
        return

    fields = [question[0] for _, questions in SAFETY_CATEGORIES.values() for question in questions]
    audits = frappe.db.sql(
        f"""
        SELECT si.date_of_visit AS visit, {", ".join(f"si.{field}" for field in fields)}
        FROM `tabSafety Indicators` si
        WHERE si.creche_id = %(creche_id)s AND si.date_of_visit <= %(end_date)s
        ORDER BY si.date_of_visit, si.creation
        """,
        params,
        as_dict=True,
    )
    window, still_unsafe = safety_card_audits(card, params, audits)

    # The latest audit of the window that found each question unsafe.
    latest = {}
    for visit, found in window:
        for question, answer in found.items():
            latest[question] = (visit, answer)

    rows = []
    for title, questions in SAFETY_CATEGORIES.values():
        for question in questions:
            field = question[0]
            if field not in latest:
                continue
            visit, answer = latest[field]
            row = {} if card in SAFETY_CATEGORIES else {"Category": title}
            row["Question"] = SAFETY_QUESTIONS[field]
            row["Answer"] = SAFETY_ANSWER_NAMES[answer]
            row["Audit Date"] = visit.strftime("%d-%m-%Y")
            if card == "sf_unresolved":
                row["Status"] = "Unresolved" if field in still_unsafe else "Resolved"
            rows.append(row)

    frappe.response["data"] = rows


# ---------------------------------------------------------------------------
# Logistics
#
# One layout for the whole tab: the creche, its area and its supervisor, then the one thing the card is about.
# ---------------------------------------------------------------------------
LOGISTICS_AREA_COLS = """
    cr.creche_name AS "Name of Creche",
    g.gp_name AS "Gram Panchayat",
    b.block_name AS "Block",
    d.district_name AS "District",
    s.state_name AS "State",
    p.partner_name AS "Partner",
    (SELECT su.full_name FROM `tabUser` su WHERE su.name = cr.supervisor_id) AS "Name of Supervisor"
"""


def logistics_list(source, extra_cols="", joins=""):
    extra = f", {extra_cols}" if extra_cols else ""
    return f"""
        SELECT {LOGISTICS_AREA_COLS}{extra}
        FROM {source['from']} {joins} {GEO_JOINS}
        WHERE {source['where']}
        {order_by()}
    """


def build_lg_plain(card, extra_cols=""):
    def build(s):
        return logistics_list(s[card], extra_cols)
    return build


def build_lg_alt_fuel(s):
    """Pending since the date of the latest LPG supply record, the one that shows the alternative fuel."""
    source_of_fuel = (
        "IF(lp.current_source_of_fuel = 'Other', IFNULL(NULLIF(lp.other, ''), 'Other'), lp.current_source_of_fuel)"
        ' AS "Source of Fuel"'
    )
    return logistics_list(s["lg_alt_fuel"], f'{source_of_fuel}, {date_col("lp.date_of_supply", "Pending Since")}')


def dispatch_col(expression):
    return f"IFNULL(DATE_FORMAT({expression}, '%%d-%%m-%%Y'), '-') AS \"Date of Dispatch for Refilling\""


def build_lg_fire_expired(s):
    """Pending since the date the earliest extinguisher expired."""
    extra = ", ".join([
        date_col("fx.first_expiry", "Date of Expiry"),
        date_col("fx.first_expiry", "Pending Since"),
        dispatch_col("fx.expired_dispatch"),
    ])
    return logistics_list(s["lg_fire_expired"], extra)


def build_lg_fire_refill_pending(s):
    """Pending since it was sent for refilling (the earliest, if several)."""
    extra = ", ".join([
        date_col("fx.refill_expiry", "Date of Expiry"),
        date_col("fx.refill_since", "Pending Since"),
        dispatch_col("fx.refill_dispatch"),
    ])
    return logistics_list(s["lg_fire_refill_pending"], extra)


def build_lg_stock_not_updated(s):
    """The month of the creche's latest stock entry up to the selected month ('Never' if it has none), and the month
    the update has been pending since: the month after it."""
    last_idx = "CAST(csc.year AS SIGNED) * 12 + CAST(csc.month AS SIGNED) - 1"   # Year master id * 12 + month - 1
    joins = f"""
        LEFT JOIN (
            SELECT cs.creche_id, MAX({last_idx}) AS last_idx
            FROM `tabCreche Stock` cs
            INNER JOIN `tabStock Child table` csc ON csc.parent = cs.name
            WHERE {last_idx} <= %(stock_year_id)s * 12 + %(month)s - 1
            GROUP BY cs.creche_id
        ) ls ON ls.creche_id = cr.name
    """
    last_entry = f"DATE_ADD(MAKEDATE(ls.last_idx DIV 12 + {STOCK_YEAR_OFFSET}, 1), INTERVAL ls.last_idx MOD 12 MONTH)"
    last_updated = f"IFNULL(DATE_FORMAT({last_entry}, '%%b %%Y'), 'Never') AS \"Last Updated (Month)\""
    return logistics_list(s["lg_stock_not_updated"], f"{last_updated}, {since_month(last_entry)}", joins)


def build_lg_cashbook_not_updated(s):
    """The month of the creche's latest cashbook entry up to the end of the selected month ('Never' if it has none),
    and the day the update has been pending since: the first day of the first week of the month that is over and
    has no entry."""
    joins = """
        LEFT JOIN (
            SELECT cb.creche_id, MAX(cb.date) AS last_entry
            FROM `tabCashbook` cb
            WHERE cb.date <= %(end_date)s
            GROUP BY cb.creche_id
        ) le ON le.creche_id = cr.name
    """
    last_entry = "IFNULL(DATE_FORMAT(le.last_entry, '%%b %%Y'), 'Never') AS \"Last Entry (Month)\""
    first_missing_week = "CASE " + " ".join(
        f"WHEN {cashbook_week_due(n)} AND IFNULL(cbw.w{n}, 0) = 0 THEN %(wk{n}_start)s"
        for n in range(1, len(CASHBOOK_WEEK_DAYS) + 1)
    ) + " END"
    return logistics_list(
        s["lg_cashbook_not_updated"], f"{last_entry}, {date_col(first_missing_week, 'Pending Since')}", joins
    )


# `zs`: since when the cash balance has stayed at zero or below: the first cashbook day after the last day it was
# above zero. The balance is the one of the card (opening balance + receipts - expenses), taken day by day.
ZERO_BALANCE_SINCE_JOIN = """
    LEFT JOIN (
        SELECT t.creche_id,
               MIN(CASE WHEN t.d > IFNULL(t.last_positive, CAST('1000-01-01' AS DATE)) THEN t.d END) AS since
        FROM (
            SELECT m.creche_id, m.d,
                   MAX(CASE WHEN m.running > 0 THEN m.d END) OVER (PARTITION BY m.creche_id) AS last_positive
            FROM (
                SELECT x.creche_id, x.d,
                       IFNULL(sd.seed, 0) + SUM(x.delta) OVER (PARTITION BY x.creche_id ORDER BY x.d) AS running
                FROM (
                    SELECT r.creche_id, r.date AS d, SUM(COALESCE(r.amount, 0)) AS delta
                    FROM `tabCashbook Receipt` r
                    WHERE r.date <= %(end_date)s
                    GROUP BY r.creche_id, r.date
                    UNION ALL
                    SELECT cb.creche_id, cb.date AS d, -SUM(COALESCE(cb.expense_amount, 0)) AS delta
                    FROM `tabCashbook` cb
                    WHERE cb.date <= %(ref_date)s
                    GROUP BY cb.creche_id, cb.date
                ) x
                LEFT JOIN (
                    SELECT sb.creche_id, MAX(sb.opening_balance) AS seed FROM `tabCashbook` sb GROUP BY sb.creche_id
                ) sd ON sd.creche_id = x.creche_id
            ) m
        ) t
        GROUP BY t.creche_id
    ) zs ON zs.creche_id = cr.name
"""


def build_lg_zero_balance(s):
    extra = f'ROUND({CASHBOOK_BALANCE}) AS "Remaining Balance (in \u20b9)", {date_col("zs.since", "Pending Since")}'
    return logistics_list(s["lg_zero_balance"], extra, ZERO_BALANCE_SINCE_JOIN)


# ---------------------------------------------------------------------------
# Community Engagement
# ---------------------------------------------------------------------------
COMMUNITY_COLS = f"""
    cr.creche_name AS "Creche Name",
    g.gp_name AS "Gram Panchayat",
    b.block_name AS "Block",
    d.district_name AS "District",
    s.state_name AS "State",
    p.partner_name AS "Partner",
    {date_col('cr.creche_opening_date', 'Creche Opening Date')},
    (SELECT su.full_name FROM `tabUser` su WHERE su.name = cr.supervisor_id) AS "Supervisor"
"""


def build_community_card(card, pending, joins=""):
    def build(s):
        source = s[card]
        return f"""
            SELECT {COMMUNITY_COLS}, {pending}
            FROM {source['from']} {joins} {GEO_JOINS}
            WHERE {source['where']}
            {order_by()}
        """
    return build


# The last committee meeting before the period (`lm`): the CMC has been pending since the month after it.
LAST_CMC_MEETING_JOIN = """
    LEFT JOIN (
        SELECT ccm.creche_id, MAX(ccm.meeting_date) AS last_meeting
        FROM `tabCreche Committee Meeting` ccm
        WHERE ccm.meeting_date < %(start_date)s
        GROUP BY ccm.creche_id
    ) lm ON lm.creche_id = cr.name
"""


QUERY_BUILDERS = {
    "op_creches": build_op_creches,
    "op_partners": build_op_partners,
    "op_blocks": build_op_blocks,
    "op_districts": build_op_districts,
    "profile_not_submitted": build_profile_not_submitted,
    "hh_not_done": build_hh_not_done,
    "no_exit_anthro": build_no_exit_anthro,
    "no_welcome_anthro": build_no_welcome_anthro,
    "wrong_equipment": build_wrong_equipment,
    "low_enrolment": build_low_enrolment,
    "eligible": build_eligible,
    "enrolled": build_current_enrolled,
    "enrolled_month": build_enrolled_month,
    "exited_month": build_exited_month,
    "eligible_vs_enrolled": build_eligible_vs_enrolled,
    "enrolment_exit_ratio": build_enrolment_exit_ratio,
    "overage_not_exited": build_overage_not_exited,
    "att_avg_below_50": build_att_avg_below_50,
    "att_daily_below_10": build_att_daily_below_10,
    "att_children_zero": build_att_children_zero,
    "att_children_below_50": build_att_children_below_50,
    "att_closed_over_7": build_att_closed_over_7,
    "att_missed_over_5": build_att_missed_over_5,
    "att_missed_all": build_att_missed_all,
    # Malnutrition Prevalence
    "mp_measure_below_100": build_mp_measure_below_100,
    "mp_not_submitted": build_mp_not_submitted,
    "mp_wrong_equipment": build_mp_wrong_equipment,
    "mp_implausible": build_mp_implausible,
    "mp_snc": build_mp_snc,
    "mp_sam": build_mp_sam,
    "mp_suw": build_mp_suw,
    "mp_gf2": build_mp_gf2,
    "mp_zigzag": build_mp_zigzag,
    "mp_to_refer": build_mp_to_refer,
    # Malnutrition Management
    "mm_to_refer": build_referral_card("mm_to_refer"),
    "mm_referred": build_referral_card("mm_referred"),
    "mm_nrc_admitted": build_referral_card("mm_nrc_admitted"),
    "mm_uw_worse": build_quarter_card("mm_uw_worse", "Underweight", "qs.waz_prev", "qs.waz_cur"),
    "mm_wasting_worse": build_quarter_card("mm_wasting_worse", "Wasting", "qs.whz_prev", "qs.whz_cur"),
    "mm_uw_better": build_quarter_card("mm_uw_better", "Underweight", "qs.waz_prev", "qs.waz_cur"),
    "mm_wasting_better": build_quarter_card("mm_wasting_better", "Wasting", "qs.whz_prev", "qs.whz_cur"),
    "mm_gf1_to_gf2": build_growth_faltering_card("mm_gf1_to_gf2"),
    "mm_gf2_to_gf1": build_growth_faltering_card("mm_gf2_to_gf1"),
    "mm_sam_3m": build_last_three_months_card("mm_sam_3m", "SAM", "l3.sam_n", "l3.sam_last"),
    "mm_suw_3m": build_last_three_months_card("mm_suw_3m", "SUW", "l3.suw_n", "l3.suw_last"),
    # Check-In
    "ci_sup_lt3": build_ci_sup_lt3,
    "ci_sup_none": build_ci_sup_none,
    "ci_short_engagement": build_ci_short_engagement,
    "ci_not_opening": build_ci_not_opening,
    "ci_not_closing": build_ci_not_closing,
    **{f"ci_{key}_low": build_cadre_card(f"ci_{key}_low", key) for key in CADRE_LABELS},
    # Safety
    "sf_not_audited": build_sf_not_audited,
    "sf_identified": build_sf_identified,
    "sf_unresolved": build_sf_unresolved,
    **{category: build_safety_category(category) for category in SAFETY_CATEGORIES},
    # Logistics
    "lg_lpg_not_updated": build_lg_plain("lg_lpg_not_updated", f'{SINCE_OPENING} AS "Pending Since"'),
    "lg_fire_not_updated": build_lg_plain("lg_fire_not_updated", f'{SINCE_OPENING} AS "Pending Since"'),
    "lg_alt_fuel": build_lg_alt_fuel,
    "lg_lpg_one_month": build_lg_plain("lg_lpg_one_month", date_col("lp.date_of_supply", "Pending Since")),
    "lg_fire_expired": build_lg_fire_expired,
    "lg_fire_refill_pending": build_lg_fire_refill_pending,
    "lg_stock_not_updated": build_lg_stock_not_updated,
    "lg_cashbook_not_updated": build_lg_cashbook_not_updated,
    "lg_zero_balance": build_lg_zero_balance,
    # Community Engagement
    "ce_gram_sabha_not_submitted": build_community_card("ce_gram_sabha_not_submitted", f'{SINCE_OPENING} AS "Pending Since"'),
    "ce_cmc_not_done": build_community_card("ce_cmc_not_done", since_month("lm.last_meeting"), LAST_CMC_MEETING_JOIN),
}


# ---------------------------------------------------------------------------
# Paging. The detail table reads one page at a time and the sorting, the search box and the column filters run in
# SQL, so a request costs the browser the same whether a card has 50 rows or a million.
# ---------------------------------------------------------------------------
MAX_PAGE_SIZE = 50000       # the most rows one request may ask for (the download reads pages this big)
MAX_FILTER_TEXT = 200       # longest search / filter text taken
MAX_FILTER_COLUMNS = 100    # most columns a request may name
PAGE_LIMIT = "LIMIT %(_rv_limit)s OFFSET %(_rv_offset)s"


def sql_name(name):
    """A column of the detail query as an identifier. `%` is doubled because the query is %-formatted with its parameters."""
    return "`" + str(name).replace("`", "``").replace("%", "%%") + "`"


def like_pattern(text):
    """`%text%` for LIKE, with the wildcards typed in `text` taken literally."""
    return "%" + text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def json_arg(value, kind):
    """A JSON request argument (a dict or a list); anything else is rejected."""
    if not value:
        return kind()
    try:
        parsed = json.loads(value) if isinstance(value, str) else value
    except ValueError:
        frappe.throw("Invalid request")
    if not isinstance(parsed, kind):
        frappe.throw("Invalid request")
    return parsed


def sort_expression(column, direction):
    """ORDER BY terms that sort a column the way the table always has: numbers, then dates (dd-mm-yyyy, Mon yyyy), then
    text, and blank cells last whichever the direction."""
    cell = f"t.{sql_name(column)}"
    text = f"CAST({cell} AS CHAR)"
    number = f"REPLACE(REPLACE(REPLACE({text}, ',', ''), '%%', ''), ' ', '')"
    is_number = f"{number} REGEXP '^-?[0-9]+([.][0-9]+)?$'"
    is_day = f"{text} REGEXP '^[0-9]{{2}}-[0-9]{{2}}-[0-9]{{4}}'"
    is_month = f"{text} REGEXP '^[A-Za-z]{{3}} [0-9]{{4}}'"
    as_date = (
        f"COALESCE(CASE WHEN {is_day} THEN STR_TO_DATE(SUBSTRING({text}, 1, 10), '%%d-%%m-%%Y') END, "
        f"CASE WHEN {is_month} THEN STR_TO_DATE(CONCAT('01 ', SUBSTRING({text}, 1, 8)), '%%d %%b %%Y') END)"
    )
    return ", ".join([
        f"({cell} IS NULL OR TRIM({text}) IN ('', '-')) ASC",
        f"CASE WHEN {is_number} THEN 0 WHEN {is_day} OR {is_month} THEN 1 ELSE 2 END {direction}",
        f"CASE WHEN {is_number} THEN CAST({number} AS DECIMAL(24, 6)) END {direction}",
        f"{as_date} {direction}",
        f"{text} {direction}",
    ])


def fetch_detail_page(sql, params, page, page_size, sort_col, sort_dir, search, col_filters, columns, count):
    """(rows, total) of one page of a detail query.

    The plain table (no sort, search or filter) is the query itself in its own order with LIMIT / OFFSET; the total is
    counted only when `count` asks for it, as it never changes while the user pages. With a sort, a search or filters
    the query becomes a derived table that is filtered, ordered and paged, and the matching total comes with the page
    in the same pass (COUNT(*) OVER ()). Ties are broken by the whole row so that pages never repeat or skip a row.
    Rows with no explicit sort come out ordered by their columns from left to right.
    """
    params = {**params, "_rv_limit": page_size, "_rv_offset": page * page_size}

    if not (sort_col or search or col_filters):
        rows = frappe.db.sql(f"{sql} {PAGE_LIMIT}", params, as_dict=True)
        total = frappe.db.sql(f"SELECT COUNT(*) FROM ({sql}) t", params)[0][0] if count else None
        return rows, total

    if not columns:
        frappe.throw("Invalid request")

    row_text = "CONCAT_WS(CHAR(31), " + ", ".join(f"t.{sql_name(column)}" for column in columns) + ")"
    conditions = []
    if search:
        conditions.append(f"{row_text} LIKE %(_rv_search)s")
        params["_rv_search"] = like_pattern(search)
    for i, (column, text) in enumerate(col_filters.items()):
        conditions.append(f"CAST(t.{sql_name(column)} AS CHAR) LIKE %(_rv_filter{i})s")
        params[f"_rv_filter{i}"] = like_pattern(text)
    where = "WHERE " + " AND ".join(conditions) if conditions else ""

    order = [f"{row_text} ASC"]
    if sort_col:
        order.insert(0, sort_expression(sort_col, "DESC" if str(sort_dir).lower() == "desc" else "ASC"))

    try:
        rows = frappe.db.sql(
            f"SELECT t.*, COUNT(*) OVER () AS _rv_total FROM ({sql}) t {where} ORDER BY {', '.join(order)} {PAGE_LIMIT}",
            params,
            as_dict=True,
        )
        if rows:
            total = int(rows[0]["_rv_total"])
        elif params["_rv_offset"]:
            total = int(frappe.db.sql(f"SELECT COUNT(*) FROM ({sql}) t {where}", params)[0][0])
        else:
            total = 0
    except Exception:
        # most likely a column the query does not have
        frappe.log_error(frappe.get_traceback(), "Review Card detail page")
        frappe.throw("The table could not be sorted or filtered.")

    for row in rows:
        del row["_rv_total"]
    return rows, total


@frappe.whitelist()
@scoped()
def fetch_review_card_data(partner_id=None, state_id=None, district_id=None, gp_id=None, block_id=None, creche_id=None, year=None, month=None, supervisor_id=None, cstart_date=None, cend_date=None, c_status=None, phases=None, query_type="op_creches", age=None, from_date=None, to_date=None, page_size=None, page=0, sort_col=None, sort_dir=None, search=None, col_filters=None, columns=None, count=None):
    """The detail rows of a card. Without `page_size` every row comes back in `data`. With it, one page: `page` (from 0)
    of `page_size` rows, sorted by `sort_col` / `sort_dir`, narrowed by `search` (any column) and `col_filters` (JSON
    {column: text}); `columns` (JSON list) names the columns those apply to, and `total` is the number of matching rows
    (for the plain table only when `count` is set)."""
    params = build_review_params(partner_id, state_id, district_id, gp_id, block_id, creche_id, year, month, supervisor_id, cstart_date, cend_date, c_status, phases, age, from_date=from_date, to_date=to_date)

    builder = QUERY_BUILDERS.get(str(query_type))
    if not builder:
        frappe.response["Error"] = "Invalid query_type parameter"
        return

    if str(query_type) in GROUP_CONCAT_QUERY_TYPES:
        frappe.db.sql("SET SESSION group_concat_max_len = 1048576")

    sql = builder(get_sources(params))
    if not page_size:
        frappe.response["data"] = frappe.db.sql(sql, params, as_dict=True) or []
        return

    columns = [str(column) for column in json_arg(columns, list)[:MAX_FILTER_COLUMNS]]
    col_filters = {
        str(column): str(text).strip()[:MAX_FILTER_TEXT]
        for column, text in list(json_arg(col_filters, dict).items())[:MAX_FILTER_COLUMNS]
        if str(text).strip()
    }
    rows, total = fetch_detail_page(
        sql, params,
        page=max(frappe.utils.cint(page), 0),
        page_size=min(max(frappe.utils.cint(page_size), 1), MAX_PAGE_SIZE),
        sort_col=str(sort_col) if sort_col else None,
        sort_dir=sort_dir,
        search=str(search).strip()[:MAX_FILTER_TEXT] if search else None,
        col_filters=col_filters,
        columns=columns,
        count=frappe.utils.cint(count),
    )
    frappe.response["data"] = rows
    frappe.response["total"] = total
