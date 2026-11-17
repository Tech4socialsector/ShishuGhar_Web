// Copyright (c) 2026, Frappe Technologies and contributors
// For license information, please see license.txt

frappe.query_reports["Enrollment & Exit Report"] = {
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
        
        // Age of Creche Filter - Updated with auto-calculation logic
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
        },
        // {
        //  "fieldname": "is_exited",
        //  "label": __("Is Exited"),
        //  "fieldtype": "Select",
        //  "options": [
        //      { "value": "", "label": __("") },
        //      { "value": "1", "label": __("Yes") },
        //  ],
        //  "default": "",
        //  "reqd": 0,
        // }

        {
            fieldname: "is_exited",
            label: __("Is Exited"),
            fieldtype: "Check",
            default: 0
        }
    ],

    // Added onload to append the custom Download Report and Logic buttons
    onload: function (report) {
        report.page.add_inner_button(__("Download Report"), function () {
            frappe.query_report.export_report("Excel");
        });

        setupLogicButton(report);
    }
};

// -------- Logic Features --------
// Mirrors the logic implemented in enrollment_&_exit_report.py
var logicSections = [
    {
        section: "1. Columns: Creche & Child Details",
        rows: [
            { title: "State, District, Block", logic: "Name of the State, District and Block of the child's creche." },
            { title: "Partner", logic: "Name of the Partner that runs the creche." },
            { title: "Supervisor", logic: "Full name of the supervisor assigned to the creche." },
            { title: "Creche Name", logic: "Name of the creche where the child is enrolled." },
            { title: "Child ID / Child Name", logic: "Taken as entered in the child's enrolment record." },
            { title: "Gender", logic: "M if the gender is Male, F if Female, otherwise Other." },
            { title: "Date of Birth", logic: "Child's date of birth, shown as DD-MM-YYYY." }
        ]
    },
    {
        section: "2. Columns: Enrollment, Exit & Age",
        rows: [
            { title: "Date of Enrollment", logic: "Date on which the child was enrolled, shown as DD-MM-YYYY." },
            {
                title: "Current Age",
                logic: "Age as on the end of the selected month, shown as Months (Days). Example: 18 (550) means 18 complete months and 550 total days. Blank if the date of birth is missing."
            },
            {
                title: "Age (At Enrollment)",
                logic: "Age on the Date of Enrollment, shown as Months (Days). Blank if the date of birth or enrolment date is missing."
            },
            { title: "Date of Exit", logic: "Date on which the child left the creche, shown as DD-MM-YYYY. Blank if the child has not exited." },
            {
                title: "Age (At Exit)",
                logic: "Age on the Date of Exit, shown as Months (Days). Blank if the date of birth or exit date is missing."
            },
            {
                title: "Is the child enrolled in AWC after 3 years for preschool?",
                logic: "Yes if the record is marked as enrolled in an Anganwadi Centre (AWC) for preschool, otherwise No."
            }
        ]
    },
    {
        section: "3. Columns: Measurement At Enrollment",
        rows: [
            { title: "Date of Measurement (At Enrollment)", logic: "Date on which the weight and height were measured, shown as DD-MM-YYYY." },
            {
                title: "Measurement Equipment (At Enrollment)",
                logic: "Stadiometer if equipment is 1, Infantometer if equipment is 2, otherwise \"-\"."
            },
            {
                title: "Measurement Position (At Enrollment)",
                logic: "Worked out from the equipment: Stadiometer gives Standing, Infantometer gives Lying, otherwise \"-\"."
            },
            { title: "Weight (At Enrollment)", logic: "Weight with 2 decimals. \"-\" if the weight is missing or 0." },
            { title: "Height (At Enrollment)", logic: "Height with 2 decimals. \"-\" if the height is missing or 0." }
        ]
    },
    {
        section: "4. Columns: Measurement At Exit",
        rows: [
            {
                title: "Date of Measurement (At Exit)",
                logic: "The column is on the screen, but the current query does not fetch this value, so it shows blank."
            },
            {
                title: "Measurement Equipment (At Exit)",
                logic: "Stadiometer if exit equipment is 1, Infantometer if 2, otherwise \"-\"."
            },
            {
                title: "Measurement Position (At Exit)",
                logic: "Worked out from the exit equipment: Stadiometer gives Standing, Infantometer gives Lying, otherwise \"-\"."
            },
            { title: "Weight (At Exit)", logic: "Weight at exit with 2 decimals. \"-\" if missing or 0." },
            { title: "Height (At Exit)", logic: "Height at exit with 2 decimals. \"-\" if missing or 0." }
        ]
    },
    {
        section: "5. Columns: Exit Details",
        rows: [
            { title: "Is Exited", logic: "Yes if the child has a Date of Exit, otherwise No." },
            {
                title: "Reason for Exit",
                logic: "Migrated (1), Graduated (2), Not willing to stay (3), Death (4), Other (5). \"-\" for any other value or if blank."
            },
            {
                title: "Reason for Exit Other",
                logic: "The reason typed in by the user, shown only when Reason for Exit is Other. \"-\" in all other cases."
            }
        ]
    }
];

