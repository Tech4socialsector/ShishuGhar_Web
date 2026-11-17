from __future__ import unicode_literals
import frappe
from frappe.utils import nowdate
from frappe.model.document import Document
import math
from datetime import datetime, timedelta, date
from dateutil.relativedelta import relativedelta
from collections import defaultdict

def calculate_z_score(value, M, L, S):
    if L == 0:
        raise ValueError("L should not be zero to avoid division errors.")
    ratio = float(value / M)
    ratio_to_L = float(math.pow(ratio, L))
    numerator = float(ratio_to_L - 1)
    denominator = float(S * L)
    z_score = float(numerator / denominator)
    if z_score <= -3:
        sd3neg = float(M * math.pow(1 + L * S * (-3), 1 / L))
        sd2neg = float(M * math.pow(1 + L * S * (-2), 1 / L))
        sd23neg = float(sd2neg - sd3neg)
        z_score = float(-3 + (value - sd3neg) / sd23neg)
    elif z_score >= 3:
        sd3pos = float(M * math.pow(1 + L * S * (3), 1 / L))
        sd2pos = float(M * math.pow(1 + L * S * (2), 1 / L))
        sd23pos = float(sd3pos - sd2pos)
        z_score = float(3 + (value - sd3pos) / sd23pos)
    return round(z_score, 2)

@frappe.whitelist()
def trigger_growth_status_update():
    # starts a job that can run for six hours: administrators only, not every logged-in user
    frappe.only_for("System Manager")
    frappe.enqueue(
        "frappe.val.z_score_status.update_growth_status_for_all_children",
        queue='long',
        timeout=21600
    )
    return "Update task has been enqueued"

def update_growth_status_for_all_children():
    # Specific child IDs to update
    child_ids = [
        6448, 5811, 37109, 6443, 6501, 7324, 7035, 5786, 6213, 7482,
        7187, 7487, 36160, 6447, 6057, 6456, 6092, 7486, 7104, 6989,
        6382, 7491, 14601, 6021, 13041, 6302, 12359, 6086, 19185, 17468,
        6012, 7614, 7478, 6087, 13295, 7076, 7096, 14206, 6988, 6420,
        7485, 6515, 6491, 7343, 7488, 6468, 7946, 6041, 17182, 6081,
        6363, 6511, 6357, 7320, 18663, 7036, 7603, 6040, 6099, 6011,
        18202, 5783, 7490, 6049, 17470, 17780, 18411, 26991, 21198,
        6360, 7520, 6368, 6507, 7616, 6454, 6059, 7108, 13333, 7214,
        6038, 13311, 6388, 5996, 6190, 6031, 6018, 18981, 6482, 6450,
        6444, 6484, 7615, 35223, 7141, 11362, 6499, 6384, 6426, 17795,
        7617, 6389, 17504, 7032, 6000, 6033, 7829, 6030, 6284, 7483,
        18469, 20337, 6492, 13284, 6032, 7123, 6490, 7493, 6496, 44071,
        15517, 7475, 6985, 16206, 5958, 44265, 7172, 6376, 7325, 6106,
        6037, 7477, 7479, 7489, 6103, 13312, 6146, 6198, 14173, 21560,
        6102, 6046, 19094, 6076, 18344, 6423, 16701, 18194, 15516, 18199,
        6097, 20359, 6095, 14159, 7094, 7492, 11528, 16966, 33037, 18879,
        33033, 20246, 22204, 21550, 21196, 42771, 16959, 41001, 33221,
        21137, 25593, 37812, 47339, 45399, 25983, 35224, 29371, 35496,
        26950, 27598, 16972, 37358, 22341, 21101, 34900, 33679, 32000,
        24242, 18569
    ]
    
    # Get all CGM records that have anthropromatic data with missing z-scores for specific child IDs
    cgm_list = frappe.db.sql("""
        SELECT DISTINCT parent
        FROM `tabAnthropromatic Data`
        WHERE child_id IN %(child_ids)s
        AND do_you_have_height_weight = 1
        AND weight IS NOT NULL AND weight != '' AND weight != 0
        AND height IS NOT NULL AND height != '' AND height != 0
        AND (
            weight_for_age IN (0,4)
            OR height_for_age IN (0,4)
            OR weight_for_height IN (0,4)
        )
    """, {"child_ids": tuple(child_ids)}, as_dict=True)
    
    for cgm in cgm_list:
        update_growth_status_for_child(cgm.parent)

def update_growth_status_for_child(cgm_name):
    cgm = frappe.get_doc("Child Growth Monitoring", cgm_name)
    weight_for_age_boys_data = get_weight_for_age_boys_table()
    weight_for_age_girls_data = get_weight_for_age_girls_table()
    weight_to_height_boys_data = get_weight_to_height_boys()
    weight_to_height_girls_data = get_weight_to_height_girls()
    height_for_age_boys_data = get_height_for_age_boys()
    height_for_age_girls_data = get_height_for_age_girls()
    
    if cgm.get("anthropromatic_details"):
        for row in cgm.get("anthropromatic_details"):
            # Skip if required fields are missing
            if (not row.childenrollguid or not row.age_months):
                continue
                
            # Check if z-scores are missing but height and weight are valid
            if (row.weight is not None and row.weight != '' and row.weight != 0 and
                row.height is not None and row.height != '' and row.height != 0 and
                (row.weight_for_age_zscore is None or row.weight_for_age_zscore == '' or
                 row.weight_for_height_zscore is None or row.weight_for_height_zscore == '' or
                 row.height_for_age_zscore is None or row.height_for_age_zscore == '')):
                
                try:
                    age_months = row.age_months
                    guid = row.childenrollguid.strip() if row.childenrollguid else None
                    if not guid:
                        continue
                        
                    gender_id = frappe.db.get_value("Child Enrollment and Exit", {"childenrollguid": guid}, "gender_id")
                    weight = row.weight
                    height = row.height
                    measurement_equipment = row.measurement_equipment

                    weight_for_age_status = None
                    weight_for_height_status = None
                    height_for_age_status = None
                    weight_for_age_zscore = None
                    weight_for_height_zscore = None
                    height_for_age_zscore = None

                    # Calculating dob_when_measurement_taken
                    if row.measurement_taken_date and age_months:
                        try:
                            measurement_date = row.measurement_taken_date
                            age_days = age_months  
                            dob_date = measurement_date - timedelta(days=age_days)
                            row.dob_when_measurement_taken = dob_date
                        except Exception as e:
                            frappe.log_error(f"Error calculating DOB: {str(e)}")
                            row.dob_when_measurement_taken = None
                    else:
                        row.dob_when_measurement_taken = None

                    # weight for age
                    if age_months is not None and weight is not None and weight > 0 and gender_id in ('1', '2'):
                        try:
                            age_in_days = int(age_months)
                            weight = float(weight)
                            growth_data = weight_for_age_boys_data.get(age_in_days) if gender_id == '1' else weight_for_age_girls_data.get(age_in_days)
                            if growth_data:
                                try:
                                    L = float(growth_data.get("l", 0))
                                    M = float(growth_data.get("m", 0))
                                    S = float(growth_data.get("s", 0))
                                    
                                    # Calculate z-score
                                    weight_for_age_zscore = calculate_z_score(weight, M, L, S)
                                    
                                    sd3neg = float(growth_data.get("sd3neg", 0))
                                    sd2neg = float(growth_data.get("sd2neg", 0))
                                    sd2 = float(growth_data.get("sd2", 0))
                                    
                                    if weight < sd3neg:
                                        weight_for_age_status = 1
                                    elif weight >= sd3neg and weight < sd2neg:
                                        weight_for_age_status = 2
                                    elif weight >= sd2neg and weight <= sd2:
                                        weight_for_age_status = 3
                                    elif weight > sd2:
                                        weight_for_age_status = 4
                                except (ValueError, TypeError) as e:
                                    frappe.log_error(f"Error in weight for age calculation: {str(e)}")
                        except (ValueError, TypeError) as e:
                            frappe.log_error(f"Error processing weight for age: {str(e)}")

                    # weight for height
                    if height is not None and weight is not None and weight > 0 and height > 0 and gender_id in ('1', '2'):
                        try:
                            height_rounded = round(height,1)
                            weight = float(weight)
                            age_in_days = int(age_months)
                            
                            age_type_0_boys = {
                                height: next(
                                    (record for record in records if str(record.get('age_type')).strip() in ['0', '0.0']),
                                    None
                                )
                                for height, records in weight_to_height_boys_data.items()
                            }

                            age_type_24_boys = {
                                height: next(
                                    (record for record in records if str(record.get('age_type')).strip() in ['24', '24.0']),
                                    None
                                )
                                for height, records in weight_to_height_boys_data.items()
                            }

                            age_type_0_girls = {
                                height: next(
                                    (record for record in records if str(record.get('age_type')).strip() in ['0', '0.0']),
                                    None
                                )
                                for height, records in weight_to_height_girls_data.items()
                            }

                            age_type_24_girls = {
                                height: next(
                                    (record for record in records if str(record.get('age_type')).strip() in ['24', '24.0']),
                                    None
                                )
                                for height, records in weight_to_height_girls_data.items()
                            }

                            wfh_growth_data = None
                            if age_in_days <= 730:
                                if measurement_equipment == 'Stadiometer':
                                    height_rounded = round(height_rounded + 0.7,1)

                            if age_in_days > 730:
                                if measurement_equipment == 'Infantometer':
                                    height_rounded = round(height_rounded - 0.7,1)

                            if age_in_days <= 730:
                                if gender_id == '1':
                                    wfh_growth_data = age_type_0_boys.get(height_rounded)
                                else:
                                    wfh_growth_data = age_type_0_girls.get(height_rounded)

                            if age_in_days > 730:
                                if gender_id == '1':
                                    wfh_growth_data = age_type_24_boys.get(height_rounded)
                                else:
                                    wfh_growth_data = age_type_24_girls.get(height_rounded)

                            if wfh_growth_data:
                                try:
                                    L = float(wfh_growth_data.get("l", 0))
                                    M = float(wfh_growth_data.get("m", 0))
                                    S = float(wfh_growth_data.get("s", 0))
                                    weight_for_height_zscore = calculate_z_score(weight, M, L, S)
                                    
                                    sd3neg = float(wfh_growth_data.get("sd3neg", 0))
                                    sd2neg = float(wfh_growth_data.get("sd2neg", 0))
                                    sd2 = float(wfh_growth_data.get("sd2", 0))

                                    if weight < sd3neg:
                                        weight_for_height_status = 1
                                    elif weight >= sd3neg and weight < sd2neg:
                                        weight_for_height_status = 2
                                    elif weight >= sd2neg and weight <= sd2:
                                        weight_for_height_status = 3
                                    elif weight > sd2:
                                        weight_for_height_status = 4
                                  
                                except (ValueError, TypeError) as e:
                                    frappe.log_error(f"Error in weight for height calculation: {str(e)}")
                        except (ValueError, TypeError) as e:
                            frappe.log_error(f"Error processing weight for height: {str(e)}")

                    # height for age
                    if age_months is not None and height is not None and height > 0 and gender_id in ('1', '2'):
                        try:
                            age_in_days = int(age_months)
                            height = float(height)
                            if measurement_equipment and row.measurement_taken_date:
                                measurement_date = row.measurement_taken_date
                                if isinstance(measurement_date, str):
                                    measurement_date = datetime.strptime(measurement_date, "%Y-%m-%d").date()
                                two_years_ago = measurement_date - relativedelta(months=24)
                                dob = measurement_date - timedelta(days=age_in_days)
                                if dob > two_years_ago:
                                    if measurement_equipment == '1':
                                        height += 0.7
                                else:
                                    if measurement_equipment == '2':
                                        height -= 0.7
                            growth_data = height_for_age_boys_data.get(age_in_days) if gender_id == '1' else height_for_age_girls_data.get(age_in_days)
                            if growth_data:
                                try:
                                    L = float(growth_data.get("l", 0))
                                    M = float(growth_data.get("m", 0))
                                    S = float(growth_data.get("s", 0))
                                    height_for_age_zscore = calculate_z_score(height, M, L, S)
                                    
                                    sd3neg = float(growth_data.get("sd3neg", 0))
                                    sd2neg = float(growth_data.get("sd2neg", 0))
                                    sd2 = float(growth_data.get("sd2", 0))
                                    
                                    if height < sd3neg:
                                        height_for_age_status = 1
                                    elif height >= sd3neg and height < sd2neg:
                                        height_for_age_status = 2
                                    elif height >= sd2neg and height <= sd2:
                                        height_for_age_status = 3
                                    else:
                                        height_for_age_status = 4
                                except (ValueError, TypeError) as e:
                                    frappe.log_error(f"Error in height for age calculation: {str(e)}")
                        except (ValueError, TypeError) as e:
                            frappe.log_error(f"Error processing height for age: {str(e)}")

                    child_doctype = "Anthropromatic Data"
                                
                    if weight_for_age_status is not None:
                        frappe.db.set_value(child_doctype, row.name, "weight_for_age", weight_for_age_status)
                    if weight_for_height_status is not None:
                        frappe.db.set_value(child_doctype, row.name, "weight_for_height", weight_for_height_status)
                    if height_for_age_status is not None:
                        frappe.db.set_value(child_doctype, row.name, "height_for_age", height_for_age_status)
                    
                    # Set z-score values
                    if weight_for_age_zscore is not None:
                        frappe.db.set_value(child_doctype, row.name, "weight_for_age_zscore", weight_for_age_zscore)
                    if weight_for_height_zscore is not None:
                        frappe.db.set_value(child_doctype, row.name, "weight_for_height_zscore", weight_for_height_zscore)
                    if height_for_age_zscore is not None:
                        frappe.db.set_value(child_doctype, row.name, "height_for_age_zscore", height_for_age_zscore)

                    if row.dob_when_measurement_taken is not None:
                        dob_date = row.dob_when_measurement_taken
                        if isinstance(dob_date, datetime):
                            dob_date = dob_date.date()
                        frappe.db.set_value(child_doctype, row.name, "dob_when_measurement_taken", dob_date)
                    
                    frappe.db.commit()

                except Exception as e:
                    frappe.log_error(f"Error processing row {row.name if row else 'unknown'}: {str(e)}")
                    continue

