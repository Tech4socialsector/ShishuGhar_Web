// Copyright (c) 2026, Frappe Technologies and contributors
// For license information, please see license.txt

frappe.query_reports["Stock Report"] = {
    filters: [
        {
            fieldname: "year",
            label: __("Year"),
            fieldtype: "Select",
            options: (() => {
                const start_year = 2020;
                const current_year = new Date().getFullYear();
                // Generating years from 2020 up to a few years in the future
                return Array.from(
                    { length: (current_year + 5) - start_year + 1 },
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
        {
            fieldname: "gp",
            label: __("Gram Panchayat"),
            fieldtype: "Link",
            options: "Gram Panchayat",
            get_query: function () {
                let block = frappe.query_report.get_filter_value("block");
                return block ? { filters: { block_id: block } } : {};
            },
            on_change: function () {
                frappe.query_report.set_filter_value("creche", "");
                frappe.query_report.set_filter_value("supervisor_id", "");
                frappe.query_report.refresh();
            }
        },
        {
            fieldname: "supervisor_id",
            label: __("Supervisor"),
            fieldtype: "Link",
            options: "User",
            get_query: function () {
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
            fieldname: "cr_opening_range_type",
            label: __("Creche Opening Date"),
            fieldtype: "Select",
            options: [
                { value: "",      label: __("") },
                { value: "between", label: __("Between") },
                { value: "before",  label: __("Before") },
                { value: "after",   label: __("After") },
                { value: "equal",   label: __("Equal") }
            ],
            default: "",
            on_change: function () {
                const val = frappe.query_report.get_filter_value("cr_opening_range_type");
                toggleDateFields(val);
                frappe.query_report.refresh();
            }
        },
        {
            fieldname: "c_opening_range",
            label: __("Creche Opening Range"),
            fieldtype: "DateRange",
            hidden: 1,
            default: []
        },
        {
            fieldname: "single_date",
            label: __("Creche Opening Date"),
            fieldtype: "Date",
            hidden: 1,
            default: ""
        }
    ],

    // ==========================================
    // CLIENT-SIDE EXCEL/CSV EXPORT BUTTON
    // ==========================================
    onload: function(report) {
        report.page.add_inner_button(__("Download Report"), function() {
            
            // Grab the raw data that Frappe has already successfully fetched for the UI
            let data = frappe.query_report.data; 
            
            if (!data || data.length === 0) {
                frappe.msgprint(__("No data found to export. Please adjust your filters."));
                return;
            }

            // Create flat headers for Excel, including Last Month fields
            let headers = [
                "Partner", "State", "District", "Block", "Gram Panchayat",
                "Creche ID", "Creche Name", "Item Name", 
                "Last Month Supplied", "Last Month Remaining", 
                "Required This Month", "Supplied This Month"
            ];
            
            let csv_rows = [];
            csv_rows.push(headers.join(",")); // Add headers to the first row

            // Loop through each creche row and unpack its hidden JSON items
            data.forEach(function(row) {
                let items = [];
                try {
                    if (row.items_json) {
                        items = JSON.parse(decodeURIComponent(row.items_json));
                    }
                } catch (e) {
                    console.error("Could not parse items for row", row);
                }

                if (items.length > 0) {
                    items.forEach(function(item) {
                        // Wrapping strings in quotes to prevent commas in names from breaking the CSV
                        let csv_row = [
                            `"${row.partner || ''}"`,
                            `"${row.state || ''}"`,
                            `"${row.district || ''}"`,
                            `"${row.block || ''}"`,
                            `"${row.gp || ''}"`,
                            `"${row.creche_id || ''}"`,
                            `"${row.creche_name || ''}"`,
                            `"${item.item || ''}"`,
                            item.last_month_supplied || 0,
                            item.last_month_remaining || 0,
                            item.required_this_month || 0,
                            item.supplied_this_month || 0
                        ];
                        csv_rows.push(csv_row.join(","));
                    });
                }
            });

            // Combine into a full file string
            let csv_content = csv_rows.join("\n");
            
            // Create a downloadable Blob (this guarantees no size limits or URL truncations)
            let blob = new Blob([csv_content], { type: 'text/csv;charset=utf-8;' });
            let url = URL.createObjectURL(blob);
            
            // Trigger instant download
            let link = document.createElement("a");
            link.setAttribute("href", url);
            link.setAttribute("download", "Detailed_Stock_Report.csv");
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

        }).addClass("btn-primary");

        // Logic button: explains how every field of the report is calculated
        report.page.add_inner_button(__("Logic"), function () {
            stock_report_logic.open();
        }).addClass("btn-primary");
    },

    // FORMATTER LOGIC: Clean UI Link, No Background
    formatter: function (value, rowCell, options, data) {
        if (options.fieldname === "view_items") {
            let safe_json = encodeURIComponent(data.items_json || '[]');
            let safe_partner = encodeURIComponent(data.partner || 'Partner');
            
            return `<a href="#" class="text-primary font-weight-bold" style="text-decoration: underline;" 
                       onclick="show_partner_items('${safe_partner}', '${safe_json}'); return false;">
                       <i class="fa fa-list"></i> View Items
                    </a>`;
        }
        return value;
    }
};

// ==========================================
// LOGIC BUTTON
// ==========================================
// Every entry mirrors stock_report.py (get_columns / prepare_parameters / execute_main_query):
// keep both in sync when the rules change.
var stock_report_logic = (function () {
    const sections = [
        {
            title: "1. Which Rows Are Included",
            items: [
                {
                    title: "Rows in the report",
                    logic: "One row per <b>creche</b> that has a <b>Creche Requisition</b> for the selected Year and Month. Its items are the lines of that requisition, whether they have been supplied yet or not. A creche with no requisition for the month does not appear."
                },
                {
                    title: "Year / Month",
                    logic: "The reporting month (default: current month). A requisition line belongs to the month of its requisition (the Year and Month on the Creche Requisition), <b>not</b> to its Supply Date. <b>Last month</b> is the calendar month before it; for January it is December of the previous year."
                },
                {
                    title: "Partner",
                    logic: "Exact match on the creche's Partner. When left empty, the logged-in user's own Partner is used."
                },
                {
                    title: "State / District / Block / Gram Panchayat",
                    logic: "Exact match on the selected value. When a level is left empty and the logged-in user has geographies mapped (User Geography Mapping), only those geographies are included."
                },
                {
                    title: "Supervisor / Creche",
                    logic: "Exact match on the Supervisor assigned to the creche / on the selected Creche."
                },
                {
                    title: "Phase",
                    logic: "The creche's phase must be one of the selected phases."
                },
                {
                    title: "Creche Status",
                    logic: "Exact match on the selected Creche Status (default: <b>Active/Operational</b>). Clear it to include every status."
                },
                {
                    title: "Creche Opening Date",
                    logic: "<b>Between</b>: opened on or between the two dates. <b>Before</b>: opened before the chosen date (the date itself is excluded). <b>After</b>: opened after the chosen date (the date itself is excluded), up to today. <b>Equal</b>: opened on the chosen date."
                }
            ]
        },
        {
            title: "2. Creche Columns",
            items: [
                {
                    title: "Partner / State / District / Block / Gram Panchayat",
                    logic: "Names of the creche's Partner, State, District, Block and Gram Panchayat, taken from the Creche master."
                },
                {
                    title: "Creche ID",
                    logic: "The Creche ID (code) from the Creche master."
                },
                {
                    title: "Creche Name",
                    logic: "Name of the creche."
                },
                {
                    title: "Items",
                    logic: "<b>View Items</b> opens the item-wise table of that creche (section 3). The hidden <i>Items JSON</i> column only carries those item rows to the popup and to Download Report."
                }
            ]
        },
        {
            title: "3. Item Columns (View Items popup and Download Report)",
            items: [
                {
                    title: "Item Name",
                    logic: "Name of the Partner Stock item on the requisition line. One line per item for each creche. All four quantity columns below come from the <b>Requisition Child table</b>; if a creche has more than one requisition for the month, their lines are added together."
                },
                {
                    title: "Last Month Supplied",
                    logic: "<b>Sum of Quantity Supplied</b> over the creche's requisition lines for this item in <b>last month's</b> requisition. <b>0</b> when the item was not on last month's requisition."
                },
                {
                    title: "Last Month Remaining",
                    logic: "<b>Sum of Quantity Required</b> minus <b>Sum of Quantity Supplied</b>, over the creche's requisition lines for this item in <b>last month's</b> requisition: the part of last month's requirement that was not supplied. A negative value means more was supplied than required. <b>0</b> when the item was not on last month's requisition. Quantity Received is not used."
                },
                {
                    title: "Required This Month",
                    logic: "<b>Sum of Quantity Required</b> over the creche's requisition lines for this item in the <b>selected month's</b> requisition."
                },
                {
                    title: "Supplied This Month",
                    logic: "<b>Sum of Quantity Supplied</b> over the same requisition lines (the selected month's requisition). 0 for lines not supplied yet."
                }
            ]
        },
        {
            title: "4. Download Report",
            items: [
                {
                    title: "Download Report",
                    logic: "Downloads a CSV of the data currently shown: one line per creche and item with the geography columns, Creche ID, Creche Name, Item Name and the four item columns above."
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
                            <th style="padding: 8px 10px; border: 1px solid #ccc; width: 30%;">${__("Field")}</th>
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
        const rows = [[__("Section"), __("Field"), __("Logic")]];
        sections.forEach((section) => {
            section.items.forEach((row) => {
                rows.push([esc(section.title), esc(row.title), esc(row.logic)]);
            });
        });
        frappe.tools.downloadify(rows, null, "stock_report_logic");
    }

    function open() {
        if (!dialog) {
            dialog = new frappe.ui.Dialog({
                title: __("Stock Report Logic"),
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

// ==========================================
// POPUP DIALOG LOGIC
// ==========================================
window.show_partner_items = function(partner_name, items_json) {
    let decoded_partner = decodeURIComponent(partner_name);
    let items = JSON.parse(decodeURIComponent(items_json));
    
    let tbody_html = "";
    
    if(items.length > 0) {
        items.forEach(function(row) {
            tbody_html += `
                <tr>
                    <td class="font-weight-bold">${row.item}</td>
                    <td class="text-right">${row.last_month_supplied}</td>
                    <td class="text-right">${row.last_month_remaining}</td>
                    <td class="text-right">${row.required_this_month}</td>
                    <td class="text-right">${row.supplied_this_month}</td>
                </tr>
            `;
        });
    } else {
        tbody_html = `<tr><td colspan="5" class="text-center text-muted">No Items Found</td></tr>`;
    }

    let d = new frappe.ui.Dialog({
        title: __('Stock Details - {0}', [decoded_partner]),
        size: 'extra-large', // FIX: Changed from 'large' to make the box wider
        fields: [
            {
                fieldname: 'stock_table_html',
                fieldtype: 'HTML',
                options: `
                    <div style="overflow-x:auto;">
                        <table class="table table-bordered table-hover">
                            <thead class="bg-light">
                                <tr>
                                    <th>ITEM NAME</th>
                                    <th class="text-right">LAST MONTH SUPPLIED</th>
                                    <th class="text-right">LAST MONTH REMAINING</th>
                                    <th class="text-right">REQUIRED THIS MONTH</th>
                                    <th class="text-right">SUPPLIED THIS MONTH</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${tbody_html}
                            </tbody>
                        </table>
                    </div>
                `
            }
        ],
        primary_action_label: __('Close'),
        primary_action: function() { d.hide(); }
    });
    d.show();
};

function syncCrecheAgeToDateFilter() {
    const ageRange = frappe.query_report.get_filter_value("creche_age");
    if (!ageRange) {
        frappe.query_report.set_filter_value("cr_opening_range_type", "");
        frappe.query_report.set_filter_value("c_opening_range", []);
        frappe.query_report.set_filter_value("single_date", "");
        toggleDateFields("");
        return;
    }

    const endDate = getEndOfReportMonth();   

    const rangeMap = {
        "0-6 Month":   { min: 0,  max: 6  },
        "7-12 Month":  { min: 7,  max: 12 },
        "13-18 Month": { min: 13, max: 18 },
        "19-24 Month": { min: 19, max: 24 },
        "24+ Month":   { min: 25, max: null }  
    };

    const range = rangeMap[ageRange];
    if (!range) return;

    let fromDate, toDate;

    if (range.max === null) {
        fromDate = null;
        toDate   = subtractMonths(endDate, 24);
        frappe.query_report.set_filter_value("cr_opening_range_type", "before");
        frappe.query_report.set_filter_value("single_date", toDate);
        frappe.query_report.set_filter_value("c_opening_range", []);
    } else {
        fromDate = subtractMonths(endDate, range.max);
        toDate   = subtractMonths(endDate, range.min);
        frappe.query_report.set_filter_value("cr_opening_range_type", "between");
        frappe.query_report.set_filter_value("c_opening_range", [fromDate, toDate]);
        frappe.query_report.set_filter_value("single_date", "");
    }

    toggleDateFields(frappe.query_report.get_filter_value("cr_opening_range_type"));
}

function getEndOfReportMonth() {
    let year  = parseInt(frappe.query_report.get_filter_value("year"))  || new Date().getFullYear();
    let month = parseInt(frappe.query_report.get_filter_value("month")) || (new Date().getMonth() + 1);
    return new Date(year, month, 0);
}

function subtractMonths(baseDate, months) {
    let d = new Date(baseDate);
    d.setMonth(d.getMonth() - months);
    return d.toISOString().split("T")[0];   
}

function toggleDateFields(type) {
    const showRange  = type === "between";
    const showSingle = ["before", "after", "equal"].includes(type);

    frappe.query_report.get_filter("c_opening_range").toggle(showRange);
    frappe.query_report.get_filter("single_date").toggle(showSingle);

    if (showRange)  frappe.query_report.set_filter_value("single_date", "");
    if (showSingle) frappe.query_report.set_filter_value("c_opening_range", []);
}