function logicToPlainText(logic) {
    return Array.isArray(logic) ? logic.map(line => "• " + line).join("\n") : logic;
}

function logicToHtml(logic) {
    const esc = (text) => frappe.utils.escape_html(text);
    if (Array.isArray(logic)) {
        return `<ul style="margin: 0; padding-left: 18px;">${logic.map(line => `<li style="margin-bottom: 3px;">${esc(line)}</li>`).join("")}</ul>`;
    }
    return esc(logic);
}

function buildLogicTableRows() {
    let rowsHtml = "";
    logicSections.forEach(group => {
        rowsHtml += `
            <tr>
                <td colspan="2" style="padding: 10px 12px; border: 1px solid #ccd6e6; background-color: #e8eef7; color: #5979aa; font-weight: 700;">${frappe.utils.escape_html(group.section)}</td>
            </tr>
        `;
        group.rows.forEach((row, index) => {
            const bg = index % 2 === 0 ? "background-color: #f9f9f9;" : "background-color: #ffffff;";
            rowsHtml += `
                <tr style="${bg}">
                    <td style="padding: 10px 12px; border: 1px solid #ddd; font-weight: 600; color: #333; white-space: normal; vertical-align: top;">${frappe.utils.escape_html(row.title)}</td>
                    <td style="padding: 10px 12px; border: 1px solid #ddd; color: #555; white-space: normal; line-height: 1.5; vertical-align: top;">${logicToHtml(row.logic)}</td>
                </tr>
            `;
        });
    });
    return rowsHtml;
}