# --- Helper functions ---
def get_wfh_data_for_age(data_dict, height, age_type):
    if height in data_dict:
        for record in data_dict[height]:
            if str(record.get('age_type')).strip() in [age_type, f"{age_type}.0"]:
                return record
    return None

def get_weight_for_age_boys_table():
    fields = ["age_in_days", "l", "m", "s", "sd3neg", "sd2neg", "sd2"]
    records = frappe.get_all("Weight for age Boys", fields=fields)
    return {row["age_in_days"]: row for row in records}

def get_weight_for_age_girls_table():
    fields = ["age_in_days", "l", "m", "s", "sd3neg", "sd2neg", "sd2"]
    records = frappe.get_all("Weight for age Girls", fields=fields)
    return {row["age_in_days"]: row for row in records}

def get_weight_to_height_boys():
    """Returns all weight-to-height data for boys, preserving duplicate lengths"""
    fields = [
        "age_type", "length", "green", "l", "m", "s",
        "sd4neg", "sd3neg", "sd2neg", "sd1neg", "sd0",
        "sd1", "sd2", "sd3", "sd4"
    ]
    
    try:
        records = frappe.get_all("Weight to Height Boys",
                              fields=fields,
                              limit=0)  # Get all records
        
        # Group by length while preserving all records
        data = defaultdict(list)
        for row in records:
            data[row["length"]].append(row)
            
        return dict(data)
        
    except Exception as e:
        frappe.log_error(f"Error loading boys data: {str(e)}")
        return {}

def get_weight_to_height_girls():
    """Returns all weight-to-height data for girls, preserving duplicate lengths"""
    fields = [
        "age_type", "length", "green", "l", "m", "s",
        "sd4neg", "sd3neg", "sd2neg", "sd1neg", "sd0",
        "sd1", "sd2", "sd3", "sd4"
    ]
    
    try:
        records = frappe.get_all("Weight to Height Girls",
                              fields=fields,
                              limit=0)  # Get all records
        
        # Group by length while preserving all records
        data = defaultdict(list)
        for row in records:
            data[row["length"]].append(row)
            
        return dict(data)
        
    except Exception as e:
        frappe.log_error(f"Error loading girls data: {str(e)}")
        return {}

def get_height_for_age_boys():
    fields = ["age_in_days", "l", "m", "s", "sd3neg", "sd2neg", "sd2"]
    records = frappe.get_all("Height for age Boys", fields=fields)
    return {row["age_in_days"]: row for row in records}

def get_height_for_age_girls():
    fields = ["age_in_days", "l", "m", "s", "sd3neg", "sd2neg", "sd2"]
    records = frappe.get_all("Height for age Girls", fields=fields)
    return {row["age_in_days"]: row for row in records}











# from __future__ import unicode_literals
# import frappe
# from frappe.utils import nowdate
# from frappe.model.document import Document
# import math
# from datetime import datetime, timedelta, date
# from dateutil.relativedelta import relativedelta
# from collections import defaultdict

# def calculate_z_score(value, M, L, S):
#     if L == 0:
#         raise ValueError("L should not be zero to avoid division errors.")
#     ratio = float(value / M)
#     ratio_to_L = float(math.pow(ratio, L))
#     numerator = float(ratio_to_L - 1)
#     denominator = float(S * L)
#     z_score = float(numerator / denominator)
#     if z_score <= -3:
#         sd3neg = float(M * math.pow(1 + L * S * (-3), 1 / L))
#         sd2neg = float(M * math.pow(1 + L * S * (-2), 1 / L))
#         sd23neg = float(sd2neg - sd3neg)
#         z_score = float(-3 + (value - sd3neg) / sd23neg)
#     elif z_score >= 3:
#         sd3pos = float(M * math.pow(1 + L * S * (3), 1 / L))
#         sd2pos = float(M * math.pow(1 + L * S * (2), 1 / L))
#         sd23pos = float(sd3pos - sd2pos)
#         z_score = float(3 + (value - sd3pos) / sd23pos)
#     return round(z_score, 2)

# @frappe.whitelist(allow_guest=True)
# def trigger_growth_status_update():
#     frappe.enqueue(
#         "frappe.val.z_score_status.update_growth_status_for_all_children",
#         queue='long',
#         timeout=21600
#     )
#     return "Update task has been enqueued"

# def update_growth_status_for_all_children():
#     # Check for records with missing z-scores but valid height and weight
#     missing_z_scores_count = frappe.db.sql("""
#         SELECT COUNT(*)
#         FROM `tabAnthropromatic Data` 
#         WHERE do_you_have_height_weight = 1 
#           AND (
#             (weight IS NOT NULL AND weight != '' AND weight != 0)
#             AND 
#             (height IS NOT NULL AND height != '' AND height != 0)
#           )
#           AND (
#             weight_for_age_zscore IS NULL 
#             OR weight_for_age_zscore = ''
#             OR weight_for_height_zscore IS NULL 
#             OR weight_for_height_zscore = ''
#             OR height_for_age_zscore IS NULL 
#             OR height_for_age_zscore = ''
#           )
#     """)[0][0]
    
