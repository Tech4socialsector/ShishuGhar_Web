// Copyright (c) 2026, Frappe Technologies and contributors
// For license information, please see license.txt

frappe.query_reports["Enrollment Current Report"] = {
    "filters": [
        {
            fieldname: "date_input_type",
            label: __("Date Input Type"),
            fieldtype: "Select",
            options: [
                { value: "date_range", label: __("Date Range") },
                { value: "month_year", label: __("Month/Year") }
            ],
            default: "date_range",
            on_change: function () {
                const dateInputType = frappe.query_report.get_filter_value("date_input_type");

                if (dateInputType === "date_range") {
                    // Reset year & month
                    frappe.query_report.set_filter_value("year", "");
                    frappe.query_report.set_filter_value("month", "");
                    frappe.query_report.set_filter_value("time_range", [frappe.datetime.month_start(), frappe.datetime.month_end()]);

                    // Remove month/year filters dynamically
                    frappe.query_report.get_filter("year").toggle(false);
                    frappe.query_report.get_filter("month").toggle(false);
                    frappe.query_report.get_filter("time_range").toggle(true);
                } else if (dateInputType === "month_year") {
                    // Reset date range
                    frappe.query_report.set_filter_value("time_range", "");

                    // Set default year & month
                    frappe.query_report.set_filter_value("year", frappe.datetime.get_today().split('-')[0]);
                    frappe.query_report.set_filter_value("month", frappe.datetime.get_today().split('-')[1]);

                    // Remove date range filter dynamically
                    frappe.query_report.get_filter("time_range").toggle(false);
                    frappe.query_report.get_filter("year").toggle(true);
                    frappe.query_report.get_filter("month").toggle(true);
                }

                // Refresh the report for changes to take effect
                frappe.query_report.refresh();
            }
        },
        {
            fieldname: "time_range",
            label: __("Date Range"),
            fieldtype: "DateRange",
            default: [frappe.datetime.month_start(), frappe.datetime.month_end()],
            hidden: 0 // Initially visible
        },
        {
            fieldname: "year",
            label: __("Year"),
            fieldtype: "Select",
            options: ["2024", "2025","2026"],
            default: frappe.datetime.get_today().split('-')[0],
            hidden: 1 // Initially hidden
        },
        {
            fieldname: "month",
            label: __("Month"),
            fieldtype: "Select",
            options: [
                { value: "01", label: "January" },
                { value: "02", label: "February" },
                { value: "03", label: "March" },
                { value: "04", label: "April" },
                { value: "05", label: "May" },
                { value: "06", label: "June" },
                { value: "07", label: "July" },
                { value: "08", label: "August" },
                { value: "09", label: "September" },
                { value: "10", label: "October" },
                { value: "11", label: "November" },
                { value: "12", label: "December" }
            ],
            default: frappe.datetime.get_today().split('-')[1],
            hidden: 1 // Initially hidden
        },
        {
            "fieldname": "partner",
            "label": __("Partner"),
            "fieldtype": "Link",
            "options": "Partner",
            "default": frappe.defaults.get_user_default("partner"),
            "on_change": function () {
                frappe.query_report.refresh();
            }
        },
        {
            "fieldname": "state",
            "label": __("State"),
            "fieldtype": "Link",
            "options": "State",
            "get_query": function () {
                return {
                    filters: {
                        "is_active": 1
                    }
                };
            },
            "on_change": function () {
                frappe.query_report.refresh();
            }
        },
        {
            "fieldname": "district",
            "label": __("District"),
            "fieldtype": "Link",
            "options": "District",
            get_query: function () {
                let state = frappe.query_report.get_filter_value("state")
                return state ? { filters: { state_id: state } } : {};
            },
            "on_change": function () {
                frappe.query_report.set_filter_value("block", "");
                frappe.query_report.set_filter_value("gp", "");
                frappe.query_report.set_filter_value("creche", "");
                frappe.query_report.set_filter_value("supervisor_id", "");
                frappe.query_report.refresh();
            }
        },
        {
            "fieldname": "block",
            "label": __("Block"),
            "fieldtype": "Link",
            "options": "Block",
            "reqd": 0,
            "get_query": function () {
                let district_name = frappe.query_report.get_filter_value("district_name");
                return {
                    filters: {
                        district_id: district_name ? district_name : undefined
                    }
                };
            }
        },
        {
            "fieldname": "gp",
            "label": __("Gram Panchayat"),
            "fieldtype": "Link",
            "options": "Gram Panchayat",
            "reqd": 0,
            "get_query": function () {
                let block_name = frappe.query_report.get_filter_value("block_name");
                return {
                    filters: {
                        block_id: block_name ? block_name : undefined
                    }
                };
            }
        },
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
            "fieldname": "creche",
            "label": __("Creche"),
            "fieldtype": "Link",
            "options": "Creche",
            "reqd": 0
        },
        {
            "fieldname": "level",
            "label": __("Level"),
            "fieldtype": "Select",
            "options": [
                { "value": "", "label": __("Level") },
                { "value": "1", "label": __("Partner") },
                { "value": "2", "label": __("State") },
                { "value": "3", "label": __("District") },
                { "value": "4", "label": __("Block") },
                { "value": "5", "label": __("Supervisor") },
                { "value": "6", "label": __("GP") },
                { "value": "7", "label": __("Creche") },

            ],
            "default": "",
            "on_change": function () {
                frappe.query_report.refresh();
            }
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

    "formatter": function(value, row, column, data, default_formatter) {
        value = default_formatter(value, row, column, data);
        
        // Check if this is the total row
        if (data && (
            data.partner === "<b>Total</b>" ||
            data.state === "<b>Total</b>" ||
            data.district === "<b>Total</b>" ||
            data.block === "<b>Total</b>" ||
            data.supervisor === "<b>Total</b>" ||
            data.gp === "<b>Total</b>" ||
            data.creche === "<b>Total</b>"
        )) {
            // Apply black bold styling to all cells in total row
            value = `<span style="color: #000000; font-weight: bold;">${value}</span>`;
        }
        
        return value;
    },
    
    // If you want to add additional formatter for specific columns
    "get_datatable_options": function(options) {
        options.cellStyling = function(row, column, value, data) {
            // Style the total row
            if (data && (
                data.partner === "<b>Total</b>" ||
                data.state === "<b>Total</b>" ||
                data.district === "<b>Total</b>" ||
                data.block === "<b>Total</b>" ||
                data.supervisor === "<b>Total</b>" ||
                data.gp === "<b>Total</b>" ||
                data.creche === "<b>Total</b>"
            )) {
                return {
                    css: {
                        'font-weight': 'bold',
                        'color': '#000000'
                    }
                };
            }
            return {};
        };
        return options;
    },

    // Added onload to append the custom Download Report and Logic buttons
    "onload": function (report) {
        report.page.add_inner_button(__("Download Report"), function () {
            frappe.query_report.export_report("Excel");
        });

        // Logic button: same look as the one on the creche dashboard
        const logicBtn = report.page.add_inner_button(__("Logic"), function () {
            enrollment_current_report_logic.open();
        });
        if (logicBtn) {
            logicBtn.css({
                "background-color": "#5979aa",
                "color": "white",
                "border": "1px solid #5979aa",
                "border-radius": "4px",
                "font-weight": "500"
            });
        }
    }
};

// -------- Logic Features --------
// Every entry mirrors enrollment_current_report.py (build_query / apply_* / add_total_row).
const enrollment_current_report_logic = (function () {
    const sections = [
        {
            title: "1. Reporting Period",
            items: [
                {
                    title: "Start Date / End Date",
                    logic: "Taken from <b>Date Range</b> when Date Input Type = Date Range. When Date Input Type = Month/Year, start = 1st of the selected month and end = last day of that month. Every count below is evaluated against this start/end date."
                },
                {
                    title: "Eligible-age reference date",
                    logic: "Age of a child (6 and 36 months) is measured from the <b>End Date</b>. If the End Date falls in the <b>current month</b>, today's date is used instead, so current-month reports always use live ages."
                }
            ]
        },
        {
            title: "2. Which Creches Are Included",
            items: [
                {
                    title: "Base list",
                    logic: "All creches that have a State, District, Block, Gram Panchayat, Village, Supervisor and Partner. A creche missing any of these is left out."
                },
                {
                    title: "Opening date rule",
                    logic: "A creche is counted only if it has no opening date, or it opened <b>on or before the End Date</b>."
                },
                {
                    title: "Creche Status",
                    logic: "Filtered by the selected Creche Status (default: <b>Active/Operational</b>)."
                },
                {
                    title: "Partner",
                    logic: "Uses the Partner filter; if empty, the logged-in user's own Partner is applied."
                },
                {
                    title: "User geography access",
                    logic: "The logged-in user only sees creches in the States, Districts, Blocks and Gram Panchayats mapped to them (User Geography Mapping). A mapping level is ignored when the user picks that level explicitly in the filters (State, District, Block, GP)."
                },
                {
                    title: "State / District / Block / GP / Creche / Supervisor",
                    logic: "Exact match on the selected value."
                },
                {
                    title: "Phase",
                    logic: "Creche phase must be one of the selected phases (non-numeric values are ignored)."
                },
                {
                    title: "Age of Creche",
                    logic: "Months between Creche Opening Date and the End Date, grouped as 0-6, 7-12, 13-18, 19-24 and 24+ months. Creches with no opening date are excluded when this filter is used."
                },
                {
                    title: "Creche Opening Date",
                    logic: "<b>Between</b>: opening date in the chosen range. <b>Before</b>: from 01-01-2017 up to the day before the chosen date. <b>After</b>: from the day after the chosen date up to today. <b>Equal</b>: exactly the chosen date."
                }
            ]
        },
        {
            title: "3. Level (Grouping)",
            items: [
                {
                    title: "Level filter",
                    logic: "Rows are grouped by the selected level and all counts are summed within each group: 1 = Partner, 2 = State, 3 = State + District, 4 = + Block, 5 = + Supervisor, 6 = + Gram Panchayat, 7 (default) = one row per Creche (shows Creche, Creche ID and Opening Date)."
                }
            ]
        },
        {
            title: "4. Report Columns",
            items: [
                {
                    title: "Operational Creches",
                    logic: "Number of creches in the row (count of creches that passed the rules in sections 2 and 3)."
                },
                {
                    title: "Total No of Children (HH List)",
                    logic: "Number of children in the Household Forms of the creche whose <b>date of birth is available</b>. Not limited by date."
                },
                {
                    title: "No of Pregnant Women",
                    logic: "Sum of <i>No. of Pregnant Women</i> from the Household Form, added once for every household child (with DOB available) of that creche."
                },
                {
                    title: "(0-6) Months",
                    logic: "Household children with DOB available, <b>no child status</b>, and born <b>less than 6 months</b> before the End Date."
                },
                {
                    title: "Current Eligible Children (6-36)",
                    logic: "Household children with DOB available, <b>no child status</b>, and aged between <b>6 and 36 months</b> on the reference date (see section 1)."
                },
                {
                    title: "Enrolled Children",
                    logic: "Enrollment records with Date of Enrollment <b>on or before End Date</b> and either no exit or Date of Exit <b>on or after Start Date</b> (children enrolled at any time during the period)."
                },
                {
                    title: "Enrolled (%)",
                    logic: "Enrolled Children / Current Eligible Children × 100, shown with 2 decimals. Shows 0% when Eligible Children is 0."
                },
                {
                    title: "Current Enrolled Children",
                    logic: "Enrollment records with Date of Enrollment <b>on or before End Date</b> and either no exit or Date of Exit <b>after End Date</b> (still enrolled at the end of the period)."
                },
                {
                    title: "Active (%)",
                    logic: "Current Enrolled Children / Current Eligible Children × 100, shown with 2 decimals. Shows 0% when Eligible Children is 0."
                },
                {
                    title: "Total Exit (This Month)",
                    logic: "Enrollment records whose Date of Exit falls between Start Date and End Date."
                },
                {
                    title: "Migrated / Graduated / Not Willing to Stay / Death / Other (This Month)",
                    logic: "Same exits as Total Exit, split by Reason for Exit: 1 = Migrated, 2 = Graduated, 3 = Not Willing to Stay, 4 = Death, 5 = Other."
                },
                {
                    title: "Not Enrolled (Migrated)",
                    logic: "Household children with DOB available, child status = <b>2 (Migrated)</b>, aged 6 to 36 months on the End Date."
                },
                {
                    title: "Not Enrolled (Death)",
                    logic: "Household children with DOB available, child status = <b>1 (Death)</b>, aged 6 to 36 months on the End Date."
                },
                {
                    title: "Not Enrolled (Out Side Catchment Area)",
                    logic: "Household children with DOB available, child status = <b>3 (Outside catchment area)</b>, aged 6 to 36 months on the End Date."
                },
                {
                    title: "Not Enrolled (Not willing to send)",
                    logic: "Household children with DOB available, child status = <b>4 (Not willing to send)</b>, aged 6 to 36 months on the End Date. Note: the source query only reads child statuses 1, 2 and 3."
                },
                {
                    title: "Total Not Enrolled",
                    logic: "Not Enrolled (Migrated) + Not Enrolled (Death) + Not Enrolled (Out Side Catchment Area) + children still waiting to be enrolled (eligible 6-36 month children with no status and no enrollment record). Not Willing to Send is not added."
                },
                {
                    title: "To Be Enrolled",
                    logic: "Current Eligible Children (6-36) <b>minus</b> Current Enrolled Children."
                },
                {
                    title: "New Enrollment (This Month)",
                    logic: "Enrollment records whose Date of Enrollment falls between Start Date and End Date."
                }
            ]
        },
        {
            title: "5. Total Row",
            items: [
                {
                    title: "Totals",
                    logic: "A <b>Total</b> row is added at the bottom. Count columns are the sum of all rows above."
                },
                {
                    title: "Percentages",
                    logic: "Recalculated from the summed values (Enrolled / Eligible and Current Enrolled / Eligible × 100), not averaged from rows. 0% when total Eligible Children is 0."
                },
                {
                    title: "Total Not Enrolled",
                    logic: "Recalculated as total Migrated + total Death + total Out Side Catchment + total To Be Enrolled."
                }
            ]
        }
    ];

    const esc = (s) => String(s).replace(/<[^>]*>/g, "");
    let dialog = null;

    function build_html() {
        let html = `<div style="max-height: 65vh; overflow-y: auto; padding-right: 4px;">`;
        sections.forEach((section) => {
            html += `
                <h5 style="color: #5979aa; margin: 18px 0 8px; font-weight: 600;">${section.title}</h5>
                <table style="width: 100%; border-collapse: collapse; font-size: 13px; text-align: left;">
                    <thead style="background-color: #5979aa; color: white;">
                        <tr>
                            <th style="padding: 8px 10px; border: 1px solid #ccc; width: 30%;">${__("Item")}</th>
                            <th style="padding: 8px 10px; border: 1px solid #ccc; width: 70%;">${__("Logic")}</th>
                        </tr>
                    </thead>
                    <tbody>`;
            section.items.forEach((row, index) => {
                const bg = index % 2 === 0 ? "#f9f9f9" : "#ffffff";
                html += `
                        <tr style="background-color: ${bg};">
                            <td style="padding: 8px 10px; border: 1px solid #ddd; font-weight: 600; color: #333;">${row.title}</td>
                            <td style="padding: 8px 10px; border: 1px solid #ddd; color: #555; line-height: 1.5;">${row.logic}</td>
                        </tr>`;
            });
            html += `</tbody></table>`;
        });
        return html + `</div>`;
    }

    function download_csv() {
        const rows = [[__("Section"), __("Item"), __("Logic")]];
        sections.forEach((section) => {
            section.items.forEach((row) => {
                rows.push([esc(section.title), esc(row.title), esc(row.logic)]);
            });
        });
        frappe.tools.downloadify(rows, null, "enrollment_current_report_logic");
    }

    function open() {
        if (!dialog) {
            dialog = new frappe.ui.Dialog({
                title: __("Enrollment Current Report Logic"),
                size: "extra-large",
                fields: [{ fieldtype: "HTML", fieldname: "logic_html" }],
                primary_action_label: __("Download CSV"),
                primary_action: download_csv
            });
            dialog.fields_dict.logic_html.$wrapper.html(build_html());
        }
        dialog.show();
    }

    return { open: open };
})();