function setupLogicButton(report) {
    frappe.require("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js");
    frappe.require("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js");
    frappe.require("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");

    // Logic button next to the Download Report button
    const logicBtn = report.page.add_inner_button(__("Logic"), function () {
        openLogicModal();
    });
    if (logicBtn && logicBtn.css) {
        logicBtn.addClass("logic-btn").css({
            "background-color": "#5979aa",
            "color": "white",
            "border": "1px solid #5979aa",
            "border-radius": "4px",
            "font-weight": "500"
        });
    }

    // Build the modal once, replacing any copy left from an earlier visit
    $("#enrollExitLogicModal").remove();
    $("body").append(`
        <div id="enrollExitLogicModal" style="display: none; position: fixed; z-index: 10000; left: 0; top: 0; width: 100%; height: 100%; overflow: auto; background-color: rgba(0, 0, 0, 0.5); backdrop-filter: blur(3px);">
            <div id="logicModalContent" style="background-color: #fff; margin: 5% auto; padding: 20px; border-radius: 12px; width: 90%; max-width: 1200px; max-height: 90vh; overflow: hidden; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2); position: relative; display: flex; flex-direction: column;">
                <div style="display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 15px;">
                    <h2 style="flex: 1; margin: 0; font-size: 1.45rem; color: #5979aa;">Enrollment &amp; Exit Report Logic</h2>
                    <button id="downloadLogicXlsxBtn" style="padding: 6px 12px; background-color: #5979aa; color: white; border: none; border-radius: 4px; cursor: pointer;">Download XLSX</button>
                    <button id="downloadLogicPngBtn" style="padding: 6px 12px; background-color: #5979aa; color: white; border: none; border-radius: 4px; cursor: pointer;">Download PNG</button>
                    <button id="downloadLogicPdfBtn" style="padding: 6px 12px; background-color: #5979aa; color: white; border: none; border-radius: 4px; cursor: pointer;">Download PDF</button>
                    <button class="logic-close-btn" aria-label="Close" style="width: 36px; height: 36px; background: rgba(0,0,0,0.05); border: none; border-radius: 5px; font-size: 24px; cursor: pointer; display: flex; align-items: center; justify-content: center;">&times;</button>
                </div>

                <div id="logicTableWrapper" style="overflow-y: auto; max-height: 70vh; border-radius: 8px; border: 1px solid #ddd; background: white; padding: 10px;">
                    <table style="width: 100%; border-collapse: collapse; font-size: 14px; text-align: left;">
                        <thead style="position: sticky; top: -10px; background-color: #5979aa; color: white; z-index: 1;">
                            <tr>
                                <th style="padding: 12px; border: 1px solid #ccc; width: 30%;">Item</th>
                                <th style="padding: 12px; border: 1px solid #ccc; width: 70%;">Logic</th>
                            </tr>
                        </thead>
                        <tbody id="logicTableBody"></tbody>
                    </table>
                </div>
            </div>
        </div>
    `);
    $("#logicTableBody").html(buildLogicTableRows());

    function openLogicModal() {
        $("#enrollExitLogicModal").show();
        $("body").addClass("modal-open");
    }

    function closeLogicModal() {
        $("#enrollExitLogicModal").hide();
        $("body").removeClass("modal-open");
    }

    // Namespaced handlers so reopening the report never stacks duplicates
    $(document).off(".enrollExitLogic");
    $(document).on("click.enrollExitLogic", ".logic-close-btn", closeLogicModal);
    $(document).on("click.enrollExitLogic", "#enrollExitLogicModal", function (e) {
        if (e.target === this) closeLogicModal();
    });
    $(document).on("keydown.enrollExitLogic", function (e) {
        if (e.key === "Escape") closeLogicModal();
    });

    function setBusy(btn, busy, originalText) {
        btn.text(busy ? "Downloading..." : originalText);
        btn.prop("disabled", busy).css({ opacity: busy ? 0.6 : 1, cursor: busy ? "not-allowed" : "pointer" });
    }

    // Renders the whole modal (not just the visible part) to a canvas, then restores its styles
    function captureLogicCanvas() {
        const target = document.getElementById("logicModalContent");
        const wrapper = document.getElementById("logicTableWrapper");
        const saved = {
            wrapperMaxHeight: wrapper.style.maxHeight,
            wrapperOverflowY: wrapper.style.overflowY,
            targetMaxHeight: target.style.maxHeight,
            targetOverflow: target.style.overflow
        };

        wrapper.style.maxHeight = "none";
        wrapper.style.overflowY = "visible";
        target.style.maxHeight = "none";
        target.style.overflow = "visible";

        return html2canvas(target, {
            scale: 2,
            windowHeight: target.scrollHeight,
            scrollY: -window.scrollY
        }).finally(() => {
            wrapper.style.maxHeight = saved.wrapperMaxHeight;
            wrapper.style.overflowY = saved.wrapperOverflowY;
            target.style.maxHeight = saved.targetMaxHeight;
            target.style.overflow = saved.targetOverflow;
        });
    }

    $(document).on("click.enrollExitLogic", "#downloadLogicXlsxBtn", function (e) {
        e.preventDefault();
        const btn = $(this);
        const originalText = btn.text();
        setBusy(btn, true, originalText);

        setTimeout(() => {
            try {
                if (typeof XLSX === "undefined") {
                    frappe.msgprint(__("Export library is still loading. Please try again."));
                    return;
                }
                const rows = [];
                logicSections.forEach(group => {
                    group.rows.forEach(row => {
                        rows.push({ "Section": group.section, "Item": row.title, "Logic": logicToPlainText(row.logic) });
                    });
                });

                const worksheet = XLSX.utils.json_to_sheet(rows);
                worksheet["!cols"] = [{ wch: 36 }, { wch: 45 }, { wch: 110 }];
                const workbook = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(workbook, worksheet, "Report Logic");
                XLSX.writeFile(workbook, "enrollment_exit_report_logic.xlsx");
            } catch (err) {
                console.error("Error generating Logic XLSX", err);
                frappe.msgprint(__("Error generating XLSX."));
            } finally {
                setBusy(btn, false, originalText);
            }
        }, 100);
    });

    $(document).on("click.enrollExitLogic", "#downloadLogicPngBtn", function (e) {
        e.preventDefault();
        const btn = $(this);
        const originalText = btn.text();

        if (typeof html2canvas === "undefined") {
            frappe.msgprint(__("Export library is still loading. Please try again."));
            return;
        }
        setBusy(btn, true, originalText);

        setTimeout(() => {
            captureLogicCanvas().then(canvas => {
                canvas.toBlob(function (blob) {
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement("a");
                    link.href = url;
                    link.download = "enrollment_exit_report_logic.png";
                    link.click();
                    URL.revokeObjectURL(url);
                }, "image/png");
            }).catch(err => {
                console.error("Error generating Logic PNG", err);
                frappe.msgprint(__("Error generating PNG."));
            }).finally(() => setBusy(btn, false, originalText));
        }, 100);
    });

    $(document).on("click.enrollExitLogic", "#downloadLogicPdfBtn", function (e) {
        e.preventDefault();
        const btn = $(this);
        const originalText = btn.text();

        if (typeof html2canvas === "undefined" || (typeof window.jspdf === "undefined" && typeof jsPDF === "undefined")) {
            frappe.msgprint(__("Export library is still loading. Please try again."));
            return;
        }
        setBusy(btn, true, originalText);

        setTimeout(() => {
            captureLogicCanvas().then(canvas => {
                const { jsPDF: JSPDF } = window.jspdf || {};
                const JsPDF = JSPDF || window.jsPDF;

                const imgWidth = canvas.width;
                const imgHeight = canvas.height;
                const ratio = imgWidth / imgHeight;

                // A4 portrait, fit width, split into one slice per page
                const doc = new JsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
                const pageW = doc.internal.pageSize.getWidth();
                const pageH = doc.internal.pageSize.getHeight();
                const scaledW = pageW;
                const scaledH = scaledW / ratio;

                let yOffset = 0;
                let remaining = scaledH;

                while (remaining > 0) {
                    const sliceH = Math.min(remaining, pageH);
                    const srcY = yOffset * (imgHeight / scaledH);
                    const srcH = sliceH * (imgHeight / scaledH);

                    const sliceCanvas = document.createElement("canvas");
                    sliceCanvas.width = imgWidth;
                    sliceCanvas.height = srcH;
                    sliceCanvas.getContext("2d").drawImage(canvas, 0, srcY, imgWidth, srcH, 0, 0, imgWidth, srcH);

                    if (yOffset > 0) doc.addPage();
                    doc.addImage(sliceCanvas.toDataURL("image/png"), "PNG", 0, 0, scaledW, sliceH);

                    yOffset += sliceH;
                    remaining -= sliceH;
                }

                doc.save("enrollment_exit_report_logic.pdf");
            }).catch(err => {
                console.error("Error generating Logic PDF", err);
                frappe.msgprint(__("Error generating PDF."));
            }).finally(() => setBusy(btn, false, originalText));
        }, 100);
    });
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