#     if missing_z_scores_count > 0:
#         # Get all CGM records that have anthropromatic data with missing z-scores
#         cgm_list = frappe.get_all(
#             "Child Growth Monitoring",
#             filters={"docstatus": 0, "do_you_have_height_weight": 1},
#             fields=["name"]
#         )
#         for cgm in cgm_list:
#             update_growth_status_for_child(cgm.name)

# def update_growth_status_for_child(cgm_name):
#     cgm = frappe.get_doc("Child Growth Monitoring", cgm_name)
#     weight_for_age_boys_data = get_weight_for_age_boys_table()
#     weight_for_age_girls_data = get_weight_for_age_girls_table()
#     weight_to_height_boys_data = get_weight_to_height_boys()
#     weight_to_height_girls_data = get_weight_to_height_girls()
#     height_for_age_boys_data = get_height_for_age_boys()
#     height_for_age_girls_data = get_height_for_age_girls()
    
#     if cgm.get("anthropromatic_details"):
#         for row in cgm.get("anthropromatic_details"):
#             # Skip if required fields are missing
#             if (not row.childenrollguid or not row.age_months):
#                 continue
                
#             # Check if z-scores are missing but height and weight are valid
#             if (row.weight is not None and row.weight != '' and row.weight != 0 and
#                 row.height is not None and row.height != '' and row.height != 0 and
#                 (row.weight_for_age_zscore is None or row.weight_for_age_zscore == '' or
#                  row.weight_for_height_zscore is None or row.weight_for_height_zscore == '' or
#                  row.height_for_age_zscore is None or row.height_for_age_zscore == '')):
                
#                 try:
#                     age_months = row.age_months
#                     guid = row.childenrollguid.strip() if row.childenrollguid else None
#                     if not guid:
#                         continue
                        
#                     gender_id = frappe.db.get_value("Child Enrollment and Exit", {"childenrollguid": guid}, "gender_id")
#                     weight = row.weight
#                     height = row.height
#                     measurement_equipment = row.measurement_equipment

#                     weight_for_age_status = None
#                     weight_for_height_status = None
#                     height_for_age_status = None
#                     weight_for_age_zscore = None
#                     weight_for_height_zscore = None
#                     height_for_age_zscore = None

#                     # Calculating dob_when_measurement_taken
#                     if row.measurement_taken_date and age_months:
#                         try:
#                             measurement_date = row.measurement_taken_date
#                             age_days = age_months  
#                             dob_date = measurement_date - timedelta(days=age_days)
#                             row.dob_when_measurement_taken = dob_date
#                         except Exception as e:
#                             frappe.log_error(f"Error calculating DOB: {str(e)}")
#                             row.dob_when_measurement_taken = None
#                     else:
#                         row.dob_when_measurement_taken = None

#                     # weight for age
#                     if age_months is not None and weight is not None and weight > 0 and gender_id in ('1', '2'):
#                         try:
#                             age_in_days = int(age_months)
#                             weight = float(weight)
#                             growth_data = weight_for_age_boys_data.get(age_in_days) if gender_id == '1' else weight_for_age_girls_data.get(age_in_days)
#                             if growth_data:
#                                 try:
#                                     L = float(growth_data.get("l", 0))
#                                     M = float(growth_data.get("m", 0))
#                                     S = float(growth_data.get("s", 0))
                                    
#                                     # Calculate z-score
#                                     weight_for_age_zscore = calculate_z_score(weight, M, L, S)
                                    
#                                     sd3neg = float(growth_data.get("sd3neg", 0))
#                                     sd2neg = float(growth_data.get("sd2neg", 0))
#                                     sd2 = float(growth_data.get("sd2", 0))
                                    
#                                     if weight < sd3neg:
#                                         weight_for_age_status = 1
#                                     elif weight >= sd3neg and weight < sd2neg:
#                                         weight_for_age_status = 2
#                                     elif weight >= sd2neg and weight <= sd2:
#                                         weight_for_age_status = 3
#                                     elif weight > sd2:
#                                         weight_for_age_status = 4
#                                 except (ValueError, TypeError) as e:
#                                     frappe.log_error(f"Error in weight for age calculation: {str(e)}")
#                         except (ValueError, TypeError) as e:
#                             frappe.log_error(f"Error processing weight for age: {str(e)}")

#                     # weight for height
#                     if height is not None and weight is not None and weight > 0 and height > 0 and gender_id in ('1', '2'):
#                         try:
#                             height_rounded = round(height,1)
#                             weight = float(weight)
#                             age_in_days = int(age_months)
                            
#                             age_type_0_boys = {
#                                 height: next(
#                                     (record for record in records if str(record.get('age_type')).strip() in ['0', '0.0']),
#                                     None
#                                 )
#                                 for height, records in weight_to_height_boys_data.items()
#                             }

#                             age_type_24_boys = {
#                                 height: next(
#                                     (record for record in records if str(record.get('age_type')).strip() in ['24', '24.0']),
#                                     None
#                                 )
#                                 for height, records in weight_to_height_boys_data.items()
#                             }

#                             age_type_0_girls = {
#                                 height: next(
#                                     (record for record in records if str(record.get('age_type')).strip() in ['0', '0.0']),
#                                     None
#                                 )
#                                 for height, records in weight_to_height_girls_data.items()
#                             }

#                             age_type_24_girls = {
#                                 height: next(
#                                     (record for record in records if str(record.get('age_type')).strip() in ['24', '24.0']),
#                                     None
#                                 )
#                                 for height, records in weight_to_height_girls_data.items()
#                             }

#                             wfh_growth_data = None
#                             if age_in_days <= 730:
#                                 if measurement_equipment == 'Stadiometer':
#                                     height_rounded = round(height_rounded + 0.7,1)

#                             if age_in_days > 730:
#                                 if measurement_equipment == 'Infantometer':
#                                     height_rounded = round(height_rounded - 0.7,1)

#                             if age_in_days <= 730:
#                                 if gender_id == '1':
#                                     wfh_growth_data = age_type_0_boys.get(height_rounded)
#                                 else:
#                                     wfh_growth_data = age_type_0_girls.get(height_rounded)

#                             if age_in_days > 730:
#                                 if gender_id == '1':
#                                     wfh_growth_data = age_type_24_boys.get(height_rounded)
#                                 else:
#                                     wfh_growth_data = age_type_24_girls.get(height_rounded)

#                             if wfh_growth_data:
#                                 try:
#                                     L = float(wfh_growth_data.get("l", 0))
#                                     M = float(wfh_growth_data.get("m", 0))
#                                     S = float(wfh_growth_data.get("s", 0))
#                                     weight_for_height_zscore = calculate_z_score(weight, M, L, S)
                                    
#                                     sd3neg = float(wfh_growth_data.get("sd3neg", 0))
#                                     sd2neg = float(wfh_growth_data.get("sd2neg", 0))
#                                     sd2 = float(wfh_growth_data.get("sd2", 0))

#                                     if weight < sd3neg:
#                                         weight_for_height_status = 1
#                                     elif weight >= sd3neg and weight < sd2neg:
#                                         weight_for_height_status = 2
#                                     elif weight >= sd2neg and weight <= sd2:
#                                         weight_for_height_status = 3
#                                     elif weight > sd2:
#                                         weight_for_height_status = 4
                                  
#                                 except (ValueError, TypeError) as e:
#                                     frappe.log_error(f"Error in weight for height calculation: {str(e)}")
#                         except (ValueError, TypeError) as e:
#                             frappe.log_error(f"Error processing weight for height: {str(e)}")

#                     # height for age
#                     if age_months is not None and height is not None and height > 0 and gender_id in ('1', '2'):
#                         try:
#                             age_in_days = int(age_months)
#                             height = float(height)
#                             if measurement_equipment and row.measurement_taken_date:
#                                 measurement_date = row.measurement_taken_date
#                                 if isinstance(measurement_date, str):
#                                     measurement_date = datetime.strptime(measurement_date, "%Y-%m-%d").date()
#                                 two_years_ago = measurement_date - relativedelta(months=24)
#                                 dob = measurement_date - timedelta(days=age_in_days)
#                                 if dob > two_years_ago:
#                                     if measurement_equipment == '1':
#                                         height += 0.7
#                                 else:
#                                     if measurement_equipment == '2':
#                                         height -= 0.7
#                             growth_data = height_for_age_boys_data.get(age_in_days) if gender_id == '1' else height_for_age_girls_data.get(age_in_days)
#                             if growth_data:
#                                 try:
#                                     L = float(growth_data.get("l", 0))
#                                     M = float(growth_data.get("m", 0))
#                                     S = float(growth_data.get("s", 0))
#                                     height_for_age_zscore = calculate_z_score(height, M, L, S)
                                    
#                                     sd3neg = float(growth_data.get("sd3neg", 0))
#                                     sd2neg = float(growth_data.get("sd2neg", 0))
#                                     sd2 = float(growth_data.get("sd2", 0))
                                    
#                                     if height < sd3neg:
#                                         height_for_age_status = 1
#                                     elif height >= sd3neg and height < sd2neg:
#                                         height_for_age_status = 2
#                                     elif height >= sd2neg and height <= sd2:
#                                         height_for_age_status = 3
#                                     else:
#                                         height_for_age_status = 4
#                                 except (ValueError, TypeError) as e:
#                                     frappe.log_error(f"Error in height for age calculation: {str(e)}")
#                         except (ValueError, TypeError) as e:
#                             frappe.log_error(f"Error processing height for age: {str(e)}")

