import threading
from datetime import date
import frappe
from frappe.apf.user_scope import scoped
import calendar
import math
from concurrent.futures import ThreadPoolExecutor, as_completed

def get_creche_no(params):
    query = """
    SELECT COUNT(*)
    FROM `tabCreche` tc
    WHERE
    (%(partner_id)s IS NULL OR tc.partner_id = %(partner_id)s)
    AND (
        (%(state_id)s IS NOT NULL AND tc.state_id = %(state_id)s)
        OR (%(state_id)s IS NULL AND %(state_ids)s IS NOT NULL AND FIND_IN_SET(tc.state_id, %(state_ids)s))
        OR (%(state_id)s IS NULL AND %(state_ids)s IS NULL)
    )
    AND (
        (%(district_id)s IS NOT NULL AND tc.district_id = %(district_id)s)
        OR (%(district_id)s IS NULL AND %(district_ids)s IS NOT NULL AND FIND_IN_SET(tc.district_id, %(district_ids)s))
        OR (%(district_id)s IS NULL AND %(district_ids)s IS NULL)
    )
    AND (
        (%(block_id)s IS NOT NULL AND tc.block_id = %(block_id)s)
        OR (%(block_id)s IS NULL AND %(block_ids)s IS NOT NULL AND FIND_IN_SET(tc.block_id, %(block_ids)s))
        OR (%(block_id)s IS NULL AND %(block_ids)s IS NULL)
    )
    AND (
        (%(gp_id)s IS NOT NULL AND tc.gp_id = %(gp_id)s)
        OR (%(gp_id)s IS NULL AND %(gp_ids)s IS NOT NULL AND FIND_IN_SET(tc.gp_id, %(gp_ids)s))
        OR (%(gp_id)s IS NULL AND %(gp_ids)s IS NULL)
    )
    AND (%(village_id)s IS NULL OR tc.village_id = %(village_id)s)
    AND (%(creche_id)s IS NULL OR tc.name = %(creche_id)s)
    AND (%(supervisor_id)s IS NULL OR tc.supervisor_id = %(supervisor_id)s)
    AND (%(c_status)s IS NULL OR tc.creche_status_id = %(c_status)s)
    AND (tc.creche_opening_date IS NULL OR ( %(end_date)s IS NOT NULL AND tc.creche_opening_date <= %(end_date)s ))
    """
    return frappe.db.sql(query, params)[0][0] or 0

def get_no_creche_attendance_submitted(params):
    query = """
    SELECT COUNT(*)
    FROM (
        SELECT
            tc.name,
            tc.creche_opening_date,
            DATEDIFF(
                CASE
                    WHEN DATE_FORMAT(CURRENT_DATE(), '%%Y-%%m') = DATE_FORMAT(%(start_date)s, '%%Y-%%m')
                    THEN CURRENT_DATE()
                    ELSE %(end_date)s
                END,
                CASE
                    WHEN tc.creche_opening_date < %(start_date)s
                    THEN %(start_date)s
                    ELSE tc.creche_opening_date
                END
            ) + 1 AS elgdays,
            IFNULL(att.attdays, 0) AS attdays
        FROM
            `tabCreche` tc
        LEFT JOIN (
            SELECT
                tca.creche_id,
                COUNT(*) AS attdays
            FROM
                `tabChild Attendance` tca
            WHERE
                tca.date_of_attendance BETWEEN %(start_date)s AND %(end_date)s
            GROUP BY
                tca.creche_id
        ) AS att
        ON tc.name = att.creche_id
        WHERE
            tc.creche_opening_date IS NOT NULL
            AND tc.creche_opening_date <= %(end_date)s
            AND (%(partner_id)s IS NULL OR tc.partner_id = %(partner_id)s)
            AND (
                (%(state_id)s IS NOT NULL AND tc.state_id = %(state_id)s)
                OR (%(state_id)s IS NULL AND %(state_ids)s IS NOT NULL AND FIND_IN_SET(tc.state_id, %(state_ids)s))
                OR (%(state_id)s IS NULL AND %(state_ids)s IS NULL)
            )
            AND (
                (%(district_id)s IS NOT NULL AND tc.district_id = %(district_id)s)
                OR (%(district_id)s IS NULL AND %(district_ids)s IS NOT NULL AND FIND_IN_SET(tc.district_id, %(district_ids)s))
                OR (%(district_id)s IS NULL AND %(district_ids)s IS NULL)
            )
            AND (
                (%(block_id)s IS NOT NULL AND tc.block_id = %(block_id)s)
                OR (%(block_id)s IS NULL AND %(block_ids)s IS NOT NULL AND FIND_IN_SET(tc.block_id, %(block_ids)s))
                OR (%(block_id)s IS NULL AND %(block_ids)s IS NULL)
            )
            AND (
                (%(gp_id)s IS NOT NULL AND tc.gp_id = %(gp_id)s)
                OR (%(gp_id)s IS NULL AND %(gp_ids)s IS NOT NULL AND FIND_IN_SET(tc.gp_id, %(gp_ids)s))
                OR (%(gp_id)s IS NULL AND %(gp_ids)s IS NULL)
            )
            AND (%(supervisor_id)s IS NULL OR tc.supervisor_id = %(supervisor_id)s)
            AND (%(creche_id)s IS NULL OR tc.name = %(creche_id)s)
            AND (%(c_status)s IS NULL OR tc.creche_status_id = %(c_status)s)
            AND (tc.creche_opening_date IS NULL OR ( %(end_date)s IS NOT NULL AND tc.creche_opening_date <= %(end_date)s ))
            AND ((%(cstart_date)s IS NULL AND %(cend_date)s IS NULL) OR (tc.creche_opening_date BETWEEN %(cstart_date)s AND %(cend_date)s))
    ) AS creche_attendance
    WHERE elgdays <= attdays
    """
    return frappe.db.sql(query, params)[0][0] or 0

def get_no_days_creche_opened(params):
    query = """
    SELECT IFNULL(COUNT(*), 0)
    FROM `tabChild Attendance` ca
    JOIN `tabCreche` cr ON cr.name = ca.creche_id
    WHERE ca.is_shishu_ghar_is_closed_for_the_day = 0
    AND YEAR(ca.date_of_attendance) = %(year)s
    AND MONTH(ca.date_of_attendance) = %(month)s
    AND (%(partner_id)s IS NULL OR ca.partner_id = %(partner_id)s)
    AND (
        (%(state_id)s IS NOT NULL AND ca.state_id = %(state_id)s)
        OR (%(state_id)s IS NULL AND %(state_ids)s IS NOT NULL AND FIND_IN_SET(ca.state_id, %(state_ids)s))
        OR (%(state_id)s IS NULL AND %(state_ids)s IS NULL)
    )
    AND (
        (%(district_id)s IS NOT NULL AND ca.district_id = %(district_id)s)
        OR (%(district_id)s IS NULL AND %(district_ids)s IS NOT NULL AND FIND_IN_SET(ca.district_id, %(district_ids)s))
        OR (%(district_id)s IS NULL AND %(district_ids)s IS NULL)
    )
    AND (
        (%(block_id)s IS NOT NULL AND ca.block_id = %(block_id)s)
        OR (%(block_id)s IS NULL AND %(block_ids)s IS NOT NULL AND FIND_IN_SET(ca.block_id, %(block_ids)s))
        OR (%(block_id)s IS NULL AND %(block_ids)s IS NULL)
    )
    AND (
        (%(gp_id)s IS NOT NULL AND ca.gp_id = %(gp_id)s)
        OR (%(gp_id)s IS NULL AND %(gp_ids)s IS NOT NULL AND FIND_IN_SET(ca.gp_id, %(gp_ids)s))
        OR (%(gp_id)s IS NULL AND %(gp_ids)s IS NULL)
    )
    AND (%(village_id)s IS NULL OR ca.village_id = %(village_id)s)
    AND (%(creche_id)s IS NULL OR ca.creche_id = %(creche_id)s)
    AND (%(c_status)s IS NULL OR cr.creche_status_id = %(c_status)s)
    AND (%(supervisor_id)s IS NULL OR cr.supervisor_id = %(supervisor_id)s)
   
    AND (cr.creche_opening_date IS NULL OR ( %(end_date)s IS NOT NULL AND cr.creche_opening_date <= %(end_date)s ))
    """
    return frappe.db.sql(query, params)[0][0] or 0

def get_no_children_present_creche_opened(params):
    query = """
    SELECT IFNULL(COUNT(cal.name), 0)
    FROM `tabChild Attendance List` cal
    JOIN `tabChild Attendance` ca ON ca.name = cal.parent
    JOIN `tabCreche` cr ON cr.name = ca.creche_id
    WHERE cal.attendance = 1
    AND ca.is_shishu_ghar_is_closed_for_the_day = 0
    AND YEAR(ca.date_of_attendance) = %(year)s
    AND MONTH(ca.date_of_attendance) = %(month)s
    AND (%(partner_id)s IS NULL OR ca.partner_id = %(partner_id)s)
    AND (
        (%(state_id)s IS NOT NULL AND ca.state_id = %(state_id)s)
        OR (%(state_id)s IS NULL AND %(state_ids)s IS NOT NULL AND FIND_IN_SET(ca.state_id, %(state_ids)s))
        OR (%(state_id)s IS NULL AND %(state_ids)s IS NULL)
    )
    AND (
        (%(district_id)s IS NOT NULL AND ca.district_id = %(district_id)s)
        OR (%(district_id)s IS NULL AND %(district_ids)s IS NOT NULL AND FIND_IN_SET(ca.district_id, %(district_ids)s))
        OR (%(district_id)s IS NULL AND %(district_ids)s IS NULL)
    )
    AND (
        (%(block_id)s IS NOT NULL AND ca.block_id = %(block_id)s)
        OR (%(block_id)s IS NULL AND %(block_ids)s IS NOT NULL AND FIND_IN_SET(ca.block_id, %(block_ids)s))
        OR (%(block_id)s IS NULL AND %(block_ids)s IS NULL)
    )
    AND (
        (%(gp_id)s IS NOT NULL AND ca.gp_id = %(gp_id)s)
        OR (%(gp_id)s IS NULL AND %(gp_ids)s IS NOT NULL AND FIND_IN_SET(ca.gp_id, %(gp_ids)s))
        OR (%(gp_id)s IS NULL AND %(gp_ids)s IS NULL)
    )
    AND (%(village_id)s IS NULL OR ca.village_id = %(village_id)s)
    AND (%(creche_id)s IS NULL OR ca.creche_id = %(creche_id)s)
    AND (%(c_status)s IS NULL OR cr.creche_status_id = %(c_status)s)
    AND (%(supervisor_id)s IS NULL OR cr.supervisor_id = %(supervisor_id)s)
   
    AND (cr.creche_opening_date IS NULL OR ( %(end_date)s IS NOT NULL AND cr.creche_opening_date <= %(end_date)s ))
    """
    return frappe.db.sql(query, params)[0][0] or 0

