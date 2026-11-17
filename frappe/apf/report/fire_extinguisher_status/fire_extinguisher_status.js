// Copyright (c) 2026, Frappe Technologies and contributors
// For license information, please see license.txt

frappe.query_reports["Fire Extinguisher Status"] = {
    filters: [
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
                return { filters: { "is_active": 1 } };
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
                { "value": "",  "label": __("Level") },
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
    ],

    onload: function (report) {
        const style = document.createElement("style");
        style.innerHTML = `
            [data-label="Export"],
            [data-original-title="Export"] {
                display: none !important;
            }
            .fe-popup-overlay {
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(0,0,0,0.5); z-index: 9998;
                display: flex; align-items: center; justify-content: center;
            }
            .fe-popup-box {
                background: #fff; border-radius: 8px; padding: 20px 24px;
                max-width: 1400px; width: 97%; max-height: 85vh;
                z-index: 9999; position: relative;
                box-shadow: 0 8px 30px rgba(0,0,0,0.25);
                display: flex; flex-direction: column;
            }
            .fe-popup-header {
                display: flex; align-items: center; justify-content: space-between;
                margin-bottom: 14px;
            }
            .fe-popup-box h5 {
                margin: 0; font-size: 16px; font-weight: 600; color: #333;
            }
            .fe-popup-close {
                cursor: pointer; font-size: 22px; color: #666; line-height: 1;
                background: none; border: none; padding: 0 0 0 16px;
            }
            .fe-popup-close:hover { color: #000; }
            .fe-popup-show-row {
                display: flex; align-items: center; gap: 8px;
                margin-bottom: 12px; font-size: 13px; color: #555;
            }
            .fe-popup-show-chip {
                background: #f4f5f6; border-radius: 4px; padding: 4px 10px;
                font-weight: 500; color: #333;
            }
            .fe-popup-table-wrap {
                overflow: auto; border: 1px solid #eee; border-radius: 4px;
                flex: 1 1 auto; min-height: 0;
            }
            .fe-popup-table {
                width: 100%; border-collapse: collapse; font-size: 13px;
            }
            .fe-popup-table th {
                background: #f0f0f0; padding: 8px 10px;
                text-align: left; border: 1px solid #ddd; white-space: nowrap;
                position: sticky; top: 0;
            }
            .fe-popup-table td {
                padding: 7px 10px; border: 1px solid #eee; white-space: nowrap;
            }
            .fe-popup-table tr:nth-child(even) td { background: #fafafa; }
            .fe-popup-footer {
                display: flex; align-items: center; justify-content: space-between;
                margin-top: 14px;
            }
            .fe-popup-count { font-size: 12px; color: #888; }
            .fe-popup-download {
                background: #1a1a1a; color: #fff; border: none;
                border-radius: 5px; padding: 8px 16px; font-size: 13px;
                cursor: pointer;
            }
            .fe-popup-download:hover { background: #333; }
            .fe-popup-link { text-decoration: none; color: #2490ef; }
            .fe-popup-link:hover { text-decoration: underline; }
        `;
        document.head.appendChild(style);

        report.page.add_inner_button(__("Download Report"), function () {
            frappe.query_report.export_report("Excel");
        });

        // Delegate click on popup links in the report table
        $(report.page.wrapper).on("click", ".fe-popup-link", function (e) {
            e.preventDefault();
            const status   = $(this).data("status");
            const rawPopup = this.getAttribute("data-popup");
            let rows = [];
            try {
                rows = JSON.parse(rawPopup.replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
            } catch (_) {}
            show_fe_popup(status, rows);
        });
    }
};

function show_fe_popup(status, rows) {
    $(".fe-popup-overlay").remove();

    const columns = [
        { label: "Sr.No",                       fieldname: "sr_no" },
        { label: "Partner",                     fieldname: "partner" },
        { label: "State",                       fieldname: "state" },
        { label: "District",                    fieldname: "district" },
        { label: "Block",                       fieldname: "block" },
        { label: "Gram Panchayat",              fieldname: "gp" },
        { label: "Creche",                      fieldname: "creche" },
        { label: "Creche ID",                   fieldname: "creche_id" },
        { label: "Date of Delivery",            fieldname: "date_of_delivery" },
        { label: "Date of Expiry",              fieldname: "date_of_expiry" },
        { label: "Fire Extinguisher Status",    fieldname: "fire_extinguisher_status_display" },
    ];

    let thead = "<tr>" + columns.map(c => `<th>${c.label}</th>`).join("") + "</tr>";
    let tbody = rows.map(row =>
        "<tr>" + columns.map(c => `<td>${frappe.utils.escape_html(row[c.fieldname] ?? "")}</td>`).join("") + "</tr>"
    ).join("");

    const html = `
        <div class="fe-popup-overlay">
            <div class="fe-popup-box">
                <div class="fe-popup-header">
                    <h5>Fire Extinguisher Status &mdash; ${frappe.utils.escape_html(status)} (${rows.length})</h5>
                    <button class="fe-popup-close">&times;</button>
                </div>
                <div class="fe-popup-show-row">
                    <span>Show:</span>
                    <span class="fe-popup-show-chip">${frappe.utils.escape_html(status)}</span>
                </div>
                <div class="fe-popup-table-wrap">
                    <table class="fe-popup-table">
                        <thead>${thead}</thead>
                        <tbody>${tbody}</tbody>
                    </table>
                </div>
                <div class="fe-popup-footer">
                    <span class="fe-popup-count">Showing ${rows.length} of ${rows.length}</span>
                    <button class="fe-popup-download">Download (XLSX)</button>
                </div>
            </div>
        </div>
    `;

    const $overlay = $(html).appendTo("body");

    $overlay.on("click", function (e) {
        if ($(e.target).hasClass("fe-popup-overlay") || $(e.target).hasClass("fe-popup-close")) {
            $overlay.remove();
        }
    });

    $overlay.find(".fe-popup-download").on("click", function () {
        download_fe_rows_as_excel(rows, columns, `Fire_Extinguisher_${status.replace(/\s+/g, "_")}`);
    });

    $(document).one("keydown.fe_popup", function (e) {
        if (e.key === "Escape") {
            $overlay.remove();
            $(document).off("keydown.fe_popup");
        }
    });
}

function download_fe_rows_as_excel(rows, columns, filename) {
    let html = "<table border='1'><tr>" +
        columns.map(c => `<th>${frappe.utils.escape_html(c.label)}</th>`).join("") + "</tr>";
    rows.forEach(row => {
        html += "<tr>" + columns.map(c => `<td>${frappe.utils.escape_html(row[c.fieldname] ?? "")}</td>`).join("") + "</tr>";
    });
    html += "</table>";

    const blob = new Blob(["﻿" + html], { type: "application/vnd.ms-excel" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `${filename}.xls`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