#                     child_doctype = "Anthropromatic Data"
                                
#                     if weight_for_age_status is not None:
#                         frappe.db.set_value(child_doctype, row.name, "weight_for_age", weight_for_age_status)
#                     if weight_for_height_status is not None:
#                         frappe.db.set_value(child_doctype, row.name, "weight_for_height", weight_for_height_status)
#                     if height_for_age_status is not None:
#                         frappe.db.set_value(child_doctype, row.name, "height_for_age", height_for_age_status)
                    
#                     # Set z-score values
#                     if weight_for_age_zscore is not None:
#                         frappe.db.set_value(child_doctype, row.name, "weight_for_age_zscore", weight_for_age_zscore)
#                     if weight_for_height_zscore is not None:
#                         frappe.db.set_value(child_doctype, row.name, "weight_for_height_zscore", weight_for_height_zscore)
#                     if height_for_age_zscore is not None:
#                         frappe.db.set_value(child_doctype, row.name, "height_for_age_zscore", height_for_age_zscore)

#                     if row.dob_when_measurement_taken is not None:
#                         dob_date = row.dob_when_measurement_taken
#                         if isinstance(dob_date, datetime):
#                             dob_date = dob_date.date()
#                         frappe.db.set_value(child_doctype, row.name, "dob_when_measurement_taken", dob_date)
                    
#                     frappe.db.commit()

#                 except Exception as e:
#                     frappe.log_error(f"Error processing row {row.name if row else 'unknown'}: {str(e)}")
#                     continue

# # --- Helper functions ---
# def get_wfh_data_for_age(data_dict, height, age_type):
#     if height in data_dict:
#         for record in data_dict[height]:
#             if str(record.get('age_type')).strip() in [age_type, f"{age_type}.0"]:
#                 return record
#     return None

# def get_weight_for_age_boys_table():
#     fields = ["age_in_days", "l", "m", "s", "sd3neg", "sd2neg", "sd2"]
#     records = frappe.get_all("Weight for age Boys", fields=fields)
#     return {row["age_in_days"]: row for row in records}

# def get_weight_for_age_girls_table():
#     fields = ["age_in_days", "l", "m", "s", "sd3neg", "sd2neg", "sd2"]
#     records = frappe.get_all("Weight for age Girls", fields=fields)
#     return {row["age_in_days"]: row for row in records}

# def get_weight_to_height_boys():
#     """Returns all weight-to-height data for boys, preserving duplicate lengths"""
#     fields = [
#         "age_type", "length", "green", "l", "m", "s",
#         "sd4neg", "sd3neg", "sd2neg", "sd1neg", "sd0",
#         "sd1", "sd2", "sd3", "sd4"
#     ]
    
#     try:
#         records = frappe.get_all("Weight to Height Boys",
#                               fields=fields,
#                               limit=0)  # Get all records
        
#         # Group by length while preserving all records
#         data = defaultdict(list)
#         for row in records:
#             data[row["length"]].append(row)
            
#         return dict(data)
        
#     except Exception as e:
#         frappe.log_error(f"Error loading boys data: {str(e)}")
#         return {}

# def get_weight_to_height_girls():
#     """Returns all weight-to-height data for girls, preserving duplicate lengths"""
#     fields = [
#         "age_type", "length", "green", "l", "m", "s",
#         "sd4neg", "sd3neg", "sd2neg", "sd1neg", "sd0",
#         "sd1", "sd2", "sd3", "sd4"
#     ]
    
#     try:
#         records = frappe.get_all("Weight to Height Girls",
#                               fields=fields,
#                               limit=0)  # Get all records
        
#         # Group by length while preserving all records
#         data = defaultdict(list)
#         for row in records:
#             data[row["length"]].append(row)
            
#         return dict(data)
        
#     except Exception as e:
#         frappe.log_error(f"Error loading girls data: {str(e)}")
#         return {}

# def get_height_for_age_boys():
#     fields = ["age_in_days", "l", "m", "s", "sd3neg", "sd2neg", "sd2"]
#     records = frappe.get_all("Height for age Boys", fields=fields)
#     return {row["age_in_days"]: row for row in records}

# def get_height_for_age_girls():
#     fields = ["age_in_days", "l", "m", "s", "sd3neg", "sd2neg", "sd2"]
#     records = frappe.get_all("Height for age Girls", fields=fields)
#     return {row["age_in_days"]: row for row in records}

# 11-11-2025 Backup
# from __future__ import unicode_literals
# import frappe
# from frappe.utils import nowdate
# from frappe.model.document import Document
# import math
# from datetime import datetime, timedelta, date
# from dateutil.relativedelta import relativedelta
# from collections import defaultdict

# def calculate_z_score(value, M, L, S):
#     if L == 0:
#         raise ValueError("L should not be zero to avoid division errors.")
#     ratio = float(value / M)
#     ratio_to_L = float(math.pow(ratio, L))
#     numerator = float(ratio_to_L - 1)
#     denominator = float(S * L)
#     z_score = float(numerator / denominator)
#     if z_score <= -3:
#         sd3neg = float(M * math.pow(1 + L * S * (-3), 1 / L))
#         sd2neg = float(M * math.pow(1 + L * S * (-2), 1 / L))
#         sd23neg = float(sd2neg - sd3neg)
#         z_score = float(-3 + (value - sd3neg) / sd23neg)
#     elif z_score >= 3:
#         sd3pos = float(M * math.pow(1 + L * S * (3), 1 / L))
#         sd2pos = float(M * math.pow(1 + L * S * (2), 1 / L))
#         sd23pos = float(sd3pos - sd2pos)
#         z_score = float(3 + (value - sd3pos) / sd23pos)
#     return round(z_score, 2)

# @frappe.whitelist(allow_guest=True)
# def trigger_growth_status_update():
#     frappe.enqueue(
#         "frappe.val.z_score_status.update_growth_status_for_all_children",
#         queue='long',
#         timeout=21600
#     )
#     return "Update task has been enqueued"

# def update_growth_status_for_all_children():
#     cgm_list = frappe.get_all(
#         "Child Growth Monitoring",
#         filters={"docstatus": 0, "do_you_have_height_weight":1, "height": ["in", [65, 65.5]] },
#         fields=["name"]
#     )
#     for cgm in cgm_list:
#         update_growth_status_for_child(cgm.name)

# def update_growth_status_for_child(cgm_name):
#     cgm = frappe.get_doc("Child Growth Monitoring", cgm_name)
#     weight_for_age_boys_data = get_weight_for_age_boys_table()
#     weight_for_age_girls_data = get_weight_for_age_girls_table()
#     weight_to_height_boys_data = get_weight_to_height_boys()
#     weight_to_height_girls_data = get_weight_to_height_girls()
#     height_for_age_boys_data = get_height_for_age_boys()
#     height_for_age_girls_data = get_height_for_age_girls()
    
#     if cgm.get("anthropromatic_details"):
#         for row in cgm.get("anthropromatic_details"):
#             # Skip if required fields are missing
#             if (not row.childenrollguid or not row.age_months):
#                 continue
                
#             try:
#                 age_months = row.age_months
#                 guid = row.childenrollguid.strip() if row.childenrollguid else None
#                 if not guid:
#                     continue
                    
#                 gender_id = frappe.db.get_value("Child Enrollment and Exit", {"childenrollguid": guid}, "gender_id")
#                 weight = row.weight
#                 height = row.height
#                 measurement_equipment = row.measurement_equipment

#                 weight_for_age_status = None
#                 weight_for_height_status = None
#                 height_for_age_status = None
#                 weight_for_age_zscore = None
#                 weight_for_height_zscore = None
#                 height_for_age_zscore = None

#                 # Calculating dob_when_measurement_taken
#                 if row.measurement_taken_date and age_months:
#                     try:
#                         measurement_date = row.measurement_taken_date
#                         age_days = age_months  
#                         dob_date = measurement_date - timedelta(days=age_days)
#                         row.dob_when_measurement_taken = dob_date
#                     except Exception as e:
#                         frappe.log_error(f"Error calculating DOB: {str(e)}")
#                         row.dob_when_measurement_taken = None
#                 else:
#                     row.dob_when_measurement_taken = None

#                 # weight for age
#                 if age_months is not None and weight is not None and weight > 0 and gender_id in ('1', '2'):
#                     try:
#                         age_in_days = int(age_months)
#                         weight = float(weight)
#                         growth_data = weight_for_age_boys_data.get(age_in_days) if gender_id == '1' else weight_for_age_girls_data.get(age_in_days)
#                         if growth_data:
#                             try:
#                                 L = float(growth_data.get("l", 0))
#                                 M = float(growth_data.get("m", 0))
#                                 S = float(growth_data.get("s", 0))
                                
#                                 # Calculate z-score
#                                 weight_for_age_zscore = calculate_z_score(weight, M, L, S)
                                
#                                 sd3neg = float(growth_data.get("sd3neg", 0))
#                                 sd2neg = float(growth_data.get("sd2neg", 0))
#                                 sd2 = float(growth_data.get("sd2", 0))
                                
#                                 if weight < sd3neg:
#                                     weight_for_age_status = 1
#                                 elif weight >= sd3neg and weight < sd2neg:
#                                     weight_for_age_status = 2
#                                 elif weight >= sd2neg and weight <= sd2:
#                                     weight_for_age_status = 3
#                                 elif weight > sd2:
#                                     weight_for_age_status = 4
#                             except (ValueError, TypeError) as e:
#                                 frappe.log_error(f"Error in weight for age calculation: {str(e)}")
#                     except (ValueError, TypeError) as e:
#                         frappe.log_error(f"Error processing weight for age: {str(e)}")