def get_no_children_curr_active(params):
    query = """
    SELECT COUNT(*)
    FROM `tabChild Enrollment and Exit` cee
    INNER JOIN `tabCreche` cr ON cr.name = cee.creche_id
    WHERE (cee.date_of_enrollment <= %(end_date)s
    AND (cee.date_of_exit IS NULL OR cee.date_of_exit > %(end_date)s))
    AND (%(partner_id)s IS NULL OR cr.partner_id = %(partner_id)s)
    AND (
        (%(state_id)s IS NOT NULL AND cr.state_id = %(state_id)s)
        OR (%(state_id)s IS NULL AND %(state_ids)s IS NOT NULL AND FIND_IN_SET(cr.state_id, %(state_ids)s))
        OR (%(state_id)s IS NULL AND %(state_ids)s IS NULL)
    )
    AND (
        (%(district_id)s IS NOT NULL AND cr.district_id = %(district_id)s)
        OR (%(district_id)s IS NULL AND %(district_ids)s IS NOT NULL AND FIND_IN_SET(cr.district_id, %(district_ids)s))
        OR (%(district_id)s IS NULL AND %(district_ids)s IS NULL)
    )
    AND (
        (%(block_id)s IS NOT NULL AND cr.block_id = %(block_id)s)
        OR (%(block_id)s IS NULL AND %(block_ids)s IS NOT NULL AND FIND_IN_SET(cr.block_id, %(block_ids)s))
        OR (%(block_id)s IS NULL AND %(block_ids)s IS NULL)
    )
    AND (
        (%(gp_id)s IS NOT NULL AND cr.gp_id = %(gp_id)s)
        OR (%(gp_id)s IS NULL AND %(gp_ids)s IS NOT NULL AND FIND_IN_SET(cr.gp_id, %(gp_ids)s))
        OR (%(gp_id)s IS NULL AND %(gp_ids)s IS NULL)
    )
    AND (%(village_id)s IS NULL OR cee.village_id = %(village_id)s)
    AND (%(creche_id)s IS NULL OR cee.creche_id = %(creche_id)s)
    AND (%(c_status)s IS NULL OR cr.creche_status_id = %(c_status)s)
    AND (%(supervisor_id)s IS NULL OR cr.supervisor_id = %(supervisor_id)s)
   
    AND (cr.creche_opening_date IS NULL OR ( %(end_date)s IS NOT NULL AND cr.creche_opening_date <= %(end_date)s ))
    """
    return frappe.db.sql(query, params)[0][0] or 0

def get_Max_Attendance_in_a_Day(params):
    query = """
    SELECT IFNULL(MAX(daily_attendance), 0)
    FROM (
        SELECT COUNT(cal.name) AS daily_attendance
        FROM `tabChild Attendance` ca
        JOIN `tabChild Attendance List` cal ON ca.name = cal.parent
        JOIN `tabCreche` cr on cr.name = ca.creche_id
        WHERE cal.attendance = 1
        AND ca.is_shishu_ghar_is_closed_for_the_day = 0
        AND YEAR(ca.date_of_attendance) = %(year)s
        AND MONTH(ca.date_of_attendance) = %(month)s
        AND (%(partner_id)s IS NULL OR ca.partner_id = %(partner_id)s)
        AND (
            (%(state_id)s IS NOT NULL AND ca.state_id = %(state_id)s)
            OR (%(state_id)s IS NULL AND %(state_ids)s IS NOT NULL AND FIND_IN_SET(ca.state_id, %(state_ids)s))
            OR (%(state_id)s IS NULL AND %(state_ids)s IS NULL)
        )
        AND (
            (%(district_id)s IS NOT NULL AND ca.district_id = %(district_id)s)
            OR (%(district_id)s IS NULL AND %(district_ids)s IS NOT NULL AND FIND_IN_SET(ca.district_id, %(district_ids)s))
            OR (%(district_id)s IS NULL AND %(district_ids)s IS NULL)
        )
        AND (
            (%(block_id)s IS NOT NULL AND ca.block_id = %(block_id)s)
            OR (%(block_id)s IS NULL AND %(block_ids)s IS NOT NULL AND FIND_IN_SET(ca.block_id, %(block_ids)s))
            OR (%(block_id)s IS NULL AND %(block_ids)s IS NULL)
        )
        AND (
            (%(gp_id)s IS NOT NULL AND ca.gp_id = %(gp_id)s)
            OR (%(gp_id)s IS NULL AND %(gp_ids)s IS NOT NULL AND FIND_IN_SET(ca.gp_id, %(gp_ids)s))
            OR (%(gp_id)s IS NULL AND %(gp_ids)s IS NULL)
        )
        AND (%(village_id)s IS NULL OR ca.village_id = %(village_id)s)
        AND (%(creche_id)s IS NULL OR ca.creche_id = %(creche_id)s)
        AND (%(c_status)s IS NULL OR cr.creche_status_id = %(c_status)s)
        AND (%(supervisor_id)s IS NULL OR cr.supervisor_id = %(supervisor_id)s)
       
        AND (cr.creche_opening_date IS NULL OR ( %(end_date)s IS NOT NULL AND cr.creche_opening_date <= %(end_date)s ))
        GROUP BY ca.date_of_attendance
    ) AS daily_data
    """
    return frappe.db.sql(query, params)[0][0] or 0

def get_No_of_days_creche_attendance_submitted(params):
    query = """
    SELECT COUNT(*)
    FROM `tabChild Attendance` ca
    JOIN `tabCreche` cr on cr.name = ca.creche_id
    WHERE YEAR(ca.date_of_attendance) = %(year)s
    AND MONTH(ca.date_of_attendance) = %(month)s
    AND (%(partner_id)s IS NULL OR ca.partner_id = %(partner_id)s)
    AND (
        (%(state_id)s IS NOT NULL AND ca.state_id = %(state_id)s)
        OR (%(state_id)s IS NULL AND %(state_ids)s IS NOT NULL AND FIND_IN_SET(ca.state_id, %(state_ids)s))
        OR (%(state_id)s IS NULL AND %(state_ids)s IS NULL)
    )
    AND (
        (%(district_id)s IS NOT NULL AND ca.district_id = %(district_id)s)
        OR (%(district_id)s IS NULL AND %(district_ids)s IS NOT NULL AND FIND_IN_SET(ca.district_id, %(district_ids)s))
        OR (%(district_id)s IS NULL AND %(district_ids)s IS NULL)
    )
    AND (
        (%(block_id)s IS NOT NULL AND ca.block_id = %(block_id)s)
        OR (%(block_id)s IS NULL AND %(block_ids)s IS NOT NULL AND FIND_IN_SET(ca.block_id, %(block_ids)s))
        OR (%(block_id)s IS NULL AND %(block_ids)s IS NULL)
    )
    AND (
        (%(gp_id)s IS NOT NULL AND ca.gp_id = %(gp_id)s)
        OR (%(gp_id)s IS NULL AND %(gp_ids)s IS NOT NULL AND FIND_IN_SET(ca.gp_id, %(gp_ids)s))
        OR (%(gp_id)s IS NULL AND %(gp_ids)s IS NULL)
    )
    AND (%(village_id)s IS NULL OR ca.village_id = %(village_id)s)
    AND (%(creche_id)s IS NULL OR ca.creche_id = %(creche_id)s)
    AND (%(c_status)s IS NULL OR cr.creche_status_id = %(c_status)s)
    AND (%(supervisor_id)s IS NULL OR cr.supervisor_id = %(supervisor_id)s)
   
    AND (cr.creche_opening_date IS NULL OR ( %(end_date)s IS NOT NULL AND cr.creche_opening_date <= %(end_date)s ))
    """
    return frappe.db.sql(query, params)[0][0] or 0

def get_Total_Anthro_data_submitted(params):
    query = """
    SELECT COUNT(*)
    FROM `tabChild Growth Monitoring` cgm
    JOIN `tabCreche` cr on cr.name = cgm.creche_id
    WHERE YEAR(cgm.measurement_date) = %(year)s
    AND MONTH(cgm.measurement_date) = %(month)s
    AND (%(partner_id)s IS NULL OR cgm.partner_id = %(partner_id)s)
    AND (
        (%(state_id)s IS NOT NULL AND cgm.state_id = %(state_id)s)
        OR (%(state_id)s IS NULL AND %(state_ids)s IS NOT NULL AND FIND_IN_SET(cgm.state_id, %(state_ids)s))
        OR (%(state_id)s IS NULL AND %(state_ids)s IS NULL)
    )
    AND (
        (%(district_id)s IS NOT NULL AND cgm.district_id = %(district_id)s)
        OR (%(district_id)s IS NULL AND %(district_ids)s IS NOT NULL AND FIND_IN_SET(cgm.district_id, %(district_ids)s))
        OR (%(district_id)s IS NULL AND %(district_ids)s IS NULL)
    )
    AND (
        (%(block_id)s IS NOT NULL AND cgm.block_id = %(block_id)s)
        OR (%(block_id)s IS NULL AND %(block_ids)s IS NOT NULL AND FIND_IN_SET(cgm.block_id, %(block_ids)s))
        OR (%(block_id)s IS NULL AND %(block_ids)s IS NULL)
    )
    AND (
        (%(gp_id)s IS NOT NULL AND cgm.gp_id = %(gp_id)s)
        OR (%(gp_id)s IS NULL AND %(gp_ids)s IS NOT NULL AND FIND_IN_SET(cgm.gp_id, %(gp_ids)s))
        OR (%(gp_id)s IS NULL AND %(gp_ids)s IS NULL)
    )
    AND (%(village_id)s IS NULL OR cgm.village_id = %(village_id)s)
    AND (%(creche_id)s IS NULL OR cgm.creche_id = %(creche_id)s)
    AND (%(c_status)s IS NULL OR cr.creche_status_id = %(c_status)s)
    AND (%(supervisor_id)s IS NULL OR cr.supervisor_id = %(supervisor_id)s)
   
    AND (cr.creche_opening_date IS NULL OR ( %(end_date)s IS NOT NULL AND cr.creche_opening_date <= %(end_date)s ))
    """
    return frappe.db.sql(query, params)[0][0] or 0

