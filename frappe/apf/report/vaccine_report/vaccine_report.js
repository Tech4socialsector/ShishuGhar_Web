// Copyright (c) 2026, Frappe Technologies and contributors
// For license information, please see license.txt

frappe.query_reports["Vaccine Report"] = {
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
				{ "value": "8", "label": __("Child") },
			],
			"default": "8",
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
            "fieldname": "safety_indicators",
            "label": __("Safety indicators"),
            "fieldtype": "Select",
            "options": [
                { "value": "0", "label": __("All") },
                { "value": "1", "label": __("IPV") },
                { "value": "2", "label": __("Vitamin A") },
                { "value": "3", "label": __("PCV Booster") },
                { "value": "4", "label": __("PCV") },
                { "value": "5", "label": __("JE") },
                { "value": "6", "label": __("Albendazole") },
                { "value": "7", "label": __("Rota") },
                { "value": "8", "label": __("DPT Booster") },
                { "value": "9", "label": __("Pentavalent") },
                { "value": "10", "label": __("Measles") },
                { "value": "11", "label": __("OPV Booster") },
                { "value": "12", "label": __("BCG") },
                { "value": "13", "label": __("Hepatitis") }
            ],
            "default": "1",
        },
        // Age of Creche Filter
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
                syncCrecheAgeWithOpeningDate();
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
                toggleDateFields(dateRangeType);
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

    // Added onload to append the custom Download Report button
    onload: function (report) {
        report.page.add_inner_button(__("Download Report"), function () {
            frappe.query_report.export_report("Excel");
        });

        report.page.add_inner_button(__("Logic"), function () {
            show_report_logic_dialog();
        });

        inject_vaccine_count_styles();

        // Delegate clicks on the clickable count links rendered in the report.
        // Bind once per report load on the report's wrapper.
        const $wrapper = report.page.main || $(report.wrapper);
        $wrapper.off("click.vaccineCount").on(
            "click.vaccineCount",
            "a.vaccine-count-link",
            function (e) {
                e.preventDefault();
                e.stopPropagation();
                let ctx;
                try {
                    ctx = JSON.parse($(this).attr("data-ctx"));
                } catch (err) {
                    frappe.msgprint(__("Unable to read count details."));
                    return;
                }
                show_count_details_dialog(ctx);
            }
        );
    }
};

// Clickable counts look like plain text; underline + pointer only on hover.
function inject_vaccine_count_styles() {
    if (document.getElementById("vaccine-count-link-style")) return;
    const style = document.createElement("style");
    style.id = "vaccine-count-link-style";
    style.textContent = `
        a.vaccine-count-link { color: inherit !important; text-decoration: none !important; cursor: pointer; }
        a.vaccine-count-link:hover { text-decoration: underline !important; }
        .vaccine-details-wrap { width: 100%; }
        .vaccine-details-wrap table { margin-bottom: 0; white-space: nowrap; border-collapse: separate; border-spacing: 0; }
        .vaccine-details-scroll { max-height: 60vh; overflow: auto; }
        /* Freeze the header row while scrolling. */
        .vaccine-details-scroll thead th {
            position: sticky;
            top: 0;
            z-index: 2;
            background: #f5f5f5;
            box-shadow: inset 0 -1px 0 #ddd, inset 0 1px 0 #ddd;
        }
        /* Report Logic dialog */
        .vaccine-logic-wrap { width: 100%; }
        .vaccine-logic-scroll { max-height: 65vh; overflow: auto; }
        .vaccine-logic-table { margin-bottom: 0; border-collapse: separate; border-spacing: 0; }
        .vaccine-logic-table thead th {
            position: sticky;
            top: 0;
            z-index: 2;
            background: #5b7398;
            color: #fff;
            border-color: #5b7398;
        }
        .vaccine-logic-table .logic-section-row td {
            background: #eef1f6;
            font-weight: 600;
            color: #5b7398;
        }
        .vaccine-logic-table .logic-title-cell {
            font-weight: 600;
            vertical-align: top;
            white-space: normal;
        }
        .vaccine-logic-table .logic-desc-cell {
            vertical-align: top;
            white-space: normal;
        }
    `;
    document.head.appendChild(style);
}