#                 # weight for height
#                 if height is not None and weight is not None and weight > 0 and height > 0 and gender_id in ('1', '2'):
#                     try:
#                         height_rounded = round(height,1)
#                         weight = float(weight)
#                         age_in_days = int(age_months)
                        
#                         age_type_0_boys = {
#                             height: next(
#                                 (record for record in records if str(record.get('age_type')).strip() in ['0', '0.0']),
#                                 None
#                             )
#                             for height, records in weight_to_height_boys_data.items()
#                         }

#                         age_type_24_boys = {
#                             height: next(
#                                 (record for record in records if str(record.get('age_type')).strip() in ['24', '24.0']),
#                                 None
#                             )
#                             for height, records in weight_to_height_boys_data.items()
#                         }

#                         age_type_0_girls = {
#                             height: next(
#                                 (record for record in records if str(record.get('age_type')).strip() in ['0', '0.0']),
#                                 None
#                             )
#                             for height, records in weight_to_height_girls_data.items()
#                         }

#                         age_type_24_girls = {
#                             height: next(
#                                 (record for record in records if str(record.get('age_type')).strip() in ['24', '24.0']),
#                                 None
#                             )
#                             for height, records in weight_to_height_girls_data.items()
#                         }

#                         wfh_growth_data = None
#                         if age_in_days <= 730:
#                             if measurement_equipment == 'Stadiometer':
#                                 height_rounded = round(height_rounded + 0.7,1)

#                         if age_in_days > 730:
#                             if measurement_equipment == 'Infantometer':
#                                 height_rounded = round(height_rounded - 0.7,1)

#                         if age_in_days <= 730:
#                             if gender_id == '1':
#                                 wfh_growth_data = age_type_0_boys.get(height_rounded)
#                             else:
#                                 wfh_growth_data = age_type_0_girls.get(height_rounded)

#                         if age_in_days > 730:
#                             if gender_id == '1':
#                                 wfh_growth_data = age_type_24_boys.get(height_rounded)
#                             else:
#                                 wfh_growth_data = age_type_24_girls.get(height_rounded)

#                         if wfh_growth_data:
#                             try:
#                                 L = float(wfh_growth_data.get("l", 0))
#                                 M = float(wfh_growth_data.get("m", 0))
#                                 S = float(wfh_growth_data.get("s", 0))
#                                 weight_for_height_zscore = calculate_z_score(weight, M, L, S)
                                
#                                 sd3neg = float(wfh_growth_data.get("sd3neg", 0))
#                                 sd2neg = float(wfh_growth_data.get("sd2neg", 0))
#                                 sd2 = float(wfh_growth_data.get("sd2", 0))

#                                 if weight < sd3neg:
#                                     weight_for_height_status = 1
#                                 elif weight >= sd3neg and weight < sd2neg:
#                                     weight_for_height_status = 2
#                                 elif weight >= sd2neg and weight <= sd2:
#                                     weight_for_height_status = 3
#                                 elif weight > sd2:
#                                     weight_for_height_status = 4
                              
#                             except (ValueError, TypeError) as e:
#                                 frappe.log_error(f"Error in weight for height calculation: {str(e)}")
#                     except (ValueError, TypeError) as e:
#                         frappe.log_error(f"Error processing weight for height: {str(e)}")

#                 # height for age
#                 if age_months is not None and height is not None and height > 0 and gender_id in ('1', '2'):
#                     try:
#                         age_in_days = int(age_months)
#                         height = float(height)
#                         if measurement_equipment and row.measurement_taken_date:
#                             measurement_date = row.measurement_taken_date
#                             if isinstance(measurement_date, str):
#                                 measurement_date = datetime.strptime(measurement_date, "%Y-%m-%d").date()
#                             two_years_ago = measurement_date - relativedelta(months=24)
#                             dob = measurement_date - timedelta(days=age_in_days)
#                             if dob > two_years_ago:
#                                 if measurement_equipment == '1':
#                                     height += 0.7
#                             else:
#                                 if measurement_equipment == '2':
#                                     height -= 0.7
#                         growth_data = height_for_age_boys_data.get(age_in_days) if gender_id == '1' else height_for_age_girls_data.get(age_in_days)
#                         if growth_data:
#                             try:
#                                 L = float(growth_data.get("l", 0))
#                                 M = float(growth_data.get("m", 0))
#                                 S = float(growth_data.get("s", 0))
#                                 height_for_age_zscore = calculate_z_score(height, M, L, S)
                                
#                                 sd3neg = float(growth_data.get("sd3neg", 0))
#                                 sd2neg = float(growth_data.get("sd2neg", 0))
#                                 sd2 = float(growth_data.get("sd2", 0))
                                
#                                 if height < sd3neg:
#                                     height_for_age_status = 1
#                                 elif height >= sd3neg and height < sd2neg:
#                                     height_for_age_status = 2
#                                 elif height >= sd2neg and height <= sd2:
#                                     height_for_age_status = 3
#                                 else:
#                                     height_for_age_status = 4
#                             except (ValueError, TypeError) as e:
#                                 frappe.log_error(f"Error in height for age calculation: {str(e)}")
#                     except (ValueError, TypeError) as e:
#                         frappe.log_error(f"Error processing height for age: {str(e)}")

#                 child_doctype = "Anthropromatic Data"
                            
#                 if weight_for_age_status is not None:
#                     frappe.db.set_value(child_doctype, row.name, "weight_for_age", weight_for_age_status)
#                 if weight_for_height_status is not None:
#                     frappe.db.set_value(child_doctype, row.name, "weight_for_height", weight_for_height_status)
#                 if height_for_age_status is not None:
#                     frappe.db.set_value(child_doctype, row.name, "height_for_age", height_for_age_status)
                
#                 # Set z-score values
#                 if weight_for_age_zscore is not None:
#                     frappe.db.set_value(child_doctype, row.name, "weight_for_age_zscore", weight_for_age_zscore)
#                 if weight_for_height_zscore is not None:
#                     frappe.db.set_value(child_doctype, row.name, "weight_for_height_zscore", weight_for_height_zscore)
#                 if height_for_age_zscore is not None:
#                     frappe.db.set_value(child_doctype, row.name, "height_for_age_zscore", height_for_age_zscore)

#                 if row.dob_when_measurement_taken is not None:
#                     dob_date = row.dob_when_measurement_taken
#                     if isinstance(dob_date, datetime):
#                         dob_date = dob_date.date()
#                     frappe.db.set_value(child_doctype, row.name, "dob_when_measurement_taken", dob_date)
                
#                 frappe.db.set_value(child_doctype, row.name, "flag", 1)
#                 frappe.db.commit()

#             except Exception as e:
#                 frappe.log_error(f"Error processing row {row.name if row else 'unknown'}: {str(e)}")
#                 continue

# # --- Helper functions ---
# def get_wfh_data_for_age(data_dict, height, age_type):
#     if height in data_dict:
#         for record in data_dict[height]:
#             if str(record.get('age_type')).strip() in [age_type, f"{age_type}.0"]:
#                 return record
#     return None

# def get_weight_for_age_boys_table():
#     fields = ["age_in_days", "l", "m", "s", "sd3neg", "sd2neg", "sd2"]
#     records = frappe.get_all("Weight for age Boys", fields=fields)
#     return {row["age_in_days"]: row for row in records}

# def get_weight_for_age_girls_table():
#     fields = ["age_in_days", "l", "m", "s", "sd3neg", "sd2neg", "sd2"]
#     records = frappe.get_all("Weight for age Girls", fields=fields)
#     return {row["age_in_days"]: row for row in records}

# def get_weight_to_height_boys():
#     """Returns all weight-to-height data for boys, preserving duplicate lengths"""
#     fields = [
#         "age_type", "length", "green", "l", "m", "s",
#         "sd4neg", "sd3neg", "sd2neg", "sd1neg", "sd0",
#         "sd1", "sd2", "sd3", "sd4"
#     ]
    
#     try:
#         records = frappe.get_all("Weight to Height Boys",
#                               fields=fields,
#                               limit=0)  # Get all records
        
#         # Group by length while preserving all records
#         data = defaultdict(list)
#         for row in records:
#             data[row["length"]].append(row)
            
#         return dict(data)
        
#     except Exception as e:
#         frappe.log_error(f"Error loading boys data: {str(e)}")
#         return {}

# def get_weight_to_height_girls():
#     """Returns all weight-to-height data for girls, preserving duplicate lengths"""
#     fields = [
#         "age_type", "length", "green", "l", "m", "s",
#         "sd4neg", "sd3neg", "sd2neg", "sd1neg", "sd0",
#         "sd1", "sd2", "sd3", "sd4"
#     ]
    
#     try:
#         records = frappe.get_all("Weight to Height Girls",
#                               fields=fields,
#                               limit=0)  # Get all records
        
#         # Group by length while preserving all records
#         data = defaultdict(list)
#         for row in records:
#             data[row["length"]].append(row)
            
#         return dict(data)
        
#     except Exception as e:
#         frappe.log_error(f"Error loading girls data: {str(e)}")
#         return {}

# def get_height_for_age_boys():
#     fields = ["age_in_days", "l", "m", "s", "sd3neg", "sd2neg", "sd2"]
#     records = frappe.get_all("Height for age Boys", fields=fields)
#     return {row["age_in_days"]: row for row in records}