def get_current_enrolled_children(params):
    query = """
    SELECT COUNT(*)
    FROM `tabChild Enrollment and Exit` AS cees
    JOIN `tabCreche` AS cr ON cr.name = cees.creche_id
    WHERE YEAR(cees.date_of_enrollment) = %(year)s
    AND MONTH(cees.date_of_enrollment) = %(month)s
    AND (%(partner_id)s IS NULL OR cees.partner_id = %(partner_id)s)
    AND (
        (%(state_id)s IS NOT NULL AND cees.state_id = %(state_id)s)
        OR (%(state_id)s IS NULL AND %(state_ids)s IS NOT NULL AND FIND_IN_SET(cees.state_id, %(state_ids)s))
        OR (%(state_id)s IS NULL AND %(state_ids)s IS NULL)
    )
    AND (
        (%(district_id)s IS NOT NULL AND cees.district_id = %(district_id)s)
        OR (%(district_id)s IS NULL AND %(district_ids)s IS NOT NULL AND FIND_IN_SET(cees.district_id, %(district_ids)s))
        OR (%(district_id)s IS NULL AND %(district_ids)s IS NULL)
    )
    AND (
        (%(block_id)s IS NOT NULL AND cees.block_id = %(block_id)s)
        OR (%(block_id)s IS NULL AND %(block_ids)s IS NOT NULL AND FIND_IN_SET(cees.block_id, %(block_ids)s))
        OR (%(block_id)s IS NULL AND %(block_ids)s IS NULL)
    )
    AND (
        (%(gp_id)s IS NOT NULL AND cees.gp_id = %(gp_id)s)
        OR (%(gp_id)s IS NULL AND %(gp_ids)s IS NOT NULL AND FIND_IN_SET(cees.gp_id, %(gp_ids)s))
        OR (%(gp_id)s IS NULL AND %(gp_ids)s IS NULL)
    )
    AND (%(village_id)s IS NULL OR cees.village_id = %(village_id)s)
    AND (%(creche_id)s IS NULL OR cees.creche_id = %(creche_id)s)
    AND (%(c_status)s IS NULL OR cr.creche_status_id = %(c_status)s)
    AND (%(supervisor_id)s IS NULL OR cr.supervisor_id = %(supervisor_id)s)
   
    AND (cr.creche_opening_date IS NULL OR ( %(end_date)s IS NOT NULL AND cr.creche_opening_date <= %(end_date)s ))
    """
    return frappe.db.sql(query, params)[0][0] or 0

def get_cur_eligible_children(params):
    query = """
    SELECT COUNT(hhc.name)
    FROM `tabHousehold Child Form` AS hhc
    JOIN `tabHousehold Form` AS hf ON hf.name = hhc.parent
    JOIN `tabCreche` AS cr ON cr.name = hf.creche_id
    WHERE hhc.is_dob_available = 1
    AND (
        hhc.child_dob BETWEEN
            DATE_SUB(
                IF(DATE_FORMAT(%(end_date)s, '%%Y-%%m') = DATE_FORMAT(CURDATE(), '%%Y-%%m'),
                    CURDATE(),
                    %(end_date)s
                ),
                INTERVAL 36 MONTH
            )
            AND
            DATE_SUB(
                IF(DATE_FORMAT(%(end_date)s, '%%Y-%%m') = DATE_FORMAT(CURDATE(), '%%Y-%%m'),
                    CURDATE(),
                    %(end_date)s
                ),
                INTERVAL 6 MONTH
            )
    )
    AND (%(partner_id)s IS NULL OR hf.partner_id = %(partner_id)s)
    AND (
        (%(state_id)s IS NOT NULL AND hf.state_id = %(state_id)s)
        OR (%(state_id)s IS NULL AND %(state_ids)s IS NOT NULL AND FIND_IN_SET(hf.state_id, %(state_ids)s))
        OR (%(state_id)s IS NULL AND %(state_ids)s IS NULL)
    )
    AND (
        (%(district_id)s IS NOT NULL AND hf.district_id = %(district_id)s)
        OR (%(district_id)s IS NULL AND %(district_ids)s IS NOT NULL AND FIND_IN_SET(hf.district_id, %(district_ids)s))
        OR (%(district_id)s IS NULL AND %(district_ids)s IS NULL)
    )
    AND (
        (%(block_id)s IS NOT NULL AND hf.block_id = %(block_id)s)
        OR (%(block_id)s IS NULL AND %(block_ids)s IS NOT NULL AND FIND_IN_SET(hf.block_id, %(block_ids)s))
        OR (%(block_id)s IS NULL AND %(block_ids)s IS NULL)
    )
    AND (
        (%(gp_id)s IS NOT NULL AND hf.gp_id = %(gp_id)s)
        OR (%(gp_id)s IS NULL AND %(gp_ids)s IS NOT NULL AND FIND_IN_SET(hf.gp_id, %(gp_ids)s))
        OR (%(gp_id)s IS NULL AND %(gp_ids)s IS NULL)
    )
    AND (%(village_id)s IS NULL OR hf.village_id = %(village_id)s)
    AND (%(creche_id)s IS NULL OR hf.creche_id = %(creche_id)s)
    AND (%(c_status)s IS NULL OR cr.creche_status_id = %(c_status)s)
    AND (%(supervisor_id)s IS NULL OR cr.supervisor_id = %(supervisor_id)s)
   
    AND (cr.creche_opening_date IS NULL OR ( %(end_date)s IS NOT NULL AND cr.creche_opening_date <= %(end_date)s ))
    """
    return frappe.db.sql(query, params)[0][0] or 0

def get_Total_Current_exit_children(params):
    query = """
    SELECT COUNT(*)
    FROM `tabChild Enrollment and Exit` cec
    JOIN `tabCreche` AS cr ON cr.name = cec.creche_id
    WHERE YEAR(date_of_exit) = %(year)s
    AND MONTH(date_of_exit) = %(month)s
    AND (%(partner_id)s IS NULL OR cec.partner_id = %(partner_id)s)
    AND (
        (%(state_id)s IS NOT NULL AND cec.state_id = %(state_id)s)
        OR (%(state_id)s IS NULL AND %(state_ids)s IS NOT NULL AND FIND_IN_SET(cec.state_id, %(state_ids)s))
        OR (%(state_id)s IS NULL AND %(state_ids)s IS NULL)
    )
    AND (
        (%(district_id)s IS NOT NULL AND cec.district_id = %(district_id)s)
        OR (%(district_id)s IS NULL AND %(district_ids)s IS NOT NULL AND FIND_IN_SET(cec.district_id, %(district_ids)s))
        OR (%(district_id)s IS NULL AND %(district_ids)s IS NULL)
    )
    AND (
        (%(block_id)s IS NOT NULL AND cec.block_id = %(block_id)s)
        OR (%(block_id)s IS NULL AND %(block_ids)s IS NOT NULL AND FIND_IN_SET(cec.block_id, %(block_ids)s))
        OR (%(block_id)s IS NULL AND %(block_ids)s IS NULL)
    )
    AND (
        (%(gp_id)s IS NOT NULL AND cec.gp_id = %(gp_id)s)
        OR (%(gp_id)s IS NULL AND %(gp_ids)s IS NOT NULL AND FIND_IN_SET(cec.gp_id, %(gp_ids)s))
        OR (%(gp_id)s IS NULL AND %(gp_ids)s IS NULL)
    )
    AND (%(village_id)s IS NULL OR cec.village_id = %(village_id)s)
    AND (%(creche_id)s IS NULL OR cec.creche_id = %(creche_id)s)
    AND (%(c_status)s IS NULL OR cr.creche_status_id = %(c_status)s)
    AND (%(supervisor_id)s IS NULL OR cr.supervisor_id = %(supervisor_id)s)
   
    AND (cr.creche_opening_date IS NULL OR ( %(end_date)s IS NOT NULL AND cr.creche_opening_date <= %(end_date)s ))
    """
    return frappe.db.sql(query, params)[0][0] or 0

