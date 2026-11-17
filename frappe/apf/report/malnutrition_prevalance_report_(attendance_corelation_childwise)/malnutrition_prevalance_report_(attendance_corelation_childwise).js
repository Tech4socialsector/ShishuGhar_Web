// Copyright (c) 2026, Frappe Technologies and contributors
// For license information, please see license.txt

frappe.query_reports["Malnutrition Prevalance Report (Attendance Corelation Childwise)"] = {
    filters: [
        {
            fieldname: "year",
            label: __("Year"),
            fieldtype: "Select",
            options: (() => {
                const start_year = 2022;
                const current_year = new Date().getFullYear();
                return Array.from(
                    { length: current_year - start_year + 1 },
                    (_, i) => (start_year + i).toString()
                );
            })(),
            default: new Date().getFullYear().toString(),
            onchange: function () {
                frappe.query_report.refresh();
            }
        },
        {
            fieldname: "month",
            label: __("Month"),
            fieldtype: "Select",
            options: [
                { "value": "01", "label": "January" },
                { "value": "02", "label": "February" },
                { "value": "03", "label": "March" },
                { "value": "04", "label": "April" },
                { "value": "05", "label": "May" },
                { "value": "06", "label": "June" },
                { "value": "07", "label": "July" },
                { "value": "08", "label": "August" },
                { "value": "09", "label": "September" },
                { "value": "10", "label": "October" },
                { "value": "11", "label": "November" },
                { "value": "12", "label": "December" }
            ],
            default: frappe.datetime.get_today().split('-')[1],
        },
        {
            fieldname: "partner",
            label: __("Partner"),
            fieldtype: "Link",
            options: "Partner",
        },
        {
            fieldname: "state",
            label: __("State"),
            fieldtype: "Link",
            options: "State",
            get_query: function () {
                return {
                    filters: {
                        "is_active": 1
                    }
                };
            },
            on_change: function () {
                frappe.query_report.set_filter_value("district", "");
                frappe.query_report.set_filter_value("block", "");
                frappe.query_report.set_filter_value("gp", "");
                frappe.query_report.set_filter_value("creche", "");
                frappe.query_report.set_filter_value("supervisor_id", "");
                frappe.query_report.refresh();
            }
        },
        {
            fieldname: "district",
            label: __("District"),
            fieldtype: "Link",
            options: "District",
            get_query: function () {
                let state = frappe.query_report.get_filter_value("state");
                return state ? { filters: { state_id: state } } : {};
            },
            on_change: function () {
                frappe.query_report.set_filter_value("block", "");
                frappe.query_report.set_filter_value("gp", "");
                frappe.query_report.set_filter_value("creche", "");
                frappe.query_report.set_filter_value("supervisor_id", "");
                frappe.query_report.refresh();
            }
        },
        {
            fieldname: "block",
            label: __("Block"),
            fieldtype: "Link",
            options: "Block",
            get_query: function () {
                let district = frappe.query_report.get_filter_value("district");
                return district ? { filters: { district_id: district } } : {};
            },
            on_change: function () {
                frappe.query_report.set_filter_value("gp", "");
                frappe.query_report.set_filter_value("creche", "");
                frappe.query_report.set_filter_value("supervisor_id", "");
                frappe.query_report.refresh();
            }
        },
        // {
        //  fieldname: "gp",
        //  label: __("Gram Panchayat"),
        //  fieldtype: "Link",
        //  options: "Gram Panchayat",
        //  get_query: function () {
        //      let block = frappe.query_report.get_filter_value("block");
        //      return block ? { filters: { block_id: block } } : {};
        //  },
        //  on_change: function () {
        //      frappe.query_report.set_filter_value("creche", "");
        //      frappe.query_report.set_filter_value("supervisor_id", "");
        //      frappe.query_report.refresh();
        //  }
        // },
        {
            "fieldname": "supervisor_id",
            "label": __("Supervisor"),
            "fieldtype": "Link",
            "options": "User",
            "get_query": function () {
                let creche = frappe.query_report.get_filter_value("creche");
                return creche ? { filters: { creche: creche } } : {};
            },
        },
        {
            fieldname: "creche",
            label: __("Creche"),
            fieldtype: "Link",
            options: "Creche",
        },
        {
            "fieldname": "phases",
            "label": __("Phase"),
            "fieldtype": "MultiSelect",
            "options": ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
            "reqd": 0,
            "default": ""
        },
        {
            fieldname: "indicator",
            label: __("Indicator"),
            fieldtype: "Select",
            options: [
                { value: "weight_for_age", label: __("Weight for Age (WFA)") },
                { value: "weight_for_height", label: __("Weight for Height (WFH)") },
                { value: "height_for_age", label: __("Height for Age (HFA)") }
            ],
            default: "weight_for_age",
            on_change() {
                frappe.query_report.refresh();
            }
        },
        {
            fieldname: "category",
            label: __("Category"),
            fieldtype: "Select",
            options: [
                { value: "all", label: __("All Categories") },
                { value: "Normal", label: __("Normal") },
                { value: "Moderate", label: __("Moderate") },
                { value: "Severe", label: __("Severe") }
            ],
            default: "all",
            on_change() {
                frappe.query_report.refresh();
            }
        },
        {
            "fieldname": "creche_status_id",
            "label": __("Creche Status"),
            "fieldtype": "Select",
            "options": [
                { "value": "", "label": __("") },
                { "value": "1", "label": __("Planned") },
                { "value": "2", "label": __("Plan dropped") },
                { "value": "3", "label": __("Active/Operational") },
                { "value": "4", "label": __("Closed") },
            ],
            "default": "3",
        },
        {
            fieldname: "duration",
            label: __("Duration"),
            fieldtype: "Select",
            options: [
            { value: "", label: __("") },
            { value: "3_months", label: __("3 Month") },
            { value: "6_months", label: __("6 Month") },
            { value: "12_months", label: __("12 Month") },
            ],
            onchange: function () {
            updateFilterDesc();
            }
        },
        {
            fieldname: "creche_age",
            label: __("Age of Creche"),
            fieldtype: "Select",
            options: [
                { value: "", label: __("") },
                { value: "0-6 Month", label: __("0-6 Month") },
                { value: "7-12 Month", label: __("7-12 Month") },
                { value: "13-18 Month", label: __("13-18 Month") },
                { value: "19-24 Month", label: __("19-24 Month") },
                { value: "24+ Month", label: __("24+ Month") }
            ],
            default: "",
            on_change: function () {
                frappe.query_report.refresh();
            }
        },
        {
            fieldname: "cr_opening_range_type",
            label: __("Creche Opening Date"),
            fieldtype: "Select",
            options: [
                { value: "", label: __("") },
                { value: "between", label: __("Between") },
                { value: "before", label: __("Before") },
                { value: "after", label: __("After") },
                { value: "equal", label: __("Equal") }
            ],
            default: "",
            on_change: function () {
                const dateRangeType = frappe.query_report.get_filter_value("cr_opening_range_type");

                const isBetween = dateRangeType === "between";
                const isSingleDate = ["before", "after", "equal"].includes(dateRangeType);
                const isCleared = dateRangeType === "";

                frappe.query_report.get_filter("c_opening_range").toggle(isBetween);
                frappe.query_report.get_filter("single_date").toggle(isSingleDate);

                if (isBetween) {
                    frappe.query_report.set_filter_value("single_date", "");
                } else if (isSingleDate) {
                    frappe.query_report.set_filter_value("c_opening_range", []);
                }

                if (isCleared) {
                    frappe.query_report.set_filter_value("c_opening_range", []);
                    frappe.query_report.set_filter_value("single_date", "");
                }

                frappe.query_report.refresh();
            }
        },
        {
            fieldname: "c_opening_range",
            label: __("Creche Opening Range"),
            fieldtype: "DateRange",
            hidden: 1
        },
        {
            fieldname: "single_date",
            label: __("Creche Opening Date"),
            fieldtype: "Date",
            hidden: 1
        }
    ],

    formatter: function (value, row, column, data, default_formatter) {
        // First format with default formatter
        value = default_formatter(value, row, column, data);

        // Check if this is one of our status columns
        const fieldname = column.fieldname;

        // Define our status field patterns and their corresponding color code fields
        const fieldPatterns = {
            'underweight_status_': 'weight_for_age_',
            'wasting_status_': 'weight_for_height_',
            'stuning_status_': 'height_for_age_'
        };

        // Find which pattern matches (if any)
        let matchedPattern = null;
        for (const pattern in fieldPatterns) {
            if (fieldname.startsWith(pattern)) {
                matchedPattern = pattern;
                break;
            }
        }

        if (matchedPattern) {
            // Extract the date part (e.g., "2025_01")
            const datePart = fieldname.replace(matchedPattern, '');
            const colorCodeField = fieldPatterns[matchedPattern] + datePart;

            // Get the color code (1=red, 2=yellow, 3=green)
            const colorCode = data[colorCodeField];

            if (colorCode) {
                let backgroundColor = '';
                let textColor = '#000000';
                let fontWeight = 'bold'; // All cases bold now

                switch (parseInt(colorCode)) {
                    case 1: // Red
                        backgroundColor = '#FFCCCB';
                        textColor = '#8B0000'; // Dark red
                        break;
                    case 2: // Yellow
                        backgroundColor = '#FFFACD';
                        textColor = '#CC9900'; // Dark yellow/gold
                        break;
                    case 3: // Green
                        backgroundColor = '#90EE90';
                        textColor = '#006400'; // Dark green
                        break;
                }

                if (backgroundColor) {
                    value = `<div style="background-color: ${backgroundColor}; 
                              color: ${textColor};
                              width: 100%; 
                              height: 100%; 
                              padding: 4px;
                              text-align: center;
                              border-radius: 3px;
                              font-weight: ${fontWeight};
                              display: flex;
                              align-items: center;
                              justify-content: center;">${value}</div>`;
                }
            }
        }

        // Hide the color code columns completely (but not the *_status_ display columns)
        if ((fieldname.startsWith('weight_for_age_') && !fieldname.startsWith('weight_for_age_status_')) ||
            (fieldname.startsWith('weight_for_height_') && !fieldname.startsWith('weight_for_height_status_')) ||
            (fieldname.startsWith('height_for_age_') && !fieldname.startsWith('height_for_age_status_'))) {
            return '';
        }

        return value;
    },

    // Added onload to append the custom Download Report and Logic buttons
    onload: function (report) {
        report.page.add_inner_button(__("Download Report"), function () {
            download_colored_excel();
        });
        report.page.add_inner_button(__("Logic"), function () {
            open_logic_dialog();
        });
    }
};