// Field/column name -> plain-English explanation of how it is calculated.
// Keep this in sync with vaccine_report.py (get_columns / get_summary_data /
// _build_conditions) whenever the underlying logic changes.
const VACCINE_REPORT_LOGIC = [
    {
        section: "Filters",
        rows: [
            {
                title: "Year / Month",
                logic: "Defines the reporting window. The report uses the last day of the selected month as the 'as-of' date (end_date) for age calculations and vaccine eligibility, and the 1st of the month as the start of the enrollment window."
            },
            {
                title: "Partner / State / District / Block / Gram Panchayat / Creche / Supervisor",
                logic: "Standard geography/ownership cascading filters. Each narrows the underlying Creche records (and, through them, the children enrolled there) to the selected value. If State/District/Block/GP are left blank, the logged-in user's own geography mapping (User Geography Mapping) is used instead."
            },
            {
                title: "Level",
                logic: "Controls how rows are grouped/aggregated: Level 8 (Child) shows one row per enrolled child with a Yes/No/Overdue/Not Eligible status per vaccine. Levels 1-7 (Partner, State, District, Block, Supervisor, GP, Creche) show one row per group, with 'Vaccinated (Eligible)' counts per vaccine and a 'No of Creche' / 'Enrolled Children' count."
            },
            {
                title: "Phase",
                logic: "Filters creches to only those whose 'phase' value matches one of the selected phase numbers (multi-select)."
            },
            {
                title: "Creche Status",
                logic: "Filters creches by their operational status: Planned, Plan dropped, Active/Operational, or Closed."
            },
            {
                title: "Age of Creche",
                logic: "Filters creches by how long they have been open as of the selected month-end, bucketed into 0-6, 7-12, 13-18, 19-24 and 24+ months (based on TIMESTAMPDIFF between creche_opening_date and the period end date). Selecting a bucket also auto-fills the Creche Opening Date filter with an equivalent 'after' date."
            },
            {
                title: "Creche Opening Date (Between/Before/After/Equal)",
                logic: "Filters creches directly by their creche_opening_date, using the selected comparison type and date(s)."
            },
            {
                title: "Safety Indicators",
                logic: "Restricts the vaccine columns shown in the report to only the vaccine(s) belonging to the selected safety indicator group (e.g. IPV, Vitamin A, PCV, JE, Rota, Pentavalent, Measles, BCG, Hepatitis, etc.). 'All' shows every tracked vaccine."
            }
        ]
    },
    {
        section: "Common Columns (all levels)",
        rows: [
            {
                title: "Partner / State / District / Block / Gram Panchayat / Supervisor / Creche",
                logic: "Looked up from the Creche record (and its linked User) that the enrolled child belongs to."
            },
            {
                title: "No of Creche",
                logic: "Count of distinct creches (tabCreche) matching the applied filters, counted independently of whether they currently have enrolled children — mirrors the same calculation used on the dashboard. Shown for Levels 1-6 (omitted at Creche level, since it would always be 1)."
            },
            {
                title: "Enrolled Children",
                logic: "Count of distinct enrollment records (tabChild Enrollment and Exit) that fall inside the enrollment window for the selected month: the child either exited during the month, or was enrolled on/before month-end and has not yet exited (or exited after month-end). Matches the dashboard's 'enrolled_children' metric."
            },
            {
                title: "Total row",
                logic: "The last row of the table. Its No of Creche / Enrolled Children / vaccine counts are the grand totals across all matching records (recomputed the same way as the dashboard), not just a sum of the visible rows."
            },
            {
                title: "Clickable counts",
                logic: "Any underlined count (No of Creche, Enrolled Children, or a vaccine's Vaccinated(Eligible) figure) can be clicked to open a detail popup listing the exact child/creche records behind that number, with an option to download them as XLSX."
            }
        ]
    },
    {
        section: "Child-level View (Level = Child)",
        rows: [
            {
                title: "Current Age (In Months)",
                logic: "TIMESTAMPDIFF(MONTH, child_dob, end_date) — the child's age in completed months as of the last day of the selected month."
            },
            {
                title: "<Vaccine Name> (e.g. IPV 1, BCG, Measles 1 (MR), ...)",
                logic: "Status for that specific vaccine dose: 'Yes' if a Vaccine Details record marks it vaccinated=1; 'No' if a record exists marking vaccinated=0; if no record exists at all, the child is 'Overdue' when their age in days already exceeds that vaccine's eligibility threshold, otherwise 'Not Eligible' (too young for the dose yet). Each vaccine has its own threshold in days, e.g. BCG/OPV0/Hepatitis B0 = 0 days (due at birth), IPV1/PCV1/Rota1/Pentavalent1/OPV1 = 42 days, Rota2/Pentavalent2/OPV2 = 70 days, IPV2/PCV2/Rota3/Pentavalent3/OPV3 = 98 days, Vitamin A1/PCV Booster/JE1/Measles1/IPV3 = 270 days, JE2/DPT Booster/OPV Booster/Measles2 = 480 days, Vitamin A2/Albendazole1 = 540 days, Vitamin A3/Albendazole2 = 720 days, Vitamin A4/Albendazole3 = 900 days, Vitamin A5/Albendazole4 = 1080 days."
            }
        ]
    },
    {
        section: "Group-level View (Level = Partner/State/District/Block/Supervisor/GP/Creche)",
        rows: [
            {
                title: "<Vaccine Name> — Vaccinated (Eligible)",
                logic: "Shown as 'V(E)', e.g. '42(50)'. V = count of children in this group whose status for that vaccine is 'Yes'. E = count of children in this group who are past the eligibility threshold for that vaccine, i.e. status is 'Yes', 'No' or 'Overdue' (excludes children who are 'Not Eligible' because they are still too young)."
            }
        ]
    },
    {
        section: "Detail Popup (opened by clicking a count)",
        rows: [
            {
                title: "No of Creche popup",
                logic: "Lists every creche (with Partner/State/District/Block/GP/Supervisor) matched by the current filters and the clicked row's group — independent of enrolled children."
            },
            {
                title: "Enrolled Children popup",
                logic: "Lists every enrolled child (Child ID, Name, Creche, Age, Enrolled On, geography) matched by the current filters, the clicked row's group, and the enrollment window."
            },
            {
                title: "Vaccine popup (Vaccinated / Eligible / Not Vaccinated toggle)",
                logic: "Lists children matched by the filters/group, with a Status column for the clicked vaccine. 'Vaccinated' shows only Status = Yes. 'Eligible' shows Status IN (Yes, No, Overdue) — i.e. the eligible denominator. 'Not Vaccinated' shows Status IN (No, Overdue)."
            },
            {
                title: "Download (XLSX)",
                logic: "Re-runs the exact same query behind the currently open popup (same filters, group and vaccine sub-filter) and streams the result as an Excel file, so the download always matches what is on screen."
            }
        ]
    }
];