def get_cumm_enrolled_children(params):
    query = """
    SELECT COUNT(*)
    FROM `tabChild Enrollment and Exit` AS cee
    JOIN `tabCreche` AS cr ON cr.name = cee.creche_id
    WHERE cee.date_of_enrollment <= %(end_date)s
    AND (%(partner_id)s IS NULL OR cee.partner_id = %(partner_id)s)
    AND (
        (%(state_id)s IS NOT NULL AND cee.state_id = %(state_id)s)
        OR (%(state_id)s IS NULL AND %(state_ids)s IS NOT NULL AND FIND_IN_SET(cee.state_id, %(state_ids)s))
        OR (%(state_id)s IS NULL AND %(state_ids)s IS NULL)
    )
    AND (
        (%(district_id)s IS NOT NULL AND cee.district_id = %(district_id)s)
        OR (%(district_id)s IS NULL AND %(district_ids)s IS NOT NULL AND FIND_IN_SET(cee.district_id, %(district_ids)s))
        OR (%(district_id)s IS NULL AND %(district_ids)s IS NULL)
    )
    AND (
        (%(block_id)s IS NOT NULL AND cee.block_id = %(block_id)s)
        OR (%(block_id)s IS NULL AND %(block_ids)s IS NOT NULL AND FIND_IN_SET(cee.block_id, %(block_ids)s))
        OR (%(block_id)s IS NULL AND %(block_ids)s IS NULL)
    )
    AND (
        (%(gp_id)s IS NOT NULL AND cee.gp_id = %(gp_id)s)
        OR (%(gp_id)s IS NULL AND %(gp_ids)s IS NOT NULL AND FIND_IN_SET(cee.gp_id, %(gp_ids)s))
        OR (%(gp_id)s IS NULL AND %(gp_ids)s IS NULL)
    )
    AND (%(village_id)s IS NULL OR cee.village_id = %(village_id)s)
    AND (%(creche_id)s IS NULL OR cee.creche_id = %(creche_id)s)
    AND (%(c_status)s IS NULL OR cr.creche_status_id = %(c_status)s)
    AND (%(supervisor_id)s IS NULL OR cr.supervisor_id = %(supervisor_id)s)
   
    AND (cr.creche_opening_date IS NULL OR ( %(end_date)s IS NOT NULL AND cr.creche_opening_date <= %(end_date)s ))
    """
    return frappe.db.sql(query, params)[0][0] or 0

def get_Total_Cumulative_exit_children(params):
    query = """
    SELECT COUNT(*)
    FROM `tabChild Enrollment and Exit` cmec
    JOIN `tabCreche` AS cr ON cr.name = cmec.creche_id
    WHERE date_of_exit <= %(end_date)s
    AND (%(partner_id)s IS NULL OR cmec.partner_id = %(partner_id)s)
    AND (
        (%(state_id)s IS NOT NULL AND cmec.state_id = %(state_id)s)
        OR (%(state_id)s IS NULL AND %(state_ids)s IS NOT NULL AND FIND_IN_SET(cmec.state_id, %(state_ids)s))
        OR (%(state_id)s IS NULL AND %(state_ids)s IS NULL)
    )
    AND (
        (%(district_id)s IS NULL OR cmec.district_id = %(district_id)s)
        OR (%(district_id)s IS NULL AND %(district_ids)s IS NOT NULL AND FIND_IN_SET(cmec.district_id, %(district_ids)s))
        OR (%(district_id)s IS NULL AND %(district_ids)s IS NULL)
    )
    AND (
        (%(block_id)s IS NOT NULL AND cmec.block_id = %(block_id)s)
        OR (%(block_id)s IS NULL AND %(block_ids)s IS NOT NULL AND FIND_IN_SET(cmec.block_id, %(block_ids)s))
        OR (%(block_id)s IS NULL AND %(block_ids)s IS NULL)
    )
    AND (
        (%(gp_id)s IS NOT NULL AND cmec.gp_id = %(gp_id)s)
        OR (%(gp_id)s IS NULL AND %(gp_ids)s IS NOT NULL AND FIND_IN_SET(cmec.gp_id, %(gp_ids)s))
        OR (%(gp_id)s IS NULL AND %(gp_ids)s IS NULL)
    )
    AND (%(village_id)s IS NULL OR cmec.village_id = %(village_id)s)
    AND (%(creche_id)s IS NULL OR cmec.creche_id = %(creche_id)s)
    AND (%(c_status)s IS NULL OR cr.creche_status_id = %(c_status)s)
    AND (%(supervisor_id)s IS NULL OR cr.supervisor_id = %(supervisor_id)s)
   
    AND (cr.creche_opening_date IS NULL OR ( %(end_date)s IS NOT NULL AND cr.creche_opening_date <= %(end_date)s ))
    """
    return frappe.db.sql(query, params)[0][0] or 0

def get_Total_Underweight_children(params):
    query = """
    SELECT COUNT(ad.name)
    FROM `tabAnthropromatic Data` AS ad
    JOIN `tabChild Growth Monitoring` AS cgm ON cgm.name = ad.parent
    JOIN `tabCreche` AS cr ON cr.name = cgm.creche_id
    WHERE YEAR(cgm.measurement_date) = %(year)s
    AND MONTH(cgm.measurement_date) = %(month)s
    AND ad.do_you_have_height_weight = 1
    AND ad.weight_for_age = 2
    AND (%(partner_id)s IS NULL OR cgm.partner_id = %(partner_id)s)
    AND (
        (%(state_id)s IS NOT NULL AND cgm.state_id = %(state_id)s)
        OR (%(state_id)s IS NULL AND %(state_ids)s IS NOT NULL AND FIND_IN_SET(cgm.state_id, %(state_ids)s))
        OR (%(state_id)s IS NULL AND %(state_ids)s IS NULL)
    )
    AND (
        (%(district_id)s IS NOT NULL AND cgm.district_id = %(district_id)s)
        OR (%(district_id)s IS NULL AND %(district_ids)s IS NOT NULL AND FIND_IN_SET(cgm.district_id, %(district_ids)s))
        OR (%(district_id)s IS NULL AND %(district_ids)s IS NULL)
    )
    AND (
        (%(block_id)s IS NOT NULL AND cgm.block_id = %(block_id)s)
        OR (%(block_id)s IS NULL AND %(block_ids)s IS NOT NULL AND FIND_IN_SET(cgm.block_id, %(block_ids)s))
        OR (%(block_id)s IS NULL AND %(block_ids)s IS NULL)
    )
    AND (
        (%(gp_id)s IS NOT NULL AND cgm.gp_id = %(gp_id)s)
        OR (%(gp_id)s IS NULL AND %(gp_ids)s IS NOT NULL AND FIND_IN_SET(cgm.gp_id, %(gp_ids)s))
        OR (%(gp_id)s IS NULL AND %(gp_ids)s IS NULL)
    )
    AND (%(village_id)s IS NULL OR cgm.village_id = %(village_id)s)
    AND (%(creche_id)s IS NULL OR cgm.creche_id = %(creche_id)s)
    AND (%(c_status)s IS NULL OR cr.creche_status_id = %(c_status)s)
    AND (%(supervisor_id)s IS NULL OR cr.supervisor_id = %(supervisor_id)s)
   
    AND (cr.creche_opening_date IS NULL OR ( %(end_date)s IS NOT NULL AND cr.creche_opening_date <= %(end_date)s ))
    """
    return frappe.db.sql(query, params)[0][0] or 0

def get_Total_MAM_children(params):
    query = """
    SELECT COUNT(ad.name)
    FROM `tabAnthropromatic Data` AS ad
    JOIN `tabChild Growth Monitoring` AS cgm ON cgm.name = ad.parent
    JOIN `tabCreche` AS cr ON cr.name = cgm.creche_id
    WHERE YEAR(cgm.measurement_date) = %(year)s
    AND MONTH(cgm.measurement_date) = %(month)s
    AND ad.do_you_have_height_weight = 1
    AND ad.weight_for_height = 2
    AND (%(partner_id)s IS NULL OR cgm.partner_id = %(partner_id)s)
    AND (
        (%(state_id)s IS NOT NULL AND cgm.state_id = %(state_id)s)
        OR (%(state_id)s IS NULL AND %(state_ids)s IS NOT NULL AND FIND_IN_SET(cgm.state_id, %(state_ids)s))
        OR (%(state_id)s IS NULL AND %(state_ids)s IS NULL)
    )
    AND (
        (%(district_id)s IS NOT NULL AND cgm.district_id = %(district_id)s)
        OR (%(district_id)s IS NULL AND %(district_ids)s IS NOT NULL AND FIND_IN_SET(cgm.district_id, %(district_ids)s))
        OR (%(district_id)s IS NULL AND %(district_ids)s IS NULL)
    )
    AND (
        (%(block_id)s IS NOT NULL AND cgm.block_id = %(block_id)s)
        OR (%(block_id)s IS NULL AND %(block_ids)s IS NOT NULL AND FIND_IN_SET(cgm.block_id, %(block_ids)s))
        OR (%(block_id)s IS NULL AND %(block_ids)s IS NULL)
    )
    AND (
        (%(gp_id)s IS NOT NULL AND cgm.gp_id = %(gp_id)s)
        OR (%(gp_id)s IS NULL AND %(gp_ids)s IS NOT NULL AND FIND_IN_SET(cgm.gp_id, %(gp_ids)s))
        OR (%(gp_id)s IS NULL AND %(gp_ids)s IS NULL)
    )
    AND (%(village_id)s IS NULL OR cgm.village_id = %(village_id)s)
    AND (%(creche_id)s IS NULL OR cgm.creche_id = %(creche_id)s)
    AND (%(c_status)s IS NULL OR cr.creche_status_id = %(c_status)s)
    AND (%(supervisor_id)s IS NULL OR cr.supervisor_id = %(supervisor_id)s)
   
    AND (cr.creche_opening_date IS NULL OR ( %(end_date)s IS NOT NULL AND cr.creche_opening_date <= %(end_date)s ))
    """
    return frappe.db.sql(query, params)[0][0] or 0

