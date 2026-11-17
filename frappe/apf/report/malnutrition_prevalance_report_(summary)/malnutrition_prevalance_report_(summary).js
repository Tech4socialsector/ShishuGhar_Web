// Copyright (c) 2026, Frappe Technologies and contributors
// For license information, please see license.txt


// ── Logic popup: how every report field is calculated ──────────────────────
// Everything lives in one closure (MPRS_TOOLS) so the helper names cannot clash
// with the globals of other report scripts loaded in the same desk session.
// The popup's XLSX file is built client-side; ExcelJS is lazy-loaded from cdnjs
// the first time it is needed.
var MPRS_TOOLS = (function () {
    var REPORT_TITLE = "Malnutrition Prevalence Report (Summary)";
    var LOGIC_FILE   = "Malnutrition_Summary_Report_Logic";
    var BRAND_HEX    = "#5979aa";
    var BRAND_RGB    = [89, 121, 170];
    var XLSX_MIME    = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    var EXCELJS_URL  = "https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js";

    var ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
    function esc(s) {
        return String(s).replace(/[&<>]/g, function (c) { return ESC_MAP[c]; });
    }

    function rgbToArgb(rgb) {
        return "FF" + rgb.map(function (n) { return ("0" + n.toString(16)).slice(-2); }).join("").toUpperCase();
    }

    var excelJsLoad = null;
    function loadExcelJs() {
        if (typeof window.ExcelJS !== "undefined") return Promise.resolve();
        if (excelJsLoad) return excelJsLoad;

        excelJsLoad = new Promise(function (resolve, reject) {
            var script = document.createElement("script");
            script.src = EXCELJS_URL;
            script.onload = function () {
                if (typeof window.ExcelJS !== "undefined") resolve();
                else reject(new Error("ExcelJS loaded but is not available"));
            };
            script.onerror = function () {
                if (script.parentNode) script.parentNode.removeChild(script);
                reject(new Error("Could not load ExcelJS from " + EXCELJS_URL));
            };
            document.head.appendChild(script);
        }).catch(function (e) {
            excelJsLoad = null; // let the next click retry
            throw e;
        });
        return excelJsLoad;
    }

    function saveBlob(blob, filename) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // Revoking too early can cut a large download short; give the browser time.
        setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    }

    var XLSX_BORDER = (function () {
        var side = { style: "thin", color: { argb: "FF808080" } };
        return { top: side, left: side, bottom: side, right: side };
    })();

    // ── Logic: how every report field is calculated ────────────────────────
    // Mirrors malnutrition_prevalance_report_(summary).py -- keep in sync when
    // the SQL rules change. "\n" starts a new line in the modal.

    // The nine WFA / WFH / HFA count columns share one rule; each still gets its
    // own row (count + %) so every column header can be found in the table.
    function nutritionItems(prefix, long) {
        var statuses = [
            { name: "Normal", code: 3 },
            { name: "Moderate", code: 2 },
            { name: "Severe", code: 1 },
        ];
        var items = [];
        statuses.forEach(function (s) {
            items.push({
                field: prefix + " - " + s.name,
                logic: "Number of measured children whose " + long + " status is " + s.name + " (status code " + s.code + " on the anthropometric record).\n"
                    + "Counts the same records as 'Measurement Taken' (height & weight recorded, measurement date in the selected month, child enrolled on or before the month end and not exited on or before the first day of the month), grouped by creche and summed up to the row's level.",
            });
            items.push({
                field: prefix + " - " + s.name + " (%)",
                logic: "(" + prefix + " - " + s.name + " / Measurement Taken) x 100, shown with 2 decimals. 0 when Measurement Taken is 0.\n"
                    + "The base is the children measured, not the children enrolled.",
            });
        });
        return items;
    }

    var GF_COMMON = "Counted among children measured this month: height & weight recorded, measurement date (Child Growth Monitoring) in the selected month, enrolled on or before the month end, not exited on or before the first day of the month, and the creche opened on or before the month end (creches with no opening date are included).\n"
        + "Z-scores are the Weight-for-Age Z-scores stored on the child's anthropometric records. 'Last month' is the previous calendar month, '2 months ago' the month before that, and so on; earlier values are looked up by the measurement date on each earlier record.\n"
        + "'Drop' = this month's Z-score minus the earlier Z-score.";

    var GF_SEE = "Who is counted: see 'Common rules' above.";

    var LOGIC_SECTIONS = [
        {
            section: "Report Scope",
            items: [
                {
                    field: "Rows in the report",
                    logic: "One row per group at the selected Level (Partner, State, District, Block, Supervisor, Gram Panchayat or Creche; blank = Creche level). Each row adds up the creches that fall under it.\n"
                        + "The Geography columns shown depend on the Level: Partner -> Partner; State -> State; District -> State, District; Block -> State, District, Block; Supervisor -> State, District, Block, Supervisor; GP -> State, District, Block, Gram Panchayat; Creche -> State, District, Block, Gram Panchayat, Supervisor, Creche, Creche ID, Creche Opening Date.",
                },
                {
                    field: "Reporting month",
                    logic: "Year and Month filters give the reporting window: the first day to the last day of that month. Every count below uses this window unless stated otherwise.",
                },
                {
                    field: "Creches included (filters)",
                    logic: "Only creches from the Creche master that match all selected filters are counted: Partner, State, District, Block, Gram Panchayat, Supervisor, Creche, Creche Status (default Active/Operational), Phase, Age of Creche and Creche Opening Date.\n"
                        + "Partner defaults to the logged-in user's partner, and State / District / Block / GP are limited to the geographies mapped to the logged-in user when the filter is left empty.\n"
                        + "Age of Creche = completed months between the creche opening date and the month end: 0-6, 7-12, 13-18, 19-24 or more than 24 months. Creche Opening Date supports Between / Before / After / Equal (Before and After exclude the chosen date).",
                },
                {
                    field: "Total row",
                    logic: "Last row of the report. Every count column is the sum of the rows above it. The percentage columns are recalculated from those totals (not averaged): Measurement (%) = Measurement Taken / Enrolled Children x 100 and each WFA / WFH / HFA (%) = count / Measurement Taken x 100, rounded to 2 decimals. Geography columns are blank.",
                },
            ],
        },
        {
            section: "Geography & Creche Details",
            items: [
                { field: "Partner", logic: "Name of the partner organisation that runs the creche (Creche master -> Partner)." },
                { field: "State", logic: "State name of the creche, from the Creche master." },
                { field: "District", logic: "District name of the creche, from the Creche master." },
                { field: "Block", logic: "Block name of the creche, from the Creche master." },
                { field: "Supervisor", logic: "Full name of the user assigned as the creche's supervisor." },
                { field: "Gram Panchayat", logic: "Gram Panchayat name of the creche, from the Creche master." },
                { field: "Creche", logic: "Name of the creche (shown at Creche level only)." },
                { field: "Creche ID", logic: "Creche ID (code) from the Creche master (shown at Creche level only)." },
                { field: "Creche Opening Date", logic: "Date the creche opened, shown as dd-mm-yyyy (Creche level only)." },
            ],
        },
        {
            section: "Creches & Enrollment",
            items: [
                {
                    field: "Active Creches",
                    logic: "Number of creches in the group that match the filters. With the default Creche Status = Active/Operational these are the operational creches; changing the Creche Status filter changes what is counted.",
                },
                {
                    field: "GM Submitted",
                    logic: "Number of creches in the group that have at least one Child Growth Monitoring record whose measurement date falls in the selected month. A creche counts once, however many records it has.",
                },
                {
                    field: "Enrolled Children",
                    logic: "Number of distinct children (Child Enrollment and Exit records) of the creche who were enrolled during the month:\n"
                        + "- date of enrollment is on or before the last day of the month, and\n"
                        + "- the child has not exited, or exited on or after the first day of the month.",
                },
            ],
        },
        {
            section: "Measurements",
            items: [
                {
                    field: "Measurement Taken",
                    logic: "Number of anthropometric records in the month where height & weight were recorded ('Do you have height & weight' = Yes), for children who were:\n"
                        + "- enrolled on or before the last day of the month, and\n"
                        + "- not exited, or exited after the first day of the month.\n"
                        + "The record's Child Growth Monitoring measurement date must be in the selected Year and Month.",
                },
                {
                    field: "Measurement (%)",
                    logic: "Measurement Taken / Enrolled Children x 100, shown with 2 decimals and capped at 100. 0 when Enrolled Children is 0.\n"
                        + "For a group of creches the totals are added first and then divided (not an average of creche percentages).",
                },
                {
                    field: "Child Not In Creche",
                    logic: "Number of anthropometric records of the month where height & weight were NOT recorded and the reason selected is 'Child not in creche'.",
                },
                {
                    field: "Child Not In Village",
                    logic: "Number of anthropometric records of the month where height & weight were NOT recorded and the reason selected is 'Child not in village'.",
                },
                {
                    field: "Child is Sick",
                    logic: "Number of anthropometric records of the month where height & weight were NOT recorded and the reason selected is 'Child is sick'.",
                },
                {
                    field: "Other",
                    logic: "Number of anthropometric records of the month where height & weight were NOT recorded and the reason selected is 'Other'.",
                },
            ],
        },
        {
            section: "Weight for Age (WFA)",
            items: nutritionItems("WFA", "weight-for-age"),
        },
        {
            section: "Weight for Height (WFH)",
            items: nutritionItems("WFH", "weight-for-height"),
        },
        {
            section: "Height for Age (HFA)",
            items: nutritionItems("HFA", "height-for-age"),
        },
        {
            section: "Growth Faltering & Special Nutrition Care",
            items: [
                {
                    field: "Common rules (GF1, GF1+, GF2, Zig-Zag)",
                    logic: GF_COMMON,
                },
                {
                    field: "Growth Faltering 1",
                    logic: "Number of children whose Weight-for-Age Z-score this month is lower than last month's (any drop: earlier - current > 0).\n"
                        + "If there is no Z-score for last month, the Z-score from 2 months ago is used. Children with no earlier Z-score are not counted.\n"
                        + GF_SEE,
                },
                {
                    field: "Growth Faltering 1+",
                    logic: "Number of children whose Weight-for-Age Z-score has dropped by 0.5 or more compared with last month (current - earlier <= -0.5).\n"
                        + "If there is no Z-score for last month, the Z-score from 2 months ago is used.\n"
                        + GF_SEE,
                },
                {
                    field: "Growth Faltering 2",
                    logic: "Number of distinct children whose Weight-for-Age Z-score has dropped by 0.5 or more compared with 2 months ago (current - earlier <= -0.5).\n"
                        + "If there is no Z-score for 2 months ago, the Z-score from 3 months ago is used.\n"
                        + GF_SEE,
                },
                {
                    field: "Zig-Zag",
                    logic: "Number of children for whom all of the following hold:\n"
                        + "- a Weight-for-Age Z-score exists for each of the 4 previous months;\n"
                        + "- the child was enrolled on or before the last day of the month that is 4 months before the selected month;\n"
                        + "- this month's Z-score is 0.5 or more below the highest of those 4 previous Z-scores;\n"
                        + "- across the 5 monthly values (4 previous + current) the Z-score rose at least once and fell at least once between consecutive months.\n"
                        + GF_SEE,
                },
                {
                    field: "SNC",
                    logic: "Special Nutrition Care: number of distinct children measured this month (height & weight recorded, same enrollment, exit and creche-opening rules as above) for whom ANY of these is true:\n"
                        + "- Growth Faltering 1 condition is met (any drop vs last month);\n"
                        + "- Growth Faltering 1+ condition is met (drop of 0.5 or more vs last month);\n"
                        + "- Growth Faltering 2 condition is met (drop of 0.5 or more vs 2 months ago);\n"
                        + "- Zig-Zag condition is met;\n"
                        + "- Weight-for-Age status is Severe (severely underweight);\n"
                        + "- Weight-for-Height status is Severe (severely wasted).\n"
                        + "A child meeting several conditions is counted once, so SNC is not the sum of the columns above.",
                },
            ],
        },
    ];


    function buildLogicTableHtml() {
        var th = "padding:12px;border:1px solid #ccc;text-align:left;background:" + BRAND_HEX
            + ";color:#fff;position:sticky;top:0;z-index:1;";
        var rows = "";
        var n = 0;

        LOGIC_SECTIONS.forEach(function (sec) {
            rows += '<tr><td colspan="2" style="padding:8px 12px;border:1px solid #c8d5e8;background:#eef2f8;'
                + 'color:' + BRAND_HEX + ';font-weight:700;">' + esc(sec.section) + "</td></tr>";
            sec.items.forEach(function (it) {
                var bg = n++ % 2 === 0 ? "#f9f9f9" : "#ffffff";
                rows += '<tr style="background:' + bg + ';">'
                    + '<td style="padding:10px 12px;border:1px solid #ddd;font-weight:600;color:#333;vertical-align:top;white-space:normal;">' + esc(it.field) + "</td>"
                    + '<td style="padding:10px 12px;border:1px solid #ddd;color:#555;vertical-align:top;white-space:pre-line;line-height:1.5;">' + esc(it.logic) + "</td>"
                    + "</tr>";
            });
        });

        return '<table style="width:100%;border-collapse:collapse;font-size:14px;text-align:left;table-layout:fixed;">'
            + '<thead><tr><th style="' + th + 'width:26%;">Field</th><th style="' + th + 'width:74%;">Logic</th></tr></thead>'
            + "<tbody>" + rows + "</tbody></table>";
    }

    function buildLogicXlsxBlob() {
        var wb = new ExcelJS.Workbook();
        wb.created = new Date();
        var ws = wb.addWorksheet("Report Logic", { views: [{ state: "frozen", ySplit: 1 }] });
        ws.columns = [{ width: 26 }, { width: 34 }, { width: 120 }];

        var head = ws.addRow(["Section", "Field", "Logic"]);
        head.height = 24;
        head.eachCell(function (c) {
            c.font = { name: "Arial", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
            c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: rgbToArgb(BRAND_RGB) } };
            c.alignment = { vertical: "middle", horizontal: "left" };
            c.border = XLSX_BORDER;
        });

        LOGIC_SECTIONS.forEach(function (sec) {
            sec.items.forEach(function (it) {
                var r = ws.addRow([sec.section, it.field, it.logic]);
                r.eachCell(function (c, colNumber) {
                    c.font = { name: "Arial", size: 10, bold: colNumber === 2 };
                    c.alignment = { vertical: "top", horizontal: "left", wrapText: true };
                    c.border = XLSX_BORDER;
                });
            });
        });

        return wb.xlsx.writeBuffer().then(function (buf) { return new Blob([buf], { type: XLSX_MIME }); });
    }

    var LOGIC_MODAL_ID = "mprs-logic-modal";

    function closeLogicModal() {
        $("#" + LOGIC_MODAL_ID).remove();
        $(document).off("keydown.mprsLogic page-change.mprsLogic");
        document.body.style.overflow = "";
    }

    // Runs `job` behind a button that shows "Downloading..." and ignores re-clicks.
    function withButtonBusy($btn, job) {
        if ($btn.prop("disabled")) return;
        var original = $btn.text();
        $btn.text(__("Downloading...")).prop("disabled", true).css({ opacity: 0.6, cursor: "not-allowed" });

        setTimeout(function () {
            Promise.resolve()
                .then(job)
                .catch(function (e) {
                    console.error(e);
                    frappe.msgprint(__("Could not generate the file."));
                })
                .then(function () {
                    $btn.text(original).prop("disabled", false).css({ opacity: 1, cursor: "pointer" });
                });
        }, 50);
    }

    function openLogicModal() {
        closeLogicModal();

        var btnStyle = "padding:6px 12px;background-color:" + BRAND_HEX
            + ";color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;";
        var $modal = $(
            '<div id="' + LOGIC_MODAL_ID + '" style="position:fixed;z-index:10000;left:0;top:0;width:100%;height:100%;'
            + 'overflow:auto;background-color:rgba(0,0,0,0.5);backdrop-filter:blur(3px);padding:4vh 12px;box-sizing:border-box;">'
            + '<div class="mprs-logic-content" style="background:#fff;margin:0 auto;padding:20px;border-radius:12px;width:100%;'
            + 'max-width:1200px;max-height:92vh;box-shadow:0 8px 24px rgba(0,0,0,0.2);display:flex;flex-direction:column;box-sizing:border-box;">'
            + '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:12px;">'
            + '<div style="flex:1;min-width:220px;">'
            + '<h2 style="margin:0;font-size:1.45rem;color:' + BRAND_HEX + ';">Report Logic</h2>'
            + '<div style="font-size:12px;color:#777;margin-top:2px;">' + esc(REPORT_TITLE) + ' - how each field is calculated</div>'
            + '</div>'
            + '<button type="button" class="mprs-logic-xlsx" style="' + btnStyle + '">Download XLSX</button>'
            + '<button type="button" class="mprs-logic-close" aria-label="Close" style="width:36px;height:36px;background:rgba(0,0,0,0.05);'
            + 'border:none;border-radius:5px;font-size:24px;line-height:1;cursor:pointer;">&times;</button>'
            + '</div>'
            + '<div class="mprs-logic-scroll" style="overflow-y:auto;flex:1;min-height:0;border-radius:8px;border:1px solid #ddd;background:#fff;">'
            + buildLogicTableHtml()
            + '</div></div></div>'
        );

        $modal.on("click", function (e) { if (e.target === this) closeLogicModal(); });
        $modal.find(".mprs-logic-close").on("click", closeLogicModal);

        $modal.find(".mprs-logic-xlsx").on("click", function () {
            withButtonBusy($(this), function () {
                return loadExcelJs()
                    .then(buildLogicXlsxBlob)
                    .then(function (blob) { saveBlob(blob, LOGIC_FILE + ".xlsx"); });
            });
        });

        $(document)
            .off("keydown.mprsLogic page-change.mprsLogic")
            .on("keydown.mprsLogic", function (e) { if (e.key === "Escape") closeLogicModal(); })
            .on("page-change.mprsLogic", closeLogicModal);

        document.body.style.overflow = "hidden";
        $modal.appendTo(document.body);
    }

    return { openLogic: openLogicModal };
})();