function build_logic_table_html() {
    const esc = frappe.utils.escape_html;
    let rows_html = "";
    VACCINE_REPORT_LOGIC.forEach(section => {
        rows_html += `
            <tr class="logic-section-row">
                <td colspan="2">${esc(section.section)}</td>
            </tr>`;
        section.rows.forEach(row => {
            rows_html += `
                <tr>
                    <td class="logic-title-cell">${esc(row.title)}</td>
                    <td class="logic-desc-cell">${esc(row.logic)}</td>
                </tr>`;
        });
    });

    return `
        <div class="vaccine-logic-wrap">
            <div class="vaccine-logic-scroll">
                <table class="table table-bordered table-sm vaccine-logic-table">
                    <thead>
                        <tr>
                            <th style="width:28%;">${__("Field / Column")}</th>
                            <th>${__("Logic")}</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows_html}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

function show_report_logic_dialog() {
    const dialog = new frappe.ui.Dialog({
        title: __("Report Logic"),
        size: "extra-large",
        fields: [{ fieldtype: "HTML", fieldname: "logic_html" }]
    });

    dialog.$wrapper.find(".modal-dialog").css({ "max-width": "92vw", "width": "92vw" });
    dialog.fields_dict.logic_html.$wrapper.html(build_logic_table_html());

    dialog.set_primary_action(__("Download (XLSX)"), function () {
        download_report_logic_xlsx();
    });
    dialog.$wrapper.find(".modal-footer").css("text-align", "right");

    dialog.show();
}

// Builds the same rows shown in the Logic dialog into a client-side .xlsx file.
function download_report_logic_xlsx() {
    const rows = [[__("Card Title"), __("Logic")]];
    VACCINE_REPORT_LOGIC.forEach(section => {
        rows.push([section.section, ""]);
        section.rows.forEach(row => {
            rows.push([row.title, row.logic]);
        });
    });

    open_url_post(
        "/api/method/frappe.apf.report.vaccine_report.vaccine_report.download_report_logic_xlsx",
        { rows: JSON.stringify(rows) }
    );
}

const POPUP_CHUNK_SIZE = 200;

function show_count_details_dialog(ctx) {
    const filters = frappe.query_report.get_filter_values(true) || {};
    const esc = frappe.utils.escape_html;

    // For the vaccine popup, "Vaccinated" is the default sub-filter.
    if (ctx.metric === "vaccine" && !ctx.vac_filter) {
        ctx.vac_filter = "vaccinated";
    }

    const dialog = new frappe.ui.Dialog({
        title: __("Loading..."),
        size: "extra-large",
        fields: [{ fieldtype: "HTML", fieldname: "details_html" }]
    });

    // Make the dialog noticeably wider than the default extra-large.
    dialog.$wrapper.find(".modal-dialog").css({ "max-width": "92vw", "width": "92vw" });

    const $body = dialog.fields_dict.details_html.$wrapper;

    // Renders one server response into the dialog body.
    const render_response = (res) => {
        const columns = res.columns || [];
        const rows = res.rows || [];
        const total = res.total != null ? res.total : rows.length;
        const title = res.title || __("Details");

        dialog.set_title(`${title} (${total})`);

        const header_html = columns.map(c => `<th>${esc(c)}</th>`).join("");

        // Vaccinated / Eligible sub-filter (only for the vaccine popup).
        let filter_html = "";
        if (res.metric === "vaccine") {
            const vf = res.vac_filter || "vaccinated";
            filter_html = `
                <div class="vaccine-details-filter" style="padding:4px 2px 10px;">
                    <label style="margin-right:8px;font-weight:600;">${__("Show")}:</label>
                    <select class="form-control input-sm vaccine-vac-filter" style="width:auto;display:inline-block;">
                        <option value="vaccinated" ${vf === "vaccinated" ? "selected" : ""}>${__("Vaccinated")}</option>
                        <option value="eligible" ${vf === "eligible" ? "selected" : ""}>${__("Eligible")}</option>
                        <option value="not_vaccinated" ${vf === "not_vaccinated" ? "selected" : ""}>${__("Not Vaccinated")}</option>
                    </select>
                </div>`;
        }

        $body.html(`
            <div class="vaccine-details-wrap">
                ${filter_html}
                <div class="vaccine-details-scroll">
                    <table class="table table-bordered table-sm">
                        <thead><tr>${header_html}</tr></thead>
                        <tbody class="vaccine-details-body"></tbody>
                        <tfoot class="vaccine-details-foot"></tfoot>
                    </table>
                </div>
                <div class="vaccine-details-status text-muted small" style="padding:6px 2px;"></div>
            </div>
        `);

        const $tbody = $body.find(".vaccine-details-body");
        const $tfoot = $body.find(".vaccine-details-foot");
        const $status = $body.find(".vaccine-details-status");

        if (rows.length === 0) {
            $tbody.html(
                `<tr><td colspan="${columns.length || 1}" style="text-align:center;">${__("No records found")}</td></tr>`
            );
        } else {
            // --- Chunked / lazy rendering to avoid freezing on big datasets ---
            let rendered = 0;
            const $scroll = $body.find(".vaccine-details-scroll");

            const render_chunk = () => {
                const end = Math.min(rendered + POPUP_CHUNK_SIZE, rows.length);
                let chunk_html = "";
                for (let i = rendered; i < end; i++) {
                    const row = rows[i];
                    const cells = columns.map(c => {
                        let val = row[c];
                        if (val === null || val === undefined) val = "";
                        return `<td>${esc(String(val))}</td>`;
                    }).join("");
                    chunk_html += `<tr>${cells}</tr>`;
                }
                $tbody.append(chunk_html);
                rendered = end;

                if (rendered < rows.length) {
                    $status.text(__("Showing {0} of {1} — scroll for more", [rendered, rows.length]));
                } else {
                    $status.text(__("Showing all {0} records", [rows.length]));
                }
            };

            render_chunk();

            $scroll.on("scroll", function () {
                if (rendered >= rows.length) return;
                const el = this;
                if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) {
                    render_chunk();
                }
            });
        }

        // Total row: show the actual count, not just the word "Total".
        let total_label;
        if (res.metric === "creches") {
            total_label = __("Total Creches");
        } else if (res.metric === "vaccine") {
            if (res.vac_filter === "eligible") total_label = __("Total Eligible");
            else if (res.vac_filter === "not_vaccinated") total_label = __("Total Not Vaccinated");
            else total_label = __("Total Vaccinated");
        } else {
            total_label = __("Total Children");
        }
        $tfoot.html(`
            <tr style="font-weight:bold;background:#f5f5f5;">
                <td colspan="${Math.max(columns.length - 1, 1)}" style="text-align:right;">${esc(total_label)}:</td>
                <td>${total}</td>
            </tr>
        `);

        // Re-fetch when the Vaccinated/Eligible filter changes.
        $body.find(".vaccine-vac-filter").on("change", function () {
            ctx.vac_filter = $(this).val();
            fetch_and_render();
        });

        // Download button (XLSX) at the bottom-right of the popup.
        dialog.set_primary_action(__("Download (XLSX)"), function () {
            download_details_xlsx(filters, ctx);
        });
        dialog.$wrapper.find(".modal-footer").css("text-align", "right");
    };

    // Fetches data for the current ctx (including any vac_filter) and renders it.
    const fetch_and_render = () => {
        frappe.call({
            method: "frappe.apf.report.vaccine_report.vaccine_report.get_count_details",
            args: {
                filters: JSON.stringify(filters),
                ctx: JSON.stringify(ctx)
            },
            freeze: true,
            freeze_message: __("Loading details..."),
            callback: function (r) {
                render_response(r.message || {});
            }
        });
    };

    dialog.show();
    fetch_and_render();
}

// Export the popup's dataset as a true .xlsx file. The server re-runs the same
// query and streams an Excel workbook, so the download always matches the popup.
function download_details_xlsx(filters, ctx) {
    open_url_post(
        "/api/method/frappe.apf.report.vaccine_report.vaccine_report.download_count_details_xlsx",
        {
            filters: JSON.stringify(filters),
            ctx: JSON.stringify(ctx)
        }
    );
}

// Helper function to sync creche_age with opening date filter
function syncCrecheAgeWithOpeningDate() {
    const value = frappe.query_report.get_filter_value("creche_age");
    const type_field = frappe.query_report.get_filter("cr_opening_range_type");
    const range_field = frappe.query_report.get_filter("c_opening_range");
    const single_field = frappe.query_report.get_filter("single_date");
    
    if (value) {
        // Map age ranges to approximate months (using the middle/starting point of each range)
        const months_map = {
            "0-6 Month": 3,    // Using 3 months as representative (middle of 0-6)
            "7-12 Month": 9,    // Using 9 months as representative (middle of 7-12)
            "13-18 Month": 15,  // Using 15 months as representative (middle of 13-18)
            "19-24 Month": 21,  // Using 21 months as representative (middle of 19-24)
            "24+ Month": 24     // Using 24 months as minimum
        };
        
        const n_months = months_map[value];
        
        if (n_months !== undefined) {
            // Get current year and month from filters, or use current date
            let curr_year = parseInt(frappe.query_report.get_filter_value("year")) || new Date().getFullYear();
            let curr_month = parseInt(frappe.query_report.get_filter_value("month")) || (new Date().getMonth() + 1);
            
            // Create date for the end of the selected month
            let current_date = new Date(curr_year, curr_month, 0);
            
            // Calculate past date by subtracting months
            let past_date = new Date(current_date);
            past_date.setMonth(past_date.getMonth() - n_months);
            
            // Format date as YYYY-MM-DD
            let date_str = past_date.getFullYear() + "-" +
                           String(past_date.getMonth() + 1).padStart(2, '0') + "-" +
                           String(past_date.getDate()).padStart(2, '0');
            
            // Set filter values
            frappe.query_report.set_filter_value("cr_opening_range_type", "after");
            frappe.query_report.set_filter_value("single_date", date_str);
            frappe.query_report.set_filter_value("c_opening_range", []);
            
            // Toggle field visibility
            toggleDateFields("after");
        }
    } else {
        // Clear all related filters when creche_age is cleared
        frappe.query_report.set_filter_value("cr_opening_range_type", "");
        frappe.query_report.set_filter_value("single_date", "");
        frappe.query_report.set_filter_value("c_opening_range", []);
        toggleDateFields("");
    }
}

// Helper function to toggle date fields based on selection
function toggleDateFields(dateRangeType) {
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
}