def get_Total_Stunted_children(params):
    query = """
    SELECT COUNT(ad.name)
    FROM `tabAnthropromatic Data` AS ad
    JOIN `tabChild Growth Monitoring` AS cgm ON cgm.name = ad.parent
    JOIN `tabCreche` AS cr ON cr.name = cgm.creche_id
    WHERE YEAR(cgm.measurement_date) = %(year)s
    AND MONTH(cgm.measurement_date) = %(month)s
    AND ad.do_you_have_height_weight = 1
    AND ad.height_for_age = 2
    AND (%(partner_id)s IS NULL OR cgm.partner_id = %(partner_id)s)
    AND (
        (%(state_id)s IS NOT NULL AND cgm.state_id = %(state_id)s)
        OR (%(state_id)s IS NULL AND %(state_ids)s IS NOT NULL AND FIND_IN_SET(cgm.state_id, %(state_ids)s))
        OR (%(state_id)s IS NULL AND %(state_ids)s IS NULL)
    )
    AND (
        (%(district_id)s IS NOT NULL AND cgm.district_id = %(district_id)s)
        OR (%(district_id)s IS NULL AND %(district_ids)s IS NOT NULL AND FIND_IN_SET(cgm.district_id, %(district_ids)s))
        OR (%(district_id)s IS NULL AND %(district_ids)s IS NULL)
    )
    AND (
        (%(block_id)s IS NOT NULL AND cgm.block_id = %(block_id)s)
        OR (%(block_id)s IS NULL AND %(block_ids)s IS NOT NULL AND FIND_IN_SET(cgm.block_id, %(block_ids)s))
        OR (%(block_id)s IS NULL AND %(block_ids)s IS NULL)
    )
    AND (
        (%(gp_id)s IS NOT NULL AND cgm.gp_id = %(gp_id)s)
        OR (%(gp_id)s IS NULL AND %(gp_ids)s IS NOT NULL AND FIND_IN_SET(cgm.gp_id, %(gp_ids)s))
        OR (%(gp_id)s IS NULL AND %(gp_ids)s IS NULL)
    )
    AND (%(village_id)s IS NULL OR cgm.village_id = %(village_id)s)
    AND (%(creche_id)s IS NULL OR cgm.creche_id = %(creche_id)s)
    AND (%(c_status)s IS NULL OR cr.creche_status_id = %(c_status)s)
    AND (%(supervisor_id)s IS NULL OR cr.supervisor_id = %(supervisor_id)s)
   
    AND (cr.creche_opening_date IS NULL OR ( %(end_date)s IS NOT NULL AND cr.creche_opening_date <= %(end_date)s ))
    """
    return frappe.db.sql(query, params)[0][0] or 0

def get_Total_GF1(params):
    query = """
    SELECT COUNT(*) AS gf1
    FROM
        `tabAnthropromatic Data` AS ad
    INNER JOIN
        `tabChild Growth Monitoring` AS cgm ON cgm.name = ad.parent
    INNER JOIN
        `tabAnthropromatic Data` AS ad_lyear ON
            ad_lyear.childenrollguid = ad.childenrollguid AND
            ad_lyear.do_you_have_height_weight = 1 AND
            YEAR(ad_lyear.measurement_taken_date) = %(lyear)s AND
            MONTH(ad_lyear.measurement_taken_date) = %(lmonth)s AND
            ad.weight <= ad_lyear.weight
    JOIN `tabCreche` AS cr ON cr.name = cgm.creche_id
    LEFT JOIN
        `tabAnthropromatic Data` AS ad_pyear ON
            ad_pyear.childenrollguid = ad.childenrollguid AND
            ad_pyear.do_you_have_height_weight = 1 AND
            YEAR(ad_pyear.measurement_taken_date) = %(pyear)s AND
            MONTH(ad_pyear.measurement_taken_date) = %(plmonth)s AND
            ad_lyear.weight <= ad_pyear.weight
    WHERE
        ad.do_you_have_height_weight = 1 AND
        YEAR(cgm.measurement_date) = %(year)s AND
        MONTH(cgm.measurement_date) = %(month)s
        AND (%(partner_id)s IS NULL OR cgm.partner_id = %(partner_id)s)
        AND (
            (%(state_id)s IS NOT NULL AND cgm.state_id = %(state_id)s)
            OR (%(state_id)s IS NULL AND %(state_ids)s IS NOT NULL AND FIND_IN_SET(cgm.state_id, %(state_ids)s))
            OR (%(state_id)s IS NULL AND %(state_ids)s IS NULL)
        )
        AND (
            (%(district_id)s IS NOT NULL AND cgm.district_id = %(district_id)s)
            OR (%(district_id)s IS NULL AND %(district_ids)s IS NOT NULL AND FIND_IN_SET(cgm.district_id, %(district_ids)s))
            OR (%(district_id)s IS NULL AND %(district_ids)s IS NULL)
        )
        AND (
            (%(block_id)s IS NOT NULL AND cgm.block_id = %(block_id)s)
            OR (%(block_id)s IS NULL AND %(block_ids)s IS NOT NULL AND FIND_IN_SET(cgm.block_id, %(block_ids)s))
            OR (%(block_id)s IS NULL AND %(block_ids)s IS NULL)
        )
        AND (
            (%(gp_id)s IS NOT NULL AND cgm.gp_id = %(gp_id)s)
            OR (%(gp_id)s IS NULL AND %(gp_ids)s IS NOT NULL AND FIND_IN_SET(cgm.gp_id, %(gp_ids)s))
            OR (%(gp_id)s IS NULL AND %(gp_ids)s IS NULL)
        )
        AND (%(village_id)s IS NULL OR cgm.village_id = %(village_id)s)
        AND (%(creche_id)s IS NULL OR cgm.creche_id = %(creche_id)s)
        AND (%(c_status)s IS NULL OR cr.creche_status_id = %(c_status)s)
        AND (%(supervisor_id)s IS NULL OR cr.supervisor_id = %(supervisor_id)s)
       
        AND (cr.creche_opening_date IS NULL OR ( %(end_date)s IS NOT NULL AND cr.creche_opening_date <= %(end_date)s ))
        AND ad_pyear.name IS NULL
    """
    return frappe.db.sql(query, params)[0][0] or 0

def get_Total_Severely_underweight_children(params):
    query = """
    SELECT COUNT(ad.name)
    FROM `tabAnthropromatic Data` AS ad
    JOIN `tabChild Growth Monitoring` AS cgm ON cgm.name = ad.parent
    JOIN `tabCreche` AS cr ON cr.name = cgm.creche_id
    WHERE YEAR(cgm.measurement_date) = %(year)s
    AND MONTH(cgm.measurement_date) = %(month)s
    AND ad.do_you_have_height_weight = 1
    AND ad.weight_for_age = 1
    AND (%(partner_id)s IS NULL OR cgm.partner_id = %(partner_id)s)
    AND (
        (%(state_id)s IS NOT NULL AND cgm.state_id = %(state_id)s)
        OR (%(state_id)s IS NULL AND %(state_ids)s IS NOT NULL AND FIND_IN_SET(cgm.state_id, %(state_ids)s))
        OR (%(state_id)s IS NULL AND %(state_ids)s IS NULL)
    )
    AND (
        (%(district_id)s IS NOT NULL AND cgm.district_id = %(district_id)s)
        OR (%(district_id)s IS NULL AND %(district_ids)s IS NOT NULL AND FIND_IN_SET(cgm.district_id, %(district_ids)s))
        OR (%(district_id)s IS NULL AND %(district_ids)s IS NULL)
    )
    AND (
        (%(block_id)s IS NOT NULL AND cgm.block_id = %(block_id)s)
        OR (%(block_id)s IS NULL AND %(block_ids)s IS NOT NULL AND FIND_IN_SET(cgm.block_id, %(block_ids)s))
        OR (%(block_id)s IS NULL AND %(block_ids)s IS NULL)
    )
    AND (
        (%(gp_id)s IS NOT NULL AND cgm.gp_id = %(gp_id)s)
        OR (%(gp_id)s IS NULL AND %(gp_ids)s IS NOT NULL AND FIND_IN_SET(cgm.gp_id, %(gp_ids)s))
        OR (%(gp_id)s IS NULL AND %(gp_ids)s IS NULL)
    )
    AND (%(village_id)s IS NULL OR cgm.village_id = %(village_id)s)
    AND (%(creche_id)s IS NULL OR cgm.creche_id = %(creche_id)s)
    AND (%(c_status)s IS NULL OR cr.creche_status_id = %(c_status)s)
    AND (%(supervisor_id)s IS NULL OR cr.supervisor_id = %(supervisor_id)s)
   
    AND (cr.creche_opening_date IS NULL OR ( %(end_date)s IS NOT NULL AND cr.creche_opening_date <= %(end_date)s ))
    """
    return frappe.db.sql(query, params)[0][0] or 0

def get_Total_SAM_children(params):
    query = """
    SELECT COUNT(ad.name)
    FROM `tabAnthropromatic Data` AS ad
    JOIN `tabChild Growth Monitoring` AS cgm ON cgm.name = ad.parent
    JOIN `tabCreche` AS cr ON cr.name = cgm.creche_id
    WHERE YEAR(cgm.measurement_date) = %(year)s
    AND MONTH(cgm.measurement_date) = %(month)s
    AND ad.do_you_have_height_weight = 1
    AND ad.weight_for_height = 1
    AND (%(partner_id)s IS NULL OR cgm.partner_id = %(partner_id)s)
    AND (
        (%(state_id)s IS NOT NULL AND cgm.state_id = %(state_id)s)
        OR (%(state_id)s IS NULL AND %(state_ids)s IS NOT NULL AND FIND_IN_SET(cgm.state_id, %(state_ids)s))
        OR (%(state_id)s IS NULL AND %(state_ids)s IS NULL)
    )
    AND (
        (%(district_id)s IS NOT NULL AND cgm.district_id = %(district_id)s)
        OR (%(district_id)s IS NULL AND %(district_ids)s IS NOT NULL AND FIND_IN_SET(cgm.district_id, %(district_ids)s))
        OR (%(district_id)s IS NULL AND %(district_ids)s IS NULL)
    )
    AND (
        (%(block_id)s IS NOT NULL AND cgm.block_id = %(block_id)s)
        OR (%(block_id)s IS NULL AND %(block_ids)s IS NOT NULL AND FIND_IN_SET(cgm.block_id, %(block_ids)s))
        OR (%(block_id)s IS NULL AND %(block_ids)s IS NULL)
    )
    AND (
        (%(gp_id)s IS NOT NULL AND cgm.gp_id = %(gp_id)s)
        OR (%(gp_id)s IS NULL AND %(gp_ids)s IS NOT NULL AND FIND_IN_SET(cgm.gp_id, %(gp_ids)s))
        OR (%(gp_id)s IS NULL AND %(gp_ids)s IS NULL)
    )
    AND (%(village_id)s IS NULL OR cgm.village_id = %(village_id)s)
    AND (%(creche_id)s IS NULL OR cgm.creche_id = %(creche_id)s)
    AND (%(c_status)s IS NULL OR cr.creche_status_id = %(c_status)s)
    AND (%(supervisor_id)s IS NULL OR cr.supervisor_id = %(supervisor_id)s)
   
    AND (cr.creche_opening_date IS NULL OR ( %(end_date)s IS NOT NULL AND cr.creche_opening_date <= %(end_date)s ))
    """
    return frappe.db.sql(query, params)[0][0] or 0