# def get_height_for_age_girls():
#     fields = ["age_in_days", "l", "m", "s", "sd3neg", "sd2neg", "sd2"]
#     records = frappe.get_all("Height for age Girls", fields=fields)
#     return {row["age_in_days"]: row for row in records}



#Backup_05-09-2025
# from __future__ import unicode_literals
# import frappe
# from frappe.utils import nowdate
# from frappe.model.document import Document
# import math
# from datetime import datetime, timedelta, date
# from dateutil.relativedelta import relativedelta
# from collections import defaultdict

# def calculate_z_score(value, M, L, S):
#     if L == 0:
#         raise ValueError("L should not be zero to avoid division errors.")
#     ratio = float(value / M)
#     ratio_to_L = float(math.pow(ratio, L))
#     numerator = float(ratio_to_L - 1)
#     denominator = float(S * L)
#     z_score = float(numerator / denominator)
#     if z_score <= -3:
#         sd3neg = float(M * math.pow(1 + L * S * (-3), 1 / L))
#         sd2neg = float(M * math.pow(1 + L * S * (-2), 1 / L))
#         sd23neg = float(sd2neg - sd3neg)
#         z_score = float(-3 + (value - sd3neg) / sd23neg)
#     elif z_score >= 3:
#         sd3pos = float(M * math.pow(1 + L * S * (3), 1 / L))
#         sd2pos = float(M * math.pow(1 + L * S * (2), 1 / L))
#         sd23pos = float(sd3pos - sd2pos)
#         z_score = float(3 + (value - sd3pos) / sd23pos)
#     return round(z_score, 2)

# @frappe.whitelist(allow_guest=True)
# def trigger_growth_status_update():
#     frappe.enqueue(
#         "frappe.val.z_score_status.update_growth_status_for_all_children",
#         queue='long',
#         timeout=28800
#     )
#     return "Update task has been enqueued"

# def update_growth_status_for_all_children():
#     cgm_list = frappe.get_all(
#         "Child Growth Monitoring",
#         filters={"docstatus": 0, "do_you_have_height_weight":1 , "flag" : 1 },
#         fields=["name"]
#     )

#     for cgm in cgm_list:
#         update_growth_status_for_child(cgm.name)

# def update_growth_status_for_child(cgm_name):
#     cgm = frappe.get_doc("Child Growth Monitoring", cgm_name)
#     weight_for_age_boys_data = get_weight_for_age_boys_table()
#     weight_for_age_girls_data = get_weight_for_age_girls_table()
#     weight_to_height_boys_data = get_weight_to_height_boys()
#     weight_to_height_girls_data = get_weight_to_height_girls()
#     height_for_age_boys_data = get_height_for_age_boys()
#     height_for_age_girls_data = get_height_for_age_girls()
    
#     if cgm.get("anthropromatic_details"):
#         for row in cgm.get("anthropromatic_details"):
#             # Skip if required fields are missing
#             if (not row.childenrollguid or not row.age_months or 
#                 (row.weight_for_age_zscore and row.weight_for_height_zscore and row.height_for_age_zscore)):
#                 continue
                
#             try:
#                 age_months = row.age_months
#                 guid = row.childenrollguid.strip() if row.childenrollguid else None
#                 if not guid:
#                     continue
                    
#                 gender_id = frappe.db.get_value("Child Enrollment and Exit", {"childenrollguid": guid}, "gender_id")
#                 weight = row.weight
#                 height = row.height
#                 measurement_equipment = row.measurement_equipment

#                 weight_for_age_status = None
#                 weight_for_height_status = None
#                 height_for_age_status = None
#                 weight_for_age_zscore = None
#                 weight_for_height_zscore = None
#                 height_for_age_zscore = None

#                 # Calculating dob_when_measurement_taken
#                 if row.measurement_taken_date and age_months:
#                     try:
#                         measurement_date = row.measurement_taken_date
#                         age_days = age_months  
#                         dob_date = measurement_date - timedelta(days=age_days)
#                         row.dob_when_measurement_taken = dob_date
#                     except Exception as e:
#                         frappe.log_error(f"Error calculating DOB: {str(e)}")
#                         row.dob_when_measurement_taken = None
#                 else:
#                     row.dob_when_measurement_taken = None

#                 # weight for age
#                 if age_months is not None and weight is not None and weight > 0 and gender_id in ('1', '2'):
#                     try:
#                         age_in_days = int(age_months)
#                         weight = float(weight)
#                         growth_data = weight_for_age_boys_data.get(age_in_days) if gender_id == '1' else weight_for_age_girls_data.get(age_in_days)
#                         if growth_data:
#                             try:
#                                 L = float(growth_data.get("l", 0))
#                                 M = float(growth_data.get("m", 0))
#                                 S = float(growth_data.get("s", 0))
                                
#                                 # Calculate z-score
#                                 weight_for_age_zscore = calculate_z_score(weight, M, L, S)
                                
#                                 sd3neg = float(growth_data.get("sd3neg", 0))
#                                 sd2neg = float(growth_data.get("sd2neg", 0))
#                                 sd2 = float(growth_data.get("sd2", 0))
                                
#                                 if weight < sd3neg:
#                                     weight_for_age_status = 1
#                                 elif weight >= sd3neg and weight < sd2neg:
#                                     weight_for_age_status = 2
#                                 elif weight >= sd2neg and weight <= sd2:
#                                     weight_for_age_status = 3
#                                 elif weight > sd2:
#                                     weight_for_age_status = 4
#                             except (ValueError, TypeError) as e:
#                                 frappe.log_error(f"Error in weight for age calculation: {str(e)}")
#                     except (ValueError, TypeError) as e:
#                         frappe.log_error(f"Error processing weight for age: {str(e)}")

#                 # weight for height
#                 if height is not None and weight is not None and weight > 0 and height > 0 and gender_id in ('1', '2'):
#                     try:
#                         height_rounded = round(height,1)
#                         weight = float(weight)
#                         age_in_days = int(age_months)
                        
#                         age_type_0_boys = {
#                             height: next(
#                                 (record for record in records if str(record.get('age_type')).strip() in ['0', '0.0']),
#                                 None
#                             )
#                             for height, records in weight_to_height_boys_data.items()
#                         }

#                         age_type_24_boys = {
#                             height: next(
#                                 (record for record in records if str(record.get('age_type')).strip() in ['24', '24.0']),
#                                 None
#                             )
#                             for height, records in weight_to_height_boys_data.items()
#                         }

#                         age_type_0_girls = {
#                             height: next(
#                                 (record for record in records if str(record.get('age_type')).strip() in ['0', '0.0']),
#                                 None
#                             )
#                             for height, records in weight_to_height_girls_data.items()
#                         }

#                         age_type_24_girls = {
#                             height: next(
#                                 (record for record in records if str(record.get('age_type')).strip() in ['24', '24.0']),
#                                 None
#                             )
#                             for height, records in weight_to_height_girls_data.items()
#                         }

#                         wfh_growth_data = None
#                         if age_in_days <= 730:
#                             if measurement_equipment == 'Stadiometer':
#                                 height_rounded = round(height_rounded + 0.7,1)

#                         if age_in_days > 730:
#                             if measurement_equipment == 'Infantometer':
#                                 height_rounded = round(height_rounded - 0.7,1)

#                         if age_in_days <= 730:
#                             if gender_id == '1':
#                                 wfh_growth_data = age_type_0_boys.get(height_rounded)
#                             else:
#                                 wfh_growth_data = age_type_0_girls.get(height_rounded)

#                         if age_in_days > 730:
#                             if gender_id == '1':
#                                 wfh_growth_data = age_type_24_boys.get(height_rounded)
#                             else:
#                                 wfh_growth_data = age_type_24_girls.get(height_rounded)

#                         if wfh_growth_data:
#                             try:
#                                 L = float(wfh_growth_data.get("l", 0))
#                                 M = float(wfh_growth_data.get("m", 0))
#                                 S = float(wfh_growth_data.get("s", 0))
#                                 weight_for_height_zscore = calculate_z_score(weight, M, L, S)
                                
#                                 sd3neg = float(wfh_growth_data.get("sd3neg", 0))
#                                 sd2neg = float(wfh_growth_data.get("sd2neg", 0))
#                                 sd2 = float(wfh_growth_data.get("sd2", 0))

#                                 if weight < sd3neg:
#                                     weight_for_height_status = 1
#                                 elif weight >= sd3neg and weight < sd2neg:
#                                     weight_for_height_status = 2
#                                 elif weight >= sd2neg and weight <= sd2:
#                                     weight_for_height_status = 3
#                                 elif weight > sd2:
#                                     weight_for_height_status = 4
                              
#                             except (ValueError, TypeError) as e:
#                                 frappe.log_error(f"Error in weight for height calculation: {str(e)}")
#                     except (ValueError, TypeError) as e:
#                         frappe.log_error(f"Error processing weight for height: {str(e)}")

#                 # height for age
#                 if age_months is not None and height is not None and height > 0 and gender_id in ('1', '2'):
#                     try:
#                         age_in_days = int(age_months)
#                         height = float(height)
#                         if measurement_equipment and row.measurement_taken_date:
#                             measurement_date = row.measurement_taken_date
#                             if isinstance(measurement_date, str):
#                                 measurement_date = datetime.strptime(measurement_date, "%Y-%m-%d").date()
#                             two_years_ago = measurement_date - relativedelta(months=24)
#                             dob = measurement_date - timedelta(days=age_in_days)
#                             if dob > two_years_ago:
#                                 if measurement_equipment == '1':
#                                     height += 0.7
#                             else:
#                                 if measurement_equipment == '2':
#                                     height -= 0.7
#                         growth_data = height_for_age_boys_data.get(age_in_days) if gender_id == '1' else height_for_age_girls_data.get(age_in_days)
#                         if growth_data:
#                             try:
#                                 L = float(growth_data.get("l", 0))
#                                 M = float(growth_data.get("m", 0))
#                                 S = float(growth_data.get("s", 0))
#                                 height_for_age_zscore = calculate_z_score(height, M, L, S)
                                