// Field -> logic reference shown by the Logic button. Mirrors get_columns() /
// get_summary_data() in the backend report.
const LOGIC_DATA_LIST = [
    { title: "Partner", logic: "Name of the partner organisation that the child's creche belongs to." },
    { title: "State", logic: "State of the child's creche." },
    { title: "District", logic: "District of the child's creche." },
    { title: "Block", logic: "Block of the child's creche." },
    { title: "Supervisor", logic: "Full name of the supervisor assigned to the child's creche." },
    { title: "Creche", logic: "Name of the creche in which the child is enrolled." },
    { title: "Creche Opening date", logic: "Date on which the creche was opened (dd-mm-yyyy)." },
    { title: "Creche ID", logic: "Unique ID of the creche." },
    { title: "Child Name", logic: "Name of the child as recorded in the Child Enrollment and Exit record." },
    { title: "Child ID", logic: "Unique ID of the child as recorded in the Child Enrollment and Exit record." },
    { title: "HH ID", logic: "Household ID of the household the child belongs to (linked through the Household Child Form)." },
    { title: "Date of Enrollment", logic: "Date on which the child was enrolled in the creche (dd-mm-yyyy)." },
    { title: "Age (in month)", logic: "Age of the child in months at the time of enrollment (age at enrollment, not the current age)." },
    { title: "Gender", logic: "M if gender is Male (1), F if gender is Female (2)." },
    { title: "Attendance-[Mon YYYY]", logic: "Attendance of the child in that month, shown as \"percentage (days present)\". Percentage = days the child was marked present / total attendance days recorded for the child in that month × 100, rounded to 2 decimals. Days on which the creche was closed are excluded." },
    { title: "Weight (kg)-[Mon YYYY]", logic: "Weight of the child measured in that month (growth monitoring), rounded to 2 decimals. Shows \"-\" if no measurement was taken in that month or the weight is 0. If more than one measurement exists in the month, the highest value is shown." },
    { title: "Height (cm)-[Mon YYYY]", logic: "Height of the child measured in that month (growth monitoring), rounded to 2 decimals. Shows \"-\" if no measurement was taken in that month or the height is 0. If more than one measurement exists in the month, the highest value is shown." },
    { title: "WFA Z-Score-[Mon YYYY]", logic: "Weight-for-Age Z-score recorded in that month, rounded to 2 decimals. Shown when Indicator = Weight for Age (WFA). Cell is coloured by the WFA Status of the same month (Severe = red, Moderate = yellow, Normal = green, Overweight = grey)." },
    { title: "WFA Status-[Mon YYYY]", logic: "Weight-for-Age (underweight) classification for that month: 1 = Severe, 2 = Moderate, 3 = Normal, 4 = Overweight. Shows \"-\" if no measurement was taken. Shown when Indicator = Weight for Age (WFA)." },
    { title: "HFA Z-Score-[Mon YYYY]", logic: "Height-for-Age Z-score recorded in that month, rounded to 2 decimals. Shown when Indicator = Height for Age (HFA). Cell is coloured by the HFA Status of the same month." },
    { title: "HFA Status-[Mon YYYY]", logic: "Height-for-Age (stunting) classification for that month: 1 = Severe, 2 = Moderate, 3 = Normal, 4 = Overweight. Shows \"-\" if no measurement was taken. Shown when Indicator = Height for Age (HFA)." },
    { title: "WFH Z-Score-[Mon YYYY]", logic: "Weight-for-Height Z-score recorded in that month, rounded to 2 decimals. Shown when Indicator = Weight for Height (WFH). Cell is coloured by the WFH Status of the same month." },
    { title: "WFH Status-[Mon YYYY]", logic: "Weight-for-Height (wasting) classification for that month: 1 = Severe, 2 = Moderate, 3 = Normal, 4 = Overweight. Shows \"-\" if no measurement was taken. Shown when Indicator = Weight for Height (WFH)." },
    { title: "Month Columns (Duration)", logic: "The report shows the selected Month and the months before it (3, 6 or 12 months based on the Duration filter; 12 months if Duration is not selected). Attendance, Weight, Height, Z-Score and Status columns are repeated for each month." },
    { title: "Children Included", logic: "Children enrolled on or before the selected month end and not exited before the selected month start, who have at least one anthropometric measurement. If a Category is selected, only measurements with that status for the selected Indicator are considered." }
];