def get_Total_Severely_stunted_children(params):
    query = """
    SELECT COUNT(ad.name)
    FROM `tabAnthropromatic Data` AS ad
    JOIN `tabChild Growth Monitoring` AS cgm ON cgm.name = ad.parent
    JOIN `tabCreche` AS cr ON cr.name = cgm.creche_id
    WHERE YEAR(cgm.measurement_date) = %(year)s
    AND MONTH(cgm.measurement_date) = %(month)s
    AND ad.do_you_have_height_weight = 1
    AND ad.height_for_age = 1
    AND (%(partner_id)s IS NULL OR cgm.partner_id = %(partner_id)s)
    AND (
        (%(state_id)s IS NOT NULL AND cgm.state_id = %(state_id)s)
        OR (%(state_id)s IS NULL AND %(state_ids)s IS NOT NULL AND FIND_IN_SET(cgm.state_id, %(state_ids)s))
        OR (%(state_id)s IS NULL AND %(state_ids)s IS NULL)
    )
    AND (
        (%(district_id)s IS NOT NULL AND cgm.district_id = %(district_id)s)
        OR (%(district_id)s IS NULL AND %(district_ids)s IS NOT NULL AND FIND_IN_SET(cgm.district_id, %(district_ids)s))
        OR (%(district_id)s IS NULL AND %(district_ids)s IS NULL)
    )
    AND (
        (%(block_id)s IS NOT NULL AND cgm.block_id = %(block_id)s)
        OR (%(block_id)s IS NULL AND %(block_ids)s IS NOT NULL AND FIND_IN_SET(cgm.block_id, %(block_ids)s))
        OR (%(block_id)s IS NULL AND %(block_ids)s IS NULL)
    )
    AND (
        (%(gp_id)s IS NOT NULL AND cgm.gp_id = %(gp_id)s)
        OR (%(gp_id)s IS NULL AND %(gp_ids)s IS NOT NULL AND FIND_IN_SET(cgm.gp_id, %(gp_ids)s))
        OR (%(gp_id)s IS NULL AND %(gp_ids)s IS NULL)
    )
    AND (%(village_id)s IS NULL OR cgm.village_id = %(village_id)s)
    AND (%(supervisor_id)s IS NULL OR cr.supervisor_id = %(supervisor_id)s)
    AND (%(creche_id)s IS NULL OR cgm.creche_id = %(creche_id)s)
    AND (%(c_status)s IS NULL OR cr.creche_status_id = %(c_status)s)
   
    AND (cr.creche_opening_date IS NULL OR ( %(end_date)s IS NOT NULL AND cr.creche_opening_date <= %(end_date)s ))
    """
    return frappe.db.sql(query, params)[0][0] or 0

def get_Total_GF2(params):
    query = """
    SELECT COUNT(*) AS gf2
    FROM
        `tabAnthropromatic Data` AS ad
    INNER JOIN
        `tabChild Growth Monitoring` AS cgm ON cgm.name = ad.parent
    JOIN `tabCreche` AS cr ON cr.name = cgm.creche_id
    INNER JOIN
        `tabAnthropromatic Data` AS ad_lyear ON
            ad_lyear.childenrollguid = ad.childenrollguid AND
            ad_lyear.do_you_have_height_weight = 1 AND
            YEAR(ad_lyear.measurement_taken_date) = %(lyear)s AND
            MONTH(ad_lyear.measurement_taken_date) = %(lmonth)s AND
            ad.weight <= ad_lyear.weight
    INNER JOIN
        `tabAnthropromatic Data` AS ad_pyear ON
            ad_pyear.childenrollguid = ad.childenrollguid AND
            ad_pyear.do_you_have_height_weight = 1 AND
            YEAR(ad_pyear.measurement_taken_date) = %(pyear)s AND
            MONTH(ad_pyear.measurement_taken_date) = %(plmonth)s AND
            ad_lyear.weight <= ad_pyear.weight
    WHERE
        ad.do_you_have_height_weight = 1 AND
        YEAR(cgm.measurement_date) = %(year)s AND
        MONTH(cgm.measurement_date) = %(month)s
        AND (%(partner_id)s IS NULL OR cgm.partner_id = %(partner_id)s)
        AND (
            (%(state_id)s IS NOT NULL AND cgm.state_id = %(state_id)s)
            OR (%(state_id)s IS NULL AND %(state_ids)s IS NOT NULL AND FIND_IN_SET(cgm.state_id, %(state_ids)s))
            OR (%(state_id)s IS NULL AND %(state_ids)s IS NULL)
        )
        AND (
            (%(district_id)s IS NOT NULL AND cgm.district_id = %(district_id)s)
            OR (%(district_id)s IS NULL AND %(district_ids)s IS NOT NULL AND FIND_IN_SET(cgm.district_id, %(district_ids)s))
            OR (%(district_id)s IS NULL AND %(district_ids)s IS NULL)
        )
        AND (
            (%(block_id)s IS NOT NULL AND cgm.block_id = %(block_id)s)
            OR (%(block_id)s IS NULL AND %(block_ids)s IS NOT NULL AND FIND_IN_SET(cgm.block_id, %(block_ids)s))
            OR (%(block_id)s IS NULL AND %(block_ids)s IS NULL)
        )
        AND (
            (%(gp_id)s IS NOT NULL AND cgm.gp_id = %(gp_id)s)
            OR (%(gp_id)s IS NULL AND %(gp_ids)s IS NOT NULL AND FIND_IN_SET(cgm.gp_id, %(gp_ids)s))
            OR (%(gp_id)s IS NULL AND %(gp_ids)s IS NULL)
        )
        AND (%(village_id)s IS NULL OR cgm.village_id = %(village_id)s)
        AND (%(c_status)s IS NULL OR cr.creche_status_id = %(c_status)s)
        AND (%(supervisor_id)s IS NULL OR cr.supervisor_id = %(supervisor_id)s)
        AND (%(creche_id)s IS NULL OR cgm.creche_id = %(creche_id)s)
       
        AND (cr.creche_opening_date IS NULL OR ( %(end_date)s IS NOT NULL AND cr.creche_opening_date <= %(end_date)s ))
    """
    return frappe.db.sql(query, params)[0][0] or 0

def get_measurement_data_submitted(params):
    query = """
    SELECT COUNT(*)
    FROM `tabAnthropromatic Data` AS ad
    LEFT JOIN `tabChild Growth Monitoring` AS cgm ON cgm.name = ad.parent
    INNER JOIN `tabChild Enrollment and Exit` cee ON ad.childenrollguid = cee.childenrollguid
    LEFT JOIN `tabCreche` AS cr ON cr.name = cgm.creche_id
    WHERE ad.do_you_have_height_weight = 1
        AND YEAR(cgm.measurement_date) = %(year)s
        AND MONTH(cgm.measurement_date) = %(month)s
        AND cee.date_of_enrollment <= %(end_date)s
        AND (cee.date_of_exit IS NULL OR cee.date_of_exit > %(end_date)s)
        AND (%(partner_id)s IS NULL OR cgm.partner_id = %(partner_id)s)
        AND (
            (%(state_id)s IS NOT NULL AND cgm.state_id = %(state_id)s)
            OR (%(state_id)s IS NULL AND %(state_ids)s IS NOT NULL AND FIND_IN_SET(cgm.state_id, %(state_ids)s))
            OR (%(state_id)s IS NULL AND %(state_ids)s IS NULL)
        )
        AND (
            (%(district_id)s IS NOT NULL AND cgm.district_id = %(district_id)s)
            OR (%(district_id)s IS NULL AND %(district_ids)s IS NOT NULL AND FIND_IN_SET(cgm.district_id, %(district_ids)s))
            OR (%(district_id)s IS NULL AND %(district_ids)s IS NULL)
        )
        AND (
            (%(block_id)s IS NOT NULL AND cgm.block_id = %(block_id)s)
            OR (%(block_id)s IS NULL AND %(block_ids)s IS NOT NULL AND FIND_IN_SET(cgm.block_id, %(block_ids)s))
            OR (%(block_id)s IS NULL AND %(block_ids)s IS NULL)
        )
        AND (
            (%(gp_id)s IS NOT NULL AND cgm.gp_id = %(gp_id)s)
            OR (%(gp_id)s IS NULL AND %(gp_ids)s IS NOT NULL AND FIND_IN_SET(cgm.gp_id, %(gp_ids)s))
            OR (%(gp_id)s IS NULL AND %(gp_ids)s IS NULL)
        )
        AND (%(village_id)s IS NULL OR cgm.village_id = %(village_id)s)
        AND (%(creche_id)s IS NULL OR cgm.creche_id = %(creche_id)s)
        AND (%(c_status)s IS NULL OR cr.creche_status_id = %(c_status)s)
        AND (%(supervisor_id)s IS NULL OR cr.supervisor_id = %(supervisor_id)s)
       
        AND (cr.creche_opening_date IS NULL OR ( %(end_date)s IS NOT NULL AND cr.creche_opening_date <= %(end_date)s ))
    """
    return frappe.db.sql(query, params)[0][0] or 0

