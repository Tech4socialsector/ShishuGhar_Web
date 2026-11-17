import frappe
from datetime import date
import calendar
from frappe.utils import nowdate
from datetime import datetime, timedelta, date
from dateutil.relativedelta import relativedelta
from collections import defaultdict

def execute(filters=None):
    columns = [
        {"label": "Partner Name", "fieldname": "Partner Name", "fieldtype": "Link", "options": "Partner", "width": 200},
        {"label": "State", "fieldname": "State", "fieldtype": "Link", "options": "State", "width": 200},
        {"label": "District", "fieldname": "District","fieldtype": "Data","width": 200},
        {"label": "Block", "fieldname": "Block","fieldtype": "Data","width": 200},
        {"label": "GP", "fieldname": "GP","fieldtype": "Data","width": 200},
        {"label": "Village", "fieldname": "Village","fieldtype": "Data","width": 200},
        {"label": "Creche", "fieldname": "creche","fieldtype": "Data","width": 200},
        {"label": "Date of Visit", "fieldname": "Date of Visit","width": 120},
        {"label": "Hamlet", "fieldname": "Hamlet","fieldtype": "Data","width": 200},
        {"label": "Landmark", "fieldname": "Landmark","fieldtype": "Data","width": 200},
        {"label": "Respondent Name", "fieldname": "Respondent Name","fieldtype": "Data","width": 260},
        {"label": "Respondent Age", "fieldname": "Respondent Age","fieldtype": "Int"},
        {"label": "Respondent Gender", "fieldname": "Respondent Gender","fieldtype": "Data"},
        {"label": "Household Head Name", "fieldname": "Household Head Name","fieldtype": "Data"},
        {"label": "Social Category", "fieldname": "Social Category","fieldtype": "Data"},
        {"label": "Is the family a PVTG?", "fieldname": "Is the family a PVTG?","fieldtype": "Data"},
        {"label": "PVTG Name", "fieldname": "PVTG Name","fieldtype": "Data"},
        {"label": "Primary Occupation", "fieldname": "Primary Occupation","fieldtype": "Data"},
        {"label": "Primary Occupation Other", "fieldname": "Primary Occupation Other","fieldtype": "Data"},
        {"label": "Number of Family Members", "fieldname": "Number of Family Members","fieldtype": "Int"},
        {"label": "Children Under 3 years", "fieldname": "Children Under 3 years","fieldtype": "Int"},
        {"label": "Children 3 to 6 years", "fieldname": "Children 3 to 6 years","fieldtype": "Int"},
        {"label": "Children 6 to 18 years", "fieldname": "Children 6 to 18 years","fieldtype": "Int"},
        {"label": "Adults above 18 years", "fieldname": "Adults above 18 years","fieldtype": "Int"},
        {"label": "Number of Pregnant Women", "fieldname": "Number of Pregnant Women","fieldtype": "Int"},
        {"label": "Child Name", "fieldname": "Child Name","fieldtype": "Data"},
        {"label": "Child Gender", "fieldname": "Child Gender","fieldtype": "Data"},
        {"label": "Relation with Child", "fieldname": "Relation with Child","fieldtype": "Data"},
        {"label": "Child DOB", "fieldname": "Child DOB","fieldtype": "Data"},
        {"label": "Child Age in Months", "fieldname": "Child Age in Months","fieldtype": "Int"},

        {"label": "Is Enrolled?", "fieldname": "Is Enrolled?", "fieldtype": "Data", "width": 120},
        {"label": "Child ID", "fieldname": "Child ID", "fieldtype": "Data", "width": 150},
        {"label": "Child Status", "fieldname": "Child Status", "fieldtype": "Data", "width": 175},


        {"label": "Family Members Engaged as Migrant Workers", "fieldname": "Family Members Engaged as Migrant Workers","fieldtype": "Data"},
        {"label": "Number of Months the migrants were away last year", "fieldname": "Number of Months the migrants were away last year","fieldtype": "Data"},
        {"label": "Does anyone from the family migrate every year?", "fieldname": "Does anyone from the family migrate every year?","fieldtype": "Data"},
        {"label": "Who looks after the children at home?", "fieldname": "Who looks after the children at home?","fieldtype": "Data"},

    ]

    data = get_report_data(filters)
    return columns, data