function open_logic_dialog() {
    const rows_html = LOGIC_DATA_LIST.map(function (row, index) {
        const bg = index % 2 === 0 ? '#f9f9f9' : '#ffffff';
        return `
            <tr style="background-color: ${bg};">
                <td style="padding: 10px 12px; border: 1px solid #ddd; font-weight: 600; color: #333; white-space: normal;">${escape_html(row.title)}</td>
                <td style="padding: 10px 12px; border: 1px solid #ddd; color: #555; white-space: normal; line-height: 1.5;">${escape_html(row.logic)}</td>
            </tr>`;
    }).join('');

    const dialog = new frappe.ui.Dialog({
        title: __("Field Logic"),
        size: "extra-large",
        fields: [{ fieldtype: "HTML", fieldname: "logic_html" }]
    });

    const btn_style = "padding: 6px 12px; background-color: #5979aa; color: white; border: none; border-radius: 4px; cursor: pointer;";

    dialog.fields_dict.logic_html.$wrapper.html(`
        <div style="display: flex; flex-wrap: wrap; gap: 10px; justify-content: flex-end; margin-bottom: 12px;">
            <button type="button" class="logic-dl-xlsx" style="${btn_style}">${__("Download XLSX")}</button>
            <button type="button" class="logic-dl-png" style="${btn_style}">${__("Download PNG")}</button>
            <button type="button" class="logic-dl-pdf" style="${btn_style}">${__("Download PDF")}</button>
        </div>
        <div class="logic-capture" style="background: white;">
            <div class="logic-table-wrapper" style="overflow-y: auto; max-height: 60vh; border-radius: 8px; border: 1px solid #ddd; background: white; padding: 10px;">
                <table style="width: 100%; border-collapse: collapse; font-size: 14px; text-align: left;">
                    <thead style="position: sticky; top: -10px; background-color: #5979aa; color: white; z-index: 1;">
                        <tr>
                            <th style="padding: 12px; border: 1px solid #ccc; width: 30%;">${__("Field")}</th>
                            <th style="padding: 12px; border: 1px solid #ccc; width: 70%;">${__("Logic")}</th>
                        </tr>
                    </thead>
                    <tbody>${rows_html}</tbody>
                </table>
            </div>
        </div>
    `);

    const $body = dialog.fields_dict.logic_html.$wrapper;
    $body.find('.logic-dl-xlsx').on('click', function () {
        run_logic_download($(this), download_logic_xlsx);
    });
    $body.find('.logic-dl-png').on('click', function () {
        run_logic_download($(this), function () { return download_logic_image($body, 'png'); });
    });
    $body.find('.logic-dl-pdf').on('click', function () {
        run_logic_download($(this), function () { return download_logic_image($body, 'pdf'); });
    });

    dialog.show();
}