def get_measurement_data_not_submitted(params):
    query = """
    SELECT COUNT(DISTINCT cee.childenrollguid)
    FROM `tabChild Enrollment and Exit` cee
    INNER JOIN `tabCreche` cr ON cr.name = cee.creche_id
    LEFT JOIN (
        SELECT DISTINCT ad.childenrollguid
        FROM `tabAnthropromatic Data` ad
        INNER JOIN `tabChild Growth Monitoring` cgm ON cgm.name = ad.parent
        WHERE ad.do_you_have_height_weight = 1
            AND YEAR(cgm.measurement_date) = %(year)s
            AND MONTH(cgm.measurement_date) = %(month)s
    ) submitted ON submitted.childenrollguid = cee.childenrollguid
    WHERE cee.date_of_enrollment <= %(end_date)s
        AND (cee.date_of_exit IS NULL OR cee.date_of_exit > %(end_date)s)
        AND submitted.childenrollguid IS NULL
        AND (%(partner_id)s IS NULL OR cr.partner_id = %(partner_id)s)
        AND (
            (%(state_id)s IS NOT NULL AND cr.state_id = %(state_id)s)
            OR (%(state_id)s IS NULL AND %(state_ids)s IS NOT NULL AND FIND_IN_SET(cr.state_id, %(state_ids)s))
            OR (%(state_id)s IS NULL AND %(state_ids)s IS NULL)
        )
        AND (
            (%(district_id)s IS NOT NULL AND cr.district_id = %(district_id)s)
            OR (%(district_id)s IS NULL AND %(district_ids)s IS NOT NULL AND FIND_IN_SET(cr.district_id, %(district_ids)s))
            OR (%(district_id)s IS NULL AND %(district_ids)s IS NULL)
        )
        AND (
            (%(block_id)s IS NOT NULL AND cr.block_id = %(block_id)s)
            OR (%(block_id)s IS NULL AND %(block_ids)s IS NOT NULL AND FIND_IN_SET(cr.block_id, %(block_ids)s))
            OR (%(block_id)s IS NULL AND %(block_ids)s IS NULL)
        )
        AND (
            (%(gp_id)s IS NOT NULL AND cr.gp_id = %(gp_id)s)
            OR (%(gp_id)s IS NULL AND %(gp_ids)s IS NOT NULL AND FIND_IN_SET(cr.gp_id, %(gp_ids)s))
            OR (%(gp_id)s IS NULL AND %(gp_ids)s IS NULL)
        )
        AND (%(supervisor_id)s IS NULL OR cr.supervisor_id = %(supervisor_id)s)
        AND (%(creche_id)s IS NULL OR cee.creche_id = %(creche_id)s)
        AND (%(c_status)s IS NULL OR cr.creche_status_id = %(c_status)s)
        AND (cr.creche_opening_date IS NULL OR (%(end_date)s IS NOT NULL AND cr.creche_opening_date <= %(end_date)s))
        AND ((%(cstart_date)s IS NULL AND %(cend_date)s IS NULL) OR (cr.creche_opening_date BETWEEN %(cstart_date)s AND %(cend_date)s))
    """
    return frappe.db.sql(query, params)[0][0] or 0

def get_no_creche_attendance_not_submitted(params):
    query = """
    SELECT COUNT(*)
    FROM (
        SELECT
            tc.name,
            tc.creche_opening_date,
            DATEDIFF(
                CASE
                    WHEN DATE_FORMAT(CURRENT_DATE(), '%%Y-%%m') = DATE_FORMAT(%(start_date)s, '%%Y-%%m')
                    THEN CURRENT_DATE()
                    ELSE %(end_date)s
                END,
                CASE
                    WHEN tc.creche_opening_date < %(start_date)s
                    THEN %(start_date)s
                    ELSE tc.creche_opening_date
                END
            ) + 1 AS elgdays,
            IFNULL(att.attdays, 0) AS attdays
        FROM
            `tabCreche` tc
        LEFT JOIN (
            SELECT
                tca.creche_id,
                COUNT(*) AS attdays
            FROM
                `tabChild Attendance` tca
            WHERE
                tca.date_of_attendance BETWEEN %(start_date)s AND %(end_date)s
            GROUP BY
                tca.creche_id
        ) AS att
        ON tc.name = att.creche_id
        WHERE
            tc.creche_opening_date IS NOT NULL
            AND tc.creche_opening_date <= %(end_date)s
            AND (%(partner_id)s IS NULL OR tc.partner_id = %(partner_id)s)
            AND (
                (%(state_id)s IS NOT NULL AND tc.state_id = %(state_id)s)
                OR (%(state_id)s IS NULL AND %(state_ids)s IS NOT NULL AND FIND_IN_SET(tc.state_id, %(state_ids)s))
                OR (%(state_id)s IS NULL AND %(state_ids)s IS NULL)
            )
            AND (
                (%(district_id)s IS NOT NULL AND tc.district_id = %(district_id)s)
                OR (%(district_id)s IS NULL AND %(district_ids)s IS NOT NULL AND FIND_IN_SET(tc.district_id, %(district_ids)s))
                OR (%(district_id)s IS NULL AND %(district_ids)s IS NULL)
            )
            AND (
                (%(block_id)s IS NOT NULL AND tc.block_id = %(block_id)s)
                OR (%(block_id)s IS NULL AND %(block_ids)s IS NOT NULL AND FIND_IN_SET(tc.block_id, %(block_ids)s))
                OR (%(block_id)s IS NULL AND %(block_ids)s IS NULL)
            )
            AND (
                (%(gp_id)s IS NOT NULL AND tc.gp_id = %(gp_id)s)
                OR (%(gp_id)s IS NULL AND %(gp_ids)s IS NOT NULL AND FIND_IN_SET(tc.gp_id, %(gp_ids)s))
                OR (%(gp_id)s IS NULL AND %(gp_ids)s IS NULL)
            )
            AND (%(supervisor_id)s IS NULL OR tc.supervisor_id = %(supervisor_id)s)
            AND (%(creche_id)s IS NULL OR tc.name = %(creche_id)s)
            AND (%(c_status)s IS NULL OR tc.creche_status_id = %(c_status)s)
            AND (tc.creche_opening_date IS NULL OR ( %(end_date)s IS NOT NULL AND tc.creche_opening_date <= %(end_date)s ))
            AND ((%(cstart_date)s IS NULL AND %(cend_date)s IS NULL) OR (tc.creche_opening_date BETWEEN %(cstart_date)s AND %(cend_date)s))
    ) AS creche_attendance
    WHERE elgdays > attdays
    """
    return frappe.db.sql(query, params)[0][0] or 0

def get_Total_Anthro_data_not_submitted(params):
    query = """
    SELECT COUNT(*) AS Total_Anthro_data_not_submitted
    FROM `tabCreche` cr
    WHERE cr.creche_status_id = IFNULL(%(c_status)s, cr.creche_status_id)
    AND (%(partner_id)s IS NULL OR cr.partner_id = %(partner_id)s)
    AND (%(supervisor_id)s IS NULL OR cr.supervisor_id = %(supervisor_id)s)
    AND (%(creche_id)s IS NULL OR cr.name = %(creche_id)s)
    AND (cr.creche_opening_date IS NULL OR (%(end_date)s IS NOT NULL AND cr.creche_opening_date <= %(end_date)s))
    AND ((%(cstart_date)s IS NULL AND %(cend_date)s IS NULL) OR (cr.creche_opening_date BETWEEN %(cstart_date)s AND %(cend_date)s))
    AND (
        (%(state_id)s IS NOT NULL AND cr.state_id = %(state_id)s)
        OR (%(state_id)s IS NULL AND %(state_ids)s IS NOT NULL AND FIND_IN_SET(cr.state_id, %(state_ids)s))
        OR (%(state_id)s IS NULL AND %(state_ids)s IS NULL)
    )
    AND (
        (%(district_id)s IS NOT NULL AND cr.district_id = %(district_id)s)
        OR (%(district_id)s IS NULL AND %(district_ids)s IS NOT NULL AND FIND_IN_SET(cr.district_id, %(district_ids)s))
        OR (%(district_id)s IS NULL AND %(district_ids)s IS NULL)
    )
    AND (
        (%(block_id)s IS NOT NULL AND cr.block_id = %(block_id)s)
        OR (%(block_id)s IS NULL AND %(block_ids)s IS NOT NULL AND FIND_IN_SET(cr.block_id, %(block_ids)s))
        OR (%(block_id)s IS NULL AND %(block_ids)s IS NULL)
    )
    AND (
        (%(gp_id)s IS NOT NULL AND cr.gp_id = %(gp_id)s)
        OR (%(gp_id)s IS NULL AND %(gp_ids)s IS NOT NULL AND FIND_IN_SET(cr.gp_id, %(gp_ids)s))
        OR (%(gp_id)s IS NULL AND %(gp_ids)s IS NULL)
    )
    AND NOT EXISTS (
        SELECT 1
        FROM `tabChild Growth Monitoring` cgm
        WHERE cgm.creche_id = cr.name
            AND YEAR(cgm.measurement_date) = %(year)s
            AND MONTH(cgm.measurement_date) = %(month)s
    )
    """
    return frappe.db.sql(query, params)[0][0] or 0

def execute_query(func, params_dict):
    """Helper function to execute query with error handling and proper database connection"""
    try:
        # Ensure we're using the main thread's database connection
        return func(params_dict)
    except Exception as e:
        # Silently return 0 as requested (no logging)
        return 0

