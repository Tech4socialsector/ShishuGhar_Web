// Copyright (c) 2026, Frappe Technologies and contributors
// For license information, please see license.txt

frappe.query_reports["Population"] = {
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
            onchange: function () {
                frappe.query_report.refresh();
            }
        },
        {
            fieldname: "partner",
            label: __("Partner"),
            fieldtype: "Link",
            options: "Partner",
            onchange: function () {
                frappe.query_report.refresh();
            }
        },
        {
            fieldname: "state",
            label: __("State"),
            fieldtype: "Link",
            options: "State",
            get_query: function () {
                return {
                    filters: { "is_active": 1 }
                };
            },
            onchange: function () {
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
            onchange: function () {
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
            onchange: function () {
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
            onchange: function () {
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
            onchange: function () {
                frappe.query_report.refresh();
            }
        },
        {
            fieldname: "creche",
            label: __("Creche"),
            fieldtype: "Link",
            options: "Creche",
            onchange: function () {
                frappe.query_report.refresh();
            }
        },
        {
            fieldname: "phases",
            label: __("Phase"),
            fieldtype: "MultiSelect",
            options: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
            reqd: 0,
            default: "",
            onchange: function () {
                frappe.query_report.refresh();
            }
        },
        {
            fieldname: "creche_status_id",
            label: __("Creche Status"),
            fieldtype: "Select",
            options: [
                { "value": "", "label": __("") },
                { "value": "1", "label": __("Planned") },
                { "value": "2", "label": __("Plan dropped") },
                { "value": "3", "label": __("Active/Operational") },
                { "value": "4", "label": __("Closed") },
            ],
            default: "3",
            onchange: function () {
                frappe.query_report.refresh();
            }
        }
    ],

    // Added onload to append the custom Logic button
    "onload": function (report) {
        // Logic button: same look as the one on the creche dashboard
        const logicBtn = report.page.add_inner_button(__("Logic"), function () {
            population_logic.open();
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
// Every entry mirrors population.py (get_columns / get_summary_data).
const population_logic = (function () {
    const sections = [
        {
            title: "1. Which Creches Are Included",
            items: [
                {
                    title: "Base list",
                    logic: "The report starts from the <b>Creche</b> list: one row per creche. State, Partner, District, Block, Gram Panchayat, Village and Supervisor names are shown when available; a creche that is missing any of these is still listed with that cell blank."
                },
                {
                    title: "Partner / State / District / Block / Gram Panchayat",
                    logic: "Exact match on the selected value of the creche."
                },
                {
                    title: "Creche",
                    logic: "Exact match on the selected Creche."
                },
                {
                    title: "Supervisor",
                    logic: "Exact match on the Supervisor assigned to the creche."
                },
                {
                    title: "Creche Status",
                    logic: "Exact match on the selected Creche Status (default: <b>Active/Operational</b>). Clear it to include every status."
                },
                {
                    title: "Phase",
                    logic: "Creche phase must be one of the selected phases (comma separated values of the Phase filter)."
                },
                {
                    title: "Month",
                    logic: "The Month filter does not change the data. Population is stored per quarter, so only the <b>Year</b> is used."
                }
            ]
        },
        {
            title: "2. Year",
            items: [
                {
                    title: "Year filter",
                    logic: "The selected Year (default: current year) is converted to the internal Year ID used by Demographic Details: 2020 = 1, 2021 = 2, 2022 = 3, 2023 = 4, 2024 = 5, 2025 = 6, 2026 = 7, 2027 = 8. Any other year matches nothing, so all population columns show 0."
                }
            ]
        },
        {
            title: "3. Report Columns",
            items: [
                {
                    title: "State / Partner / District / Block / Gram Panchayat / Village",
                    logic: "Names taken from the creche's State, Partner, District, Block, Gram Panchayat and Village."
                },
                {
                    title: "Supervisor",
                    logic: "Full name of the user assigned as the creche's Supervisor."
                },
                {
                    title: "Creche Name",
                    logic: "Name of the creche."
                },
                {
                    title: "Population Q1 (Jan-Mar)",
                    logic: "Sum of <i>Population Q1</i> from the <b>Demographic Details</b> entries of the creche's <b>Village</b> for the selected Year. 0 when the village has no entry for that year."
                },
                {
                    title: "Population Q2 (April-June)",
                    logic: "Sum of <i>Population Q2</i> from the Demographic Details entries of the creche's Village for the selected Year. 0 when there is no entry."
                },
                {
                    title: "Population Q3 (July-Sept)",
                    logic: "Sum of <i>Population Q3</i> from the Demographic Details entries of the creche's Village for the selected Year. 0 when there is no entry."
                },
                {
                    title: "Population Q4 (Oct-Dec)",
                    logic: "Sum of <i>Population Q4</i> from the Demographic Details entries of the creche's Village for the selected Year. 0 when there is no entry."
                },
                {
                    title: "Village-level population",
                    logic: "Population is recorded per Village, not per creche. Creches in the same village therefore show the same population values."
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
        frappe.tools.downloadify(rows, null, "population_logic");
    }

    function open() {
        if (!dialog) {
            dialog = new frappe.ui.Dialog({
                title: __("Population Report Logic"),
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