const LOGIC_EXPORT_LIBS = {
    XLSX: "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
    html2canvas: "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js",
    jspdf: "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"
};

function load_logic_lib(name) {
    const is_loaded = name === 'jspdf'
        ? (window.jspdf || window.jsPDF)
        : window[name];
    if (is_loaded) return Promise.resolve();
    return new Promise(function (resolve) {
        frappe.require(LOGIC_EXPORT_LIBS[name], resolve);
    });
}

// Disables the clicked button while the export runs, then restores it.
function run_logic_download($btn, task) {
    const original_text = $btn.text();
    $btn.text(__("Downloading...")).prop('disabled', true).css({ opacity: 0.6, cursor: 'not-allowed' });

    Promise.resolve()
        .then(task)
        .catch(function (err) {
            console.error("Error generating Logic download", err);
            frappe.msgprint(__("Error generating download."));
        })
        .finally(function () {
            $btn.text(original_text).prop('disabled', false).css({ opacity: 1, cursor: 'pointer' });
        });
}

function download_logic_xlsx() {
    return load_logic_lib('XLSX').then(function () {
        const rows = LOGIC_DATA_LIST.map(function (row) {
            return { "Field": row.title, "Logic": row.logic };
        });
        const worksheet = XLSX.utils.json_to_sheet(rows);
        worksheet['!cols'] = [{ wch: 35 }, { wch: 120 }];
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Field Logic");
        XLSX.writeFile(workbook, "malnutrition_prevalance_report_logic.xlsx");
    });
}

