frappe.pages['growth-monitoring-ch'].on_page_load = function (wrapper) {
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: __('Child Report Card'),
        single_column: true
    });

    frappe.require("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js");
    frappe.require("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js");
    frappe.require("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");

    const main_container = $(`
        <div class="growth-monitoring-container" style="
            display: flex;
            flex-direction: column;
            gap: 10px;
            margin: 15px 0;
        ">
            <div class="content-section" style="
                display: flex;
                gap: 15px;
                flex-wrap: wrap;
            ">
                <div class="table-section" style="
                    flex: 1;
                    min-width: 300px;
                    display: none;
                "></div>

                <div class="chart-section" style="
                    flex: 2;
                    min-width: 300px;
                    background: white;
                    padding: 15px;
                    border-radius: 8px;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.05);
                    display: none;
                    min-height: 800px;
                ">
                    <div class="chart-header" style="
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        margin-bottom: 15px;
                        flex-wrap: wrap;
                        gap: 10px;
                    ">
                        <h4 class="chart-title" style="color: black; padding: 8px 12px; font-weight: bold;">No Child Selected</h4>
                        <div class="indicator-selector" style="display: flex; gap: 10px; flex-wrap: wrap; align-items: center;">
                            <button class="btn btn-default btn-sm indicator-btn" data-type="weight_for_age">Weight for Age</button>
                            <button class="btn btn-default btn-sm indicator-btn" data-type="height_for_age">Height for Age</button>
                            <button class="btn btn-default btn-sm indicator-btn" data-type="weight_for_height">Weight for Height</button>
                            <button class="btn btn-default btn-sm indicator-btn" data-type="attendance">Attendance</button>
                            <select class="xaxis-mode-select" style="font-size: 14px; padding: 9px 4px; border: 1px solid #5979aa; border-radius: 4px; cursor: pointer; background: #ffffff; color: #000000; width: auto; max-width: 80px; font-weight: normal;">
                                <option value="days" selected>Days</option>
                                <option value="months">Months</option>
                            </select>
                        </div>
                    </div>

                <div class="measurement-info mt-3 p-3 bg-light rounded"
                    style="margin-bottom: 15px; background: #f8f9fa; padding: 15px; border-radius: 8px;">
                    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 8px; font-size: 13px; line-height: 1.47rem; white-space: nowrap;">

                        <div>
                            <p style="margin: 0;">${__('Name:')} <strong><span class="child-name">-</span></strong></p>
                            <p style="margin: 0;">${__('DOB:')} <strong><span class="child-dob">-</span></strong></p>
                            <p style="margin: 0;">${__('Age(in days):')} <strong><span class="current-age">-</span></strong></p>
                            <p style="margin: 0;">${__('Gender:')} <strong><span class="gender">-</span></strong></p>
                        </div>

                        <div>
                            <p style="margin: 0;">${__('Date of Enrollment:')} <strong><span class="date-of-enrollment">-</span></strong></p>
                            <p style="margin: 0;">${__('Date of Measurement:')} <strong><span class="measurement-date">-</span></strong></p>
                            <p style="margin: 0;">${__('Equipment:')} <strong><span class="equipment">-</span></strong></p>
                            <p style="margin: 0;">${__('Position:')} <strong><span class="position">-</span></strong></p>
                        </div>

                        <div>
                            <p style="margin: 0;">${__('Partner:')} <strong><span class="partner-name">-</span></strong></p>
                            <p style="margin: 0;">${__('Creche:')} <strong><span class="creche-name">-</span></strong></p>
                            <p style="margin: 0;">${__('Supervisor:')} <strong><span class="supervisor-name">-</span></strong></p>
                            <p style="margin: 0;">
                                ${__('Weight:')} <strong><span class="current-weight">-</span></strong> kg |
                                ${__('Height:')} <strong><span class="current-height">-</span></strong> cm
                            </p>
                        </div>

                        <div>
                            <p style="margin: 0;">${__('WFA (Z-score):')} <strong><span class="current-wfa">-</span></strong></p>
                            <p style="margin: 0;">${__('HFA (Z-score):')} <strong><span class="current-hfa">-</span></strong></p>
                            <p style="margin: 0;">${__('WFH (Z-score):')} <strong><span class="current-wfh">-</span></strong></p>
                        </div>

                    </div>
                </div>


                    <div class="chart-container" style="height: 500px; position: relative; width: 100%;">
                        <canvas id="growth-chart"></canvas>
                        <div class="chart-placeholder text-center" style="
                            position: absolute;
                            top: 50%;
                            left: 50%;
                            transform: translate(-50%, -50%);
                            width: 100%;
                        ">
                            <i class="fa fa-child fa-3x text-muted"></i>
                            <p class="mt-2">${__('Select a child to view growth chart')}</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        `).appendTo(page.main);

    const table_section = main_container.find('.table-section');
    const chart_section = main_container.find('.chart-section');
    const chart_title = main_container.find('.chart-title');
    const indicator_selector = main_container.find('.indicator-selector');
    const chart_placeholder = main_container.find('.chart-placeholder');
    const chart_canvas = main_container.find('#growth-chart')[0];

    indicator_selector.find('.indicator-btn').css({
        "background-color": "#ffffff",
        "color": "#000000",
        "border": "1px solid #5979aa",
        "border-radius": "4px",
        "padding": "6px 12px",
        "font-weight": "normal"
    });

    const API_URL = "/api/method/frappe.apf.page.growth_monitoring_ch.growth_chart.growth_chart_data";
    const ATTENDANCE_API_URL = "/api/method/frappe.apf.page.growth_monitoring_ch.growth_chart.get_monthly_attendance_summary";

    // Guard variable to prevent cascading resets when auto-filling
    let isAutoFilling = false;

    // Read period params (from Creche Report Card navigation) once, up front.
    const urlMonth = new URLSearchParams(window.location.search).get('month');
    const urlYear = new URLSearchParams(window.location.search).get('year');
    // Flips to true once the user manually changes month/year, so their choice wins.
    let urlPeriodConsumed = false;

    const filters = [
        { "fieldname": "year", "label": __("Year"), "fieldtype": "Select", "options": ["2020", "2021", "2022", "2023", "2024", "2025", "2026"], "default": new Date().getFullYear().toString(), },
        {
            "fieldname": "month", "label": __("Month"), "fieldtype": "Select",
            "options": [
                { "value": "1", "label": __("January") }, { "value": "2", "label": __("February") }, { "value": "3", "label": __("March") },
                { "value": "4", "label": __("April") }, { "value": "5", "label": __("May") }, { "value": "6", "label": __("June") },
                { "value": "7", "label": __("July") }, { "value": "8", "label": __("August") }, { "value": "9", "label": __("September") },
                { "value": "10", "label": __("October") }, { "value": "11", "label": __("November") }, { "value": "12", "label": __("December") }
            ],
            "default": (new Date().getMonth() + 1).toString(),
        },
        {
            "fieldname": "partner", "label": __("Partner"), "fieldtype": "Link", "options": "Partner", "default": frappe.defaults.get_user_default("partner"),
            "get_query": function () {
                let state = page.fields_dict["state"].get_value();
                return state ? { filters: { state_id: state } } : {};
            }
        },
        { "fieldname": "state", "label": __("State"), "fieldtype": "Link", "options": "State", "get_query": function () { return { filters: { "is_active": 1 } }; } },
        {
            "fieldname": "district", "label": __("District"), "fieldtype": "Link", "options": "District", "get_query": function () {
                let state = page.fields_dict["state"].get_value();
                return state ? { filters: { state_id: state } } : {};
            }
        },
        {
            "fieldname": "block", "label": __("Block"), "fieldtype": "Link", "options": "Block", "get_query": function () {
                let district = page.fields_dict["district"].get_value();
                if (district) return { filters: { district_id: district } };
                return {};
            }
        },
        {
            "fieldname": "gp", "label": __("Gram Panchayat"), "fieldtype": "Link", "options": "Gram Panchayat",
            "get_query": function () {
                let block = page.fields_dict["block"].get_value();
                if (block) return { filters: { block_id: block } };
                return {};
            }
        },
        { "fieldname": "supervisor_id", "label": __("Supervisor"), "fieldtype": "Link", "options": "User", },
        {
            "fieldname": "creche", "label": __("Creche"), "fieldtype": "Link", "options": "Creche", "reqd": 1,
            "get_query": function () {
                let filters = {};
                let partner = page.fields_dict["partner"].get_value();
                let state = page.fields_dict["state"].get_value();
                let district = page.fields_dict["district"].get_value();
                let block = page.fields_dict["block"].get_value();
                let gp = page.fields_dict["gp"].get_value();
                let supervisor = page.fields_dict["supervisor_id"].get_value();

                if (partner) filters.partner = partner;
                if (state) filters.state_id = state;
                if (district) filters.district_id = district;
                if (block) filters.block_id = block;
                if (gp) filters.gp_id = gp;
                // Supervisor is completely valid for the Creche table
                if (supervisor) filters.supervisor_id = supervisor;

                return { filters: filters };
            }
        },
        {
            "fieldname": "child_name", "label": __("Child Name"), "fieldtype": "Link", "options": "Child Enrollment and Exit",
            "get_query": function () {
                let filters = {};
                let partner = page.fields_dict["partner"].get_value();
                let state = page.fields_dict["state"].get_value();
                let district = page.fields_dict["district"].get_value();
                let block = page.fields_dict["block"].get_value();
                let gp = page.fields_dict["gp"].get_value();
                let creche = page.fields_dict["creche"].get_value();

                if (partner) filters.partner = partner;
                if (state) filters.state_id = state;
                if (district) filters.district_id = district;
                if (block) filters.block_id = block;
                if (gp) filters.gp_id = gp;

                // FIXED: Removed the assignment of supervisor_id to prevent the 1054 SQL error
                if (creche) filters.creche_id = creche;

                return { filters: filters };
            },
            "onchange": function () {
                let child_id = page.fields_dict["child_name"].get_value();
                if (child_id && !isAutoFilling) {
                    frappe.db.get_value("Child Enrollment and Exit", child_id, "creche_id")
                        .then(r => {
                            if (r && r.message) {
                                let fetched_creche = r.message.creche_id;
                                if (fetched_creche) {
                                    let current_creche = page.fields_dict["creche"].get_value();
                                    if (current_creche !== fetched_creche) {
                                        isAutoFilling = true; // Prevent cascading resets
                                        page.fields_dict["creche"].set_value(fetched_creche).then(() => {
                                            // Ensure child remains selected
                                            page.fields_dict["child_name"].set_value(child_id).then(() => {
                                                isAutoFilling = false;
                                            });
                                        });
                                    }
                                }
                            }
                        });
                }
            }
        }
    ];

    // If month/year are supplied via URL (e.g. coming from Creche Report Card),
    // use them as the field defaults so Frappe doesn't fall back to the current month/year.
    (function overridePeriodDefaultsFromUrl() {
        if (urlYear) {
            const yf = filters.find(f => f.fieldname === 'year');
            if (yf) yf.default = String(urlYear);
        }
        if (urlMonth) {
            const mf = filters.find(f => f.fieldname === 'month');
            if (mf) mf.default = String(urlMonth);
        }
    })();

    filters.forEach(filter => {
        page.add_field(filter);
        if (filter.fieldtype === "Link" || filter.fieldtype === "Select") {
            const input = page.fields_dict[filter.fieldname].input;
            if (input) {
                input.addEventListener("change", () => {
                    // Only trigger the reset logic if we aren't currently auto-filling
                    if (!isAutoFilling) {
                        // A manual month/year change means the user overrides the URL period
                        if (filter.fieldname === "month" || filter.fieldname === "year") {
                            urlPeriodConsumed = true;
                        }
                        resetForwardFilters(filter.fieldname);
                    }
                });
            }
        }
    });

    function resetForwardFilters(currentFilter) {
        let currentIndex = filters.findIndex(filter => filter.fieldname === currentFilter);
        if (currentIndex === -1) return;

        for (let i = currentIndex + 1; i < filters.length; i++) {
            if (page.fields_dict[filters[i].fieldname].df.fieldname == "year" ||
                page.fields_dict[filters[i].fieldname].df.fieldname == "month") {
                continue;
            }
            page.fields_dict[filters[i].fieldname].set_value("");
        }
    }

    function showWarningToast(message = "⚠️ Please select a <strong>Creche</strong> before searching.") {
        $('.custom-warning-toast').remove();
        const warningBox = $(`
                <div class="custom-warning-toast" style="
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    background: #fef2f2;
                    color: #991b1b;
                    padding: 14px 20px;
                    border: 1px solid #fecaca;
                    border-radius: 8px;
                    box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                    z-index: 9999;
                    font-size: 14px;
                    transition: opacity 0.3s ease;
                ">
                    ${message}
                </div>
            `);
        $('body').append(warningBox);
        setTimeout(() => {
            warningBox.fadeOut(300, () => warningBox.remove());
        }, 3000);
    }

    let searchBtn = page.add_button(`<b>${__('Search')}</b>`, async function () {
        searchBtn.prop('disabled', true);
        if (page.fields_dict["creche"].get_value()) {
            await fetchData();
        } else {
            showWarningToast();
        }
        searchBtn.prop('disabled', false);
    });

    let resetBtn = page.add_button(`<b>${__('Reset')}</b>`, function () {
        resetBtn.prop('disabled', true);
        window.location.href = '/app/growth-monitoring-ch';
    });

    searchBtn.addClass('rc-search-btn').css({
        "background-color": "#5979aa",
        "color": "white",
        "border": "1px solid #5979aa",
        "border-radius": "4px",
        "padding": "5px 16px",
        "font-weight": "500",
        "font-size": "14px"
    });

    resetBtn.addClass('rc-reset-btn').css({
        "background-color": "#f9fafb",
        "color": "#1f2937",
        "border": "1px solid #d1d5db",
        "border-radius": "4px",
        "padding": "5px 16px",
        "font-weight": "500",
        "font-size": "14px"
    });

    // Logic Button (same look as the Download/Logic buttons in Creche Dashboard)
    let logicBtn = $(`
        <button class="btn btn-default btn-sm logic-btn" type="button" style="background-color: #5979aa; color: white; border: 1px solid #5979aa; border-radius: 4px; padding: 5px 16px; font-weight: 500; font-size: 14px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; margin-left: 5px;">
            <span>Logic</span>
        </button>
    `);
    page.wrapper.find('.custom-actions').append(logicBtn);

    page.wrapper.find('.custom-actions').removeClass('hidden-xs hidden-md').css({
        "display": "flex",
        "flex-wrap": "nowrap",
        "align-items": "center",
        "gap": "5px"
    });
    page.wrapper.find(".menu-btn-group ").removeClass('show"').css({
        "display": "none"
    });

    let currentChildData = null;
    let currentChartType = 'weight_for_age';
    let currentXAxisMode = 'days';
    let growthChart = null;

    function getUrlParameter(name) {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get(name);
    }

    const urlCrecheId = getUrlParameter('creche_id');
    const urlChildId = getUrlParameter('child_id');
    // urlMonth / urlYear are declared near the top of on_page_load

    function forceSelectValue(fieldname, value) {
        const field = page.fields_dict[fieldname];
        if (!field || value === undefined || value === null || value === "") return;

        const strValue = String(value);

        // Update the Frappe field model
        if (typeof field.set_model_value === "function") {
            field.set_model_value(strValue);
        }
        field.value = strValue;
        if (field.df) field.df.default = strValue;
        if (typeof field.set_input === "function") {
            field.set_input(strValue);
        }

        // Update the raw <select> element and notify listeners
        const el = field.input || (field.$input && field.$input[0]);
        if (el) {
            el.value = strValue;
            // If the option isn't selected (value mismatch), match by trimmed text as fallback
            if (el.value !== strValue && el.options) {
                for (const opt of el.options) {
                    if (opt.value.trim() === strValue || opt.text.trim() === strValue) {
                        el.value = opt.value;
                        break;
                    }
                }
            }
            el.dispatchEvent(new Event("change", { bubbles: true }));
        }

        if (typeof field.refresh === "function") field.refresh();
    }

    function applyPeriodFromUrl() {
        if (urlYear) forceSelectValue("year", urlYear);
        if (urlMonth) forceSelectValue("month", urlMonth);
    }

    if (urlCrecheId || urlChildId) {
        setTimeout(async () => {
            isAutoFilling = true;
            applyPeriodFromUrl();
            if (urlCrecheId) {
                await page.fields_dict["creche"].set_value(urlCrecheId);
            }
            if (urlChildId) {
                await page.fields_dict["child_name"].set_value(urlChildId);
            }
            applyPeriodFromUrl();
            isAutoFilling = false;

            setTimeout(async () => {
                // Re-assert the period in case field defaults were re-applied after load
                isAutoFilling = true;
                applyPeriodFromUrl();
                isAutoFilling = false;
                searchBtn.prop('disabled', true);
                await fetchData();
                searchBtn.prop('disabled', false);
            }, 800);
        }, 500);
    }

    function loadChartJS() {
        return new Promise((resolve) => {
            if (window.Chart) {
                resolve();
                return;
            }

            const script = document.createElement('script');
            script.src = "https://cdn.jsdelivr.net/npm/chart.js";
            script.onload = resolve;
            script.onerror = () => {
                console.error("Failed to load Chart.js");
                resolve();
            };
            document.head.appendChild(script);
        });
    }

    loadChartJS().then(() => {
        indicator_selector.find(`.indicator-btn[data-type="${currentChartType}"]`)
            .addClass('active')
            .css({
                "background-color": "#5979aa",
                "color": "#ffffff"
            });
        $(document).on('click', '.indicator-btn', function () {
            currentChartType = $(this).data('type');
            indicator_selector.find('.indicator-btn').removeClass('active')
                .css({
                    "background-color": "#ffffff",
                    "color": "#000000"
                });
            $(this).addClass('active')
                .css({
                    "background-color": "#5979aa",
                    "color": "#ffffff"
                });
            if (currentChildData) {
                if (currentChartType === 'attendance') {
                    fetchAttendanceData(currentChildData);
                } else {
                    showGrowthChart(currentChildData);
                }
            }
        });

        $(document).on('change', '.xaxis-mode-select', function () {
            currentXAxisMode = $(this).val();
            if (currentChildData && currentChartType !== 'attendance') {
                showGrowthChart(currentChildData);
            }
        });
    });

    // Returns the effective month/year: URL params take precedence over field values
    // (used when navigating in from Creche Report Card with a selected period).
    function getEffectivePeriod() {
        const fieldMonth = page.fields_dict["month"].get_value();
        const fieldYear = page.fields_dict["year"].get_value();
        if (!urlPeriodConsumed && (urlMonth || urlYear)) {
            return {
                month: urlMonth || fieldMonth,
                year: urlYear || fieldYear
            };
        }
        return { month: fieldMonth, year: fieldYear };
    }

    function fetchData() {
        const period = getEffectivePeriod();
        const month = period.month;
        const year = period.year;
        const creche_id = page.fields_dict["creche"].get_value();
        if (!creche_id) {
            showWarningToast();
            return;
        }
        table_section.html(`
                <div class="text-center" style="padding: 20px;">
                    <i class="fa fa-spinner fa-spin fa-2x"></i>
                    <p>${__("Loading data...")}</p>
                </div>
            `).show();

        chart_section.show();
        chart_placeholder.show();
        chart_title.text("No Child Selected");
        let url = `${API_URL}?month=${month}&year=${year}&creche_id=${creche_id}`;
        const partner = page.fields_dict["partner"].get_value();
        const state = page.fields_dict["state"].get_value();
        const district = page.fields_dict["district"].get_value();
        const block = page.fields_dict["block"].get_value();
        const gp = page.fields_dict["gp"].get_value();
        const supervisor_id = page.fields_dict["supervisor_id"].get_value();
        const child_name = page.fields_dict["child_name"].get_value();

        if (partner) url += `&partner=${partner}`;
        if (state) url += `&state=${state}`;
        if (district) url += `&district=${district}`;
        if (block) url += `&block=${block}`;
        if (gp) url += `&gp=${gp}`;
        if (supervisor_id) url += `&supervisor_id=${supervisor_id}`;
        if (child_name) url += `&child_name=${child_name}`;
        $.ajax({
            url: url,
            type: 'GET',
            dataType: 'json',
            success: function (response) {
                if (response && response.message) {
                    displayData(response.message);
                } else {
                    showNoDataMessage();
                }
            },
            error: function (xhr) {
                showErrorMessage(xhr);
            }
        });
    }

    function fetchAttendanceData(childData) {
        const attPeriod = getEffectivePeriod();
        const year = attPeriod.year;
        const month = attPeriod.month;

        chart_placeholder.show().html(`
                <div class="chart-loading">
                    <i class="fa fa-spinner fa-spin fa-2x"></i>
                </div>
            `);

        frappe.call({
            method: "frappe.apf.page.growth_monitoring_ch.growth_chart.get_monthly_attendance_summary",
            args: {
                child_name: childData.child_idx,
                year: year,
                month: month
            },
            callback: function (r) {
                if (r.message) {
                    renderAttendanceChart(r.message, childData);
                } else {
                    chart_placeholder.html(`
                            <div class="text-center text-danger">
                                <i class="fa fa-exclamation-triangle fa-3x"></i>
                                <p>${__('Failed to load attendance data')}</p>
                            </div>
                        `);
                }
            }
        });
    }

    function renderAttendanceChart(attendanceData, childData) {
        if (growthChart) {
            growthChart.destroy();
        }

        chart_title.text(`${childData.child_name || 'Child'}`);
        chart_section.find('.partner-name').text(childData.partner_name || '-');
        chart_section.find('.creche-name').text(childData.creche_name || '-');
        chart_section.find('.child-name').text(childData.child_name || '-');
        chart_section.find('.child-dob').text(childData.child_dob || '-');
        chart_section.find('.current-age').text(childData.age_months || '-');
        chart_section.find('.date-of-enrollment').text(childData.date_of_enrollment || '-');
        chart_section.find('.measurement-date').text(childData.measurements_taken_date || '-');
        chart_section.find('.gender').text(childData.gender || '-');
        chart_section.find('.equipment').text(childData.measurement_equipment_type || '-');
        chart_section.find('.supervisor-name').text(childData.supervisor || '-');
        chart_section.find('.current-age').text(childData.age_months || '-');
        chart_section.find('.current-weight').text(childData.weight ? parseFloat(childData.weight).toFixed(1) : '-');
        chart_section.find('.current-height').text(childData.height ? parseFloat(childData.height).toFixed(1) : '-');

        updateZScoreElement(chart_section.find('.current-wfa'), childData.weight_for_age_zscore);
        updateZScoreElement(chart_section.find('.current-hfa'), childData.height_for_age_zscore);
        updateZScoreElement(chart_section.find('.current-wfh'), childData.weight_for_height_zscore);

        try {
            const ctx = chart_canvas.getContext('2d');

            const months = attendanceData.map(item => {
                const [month, year] = item.month.split('-');
                return `${month}-${year}`;
            }).reverse();

            const crecheOpenedDays = attendanceData.map(item => item.creche_opened_days).reverse();
            const presentDays = attendanceData.map(item => item.present_days).reverse();

            const crecheOpenedColor = '#5979aa';
            const presentColor = 'rgba(44, 227, 20, 0.8)';

            growthChart = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: months,
                    datasets: [
                        {
                            label: 'Creche Opened Days',
                            data: crecheOpenedDays,
                            backgroundColor: crecheOpenedColor,
                            borderColor: crecheOpenedColor,
                            borderWidth: 1
                        },
                        {
                            label: 'Child Present Days',
                            data: presentDays,
                            backgroundColor: presentColor,
                            borderColor: presentColor,
                            borderWidth: 1
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        title: {
                            display: true,
                            text: `${childData.child_name}'s Last Six Months Attendance`,
                            font: {
                                size: 16,
                                weight: 'bold'
                            },
                            padding: {
                                top: 10,
                                bottom: 20
                            },
                            color: '#000000'
                        },

                        tooltip: {
                            callbacks: {
                                label: function (context) {
                                    const index = attendanceData.length - 1 - context.dataIndex;
                                    const data = attendanceData[index];

                                    if (context.datasetIndex === 0) {
                                        const percentageOpen = ((data.creche_opened_days / data.total_days) * 100 || 0).toFixed(1);
                                        return [
                                            `Total Days: ${data.total_days}`,
                                            `Creche Open Days: ${data.creche_opened_days}`,
                                            `Creche Open Rate: ${percentageOpen}%`
                                        ];
                                    } else if (context.datasetIndex === 1) {
                                        const attendancePercentage = ((data.present_days / data.creche_opened_days) * 100 || 0).toFixed(1);
                                        return [
                                            `Creche Open Days: ${data.creche_opened_days}`,
                                            `Child Present Days: ${data.present_days}`,
                                            `Child Absent Days: ${data.creche_opened_days - data.present_days}`,
                                            `Attendance: ${attendancePercentage}%`
                                        ];
                                    }
                                }
                            }
                        },

                        legend: {
                            position: 'bottom',
                            labels: {
                                usePointStyle: true,
                                padding: 20
                            }
                        }
                    },
                    scales: {
                        x: {
                            title: {
                                display: true,
                                text: 'Month',
                                font: {
                                    weight: 'bold'
                                }
                            }
                        },
                        y: {
                            title: {
                                display: true,
                                text: 'Days',
                                font: {
                                    weight: 'bold'
                                }
                            },
                            beginAtZero: true,
                            max: 31,
                            ticks: {
                                stepSize: 2,
                                callback: function (value) {
                                    const allowedValues = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 31];
                                    return allowedValues.includes(value) ? value : '';
                                },
                                precision: 0
                            },
                            grace: '0%'
                        }
                    },
                    datasets: {
                        bar: {
                            categoryPercentage: 0.8,
                            barPercentage: 0.9
                        }
                    }
                }
            });

            chart_placeholder.hide();
        } catch (error) {
            console.error("Attendance chart rendering error:", error);
            chart_placeholder.html(`
                <div class="text-center text-danger failed-warning" style="padding: 50px;">
                    <i class="fa fa-exclamation-triangle fa-3x"></i>
                    <p>${__('Failed to render attendance chart. Please try again.')}</p>
                </div>
            `);
        }
    }

    function showNoDataMessage() {
        table_section.html(`
                <div style="
                    padding: 16px;
                    background-color: #f9fafb;
                    color: #1f2937;
                    font-size: 14px;
                    text-align: center;
                    margin-top: 12px;
                    border: 1px solid #d1d5db;
                    border-radius: 8px;
                ">
                    ${__("No data available for the selected filters")}
                </div>
            `);
    }

    function showErrorMessage(xhr) {
        let errorMsg = __("Error fetching data");
        if (xhr.responseJSON && xhr.responseJSON.message) {
            errorMsg += ": " + xhr.responseJSON.message;
        }
        table_section.html(`
                <div style="
                    padding: 16px;
                    background-color: #fef2f2;
                    color: #991b1b;
                    font-size: 14px;
                    text-align: center;
                    margin-top: 12px;
                    border: 1px solid #fecaca;
                    border-radius: 8px;
                ">
                    ${errorMsg}
                </div>
            `);
    }

    function displayData(data) {
        table_section.empty().show();

        if (!data || data.length === 0) {
            table_section.append(`
                    <div style="
                        padding: 16px;
                        background-color: #f9fafb;
                        color: #1f2937;
                        border: 1px solid #d1d5db;
                        border-radius: 8px;
                        font-size: 14px;
                        text-align: center;
                        margin-top: 8px;
                    ">
                        ${__("No data available")}
                    </div>
                `);
            return;
        }
        const table_card = $(`
                <div style="background: #ffffff; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.05);">
                    <div style="overflow-x: auto; min-height: 800px; border-radius: 8px;">
                        <table style="width: max-content; min-width: 100%; border-collapse: collapse; font-size: 13px; table-layout: auto;">
                            <thead>
                                <tr style="background-color: #5979aa; color: white; position: sticky; top: 0; z-index: 2;">
                                    ${['ID', 'Child ID', 'Name'].map(label =>
            `<th style="padding: 10px; white-space: nowrap; min-width: 80px; text-align: left;">${label}</th>`
        ).join('')}
                                </tr>
                            </thead>
                            <tbody></tbody>
                        </table>
                    </div>
                </div>
            `).appendTo(table_section);

        const tbody = table_card.find('tbody');

        data.forEach((item, index) => {
            const isSevere = item.is_severe == 1;
            const isSNC = item.is_snc == 1;

            const defaultBg = isSNC ? '#fffde7' : '#ffffff';
            const hoverBg = isSNC ? '#fff9c4' : '#edf2ff';

            const row = $('<tr></tr>').css({
                backgroundColor: defaultBg,
                cursor: 'pointer',
                transition: 'background-color 0.2s',
                border: '1px solid #C0C0C0'
            });

            row.attr('data-child-idx', item.child_idx || '');
            row.attr('data-child-id', item.child_id || '');

            const rowData = [
                index + 1,
                item.child_id || '-',
                item.child_name || '-'
            ];

            rowData.forEach(cellValue => {
                row.append(`<td style="padding: 8px; white-space: nowrap; min-width: 80px;">${cellValue}</td>`);
            });

            row.hover(
                () => row.css('background-color', hoverBg),
                () => row.css('background-color', defaultBg)
            );

            if (isSevere) {
                row.find('td:eq(1), td:eq(2)').css({ color: '#ff0400', fontWeight: 'bold' });
            }

            row.click(() => {
                currentChildData = item;
                if (currentChartType === 'attendance') {
                    fetchAttendanceData(item);
                } else {
                    showGrowthChart(item);
                }
            });

            tbody.append(row);
        });

        if (urlChildId) {
            setTimeout(() => {
                let foundRow = null;

                tbody.find('tr').each(function () {
                    const childIdx = $(this).attr('data-child-idx');
                    const childId = $(this).attr('data-child-id');

                    if (childIdx === urlChildId || childId === urlChildId) {
                        foundRow = $(this);
                        return false;
                    }
                });

                if (foundRow) {
                    foundRow.trigger('click');
                }
            }, 300);
        }
    }

    function updateZScoreElement(element, zScore) {
        if (!element || element.length === 0) return;
        element.text(zScore ? parseFloat(zScore).toFixed(2) : '-');
        element.removeClass('text-danger text-warning text-success');
        if (zScore === null || zScore === undefined || zScore === '') return;
        const score = parseFloat(zScore);
        if (score < -3 || score > 3) {
            element.addClass('text-danger');
        } else if (score < -2 || score > 2) {
            element.addClass('text-warning');
        } else {
            element.addClass('text-success');
        }
    }

    function showGrowthChart(childData) {
        chart_placeholder.hide();
        chart_section.show();
        chart_title.text(`${childData.child_name || 'Child'}`);
        chart_section.find('.partner-name').text(childData.partner_name || '-');
        chart_section.find('.creche-name').text(childData.creche_name || '-');
        chart_section.find('.child-name').text(childData.child_name || '-');
        chart_section.find('.child-dob').text(childData.child_dob || '-');
        chart_section.find('.current-age').text(childData.age_months || '-');
        chart_section.find('.date-of-enrollment').text(childData.date_of_enrollment || '-');
        chart_section.find('.measurement-date').text(childData.measurements_taken_date || '-');
        chart_section.find('.gender').text(childData.gender || '-');
        chart_section.find('.equipment').text(childData.measurement_equipment_type || '-');
        chart_section.find('.position').text(childData.measurement_position_type || '-');
        chart_section.find('.supervisor-name').text(childData.supervisor || '-');
        chart_section.find('.current-age').text(childData.age_months || '-');
        chart_section.find('.current-weight').text(childData.weight ? parseFloat(childData.weight).toFixed(1) : '-');
        chart_section.find('.current-height').text(childData.height ? parseFloat(childData.height).toFixed(1) : '-');

        updateZScoreElement(chart_section.find('.current-wfa'), childData.weight_for_age_zscore);
        updateZScoreElement(chart_section.find('.current-hfa'), childData.height_for_age_zscore);
        updateZScoreElement(chart_section.find('.current-wfh'), childData.weight_for_height_zscore);

        indicator_selector.find('.indicator-btn').removeClass('active')
            .filter(`[data-type="${currentChartType}"]`)
            .addClass('active')
            .css({
                "background-color": "#5979aa",
                "color": "#ffffff"
            });

        chart_placeholder.show().html(`
            <div class="chart-loading">
                <i class="fa fa-spinner fa-spin fa-2x"></i>
            </div>
        `);

        const chartPeriod = getEffectivePeriod();
        frappe.call({
            method: "frappe.apf.page.growth_monitoring_ch.growth_chart.get_growth_chart_for_child",
            args: {
                child_name: childData.child_idx,
                chart_type: currentChartType,
                year: chartPeriod.year,
                month: chartPeriod.month
            },
            callback: function (r) {
                if (r.message) {
                    renderGrowthChart(r.message);
                } else {
                    chart_placeholder.html(`
                        <div class="text-center text-danger">
                            <i class="fa fa-exclamation-triangle fa-3x"></i>
                            <p>${__('Failed to load chart data')}</p>
                        </div>
                    `);
                }
            }
        });
    }

    function formatDateToDDMMYYYY(dateString) {
        if (!dateString) return 'Unknown';

        try {
            if (/^\d{2}-\d{2}-\d{4}$/.test(dateString)) {
                return dateString;
            }
            if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
                const [year, month, day] = dateString.split('-');
                return `${day}-${month}-${year}`;
            }
            const date = new Date(dateString);
            if (!isNaN(date)) {
                const day = String(date.getDate()).padStart(2, '0');
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const year = date.getFullYear();
                return `${day}-${month}-${year}`;
            }
            return 'Unknown';
        } catch (error) {
            console.error('Date formatting error:', error);
            return 'Unknown';
        }
    }

    function renderGrowthChart(chartData) {
        if (growthChart) {
            growthChart.destroy();
        }

        const { standards, measurements, chart_meta, child_info } = chartData;
        const { chartTitle, yAxisLabel, xAxisLabel } = getChartConfig(currentChartType, child_info);

        try {
            const ctx = chart_canvas.getContext('2d');
            const severeColor = 'rgba(255, 59, 48, 0.35)';
            const moderateColor = 'rgba(255, 204, 0, 0.4)';
            const normalColor = 'rgba(52, 199, 89, 0.3)';
            const severeLineColor = 'rgba(248, 12, 0, 0.8)';
            const moderateLineColor = 'rgba(255, 204, 0, 1)';
            const normalLineColor = 'rgba(44, 227, 20, 0.8)';

            const datasets = [
                {
                    label: 'Severe',
                    data: standards.red_cor,
                    backgroundColor: severeColor,
                    borderColor: 'transparent',
                    borderWidth: 0,
                    pointRadius: 0,
                    fill: true,
                    showLine: true,
                    tension: 0.4
                },
                {
                    label: 'Moderate',
                    data: standards.yellow_max,
                    backgroundColor: moderateColor,
                    borderColor: 'transparent',
                    borderWidth: 0,
                    pointRadius: 0,
                    fill: '-1',
                    showLine: true,
                    tension: 0.4
                },
                {
                    label: 'Normal',
                    data: standards.green_cor,
                    backgroundColor: normalColor,
                    borderColor: 'transparent',
                    borderWidth: 0,
                    pointRadius: 0,
                    fill: '-1',
                    showLine: true,
                    tension: 0.4
                },
                {
                    label: 'Normal',
                    data: standards.green_cor,
                    borderColor: normalLineColor,
                    backgroundColor: 'transparent',
                    borderWidth: 1.5,
                    pointRadius: 0,
                    fill: false,
                    showLine: true,
                    tension: 0.4
                },
                {
                    label: 'Moderate',
                    data: standards.yellow_max,
                    borderColor: moderateLineColor,
                    backgroundColor: 'transparent',
                    borderWidth: 1.5,
                    pointRadius: 0,
                    fill: false,
                    showLine: true,
                    tension: 0.4
                },
                {
                    label: 'Severe',
                    data: standards.red_cor,
                    borderColor: severeLineColor,
                    backgroundColor: 'transparent',
                    borderWidth: 1.5,
                    pointRadius: 0,
                    fill: false,
                    showLine: true,
                    tension: 0.4
                },
                {
                    label: `${child_info.child_name}'s Measurements`,
                    data: measurements.map(m => ({
                        x: m.x,
                        y: m.y,
                        date: formatDateToDDMMYYYY(m.date),
                        zscore: m.zscore,
                        status: m.status
                    })),
                    borderColor: '#000000',
                    backgroundColor: '#000000',
                    borderWidth: 1,
                    pointRadius: 5,
                    pointHoverRadius: 7,
                    pointBackgroundColor: function (context) {
                        const value = context.dataset.data[context.dataIndex].status;
                        if (value === 1) return '#000000';
                        if (value === 2) return '#000000';
                        return '#000000';
                    },
                    pointBorderColor: '#ffffff',
                    pointBorderWidth: 1,
                    showLine: true,
                    tension: 0,
                    fill: false
                }
            ];

            const chartOptions = {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: chartTitle,
                        font: {
                            size: 16,
                            weight: 'bold'
                        },
                        padding: {
                            top: 10,
                            bottom: 20
                        },
                        color: '#000000'
                    },
                    legend: {
                        position: 'bottom',
                        labels: {
                            boxWidth: 12,
                            padding: 20,
                            usePointStyle: true,
                            font: {
                                size: 12
                            },
                            filter: function (item, chart) {
                                return item.datasetIndex >= 3 || item.datasetIndex === datasets.length - 1;
                            }
                        }
                    },

                    tooltip: {
                        enabled: true,
                        mode: 'nearest',
                        intersect: false,
                        backgroundColor: 'rgba(50, 50, 50, 0.9)',
                        borderColor: 'rgba(255,255,255,0.2)',
                        borderWidth: 1,
                        padding: 12,
                        borderRadius: 8,
                        titleFont: {
                            size: 14,
                            weight: 'bold',
                            family: 'Arial'
                        },
                        bodyFont: {
                            size: 13,
                            weight: 'normal',
                            family: 'Arial'
                        },
                        callbacks: {
                            filter: function (tooltipItem) {
                                return (tooltipItem.datasetIndex >= 3 && tooltipItem.datasetIndex <= 5) ||
                                    tooltipItem.datasetIndex === datasets.length - 1;
                            },
                            title: function (context) {
                                return context[0].datasetIndex === datasets.length - 1
                                    ? "Child's Measurement"
                                    : "Growth Standard";
                            },
                            beforeBody: function (context) {
                                const xValue = context[0].parsed.x;
                                const rangeValues = [];

                                for (let i = 3; i <= 5; i++) {
                                    const dataset = datasets[i];
                                    const point = dataset.data.find(d => d.x === xValue);
                                    if (point) {
                                        rangeValues.push({
                                            label: dataset.label,
                                            value: point.y
                                        });
                                    }
                                }

                                const rangeLines = rangeValues.map(range => {
                                    let emoji = '';
                                    if (range.label === 'Normal') emoji = '🟢';
                                    else if (range.label === 'Moderate') emoji = '🟡';
                                    else if (range.label === 'Severe') emoji = '🔴';
                                    return `${emoji} ${range.label}: ${range.value.toFixed(2)} ${yAxisLabel}`;
                                });

                                const isMonthsMode = currentXAxisMode === 'months' && currentChartType !== 'weight_for_height';
                                const xDisplay = isMonthsMode
                                    ? `${(xValue / 30.4375).toFixed(1)} Months`
                                    : `${xValue.toFixed(2)}`;
                                const xLabel = isMonthsMode ? 'Age (Months)' : xAxisLabel;

                                if (context[0].datasetIndex === datasets.length - 1) {
                                    const data = context[0].raw;
                                    return [
                                        `📍 Measurement: ${data.y.toFixed(2)} ${yAxisLabel}`,
                                        `📈 ${xLabel}: ${xDisplay}`,
                                        `📅 Date: ${data.date || 'Unknown'}`
                                    ];
                                }

                                return [
                                    ...rangeLines,
                                    `📆 ${xLabel}: ${xDisplay}`
                                ];
                            },
                            label: function () {
                                return null;
                            }
                        }
                    }

                },
                scales: {
                    y: {
                        title: {
                            display: true,
                            text: yAxisLabel,
                            font: {
                                weight: 'bold',
                                size: 14
                            },
                            color: '#000000'
                        },
                        min: chart_meta.minY,
                        max: chart_meta.maxY,
                        ticks: {
                            color: '#000000',
                            stepSize: currentChartType === 'weight_for_height' ? 2 : (chart_meta.maxY > 20 ? 5 : 2),
                            callback: function (value) {
                                if (currentChartType === 'weight_for_height') {
                                    const fixedYTicks = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 27.2];
                                    return fixedYTicks.includes(value) ? value : '';
                                }
                                return value % (chart_meta.maxY > 20 ? 5 : 2) === 0 ? value : '';
                            },
                            font: {
                                size: 12
                            }
                        },
                        grid: {
                            color: 'rgba(0, 0, 0, 0.1)'
                        }
                    },
                    x: {
                        title: {
                            display: true,
                            text: (currentChartType !== 'weight_for_height' && currentXAxisMode === 'months')
                                ? 'Age (Months)' : xAxisLabel,
                            font: {
                                weight: 'bold',
                                size: 14
                            },
                            color: '#000000'
                        },
                        min: currentChartType === 'weight_for_height' ? chart_meta.minX : 0,
                        max: currentChartType === 'weight_for_height' ? chart_meta.maxX : (currentXAxisMode === 'months' ? Math.round(39 * 30.4375) : 1200),
                        ticks: {
                            color: '#000000',
                            callback: function (value) {
                                if (currentChartType === 'weight_for_height') {
                                    const fixedXTicks = [45, 60, 80, 100, 120];
                                    return fixedXTicks.includes(value) ? value : '';
                                } else if (currentXAxisMode === 'months') {
                                    const monthTicks = [0, 6, 12, 18, 24, 30, 36, 39];
                                    const DAYS_PER_MONTH = 30.4375;
                                    for (const m of monthTicks) {
                                        if (Math.abs(value - m * DAYS_PER_MONTH) < DAYS_PER_MONTH / 2) {
                                            return m;
                                        }
                                    }
                                    return '';
                                } else {
                                    const fixedAgeTicks = [0, 200, 400, 600, 800, 1000, 1200];
                                    return fixedAgeTicks.includes(value) ? value : '';
                                }
                            },
                            autoSkip: false,
                            font: {
                                size: 12
                            },
                            maxRotation: 0,
                            minRotation: 0
                        },
                        afterBuildTicks: function (axis) {
                            if (currentChartType === 'weight_for_age' || currentChartType === 'height_for_age') {
                                if (currentXAxisMode === 'months') {
                                    const monthTicks = [0, 6, 12, 18, 24, 30, 36, 39];
                                    const DAYS_PER_MONTH = 30.4375;
                                    axis.ticks = monthTicks.map(m => ({ value: Math.round(m * DAYS_PER_MONTH) }));
                                    return;
                                }
                                axis.ticks = [0, 200, 400, 600, 800, 1000, 1200].map(v => ({
                                    value: v,
                                    label: v.toString()
                                }));
                                return;
                            }
                        }
                    }
                },
                elements: {
                    line: {
                        tension: 0
                    },
                    point: {
                        hoverRadius: 7
                    }
                }
            };

            growthChart = new Chart(ctx, {
                type: 'scatter',
                data: { datasets },
                options: chartOptions
            });

            chart_placeholder.hide();

        } catch (error) {
            console.error("Chart rendering error:", error);
            chart_placeholder.html(`
                <div class="text-center text-danger" style="padding: 50px;">
                    <i class="fa fa-exclamation-triangle fa-3x"></i>
                    <p>${__('Failed to render chart. Please try again.')}</p>
                </div>
            `);
        }
    }

    function getChartConfig(chartType, childData) {
        const genderText = childData.gender_id === "1" ? 'Boy' : 'Girl';
        const configs = {
            'weight_for_age': {
                chartTitle: `Weight for Age - (${genderText})`,
                yAxisLabel: "Weight (kg)",
                xAxisLabel: "Age (Days)"
            },
            'height_for_age': {
                chartTitle: `Height for Age - (${genderText})`,
                yAxisLabel: "Height (cm)",
                xAxisLabel: "Age (Days)"
            },
            'weight_for_height': {
                chartTitle: `Weight for Height - (${genderText})`,
                yAxisLabel: "Weight (kg)",
                xAxisLabel: "Height (cm)"
            },
            'attendance': {
                chartTitle: `Monthly Attendance`,
                yAxisLabel: "Days",
                xAxisLabel: "Month"
            }
        };
        return configs[chartType] || {
            chartTitle: "Growth Chart",
            yAxisLabel: "Value",
            xAxisLabel: "Age (Days)"
        };
    }

    // -------- Logic Features --------
    $(`
        <style>
            body.modal-open { overflow: hidden; }
            @keyframes slideDown {
                from { opacity: 0; transform: translateY(-20px); }
                to { opacity: 1; transform: translateY(0); }
            }
            @media (max-width: 600px) {
                .logic-btn { display: none !important; }
            }
        </style>
        <div id="logicModal" style="display: none; position: fixed; z-index: 10000; left: 0; top: 0; width: 100%; height: 100%; overflow: auto; background-color: rgba(0, 0, 0, 0.5); backdrop-filter: blur(3px);">
            <div id="logicModalContent" class="modal-content" style="background-color: #fff; margin: 5% auto; padding: 20px; border-radius: 12px; width: 90%; max-width: 1200px; max-height: 90vh; overflow: hidden; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2); position: relative; display: flex; flex-direction: column; animation: slideDown 0.3s ease;">
                <div style="display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 15px;">
                    <h2 style="flex: 1; margin: 0; font-size: 1.45rem; color: #5979aa;">Report Card Logic</h2>
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
    `).appendTo(page.main);

    const logicDataList = [
        { "title": "Child List", "logic": "List of children enrolled in the selected creche (filtered by the selected month, year and any partner / state / district / block / gram panchayat / supervisor filters). Selecting a child name filters the list to that child." },
        { "title": "Severe Child (red name)", "logic": "Children flagged as severe in the selected month are shown in red and bold in the child list" },
        { "title": "Special Nutrition Care (yellow row)", "logic": "Children flagged for special nutrition care (SNC) in the selected month are highlighted with a yellow row background in the child list" },
        { "title": "Age (in days)", "logic": "Age of the child at the date of measurement, calculated in days from the date of birth" },
        { "title": "Weight / Height", "logic": "Weight (kg) and height (cm) recorded for the child at the latest measurement of the selected month" },
        { "title": "WFA (Z-score)", "logic": "Weight-for-Age Z-score of the latest measurement. Green: between -2 and +2 (normal), Yellow: below -2 or above +2 (moderate), Red: below -3 or above +3 (severe)" },
        { "title": "HFA (Z-score)", "logic": "Height-for-Age Z-score of the latest measurement. Green: between -2 and +2 (normal), Yellow: below -2 or above +2 (moderate), Red: below -3 or above +3 (severe)" },
        { "title": "WFH (Z-score)", "logic": "Weight-for-Height Z-score of the latest measurement. Green: between -2 and +2 (normal), Yellow: below -2 or above +2 (moderate), Red: below -3 or above +3 (severe)" },
        { "title": "Weight for Age Chart", "logic": "Child's weight plotted against age on the growth standard bands (Normal / Moderate / Severe). The X-axis can be switched between Days and Months" },
        { "title": "Height for Age Chart", "logic": "Child's height plotted against age on the growth standard bands (Normal / Moderate / Severe). The X-axis can be switched between Days and Months" },
        { "title": "Weight for Height Chart", "logic": "Child's weight plotted against height on the growth standard bands (Normal / Moderate / Severe)" },
        { "title": "Attendance Chart", "logic": "For the last six months up to the selected month: number of days the creche was open versus number of days the child was present. Attendance % = child present days / creche opened days" }
    ];

    function populateLogicTable() {
        const tbody = document.getElementById("logicTableBody");
        if (tbody.innerHTML.trim() !== "") return; // Avoid repopulating

        let rowsHtml = "";
        logicDataList.forEach((row, index) => {
            const bgClass = index % 2 === 0 ? "background-color: #f9f9f9;" : "background-color: #ffffff;";
            rowsHtml += `
                <tr style="${bgClass}">
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

    function setLogicBtnBusy(btn, busy, originalText) {
        if (busy) {
            btn.text('Downloading...');
            btn.prop('disabled', true).css({ opacity: 0.6, cursor: 'not-allowed' });
        } else {
            btn.text(originalText);
            btn.prop('disabled', false).css({ opacity: 1, cursor: 'pointer' });
        }
    }

    // Expands the modal so the whole table is captured; returns a function that restores it
    function expandLogicModal(targetElement, wrapper) {
        const orig = {
            wrapperMaxHeight: wrapper.style.maxHeight,
            wrapperOverflowY: wrapper.style.overflowY,
            modalMaxHeight: targetElement.style.maxHeight,
            modalOverflow: targetElement.style.overflow
        };
        wrapper.style.maxHeight = 'none';
        wrapper.style.overflowY = 'visible';
        targetElement.style.maxHeight = 'none';
        targetElement.style.overflow = 'visible';

        return function restore() {
            wrapper.style.maxHeight = orig.wrapperMaxHeight;
            wrapper.style.overflowY = orig.wrapperOverflowY;
            targetElement.style.maxHeight = orig.modalMaxHeight;
            targetElement.style.overflow = orig.modalOverflow;
        };
    }

    $(document).on("click", "#downloadLogicXlsxBtn", function (e) {
        e.preventDefault();
        const btn = $(this);
        const originalText = btn.text();
        setLogicBtnBusy(btn, true);

        setTimeout(() => {
            try {
                const rows = logicDataList.map(row => ({ "Item": row.title, "Logic": row.logic }));

                if (rows.length > 0) {
                    const worksheet = XLSX.utils.json_to_sheet(rows);
                    const workbook = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(workbook, worksheet, "Report Card Logic");
                    XLSX.writeFile(workbook, "growth_monitoring_ch_logic.xlsx");
                }
            } catch (err) {
                console.error("Error generating Logic XLSX", err);
                if (frappe && frappe.msgprint) frappe.msgprint("Error generating XLSX.");
            } finally {
                setLogicBtnBusy(btn, false, originalText);
            }
        }, 100);
    });

    $(document).on("click", "#downloadLogicPngBtn", function (e) {
        e.preventDefault();
        const btn = $(this);
        const originalText = btn.text();
        setLogicBtnBusy(btn, true);

        setTimeout(() => {
            const targetElement = document.getElementById('logicModalContent');
            const wrapper = document.getElementById('logicTableWrapper');
            if (targetElement && wrapper) {
                const restore = expandLogicModal(targetElement, wrapper);

                html2canvas(targetElement, {
                    scale: 2,
                    windowHeight: targetElement.scrollHeight,
                    scrollY: -window.scrollY
                }).then(canvas => {
                    canvas.toBlob(function (blob) {
                        const url = URL.createObjectURL(blob);
                        const link = document.createElement("a");
                        link.href = url;
                        link.download = "growth_monitoring_ch_logic.png";
                        link.click();
                        URL.revokeObjectURL(url);

                        restore();
                        setLogicBtnBusy(btn, false, originalText);
                    }, "image/png");
                }).catch(err => {
                    console.error("Error generating Logic PNG", err);
                    if (frappe && frappe.msgprint) frappe.msgprint("Error generating PNG.");

                    restore();
                    setLogicBtnBusy(btn, false, originalText);
                });
            } else {
                setLogicBtnBusy(btn, false, originalText);
            }
        }, 100);
    });

    $(document).on("click", "#downloadLogicPdfBtn", function (e) {
        e.preventDefault();
        const btn = $(this);
        const originalText = btn.text();
        setLogicBtnBusy(btn, true);

        setTimeout(() => {
            const targetElement = document.getElementById('logicModalContent');
            const wrapper = document.getElementById('logicTableWrapper');
            if (targetElement && wrapper) {
                const restore = expandLogicModal(targetElement, wrapper);

                html2canvas(targetElement, {
                    scale: 2,
                    windowHeight: targetElement.scrollHeight,
                    scrollY: -window.scrollY
                }).then(canvas => {
                    const { jsPDF: JSPDF } = window.jspdf || {};
                    const JsPDF = JSPDF || window.jsPDF;

                    const imgWidth = canvas.width;
                    const imgHeight = canvas.height;
                    const ratio = imgWidth / imgHeight;

                    // A4 portrait, fit width
                    const doc = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
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

                        const sliceCanvas = document.createElement('canvas');
                        sliceCanvas.width = imgWidth;
                        sliceCanvas.height = srcH;
                        const ctx = sliceCanvas.getContext('2d');
                        ctx.drawImage(canvas, 0, srcY, imgWidth, srcH, 0, 0, imgWidth, srcH);

                        if (yOffset > 0) doc.addPage();
                        doc.addImage(sliceCanvas.toDataURL('image/png'), 'PNG', 0, 0, scaledW, sliceH);

                        yOffset += sliceH;
                        remaining -= sliceH;
                    }

                    doc.save('growth_monitoring_ch_logic.pdf');

                    restore();
                    setLogicBtnBusy(btn, false, originalText);
                }).catch(err => {
                    console.error("Error generating Logic PDF", err);
                    if (frappe && frappe.msgprint) frappe.msgprint("Error generating PDF.");

                    restore();
                    setLogicBtnBusy(btn, false, originalText);
                });
            } else {
                setLogicBtnBusy(btn, false, originalText);
            }
        }, 100);
    });
};