@frappe.whitelist()
def get_report_data(filters=None):
    current_date = date.today()
    date_input_type = filters.get("date_input_type") if filters else None
    time_range = filters.get("time_range") if filters else None

    # DateRange filters can arrive as a list (["2026-01-01", "2026-08-31"])
    # or as a comma-joined string ("2026-01-01,2026-08-31"), depending on
    # how the request was submitted. Normalize both to a 2-item list.
    if isinstance(time_range, str):
        time_range = [d.strip() for d in time_range.split(",") if d.strip()]

    use_date_range = date_input_type == "date_range" and time_range and len(time_range) == 2

    if use_date_range:
        start_date = frappe.utils.getdate(time_range[0])
        end_date = frappe.utils.getdate(time_range[1])
    else:
        month = int(filters.get("month")) if filters.get("month") else current_date.month
        year = int(filters.get("year")) if filters.get("year") else current_date.year

        try:
            start_date = date(year, month, 1)
            last_day = calendar.monthrange(year, month)[1]
            end_date = date(year, month, last_day)
        except:
            today = date.today()
            year = today.year
            month = today.month
            start_date = date(year, month, 1)
            last_day = calendar.monthrange(year, month)[1]
            end_date = date(year, month, last_day)

    # Get user geography mapping
    current_user_partner = frappe.db.get_value("User", frappe.session.user, "partner")
    partner_id = filters.get("partner") or current_user_partner

    state_query = """ 
        SELECT state_id, district_id, block_id, gp_id
        FROM `tabState` ts 
        JOIN `tabUser Geography Mapping` ugm ON ugm.state_id = ts.name
        WHERE ugm.parent = %s
        ORDER BY state_id, district_id, block_id, gp_id
    """

    state_params = (frappe.session.user,)
    current_user_state = frappe.db.sql(state_query, state_params, as_dict=True)
    
    # Extract geography IDs for user access
    state_ids = ",".join("'" + str(s["state_id"]) + "'" for s in current_user_state if s.get("state_id"))
    district_ids = ",".join("'" + str(s["district_id"]) + "'" for s in current_user_state if s.get("district_id"))
    block_ids = ",".join("'" + str(s["block_id"]) + "'" for s in current_user_state if s.get("block_id"))
    gp_ids = ",".join("'" + str(s["gp_id"]) + "'" for s in current_user_state if s.get("gp_id"))

    # Date range handling
    cstart_date, cend_date = None, None
    range_type = filters.get("cr_opening_range_type") if filters.get("cr_opening_range_type") else None

    if range_type:
        single_date = filters.get("single_date")
        date_range = filters.get("c_opening_range")

        if range_type == "between" and date_range and len(date_range) == 2:
            cstart_date, cend_date = date_range
        elif range_type == "before" and single_date:
            cstart_date, cend_date = date(2017, 1, 1), single_date
        elif range_type == "after" and single_date:
            cstart_date, cend_date = single_date, date.today()
        elif range_type == "equal" and single_date:
            cstart_date = cend_date = single_date

    creche_status_id = filters.get("creche_status_id") if filters else None
    phases_cleaned = ",".join(p.strip() for p in filters["phases"].split(",") if p.strip().isdigit()) if filters.get("phases") else None

    conditions = ""
    params = {}   # <-- Will be used for parameterized query

    if partner_id:
        conditions += f" AND P.name = '{partner_id}'"
    
    # State filtering with user geography mapping
    if filters.get("state"):
        conditions += f" AND state.name = '{filters.get('state')}'"
    else:
        if state_ids:
            conditions += f" AND state.name IN ({state_ids})"
    
    # District filtering with user geography mapping
    if filters.get("district"):
        conditions += f" AND district.name = '{filters.get('district')}'"
    else:
        if district_ids:
            conditions += f" AND district.name IN ({district_ids})"
    
    # Block filtering with user geography mapping
    if filters.get("block"):
        conditions += f" AND block.name = '{filters.get('block')}'"
    else:
        if block_ids:
            conditions += f" AND block.name IN ({block_ids})"
    
    # GP filtering with user geography mapping
    if filters.get("gp"):
        conditions += f" AND gp.name = '{filters.get('gp')}'"
    else:
        if gp_ids:
            conditions += f" AND gp.name IN ({gp_ids})"

    # ---------- FIXED: Creche Filter (Parameterized) ----------
    if filters.get("creche"):
        conditions += " AND c.name = %(creche)s"
        params["creche"] = filters.get("creche")
    # ---------------------------------------------------------
    
    if supervisor_id := filters.get("supervisor_id"):
        conditions += f" AND c.supervisor_id = '{supervisor_id}'"
    if creche_status_id:
        conditions += f" AND c.creche_status_id = '{creche_status_id}'"
    if phases_cleaned:
        conditions += f" AND FIND_IN_SET(c.phase, '{phases_cleaned}')"
    if cstart_date and cend_date:
        conditions += f" AND c.creche_opening_date BETWEEN '{cstart_date}' AND '{cend_date}'"

    sql_query = f"""
        SELECT
            P.partner_name AS 'Partner Name',
            hh.date_of_visit AS 'Date of Visit',
            state.state_name AS 'State',
            district.district_name AS 'District',
            block.block_name AS 'Block',
            gp.gp_name AS 'GP',
            village.village_name AS 'Village',
            c.creche_name AS 'creche',
            hh.hamlet AS 'Hamlet',
            hh.landmark AS 'Landmark',
            hh.respondent_name AS 'Respondent Name',
            hh.respondent_age AS 'Respondent Age',
            gender.gender AS 'Respondent Gender',
            hh.hosuehold_head_name AS 'Household Head Name',
            sc.social_category_name AS 'Social Category',
            CASE
                WHEN hh.is_the_family_a_pvtg = 1 THEN 'YES'
                ELSE 'NO'
            END AS 'Is the family a PVTG?',
            hh.pvtg_name AS 'PVTG Name',
            po.primary_occupation AS 'Primary Occupation',
            hh.primary_occupation_other AS 'Primary Occupation Other',
            hh.number_of_family_members AS 'Number of Family Members',
            hh.children__3_years AS 'Children Under 3 years',
            hh.children_3_to_6_years AS 'Children 3 to 6 years',
            hh.children_6_to_18_years AS 'Children 6 to 18 years',
            hh.adults_above_18_years AS 'Adults above 18 years',
            hh.no_of_pregnant_women AS 'Number of Pregnant Women',
            hhc.child_name AS 'Child Name',
            child_gender.gender AS 'Child Gender',
            relation.relation_name AS 'Relation with Child',
            DATE_FORMAT(hhc.child_dob, '%%d-%%m-%%Y') AS `Child DOB`,
            TIMESTAMPDIFF(MONTH, hhc.child_dob, '{end_date}') AS `Child Age in Months`,
            hh.family_members_enganged_as_migrant_workers AS 'Family Members Engaged as Migrant Workers',
            CASE
                WHEN hh.no_of_months_the_migrants_were_away_last_year = 1 THEN '>= 6 Months'
                WHEN hh.no_of_months_the_migrants_were_away_last_year = 2 THEN '< 6 Months'
                ELSE ''
            END AS 'Number of Months the migrants were away last year',
            CASE
                WHEN hh.does_anyone_from_your_family_migrate_every_year = 1 THEN 'YES'
                ELSE 'NO'
            END AS 'Does anyone from the family migrate every year?',
            hh.who_looks_after_them_at_home AS 'Who looks after the children at home?',
            -- New fields added as requested
            hcs.hh_child_status AS 'Child Status',
            IFNULL(cee.child_id, 'Not Enrolled') AS 'Child ID',
            CASE
                WHEN cee.child_id IS NOT NULL THEN 'Yes'
                ELSE 'No'
            END AS 'Is Enrolled?'
        FROM
            `tabHousehold Form` AS hh

        LEFT JOIN (
            SELECT *, ROW_NUMBER() OVER (PARTITION BY parent ORDER BY idx ASC) as rn
            FROM `tabHousehold Child Form`
        ) AS hhc ON hh.name = hhc.parent AND hhc.rn = 1

        -- [FIXED]: Used ROW_NUMBER() to strictly prevent duplicates if multiple enrollments have the same max(creation) timestamp
        LEFT JOIN (
            SELECT *, ROW_NUMBER() OVER (PARTITION BY hhcguid ORDER BY creation DESC) as rn
            FROM `tabChild Enrollment and Exit`
        ) AS cee ON cee.hhcguid = hhc.hhcguid AND cee.rn = 1
        LEFT JOIN
            `tabHH Child Status` AS hcs ON hcs.name = hhc.child_status
        LEFT JOIN
            `tabCreche` AS c ON c.name = hh.creche_id
        LEFT JOIN
            `tabPartner` AS P ON P.name = hh.partner_id
        LEFT JOIN
            `tabState` AS state ON state.name = hh.state_id
        LEFT JOIN
            `tabDistrict` AS district ON district.name = hh.district_id
        LEFT JOIN
            `tabBlock` AS block ON block.name = hh.block_id
        LEFT JOIN
            `tabGram Panchayat` AS gp ON gp.name = hh.gp_id
        LEFT JOIN
            `tabVillage` AS village ON village.name = hh.village_id
        LEFT JOIN
            `tabGender` AS gender ON gender.name = hh.respondent_gender_id
        LEFT JOIN
            `tabSocial Category` AS sc ON sc.name = hh.social_category_id
        LEFT JOIN
            `tabPrimary Occupation` AS po ON po.name = hh.primary_occupation_id
        LEFT JOIN
            `tabGender` AS child_gender ON child_gender.name = hhc.gender_id
        LEFT JOIN
            `tabRelation` AS relation ON relation.name = hhc.relationship_with_child
        WHERE
            1 = 1 {conditions}
            AND hh.date_of_visit BETWEEN %(visit_start_date)s AND %(visit_end_date)s
        ORDER BY
            P.partner_name, state.state_name ASC
    """


    params["visit_start_date"] = start_date
    params["visit_end_date"] = end_date

    data = frappe.db.sql(sql_query, params, as_dict=True)
    return data