// Renders the full (un-scrolled) logic table to a canvas, then saves it as a
// PNG or a multi-page A4 PDF.
function download_logic_image($body, format) {
    const libs = format === 'pdf' ? ['html2canvas', 'jspdf'] : ['html2canvas'];

    return Promise.all(libs.map(load_logic_lib)).then(function () {
        const target = $body.find('.logic-capture')[0];
        const wrapper = $body.find('.logic-table-wrapper')[0];
        const orig_max_height = wrapper.style.maxHeight;
        const orig_overflow_y = wrapper.style.overflowY;

        wrapper.style.maxHeight = 'none';
        wrapper.style.overflowY = 'visible';

        const restore = function () {
            wrapper.style.maxHeight = orig_max_height;
            wrapper.style.overflowY = orig_overflow_y;
        };

        return html2canvas(target, { scale: 2, scrollY: -window.scrollY }).then(function (canvas) {
            restore();

            if (format === 'png') {
                return new Promise(function (resolve) {
                    canvas.toBlob(function (blob) {
                        const url = URL.createObjectURL(blob);
                        const link = document.createElement('a');
                        link.href = url;
                        link.download = "malnutrition_prevalance_report_logic.png";
                        link.click();
                        URL.revokeObjectURL(url);
                        resolve();
                    }, "image/png");
                });
            }

            const JsPDF = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
            const doc = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
            const page_w = doc.internal.pageSize.getWidth();
            const page_h = doc.internal.pageSize.getHeight();
            const scaled_h = page_w / (canvas.width / canvas.height);
            const px_per_mm = canvas.height / scaled_h;

            let y_offset = 0;
            while (y_offset < scaled_h) {
                const slice_h = Math.min(scaled_h - y_offset, page_h);
                const slice_canvas = document.createElement('canvas');
                slice_canvas.width = canvas.width;
                slice_canvas.height = Math.ceil(slice_h * px_per_mm);
                slice_canvas.getContext('2d').drawImage(
                    canvas, 0, y_offset * px_per_mm, canvas.width, slice_canvas.height,
                    0, 0, canvas.width, slice_canvas.height
                );

                if (y_offset > 0) doc.addPage();
                doc.addImage(slice_canvas.toDataURL('image/png'), 'PNG', 0, 0, page_w, slice_h);
                y_offset += slice_h;
            }

            doc.save("malnutrition_prevalance_report_logic.pdf");
        }).catch(function (err) {
            restore();
            throw err;
        });
    });
}

// Status text -> colors, mirrors the backend's format_cell() palette used for
// the WFA/HFA/WFH Status columns.
const STATUS_TEXT_COLORS = {
    'Severe': { bg: '#FFCCCC', text: '#CC0000' },
    'Moderate': { bg: '#FFFFCC', text: '#999900' },
    'Normal': { bg: '#CCFFCC', text: '#006600' },
    'Overweight': { bg: '#E6E6E6', text: '#666666' }
};