#                                 sd3neg = float(growth_data.get("sd3neg", 0))
#                                 sd2neg = float(growth_data.get("sd2neg", 0))
#                                 sd2 = float(growth_data.get("sd2", 0))
                                
#                                 if height < sd3neg:
#                                     height_for_age_status = 1
#                                 elif height >= sd3neg and height < sd2neg:
#                                     height_for_age_status = 2
#                                 elif height >= sd2neg and height <= sd2:
#                                     height_for_age_status = 3
#                                 else:
#                                     height_for_age_status = 4
#                             except (ValueError, TypeError) as e:
#                                 frappe.log_error(f"Error in height for age calculation: {str(e)}")
#                     except (ValueError, TypeError) as e:
#                         frappe.log_error(f"Error processing height for age: {str(e)}")

#                 child_doctype = "Anthropromatic Data"
                            
#                 if weight_for_age_status is not None:
#                     frappe.db.set_value(child_doctype, row.name, "weight_for_age", weight_for_age_status)
#                 if weight_for_height_status is not None:
#                     frappe.db.set_value(child_doctype, row.name, "weight_for_height", weight_for_height_status)
#                 if height_for_age_status is not None:
#                     frappe.db.set_value(child_doctype, row.name, "height_for_age", height_for_age_status)
                
#                 # Set z-score values
#                 if weight_for_age_zscore is not None:
#                     frappe.db.set_value(child_doctype, row.name, "weight_for_age_zscore", weight_for_age_zscore)
#                 if weight_for_height_zscore is not None:
#                     frappe.db.set_value(child_doctype, row.name, "weight_for_height_zscore", weight_for_height_zscore)
#                 if height_for_age_zscore is not None:
#                     frappe.db.set_value(child_doctype, row.name, "height_for_age_zscore", height_for_age_zscore)

#                 if row.dob_when_measurement_taken is not None:
#                     dob_date = row.dob_when_measurement_taken
#                     if isinstance(dob_date, datetime):
#                         dob_date = dob_date.date()
#                     frappe.db.set_value(child_doctype, row.name, "dob_when_measurement_taken", dob_date)
                
#                 frappe.db.set_value(child_doctype, row.name, "flag", 1)
#                 frappe.db.commit()

#             except Exception as e:
#                 frappe.log_error(f"Error processing row {row.name if row else 'unknown'}: {str(e)}")
#                 continue

# # --- Helper functions ---
# def get_wfh_data_for_age(data_dict, height, age_type):
#     if height in data_dict:
#         for record in data_dict[height]:
#             if str(record.get('age_type')).strip() in [age_type, f"{age_type}.0"]:
#                 return record
#     return None

# def get_weight_for_age_boys_table():
#     fields = ["age_in_days", "l", "m", "s", "sd3neg", "sd2neg", "sd2"]
#     records = frappe.get_all("Weight for age Boys", fields=fields)
#     return {row["age_in_days"]: row for row in records}

# def get_weight_for_age_girls_table():
#     fields = ["age_in_days", "l", "m", "s", "sd3neg", "sd2neg", "sd2"]
#     records = frappe.get_all("Weight for age Girls", fields=fields)
#     return {row["age_in_days"]: row for row in records}

# def get_weight_to_height_boys():
#     """Returns all weight-to-height data for boys, preserving duplicate lengths"""
#     fields = [
#         "age_type", "length", "green", "l", "m", "s",
#         "sd4neg", "sd3neg", "sd2neg", "sd1neg", "sd0",
#         "sd1", "sd2", "sd3", "sd4"
#     ]
    
#     try:
#         records = frappe.get_all("Weight to Height Boys",
#                               fields=fields,
#                               limit=0)  # Get all records
        
#         # Group by length while preserving all records
#         data = defaultdict(list)
#         for row in records:
#             data[row["length"]].append(row)
            
#         return dict(data)
        
#     except Exception as e:
#         frappe.log_error(f"Error loading boys data: {str(e)}")
#         return {}

# def get_weight_to_height_girls():
#     """Returns all weight-to-height data for girls, preserving duplicate lengths"""
#     fields = [
#         "age_type", "length", "green", "l", "m", "s",
#         "sd4neg", "sd3neg", "sd2neg", "sd1neg", "sd0",
#         "sd1", "sd2", "sd3", "sd4"
#     ]
    
#     try:
#         records = frappe.get_all("Weight to Height Girls",
#                               fields=fields,
#                               limit=0)  # Get all records
        
#         # Group by length while preserving all records
#         data = defaultdict(list)
#         for row in records:
#             data[row["length"]].append(row)
            
#         return dict(data)
        
#     except Exception as e:
#         frappe.log_error(f"Error loading girls data: {str(e)}")
#         return {}

# def get_height_for_age_boys():
#     fields = ["age_in_days", "l", "m", "s", "sd3neg", "sd2neg", "sd2"]
#     records = frappe.get_all("Height for age Boys", fields=fields)
#     return {row["age_in_days"]: row for row in records}

# def get_height_for_age_girls():
#     fields = ["age_in_days", "l", "m", "s", "sd3neg", "sd2neg", "sd2"]
#     records = frappe.get_all("Height for age Girls", fields=fields)
#     return {row["age_in_days"]: row for row in records}










# Last_backup(15-07-2025)
# from __future__ import unicode_literals
# import frappe
# from frappe.utils import nowdate
# from frappe.model.document import Document
# import math
# from datetime import datetime, timedelta, date
# from dateutil.relativedelta import relativedelta
# from collections import defaultdict
# def calculate_z_score(value, M, L, S):
#     if L == 0:
#         raise ValueError("L should not be zero to avoid division errors.")
#     ratio = float(value / M)
#     ratio_to_L = float(math.pow(ratio, L))
#     numerator = float(ratio_to_L - 1)
#     denominator = float(S * L)
#     z_score = float(numerator / denominator)
#     if z_score <= -3:
#         sd3neg = float(M * math.pow(1 + L * S * (-3), 1 / L))
#         sd2neg = float(M * math.pow(1 + L * S * (-2), 1 / L))
#         sd23neg = float(sd2neg - sd3neg)
#         z_score = float(-3 + (value - sd3neg) / sd23neg)
#     elif z_score >= 3:
#         sd3pos = float(M * math.pow(1 + L * S * (3), 1 / L))
#         sd2pos = float(M * math.pow(1 + L * S * (2), 1 / L))
#         sd23pos = float(sd3pos - sd2pos)
#         z_score = float(3 + (value - sd3pos) / sd23pos)
#     return round(z_score, 2)


# @frappe.whitelist(allow_guest=True)
# def trigger_growth_status_update():
#     frappe.enqueue(
#         "frappe.val.z_score_status.update_growth_status_for_all_children",
#         queue='long',
#         timeout=1800
#     )
#     return "Update task has been enqueued"

# def update_growth_status_for_all_children():
#     cgm_list = frappe.get_all(
#         "Child Growth Monitoring",
#         filters={"docstatus": 0, "do_you_have_height_weight":1 , "flag" : 0 },
#         fields=["name"]
#     )

#     for cgm in cgm_list:
#         update_growth_status_for_child(cgm.name)

# # @frappe.whitelist(allow_guest=True)
# # def update_growth_status_for_all_children():
# #     # Get date range for last month
# #     today = date.today()
# #     first_day_of_current_month = today.replace(day=1)
# #     last_day_of_previous_month = first_day_of_current_month - timedelta(days=1)
# #     first_day_of_previous_month = last_day_of_previous_month.replace(day=1)

# #     cgm_list = frappe.get_all(
# #         "Child Growth Monitoring",
# #         filters={
# #             "docstatus": 0,
# #             "measurement_date": ["between", [first_day_of_previous_month, last_day_of_previous_month]]
# #         },
# #         fields=["name"]
# #     )
    
# #     for cgm in cgm_list:
# #         update_growth_status_for_child(cgm.name)

# def update_growth_status_for_child(cgm_name):
#     cgm = frappe.get_doc("Child Growth Monitoring", cgm_name)
#     weight_for_age_boys_data = get_weight_for_age_boys_table()
#     weight_for_age_girls_data = get_weight_for_age_girls_table()
#     weight_to_height_boys_data = get_weight_to_height_boys()
#     weight_to_height_girls_data = get_weight_to_height_girls()
#     height_for_age_boys_data = get_height_for_age_boys()
#     height_for_age_girls_data = get_height_for_age_girls()
#     if cgm.get("anthropromatic_details"):

#         for row in cgm.get("anthropromatic_details"):

#             # if not row.do_you_have_height_weight or row.flag == 1:
#             #     continue
#             age_months = row.age_months
#             guid = row.childenrollguid.strip()
#             gender_id = frappe.db.get_value("Child Enrollment and Exit",{"childenrollguid": guid},"gender_id")
#             weight = row.weight
#             height = row.height
#             measurement_equipment = row.measurement_equipment

#             weight_for_age_status = None
#             weight_for_height_status = None
#             height_for_age_status = None

#             # Calculating dob_when_measurement_taken
#             if row.measurement_taken_date and age_months:
#                 try:
#                     measurement_date = row.measurement_taken_date
#                     age_days = age_months  

#                     dob_date = measurement_date - timedelta(days=age_days)

