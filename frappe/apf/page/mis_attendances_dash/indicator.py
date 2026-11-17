"""
MIS Dashboard (mis-attendances-dash) indicator APIs.

Every chart on the dashboard is backed by one whitelisted endpoint in this file.
The "click the number above a bar -> child list" popup is served by
child_details.py, which builds its SQL with the SAME query builders defined
here (the `*_query(..., detail=True)` functions). The bar value and the popup
therefore always run identical FROM/JOIN/WHERE clauses; the popup only adds a
filter for the clicked bar, so `bar value == number of child rows` by
construction.

Performance notes (tables hold 2+ crore rows):
  * Every date filter is a plain half-open range on the raw column
    (`col >= start AND col < end`) so MariaDB can use an index. No
    YEAR()/MONTH()/DATEDIFF()/TIMESTAMPDIFF() on the filtered column.
  * Month-wise trends are one GROUP BY pass over the duration window instead
    of 12 x COUNT(DISTINCT CASE ...) over the whole table or one query per
    month.
  * Results are cached in Redis for a few minutes, keyed by the filters AND
    the caller's data scope (partner + mapped geography), so users with
    different row-level access never share a cached result.
  * `ensure_dashboard_indexes()` (run once via bench execute) adds the
    composite indexes these queries rely on.
"""

import calendar
import hashlib
import json
from datetime import date, timedelta

import frappe
from frappe.apf.user_scope import scoped
from dateutil.relativedelta import relativedelta

# ==============================================================================
# CONSTANTS
# ==============================================================================

MONTH_ABBR = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
OFFSET_MAP = {"3_months": 2, "6_months": 5, "9_months": 8, "12_months": 11}
GEO_COLS = ("state_id", "district_id", "block_id", "gp_id")

# Label used for a level-grouped bar whose dimension value is NULL (e.g. a creche
# with no GP mapped). child_details maps it back to `IS NULL`.
NULL_GROUP_LABEL = "(Not Mapped)"

DEFAULT_CACHE_TTL = 15 * 60
CACHE_IGNORED_KEYS = {"cmd", "_", "refresh"}

# Level -> (alias, table, fk column on tabCreche, display field).
# Numbering matches the dashboard's "Level" select exactly:
# 1 Partner, 2 State, 3 District, 4 Block, 5 Supervisor, 6 GP, 7 Creche.
DIM_MAP = {
    1: ("p", "`tabPartner`", "partner_id", "partner_name"),
    2: ("s", "`tabState`", "state_id", "state_name"),
    3: ("d", "`tabDistrict`", "district_id", "district_name"),
    4: ("b", "`tabBlock`", "block_id", "block_name"),
    5: ("u", "`tabUser`", "supervisor_id", "full_name"),
    6: ("g", "`tabGram Panchayat`", "gp_id", "gp_name"),
    7: ("cr", "`tabCreche`", "name", "creche_name"),
}

# ==============================================================================
# GENERIC HELPERS
# ==============================================================================


def get_args(kwargs=None):
    """Request arguments as one dict (form_dict + explicit kwargs)."""
    args = frappe._dict(frappe.form_dict or {})
    args.update(kwargs or {})
    args.pop("cmd", None)
    return args