// Numeric color-code -> colors, mirrors the report's on-screen formatter()
// used for the Z-Score columns.
const ZSCORE_CODE_COLORS = {
    1: { bg: '#FFCCCB', text: '#8B0000' },
    2: { bg: '#FFFACD', text: '#CC9900' },
    3: { bg: '#90EE90', text: '#006400' }
};

const ZSCORE_FIELD_PATTERNS = {
    'underweight_status_': 'weight_for_age_',
    'wasting_status_': 'weight_for_height_',
    'stuning_status_': 'height_for_age_'
};

function get_cell_colors_for_export(fieldname, row_data) {
    // Status display columns (weight_for_age_status_, height_for_age_status_, weight_for_height_status_)
    if (fieldname.includes('_status_') &&
        (fieldname.startsWith('weight_for_age_status_') ||
         fieldname.startsWith('height_for_age_status_') ||
         fieldname.startsWith('weight_for_height_status_'))) {
        const status_value = row_data[fieldname];
        const plain_status = strip_html(status_value);
        if (STATUS_TEXT_COLORS[plain_status]) {
            return STATUS_TEXT_COLORS[plain_status];
        }
        return null;
    }

    // Z-Score columns (underweight_status_, wasting_status_, stuning_status_)
    for (const pattern in ZSCORE_FIELD_PATTERNS) {
        if (fieldname.startsWith(pattern)) {
            const datePart = fieldname.replace(pattern, '');
            const colorCodeField = ZSCORE_FIELD_PATTERNS[pattern] + datePart;
            const colorCode = parseInt(row_data[colorCodeField]);
            if (ZSCORE_CODE_COLORS[colorCode]) {
                return ZSCORE_CODE_COLORS[colorCode];
            }
            return null;
        }
    }

    return null;
}

function strip_html(value) {
    if (value === null || value === undefined) return '';
    const text = String(value);
    if (text.indexOf('<') === -1) return text.trim();
    const tmp = document.createElement('div');
    tmp.innerHTML = text;
    return (tmp.textContent || tmp.innerText || '').trim();
}

function escape_html(value) {
    return String(value === null || value === undefined ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// Builds an HTML table and downloads it with an .xls extension so Excel's
// HTML import renders the inline cell colors as real fill colors — this
// keeps the coloring entirely client-side with no backend export endpoint.
function download_colored_excel() {
    const columns = frappe.query_report.columns;
    const data = frappe.query_report.data;

    if (!columns || !data || !data.length) {
        frappe.msgprint(__("No data to export"));
        return;
    }

    // Hide raw color-code columns, same rule as the on-screen formatter.
    const visible_columns = columns.filter(function (column) {
        const fieldname = column.fieldname;
        const is_color_code_field =
            (fieldname.startsWith('weight_for_age_') && !fieldname.startsWith('weight_for_age_status_')) ||
            (fieldname.startsWith('weight_for_height_') && !fieldname.startsWith('weight_for_height_status_')) ||
            (fieldname.startsWith('height_for_age_') && !fieldname.startsWith('height_for_age_status_'));
        return !is_color_code_field;
    });

    let html = '<table border="1" cellspacing="0" cellpadding="4">';

    html += '<thead><tr>';
    visible_columns.forEach(function (column) {
        html += `<th style="background-color:#f0f0f0; font-weight:bold;">${escape_html(column.label)}</th>`;
    });
    html += '</tr></thead>';

    html += '<tbody>';
    data.forEach(function (row_data) {
        html += '<tr>';
        visible_columns.forEach(function (column) {
            const fieldname = column.fieldname;
            const raw_value = row_data[fieldname];
            const display_value = escape_html(strip_html(raw_value));
            const colors = get_cell_colors_for_export(fieldname, row_data);

            if (colors) {
                html += `<td style="background-color:${colors.bg}; color:${colors.text}; font-weight:bold; text-align:center;">${display_value}</td>`;
            } else {
                html += `<td>${display_value}</td>`;
            }
        });
        html += '</tr>';
    });
    html += '</tbody></table>';

    const table_html = `
        <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
        <head>
            <meta charset="utf-8">
            <!--[if gte mso 9]>
            <xml>
                <x:ExcelWorkbook>
                    <x:ExcelWorksheets>
                        <x:ExcelWorksheet>
                            <x:Name>Report</x:Name>
                            <x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
                        </x:ExcelWorksheet>
                    </x:ExcelWorksheets>
                </x:ExcelWorkbook>
            </xml>
            <![endif]-->
        </head>
        <body>${html}</body>
        </html>
    `;

    const blob = new Blob(['﻿' + table_html], { type: 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'Malnutrition Prevalance Report.xls';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}