#                     row.dob_when_measurement_taken = dob_date
#                 except Exception as e:
#                     frappe.msgprint(f"Error: {e}", "Error")
#                     row.dob_when_measurement_taken = None
#             else:
#                 row.dob_when_measurement_taken = None

            
#           # weight for age
#             if age_months is not None and weight is not None and weight > 0 and gender_id in ('1', '2'):
#                 try:
#                     age_in_days = int(age_months)
#                     weight = float(weight)
#                     growth_data = weight_for_age_boys_data.get(age_in_days) if gender_id == '1' else weight_for_age_girls_data.get(age_in_days)
#                     if growth_data:
#                         try:
#                             sd3neg = float(growth_data.get("sd3neg", 0))
#                             sd2neg = float(growth_data.get("sd2neg", 0))
#                             sd2 = float(growth_data.get("sd2", 0))
#                             if weight < sd3neg:
#                                 weight_for_age_status = 1
#                             elif weight >= sd3neg and weight < sd2neg:
#                                 weight_for_age_status = 2
#                             elif weight >= sd2neg and weight <= sd2:
#                                 weight_for_age_status = 3
#                             elif weight > sd2:
#                                 weight_for_age_status = 4
#                         except (ValueError, TypeError):
#                             pass
#                 except (ValueError, TypeError):
#                     pass
#             # weight for height

#             if height is not None and weight is not None and weight > 0 and height > 0 and gender_id in ('1', '2'):
#               try:
#                   height_rounded = round(height,1) # Round Removed
#                   weight = float(weight)
#                   age_in_days = int(age_months)
                  
#                   age_type_0_boys = {
#                       height: next(
#                           (record for record in records if str(record.get('age_type')).strip() in ['0', '0.0']),
#                           None
#                       )
#                       for height, records in weight_to_height_boys_data.items()
#                   }

#                   age_type_24_boys = {
#                       height: next(
#                           (record for record in records if str(record.get('age_type')).strip() in ['24', '24.0']),
#                           None
#                       )
#                       for height, records in weight_to_height_boys_data.items()
#                   }

#                   age_type_0_girls = {
#                       height: next(
#                           (record for record in records if str(record.get('age_type')).strip() in ['0', '0.0']),
#                           None
#                       )
#                       for height, records in weight_to_height_girls_data.items()
#                   }

#                   age_type_24_girls = {
#                       height: next(
#                           (record for record in records if str(record.get('age_type')).strip() in ['24', '24.0']),
#                           None
#                       )
#                       for height, records in weight_to_height_girls_data.items()
#                   }


#                   wfh_growth_data = None
#                   if age_in_days <= 730:
#                       if measurement_equipment == 'Stadiometer':
#                           height_rounded = round(height_rounded + 0.7,1)

#                   if age_in_days > 730:
#                       if measurement_equipment == 'Infantometer':
#                           height_rounded = round(height_rounded - 0.7,1)

#                   if age_in_days <= 730:
#                       if gender_id == '1':
#                           wfh_growth_data = age_type_0_boys.get(height_rounded)
#                       else:
#                           wfh_growth_data = age_type_0_girls.get(height_rounded)

#                   if age_in_days > 730:
#                       if gender_id == '1':
#                           wfh_growth_data = age_type_24_boys.get(height_rounded)
#                       else:
#                           wfh_growth_data = age_type_24_girls.get(height_rounded)


#                   if wfh_growth_data:
#                       try:
#                           L = float(wfh_growth_data.get("l", 0))
#                           M = float(wfh_growth_data.get("m", 0))
#                           S = float(wfh_growth_data.get("s", 0))
#                           z_score = calculate_z_score(weight, M, L, S)
                          
#                           sd3neg = float(wfh_growth_data.get("sd3neg", 0))
#                           sd2neg = float(wfh_growth_data.get("sd2neg", 0))
#                           sd2 = float(wfh_growth_data.get("sd2", 0))

#                           if weight < sd3neg:
#                             weight_for_height_status = 1
#                           elif weight >= sd3neg and weight < sd2neg:
#                             weight_for_height_status = 2
#                           elif weight >= sd2neg and weight <= sd2:
#                             weight_for_height_status = 3
#                           elif weight > sd2:
#                             weight_for_height_status = 4
                          
#                       except (ValueError, TypeError):
#                           pass
#               except (ValueError, TypeError):
#                   pass

#           # height for age
#             if age_months is not None and height is not None and height > 0 and gender_id in ('1', '2'):
#                 try:
#                     age_in_days = int(age_months)
#                     height = float(height)
#                     if measurement_equipment and row.measurement_taken_date:
#                         measurement_date = row.measurement_taken_date
#                         if isinstance(measurement_date, str):
#                             measurement_date = datetime.strptime(measurement_date, "%Y-%m-%d").date()
#                         two_years_ago = measurement_date - relativedelta(months=24)
#                         dob = measurement_date - timedelta(days=age_in_days)
#                         if dob > two_years_ago:
#                             if measurement_equipment == '1':
#                                 height += 0.7
#                         else:
#                             if measurement_equipment == '2':
#                                 height -= 0.7
#                     growth_data = height_for_age_boys_data.get(age_in_days) if gender_id == '1' else height_for_age_girls_data.get(age_in_days)
#                     if growth_data:
#                         try:
#                             sd3neg = float(growth_data.get("sd3neg", 0))
#                             sd2neg = float(growth_data.get("sd2neg", 0))
#                             sd2 = float(growth_data.get("sd2", 0))
#                             if height < sd3neg:
#                                 height_for_age_status = 1
#                             elif height >= sd3neg and height < sd2neg:
#                                 height_for_age_status = 2
#                             elif height >= sd2neg and height <= sd2:
#                                 height_for_age_status = 3
#                             else:
#                                 height_for_age_status = 4
#                         except (ValueError, TypeError):
#                             pass
#                 except (ValueError, TypeError):
#                     pass

#             child_doctype = "Anthropromatic Data"
                        
#             if weight_for_age_status is not None:
#                 frappe.db.set_value(child_doctype, row.name, "weight_for_age", weight_for_age_status)
#             if weight_for_height_status is not None:
#                 frappe.db.set_value(child_doctype, row.name, "weight_for_height", weight_for_height_status)
#             if height_for_age_status is not None:
#                 frappe.db.set_value(child_doctype, row.name, "height_for_age", height_for_age_status)

#             if row.dob_when_measurement_taken is not None:
#                 dob_date = row.dob_when_measurement_taken
#                 if isinstance(dob_date, datetime):
#                     dob_date = dob_date.date()
#                 frappe.db.set_value(child_doctype, row.name, "dob_when_measurement_taken", dob_date)
            
#             frappe.db.set_value(child_doctype, row.name, "flag", 1)
#             frappe.db.commit()

# # --- Helper functions unchanged ---
# def get_wfh_data_for_age(data_dict, height, age_type):
#     if height in data_dict:
#         for record in data_dict[height]:
#             if str(record.get('age_type')).strip() in [age_type, f"{age_type}.0"]:
#                 return record
#     return None

# def get_weight_for_age_boys_table():
#     fields = ["age_in_days", "l", "m", "s", "sd3neg", "sd2neg", "sd2"]
#     records = frappe.get_all("Weight for age Boys", fields=fields)
#     return {row["age_in_days"]: row for row in records}

# def get_weight_for_age_girls_table():
#     fields = ["age_in_days", "l", "m", "s", "sd3neg", "sd2neg", "sd2"]
#     records = frappe.get_all("Weight for age Girls", fields=fields)
#     return {row["age_in_days"]: row for row in records}


# def get_weight_to_height_boys():
#     """Returns all weight-to-height data for boys, preserving duplicate lengths"""
#     fields = [
#         "age_type", "length", "green", "l", "m", "s",
#         "sd4neg", "sd3neg", "sd2neg", "sd1neg", "sd0",
#         "sd1", "sd2", "sd3", "sd4"
#     ]
    
#     try:
#         records = frappe.get_all("Weight to Height Boys",
#                               fields=fields,
#                               limit=0)  # Get all records
        
#         # Group by length while preserving all records
#         data = defaultdict(list)
#         for row in records:
#             data[row["length"]].append(row)
            
#         return dict(data)
        
#     except Exception as e:
#         frappe.log_error(f"Error loading boys data: {str(e)}")
#         return {}

# def get_weight_to_height_girls():
#     """Returns all weight-to-height data for girls, preserving duplicate lengths"""
#     fields = [
#         "age_type", "length", "green", "l", "m", "s",
#         "sd4neg", "sd3neg", "sd2neg", "sd1neg", "sd0",
#         "sd1", "sd2", "sd3", "sd4"
#     ]
    
#     try:
#         records = frappe.get_all("Weight to Height Girls",
#                               fields=fields,
#                               limit=0)  # Get all records
        
#         # Group by length while preserving all records
#         data = defaultdict(list)
#         for row in records:
#             data[row["length"]].append(row)
            
#         return dict(data)
        
#     except Exception as e:
#         frappe.log_error(f"Error loading girls data: {str(e)}")
#         return {}

# def get_height_for_age_boys():
#     fields = ["age_in_days", "l", "m", "s", "sd3neg", "sd2neg", "sd2"]
#     records = frappe.get_all("Height for age Boys", fields=fields)
#     return {row["age_in_days"]: row for row in records}

# def get_height_for_age_girls():
#     fields = ["age_in_days", "l", "m", "s", "sd3neg", "sd2neg", "sd2"]
#     records = frappe.get_all("Height for age Girls", fields=fields)
#     return {row["age_in_days"]: row for row in records}