def to_int(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def parse_level(value):
    lvl = to_int(value, 0)
    return lvl if lvl in DIM_MAP else None


def selected_month(args):
    today = date.today()
    year = to_int(args.get("year"), today.year) or today.year
    month = min(max(to_int(args.get("month"), today.month) or today.month, 1), 12)
    return year, month


def month_end(month_first):
    return date(month_first.year, month_first.month, calendar.monthrange(month_first.year, month_first.month)[1])


def window_month_starts(args):
    """First day of every month in the selected duration window, oldest first."""
    year, month = selected_month(args)
    offset = OFFSET_MAP.get(args.get("duration") or "12_months", 11)
    first = date(year, month, 1) - relativedelta(months=offset)
    return [first + relativedelta(months=i) for i in range(offset + 1)]


def month_label(d):
    return f"{MONTH_ABBR[d.month - 1]}-{d.year}"


def bucket_key(d):
    return f"{d.year:04d}-{d.month:02d}"


def parse_month_label(label):
    """'AUG-2026' (or 'Aug-2026') -> date(2026, 8, 1); None if not a month label."""
    try:
        mon, year = str(label).strip().upper().split("-")
        return date(int(year), MONTH_ABBR.index(mon) + 1, 1)
    except Exception:
        return None


def parse_month_label_bucket(bucket):
    """'2026-08' -> date(2026, 8, 1)."""
    year, month = str(bucket).split("-")
    return date(int(year), int(month), 1)


def snapshot_ref(month_first):
    """'As of' date for a month: today for the current month, otherwise month end."""
    today = date.today()
    if (month_first.year, month_first.month) == (today.year, today.month):
        return today
    return month_end(month_first)


def month_bucket_sql(col):
    return f"DATE_FORMAT({col}, '%%Y-%%m')"


def month_start_sql(col):
    """First day (DATE) of the month that `col` falls in, computed per row."""
    return f"CAST(DATE_FORMAT({col}, '%%Y-%%m-01') AS DATE)"


def month_ranges(month_firsts, clamp_current=False):
    """
    Half-open [start, end) ranges covering the given months, merged where
    contiguous. With clamp_current, the current calendar month ends at today
    (inclusive) instead of month end.
    """
    today = date.today()
    ranges = []
    for mf in sorted(month_firsts):
        end_excl = mf + relativedelta(months=1)
        if clamp_current and (mf.year, mf.month) == (today.year, today.month):
            end_excl = today + timedelta(days=1)
        if ranges and ranges[-1][1] == mf:
            ranges[-1] = (ranges[-1][0], end_excl)
        else:
            ranges.append((mf, end_excl))
    return ranges


def range_sql(col, ranges, params, prefix):
    """Index-friendly `col` filter for a list of half-open date ranges."""
    parts = []
    for i, (start, end_excl) in enumerate(ranges):
        params[f"{prefix}_s{i}"] = start
        params[f"{prefix}_e{i}"] = end_excl
        parts.append(f"({col} >= %({prefix}_s{i})s AND {col} < %({prefix}_e{i})s)")
    return "(" + " OR ".join(parts) + ")" if parts else "1=0"


def group_label(value):
    return NULL_GROUP_LABEL if value is None else str(value)


def _group_sort_key(row):
    return (row.get("g") is None, str(row.get("g") or "").lower())


def series_rows(group_field, months, rows):
    """
    Order query rows for a chart. Level-grouped: one bar per group, sorted by
    name. Month-wise: one bar per month in the window (missing months -> None).
    Returns (labels, ordered_rows).
    """
    if group_field:
        ordered = sorted(rows, key=_group_sort_key)
        return [group_label(r.get("g")) for r in ordered], ordered
    by_bucket = {r.get("g"): r for r in rows}
    return [month_label(m) for m in months], [by_bucket.get(bucket_key(m)) for m in months]


def row_int(row, key):
    return int((row or {}).get(key) or 0)


def empty_chart():
    return {"labels": [], "datasets": []}


# ==============================================================================
# USER SCOPE (row-level security) & CACHING
# ==============================================================================


def user_scope():
    """Partner + mapped geography of the session user, computed once per request."""
    scope = getattr(frappe.local, "_mis_dash_scope", None)
    if scope and scope.get("user") == frappe.session.user:
        return scope

    rows = frappe.db.sql(
        "SELECT state_id, district_id, block_id, gp_id FROM `tabUser Geography Mapping` WHERE parent = %s",
        frappe.session.user,
        as_dict=True,
    )
    geo = {col: tuple(sorted({str(r[col]) for r in rows if r.get(col)})) for col in GEO_COLS}
    scope = {
        "user": frappe.session.user,
        "geo": geo,
        "partner": frappe.db.get_value("User", frappe.session.user, "partner"),
    }
    frappe.local._mis_dash_scope = scope
    return scope


def _cache_ttl():
    try:
        return int(frappe.conf.get("mis_dashboard_cache_ttl") or DEFAULT_CACHE_TTL)
    except (TypeError, ValueError):
        return DEFAULT_CACHE_TTL


def cache_key(api_name, args, ignore=()):
    scope = user_scope()
    clean = {
        k: str(v) for k, v in args.items()
        if k not in CACHE_IGNORED_KEYS and k not in ignore and v not in (None, "")
    }
    payload = json.dumps(
        {"args": clean, "partner": scope["partner"], "geo": scope["geo"]},
        sort_keys=True, default=str,
    )
    return f"mis_dash|{api_name}|{hashlib.md5(payload.encode()).hexdigest()}"


def cached(api_name, args, generator, ignore=()):
    """Redis cache with a TTL. `refresh=1` in the request bypasses (and refills) it."""
    key = cache_key(api_name, args, ignore)
    cache = frappe.cache()
    if not to_int(args.get("refresh"), 0):
        try:
            hit = cache.get_value(key)
            if hit is not None:
                return hit
        except Exception:
            pass
    value = generator()
    try:
        cache.set_value(key, value, expires_in_sec=_cache_ttl())
    except Exception:
        pass
    return value


def respond(api_name, kwargs, builder):
    args = get_args(kwargs)
    frappe.response["data"] = cached(api_name, args, lambda: builder(args))


# ==============================================================================
# QUERY BUILDER
# ==============================================================================


class Q:
    """FROM / JOIN / WHERE / params bundle shared by indicator and child-details queries."""

    def __init__(self, base):
        self.base = base
        self.joins = []
        self.conds = []
        self.params = {}
        self._dims = set()

    def join(self, sql):
        self.joins.append(sql)

    def where(self, sql):
        self.conds.append(sql)

    def from_sql(self):
        return f"{self.base} {' '.join(self.joins)}"

    def where_sql(self):
        return " AND ".join(self.conds) if self.conds else "1=1"

    def dim(self, lvl):
        """Join a level's dimension table off `cr` (once) and return its display field."""
        alias, table, fk, field = DIM_MAP[lvl]
        if table != "`tabCreche`" and alias not in self._dims:
            on_col = "email" if table == "`tabUser`" else "name"
            self.join(f"LEFT JOIN {table} {alias} ON {alias}.{on_col} = cr.{fk}")
            self._dims.add(alias)
        return f"{alias}.{field}"

    def match_group(self, field, value, pname):
        if value is None or str(value) == NULL_GROUP_LABEL:
            self.where(f"{field} IS NULL")
        else:
            self.where(f"{field} = %({pname})s")
            self.params[pname] = value


def apply_partner(args, q, col):
    partner_id = args.get("partner_id") or user_scope()["partner"]
    if partner_id:
        q.where(f"{col} = %(partner_id)s")
        q.params["partner_id"] = partner_id


def apply_geo(args, q, alias):
    """Explicit geography filter, otherwise the user's mapped geography."""
    geo = user_scope()["geo"]
    for col in GEO_COLS:
        explicit = args.get(col)
        if explicit:
            q.where(f"{alias}.{col} = %({col})s")
            q.params[col] = explicit
        elif geo[col]:
            q.where(f"{alias}.{col} IN %({col}_scope)s")
            q.params[f"{col}_scope"] = geo[col]


def apply_opening_range(args, q, alias="cr"):
    """Creche opening date filter (dashboard sends opening_from/opening_to)."""
    start = args.get("opening_from") or args.get("cstart_date")
    end = args.get("opening_to") or args.get("cend_date")
    if start:
        q.where(f"{alias}.creche_opening_date >= %(opening_from)s")
        q.params["opening_from"] = start
    if end:
        q.where(f"{alias}.creche_opening_date <= %(opening_to)s")
        q.params["opening_to"] = end


def apply_creche_filters(args, q, alias="cr", creche_col=None, opening_gate=None):
    """Creche / supervisor / creche status / phase / opening-date filters."""
    if args.get("creche_id"):
        q.where(f"{creche_col or alias + '.name'} = %(creche_id)s")
        q.params["creche_id"] = args.get("creche_id")

    if args.get("supervisor_id"):
        q.where(f"{alias}.supervisor_id = %(supervisor_id)s")
        q.params["supervisor_id"] = args.get("supervisor_id")

    status = args.get("c_status") or args.get("creche_status_id")
    if status:
        q.where(f"{alias}.creche_status_id = %(creche_status)s")
        q.params["creche_status"] = status

    if args.get("phases"):
        phases = tuple(p.strip() for p in str(args.get("phases")).split(",") if p.strip().isdigit())
        if phases:
            q.where(f"{alias}.phase IN %(phases)s")
            q.params["phases"] = phases

    if opening_gate:
        q.where(f"({alias}.creche_opening_date IS NULL OR {alias}.creche_opening_date <= %(opening_gate)s)")
        q.params["opening_gate"] = opening_gate

    apply_opening_range(args, q, alias)


def child_age_conds(args, params, conds, dob_col, ref):
    """Child Age select as DOB ranges (equivalent to the old DATEDIFF bands, but indexable)."""
    child_age = args.get("child_age")
    if child_age == "1_year":
        conds.append(f"{dob_col} >= %(age_dob_from)s")
        params["age_dob_from"] = ref - timedelta(days=365)
    elif child_age == "1_2_year":
        conds.append(f"{dob_col} BETWEEN %(age_dob_from)s AND %(age_dob_to)s")
        params["age_dob_from"] = ref - timedelta(days=730)
        params["age_dob_to"] = ref - timedelta(days=365)
    elif child_age == "2_3_year":
        conds.append(f"{dob_col} BETWEEN %(age_dob_from)s AND %(age_dob_to)s")
        params["age_dob_from"] = ref - timedelta(days=1095)
        params["age_dob_to"] = ref - timedelta(days=731)


def apply_grouping(q, args):
    """
    Indicator side. Returns the level's display field for level-grouped bars,
    or None for a month-wise trend (no level, or a drill-down into one group).
    """
    dl_level = parse_level(args.get("drilldown_level"))
    dl_group = args.get("drilldown_group")
    if dl_level and dl_group not in (None, ""):
        q.match_group(q.dim(dl_level), dl_group, "drilldown_group")
        return None
    level = parse_level(args.get("level"))
    return q.dim(level) if level else None


def apply_bar_scope(q, args):
    """
    Child-details side: narrow to the clicked bar.
    Returns ("group", None) for a level-grouped bar, ("month", month_first) for a trend bar.
    """
    level = parse_level(args.get("level"))
    if level:
        q.match_group(q.dim(level), args.get("bar_label"), "bar_group")
        return "group", None
    year, month = selected_month(args)
    return "month", parse_month_label(args.get("bar_label")) or date(year, month, 1)


def event_scope(q, args, detail):
    """
    Grouping + months for "event" indicators where every row belongs to exactly
    one month (the month of its event date). Returns (group_field, months).
    """
    year, month = selected_month(args)
    selected = date(year, month, 1)
    if detail:
        mode, clicked = apply_bar_scope(q, args)
        return None, [selected] if mode == "group" else [clicked]
    group_field = apply_grouping(q, args)
    return group_field, [selected] if group_field else window_month_starts(args)


# ==============================================================================
# DEMOGRAPHY
# ==============================================================================


def _cee_scope(args, q):
    apply_partner(args, q, "cee.partner_id")
    apply_geo(args, q, "cee")
    if args.get("creche_id"):
        q.where("cee.creche_id = %(creche_id)s")
        q.params["creche_id"] = args.get("creche_id")


@frappe.whitelist()
@scoped()
def get_gender_wise_distribution(**kwargs):
    def build(args):
        q = Q("`tabChild Enrollment and Exit` cee")
        _cee_scope(args, q)
        data = frappe.db.sql(f"""
            SELECT CASE WHEN cee.gender_id = 1 THEN 'Male' WHEN cee.gender_id = 2 THEN 'Female'
                        WHEN cee.gender_id = 3 THEN 'Other' ELSE 'Unknown' END AS gender,
                   COUNT(*) AS total_children
            FROM {q.from_sql()} WHERE {q.where_sql()}
            GROUP BY cee.gender_id ORDER BY cee.gender_id
        """, q.params, as_dict=True)
        return {
            "labels": [r.gender for r in data],
            "datasets": [{"name": "Gender-wise Distribution", "values": [r.total_children for r in data]}],
        }

    respond("get_gender_wise_distribution", kwargs, build)


@frappe.whitelist()
@scoped()
def get_age_wise_distribution(**kwargs):
    def build(args):
        q = Q("`tabChild Enrollment and Exit` cee")
        q.where("cee.child_dob IS NOT NULL")
        _cee_scope(args, q)
        data = frappe.db.sql(f"""
            SELECT CASE WHEN age_months <= 6 THEN '0-6 Month' WHEN age_months <= 12 THEN '7-12 Month'
                        WHEN age_months <= 18 THEN '13-18 Month' WHEN age_months <= 24 THEN '19-24 Month'
                        WHEN age_months <= 30 THEN '25-30 Month' WHEN age_months <= 36 THEN '31-36 Month'
                        ELSE 'Above 36 Month' END AS age_group,
                   COUNT(*) AS total_children
            FROM (
                SELECT TIMESTAMPDIFF(MONTH, cee.child_dob, CURDATE()) AS age_months
                FROM {q.from_sql()} WHERE {q.where_sql()}
            ) t
            GROUP BY age_group
            ORDER BY MIN(age_months)
        """, q.params, as_dict=True)
        return {
            "labels": [r.age_group for r in data],
            "datasets": [{"name": "Age-wise Distribution", "values": [r.total_children for r in data]}],
        }

    respond("get_age_wise_distribution", kwargs, build)


@frappe.whitelist()
@scoped()
def age_in_months(**kwargs):
    def build(args):
        year, month = selected_month(args)
        q = Q("`tabChild Enrollment and Exit` cee")
        q.where("cee.is_exited = 0")
        q.where("cee.creation <= %(cutoff)s")
        q.params["cutoff"] = date(year, month, 1)
        _cee_scope(args, q)
        data = frappe.db.sql(f"""
            SELECT
                SUM(CASE WHEN cee.age_at_enrollment_in_months BETWEEN 6 AND 9 THEN 1 ELSE 0 END) AS a,
                SUM(CASE WHEN cee.age_at_enrollment_in_months BETWEEN 10 AND 12 THEN 1 ELSE 0 END) AS b,
                SUM(CASE WHEN cee.age_at_enrollment_in_months BETWEEN 13 AND 24 THEN 1 ELSE 0 END) AS c,
                SUM(CASE WHEN cee.age_at_enrollment_in_months BETWEEN 25 AND 36 THEN 1 ELSE 0 END) AS d
            FROM {q.from_sql()} WHERE {q.where_sql()}
        """, q.params, as_dict=True)
        row = data[0] if data else {}
        return {
            "labels": ["6-9 months", "9-12 months", "12-24 months", "24-36 months"],
            "datasets": [{"values": [row_int(row, k) for k in ("a", "b", "c", "d")]}],
        }

    respond("age_in_months", kwargs, build)


@frappe.whitelist()
@scoped()
def get_specially_abled_children(**kwargs):
    def build(args):
        year, month = selected_month(args)
        q = Q("`tabChild Enrollment and Exit` cees")
        q.join("INNER JOIN `tabChild Profile` cp ON cees.hhcguid = cp.chhguid")
        q.where("cees.is_active = 1")
        q.where("cees.date_of_enrollment <= %(month_end)s")
        q.params["month_end"] = month_end(date(year, month, 1))
        apply_partner(args, q, "cees.partner_id")
        if args.get("creche_id"):
            q.where("cees.creche_id = %(creche_id)s")
            q.params["creche_id"] = args.get("creche_id")
        apply_geo(args, q, "cp")
        data = frappe.db.sql(f"""
            SELECT COUNT(DISTINCT cees.hhcguid) AS enrolled_children,
                   COUNT(DISTINCT CASE WHEN cp.child_specially_abled = 1 THEN cp.chhguid END) AS specially_abled
            FROM {q.from_sql()} WHERE {q.where_sql()}
        """, q.params, as_dict=True)
        row = data[0] if data else {}
        return {
            "labels": ["Enrolled Children", "Specially Abled"],
            "datasets": [{"name": "Children Count",
                          "values": [row_int(row, "enrolled_children"), row_int(row, "specially_abled")]}],
        }

    respond("get_specially_abled_children", kwargs, build)


@frappe.whitelist()
@scoped()
def get_education_level_mother(**kwargs):
    def build(args):
        year, month = selected_month(args)
        q = Q("`tabChild Profile` cp")
        q.join("INNER JOIN `tabChild Enrollment and Exit` cex ON cex.hhcguid = cp.chhguid")
        q.join("LEFT JOIN `tabCreche` cr ON cr.name = cex.creche_id")
        q.join("LEFT JOIN `tabEducation Level` tel ON cp.education_level_of_parentscaregiver = tel.name")
        apply_partner(args, q, "cex.partner_id")
        if args.get("creche_id"):
            q.where("cex.creche_id = %(creche_id)s")
            q.params["creche_id"] = args.get("creche_id")
        apply_geo(args, q, "cp")
        status = args.get("c_status") or args.get("creche_status_id")
        if status:
            q.where("cr.creche_status_id = %(creche_status)s")
            q.params["creche_status"] = status
        if args.get("phases"):
            phases = tuple(p.strip() for p in str(args.get("phases")).split(",") if p.strip().isdigit())
            if phases:
                q.where("cr.phase IN %(phases)s")
                q.params["phases"] = phases
        apply_opening_range(args, q, "cr")
        q.where("(cr.creche_opening_date IS NULL OR cr.creche_opening_date <= %(month_end)s)")
        q.params["month_end"] = month_end(date(year, month, 1))

        data = frappe.db.sql(f"""
            SELECT IFNULL(tel.level, 'Not Available') AS level_name, COUNT(*) AS cnt
            FROM {q.from_sql()} WHERE {q.where_sql()}
            GROUP BY cp.education_level_of_parentscaregiver, tel.level
        """, q.params, as_dict=True)
        levels = ['Not Literate', 'Class 5', 'Class 8', 'Class 10', 'Intermediate', 'Diploma',
                  'Graduate', 'PG and above', 'Not Available']
        counts = {}
        for r in data:
            counts[r.level_name] = counts.get(r.level_name, 0) + int(r.cnt or 0)
        return {"labels": levels, "datasets": [{"values": [counts.get(lvl, 0) for lvl in levels]}]}

    respond("get_education_level_mother", kwargs, build)


def _household_aggregate(args, select_clause, group_by="", order_by="", join_clause=""):
    year, month = selected_month(args)
    q = Q(f"`tabHousehold Form` hh {join_clause}")
    q.where("hh.creation <= %(cutoff)s")
    q.params["cutoff"] = date(year, month, 1)
    apply_partner(args, q, "hh.partner_id")
    apply_geo(args, q, "hh")
    return frappe.db.sql(
        f"SELECT {select_clause} FROM {q.from_sql()} WHERE {q.where_sql()} {group_by} {order_by}",
        q.params, as_dict=True,
    )


@frappe.whitelist()
@scoped()
def get_occupation_data(**kwargs):
    def build(args):
        data = _household_aggregate(
            args, "po.primary_occupation, COUNT(hh.name) AS count",
            "GROUP BY po.primary_occupation", "ORDER BY LENGTH(po.primary_occupation) ASC",
            "JOIN `tabPrimary Occupation` po ON hh.primary_occupation_id = po.name",
        )
        return {"labels": [r.primary_occupation for r in data],
                "datasets": [{"name": "values", "values": [r["count"] for r in data]}]}

    respond("get_occupation_data", kwargs, build)


@frappe.whitelist()
@scoped()
def get_caste_data(**kwargs):
    def build(args):
        data = _household_aggregate(
            args,
            "CASE WHEN hh.social_category_id = 1 THEN 'General' WHEN hh.social_category_id = 2 THEN 'OBC' "
            "WHEN hh.social_category_id = 3 THEN 'SC' WHEN hh.social_category_id = 4 THEN 'ST' "
            "WHEN hh.social_category_id = 5 THEN 'Other' ELSE 'Not Available' END AS caste, COUNT(hh.name) AS cnt",
            "GROUP BY caste",
        )
        labels = ['General', 'OBC', 'SC', 'ST', 'Other', 'Not Available']
        counts = {r.caste: int(r.cnt or 0) for r in data}
        return {"labels": labels, "datasets": [{"values": [counts.get(lbl, 0) for lbl in labels]}]}

    respond("get_caste_data", kwargs, build)


@frappe.whitelist()
@scoped()
def get_religion_data(**kwargs):
    def build(args):
        labels = ['Hindu', 'Muslim', 'Christian', 'Buddhism', 'Sikhism', 'Jainism', 'Any Other', 'Not Available']
        parts = [f"SUM(CASE WHEN hh.religion = {i + 1} THEN 1 ELSE 0 END) AS r{i}" for i in range(7)]
        parts.append("SUM(CASE WHEN hh.religion IS NULL THEN 1 ELSE 0 END) AS r7")
        data = _household_aggregate(args, ", ".join(parts))
        row = data[0] if data else {}
        return {"labels": labels, "datasets": [{"values": [row_int(row, f"r{i}") for i in range(8)]}]}

    respond("get_religion_data", kwargs, build)


@frappe.whitelist()
@scoped()
def hh_migration_data(**kwargs):
    def build(args):
        data = _household_aggregate(
            args,
            "SUM(CASE WHEN hh.is_anyone_of_your_family_a_migrant_worker = 1 AND hh.no_of_months_the_migrants_were_away_last_year = 1 THEN 1 ELSE 0 END) AS ge6, "
            "SUM(CASE WHEN hh.is_anyone_of_your_family_a_migrant_worker = 1 AND hh.no_of_months_the_migrants_were_away_last_year = 2 THEN 1 ELSE 0 END) AS lt6",
        )
        row = data[0] if data else {}
        return {"labels": ["HH >= 6 months", "HH < 6 months"],
                "datasets": [{"name": "Migration Data", "values": [row_int(row, "ge6"), row_int(row, "lt6")]}]}

    respond("hh_migration_data", kwargs, build)


# ------------------------------------------------------------------------------
# Registered households (has child details)
# ------------------------------------------------------------------------------


def reg_hh_query(args, detail=False):
    """Households registered (hh.creation) per month / per group."""
    q = Q("`tabHousehold Form` hh")
    q.join("INNER JOIN `tabCreche` cr ON cr.name = hh.creche_id")
    apply_partner(args, q, "cr.partner_id")
    apply_geo(args, q, "cr")
    if args.get("creche_id"):
        q.where("hh.creche_id = %(creche_id)s")
        q.params["creche_id"] = args.get("creche_id")
    group_field, months = event_scope(q, args, detail)
    # Half-open range: includes registrations made during the whole last day.
    q.where(range_sql("hh.creation", month_ranges(months), q.params, "ev"))
    return q, group_field, months


@frappe.whitelist()
@scoped()
def get_reg_HH(**kwargs):
    def build(args):
        q, group_field, months = reg_hh_query(args)
        g = group_field or month_bucket_sql("hh.creation")
        rows = frappe.db.sql(
            f"SELECT {g} AS g, COUNT(*) AS value FROM {q.from_sql()} WHERE {q.where_sql()} GROUP BY g",
            q.params, as_dict=True,
        )
        labels, ordered = series_rows(group_field, months, rows)
        name = month_label(months[0]) if group_field else "Registered Households"
        return {"labels": labels, "datasets": [{"name": name, "values": [row_int(r, "value") for r in ordered]}]}

    respond("get_reg_HH", kwargs, build)


# ==============================================================================
# ATTENDANCE
# ==============================================================================

# Per-child band filters on the (days_attended, eligible_days) aggregate.
ATTENDANCE_BANDS = {
    "full_attendance": "cs.days_attended = cs.eligible_days",
    "zero_attendance": "cs.days_attended = 0",
    "seventy_attendance": "(cs.days_attended * 100.0 / cs.eligible_days) >= 70",
    "fivety_attendance": "(cs.days_attended * 100.0 / cs.eligible_days) <= 50",
}


def _attendance_base(args, sel_end):
    q = Q("`tabChild Attendance` ca")
    q.join("INNER JOIN `tabChild Attendance List` cal ON cal.parent = ca.name")
    q.join("INNER JOIN `tabCreche` cr ON cr.name = ca.creche_id")
    q.where("ca.is_shishu_ghar_is_closed_for_the_day = 0")
    apply_partner(args, q, "ca.partner_id")
    apply_geo(args, q, "ca")
    apply_creche_filters(args, q, "cr", creche_col="ca.creche_id", opening_gate=sel_end)
    return q


def attendance_band_query(args, band, detail=False):
    """
    Children whose attendance in a bar's period falls in `band`.

    Attendance is aggregated per (bar, child) straight from Child Attendance /
    Child Attendance List; the enrollment table is joined only once per child
    afterwards (child-level conditions), instead of once per attendance row.

    Returns (from_sql, where_sql, params, group_field, months). One row of
    from/where == one child counted on the bar.
    """
    year, month = selected_month(args)
    selected = date(year, month, 1)
    sel_end = month_end(selected)
    window = window_month_starts(args)

    q = _attendance_base(args, sel_end)
    group_field = None
    if detail:
        mode, clicked = apply_bar_scope(q, args)
        bucket = "1"
        if mode == "group":
            att_months, enr_start = [selected], selected
        else:
            att_months, enr_start = [clicked], window[0]
    else:
        group_field = apply_grouping(q, args)
        if group_field:
            att_months, enr_start, bucket = [selected], selected, group_field
        else:
            att_months, enr_start, bucket = window, window[0], month_bucket_sql("ca.date_of_attendance")

    q.where(range_sql("ca.date_of_attendance", month_ranges(att_months), q.params, "att"))
    q.params["enr_start"] = enr_start
    q.params["enr_end"] = sel_end

    child_conds = [
        "cee.date_of_enrollment <= %(enr_end)s",
        "(cee.date_of_exit IS NULL OR cee.date_of_exit >= %(enr_start)s)",
    ]
    if args.get("gender"):
        child_conds.append("cee.gender_id = %(gender)s")
        q.params["gender"] = args.get("gender")
    child_age_conds(args, q.params, child_conds, "cee.child_dob", sel_end)
    child_conds += ["cs.eligible_days > 0", ATTENDANCE_BANDS[band]]

    inner = f"""
        SELECT {bucket} AS g, cal.childenrolledguid AS child,
               SUM(cal.attendance) AS days_attended, COUNT(*) AS eligible_days,
               MAX(ca.creche_id) AS att_creche
        FROM {q.from_sql()}
        WHERE {q.where_sql()}
        GROUP BY g, child
    """
    from_sql = f"({inner}) cs INNER JOIN `tabChild Enrollment and Exit` cee ON cee.childenrollguid = cs.child"
    return from_sql, " AND ".join(child_conds), q.params, group_field, att_months


def _attendance_band_chart(args, band, dataset_name):
    from_sql, where_sql, params, group_field, months = attendance_band_query(args, band)
    rows = frappe.db.sql(
        f"SELECT cs.g AS g, COUNT(*) AS value FROM {from_sql} WHERE {where_sql} GROUP BY cs.g",
        params, as_dict=True,
    )
    labels, ordered = series_rows(group_field, months, rows)
    return {"labels": labels, "datasets": [{"name": dataset_name, "values": [row_int(r, "value") for r in ordered]}]}


def _attendance_average_chart(args, mode, dataset_name, as_percent_string=False):
    """Avg daily attendance / attendance % / SAM & SUW attendance %. Always spans the duration window."""
    year, month = selected_month(args)
    sel_end = month_end(date(year, month, 1))
    window = window_month_starts(args)

    q = _attendance_base(args, sel_end)
    q.where(range_sql("ca.date_of_attendance", month_ranges(window), q.params, "att"))
    group_field = apply_grouping(q, args)
    g = group_field or month_bucket_sql("ca.date_of_attendance")

    child_conds = []
    if args.get("gender"):
        child_conds.append("cee.gender_id = %(gender)s")
        q.params["gender"] = args.get("gender")
    child_age_conds(args, q.params, child_conds, "cee.child_dob", sel_end)

    if mode in ("sam", "suw"):
        # Old query joined every attendance row to every severe measurement of the
        # child (fan-out). Aggregating attendance per child first and joining the
        # measurements once per child gives the same weighted ratio far cheaper.
        flag = "weight_for_height" if mode == "sam" else "weight_for_age"
        cee_where = (" AND " + " AND ".join(child_conds)) if child_conds else ""
        sql = f"""
            SELECT cs.g AS g, ROUND(SUM(cs.attended) / NULLIF(SUM(cs.att_rows), 0) * 100, 2) AS value
            FROM (
                SELECT {g} AS g, cal.childenrolledguid AS child,
                       SUM(CASE WHEN cal.attendance = 1 THEN 1 ELSE 0 END) AS attended, COUNT(*) AS att_rows
                FROM {q.from_sql()} WHERE {q.where_sql()}
                GROUP BY g, child
            ) cs
            INNER JOIN `tabChild Enrollment and Exit` cee ON cee.childenrollguid = cs.child{cee_where}
            INNER JOIN `tabAnthropromatic Data` ad ON ad.childenrollguid = cs.child AND ad.{flag} = 1
            GROUP BY cs.g
        """
    else:
        if child_conds:
            q.join("INNER JOIN `tabChild Enrollment and Exit` cee ON cee.childenrollguid = cal.childenrolledguid")
            for c in child_conds:
                q.where(c)
        if mode == "avg_daily":
            expr = "CASE WHEN COUNT(DISTINCT ca.name) = 0 THEN 0 ELSE ROUND(SUM(cal.attendance) / COUNT(DISTINCT ca.name), 2) END"
        else:
            expr = "COALESCE(ROUND(SUM(cal.attendance) * 100.0 / NULLIF(COUNT(cal.name), 0), 2), 0)"
        sql = f"SELECT {g} AS g, {expr} AS value FROM {q.from_sql()} WHERE {q.where_sql()} GROUP BY g"

    rows = frappe.db.sql(sql, q.params, as_dict=True)
    if group_field:
        labels, ordered = series_rows(group_field, [], rows)
    else:
        ordered = sorted(rows, key=lambda r: str(r.get("g")))
        labels = [month_label(parse_month_label_bucket(r.get("g"))) for r in ordered]
    values = [float((r or {}).get("value") or 0.0) for r in ordered]
    if as_percent_string:
        values = [f"{v:.2f}%" for v in values]
    return {"labels": labels, "datasets": [{"name": dataset_name, "values": values}]}


@frappe.whitelist()
@scoped()
def avg_daily_attendance(**kwargs):
    respond("avg_daily_attendance", kwargs,
            lambda a: _attendance_average_chart(a, "avg_daily", "Avg. Daily Attendance"))


@frappe.whitelist()
@scoped()
def attendance_percentage(**kwargs):
    respond("attendance_percentage", kwargs,
            lambda a: _attendance_average_chart(a, "percentage", "Attendance Percentage", as_percent_string=True))


@frappe.whitelist()
@scoped()
def avg_sam_attendance_percent(**kwargs):
    respond("avg_sam_attendance_percent", kwargs,
            lambda a: _attendance_average_chart(a, "sam", "Avg. Attendance of SAM Children"))


@frappe.whitelist()
@scoped()
def avg_suw_attendance_percent(**kwargs):
    respond("avg_suw_attendance_percent", kwargs,
            lambda a: _attendance_average_chart(a, "suw", "Avg. Attendance of SUW Children"))


@frappe.whitelist()
@scoped()
def full_attendance(**kwargs):
    respond("full_attendance", kwargs,
            lambda a: _attendance_band_chart(a, "full_attendance", "100% Attendance Children"))


@frappe.whitelist()
@scoped()
def zero_attendance(**kwargs):
    respond("zero_attendance", kwargs,
            lambda a: _attendance_band_chart(a, "zero_attendance", "Zero Attendance Children"))


@frappe.whitelist()
@scoped()
def seventy_attendance(**kwargs):
    respond("seventy_attendance", kwargs,
            lambda a: _attendance_band_chart(a, "seventy_attendance", "Regular Children (>= 70%)"))


@frappe.whitelist()
@scoped()
def fivety_attendance(**kwargs):
    respond("fivety_attendance", kwargs,
            lambda a: _attendance_band_chart(a, "fivety_attendance", "<= 50% Attendance Children"))


# ==============================================================================
# ENROLLMENT
# ==============================================================================

# reason_for_exit codes as used by the live dashboard.
EXIT_REASON_CODES = {"graduated": 2, "migrated": 3, "not_willing": 1, "death": 4, "other": 5}
HH_STATUS_CODES = {"death": 1, "migrated": 2, "outside_catchment": 3}

ENROLLMENT_EVENT_INDICATORS = {
    "get_total_exited": ("exit", None, "Total Exited"),
    "get_exit_graduated": ("exit", "graduated", "Exit (Graduated)"),
    "get_exit_migrated": ("exit", "migrated", "Exit (Migrated)"),
    "get_exit_not_willing": ("exit", "not_willing", "Exit (Not Willing)"),
    "get_exit_death": ("exit", "death", "Exit (Death)"),
    "get_exit_other": ("exit", "other", "Exit (Other)"),
    "get_new_enrolment": ("new_enrolment", None, "New Enrolment"),
}

HH_INDICATORS = {
    "get_total_not_enrolled": ("not_enrolled", None, "Total Not Enrolled"),
    "get_not_enrolled_migrated": ("not_enrolled", "migrated", "Not Enrolled (Migrated)"),
    "get_not_enrolled_death": ("not_enrolled", "death", "Not Enrolled (Death)"),
    "get_not_enrolled_outside_catchment": ("not_enrolled", "outside_catchment", "Not Enrolled (Outside Catchment)"),
    "get_to_be_enrolled": ("to_be_enrolled", None, "To be Enrolled"),
}

BLANK_HH_STATUS = "(hcf.child_status IS NULL OR TRIM(hcf.child_status) = '')"
NEVER_ENROLLED = "NOT EXISTS (SELECT 1 FROM `tabChild Enrollment and Exit` x WHERE x.hhcguid = hcf.hhcguid)"


def enrollment_event_query(args, indicator_key, detail=False):
    """
    Exits (date_of_exit) / new enrolments (date_of_enrollment) WITHIN each
    month (the current month counts up to today). Returns (q, date_col, group_field, months).
    """
    api_type, sub_type, _ = ENROLLMENT_EVENT_INDICATORS[indicator_key]
    year, month = selected_month(args)
    sel_end = month_end(date(year, month, 1))

    q = Q("`tabChild Enrollment and Exit` cee")
    q.join("INNER JOIN `tabCreche` cr ON cr.name = cee.creche_id")
    date_col = "cee.date_of_exit" if api_type == "exit" else "cee.date_of_enrollment"
    if sub_type:
        q.where("cee.reason_for_exit = %(exit_reason)s")
        q.params["exit_reason"] = EXIT_REASON_CODES[sub_type]
    apply_partner(args, q, "cr.partner_id")
    apply_geo(args, q, "cr")
    apply_creche_filters(args, q, "cr", opening_gate=sel_end)

    group_field, months = event_scope(q, args, detail)
    q.where(range_sql(date_col, month_ranges(months, clamp_current=True), q.params, "ev"))
    return q, date_col, group_field, months


def _hh_population_sql(api_type, sub_type, ref, params, i):
    """Who counts for a Household-Child-Form indicator as of `ref` (6-36 month age gate)."""
    params[f"d6_{i}"] = ref - relativedelta(months=6)
    params[f"d36_{i}"] = ref - relativedelta(months=36)
    status_age = f"hcf.child_dob <= %(d6_{i})s AND hcf.child_dob > %(d36_{i})s"
    tobe = f"({BLANK_HH_STATUS} AND hcf.child_dob BETWEEN %(d36_{i})s AND %(d6_{i})s AND {NEVER_ENROLLED})"
    if api_type == "not_enrolled" and sub_type:
        return f"({status_age})"  # child_status itself is filtered in WHERE
    if api_type == "not_enrolled":
        return f"((hcf.child_status IN (1, 2, 3) AND {status_age}) OR {tobe})"
    return tobe


def hh_enrollment_query(args, indicator_key, detail=False):
    """
    Not Enrolled (Death/Migrated/Outside), To Be Enrolled and Total Not Enrolled,
    as point-in-time snapshots per month. Returns (q, group_field, ref_months, population_sqls).
    """
    api_type, sub_type, _ = HH_INDICATORS[indicator_key]
    year, month = selected_month(args)
    selected = date(year, month, 1)

    q = Q("`tabHousehold Child Form` hcf")
    q.join("INNER JOIN `tabHousehold Form` hf ON hf.name = hcf.parent")
    q.join("INNER JOIN `tabCreche` cr ON cr.name = hf.creche_id")
    q.where("hcf.is_dob_available = 1")
    if api_type == "not_enrolled" and sub_type:
        q.where("hcf.child_status = %(hh_status)s")
        q.params["hh_status"] = HH_STATUS_CODES[sub_type]
    elif api_type == "to_be_enrolled":
        q.where(BLANK_HH_STATUS)
    apply_partner(args, q, "cr.partner_id")
    apply_geo(args, q, "cr")
    apply_creche_filters(args, q, "cr", opening_gate=month_end(selected))

    group_field = None
    if detail:
        mode, clicked = apply_bar_scope(q, args)
        ref_months = [selected] if mode == "group" else [clicked]
    else:
        group_field = apply_grouping(q, args)
        ref_months = [selected] if group_field else window_month_starts(args)

    refs = [snapshot_ref(mf) for mf in ref_months]
    # Index-friendly superset of every month's age gate.
    q.where("hcf.child_dob BETWEEN %(dob_lo)s AND %(dob_hi)s")
    q.params["dob_lo"] = min(refs) - relativedelta(months=36)
    q.params["dob_hi"] = max(refs) - relativedelta(months=6)

    population = [_hh_population_sql(api_type, sub_type, ref, q.params, i) for i, ref in enumerate(refs)]
    return q, group_field, ref_months, population


def _enrollment_event_chart(args, indicator_key):
    q, date_col, group_field, months = enrollment_event_query(args, indicator_key)
    g = group_field or month_bucket_sql(date_col)
    rows = frappe.db.sql(
        f"SELECT {g} AS g, COUNT(*) AS value FROM {q.from_sql()} WHERE {q.where_sql()} GROUP BY g",
        q.params, as_dict=True,
    )
    labels, ordered = series_rows(group_field, months, rows)
    name = ENROLLMENT_EVENT_INDICATORS[indicator_key][2]
    return {"labels": labels, "datasets": [{"name": name, "values": [row_int(r, "value") for r in ordered]}]}


def _hh_enrollment_chart(args, indicator_key):
    q, group_field, months, population = hh_enrollment_query(args, indicator_key)
    name = HH_INDICATORS[indicator_key][2]
    if group_field:
        q.where(population[0])
        rows = frappe.db.sql(
            f"SELECT {group_field} AS g, COUNT(*) AS value FROM {q.from_sql()} WHERE {q.where_sql()} GROUP BY g",
            q.params, as_dict=True,
        )
        labels, ordered = series_rows(group_field, months, rows)
        return {"labels": labels, "datasets": [{"name": name, "values": [row_int(r, "value") for r in ordered]}]}

    selects = ", ".join(f"SUM(CASE WHEN {pop} THEN 1 ELSE 0 END) AS m{i}" for i, pop in enumerate(population))
    data = frappe.db.sql(f"SELECT {selects} FROM {q.from_sql()} WHERE {q.where_sql()}", q.params, as_dict=True)
    row = data[0] if data else {}
    return {
        "labels": [month_label(m) for m in months],
        "datasets": [{"name": name, "values": [row_int(row, f"m{i}") for i in range(len(months))]}],
    }


def _register_enrollment_endpoint(indicator_key, chart_fn):
    def endpoint(**kwargs):
        respond(indicator_key, kwargs, lambda a: chart_fn(a, indicator_key))

    endpoint.__name__ = indicator_key
    return frappe.whitelist()(scoped()(endpoint))


get_total_exited = _register_enrollment_endpoint("get_total_exited", _enrollment_event_chart)
get_exit_graduated = _register_enrollment_endpoint("get_exit_graduated", _enrollment_event_chart)
get_exit_migrated = _register_enrollment_endpoint("get_exit_migrated", _enrollment_event_chart)
get_exit_not_willing = _register_enrollment_endpoint("get_exit_not_willing", _enrollment_event_chart)
get_exit_death = _register_enrollment_endpoint("get_exit_death", _enrollment_event_chart)
get_exit_other = _register_enrollment_endpoint("get_exit_other", _enrollment_event_chart)
get_new_enrolment = _register_enrollment_endpoint("get_new_enrolment", _enrollment_event_chart)
get_total_not_enrolled = _register_enrollment_endpoint("get_total_not_enrolled", _hh_enrollment_chart)
get_not_enrolled_migrated = _register_enrollment_endpoint("get_not_enrolled_migrated", _hh_enrollment_chart)
get_not_enrolled_death = _register_enrollment_endpoint("get_not_enrolled_death", _hh_enrollment_chart)
get_not_enrolled_outside_catchment = _register_enrollment_endpoint("get_not_enrolled_outside_catchment", _hh_enrollment_chart)
get_to_be_enrolled = _register_enrollment_endpoint("get_to_be_enrolled", _hh_enrollment_chart)


# ------------------------------------------------------------------------------
# Eligible vs Enrolled trends (fixed 12-month window ending at the selected month)
# ------------------------------------------------------------------------------


def _twelve_months(args):
    year, month = selected_month(args)
    last = date(year, month, 1)
    return [last - relativedelta(months=11 - i) for i in range(12)]


def _eligible_series(args, months):
    """Children aged 6-36 months (TIMESTAMPDIFF) on the 1st of each month, from the household survey."""
    today = date.today()
    q = Q("`tabHousehold Child Form` hhc")
    q.join("JOIN `tabHousehold Form` hf ON hf.name = hhc.parent")
    q.where("hhc.is_dob_available = 1")
    apply_partner(args, q, "hf.partner_id")
    if args.get("creche_id"):
        q.where("hf.creche_id = %(creche_id)s")
        q.params["creche_id"] = args.get("creche_id")
    apply_geo(args, q, "hf")
    # Superset of every month's age window, so the DOB index is usable.
    q.where("hhc.child_dob > %(elig_lo)s AND hhc.child_dob <= %(elig_hi)s")
    q.params["elig_lo"] = months[0] - relativedelta(months=38)
    q.params["elig_hi"] = months[-1]

    parts = []
    for i, mf in enumerate(months):
        if mf > today:
            parts.append(f"0 AS m{i}")
            continue
        q.params[f"elig_{i}"] = mf
        parts.append(f"SUM(CASE WHEN TIMESTAMPDIFF(MONTH, hhc.child_dob, %(elig_{i})s) BETWEEN 6 AND 36 THEN 1 ELSE 0 END) AS m{i}")
    data = frappe.db.sql(f"SELECT {', '.join(parts)} FROM {q.from_sql()} WHERE {q.where_sql()}", q.params, as_dict=True)
    row = data[0] if data else {}
    return [row_int(row, f"m{i}") for i in range(len(months))]


def _cee_month_series(args, months, case_sql, prefilter):
    q = Q("`tabChild Enrollment and Exit` cee")
    apply_partner(args, q, "cee.partner_id")
    if args.get("creche_id"):
        q.where("cee.creche_id = %(creche_id)s")
        q.params["creche_id"] = args.get("creche_id")
    apply_geo(args, q, "cee")
    for cond, values in prefilter:
        q.where(cond)
        q.params.update(values)
    parts = []
    for i, mf in enumerate(months):
        q.params[f"ms_{i}"] = mf
        q.params[f"me_{i}"] = month_end(mf)
        parts.append(f"SUM(CASE WHEN {case_sql.format(i=i)} THEN 1 ELSE 0 END) AS m{i}")
    data = frappe.db.sql(f"SELECT {', '.join(parts)} FROM {q.from_sql()} WHERE {q.where_sql()}", q.params, as_dict=True)
    row = data[0] if data else {}
    return [row_int(row, f"m{i}") for i in range(len(months))]


@frappe.whitelist()
@scoped()
def get_active_enrolled_data(**kwargs):
    def build(args):
        months = _twelve_months(args)
        active = _cee_month_series(
            args, months,
            "cee.date_of_enrollment <= %(me_{i})s AND (cee.date_of_exit IS NULL OR cee.date_of_exit > %(me_{i})s)",
            [("cee.is_active = 1", {}),
             ("cee.date_of_enrollment <= %(pf_end)s", {"pf_end": month_end(months[-1])}),
             ("(cee.date_of_exit IS NULL OR cee.date_of_exit > %(pf_start)s)", {"pf_start": month_end(months[0])})],
        )
        return {
            "labels": [month_label(m) for m in months],
            "datasets": [
                {"name": "Eligible", "values": _eligible_series(args, months)},
                {"name": "Active Enrolled", "values": active},
            ],
        }

    respond("get_active_enrolled_data", kwargs, build)


@frappe.whitelist()
@scoped()
def get_exit_childrens(**kwargs):
    def build(args):
        months = _twelve_months(args)
        bounds = {"pf_start": months[0], "pf_end": month_end(months[-1])}
        enrolled = _cee_month_series(
            args, months, "cee.date_of_enrollment BETWEEN %(ms_{i})s AND %(me_{i})s",
            [("cee.date_of_enrollment BETWEEN %(pf_start)s AND %(pf_end)s", bounds)],
        )
        exited = _cee_month_series(
            args, months, "cee.date_of_exit BETWEEN %(ms_{i})s AND %(me_{i})s",
            [("cee.date_of_exit BETWEEN %(pf_start)s AND %(pf_end)s", bounds)],
        )
        return {
            "labels": [month_label(m) for m in months],
            "datasets": [{"name": "Current Enrolled", "values": enrolled},
                         {"name": "Current Exited", "values": exited}],
        }

    respond("get_exit_childrens", kwargs, build)


@frappe.whitelist()
@scoped()
def get_eligible_enrolled_data(**kwargs):
    """Eligible (6-36 months, no child status) vs enrolled, grouped by level or household registration month."""
    def build(args):
        year, month = selected_month(args)
        sel_end = month_end(date(year, month, 1))
        ref = snapshot_ref(date(year, month, 1))
        q = Q("`tabHousehold Child Form` hcf")
        q.join("INNER JOIN `tabHousehold Form` hf ON hf.name = hcf.parent")
        q.join("INNER JOIN `tabCreche` cr ON cr.name = hf.creche_id")
        q.join("LEFT JOIN `tabChild Enrollment and Exit` cee ON cee.hhcguid = hcf.hhcguid")
        q.where("hcf.is_dob_available = 1")
        q.where(BLANK_HH_STATUS)
        q.where("hcf.child_dob BETWEEN %(d36)s AND %(d6)s")
        q.params.update({"d36": ref - relativedelta(months=36), "d6": ref - relativedelta(months=6), "end_date": sel_end})
        apply_partner(args, q, "cr.partner_id")
        apply_geo(args, q, "cr")
        apply_creche_filters(args, q, "cr", opening_gate=sel_end)
        group_field = apply_grouping(q, args)
        g = group_field or month_bucket_sql("hf.creation")
        rows = frappe.db.sql(f"""
            SELECT {g} AS g, COUNT(DISTINCT hcf.hhcguid) AS eligible,
                   COUNT(DISTINCT CASE WHEN cee.date_of_enrollment <= %(end_date)s
                        AND (cee.date_of_exit IS NULL OR cee.date_of_exit >= %(end_date)s)
                        THEN cee.childenrollguid END) AS enrolled
            FROM {q.from_sql()} WHERE {q.where_sql()} GROUP BY g
        """, q.params, as_dict=True)
        if group_field:
            labels, ordered = series_rows(group_field, [], rows)
        else:
            ordered = sorted(rows, key=lambda r: str(r.get("g")))
            labels = [month_label(parse_month_label_bucket(r.get("g"))) for r in ordered]
        return {
            "labels": labels,
            "datasets": [
                {"name": "Eligible Children (6-36 months)", "values": [row_int(r, "eligible") for r in ordered]},
                {"name": "Enrolled Children", "values": [row_int(r, "enrolled") for r in ordered]},
            ],
        }

    respond("get_eligible_enrolled_data", kwargs, build)


# ==============================================================================
# MALNUTRITION (ANTHROPOMETRY)
# ==============================================================================

ANTHRO_COLS = {"wfa": "weight_for_age", "wfh": "weight_for_height", "hfa": "height_for_age"}
ANTHRO_LEVELS = {"normal": 3, "modrate": 2, "severe": 1}

# Child counted on a measurement row if enrolled by the end of the measurement's
# month and not exited before that month started.
ENROLLED_IN_MEASUREMENT_MONTH = [
    "cee.date_of_enrollment <= LAST_DAY(cgm.measurement_date)",
    f"(cee.date_of_exit IS NULL OR cee.date_of_exit > {month_start_sql('cgm.measurement_date')})",
]
# Stricter: still enrolled at the end of the measurement's month (Measurement % numerator).
ENROLLED_AT_MONTH_END = "(cee.date_of_exit IS NULL OR cee.date_of_exit > LAST_DAY(cgm.measurement_date))"


def anthro_measured_query(args, detail=False):
    """
    Enrolled children with a height/weight measurement in each month
    (Growth Monitoring date). One child can have several measurement rows, so
    counts are COUNT(DISTINCT cee.name). Returns (q, group_field, months).
    """
    q = Q("`tabChild Growth Monitoring` cgm")
    q.join("INNER JOIN `tabAnthropromatic Data` ad ON ad.parent = cgm.name AND ad.do_you_have_height_weight = 1")
    q.join("INNER JOIN `tabChild Enrollment and Exit` cee ON cee.childenrollguid = ad.childenrollguid")
    q.join("INNER JOIN `tabCreche` cr ON cr.name = cee.creche_id")
    for cond in ENROLLED_IN_MEASUREMENT_MONTH:
        q.where(cond)
    apply_partner(args, q, "cr.partner_id")
    apply_geo(args, q, "cr")
    apply_creche_filters(args, q, "cr")
    group_field, months = event_scope(q, args, detail)
    q.where(range_sql("cgm.measurement_date", month_ranges(months), q.params, "ms"))
    return q, group_field, months


def _enrolled_snapshot(args, months):
    """Children enrolled at each month end (and not exited by then), per group or per month."""
    q = Q("`tabChild Enrollment and Exit` cee")
    q.join("INNER JOIN `tabCreche` cr ON cr.name = cee.creche_id")
    apply_partner(args, q, "cr.partner_id")
    apply_geo(args, q, "cr")
    apply_creche_filters(args, q, "cr")
    group_field = apply_grouping(q, args)
    q.where("cee.date_of_enrollment <= %(snap_last)s")
    q.where("(cee.date_of_exit IS NULL OR cee.date_of_exit > %(snap_first)s)")
    q.params["snap_last"] = month_end(months[-1])
    q.params["snap_first"] = month_end(months[0])
    parts = []
    for i, mf in enumerate(months):
        q.params[f"snap_{i}"] = month_end(mf)
        parts.append(
            f"SUM(CASE WHEN cee.date_of_enrollment <= %(snap_{i})s AND "
            f"(cee.date_of_exit IS NULL OR cee.date_of_exit > %(snap_{i})s) THEN 1 ELSE 0 END) AS e{i}"
        )
    g = group_field or "'ALL'"
    return frappe.db.sql(
        f"SELECT {g} AS g, {', '.join(parts)} FROM {q.from_sql()} WHERE {q.where_sql()} GROUP BY g",
        q.params, as_dict=True,
    )


def _merge_rows(group_field, months, measured_rows, enrolled_rows=None):
    """Align measured (keyed by group or month bucket) and enrolled snapshot rows into chart order."""
    if group_field:
        groups = {r.get("g") for r in measured_rows} | {r.get("g") for r in (enrolled_rows or [])}
        ordered_groups = sorted(groups, key=lambda g: (g is None, str(g or "").lower()))
        meas = {r.get("g"): r for r in measured_rows}
        enr = {r.get("g"): row_int(r, "e0") for r in (enrolled_rows or [])}
        return ([group_label(g) for g in ordered_groups],
                [meas.get(g) for g in ordered_groups],
                [enr.get(g, 0) for g in ordered_groups])
    meas = {r.get("g"): r for r in measured_rows}
    enr_row = (enrolled_rows or [{}])[0] if enrolled_rows else {}
    return ([month_label(m) for m in months],
            [meas.get(bucket_key(m)) for m in months],
            [row_int(enr_row, f"e{i}") for i in range(len(months))])


def anthro_chart(args, api_mode):
    q, group_field, months = anthro_measured_query(args)
    g = group_field or month_bucket_sql("cgm.measurement_date")

    if api_mode in ("measured_data", "enrolled_measured"):
        rows = frappe.db.sql(f"""
            SELECT {g} AS g,
                   COUNT(DISTINCT CASE WHEN {ENROLLED_AT_MONTH_END} THEN cee.name END) AS num,
                   COUNT(DISTINCT cee.name) AS measured
            FROM {q.from_sql()} WHERE {q.where_sql()} GROUP BY g
        """, q.params, as_dict=True)
        enrolled_rows = _enrolled_snapshot(args, months)
        labels, meas, enrolled = _merge_rows(group_field, months, rows, enrolled_rows)
        measured = [row_int(r, "measured") for r in meas]
        if api_mode == "enrolled_measured":
            return {"labels": labels, "datasets": [{"name": "Enrolled", "values": enrolled},
                                                   {"name": "Measured", "values": measured}]}
        nums = [row_int(r, "num") for r in meas]
        pct = [f"{(n * 100.0 / e):.2f}%" if e else "0%" for n, e in zip(nums, enrolled)]
        return {
            "labels": labels,
            "datasets": [{"name": "Measurement %", "values": pct}],
            "extra": {"Measurement Taken": measured},
            # Number of children listed by the child-details popup for each bar.
            "child_counts": nums,
        }

    if api_mode.endswith("_all"):
        col = ANTHRO_COLS[api_mode[:3]]
        rows = frappe.db.sql(f"""
            SELECT {g} AS g,
                   COUNT(DISTINCT CASE WHEN ad.{col} = 3 THEN cee.name END) AS normal,
                   COUNT(DISTINCT CASE WHEN ad.{col} = 2 THEN cee.name END) AS moderate,
                   COUNT(DISTINCT CASE WHEN ad.{col} = 1 THEN cee.name END) AS severe,
                   COUNT(DISTINCT cee.name) AS measured
            FROM {q.from_sql()} WHERE {q.where_sql()} GROUP BY g
        """, q.params, as_dict=True)
        labels, meas, _ = _merge_rows(group_field, months, rows)
        return {
            "labels": labels,
            "datasets": [{"name": "Normal", "values": [row_int(r, "normal") for r in meas]},
                         {"name": "Moderate", "values": [row_int(r, "moderate") for r in meas]},
                         {"name": "Severe", "values": [row_int(r, "severe") for r in meas]}],
            "extra": {"Measurement Taken": [row_int(r, "measured") for r in meas]},
        }

    cat, level_str = api_mode.split("_")
    col, val = ANTHRO_COLS[cat], ANTHRO_LEVELS[level_str]
    rows = frappe.db.sql(f"""
        SELECT {g} AS g,
               COUNT(DISTINCT CASE WHEN ad.{col} = {val} THEN cee.name END) AS value,
               COUNT(DISTINCT cee.name) AS measured
        FROM {q.from_sql()} WHERE {q.where_sql()} GROUP BY g
    """, q.params, as_dict=True)
    labels, meas, _ = _merge_rows(group_field, months, rows)
    return {
        "labels": labels,
        "datasets": [{"name": "Value", "values": [row_int(r, "value") for r in meas]}],
        "extra": {"Measurement Taken": [row_int(r, "measured") for r in meas]},
    }


def _register_anthro_endpoint(name, api_mode):
    def endpoint(**kwargs):
        respond(name, kwargs, lambda a: anthro_chart(a, api_mode))

    endpoint.__name__ = name
    return frappe.whitelist()(scoped()(endpoint))


get_measured_data = _register_anthro_endpoint("get_measured_data", "measured_data")
get_enrolled_measured = _register_anthro_endpoint("get_enrolled_measured", "enrolled_measured")
get_wfa_normal_data = _register_anthro_endpoint("get_wfa_normal_data", "wfa_normal")
get_wfa_modrate_data = _register_anthro_endpoint("get_wfa_modrate_data", "wfa_modrate")
get_wfa_severe_data = _register_anthro_endpoint("get_wfa_severe_data", "wfa_severe")
get_wfh_normal_data = _register_anthro_endpoint("get_wfh_normal_data", "wfh_normal")
get_wfh_modrate_data = _register_anthro_endpoint("get_wfh_modrate_data", "wfh_modrate")
get_wfh_severe_data = _register_anthro_endpoint("get_wfh_severe_data", "wfh_severe")
get_hfa_normal_data = _register_anthro_endpoint("get_hfa_normal_data", "hfa_normal")
get_hfa_modrate_data = _register_anthro_endpoint("get_hfa_modrate_data", "hfa_modrate")
get_hfa_severe_data = _register_anthro_endpoint("get_hfa_severe_data", "hfa_severe")
get_weight_age_data = _register_anthro_endpoint("get_weight_age_data", "wfa_all")
get_weight_height_data = _register_anthro_endpoint("get_weight_height_data", "wfh_all")
get_height_age_data = _register_anthro_endpoint("get_height_age_data", "hfa_all")


# ==============================================================================
# GROWTH FALTERING (GF1 / GF1+ / GF2 / ZIG-ZAG / SNC)
# ==============================================================================

GF_MODES = {"gf1": "Growth faltering 1", "gf1_plus": "Growth faltering 1+", "gf2": "Growth faltering 2",
            "zig_zag": "Zig-Zag Pattern", "snc": "SNC"}

_Z = "CAST({a}.weight_for_age_zscore AS DECIMAL(10,4))"


def _z(alias):
    return _Z.format(a=alias)


def _months_back_join(alias, k, extra=""):
    """ON-clause: measurements of the same child taken exactly k calendar months before ad_current's month."""
    ms = month_start_sql("cgm.measurement_date")
    upper = ms if k == 1 else f"DATE_SUB({ms}, INTERVAL {k - 1} MONTH)"
    return (
        f"{alias}.childenrollguid = ad_current.childenrollguid AND {alias}.do_you_have_height_weight = 1 "
        f"AND {alias}.measurement_taken_date >= DATE_SUB({ms}, INTERVAL {k} MONTH) "
        f"AND {alias}.measurement_taken_date < {upper} "
        f"AND {alias}.weight_for_age_zscore IS NOT NULL{extra}"
    )


def _gf_joins(kind, join_type="LEFT"):
    ad = "`tabAnthropromatic Data`"
    if kind == "gf1":
        return [f"LEFT JOIN {ad} ad_prev ON {_months_back_join('ad_prev', 1)}",
                f"LEFT JOIN {ad} ad_fallback ON {_months_back_join('ad_fallback', 2, ' AND ad_prev.childenrollguid IS NULL')}"]
    if kind == "gf2":
        return [f"LEFT JOIN {ad} ad_priority ON {_months_back_join('ad_priority', 2)}",
                f"LEFT JOIN {ad} ad_fallback_2 ON {_months_back_join('ad_fallback_2', 3, ' AND ad_priority.childenrollguid IS NULL')}"]
    return [f"{join_type} JOIN {ad} ad_m{k} ON {_months_back_join(f'ad_m{k}', k)}" for k in (1, 2, 3, 4)]


GF1_HAS_PREV = "(ad_prev.weight_for_age_zscore IS NOT NULL OR ad_fallback.weight_for_age_zscore IS NOT NULL)"
GF2_HAS_PRIOR = "(ad_priority.weight_for_age_zscore IS NOT NULL OR ad_fallback_2.weight_for_age_zscore IS NOT NULL)"
GF1_PLUS_DROP = f"({_z('ad_current')} - COALESCE({_z('ad_prev')}, {_z('ad_fallback')})) <= -0.5"
GF2_DROP = f"({_z('ad_current')} - COALESCE({_z('ad_priority')}, {_z('ad_fallback_2')})) <= -0.5"
ZZ_DROP = f"({_z('ad_current')} - GREATEST({_z('ad_m4')}, {_z('ad_m3')}, {_z('ad_m2')}, {_z('ad_m1')})) <= -0.5"


def gf_query(args, api_mode, detail=False, measured_total=False):
    """
    GF/SNC measurement rows (or, with measured_total, all measured rows) per month/group.
    Counts are COUNT(DISTINCT ad_current.name). Returns (q, group_field, months).
    """
    q = Q("`tabAnthropromatic Data` ad_current")
    q.join("INNER JOIN `tabChild Growth Monitoring` cgm ON cgm.name = ad_current.parent")
    q.join("INNER JOIN `tabChild Enrollment and Exit` cee ON cee.childenrollguid = ad_current.childenrollguid")
    q.join("INNER JOIN `tabCreche` cr ON cr.name = cgm.creche_id")
    q.where("ad_current.do_you_have_height_weight = 1")
    for cond in ENROLLED_IN_MEASUREMENT_MONTH:
        q.where(cond)
    apply_partner(args, q, "cr.partner_id")
    apply_geo(args, q, "cr")
    apply_creche_filters(args, q, "cr")
    group_field, months = event_scope(q, args, detail)
    q.where(range_sql("cgm.measurement_date", month_ranges(months), q.params, "ms"))

    if measured_total:
        return q, group_field, months

    q.where("ad_current.weight_for_age_zscore IS NOT NULL")
    if api_mode == "gf1":
        for j in _gf_joins("gf1"):
            q.join(j)
        q.where(GF1_HAS_PREV)
        q.where("(COALESCE(ad_prev.weight_for_age_zscore, ad_fallback.weight_for_age_zscore) - ad_current.weight_for_age_zscore) > 0")
    elif api_mode == "gf1_plus":
        for j in _gf_joins("gf1"):
            q.join(j)
        q.where(GF1_HAS_PREV)
        q.where(GF1_PLUS_DROP)
    elif api_mode == "gf2":
        for j in _gf_joins("gf2"):
            q.join(j)
        q.where(GF2_HAS_PRIOR)
        q.where(GF2_DROP)
    elif api_mode == "zig_zag":
        for j in _gf_joins("zz", "INNER"):
            q.join(j)
        q.where(f"cee.date_of_enrollment <= LAST_DAY(DATE_SUB({month_start_sql('cgm.measurement_date')}, INTERVAL 4 MONTH))")
        q.where(ZZ_DROP)
    elif api_mode == "snc":
        for j in _gf_joins("gf1") + _gf_joins("gf2") + _gf_joins("zz", "LEFT"):
            q.join(j)
        z0, z1, z2, z3, z4 = (_z(a) for a in ("ad_current", "ad_m1", "ad_m2", "ad_m3", "ad_m4"))
        q.where(f"""(
            ({GF1_HAS_PREV} AND (COALESCE({_z('ad_prev')}, {_z('ad_fallback')}) - {z0}) > 0)
            OR ({GF1_HAS_PREV} AND {GF1_PLUS_DROP})
            OR ({GF2_HAS_PRIOR} AND {GF2_DROP})
            OR (ad_m1.weight_for_age_zscore IS NOT NULL AND ad_m2.weight_for_age_zscore IS NOT NULL
                AND ad_m3.weight_for_age_zscore IS NOT NULL AND ad_m4.weight_for_age_zscore IS NOT NULL
                AND {ZZ_DROP}
                AND ({z0} > {z1} OR {z1} > {z2} OR {z2} > {z3} OR {z3} > {z4})
                AND ({z0} < {z1} OR {z1} < {z2} OR {z2} < {z3} OR {z3} < {z4}))
            OR ad_current.weight_for_age = 1 OR ad_current.weight_for_height = 1
        )""")
    return q, group_field, months


def gf_chart(args, api_mode):
    q, group_field, months = gf_query(args, api_mode)
    g = group_field or month_bucket_sql("cgm.measurement_date")
    rows = frappe.db.sql(
        f"SELECT {g} AS g, COUNT(DISTINCT ad_current.name) AS value FROM {q.from_sql()} WHERE {q.where_sql()} GROUP BY g",
        q.params, as_dict=True,
    )
    tq, _, _ = gf_query(args, api_mode, measured_total=True)
    totals = frappe.db.sql(
        f"SELECT {g} AS g, COUNT(DISTINCT cee.childenrollguid) AS total FROM {tq.from_sql()} WHERE {tq.where_sql()} GROUP BY g",
        tq.params, as_dict=True,
    )
    if group_field:
        groups = sorted({r.get("g") for r in rows} | {r.get("g") for r in totals},
                        key=lambda x: (x is None, str(x or "").lower()))
        vmap = {r.get("g"): row_int(r, "value") for r in rows}
        tmap = {r.get("g"): row_int(r, "total") for r in totals}
        labels = [group_label(x) for x in groups]
        values = [vmap.get(x, 0) for x in groups]
        measured = [tmap.get(x, 0) for x in groups]
    else:
        vmap = {r.get("g"): row_int(r, "value") for r in rows}
        tmap = {r.get("g"): row_int(r, "total") for r in totals}
        labels = [month_label(m) for m in months]
        values = [vmap.get(bucket_key(m), 0) for m in months]
        measured = [tmap.get(bucket_key(m), 0) for m in months]
    return {"labels": labels, "datasets": [{"name": GF_MODES[api_mode], "values": values}],
            "extra": {"Measurement Taken": measured}}


def _register_gf_endpoint(name, api_mode):
    def endpoint(**kwargs):
        respond(name, kwargs, lambda a: gf_chart(a, api_mode))

    endpoint.__name__ = name
    return frappe.whitelist()(scoped()(endpoint))


get_gf_data = _register_gf_endpoint("get_gf_data", "gf1")
get_gf_one_data = _register_gf_endpoint("get_gf_one_data", "gf1_plus")
get_gf_two_data = _register_gf_endpoint("get_gf_two_data", "gf2")
get_zig_zag_data = _register_gf_endpoint("get_zig_zag_data", "zig_zag")
get_snc_data = _register_gf_endpoint("get_snc_data", "snc")


# ==============================================================================
# COHORT (first vs latest nutrition category)
# ==============================================================================

COHORT_TRANSITIONS = {
    "md_nr": [("Moderate", "Normal")],
    "sv_md": [("Severe", "Moderate")],
    "sv_nr": [("Severe", "Normal")],
    "total_recovery": [("Moderate", "Normal"), ("Severe", "Moderate"), ("Severe", "Normal")],
    "nr_md": [("Normal", "Moderate")],
    "nr_sv": [("Normal", "Severe")],
    "md_sv": [("Moderate", "Severe")],
    "total_deterioration": [("Normal", "Moderate"), ("Normal", "Severe"), ("Moderate", "Severe")],
    "nr_nr": [("Normal", "Normal")],
    "md_md": [("Moderate", "Moderate")],
    "sv_sv": [("Severe", "Severe")],
    "no_change": [("Normal", "Normal"), ("Moderate", "Moderate"), ("Severe", "Severe")],
}

COHORT_ENDPOINTS = {
    "get_cohort_moderate_to_normal": ("md_nr", "Moderate to Normal"),
    "get_cohort_severe_to_moderate": ("sv_md", "Severe to Moderate"),
    "get_cohort_severe_to_normal": ("sv_nr", "Severe to Normal"),
    "get_cohort_total_recovery": ("total_recovery", "Total Recovery"),
    "get_cohort_normal_to_moderate": ("nr_md", "Normal to Moderate"),
    "get_cohort_normal_to_severe": ("nr_sv", "Normal to Severe"),
    "get_cohort_moderate_to_severe": ("md_sv", "Moderate to Severe"),
    "get_cohort_total_deterioration": ("total_deterioration", "Total Deterioration"),
    "get_cohort_normal_to_normal": ("nr_nr", "Normal to Normal"),
    "get_cohort_moderate_to_moderate": ("md_md", "Moderate to Moderate"),
    "get_cohort_severe_to_severe": ("sv_sv", "Severe to Severe"),
    "get_cohort_no_change": ("no_change", "No Change"),
}

COHORT_INDICATORS = ("weight_for_age", "weight_for_height", "height_for_age")
COHORT_AGE_BANDS = {"6m-11m": (6, 11), "12m-17m": (12, 17), "18m-23m": (18, 23), "24m-29m": (24, 29), "30m-36m": (30, 36)}


def cohort_transition_sql(api_mode):
    # Parenthesised as a whole so `first_date != last_date` applies to every
    # alternative (the old query only applied it to the last one).
    return "(" + " OR ".join(
        f"(st.initial_category = '{i}' AND st.final_category = '{f}')" for i, f in COHORT_TRANSITIONS[api_mode]
    ) + ")"


def cohort_query(args, target_month, scope_fn, with_scores=False):
    """
    WITH rc (children in scope, one row per enrollment) + st (first/last
    category per child up to the target month end). `scope_fn(q)` applies the
    grouping / clicked-bar filter to the enrollment+creche query and returns
    the SQL expression rc.g is grouped on. Returns (cte_sql, params).

    All creche/geography filters are applied INSIDE rc, so st only aggregates
    measurements of children in scope (the old query aggregated every child in
    the database on every call).
    """
    indicator = args.get("indicator") if args.get("indicator") in COHORT_INDICATORS else "weight_for_age"
    z = f"a.{indicator}_zscore"
    cat = (f"CASE WHEN CAST({z} AS DECIMAL(10,2)) < -3 THEN 'Severe' "
           f"WHEN CAST({z} AS DECIMAL(10,2)) < -2 THEN 'Moderate' ELSE 'Normal' END")

    q = Q("`tabChild Enrollment and Exit` cee")
    q.join("INNER JOIN `tabCreche` cr ON cr.name = cee.creche_id")
    q.where("cee.date_of_enrollment <= %(coh_end)s")
    q.params["coh_end"] = month_end(target_month)
    q.params["coh_next"] = target_month + relativedelta(months=1)
    q.params["coh_first"] = target_month
    if args.get("gender"):
        q.where("cee.gender_id = %(gender)s")
        q.params["gender"] = args.get("gender")
    band = args.get("age_group")
    if band in COHORT_AGE_BANDS:
        lo, hi = COHORT_AGE_BANDS[band]
        q.where(f"TIMESTAMPDIFF(MONTH, cee.child_dob, %(coh_first)s) BETWEEN {lo} AND {hi}")
    elif band == "> 36m":
        q.where("TIMESTAMPDIFF(MONTH, cee.child_dob, %(coh_first)s) > 36")
    apply_partner(args, q, "cr.partner_id")
    apply_geo(args, q, "cr")
    apply_creche_filters(args, q, "cr")
    group_expr = scope_fn(q)

    scores = ""
    if with_scores:
        scores = (f", SUBSTRING_INDEX(GROUP_CONCAT({z} ORDER BY a.measurement_taken_date ASC SEPARATOR '||'), '||', 1) AS first_zscore"
                  f", SUBSTRING_INDEX(GROUP_CONCAT({z} ORDER BY a.measurement_taken_date DESC SEPARATOR '||'), '||', 1) AS last_zscore")
    cte = f"""
        WITH rc AS (
            SELECT cee.name AS cee_name, cee.childenrollguid, cee.creche_id, {group_expr} AS g
            FROM {q.from_sql()} WHERE {q.where_sql()}
        ),
        st AS (
            SELECT a.childenrollguid,
                   MIN(a.measurement_taken_date) AS first_date,
                   MAX(a.measurement_taken_date) AS last_date,
                   SUBSTRING_INDEX(GROUP_CONCAT({cat} ORDER BY a.measurement_taken_date ASC SEPARATOR ','), ',', 1) AS initial_category,
                   SUBSTRING_INDEX(GROUP_CONCAT({cat} ORDER BY a.measurement_taken_date DESC SEPARATOR ','), ',', 1) AS final_category
                   {scores}
            FROM `tabAnthropromatic Data` a
            WHERE a.childenrollguid IN (SELECT childenrollguid FROM rc)
              AND a.do_you_have_height_weight = 1
              AND {z} IS NOT NULL AND TRIM({z}) <> ''
              AND a.measurement_taken_date < %(coh_next)s
            GROUP BY a.childenrollguid
        )
    """
    return cte, q.params


def cohort_is_month_wise(args):
    drilldown = parse_level(args.get("drilldown_level")) and args.get("drilldown_group") not in (None, "")
    return bool(drilldown) or not parse_level(args.get("level"))


def cohort_chart(args, api_mode, dataset_name):
    trans = cohort_transition_sql(api_mode)

    def run(target):
        cte, params = cohort_query(args, target, lambda q: apply_grouping(q, args) or "'All Data'")
        return frappe.db.sql(f"""
            {cte}
            SELECT rc.g AS g,
                   SUM(CASE WHEN st.childenrollguid IS NOT NULL AND st.first_date != st.last_date AND {trans}
                            THEN 1 ELSE 0 END) AS value
            FROM rc LEFT JOIN st ON st.childenrollguid = rc.childenrollguid
            GROUP BY rc.g
        """, params, as_dict=True)

    if cohort_is_month_wise(args):
        # Each month needs its own "latest measurement up to that month", so one query per month.
        months = window_month_starts(args)
        values = [sum(row_int(r, "value") for r in run(mf)) for mf in months]
        return {"labels": [month_label(m) for m in months], "datasets": [{"name": dataset_name, "values": values}]}

    year, month = selected_month(args)
    labels, ordered = series_rows(True, [], run(date(year, month, 1)))
    return {"labels": labels, "datasets": [{"name": dataset_name, "values": [row_int(r, "value") for r in ordered]}]}


def _register_cohort_endpoint(name):
    api_mode, dataset_name = COHORT_ENDPOINTS[name]

    def endpoint(**kwargs):
        respond(name, kwargs, lambda a: cohort_chart(a, api_mode, dataset_name))

    endpoint.__name__ = name
    return frappe.whitelist()(scoped()(endpoint))


get_cohort_moderate_to_normal = _register_cohort_endpoint("get_cohort_moderate_to_normal")
get_cohort_severe_to_moderate = _register_cohort_endpoint("get_cohort_severe_to_moderate")
get_cohort_severe_to_normal = _register_cohort_endpoint("get_cohort_severe_to_normal")
get_cohort_total_recovery = _register_cohort_endpoint("get_cohort_total_recovery")
get_cohort_normal_to_moderate = _register_cohort_endpoint("get_cohort_normal_to_moderate")
get_cohort_normal_to_severe = _register_cohort_endpoint("get_cohort_normal_to_severe")
get_cohort_moderate_to_severe = _register_cohort_endpoint("get_cohort_moderate_to_severe")
get_cohort_total_deterioration = _register_cohort_endpoint("get_cohort_total_deterioration")
get_cohort_normal_to_normal = _register_cohort_endpoint("get_cohort_normal_to_normal")
get_cohort_moderate_to_moderate = _register_cohort_endpoint("get_cohort_moderate_to_moderate")
get_cohort_severe_to_severe = _register_cohort_endpoint("get_cohort_severe_to_severe")
get_cohort_no_change = _register_cohort_endpoint("get_cohort_no_change")


# ==============================================================================
# CRECHE PROFILE
# ==============================================================================


def creche_categorical(args, categories, is_snapshot=True):
    """
    categories: {dataset name: SQL condition}. A condition may use {ref} for
    "as of" date (CURDATE() normally, each month's end in a month-wise snapshot).
    """
    year, month = selected_month(args)
    sel_end = month_end(date(year, month, 1))
    q = Q("`tabCreche` cr")
    apply_partner(args, q, "cr.partner_id")
    apply_geo(args, q, "cr")
    apply_creche_filters(args, q, "cr", opening_gate=sel_end)
    q.where("cr.creche_opening_date IS NOT NULL")
    group_field = apply_grouping(q, args)
    names = list(categories.keys())

    if group_field or not is_snapshot:
        g = group_field or month_bucket_sql("cr.creche_opening_date")
        parts = ", ".join(
            f"SUM(CASE WHEN {categories[n].format(ref='CURDATE()')} THEN 1 ELSE 0 END) AS c{j}" for j, n in enumerate(names)
        )
        rows = frappe.db.sql(f"SELECT {g} AS g, {parts} FROM {q.from_sql()} WHERE {q.where_sql()} GROUP BY g",
                             q.params, as_dict=True)
        labels, ordered = series_rows(group_field, window_month_starts(args), rows)
        datasets = [{"name": n, "values": [row_int(r, f"c{j}") for r in ordered]} for j, n in enumerate(names)]
        return {"labels": labels, "datasets": datasets}

    # Month-wise cumulative snapshot: all months x categories in ONE pass.
    months = window_month_starts(args)
    parts = []
    for i, mf in enumerate(months):
        q.params[f"snap_{i}"] = month_end(mf)
        for j, n in enumerate(names):
            cond = categories[n].format(ref=f"%(snap_{i})s")
            parts.append(f"SUM(CASE WHEN cr.creche_opening_date <= %(snap_{i})s AND {cond} THEN 1 ELSE 0 END) AS c{i}_{j}")
    data = frappe.db.sql(f"SELECT {', '.join(parts)} FROM {q.from_sql()} WHERE {q.where_sql()}", q.params, as_dict=True)
    row = data[0] if data else {}
    return {
        "labels": [month_label(m) for m in months],
        "datasets": [{"name": n, "values": [row_int(row, f"c{i}_{j}") for i in range(len(months))]}
                     for j, n in enumerate(names)],
    }


def _register_creche_endpoint(name, categories, is_snapshot=True, drop_status=False):
    def endpoint(**kwargs):
        args = get_args(kwargs)
        if drop_status:  # the chart itself is split by creche status
            args.pop("c_status", None)
            args.pop("creche_status_id", None)
        frappe.response["data"] = cached(name, args, lambda: creche_categorical(args, categories, is_snapshot))

    endpoint.__name__ = name
    return frappe.whitelist()(scoped()(endpoint))


get_creche_status_data = _register_creche_endpoint("get_creche_status_data", {
    "Planned": "cr.creche_status_id = 1",
    "Plan Dropped": "cr.creche_status_id = 2",
    "Active / Operational": "cr.creche_status_id = 3",
    "Closed": "cr.creche_status_id = 4",
}, drop_status=True)
get_creche_inauguration_trend_data = _register_creche_endpoint(
    "get_creche_inauguration_trend_data", {"Inaugurated Creches": "1=1"}, is_snapshot=False)
get_type_of_creche_house_data = _register_creche_endpoint("get_type_of_creche_house_data", {
    "Rented House": "cr.type_of_creche_house = 1",
    "Community Hall": "cr.type_of_creche_house = 2",
    "Old School Building": "cr.type_of_creche_house = 3",
    "Any Other": "cr.type_of_creche_house = 4",
})
get_type_of_building_data = _register_creche_endpoint("get_type_of_building_data", {
    "Kaccha": "cr.type_of_building = 1",
    "Pakka": "cr.type_of_building = 2",
})
get_hard_to_reach_data = _register_creche_endpoint("get_hard_to_reach_data", {
    "Yes": "cr.hard_to_reach = 1",
    "No": "cr.hard_to_reach = 0",
})
get_roof_type_data = _register_creche_endpoint("get_roof_type_data", {
    "Asbestos": "cr.roof_type = 1",
    "Tin": "cr.roof_type = 2",
    "Cemented": "cr.roof_type = 3",
    "Khapra (Tile)": "cr.roof_type = 4",
})
get_source_of_power_supply_data = _register_creche_endpoint("get_source_of_power_supply_data", {
    "Electricity": "cr.source_of_power_supply = 1",
    "Electricity + Inverter": "cr.source_of_power_supply = 2",
    "Solar": "cr.source_of_power_supply = 3",
})
get_equipped_with_lightning_arrestor_data = _register_creche_endpoint("get_equipped_with_lightning_arrestor_data", {
    "Yes": "cr.equipped_with_lightening_arrestor = 1",
    "No": "cr.equipped_with_lightening_arrestor = 0",
})
get_age_wise_creche_distribution_data = _register_creche_endpoint("get_age_wise_creche_distribution_data", {
    "Below 6 Months": "TIMESTAMPDIFF(MONTH, cr.creche_opening_date, {ref}) < 6",
    "6-12 Months": "TIMESTAMPDIFF(MONTH, cr.creche_opening_date, {ref}) BETWEEN 6 AND 11",
    "12-18 Months": "TIMESTAMPDIFF(MONTH, cr.creche_opening_date, {ref}) BETWEEN 12 AND 17",
    "18-24 Months": "TIMESTAMPDIFF(MONTH, cr.creche_opening_date, {ref}) BETWEEN 18 AND 23",
    "Above 24 Months": "TIMESTAMPDIFF(MONTH, cr.creche_opening_date, {ref}) >= 24",
})
get_independent_kitchen_room_data = _register_creche_endpoint("get_independent_kitchen_room_data", {
    "Yes": "cr.independent_kitche_room = 1",
    "No": "cr.independent_kitche_room = 0",
})
get_equipped_with_operational_toilet_data = _register_creche_endpoint("get_equipped_with_operational_toilet_data", {
    "Yes": "cr.equipped_with_operational_toilet = 1",
    "No": "cr.equipped_with_operational_toilet = 0",
})


# ==============================================================================
# INDEXES
# ==============================================================================

# (doctype, columns) the dashboard queries filter/join on. Building an index on a
# 2-crore-row table takes a while and locks writes on older MariaDB versions, so
# run this once in a low-traffic window:
#   bench --site <site> execute frappe.apf.page.mis_attendances_dash.indicator.ensure_dashboard_indexes
DASHBOARD_INDEXES = [
    ("Child Attendance", ["date_of_attendance", "creche_id"]),
    ("Child Attendance List", ["parent", "childenrolledguid", "attendance"]),
    ("Child Enrollment and Exit", ["childenrollguid"]),
    ("Child Enrollment and Exit", ["hhcguid"]),
    ("Child Enrollment and Exit", ["creche_id", "date_of_enrollment"]),
    ("Child Enrollment and Exit", ["date_of_exit"]),
    ("Child Enrollment and Exit", ["date_of_enrollment"]),
    ("Anthropromatic Data", ["childenrollguid", "measurement_taken_date"]),
    ("Child Growth Monitoring", ["measurement_date"]),
    ("Household Child Form", ["child_dob"]),
    ("Household Child Form", ["hhcguid"]),
    ("Household Form", ["creche_id", "creation"]),
    ("Household Form", ["creation"]),
]


def ensure_dashboard_indexes():
    """Create any missing index from DASHBOARD_INDEXES. Skips one whose columns are already an index prefix."""
    report = []
    for doctype, columns in DASHBOARD_INDEXES:
        table = f"tab{doctype}"
        try:
            existing = {}
            for row in frappe.db.sql(f"SHOW INDEX FROM `{table}`", as_dict=True):
                existing.setdefault(row.Key_name, []).append((row.Seq_in_index, row.Column_name))
            prefixes = [[c for _, c in sorted(cols)] for cols in existing.values()]
            if any(p[:len(columns)] == columns for p in prefixes):
                report.append(f"exists   {table}({', '.join(columns)})")
                continue
            index_name = "mis_dash_" + "_".join(columns)
            frappe.db.sql_ddl(f"ALTER TABLE `{table}` ADD INDEX `{index_name}` ({', '.join(f'`{c}`' for c in columns)})")
            report.append(f"created  {table}({', '.join(columns)})")
        except Exception as e:
            report.append(f"FAILED   {table}({', '.join(columns)}): {e}")
    print("\n".join(report))
    return report