frappe.query_reports["Malnutrition prevalance report (Summary)"] = {
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
                    filters: { "is_active": 1 }
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
            fieldname: "level",
            label: __("Level"),
            fieldtype: "Select",
            options: [
                { "value": "", "label": __("Level") },
                { "value": "1", "label": __("Partner") },
                { "value": "2", "label": __("State") },
                { "value": "3", "label": __("District") },
                { "value": "4", "label": __("Block") },
                { "value": "5", "label": __("Supervisor") },
                { "value": "6", "label": __("GP") },
                { "value": "7", "label": __("Creche") },
            ],
            default: "",
            on_change: function () {
                frappe.query_report.refresh();
            }
        },
        {
            fieldname: "phases",
            label: __("Phase"),
            fieldtype: "MultiSelect",
            options: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
            reqd: 0,
            default: ""
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
                syncCrecheAgeToDateFilter(); // Wired up your helper function
                frappe.query_report.refresh();
            }
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

    onload: function (report) {
        // Hide the default Frappe Export menu to prevent JSON downloads
        const style = document.createElement("style");
        style.innerHTML = `
            [data-label="Export"],
            [data-original-title="Export"] {
                display: none !important;
            }
        `;
        document.head.appendChild(style);

        // Custom direct-to-Excel button
        report.page.add_inner_button(__("Download Report"), function () {
            frappe.query_report.export_report("Excel");
        });

        // Logic button: explains how every field is calculated
        report.page.add_inner_button(__("Logic"), MPRS_TOOLS.openLogic);
    }
};

