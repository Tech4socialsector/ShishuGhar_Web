frappe.pages['review-report-card'].on_page_load = function (wrapper) {
    var page = frappe.ui.make_app_page({
        parent: wrapper,
        title: 'Review Report Card',
        single_column: true
    });

    frappe.require("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js");
    // Added html2canvas dependency for PNG download
    frappe.require("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js");

    let activeTab = 'attendance';

    const safetyCardSequenceConfig = [
        // --- Row 1 ---
        { id: "get_safety_submitted", queryType: "get_safety_submitted_data", title: "No of creches submitted safety checklist", section: "sec_1", color: "#D0E3F4" },
        { id: "get_safety_not_submitted", queryType: "get_safety_not_submitted_data", title: "No of creches not submitted safety checklist", section: "sec_1", color: "#D0E3F4" },
        { id: "get_safety_issues_identified_month", queryType: "get_safety_issues_identified_month_data", title: "No. of Safety Issues Identified this month", section: "sec_1", color: "#FCE4D6" },

        // --- Row 2 ---
        { id: "get_safety_issues_resolved_month", queryType: "get_safety_issues_resolved_month_data", title: "No. of Safety Issues Resolved this month", section: "sec_1", color: "#DDF2D1" },
        { id: "get_safety_issues_unresolved_month", queryType: "get_safety_issues_unresolved_month_data", title: "No. of Safety Issues Unresolved this month", section: "sec_1", color: "#FCE4D6" },
        { id: "get_safety_issues_identified_quarter", queryType: "get_safety_issues_identified_quarter_data", title: "No. of Safety Issues Identified this quarter", section: "sec_1", color: "#E6D8ED" },

        // --- Row 3 ---
        { id: "get_safety_issues_resolved_quarter", queryType: "get_safety_issues_resolved_quarter_data", title: "No. of Safety Issues Resolved this quarter", section: "sec_1", color: "#DDF2D1" },
        { id: "get_safety_issues_unresolved_quarter", queryType: "get_safety_issues_unresolved_quarter_data", title: "No. of Safety Issues Unresolved this quarter", section: "sec_1", color: "#E6D8ED" },
        { id: "get_safety_issues_unresolved_3_months", queryType: "get_safety_issues_unresolved_3_months_data", title: "No of Issues Unresolved for last 3 months", section: "sec_1", color: "#FCE4D6" },

        // --- Row 4 ---
        { id: "get_safety_issues_unresolved_6_months", queryType: "get_safety_issues_unresolved_6_months_data", title: "No of Issues Unresolved for last 6 months", section: "sec_1", color: "#FCE4D6" },
        { id: "get_safety_issues_infra", queryType: "get_safety_issues_infra_data", title: "No of creches with infrastructural & environmental safety issues", section: "sec_1", color: "#D0E3F4" },
        { id: "get_safety_issues_physical", queryType: "get_safety_issues_physical_data", title: "No of creches with physical safety & security issues", section: "sec_1", color: "#D0E3F4" },

        // --- Row 5 ---
        { id: "get_safety_issues_fire", queryType: "get_safety_issues_fire_data", title: "No of creches with fire safety issues", section: "sec_1", color: "#D0E3F4" },
        { id: "get_safety_issues_electrical", queryType: "get_safety_issues_electrical_data", title: "No of creches with electrical safety issues", section: "sec_1", color: "#D0E3F4" },
        { id: "get_safety_issues_food", queryType: "get_safety_issues_food_data", title: "No of creches with food safety issues", section: "sec_1", color: "#D0E3F4" },
        
        // --- Row 6 ---
        { id: "get_safety_issues_other", queryType: "get_safety_issues_other_data", title: "No of creches with other safety issues", section: "sec_1", color: "#D0E3F4" }
    ];

    const cardSequenceConfig = [
        // --- Row 1 ---
        { id: "get_avg_creche_opened", queryType: null, title: "Avg. No of Days Creche Opened", section: "sec_1", color: "#D0E3F4" },
        { id: "get_attendance_trend_improving", queryType: "get_attendance_trend_improving_data", title: "No of creches Attendance Monthly Trend Improving", section: "sec_1", color: "#FCE4D6" },
        { id: "get_attendance_improving", queryType: "get_attendance_improving_data", title: "No of creches Attendance Quarterly Trend Improving", section: "sec_1", color: "#E6D8ED" },

        // --- Row 2 ---
        { id: "get_avg_creche_closed", queryType: null, title: "Avg. No of Days Creche Closed", section: "sec_1", color: "#D0E3F4" },
        { id: "get_attendance_trend_deteriorating", queryType: "get_attendance_trend_deteriorating_data", title: "No of creches Attendance Monthly Trend Deteriorating", section: "sec_1", color: "#FCE4D6" },
        { id: "get_attendance_deteriorating", queryType: "get_attendance_deteriorating_data", title: "No of creches Attendance Quarterly Trend Deteriorating", section: "sec_1", color: "#E6D8ED" },

        // --- Row 3 ---
        { id: "get_creche_24", queryType: "get_creche_24_data", title: "No of Creches Opened Below 24 Days", section: "sec_1", color: "#D0E3F4" },
        { id: "get_attendance_trend_no_change", queryType: "get_attendance_trend_no_change_data", title: "No of creches Attendance Monthly Trend No Change", section: "sec_1", color: "#FCE4D6" },
        { id: "get_attendance_no_change", queryType: "get_attendance_no_change_data", title: "No of creches Attendance Quarterly Trend No Change", section: "sec_1", color: "#E6D8ED" },

        // --- Row 4 ---
        { id: "get_creche_attendance_not_submitted", queryType: "get_creche_attendance_not_submitted_data", title: "No of Creches not submitted attendance (full days)", section: "sec_1", color: "#D0E3F4" },
        { id: "get_attendance_below_25", queryType: "get_attendance_below_25_data", title: "No of creches with Attendance Below 25 %", section: "sec_1", color: "#DDF2D1" },
        { id: "get_attendance_below_75", queryType: "get_attendance_below_75_data", title: "No of creches with Attendance 50 - 75 %", section: "sec_1", color: "#DDF2D1" },

        // --- Row 5 ---
        { id: "get_avg_daily_attendance_10", queryType: "get_avg_daily_attendance_10_data", title: "No of creches with Daily Average Attendance Below 10", section: "sec_1", color: "#D0E3F4" },
        { id: "get_attendance_below_50", queryType: "get_attendance_below_50_data", title: "No of creches with Attendance 25 - 50 %", section: "sec_1", color: "#DDF2D1" },
        { id: "get_attendance_below_100", queryType: "get_attendance_below_100_data", title: "No of creches with Attendance 75 - 100 %", section: "sec_1", color: "#DDF2D1" }
    ];

    let filters = [
        {
            fieldname: "year",
            label: __("Year"),
            fieldtype: "Select",
            options: (() => {
                const start_year = 2024;
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
            "fieldname": "month",
            "label": __("Month"),
            "fieldtype": "Select",
            "options": [
                { "value": "1", "label": __("January") },
                { "value": "2", "label": __("February") },
                { "value": "3", "label": __("March") },
                { "value": "4", "label": __("April") },
                { "value": "5", "label": __("May") },
                { "value": "6", "label": __("June") },
                { "value": "7", "label": __("July") },
                { "value": "8", "label": __("August") },
                { "value": "9", "label": __("September") },
                { "value": "10", "label": __("October") },
                { "value": "11", "label": __("November") },
                { "value": "12", "label": __("December") }
            ],
            "default": (new Date().getMonth() + 1).toString(),
        },
        {
            "fieldname": "partner",
            "label": __("Partner"),
            "fieldtype": "Link",
            "options": "Partner",
            "default": frappe.defaults.get_user_default("partner"),
        },
        {
            "fieldname": "state",
            "label": __("State"),
            "fieldtype": "Link",
            "options": "State",
            "get_query": function () {
                return {
                    filters: { "is_active": 1 }
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
            "get_query": function () {
                return {
                    filters: { "is_active": 1 }
                };
            },
            "on_change": function () {
                frappe.query_report.refresh();
            }
        },
        {
            "fieldname": "block",
            "label": __("Block"),
            "fieldtype": "Link",
            "options": "Block",
            "get_query": function () {
                let district = page.fields_dict["district"].get_value();
                if (district) {
                    return { filters: { district_id: district } };
                }
                return {};
            }
        },
        {
            "fieldname": "gp",
            "label": __("Gram Panchayat"),
            "fieldtype": "Link",
            "options": "Gram Panchayat",
            "get_query": function () {
                let block = page.fields_dict["block"].get_value();
                if (block) {
                    return { filters: { block_id: block } };
                }
                return {};
            }
        },
        {
            "fieldname": "supervisor_id",
            "label": __("Supervisor"),
            "fieldtype": "Link",
            "options": "User",
            "get_query": function () {
                let creche = page.fields_dict["creche"].get_value();
                return creche ? { filters: { creche: creche } } : {};
            },
        },
        {
            "fieldname": "creche",
            "label": __("Creche"),
            "fieldtype": "Link",
            "options": "Creche",
            "get_query": function () {
                let gp = page.fields_dict["gp"].get_value();
                if (gp) {
                    return { filters: { gp_id: gp } };
                }
                return {};
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
        }
    ];

    filters.forEach(filter => {
        page.add_field(filter);
    });

    let cr_opening_range_type = page.add_field({
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
        default: ""
    });

    let active_creche_count_field = page.add_field({
        fieldname: "active_creche_count",
        label: __(" "),
        fieldtype: "Data",
        read_only: 1,
        default: ""
    });

    if (active_creche_count_field.$wrapper && cr_opening_range_type.$wrapper) {
        active_creche_count_field.$wrapper
            .css({ "width": cr_opening_range_type.$wrapper.css("width") || "" })
            .insertAfter(cr_opening_range_type.$wrapper);
        active_creche_count_field.$input.prop("disabled", true).css({
            "font-weight": "bold",
            "text-align": "center",
            "background-color": "#f0f0f0",
            "color": "#333",
            "cursor": "default"
        });
    }

    async function updateActiveCrecheCount() {
        const baseUrl = `${BASE_URL}api/method/frappe.apf.page.review_report_card.review_apis`;
        const apiParams = {
            partner_id: null, state_id: null, district_id: null, gp_id: null,
            block_id: null, supervisor_id: null, creche_id: null, year: null, month: null,
            cstart_date: null, cend_date: null, c_status: null, phases: null
        };

        const filterToApiKeyMap = {
            partner: "partner_id", state: "state_id", district: "district_id",
            gp: "gp_id", block: "block_id", supervisor_id: "supervisor_id",
            creche: "creche_id", year: "year", month: "month",
            creche_status_id: "c_status", phases: "phases"
        };

        Object.entries(filterToApiKeyMap).forEach(([fieldname, apiKey]) => {
            const field = page.fields_dict[fieldname];
            if (field) apiParams[apiKey] = field.get_value();
        });

        const rangeType = page.fields_dict["cr_opening_range_type"].get_value();
        const singleDate = page.fields_dict["single_date"].get_value();
        const dateRange = page.fields_dict["c_opening_range"].get_value();

        if (rangeType) {
            if (rangeType === "between" && dateRange && dateRange.length === 2) {
                apiParams.cstart_date = dateRange[0]; apiParams.cend_date = dateRange[1];
            } else if (rangeType === "before" && singleDate) {
                apiParams.cstart_date = "2017-01-01"; apiParams.cend_date = singleDate;
            } else if (rangeType === "after" && singleDate) {
                apiParams.cstart_date = singleDate; apiParams.cend_date = new Date().toISOString().split("T")[0];
            } else if (rangeType === "equal" && singleDate) {
                apiParams.cstart_date = singleDate; apiParams.cend_date = singleDate;
            }
        }

        const apiUrl = new URL(`${baseUrl}.get_active_creche_count`);
        Object.entries(apiParams).forEach(([key, value]) => {
            if (value) apiUrl.searchParams.append(key, value);
        });

        try {
            const response = await fetch(apiUrl.toString(), {
                method: "GET",
                credentials: "same-origin",
            });
            const data = await response.json();
            const count = (data && data.message !== undefined) ? data.message : 0;
            active_creche_count_field.set_value(`No. of Creches : ${formatNumber(count)}`);
        } catch (error) {
            console.error("Error fetching active creche count:", error);
            active_creche_count_field.set_value("No. of Creches : Error");
        }
    }

    let c_opening_range = page.add_field({
        fieldname: "c_opening_range",
        label: __("Creche Opening Range"),
        fieldtype: "DateRange",
        hidden: 1
    });

    let single_date = page.add_field({
        fieldname: "single_date",
        label: __("Creche Opening Date"),
        fieldtype: "Date",
        hidden: 1
    });

    cr_opening_range_type.$input.on("change", function () {
        let selected_value = cr_opening_range_type.get_value();
        c_opening_range.toggle(selected_value === "between");
        single_date.toggle(["before", "after", "equal"].includes(selected_value));

        if (selected_value === "between") {
            single_date.set_value(null);
        } else if (["before", "after", "equal"].includes(selected_value)) {
            c_opening_range.set_value(null);
        }
    });

    function resetForwardFilters(currentFilter) {
        let currentIndex = filters.findIndex(filter => filter.fieldname === currentFilter);
        if (currentIndex === -1) return;

        for (let i = currentIndex + 1; i < filters.length; i++) {
            if (page.fields_dict[filters[i].fieldname].df.fieldname == "creche_status_id" || page.fields_dict[filters[i].fieldname].df.fieldname == "phases")
                continue;
            page.fields_dict[filters[i].fieldname].set_value("");
        }
    }

    filters.forEach(filter => {
        if ((filter.fieldtype === "Link" || filter.fieldtype === "Select") && filter.fieldname != "year" && filter.fieldname != "month") {
            const input = page.fields_dict[filter.fieldname].input;
            if (input) {
                input.addEventListener("change", () => {
                    resetForwardFilters(filter.fieldname);
                });
            }
        }
    });

    let searchBtn = page.add_button(`<b>Search</b>`, async () => {
        searchBtn.prop('disabled', true);
        await renderCards();
        searchBtn.prop('disabled', false);
    });

    let resetBtn = page.add_button(`<b>Reset</b>`, async () => {
        resetBtn.prop('disabled', true);
        location.reload();
    });

    searchBtn.css({ "background-color": "#5979aa", "color": "white", "border-radius": "8px", "padding": "8px 16px", "font-weight": "bold" });
    resetBtn.css({ "background-color": "#F0F0F0", "color": "black", "border-radius": "8px", "padding": "8px 16px", "font-weight": "bold" });

    $(document).ready(function () {
        if ($(window).width() < 450) {
            $(".page-head.flex").css("padding-bottom", "10px");
        }

        $("#btn-attendance").on("click", function() {
            if (activeTab === 'attendance') return;
            activeTab = 'attendance';
            $(this).removeClass("inactive");
            $("#btn-safety").addClass("inactive");
            fetchDashboardData();
        });

        $("#btn-safety").on("click", function() {
            if (activeTab === 'safety') return;
            activeTab = 'safety';
            $(this).removeClass("inactive");
            $("#btn-attendance").addClass("inactive");
            fetchDashboardData();
        });
    });

    page.wrapper.find('.custom-actions').removeClass('hidden-xs hidden-md').css({ "display": "flex", "gap": "8px" });
    page.wrapper.find(".menu-btn-group ").removeClass('show"').css({ "display": "none" });

    page.main.append(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Creche Report</title>
            <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
            <style>
                body { margin: 0; font-family: 'Arial', sans-serif; background-color: #fff; color: #333; }
                .filters { display: flex; flex-wrap: wrap; gap: 15px; padding: 30px 20px; background-color: white; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1); border-radius: 10px; }
                select { width: 160px; padding: 8px; font-size: 1em; border: 1px solid #ddd; border-radius: 4px; background-color: #fff; color: #333; }
                .filter-buttons { display: flex; gap: 10px; }
                .page-form{ border-radius:8px; }
                .modern-btn { padding: 0px 20px; font-size: 16px; border: none; border-radius: 5px; cursor: pointer; transition: all 0.3s ease; min-height: 30px; }
                .reset-btn { background-color: #5979aa; color: white; }
                .reset-btn:hover { background-color: #5072A7; }
                .search-btn { background-color: #4CAF50; color: white; }
                .search-btn:hover { background-color: #388E3C; }
                
                /* --- Indicator Tabs CSS (Adjusted Margins) --- */
                .indicator-tabs { display: flex; gap: 10px; margin-top: 5px; margin-bottom: 5px; }
                .indicator-btn { background-color: #5979aa; color: white; border: none; border-radius: 4px; padding: 8px 24px; font-size: 14px; font-weight: bold; cursor: pointer; transition: all 0.3s ease; }
                .indicator-btn:hover { background-color: #4a658f; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
                /* Future inactive states */
                .indicator-btn.inactive { background-color: #f0f0f0; color: #333; }
                
                /* Grid is updated to 3 columns to match the new layout */
                .section-container { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-bottom: 30px; }
                
                @media (max-width: 1024px) { .section-container { grid-template-columns: repeat(2, 1fr); } }
                @media (max-width: 768px) { .section-container { grid-template-columns: repeat(1, 1fr); } }
                .card { background-color: #fff; padding:5px 20px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); text-align: left; transition: transform 0.3s ease-in-out, box-shadow 0.3s ease; }
                .card:hover { transform: translateY(-5px); box-shadow: 0 8px 20px rgba(0, 0, 0, 0.15); }
                .card h3 { font-size: 1.2em; color: #333; margin-bottom: 10px; }
                .card p { font-size: 2em; font-weight: bold; color: #000; }
                .card span { font-size: 0.9em; color: #666; }
                .spinner-container { margin:auto !important; display: none; flex-direction: column; justify-content: center; align-items: center; height: 100vh; width: 100%; }
                .percentage-text { display:none; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 10px; font-weight: bold; color: #333; z-index: 10; }
                .loader { width: 48px; height: 48px; border: 5px dotted #FFF; border-radius: 50%; display: none; position: relative; box-sizing: border-box; animation: rotation 2s linear infinite; }
                @keyframes rotation { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } } 
                @keyframes rotationBack { 0% { transform: rotate(0deg); } 100% { transform: rotate(-360deg); } }
                .filter-desc { margin-top: 0px; } /* Adjusted Margin */
                #dataModal { display: none; position: fixed; z-index: 9999; left: 0; top: 0; width: 100%; height: 100%; overflow: auto; background-color: rgba(0, 0, 0, 0.5); backdrop-filter: blur(3px); }
                body.modal-open { overflow: hidden; }
                .modal-content { background-color: #fff; margin: 5% auto; padding: 20px; border-radius: 12px; width: 90%; max-width: 95vw; max-height: 95vh; overflow: hidden; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2); position: relative; animation: slideDown 0.3s ease; }
                @keyframes slideDown { from { opacity: 0; transform: translateY(-20px); } to { opacity: 1; transform: translateY(0); } }
                #modalTableContainer { max-height: 400px; overflow-y: auto; margin-top: 20px; border-radius: 8px; border: 1px solid #ddd; }
                #modalTableContainer table { width: 100%; border-collapse: collapse; table-layout: auto; border: 1px solid #ccc; }
                #modalTableContainer thead th { white-space: nowrap; text-align: center; width: 1%; position: sticky; top: 0; background-color: #5979aa; color: white; z-index: 1; }
                #modalTableContainer::-webkit-scrollbar { width: 3px; height: 3px; }
                #modalTableContainer::-webkit-scrollbar-thumb { background-color: rgba(0, 0, 0, 0.3); border-radius: 4px; }
                #modalTableContainer::-webkit-scrollbar-track { background-color: transparent; }
                #modalTableContainer th, #modalTableContainer td { padding: 12px; text-align: center; border-bottom: 1px solid #eee; white-space: nowrap; border: 1px solid #ccc; }
                .close-btn { width: 36px; height: 36px; padding: 0; background: rgba(0, 0, 0, 0.05); border: none; border-radius:5%; font-size: 24px; color: #333; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: background 0.2s, transform 0.2s; }
                .close-btn:hover { background: #ffe5e9; transform: rotate(90deg); }
                .close-btn:active { background: rgba(0, 0, 0, 0.15); transform: scale(0.9); }
                @media (max-width: 768px) { .modal-content { width: 95%; padding: 15px; } #modalTableContainer th, #modalTableContainer td { padding: 10px 6px; font-size: 14px; } }
                .skeleton-table { width: 100%; border-collapse: collapse; }
                .skeleton-table th, .skeleton-table td { padding: 8px; border: 1px solid #ddd; }
                .skeleton-box { height: 16px; background: linear-gradient(90deg, #e0e0e0 25%, #f5f5f5 50%, #e0e0e0 75%); background-size: 200% 100%; animation: shimmer 1.2s infinite; border-radius: 4px; }
                @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
                .search-mobile { display: none; }
                .search-desktop { display: block; }
                @media (max-width: 600px) { .search-desktop { display: none; } .search-mobile { display: block; } }
            </style>
        </head>
        <body>
            <div style="display: flex; flex-direction: column;">
                <div class="filter-desc"></div>

                <!-- Added Indicator Tabs Container -->
                <div class="indicator-tabs">
                    <button class="indicator-btn" id="btn-attendance">Attendance</button>
                    <button class="indicator-btn inactive" id="btn-safety">Safety</button>
                </div>

                <div class="spinner-container" style="margin: auto;">
                    <div class="loader-wrapper">
                        <span class="loader"></span>
                        <div class="percentage-text">0%</div> 
                    </div>
                </div>
                <!-- Adjusted Margin on sections container -->
                <div id="all-sections-container" style="margin-top: 10px; margin-bottom: 20px;"></div>
            </div>
            <div id="dataModal">
                <div class="modal-content" style="position: relative; padding-top: 30px;">
                    <div id="modalHeaderWrapper" style="display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 10px;">
                        <h2 style="flex: 1; min-width: 200px; margin: 0; font-size : 1.45rem; ">Current active children</h2>
                        <div class="search-desktop" style="position: relative; flex: 1; min-width: 250px;">
                            <input id="modalSearchInput" type="text" placeholder="Search by Creche or Child Name..." style="width: 100%; outline: none; padding: 6px 32px 8px 10px; border: 1px solid #ccc; border-radius: 4px;">
                            <span style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); color: #888;">🔍</span>
                        </div>
                    <button id="downloadDataBtn" style="padding: 6px 12px; background-color: #5979aa; color: white; border: none; border-radius: 4px; cursor: pointer;">Download Data</button>
                    <button class="close-btn" aria-label="Close">&times;</button>
                    </div>
                    <div class="search-mobile" style="position: relative; flex: 1; min-width: 250px;">
                            <input id="modalSearchInput" type="text" placeholder="Search by Creche or Child Name..." style="width: 100%; padding: 6px 32px 8px 10px; border: 1px solid #ccc; border-radius: 4px;">
                            <span style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); color: #888;">🔍</span>
                        </div>
                    <div id="modalTableContainer"></div>
                </div>
            </div>

            <div id="logicModal" style="display: none; position: fixed; z-index: 10000; left: 0; top: 0; width: 100%; height: 100%; overflow: auto; background-color: rgba(0, 0, 0, 0.5); backdrop-filter: blur(3px);">
                <div id="logicModalContent" class="modal-content" style="background-color: #fff; margin: 5% auto; padding: 20px; border-radius: 12px; width: 90%; max-width: 1200px; max-height: 90vh; overflow: hidden; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2); position: relative; display: flex; flex-direction: column; animation: slideDown 0.3s ease;">
                    <div style="display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 15px;">
                        <h2 style="flex: 1; margin: 0; font-size: 1.45rem; color: #5979aa;">Card Logic</h2>
                        <button id="downloadLogicXlsxBtn" style="padding: 6px 12px; background-color: #5979aa; color: white; border: none; border-radius: 4px; cursor: pointer;">Download XLSX</button>
                        <button id="downloadLogicPngBtn" style="padding: 6px 12px; background-color: #5979aa; color: white; border: none; border-radius: 4px; cursor: pointer;">Download PNG</button>
                        <button class="logic-close-btn" aria-label="Close" style="width: 36px; height: 36px; background: rgba(0,0,0,0.05); border: none; border-radius: 5px; font-size: 24px; cursor: pointer; display: flex; align-items: center; justify-content: center;">&times;</button>
                    </div>

                    <div id="logicTableWrapper" style="overflow-y: auto; max-height: 70vh; border-radius: 8px; border: 1px solid #ddd; background: white; padding: 10px;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 14px; text-align: left;">
                            <thead style="position: sticky; top: -10px; background-color: #5979aa; color: white; z-index: 1;">
                                <tr>
                                    <th style="padding: 12px; border: 1px solid #ccc; width: 20%;">Section</th>
                                    <th style="padding: 12px; border: 1px solid #ccc; width: 25%;">Card Title</th>
                                    <th style="padding: 12px; border: 1px solid #ccc; width: 55%;">Logic</th>
                                </tr>
                            </thead>
                            <tbody id="logicTableBody">
                                </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </body>
        </html>
    `);

    const BASE_URL = "https://shishughar.in/";
    const cardReferences = {};

    function createCardWithLoader(cardId, title) {
        const card = document.createElement('div');
        card.classList.add('card');
        card.dataset.cardId = cardId;
        card.style.padding = '20px';
        card.style.minHeight = '150px';
        card.style.border = '1px solid #ccc';
        card.style.borderRadius = '8px';
        card.style.backgroundColor = '#ffffff';
        card.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1)';
        card.style.textAlign = 'center';
        card.style.position = 'relative';

        card.innerHTML = `
            <div class="card-content" style="position: relative; z-index: 1;">
                <div class="number-loader" style="font-size: 36px; font-weight: bold; color: #333; min-height: 48px; display: flex; align-items: center; justify-content: center;">
                    <span class="mini-loader" style="width: 24px; height: 24px; border: 2px solid #f3f3f3; border-top: 2px solid #5979aa; border-radius: 50%; animation: spin 1s linear infinite;"></span>
                </div>
                <div style="font-size: 18px; color: #666;">${title}</div>
                <div class="extra-line" style="font-size: 10px; color: #000; font-style: italic; font-weight: 600;"></div>
            </div>
            <div class="card-overlay" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(211, 211, 211, 0.7); border-radius: 8px; display: none; align-items: center; justify-content: center; z-index: 2; opacity: 0; transition: opacity 0.3s ease;">
                <span class="overlay-loader" style="width: 32px; height: 32px; border: 3px solid #f3f3f3; border-top: 3px solid #5979aa; border-radius: 50%; animation: spin 1s linear infinite;"></span>
            </div>
        `;
        cardReferences[cardId] = card;
        return card;
    }

    function updateCardData(cardId, value, extraLine = '') {
        const card = cardReferences[cardId];
        if (!card) return;

        const numberElement = card.querySelector('.number-loader');
        const extraLineElement = card.querySelector('.extra-line');

        numberElement.innerHTML = formatNumber(value);
        numberElement.style.minHeight = 'auto';

        if (extraLine) {
            extraLineElement.innerHTML = extraLine;
        } else {
            extraLineElement.innerHTML = '';
        }

        const activeConfig = activeTab === 'attendance' ? cardSequenceConfig : safetyCardSequenceConfig;
        const config = activeConfig.find(c => c.id === cardId);
        if (config && config.queryType && value) {
            card.style.cursor = "pointer";
            card.addEventListener("click", () => handleCardClick(cardId, { id: cardId, value: value, title: card.querySelector('div:nth-child(2)').textContent }, card));
        }
    }

    function createAllCardPlaceholders() {
        const container = document.getElementById('all-sections-container');
        container.innerHTML = '';

        // Only one section needed for the unified 3-column layout
        const sections = ['sec_1'];

        sections.forEach(secName => {
            const activeConfig = activeTab === 'attendance' ? cardSequenceConfig : safetyCardSequenceConfig;
            const sectionCards = activeConfig.filter(c => c.section === secName);
            if (sectionCards.length === 0) return;

            const sectionDiv = document.createElement('div');
            sectionDiv.classList.add('section-container');

            sectionCards.forEach(config => {
                const card = createCardWithLoader(config.id, config.title);
                card.style.backgroundColor = config.color || '#ffffff';
                sectionDiv.appendChild(card);
            });

            container.appendChild(sectionDiv);
        });
    }

    async function fetchDashboardData() {
        const baseUrl = `${BASE_URL}api/method/frappe.apf.page.review_report_card.review_apis`;

        const apiParams = {
            partner_id: null, state_id: null, district_id: null, gp_id: null,
            block_id: null, supervisor_id: null, creche_id: null, year: null, month: null,
            cstart_date: null, cend_date: null, c_status: null, phases: null
        };

        const filterToApiKeyMap = {
            partner: "partner_id", state: "state_id", district: "district_id",
            gp: "gp_id", block: "block_id", supervisor_id: "supervisor_id",
            creche: "creche_id", year: "year", month: "month",
            creche_status_id: "c_status", phases: "phases"
        };

        Object.entries(filterToApiKeyMap).forEach(([fieldname, apiKey]) => {
            const field = page.fields_dict[fieldname];
            if (field) apiParams[apiKey] = field.get_value();
        });

        const rangeType = page.fields_dict["cr_opening_range_type"].get_value();
        const singleDate = page.fields_dict["single_date"].get_value();
        const dateRange = page.fields_dict["c_opening_range"].get_value();

        if (rangeType) {
            if (rangeType === "between" && dateRange && dateRange.length === 2) {
                apiParams.cstart_date = dateRange[0]; apiParams.cend_date = dateRange[1];
            } else if (rangeType === "before" && singleDate) {
                apiParams.cstart_date = "2017-01-01"; apiParams.cend_date = singleDate;
            } else if (rangeType === "after" && singleDate) {
                apiParams.cstart_date = singleDate; apiParams.cend_date = new Date().toISOString().split("T")[0];
            } else if (rangeType === "equal" && singleDate) {
                apiParams.cstart_date = singleDate; apiParams.cend_date = singleDate;
            }
        }

        createAllCardPlaceholders();

        const activeConfig = activeTab === 'attendance' ? cardSequenceConfig : safetyCardSequenceConfig;

        await Promise.all(activeConfig.map(async (config) => {
            const apiUrl = new URL(`${baseUrl}.${config.id}`);

            Object.entries(apiParams).forEach(([key, value]) => {
                if (value) apiUrl.searchParams.append(key, value);
            });

            try {
                const response = await fetch(apiUrl.toString(), {
                    method: "GET",
                    credentials: "same-origin",
                });

                const data = await response.json();

                let valueToDisplay = 0;
                if (data && data.message !== undefined) {
                    valueToDisplay = data.message;
                } else if (data && data.data !== undefined) {
                    valueToDisplay = data.data;
                }

                updateCardData(config.id, valueToDisplay);
            } catch (error) {
                console.error(`Error fetching data for ${config.id}:`, error);
                updateCardData(config.id, 0, "Error loading data");
            }
        }));
    }

    function formatNumber(number) {
        return new Intl.NumberFormat("en-IN").format(number);
    }

    async function handleCardClick(cardId, item, cardElement) {
        const overlay = cardElement.querySelector('.card-overlay');

        if (overlay) {
            overlay.style.display = 'flex';
            setTimeout(() => overlay.style.opacity = '1', 10);
        }

        const activeConfig = activeTab === 'attendance' ? cardSequenceConfig : safetyCardSequenceConfig;
        const config = activeConfig.find(c => c.id === cardId);
        const queryType = config ? config.queryType : null;
        if (!queryType) {
            if (overlay) overlay.style.display = 'none';
            return;
        }

        const year = page.fields_dict["year"].get_value() || 2024;
        const month = page.fields_dict["month"].get_value() || 10;
        const partner = page.fields_dict["partner"].get_value();
        const state = page.fields_dict["state"].get_value();
        const district = page.fields_dict["district"].get_value();
        const block = page.fields_dict["block"].get_value();
        const gp = page.fields_dict["gp"].get_value();
        const supervisor_id = page.fields_dict["supervisor_id"].get_value();
        const creche = page.fields_dict["creche"].get_value();
        const phases = page.fields_dict["phases"].get_value();
        const creche_status_id = page.fields_dict["creche_status_id"].get_value();
        const rangeType = page.fields_dict["cr_opening_range_type"].get_value();
        const singleDate = page.fields_dict["single_date"].get_value();
        const dateRange = page.fields_dict["c_opening_range"].get_value();

        let cstart_date = null;
        let cend_date = null;

        if (rangeType) {
            if (rangeType === "between" && dateRange && dateRange.length === 2) {
                cstart_date = dateRange[0]; cend_date = dateRange[1];
            } else if (rangeType === "before" && singleDate) {
                cstart_date = "2017-01-01"; cend_date = singleDate;
            } else if (rangeType === "after" && singleDate) {
                cstart_date = singleDate; cend_date = new Date().toISOString().split("T")[0];
            } else if (rangeType === "equal" && singleDate) {
                cstart_date = singleDate; cend_date = singleDate;
            }
        }

        const rawParams = {
            year, month, partner_id: partner, state_id: state, district_id: district,
            block_id: block, gp_id: gp, supervisor_id, creche_id: creche, phases,
            c_status: creche_status_id, cstart_date, cend_date, query_type: queryType
        };

        const params = new URLSearchParams();
        for (const key in rawParams) {
            if (rawParams[key] !== null && rawParams[key] !== undefined && rawParams[key] !== "") {
                params.append(key, rawParams[key]);
            }
        }

        const apiUrl = `${BASE_URL}api/method/frappe.apf.page.review_report_card.review_details_apis.fetch_card_data?${params.toString()}`;
        const title = item.title;

        try {
            const res = await fetch(apiUrl);
            const result = await res.json();

            const responseData = result.message || result.data || [];

            if (responseData && responseData.length > 0) {
                const allColumns = Object.keys(responseData[0]);
                const columns = allColumns.filter(c => !c.startsWith("_"));
                const rows = responseData.map(entry => {
                    const rowArr = columns.map(key => entry[key]);
                    rowArr._raw = entry;
                    return rowArr;
                });
                openModalWithTable(columns, rows, title, { year, month, creche_status_id });
            } else {
                openModalWithTable([""], [["No record found"]], title, { year, month });
            }
        } catch (err) {
            console.error("Error fetching card data:", err);
            openModalWithTable([""], [["Error fetching data"]], title, { year, month });
        }
        finally {
            if (overlay) {
                overlay.style.opacity = '0';
                setTimeout(() => {
                    overlay.style.display = 'none';
                }, 300);
            }
        }
    }

    function openModalWithTable(columns, data, title, context) {
        const modal = document.getElementById("dataModal");
        const container = document.getElementById("modalTableContainer");
        const titleElement = modal.querySelector("h2");
        const searchInput = document.getElementById("modalSearchInput");

        modal.currentData = { columns, data, title };
        titleElement.textContent = title;
        document.body.classList.add("modal-open");
        modal.style.display = "block";

        container.innerHTML = "";
        container.appendChild(createSkeletonTable(columns.length + 1, 10));

        setTimeout(() => {
            container.innerHTML = "";
            const table = document.createElement("table");
            table.className = "data-table";
            const thead = table.createTHead();
            const headerRow = thead.insertRow();

            const serialTh = document.createElement("th");
            serialTh.textContent = "S.No.";
            headerRow.appendChild(serialTh);

            columns.forEach(col => {
                const th = document.createElement("th");
                th.textContent = col;
                headerRow.appendChild(th);
            });

            const tbody = table.createTBody();
            container.appendChild(table);

            const batchSize = 100;
            let currentRenderId = 0;

            function renderTableRows(dataset) {
                const renderId = ++currentRenderId;
                tbody.innerHTML = "";

                let rowIndex = 0;

                function renderChunk() {
                    if (renderId !== currentRenderId) return;

                    const end = Math.min(rowIndex + batchSize, dataset.length);
                    const fragment = document.createDocumentFragment();

                    for (; rowIndex < end; rowIndex++) {
                        const tr = document.createElement('tr');

                        const serialCell = document.createElement('td');
                        serialCell.textContent = rowIndex + 1;
                        tr.appendChild(serialCell);

                        dataset[rowIndex].forEach((cell, cellIndex) => {
                            const td = document.createElement('td');
                            td.style.textAlign = "left";
                            
                            const currentRowRaw = dataset[rowIndex]._raw;
                            
                            if (columns[cellIndex] === "Total No of Day Creche Opened" && currentRowRaw && currentRowRaw["_creche_name"]) {
                                const gapYear = context && context.year ? context.year : "";
                                const gapMonth = String(context && context.month ? context.month : "").padStart(2, "0");
                                const gapCreche = currentRowRaw["_creche_name"];
                                const gapStatus = currentRowRaw["_creche_status_id"];

                                const gapParams = new URLSearchParams();
                                if (gapYear) gapParams.append("year", gapYear);
                                if (gapMonth) gapParams.append("month", gapMonth);
                                if (gapCreche) gapParams.append("creche", gapCreche);
                                if (gapStatus) gapParams.append("creche_status_id", gapStatus);

                                const link = document.createElement("a");
                                link.href = `${BASE_URL}app/query-report/Attendance%20Gap?${gapParams.toString()}`;
                                link.target = "_blank";
                                link.rel = "noopener noreferrer";
                                link.style.color = "var(--primary-color, #2490ef)";
                                link.style.textDecoration = "underline";
                                link.textContent = cell;
                                td.appendChild(link);
                            } else if (columns[cellIndex] === "Safety Issues" && currentRowRaw && currentRowRaw["_safety_issues_list"]) {
                                const safetyYear = context && context.year ? context.year : "";
                                const safetyMonth = String(context && context.month ? context.month : "").padStart(2, "0");
                                const safetyCreche = currentRowRaw["_creche_doc_name"];
                                const safetyStatus = context && context.creche_status_id ? context.creche_status_id : "";

                                const safetyParams = new URLSearchParams();
                                if (safetyYear) safetyParams.append("year", safetyYear);
                                if (safetyMonth) safetyParams.append("month", safetyMonth);
                                if (safetyCreche) safetyParams.append("creche", safetyCreche);
                                if (safetyStatus) safetyParams.append("creche_status_id", safetyStatus);
                                safetyParams.append("safety_indicators", "1");

                                const link = document.createElement("a");
                                link.href = `${BASE_URL}app/query-report/Safety%20status?${safetyParams.toString()}`;
                                link.target = "_blank";
                                link.rel = "noopener noreferrer";
                                link.style.color = "var(--primary-color, #2490ef)";
                                link.style.textDecoration = "underline";
                                link.textContent = cell;
                                td.appendChild(link);
                            } else {
                                td.textContent = cell;
                            }
                            
                            tr.appendChild(td);
                        });

                        fragment.appendChild(tr);
                    }

                    tbody.appendChild(fragment);

                    if (rowIndex < dataset.length) {
                        requestAnimationFrame(renderChunk);
                    }
                }

                renderChunk();
            }

            let filteredData = [...data];
            renderTableRows(filteredData);
            let searchTimeout;

            const newSearchInput = searchInput.cloneNode(true);
            if (searchInput.parentNode) {
                searchInput.parentNode.replaceChild(newSearchInput, searchInput);
            }

            newSearchInput.addEventListener("input", function () {
                clearTimeout(searchTimeout);
                const q = this.value.toLowerCase();

                searchTimeout = setTimeout(() => {
                    if (q === '') {
                        filteredData = [...data];
                    } else {
                        filteredData = data.filter(row =>
                            row.some(cell =>
                                typeof cell === "string" && cell.toLowerCase().includes(q)
                            )
                        );
                    }
                    renderTableRows(filteredData);
                }, 150);
            });

        }, 300);
    }

    function createSkeletonTable(colCount, rowCount) {
        const table = document.createElement("table");
        table.className = "skeleton-table";

        const thead = table.createTHead();
        const headerRow = thead.insertRow();
        for (let i = 0; i < colCount; i++) {
            const th = document.createElement("th");
            th.innerHTML = `<div class="skeleton-box"></div>`;
            headerRow.appendChild(th);
        }

        const tbody = table.createTBody();
        for (let i = 0; i < rowCount; i++) {
            const tr = tbody.insertRow();
            for (let j = 0; j < colCount; j++) {
                const td = tr.insertCell();
                td.innerHTML = `<div class="skeleton-box"></div>`;
            }
        }

        return table;
    }

    function closeModal() {
        const searchInput = document.getElementById("modalSearchInput");
        searchInput.value = ""
        document.getElementById("dataModal").style.display = "none";
        document.body.classList.remove("modal-open");
    }

    document.querySelector(".close-btn").addEventListener("click", closeModal);
    window.addEventListener("click", (event) => {
        if (event.target === document.getElementById("dataModal")) {
            closeModal();
        }
    });

    document.addEventListener("click", function (e) {
        if (e.target && e.target.id === "downloadDataBtn") {
            const modal = document.getElementById("dataModal");
            if (modal.currentData) {
                const { columns, data, title } = modal.currentData;
                exportToExcel(["S.No.", ...columns], data.map((row, index) => [index + 1, ...row]), title);
            } else {
                alert("No data available to download");
            }
        }
    });

    function exportToExcel(columns, data, title) {
        const wb = XLSX.utils.book_new();
        const excelData = [columns, ...data];
        const ws = XLSX.utils.aoa_to_sheet(excelData);
        XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
        XLSX.writeFile(wb, `${title.replace(/ /g, '_')}.xlsx`);
    }

    // ==========================================
    // PNG AND CSV DOWNLOAD IMPLEMENTATION
    // ==========================================

    function buildFilterSummaryEl(captureWidth) {
        const monthNames = {
            "1": "January", "2": "February", "3": "March", "4": "April",
            "5": "May", "6": "June", "7": "July", "8": "August",
            "9": "September", "10": "October", "11": "November", "12": "December"
        };
        const statusLabels = {
            "1": "Planned", "2": "Plan dropped", "3": "Active/Operational", "4": "Closed"
        };

        const fieldDefs = [
            { key: "year", label: "Year" },
            { key: "month", label: "Month", map: monthNames },
            { key: "partner", label: "Partner", isLink: true },
            { key: "state", label: "State", isLink: true },
            { key: "district", label: "District", isLink: true },
            { key: "block", label: "Block", isLink: true },
            { key: "gp", label: "Gram Panchayat", isLink: true },
            { key: "supervisor_id", label: "Supervisor", isLink: true },
            { key: "creche", label: "Creche", isLink: true },
            { key: "phases", label: "Phase" },
            { key: "creche_status_id", label: "Creche Status", map: statusLabels }
        ];

        const chips = [];
        fieldDefs.forEach(({ key, label, map, isLink }) => {
            const field = page.fields_dict[key];
            if (!field) return;

            let val = isLink
                ? (field.$input && field.$input.val ? field.$input.val().trim() : field.get_value())
                : field.get_value();

            if (!val && val !== 0) return;

            // Format array in case of MultiSelect like phases
            if (Array.isArray(val)) val = val.join(', ');

            if (map && map[val]) val = map[val];
            chips.push(`<span style="display:inline-block;background:#eef2f8;border:1px solid #c8d5e8;border-radius:4px;padding:3px 10px;font-size:12px;color:#333;margin:3px 4px 3px 0;"><b style="color:#5979aa;">${label}:</b> ${val}</span>`);
        });

        const rangeType = page.fields_dict["cr_opening_range_type"] && page.fields_dict["cr_opening_range_type"].get_value();
        if (rangeType) {
            const singleDate = page.fields_dict["single_date"] && page.fields_dict["single_date"].get_value();
            const dateRange = page.fields_dict["c_opening_range"] && page.fields_dict["c_opening_range"].get_value();
            let dateVal = "";
            if (rangeType === "between" && dateRange && dateRange.length === 2)
                dateVal = `${dateRange[0]} to ${dateRange[1]}`;
            else if (singleDate)
                dateVal = `${rangeType} ${singleDate}`;
            if (dateVal)
                chips.push(`<span style="display:inline-block;background:#eef2f8;border:1px solid #c8d5e8;border-radius:4px;padding:3px 10px;font-size:12px;color:#333;margin:3px 4px 3px 0;"><b style="color:#5979aa;">Opening Date:</b> ${dateVal}</span>`);
        }

        const el = document.createElement('div');
        el.style.cssText = `width:${captureWidth}px;background:#f8fafd;border:1px solid #dce6f0;border-radius:8px;padding:10px 14px;margin-bottom:14px;box-sizing:border-box;font-family:Arial,sans-serif;`;
        el.innerHTML = `<div style="font-size:13px;font-weight:700;color:#5979aa;margin-bottom:6px;">Applied Filters</div><div>${chips.length ? chips.join('') : '<span style="font-size:12px;color:#888;">No filters applied</span>'}</div>`;
        return el;
    }

    async function downloadCardsPNG() {
        return new Promise((resolve) => {
            const container = document.getElementById('all-sections-container');
            if (!container) return resolve();

            if (typeof html2canvas === 'undefined') {
                frappe.msgprint("Image generation library is still loading. Please try again in a moment.");
                return resolve();
            }

            const cardsArea = container;
            const captureWidth = Math.max(cardsArea.scrollWidth, 1200);

            const wrapper = document.createElement('div');
            wrapper.style.cssText = [
                'position:absolute', 'top:0', 'left:-99999px', 'background:#fff',
                `width:${captureWidth}px`, 'padding:16px', 'box-sizing:border-box',
                'font-family:Arial,sans-serif'
            ].join(';');

            wrapper.appendChild(buildFilterSummaryEl(captureWidth - 32));

            const cardsClone = cardsArea.cloneNode(true);
            wrapper.appendChild(cardsClone);

            document.body.appendChild(wrapper);

            const originalScrollX = window.scrollX;
            const originalScrollY = window.scrollY;
            window.scrollTo(0, 0);

            setTimeout(() => {
                html2canvas(wrapper, {
                    scale: 2, useCORS: true, backgroundColor: "#ffffff", logging: false,
                    scrollX: 0, scrollY: 0, width: wrapper.scrollWidth, height: wrapper.scrollHeight,
                    windowWidth: document.documentElement.scrollWidth, windowHeight: document.documentElement.scrollHeight,
                    ignoreElements: (element) => {
                        if (element.id === 'dataModal' || (element.classList && element.classList.contains('spinner-container'))) return true;
                        return false;
                    }
                }).then(canvas => {
                    document.body.removeChild(wrapper);
                    window.scrollTo(originalScrollX, originalScrollY);
                    canvas.toBlob(function (blob) {
                        const url = URL.createObjectURL(blob);
                        const link = document.createElement("a");
                        link.href = url;
                        link.download = "review_report_cards.png";
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        URL.revokeObjectURL(url);
                        resolve();
                    }, 'image/png');
                }).catch(err => {
                    document.body.removeChild(wrapper);
                    window.scrollTo(originalScrollX, originalScrollY);
                    console.error("Error generating PNG", err);
                    if (frappe && frappe.msgprint) frappe.msgprint("Error generating PNG.");
                    resolve();
                });
            }, 100);
        });
    }

    async function downloadCardsXLSX() {
        return new Promise((resolve) => {
            try {
                const cards = document.querySelectorAll('.card');
                const rows = [["Card Title", "Value", "Extra Information"]];

                Array.from(cards).forEach(card => {
                    const title = card.querySelector('.card-content > div:nth-child(2)') ? card.querySelector('.card-content > div:nth-child(2)').textContent.trim() : '';
                    const valueElement = card.querySelector('.number-loader');
                    const extraElement = card.querySelector('.extra-line');
                    const value = valueElement ? valueElement.textContent.trim() : '';
                    const extra = extraElement ? extraElement.textContent.trim() : '';
                    rows.push([title, value, extra]);
                });

                const wb = XLSX.utils.book_new();
                const ws = XLSX.utils.aoa_to_sheet(rows);
                XLSX.utils.book_append_sheet(wb, ws, "Dashboard Cards");
                XLSX.writeFile(wb, "review_report_cards.xlsx");
                resolve();
            } catch (err) {
                console.error("Error generating XLSX", err);
                resolve();
            }
        });
    }

    let downloadDropdown = $(`
        <div class="dropdown custom-dropdown" style="display:inline-block; position: relative;">
            <button class="btn btn-default btn-sm dropdown-toggle" type="button" style="background-color: #5979aa; color: white; border: 1px solid #5979aa; border-radius: 4px; padding: 5px 16px; font-weight: 500; font-size: 14px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center;">
                <span>Download</span>
            </button>
            <div class="dropdown-menu" style="display: none; position: absolute; top: 100%; left: 0; background-color: white; border: 1px solid #ddd; border-radius: 4px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); z-index: 1000; min-width: 100%; margin-top: 5px; padding: 0;">
                <a href="#" class="dropdown-item" id="dl-png" style="display: block; padding: 8px 16px; color: #333; text-decoration: none; border-bottom: 1px solid #eee;">PNG</a>
                <a href="#" class="dropdown-item" id="dl-xlsx" style="display: block; padding: 8px 16px; color: #333; text-decoration: none;">XLSX</a>
            </div>
        </div>
    `);

    page.wrapper.find('.custom-actions').append(downloadDropdown);

    // Add Logic Button next to Download Button
    let logicBtn = $(`
        <button class="btn btn-default btn-sm logic-btn" type="button" style="background-color: #5979aa; color: white; border: 1px solid #5979aa; border-radius: 4px; padding: 5px 16px; font-weight: 500; font-size: 14px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; margin-left: 5px;">
            <span>Logic</span>
        </button>
    `);

    page.wrapper.find('.custom-actions').append(logicBtn);

    downloadDropdown.find('.dropdown-item').hover(
        function () { $(this).css('background-color', '#f5f5f5'); },
        function () { $(this).css('background-color', 'white'); }
    );

    downloadDropdown.find('button').on('click', function (e) {
        e.stopPropagation();
        const menu = $(this).siblings('.dropdown-menu');
        $('.dropdown-menu').not(menu).hide();
        menu.toggle();
    });

    $(document).on('click', function () {
        downloadDropdown.find('.dropdown-menu').hide();
    });

    downloadDropdown.find('#dl-png').on('click', function (e) {
        e.preventDefault();
        const btn = downloadDropdown.find('button');
        const btnSpan = btn.find('span');
        const originalText = btnSpan.text();
        btnSpan.text('Downloading...');
        btn.prop('disabled', true);

        setTimeout(async () => {
            await downloadCardsPNG();
            btnSpan.text(originalText);
            btn.prop('disabled', false);
        }, 50);
    });

    downloadDropdown.find('#dl-xlsx').on('click', function (e) {
        e.preventDefault();
        const btn = downloadDropdown.find('button');
        const btnSpan = btn.find('span');
        const originalText = btnSpan.text();
        btnSpan.text('Downloading...');
        btn.prop('disabled', true);

        setTimeout(async () => {
            await downloadCardsXLSX();
            btnSpan.text(originalText);
            btn.prop('disabled', false);
        }, 50);
    });

    // ==========================================
    // END OF DOWNLOAD IMPLEMENTATION
    // ==========================================

    // -------- Logic Features --------
    const logicDataList = [
        { "section": "Filter", "title": "No. of Creches", "logic": "Total number of active/operational creches matching the selected filters (for other statuses, creches opened on or before the selected month end are counted), and matching the Creche Opening Date filter when applied" },

        { "section": "Attendance", "title": "Avg. No of Days Creche Opened", "logic": "Total number of days (across all filtered creches) that were not marked closed in the selected month, divided by the number of filtered creches, rounded up" },
        { "section": "Attendance", "title": "No of creches Attendance Monthly Trend Improving", "logic": "Count of creches whose attendance % this month is higher than the previous month (comparing month-3 vs month-2 of the trailing 3-month window)" },
        { "section": "Attendance", "title": "No of creches Attendance Quarterly Trend Improving", "logic": "Count of creches whose average attendance in the latest 3-month quarter (Q2) is higher than the prior 3-month quarter (Q1)" },

        { "section": "Attendance", "title": "Avg. No of Days Creche Closed", "logic": "Total number of days (across all filtered creches) that were marked closed in the selected month, divided by the number of filtered creches, rounded up" },
        { "section": "Attendance", "title": "No of creches Attendance Monthly Trend Deteriorating", "logic": "Count of creches whose attendance % this month is lower than the previous month (comparing month-3 vs month-2 of the trailing 3-month window)" },
        { "section": "Attendance", "title": "No of creches Attendance Quarterly Trend Deteriorating", "logic": "Count of creches whose average attendance in the latest 3-month quarter (Q2) is lower than the prior 3-month quarter (Q1)" },

        { "section": "Attendance", "title": "No of Creches Opened Below 24 Days", "logic": "Count of creches where the total number of days marked as open (not closed) in the selected month is less than 24" },
        { "section": "Attendance", "title": "No of creches Attendance Monthly Trend No Change", "logic": "Count of creches whose attendance % this month is the same as the previous month (comparing month-3 vs month-2 of the trailing 3-month window)" },
        { "section": "Attendance", "title": "No of creches Attendance Quarterly Trend No Change", "logic": "Count of creches whose average attendance in the latest 3-month quarter (Q2) equals the prior 3-month quarter (Q1)" },

        { "section": "Attendance", "title": "No of Creches not submitted attendance (full days)", "logic": "Count of creches where the number of attendance records submitted in the selected month is less than the number of eligible open days (days between creche opening date/month start and month end/today)" },
        { "section": "Attendance", "title": "No of creches with Attendance Below 25 %", "logic": "Count of creches whose child-level monthly attendance percentage (days present / eligible days per enrolled child) for the latest month in the trailing quarter is below 25%" },
        { "section": "Attendance", "title": "No of creches with Attendance 50 - 75 %", "logic": "Count of creches whose child-level monthly attendance percentage for the latest month in the trailing quarter is between 50% (inclusive) and 75% (exclusive)" },

        { "section": "Attendance", "title": "No of creches with Daily Average Attendance Below 10", "logic": "Count of creches whose average number of children attending per open day, for the most recent month in the trailing quarter, is below 10" },
        { "section": "Attendance", "title": "No of creches with Attendance 25 - 50 %", "logic": "Count of creches whose child-level monthly attendance percentage for the latest month in the trailing quarter is between 25% (inclusive) and 50% (exclusive)" },
        { "section": "Attendance", "title": "No of creches with Attendance 75 - 100 %", "logic": "Count of creches whose child-level monthly attendance percentage for the latest month in the trailing quarter is 75% or above" },

        { "section": "Safety", "title": "No of creches submitted safety checklist", "logic": "Count of creches that have at least one Safety Indicators checklist recorded with a visit date within the selected month" },
        { "section": "Safety", "title": "No of creches not submitted safety checklist", "logic": "Count of creches that have no Safety Indicators checklist recorded with a visit date within the selected month" },
        { "section": "Safety", "title": "No. of Safety Issues Identified this month", "logic": "Count of creches whose latest safety checklist within the selected month has one or more safety fields marked as an issue (value = 2)" },

        { "section": "Safety", "title": "No. of Safety Issues Resolved this month", "logic": "Count of creches where a safety field marked as an issue (value = 2) in the prior checklist is marked resolved (value = 1) in the latest checklist within the selected month" },
        { "section": "Safety", "title": "No. of Safety Issues Unresolved this month", "logic": "Count of creches where a safety field marked as an issue (value = 2) in the prior checklist remains an issue (value = 2) in the latest checklist within the selected month" },
        { "section": "Safety", "title": "No. of Safety Issues Identified this quarter", "logic": "Count of creches whose latest safety checklist within the trailing quarter (last 3 months) has one or more safety fields marked as an issue (value = 2)" },

        { "section": "Safety", "title": "No. of Safety Issues Resolved this quarter", "logic": "Count of creches where a safety field marked as an issue in the prior checklist is marked resolved in the latest checklist within the trailing quarter" },
        { "section": "Safety", "title": "No. of Safety Issues Unresolved this quarter", "logic": "Count of creches where a safety field marked as an issue in the prior checklist remains an issue in the latest checklist within the trailing quarter" },
        { "section": "Safety", "title": "No of Issues Unresolved for last 3 months", "logic": "Count of creches where a safety field marked as an issue in the prior checklist remains an issue in the latest checklist, evaluated over the trailing 3-month window" },

        { "section": "Safety", "title": "No of Issues Unresolved for last 6 months", "logic": "Count of creches where a safety field marked as an issue in the prior checklist remains an issue in the latest checklist, evaluated over the trailing 6-month window" },
        { "section": "Safety", "title": "No of creches with infrastructural & environmental safety issues", "logic": "Count of creches whose latest safety checklist has an issue (value = 2) in any of: roof/wall structural safety, rainwater leakage protection, well/tube well proximity, iron net covering, or sharp edge/machinery hazards" },
        { "section": "Safety", "title": "No of creches with physical safety & security issues", "logic": "Count of creches whose latest safety checklist has an issue (value = 2) in any of: external fencing, main entrance safety, kitchen entrance gate safety, protection from animals, or visitor register recording" },

        { "section": "Safety", "title": "No of creches with fire safety issues", "logic": "Count of creches whose latest safety checklist has an issue (value = 2) in any of: cylinder height positioning, fire extinguisher availability/condition, kitchen fire emergency handling, or pressure cooker handling confidence" },
        { "section": "Safety", "title": "No of creches with electrical safety issues", "logic": "Count of creches whose latest safety checklist has an issue (value = 2) in any of: electrical connections out of children's reach, safe fan/light installation, solar battery placement, or creche lighting" },
        { "section": "Safety", "title": "No of creches with food safety issues", "logic": "Count of creches whose latest safety checklist has an issue (value = 2) in any of: first-in-first-out food usage, egg floating quality tests, leftover food disposal, or safe drinking water filtration" },

        { "section": "Safety", "title": "No of creches with other safety issues", "logic": "Count of creches whose latest safety checklist has an issue (value = 2) in any of: two-caregiver staffing, first aid availability, or emergency contact number display" }
    ];

    function populateLogicTable() {
        const tbody = document.getElementById("logicTableBody");
        if (tbody.innerHTML.trim() !== "") return; // Avoid repopulating

        let rowsHtml = "";
        logicDataList.forEach((row, index) => {
            const bgClass = index % 2 === 0 ? "background-color: #f9f9f9;" : "background-color: #ffffff;";
            rowsHtml += `
                <tr style="${bgClass}">
                    <td style="padding: 10px 12px; border: 1px solid #ddd; font-weight: 600; color: #5979aa; white-space: normal;">${row.section}</td>
                    <td style="padding: 10px 12px; border: 1px solid #ddd; font-weight: 600; color: #333; white-space: normal;">${row.title}</td>
                    <td style="padding: 10px 12px; border: 1px solid #ddd; color: #555; white-space: normal; line-height: 1.5;">${row.logic}</td>
                </tr>
            `;
        });
        tbody.innerHTML = rowsHtml;
    }

    function openLogicModal() {
        populateLogicTable();
        document.getElementById("logicModal").style.display = "block";
        document.body.classList.add("modal-open");
    }

    function closeLogicModal() {
        document.getElementById("logicModal").style.display = "none";
        document.body.classList.remove("modal-open");
    }

    logicBtn.on('click', function (e) {
        e.preventDefault();
        openLogicModal();
    });

    $(document).on("click", ".logic-close-btn", closeLogicModal);
    window.addEventListener("click", (event) => {
        if (event.target === document.getElementById("logicModal")) {
            closeLogicModal();
        }
    });

    $(document).on("click", "#downloadLogicXlsxBtn", function (e) {
        e.preventDefault();
        const btn = $(this);
        const originalText = btn.text();
        btn.text('Downloading...');
        btn.prop('disabled', true).css({ opacity: 0.6, cursor: 'not-allowed' });

        setTimeout(() => {
            try {
                const rows = logicDataList.map(row => {
                    return { "Section": row.section, "Card Title": row.title, "Logic": row.logic };
                });

                if (rows.length > 0) {
                    const worksheet = XLSX.utils.json_to_sheet(rows);
                    const workbook = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(workbook, worksheet, "Card Logic");
                    XLSX.writeFile(workbook, "card_logic.xlsx");
                }
            } catch (err) {
                console.error("Error generating Logic XLSX", err);
                if (frappe && frappe.msgprint) frappe.msgprint("Error generating XLSX.");
            } finally {
                btn.text(originalText);
                btn.prop('disabled', false).css({ opacity: 1, cursor: 'pointer' });
            }
        }, 100);
    });

    $(document).on("click", "#downloadLogicPngBtn", function (e) {
        e.preventDefault();
        const btn = $(this);
        const originalText = btn.text();
        btn.text('Downloading...');
        btn.prop('disabled', true).css({ opacity: 0.6, cursor: 'not-allowed' });

        setTimeout(() => {
            if (typeof html2canvas === 'undefined') {
                frappe.msgprint("Image generation library is still loading. Please try again in a moment.");
                btn.text(originalText);
                btn.prop('disabled', false).css({ opacity: 1, cursor: 'pointer' });
                return;
            }

            const targetElement = document.getElementById('logicModalContent');
            const wrapper = document.getElementById('logicTableWrapper');
            if (targetElement && wrapper) {
                const wrapperOrigMaxHeight = wrapper.style.maxHeight;
                const wrapperOrigOverflowY = wrapper.style.overflowY;
                const modalOrigMaxHeight = targetElement.style.maxHeight;
                const modalOrigOverflow = targetElement.style.overflow;

                wrapper.style.maxHeight = 'none';
                wrapper.style.overflowY = 'visible';
                targetElement.style.maxHeight = 'none';
                targetElement.style.overflow = 'visible';

                html2canvas(targetElement, {
                    scale: 2,
                    windowHeight: targetElement.scrollHeight,
                    scrollY: -window.scrollY
                }).then(canvas => {
                    canvas.toBlob(function (blob) {
                        const url = URL.createObjectURL(blob);
                        const link = document.createElement("a");
                        link.href = url;
                        link.download = "card_logic.png";
                        link.click();
                        URL.revokeObjectURL(url);

                        wrapper.style.maxHeight = wrapperOrigMaxHeight;
                        wrapper.style.overflowY = wrapperOrigOverflowY;
                        targetElement.style.maxHeight = modalOrigMaxHeight;
                        targetElement.style.overflow = modalOrigOverflow;
                        btn.text(originalText);
                        btn.prop('disabled', false).css({ opacity: 1, cursor: 'pointer' });
                    }, "image/png");
                }).catch(err => {
                    console.error("Error generating Logic PNG", err);
                    if (frappe && frappe.msgprint) frappe.msgprint("Error generating PNG.");

                    wrapper.style.maxHeight = wrapperOrigMaxHeight;
                    wrapper.style.overflowY = wrapperOrigOverflowY;
                    targetElement.style.maxHeight = modalOrigMaxHeight;
                    targetElement.style.overflow = modalOrigOverflow;
                    btn.text(originalText);
                    btn.prop('disabled', false).css({ opacity: 1, cursor: 'pointer' });
                });
            } else {
                btn.text(originalText);
                btn.prop('disabled', false).css({ opacity: 1, cursor: 'pointer' });
            }
        }, 100);
    });

    async function renderCards() {
        await Promise.all([fetchDashboardData(), updateActiveCrecheCount()]);
    }

    const style = document.createElement('style');
    style.textContent = `
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    `;
    document.head.appendChild(style);

    frappe.after_ajax(() => {
        renderCards();
    });
};