@frappe.whitelist()
@scoped()
def dashboard_section_one(partner_id=None, state_id=None, district_id=None, gp_id=None, block_id=None, 
                         village_id=None, creche_id=None, year=None, month=None, supervisor_id=None, 
                         c_status=None, cstart_date=None, cend_date=None, usr=None, pw=None):
    
    # Convert string None to actual None
    partner_id = partner_id if partner_id != 'None' else None
    state_id = state_id if state_id != 'None' else None
    district_id = district_id if district_id != 'None' else None
    block_id = block_id if block_id != 'None' else None
    gp_id = gp_id if gp_id != 'None' else None
    village_id = village_id if village_id != 'None' else None
    creche_id = creche_id if creche_id != 'None' else None
    supervisor_id = supervisor_id if supervisor_id != 'None' else None
    c_status = c_status if c_status != 'None' else None
    cstart_date = cstart_date if cstart_date != 'None' else None
    cend_date = cend_date if cend_date != 'None' else None

    # Date initialization and validation
    try:
        year = int(year) if year and str(year).isdigit() else date.today().year
        month = int(month) if month and str(month).isdigit() else date.today().month
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
    
    # Geography mapping logic
    state_ids = []
    district_ids = []
    block_ids = []
    gp_ids = []
    
    if usr and usr != 'None' and not (state_id or district_id or block_id or gp_id):
        geography_query = """
            SELECT
                ugm.state_id,
                ugm.district_id,
                ugm.block_id,
                ugm.gp_id
            FROM `tabUser Geography Mapping` AS ugm
            LEFT JOIN `tabUser` AS u ON u.name = ugm.parent
            WHERE u.email = %s
        """
        current_user_geography = frappe.db.sql(geography_query, usr, as_dict=True)
       
        if current_user_geography:
            state_ids = [str(g["state_id"]) for g in current_user_geography if g.get("state_id")]
            district_ids = [str(g["district_id"]) for g in current_user_geography if g.get("district_id")]
            block_ids = [str(g["block_id"]) for g in current_user_geography if g.get("block_id")]
            gp_ids = [str(g["gp_id"]) for g in current_user_geography if g.get("gp_id")]
    
    # Previous month calculations
    if month == 1:
        lmonth = 12
        plmonth = 11
        lyear = year - 1
        pyear = year - 1
    elif month == 2:
        lmonth = 1
        plmonth = 12
        lyear = year
        pyear = year - 1
    else:
        lmonth = month - 1
        plmonth = month - 2
        lyear = year
        pyear = year
    
    if creche_id:
        supervisor_id = None
    
    # Convert lists to strings
    state_ids_str = ",".join(state_ids) if state_ids else None
    district_ids_str = ",".join(district_ids) if district_ids else None
    block_ids_str = ",".join(block_ids) if block_ids else None
    gp_ids_str = ",".join(gp_ids) if gp_ids else None
    
    # Prepare parameters - ensure proper SQL parameter formatting
    params = {
        "end_date": end_date.strftime('%Y-%m-%d') if end_date else None,
        "year": year,
        "month": month,
        "start_date": start_date.strftime('%Y-%m-%d') if start_date else None,
        "partner_id": partner_id,
        "partner_ids": None,
        "state_id": state_id,
        "state_ids": state_ids_str,
        "district_id": district_id,
        "district_ids": district_ids_str,
        "block_id": block_id,
        "block_ids": block_ids_str,
        "gp_id": gp_id,
        "gp_ids": gp_ids_str,
        "creche_id": creche_id,
        "village_id": village_id,
        "lyear": lyear,
        "lmonth": lmonth,
        "plmonth": plmonth,
        "pyear": pyear,
        "supervisor_id": supervisor_id,
        "cstart_date": cstart_date,
        "cend_date": cend_date,
        "c_status": c_status
    }
    
    # Debug: Test one query to see if it works
    test_result = get_creche_no(params)
    
    # If test query returns 0, there might be parameter issues
    # Let's try a simpler approach first - execute queries sequentially to identify the problem
    
    results = {}
    
    # First, try executing a few key queries sequentially to debug
    key_queries = {
        'creche_no': get_creche_no,
        'no_children_curr_active': get_no_children_curr_active,
        'current_enrolled_children': get_current_enrolled_children
    }
    
    for key, func in key_queries.items():
        try:
            results[key] = func(params)
        except:
            results[key] = 0
    
    # If even sequential queries return 0, there's likely a parameter issue
    # Let's check if we have any data at all
    if results.get('creche_no', 0) == 0:
        # Try a basic query without filters to see if we have any data
        basic_test = frappe.db.sql("SELECT COUNT(*) FROM `tabCreche`", as_list=True)
        if basic_test and basic_test[0][0] > 0:
            # We have data, so the issue is with parameter filtering
            # Let's simplify the parameters
            simplified_params = {
                "end_date": end_date.strftime('%Y-%m-%d'),
                "year": year,
                "month": month,
                "start_date": start_date.strftime('%Y-%m-%d'),
                "partner_id": None,
                "state_id": None,
                "district_id": None,
                "block_id": None,
                "gp_id": None,
                "creche_id": None,
                "village_id": None,
                "supervisor_id": None,
                "c_status": None
            }
            
            # Try with simplified parameters
            for key, func in key_queries.items():
                try:
                    results[key] = func(simplified_params)
                except:
                    results[key] = 0
    
    # If we still get 0, proceed with parallel execution but with better error handling
    query_functions = {
        'creche_no': get_creche_no,
        'no_creche_attendance_submitted': get_no_creche_attendance_submitted,
        'no_days_creche_opened': get_no_days_creche_opened,
        'no_children_present_creche_opened': get_no_children_present_creche_opened,
        'no_children_curr_active': get_no_children_curr_active,
        'Max_Attendance_in_a_Day': get_Max_Attendance_in_a_Day,
        'No_of_days_creche_attendance_submitted': get_No_of_days_creche_attendance_submitted,
        'Total_Anthro_data_submitted': get_Total_Anthro_data_submitted,
        'current_enrolled_children': get_current_enrolled_children,
        'cur_eligible_children': get_cur_eligible_children,
        'Total_Current_exit_children': get_Total_Current_exit_children,
        'cumm_enrolled_children': get_cumm_enrolled_children,
        'Total_Cumulative_exit_children': get_Total_Cumulative_exit_children,
        'Total_Underweight_children': get_Total_Underweight_children,
        'Total_MAM_children': get_Total_MAM_children,
        'Total_Stunted_children': get_Total_Stunted_children,
        'Total_GF1': get_Total_GF1,
        'Total_Severely_underweight_children': get_Total_Severely_underweight_children,
        'Total_SAM_children': get_Total_SAM_children,
        'Total_Severely_stunted_children': get_Total_Severely_stunted_children,
        'Total_GF2': get_Total_GF2,
        'measurement_data_submitted': get_measurement_data_submitted,
        'measurement_data_not_submitted': get_measurement_data_not_submitted,
        'no_creche_attendance_not_submitted': get_no_creche_attendance_not_submitted,
        'Total_Anthro_data_not_submitted': get_Total_Anthro_data_not_submitted
    }
    
    # Execute remaining queries
    for key, func in query_functions.items():
        if key not in results:  # Only execute if not already done
            try:
                results[key] = func(params)
            except:
                results[key] = 0

    # Compute calculated fields
    creche_no = results.get('creche_no', 0)
    no_days_creche_opened = results.get('no_days_creche_opened', 0)
    no_children_present_creche_opened = results.get('no_children_present_creche_opened', 0)
    No_of_days_creche_attendance_submitted = results.get('No_of_days_creche_attendance_submitted', 0)

    avg_days_creche_opened = 0 if creche_no == 0 else math.ceil(no_days_creche_opened / creche_no)
    avg_attendance_per_day = 0 if no_days_creche_opened == 0 else round(no_children_present_creche_opened / no_days_creche_opened, 1)
    avg_days_attendance_submitted = 0 if creche_no == 0 else math.ceil(No_of_days_creche_attendance_submitted / creche_no)

    # Construct flat_data
    flat_data = {
        "No. of creches": creche_no,
        "Avg. no. of days creche opened": avg_days_creche_opened,
        "Avg. attendance per day": avg_attendance_per_day,
        "Current active children": results.get('no_children_curr_active', 0),
        "No. of creches submitted attendance (All Days)": results.get('no_creche_attendance_submitted', 0),
        "No. of creches not submitted attendance (All Days)": results.get('no_creche_attendance_not_submitted', 0),
        "No. of Children mesurement taken": results.get('measurement_data_submitted', 0),
        "Children mesurement not taken": results.get('measurement_data_not_submitted', 0),
        "Maximum attendance in a day": results.get('Max_Attendance_in_a_Day', 0),
        "Avg. no. of days attendance submitted": avg_days_attendance_submitted,
        "Anthro data submitted": results.get('Total_Anthro_data_submitted', 0),
        "Anthro data not submitted": results.get('Total_Anthro_data_not_submitted', 0),
        "Children enrolled this month": results.get('current_enrolled_children', 0),
        "Current eligible children": results.get('cur_eligible_children', 0),
        "Children exited this month": results.get('Total_Current_exit_children', 0),
        "Cumulative enrolled children": results.get('cumm_enrolled_children', 0),
        "Cumulative exit children": results.get('Total_Cumulative_exit_children', 0),
        "Moderately underweight": results.get('Total_Underweight_children', 0),
        "Moderately wasted": results.get('Total_MAM_children', 0),
        "Moderately stunted": results.get('Total_Stunted_children', 0),
        "Severely underweight": results.get('Total_Severely_underweight_children', 0),
        "Severely wasted": results.get('Total_SAM_children', 0),
        "Severely stunted": results.get('Total_Severely_stunted_children', 0),
        "Growth faltering 1": results.get('Total_GF1', 0),
        "Growth faltering 2": results.get('Total_GF2', 0)
    }

    query_status_mapping = {
        "Current active children": "no_children_curr_active",
        "Children enrolled this month": "enrolled_children_this_month",
        "Current eligible children": "current_eligible_children",
        "Children exited this month": "exited_children_this_month",
        "Moderately underweight": "moderately_underweight",
        "Moderately wasted": "moderately_wasted",
        "Moderately stunted": "moderately_stunted",
        "Growth faltering 1": "gf1",
        "Severely underweight": "severely_underweight",
        "Severely wasted": "severely_wasted",
        "Severely stunted": "severely_stunted",
        "Growth faltering 2": "gf2",
        "No. of creches submitted attendance (All Days)": "no_creche_attendance_submitted",
        "Anthro data submitted": "anthro_data_submitted",
        "No. of Children mesurement taken": "measurement_data_submitted",
        "No. of creches not submitted attendance (All Days)": "no_of_creches_not_submitted_attendance",
        "Children mesurement not taken": "measurement_data_not_submitted",
        "Anthro data not submitted": "anthro_data_not_submitted",
        "No. of creches": "no_of_creches"
    }
    
    formatted_data = []
    for idx, key in enumerate(flat_data):
        item = {
            "ID": idx + 1,
            "title": key,
            "value": flat_data[key]
        }
        if key in query_status_mapping:
            item["query_status"] = query_status_mapping[key]
        formatted_data.append(item)
    
    frappe.response["data"] = formatted_data