function syncCrecheAgeToDateFilter() {
    const ageRange = frappe.query_report.get_filter_value("creche_age");
    if (!ageRange) {
        // cleared → reset date filters
        frappe.query_report.set_filter_value("cr_opening_range_type", "");
        frappe.query_report.set_filter_value("c_opening_range", []);
        frappe.query_report.set_filter_value("single_date", "");
        toggleDateFields("");
        return;
    }

    const endDate = getEndOfReportMonth();   // last day of selected year + month

    // These match your SQL TIMESTAMPDIFF(MONTH, ...) BETWEEN logic
    const rangeMap = {
        "0-6 Month":   { min: 0,  max: 6  },
        "7-12 Month":  { min: 7,  max: 12 },
        "13-18 Month": { min: 13, max: 18 },
        "19-24 Month": { min: 19, max: 24 },
        "24+ Month":   { min: 25, max: null }   // 25 months and more
    };

    const range = rangeMap[ageRange];
    if (!range) return;

    let fromDate, toDate;

    if (range.max === null) {
        // 24+ months → opened on or before (end - 24 months)
        fromDate = null;
        toDate   = subtractMonths(endDate, 24);
        frappe.query_report.set_filter_value("cr_opening_range_type", "before");
        frappe.query_report.set_filter_value("single_date", toDate);
        frappe.query_report.set_filter_value("c_opening_range", []);
    } else {
        // Normal bucket: opened between (end - max) and (end - min)
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
    // Last day of month
    return new Date(year, month, 0);
}

function subtractMonths(baseDate, months) {
    let d = new Date(baseDate);
    d.setMonth(d.getMonth() - months);
    return d.toISOString().split("T")[0];   // YYYY-MM-DD
}

function toggleDateFields(type) {
    const showRange  = type === "between";
    const showSingle = ["before", "after", "equal"].includes(type);

    frappe.query_report.get_filter("c_opening_range").toggle(showRange);
    frappe.query_report.get_filter("single_date").toggle(showSingle);

    if (showRange)  frappe.query_report.set_filter_value("single_date", "");
    if (showSingle) frappe.query_report.set_filter_value("c_opening_range", []);
}