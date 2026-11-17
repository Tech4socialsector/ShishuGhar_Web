frappe.pages['review-card'].on_page_load = function (wrapper) {
    var page = frappe.ui.make_app_page({
        parent: wrapper,
        title: 'Review Card',
        single_column: true
    });

    frappe.require("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js");
    frappe.require("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js");
    frappe.require("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");

    const BRAND = "#5979aa";
    const BASE_URL = window.location.origin;
    const API_ROOT = `${BASE_URL}/api/method/frappe.apf.page.review_card`;

    let filters = [
        {
            // Which date filter is used: the Date Range (From - To) or the Year and Month, never both.
            fieldname: "date_input_type",
            label: __("Date Input Type"),
            fieldtype: "Select",
            options: [
                { value: "date_range", label: __("Date Range") },
                { value: "month_year", label: __("Month/Year") }
            ],
            default: "month_year"
        },
        {
            // Shown (and set to the current month) when the Date Range type is chosen
            fieldname: "date_range",
            label: __("Date Range"),
            fieldtype: "DateRange",
            hidden: 1 // Initially hidden
        },
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
            hidden: 0 // Initially visible
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
            "hidden": 0 // Initially visible
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
                return { filters: { "is_active": 1 } };
            }
        },
        {
            "fieldname": "district",
            "label": __("District"),
            "fieldtype": "Link",
            "options": "District",
            "get_query": function () {
                let state = page.fields_dict["state"].get_value();
                let filters = { "is_active": 1 };
                if (state) {
                    filters["state_id"] = state;
                }
                return { filters };
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

    // Date Input Type: show only the filters of the chosen type and reset the ones of the other.
    //  - Date Range: the date range is set to the current month; Year and Month are reset and hidden.
    //  - Month/Year: Year and Month are set to the current ones; the date range is reset and hidden.
    // A control is shown before its value is set, so that a Select already has its options.
    async function applyDateInputType() {
        const dateInputType = page.fields_dict["date_input_type"].get_value();
        const dateRange = page.fields_dict["date_range"];
        const year = page.fields_dict["year"];
        const month = page.fields_dict["month"];

        if (dateInputType === "date_range") {
            dateRange.toggle(true);
            await dateRange.set_value([frappe.datetime.month_start(), frappe.datetime.month_end()]);

            // Reset year & month
            await year.set_value("");
            await month.set_value("");
            year.toggle(false);
            month.toggle(false);
        } else if (dateInputType === "month_year") {
            // Set default year & month (the Month options are "1" ... "12")
            const [todayYear, todayMonth] = frappe.datetime.get_today().split('-');
            year.toggle(true);
            month.toggle(true);
            await year.set_value(todayYear);
            await month.set_value(String(Number(todayMonth)));

            // Reset date range
            await dateRange.set_value("");
            dateRange.toggle(false);
        }
    }

    page.fields_dict["date_input_type"].$input.on("change", async function () {
        await applyDateInputType();
        // Refresh the cards for the selected filters to take effect
        await renderCards();
    });

    // The first search (see the end of this file) waits for this, so that it reads the filters of the default type.
    const dateInputReady = applyDateInputType().catch(err => console.error("Error applying the Date Input Type:", err));

    function resetForwardFilters(currentFilter) {
        let currentIndex = filters.findIndex(filter => filter.fieldname === currentFilter);
        if (currentIndex === -1) return;

        for (let i = currentIndex + 1; i < filters.length; i++) {
            if (["creche_status_id", "phases", "date_range"].includes(page.fields_dict[filters[i].fieldname].df.fieldname))
                continue;
            page.fields_dict[filters[i].fieldname].set_value("");
        }
    }

    filters.forEach(filter => {
        if ((filter.fieldtype === "Link" || filter.fieldtype === "Select") && !["date_input_type", "year", "month"].includes(filter.fieldname)) {
            const input = page.fields_dict[filter.fieldname].input;
            if (input) {
                input.addEventListener("change", () => {
                    resetForwardFilters(filter.fieldname);
                });
            }
        }
    });

    // ------------------------------------------------------------------
    // Filter bar: every filter is always shown
    // ------------------------------------------------------------------
    function fieldWrapper(name) {
        const field = page.fields_dict[name];
        return field.$wrapper || $(field.wrapper);
    }

    // Every filter gets a caption above it (the Frappe inputs only carry a placeholder). An empty dropdown shows
    // the name of its filter, for the Link, MultiSelect and Select filters alike.
    // The opening-date type and its date / range would all read "Creche Opening Date" otherwise.
    const CAPTIONS = { c_opening_range: __("Opening Range"), single_date: __("Opening Date") };
    [...filters.map(f => f.fieldname), "cr_opening_range_type", "c_opening_range", "single_date"].forEach(name => {
        const field = page.fields_dict[name];
        if (!field) return;
        fieldWrapper(name).attr('data-rv-label', CAPTIONS[name] || field.df.label);
        if (["Link", "MultiSelect"].includes(field.df.fieldtype) && field.$input) field.$input.attr('placeholder', field.df.label);
        if (["Date", "DateRange"].includes(field.df.fieldtype) && field.$input) {
            field.$input.attr('placeholder', field.df.fieldtype === "DateRange" ? __('Select range') : __('Select date'));
        }
        // Frappe's own text for an empty Select (shown while it has no value)
        if (field.df.fieldtype === "Select") fieldWrapper(name).find('.placeholder span').text(field.df.label);
    });
    // Creche Status sits with the area filters, ahead of Block.
    fieldWrapper("block").before(fieldWrapper("creche_status_id"));

    // The bar's background, border and shadow are drawn by this element (see the CSS).
    const filterBar = page.wrapper.find('.page-form');
    filterBar.prepend('<div class="rv-bar-chrome" aria-hidden="true"></div>');

    // ------------------------------------------------------------------
    // Header buttons: Search / Reset / Download / Logic (+ mobile kebab)
    // ------------------------------------------------------------------
    let searchBtn = page.add_button(`Search`, async () => {
        searchBtn.text('Searching....');
        searchBtn.prop('disabled', true);
        await renderCards();
        searchBtn.text('Search');
        searchBtn.prop('disabled', false);
    });

    let resetBtn = page.add_button(`Reset`, async () => {
        resetBtn.prop('disabled', true);
        location.reload();
    });

    searchBtn.addClass('rv-search-btn').css({
        "background-color": BRAND,
        "color": "white",
        "border": `1px solid ${BRAND}`,
        "border-radius": "4px",
        "padding": "5px 16px",
        "font-weight": "500",
        "font-size": "14px"
    });
    resetBtn.addClass('rv-reset-btn').css({
        "background-color": "#f9fafb",
        "color": "#1f2937",
        "border": "1px solid #d1d5db",
        "border-radius": "4px",
        "padding": "5px 16px",
        "font-weight": "500",
        "font-size": "14px"
    });

    let downloadDropdown = $(`
        <div class="dropdown rv-download-dropdown" style="display:inline-block; position: relative;">
            <button class="btn btn-default btn-sm dropdown-toggle" type="button" style="background-color: ${BRAND}; color: white; border: 1px solid ${BRAND}; border-radius: 4px; padding: 5px 16px; font-weight: 500; font-size: 14px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center;">
                <span>Download</span>
            </button>
            <div class="dropdown-menu" style="display: none; position: absolute; top: 100%; left: 0; background-color: white; border: 1px solid #ddd; border-radius: 4px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); z-index: 1000; min-width: 100%; margin-top: 5px; padding: 0;">
                <a href="#" class="dropdown-item" id="rv-dl-png" style="display: block; padding: 8px 16px; color: #333; text-decoration: none; border-bottom: 1px solid #eee;">PNG</a>
                <a href="#" class="dropdown-item" id="rv-dl-xlsx" style="display: block; padding: 8px 16px; color: #333; text-decoration: none; border-bottom: 1px solid #eee;">XLSX</a>
                <a href="#" class="dropdown-item" id="rv-dl-pdf" style="display: block; padding: 8px 16px; color: #333; text-decoration: none;">PDF</a>
            </div>
        </div>
    `);

    page.wrapper.find('.custom-actions').append(downloadDropdown);

    let logicBtn = $(`
        <button class="btn btn-default btn-sm rv-logic-btn" type="button" style="background-color: ${BRAND}; color: white; border: 1px solid ${BRAND}; border-radius: 4px; padding: 5px 16px; font-weight: 500; font-size: 14px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; margin-left: 5px;">
            <span>Logic</span>
        </button>
    `);

    page.wrapper.find('.custom-actions').append(logicBtn);

    // Mobile three-dot (kebab) menu, shown only on screens <= 600px
    let mobileKebab = $(`
        <div id="rv-mobile-kebab" style="display:none; position:relative;">
            <button id="rv-mob-kebab-btn" type="button" style="
                background:${BRAND}; color:white; border:1px solid ${BRAND};
                border-radius:4px; padding:4px 10px; font-size:20px; line-height:1;
                cursor:pointer; display:inline-flex; align-items:center; justify-content:center;">
                &#8942;
            </button>
            <div id="rv-mob-kebab-dropdown" style="
                display:none; position:absolute; right:0; top:calc(100% + 4px);
                background:white; border:1px solid #ddd; border-radius:6px;
                box-shadow:0 4px 12px rgba(0,0,0,0.12); z-index:9999; min-width:160px; padding:4px 0;">
                <a href="#" id="rv-mob-search-btn" style="display:block;padding:9px 16px;color:#333;text-decoration:none;border-bottom:1px solid #eee;">Search</a>
                <a href="#" id="rv-mob-reset-btn"  style="display:block;padding:9px 16px;color:#333;text-decoration:none;border-bottom:1px solid #eee;">Reset</a>
                <a href="#" id="rv-mob-dl-png-btn" style="display:block;padding:9px 16px;color:#333;text-decoration:none;border-bottom:1px solid #eee;">Download PNG</a>
                <a href="#" id="rv-mob-dl-xlsx-btn" style="display:block;padding:9px 16px;color:#333;text-decoration:none;border-bottom:1px solid #eee;">Download XLSX</a>
                <a href="#" id="rv-mob-dl-pdf-btn" style="display:block;padding:9px 16px;color:#333;text-decoration:none;border-bottom:1px solid #eee;">Download PDF</a>
                <a href="#" id="rv-mob-logic-btn" style="display:block;padding:9px 16px;color:#333;text-decoration:none;">Logic</a>
            </div>
        </div>
    `);
    page.wrapper.find('.custom-actions').append(mobileKebab);

    mobileKebab.find('#rv-mob-kebab-btn').on('click', function (e) {
        e.stopPropagation();
        mobileKebab.find('#rv-mob-kebab-dropdown').toggle();
    });
    $(document).on('click.rv-kebab', function () {
        mobileKebab.find('#rv-mob-kebab-dropdown').hide();
        downloadDropdown.find('.dropdown-menu').hide();
    });

    function bindMobileAction(selector, idleText, busyText, action) {
        mobileKebab.find(selector).on('click', async function (e) {
            e.preventDefault();
            mobileKebab.find('#rv-mob-kebab-dropdown').hide();
            const $a = $(this);
            if (busyText) $a.text(busyText);
            await action();
            if (busyText) $a.text(idleText);
        });
    }
    bindMobileAction('#rv-mob-search-btn', 'Search', 'Searching...', () => renderCards());
    // The scope pop-up opens first; the kebab menu is already closed by then, so no busy label here.
    const withScope = (label, download) => async () => {
        const scope = await askDownloadScope(label);
        if (scope) await download(scope);
    };
    bindMobileAction('#rv-mob-dl-png-btn', 'Download PNG', null, withScope('PNG', downloadCardsPNG));
    bindMobileAction('#rv-mob-dl-xlsx-btn', 'Download XLSX', null, withScope('XLSX', downloadCardsXLSX));
    bindMobileAction('#rv-mob-dl-pdf-btn', 'Download PDF', null, withScope('PDF', downloadCardsPDF));
    bindMobileAction('#rv-mob-logic-btn', 'Logic', null, async () => openLogicModal());
    mobileKebab.find('#rv-mob-reset-btn').on('click', function (e) {
        e.preventDefault();
        location.reload();
    });

    mobileKebab.find('a').hover(
        function () { $(this).css('background-color', '#f5f5f5'); },
        function () { $(this).css('background-color', 'white'); }
    );
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

    function bindDownload(selector, label, download) {
        downloadDropdown.find(selector).on('click', async function (e) {
            e.preventDefault();
            downloadDropdown.find('.dropdown-menu').hide();
            const scope = await askDownloadScope(label);
            if (!scope) return;

            const btn = downloadDropdown.find('button');
            const btnSpan = btn.find('span');
            const originalText = btnSpan.text();
            btnSpan.text('Downloading...');
            btn.prop('disabled', true);

            setTimeout(async () => {
                try {
                    await download(scope);
                } finally {
                    btnSpan.text(originalText);
                    btn.prop('disabled', false);
                }
            }, 50);
        });
    }
    bindDownload('#rv-dl-png', 'PNG', downloadCardsPNG);
    bindDownload('#rv-dl-xlsx', 'XLSX', downloadCardsXLSX);
    bindDownload('#rv-dl-pdf', 'PDF', downloadCardsPDF);

    $(document).ready(function () {
        function applyResponsiveHeader() {
            if ($(window).width() <= 600) {
                mobileKebab.show();
                searchBtn.hide();
                resetBtn.hide();
                downloadDropdown.hide();
                logicBtn.hide();
            } else {
                mobileKebab.hide();
                searchBtn.show();
                resetBtn.show();
                downloadDropdown.show();
                logicBtn.show();
            }
        }
        applyResponsiveHeader();
        $(window).on('resize.rv-header', applyResponsiveHeader);
    });

    page.wrapper.find('.custom-actions').removeClass('hidden-xs hidden-md').css({
        "display": "flex",
        "flex-wrap": "nowrap",
        "align-items": "center",
        "gap": "5px"
    });
    page.wrapper.find(".menu-btn-group ").removeClass('show"').css({
        "display": "none"
    });

    // ------------------------------------------------------------------
    // Card definitions
    // ------------------------------------------------------------------
    const TONES = {
        blue:   { accent: "#4a76e3", light: "#86a6f2", soft: "#eef3fe", edge: "#d3def9" },
        teal:   { accent: "#12a08c", light: "#5fcbb9", soft: "#e8f8f5", edge: "#c9ece5" },
        violet: { accent: "#7c5cf0", light: "#a893f7", soft: "#f1edfe", edge: "#dcd3fa" },
        green:  { accent: "#34a56f", light: "#72cc9b", soft: "#e9f7ef", edge: "#cdebda" },
        amber:  { accent: "#e08a2c", light: "#f2b466", soft: "#fef4e5", edge: "#f7dfbb" },
        rose:   { accent: "#e0505b", light: "#f0868e", soft: "#fdeced", edge: "#f7cfd2" }
    };

    // Outline icons (24x24 viewBox), one per card, each drawn from the card title.
    // Shared bases keep related cards visually related (ruler = anthro, person = children, calendar = days).
    const RULER = '<rect x="3" y="2" width="6" height="20" rx="1"/><line x1="6" y1="6" x2="9" y2="6"/><line x1="6" y1="10" x2="9" y2="10"/><line x1="6" y1="14" x2="9" y2="14"/><line x1="6" y1="18" x2="9" y2="18"/>';
    const PERSON = '<path d="M14 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="8" cy="7" r="4"/>';
    const CALENDAR = '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>';
    const HOUSE = '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>';
    const WEIGHT = '<circle cx="12" cy="5" r="3"/><path d="M7 8h10l3 12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/>';
    const PIN = '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/>';
    const SHIELD = '<path d="M12 3 4 6v6c0 4.5 3.2 7.8 8 9 4.8-1.2 8-4.5 8-9V6z"/>';
    const CYLINDER = '<path d="M10 3h4"/><path d="M12 3v2"/><path d="M8 10a4 4 0 0 1 8 0v9a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2z"/><line x1="8" y1="12.5" x2="16" y2="12.5"/>';
    const BOX = '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><polyline points="3.29 7 12 12 20.71 7"/>';

    const ICONS = {
        // operational creches: a home where children are cared for
        creche: `${HOUSE}<path d="M12 18.5l-3-2.9a1.9 1.9 0 0 1 3-2.3 1.9 1.9 0 0 1 3 2.3z"/>`,
        // partner organizations: handshake
        handshake: '<path d="m11 17 2 2a1 1 0 1 0 3-3"/><path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4"/><path d="m21 3 1 11h-2"/><path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3"/><path d="M3 4h8"/>',
        // operational blocks: building blocks
        blocks: '<rect x="14" y="3" width="7" height="7" rx="1"/><path d="M10 21V8a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1H3"/>',
        // operational districts: folded map
        map: '<polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/>',
        // creche profile not submitted: clipboard with a cross
        clipboardX: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><line x1="10" y1="11" x2="14" y2="15"/><line x1="14" y1="11" x2="10" y2="15"/>',
        // quarterly household survey not done: house with a cross
        houseX: `${HOUSE}<line x1="9.5" y1="12.5" x2="14.5" y2="17.5"/><line x1="14.5" y1="12.5" x2="9.5" y2="17.5"/>`,
        // exit anthro missing: measuring rod, arrow leaving
        rulerOut: `${RULER}<line x1="12" y1="12" x2="21" y2="12"/><polyline points="18 9 21 12 18 15"/>`,
        // welcome anthro missing: measuring rod, arrow arriving
        rulerIn: `${RULER}<line x1="21" y1="12" x2="12" y2="12"/><polyline points="15 9 12 12 15 15"/>`,
        // wrong equipment chosen: measuring rod with a warning
        rulerAlert: `${RULER}<path d="M17 7.5 21.5 17h-9z"/><line x1="17" y1="11.5" x2="17" y2="13.5"/><line x1="17" y1="15.5" x2="17.01" y2="15.5"/>`,
        // enrolled children 10 or less: person with a down arrow
        personDown: `${PERSON}<line x1="19" y1="8" x2="19" y2="16"/><polyline points="16 13 19 16 22 13"/>`,
        // current eligible children: person with a tick
        personCheck: `${PERSON}<polyline points="16 11 18 13 22 9"/>`,
        // current enrolled children: group
        group: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
        // enrolled this month: person with a plus
        personPlus: `${PERSON}<line x1="19" y1="8" x2="19" y2="14"/><line x1="16" y1="11" x2="22" y2="11"/>`,
        // exited this month: person with an arrow leaving
        personExit: `${PERSON}<line x1="16" y1="11" x2="22" y2="11"/><polyline points="19 8 22 11 19 14"/>`,
        // eligible to enrolled %: pie chart
        pie: '<path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
        // enrolled vs exited ratio: balance scale
        balance: '<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>',
        // completed 36 months but not exited: hourglass, time is up
        hourglass: '<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.17a2 2 0 0 0-.59-1.42L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22"/><path d="M7 2v4.17a2 2 0 0 0 .59 1.42L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2"/>',
        // average attendance below 50%: gauge with the needle low
        gaugeLow: '<path d="M3.34 19a10 10 0 1 1 17.32 0"/><path d="m12 14-4-4"/><circle cx="12" cy="14" r="1"/>',
        // daily average attendance below 10: falling bars
        barsDown: '<path d="M3 3v18h18"/><line x1="8" y1="17" x2="8" y2="6"/><line x1="13" y1="17" x2="13" y2="10"/><line x1="18" y1="17" x2="18" y2="14"/>',
        // children with 0% attendance: person with a cross
        personX: `${PERSON}<line x1="17" y1="8" x2="22" y2="13"/><line x1="22" y1="8" x2="17" y2="13"/>`,
        // children below 50% attendance: person with a percent sign
        personPercent: `${PERSON}<line x1="22" y1="8.5" x2="16" y2="17.5"/><circle cx="16.8" cy="9.8" r="1.3"/><circle cx="21.2" cy="16.2" r="1.3"/>`,
        // creche closed more than 7 days: padlock
        lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/><line x1="12" y1="15" x2="12" y2="18"/>',
        // attendance not submitted for more than 5 days: calendar with a clock
        calendarClock: '<path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="8" y2="10"/><circle cx="16" cy="16" r="6"/><polyline points="16 13.5 16 16 17.5 17.2"/>',
        // attendance not submitted for all days: calendar with a cross
        calendarX: `${CALENDAR}<line x1="10" y1="14" x2="14" y2="18"/><line x1="14" y1="14" x2="10" y2="18"/>`,

        // ---- Malnutrition Prevalence ----
        // creches with less than 100% measurement: measuring rod with a percent sign
        rulerPercent: `${RULER}<line x1="21" y1="8" x2="15" y2="17"/><circle cx="15.8" cy="9.3" r="1.3"/><circle cx="20.2" cy="15.7" r="1.3"/>`,
        // implausible measurements: circled exclamation mark
        dataAlert: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
        // SAM children: pulse line
        pulse: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
        // Zig-Zag children: up and down line
        zigzag: '<polyline points="2 16 7 6 12 16 17 6 22 16"/>',

        // ---- Malnutrition Management ----
        // children to be referred: person with a warning
        personAlert: `${PERSON}<path d="M18 8 22 15h-8z"/><line x1="18" y1="10.8" x2="18" y2="12.4"/><line x1="18" y1="13.6" x2="18.01" y2="13.6"/>`,
        // children actually referred: clipboard with an arrow
        clipboardArrow: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><line x1="8" y1="14" x2="16" y2="14"/><polyline points="13 11 16 14 13 17"/>',
        // admitted to NRC: hospital bed
        bed: '<path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/>',
        // underweight moves: weight with an arrow
        weightDown: `${WEIGHT}<line x1="12" y1="12" x2="12" y2="18"/><polyline points="9.5 15.5 12 18 14.5 15.5"/>`,
        weightUp: `${WEIGHT}<line x1="12" y1="18" x2="12" y2="12"/><polyline points="9.5 14.5 12 12 14.5 14.5"/>`,
        weightAlert: `${WEIGHT}<line x1="12" y1="12" x2="12" y2="15.5"/><line x1="12" y1="18" x2="12.01" y2="18"/>`,
        // wasting moves: measuring rod with an arrow
        rulerDown: `${RULER}<line x1="16" y1="6" x2="16" y2="18"/><polyline points="13 15 16 18 19 15"/>`,
        rulerUp: `${RULER}<line x1="16" y1="18" x2="16" y2="6"/><polyline points="13 9 16 6 19 9"/>`,
        // GF1 -> GF2 / GF2 -> GF1: trend lines
        trendDown: '<polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/>',
        trendUp: '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',

        // ---- Check-In ----
        // fewer than 3 supervisor check-ins: map pin with a minus
        pinMinus: `${PIN}<line x1="9" y1="10" x2="15" y2="10"/>`,
        // no supervisor check-ins: map pin with a cross
        pinX: `${PIN}<line x1="9.5" y1="7.5" x2="14.5" y2="12.5"/><line x1="14.5" y1="7.5" x2="9.5" y2="12.5"/>`,
        // less than 2 hours of engagement: clock
        clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
        // no check-in at opening / closing time: sunrise / sunset
        sunrise: '<path d="M12 2v8"/><path d="m4.93 10.93 1.41 1.41"/><path d="M2 18h2"/><path d="M20 18h2"/><path d="m19.07 10.93-1.41 1.41"/><path d="M22 22H2"/><path d="m8 6 4-4 4 4"/><path d="M16 18a4 4 0 0 0-8 0"/>',
        sunset: '<path d="M12 10V2"/><path d="m4.93 10.93 1.41 1.41"/><path d="M2 18h2"/><path d="M20 18h2"/><path d="m19.07 10.93-1.41 1.41"/><path d="M22 22H2"/><path d="m16 6-4 4-4-4"/><path d="M16 18a4 4 0 0 0-8 0"/>',
        // training coordinators: graduation cap
        cap: '<path d="M22 10 12 5 2 10l10 5z"/><path d="M6 12.5V16c0 1.7 2.7 3 6 3s6-1.3 6-3v-3.5"/><path d="M22 10v6"/>',
        // MIS coordinators: monitor
        monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
        // safety coordinators: shield with a tick
        shield: '<path d="M12 3 4 6v6c0 4.5 3.2 7.8 8 9 4.8-1.2 8-4.5 8-9V6z"/><polyline points="9 12 11 14 15 10"/>',
        // logistics coordinators: delivery truck
        truck: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',

        // ---- Safety ----
        // safety audit not completed: shield with a cross
        shieldX: `${SHIELD}<line x1="9.5" y1="9.5" x2="14.5" y2="14.5"/><line x1="14.5" y1="9.5" x2="9.5" y2="14.5"/>`,
        // safety issues identified: shield with an exclamation mark
        shieldAlert: `${SHIELD}<line x1="12" y1="8" x2="12" y2="13"/><line x1="12" y1="16" x2="12.01" y2="16"/>`,
        // unresolved safety issues: shield with a clock, still open
        shieldClock: `${SHIELD}<polyline points="12 8 12 12.5 14.8 14"/>`,
        // infrastructural and environmental: building with a warning
        houseAlert: `${HOUSE}<line x1="12" y1="11" x2="12" y2="15"/><line x1="12" y1="17.5" x2="12.01" y2="17.5"/>`,
        // physical safety and security: fence
        fence: '<path d="M4 22V8l2-3 2 3v14"/><path d="M10 22V8l2-3 2 3v14"/><path d="M16 22V8l2-3 2 3v14"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="18" x2="22" y2="18"/>',
        // fire safety: flame
        flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
        // electrical safety: lightning bolt
        bolt: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
        // food safety: fork and knife
        utensils: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
        // other safety (caregivers, first aid, emergency numbers): first-aid box
        firstAid: '<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/>',

        // ---- Logistics ----
        // LPG status not updated: gas cylinder with a cross
        cylinderX: `${CYLINDER}<line x1="10" y1="15" x2="14" y2="19"/><line x1="14" y1="15" x2="10" y2="19"/>`,
        // LPG remaining for one month: gas cylinder, level going down
        cylinderLow: `${CYLINDER}<polyline points="10 15 12 17.5 14 15"/>`,
        // alternative fuel source: swap arrows
        swap: '<polyline points="17 2 21 6 17 10"/><path d="M3 12V10a4 4 0 0 1 4-4h14"/><polyline points="7 22 3 18 7 14"/><path d="M21 12v2a4 4 0 0 1-4 4H3"/>',
        // fire extinguisher status not updated: extinguisher
        extinguisher: '<path d="M15 6.5V3a1 1 0 0 0-1-1h-2a1 1 0 0 0-1 1v3.5"/><path d="M9 18h8"/><path d="M18 3h-3"/><path d="M11 3a6 6 0 0 0-6 6v11"/><path d="M5 13h4"/><path d="M17 10a4 4 0 0 0-8 0v10a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2Z"/>',
        // fire extinguisher awaiting refilling: circular arrows
        refill: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
        // monthly stock not updated: package
        box: `${BOX}<line x1="12" y1="22" x2="12" y2="12"/>`,
        // zero or negative balance: rupee sign
        rupee: '<path d="M6 3h12"/><path d="M6 8h12"/><path d="m6 13 8.5 8"/><path d="M6 13h3"/><path d="M9 13c6.667 0 6.667-10 0-10"/>',
        // weekly cashbook not updated: wallet
        wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>'
    };

    // `query` is the query_type sent to review_cards_details.fetch_review_card_data.
    const CARDS = {
        op_creches: { icon: "creche", tone: "blue", title: "No. of operational creches", query: "op_creches" },
        op_partners: { icon: "handshake", tone: "teal", title: "No. of partner organizations", query: "op_partners" },
        op_blocks: { icon: "blocks", tone: "violet", title: "No. of operational blocks", query: "op_blocks" },
        op_districts: { icon: "map", tone: "green", title: "No. of operational districts", query: "op_districts" },
        profile_not_submitted: { icon: "clipboardX", tone: "amber", title: "No. of creches not submitted creche profile", query: "profile_not_submitted" },

        hh_not_done: { icon: "houseX", tone: "amber", title: "No of Creches Quarterly HH Not Done", query: "hh_not_done" },
        no_exit_anthro: { icon: "rulerOut", tone: "rose", title: "No. of children without exit anthro", query: "no_exit_anthro" },
        no_welcome_anthro: { icon: "rulerIn", tone: "rose", title: "No. of children without welcome anthro", query: "no_welcome_anthro" },
        wrong_equipment: { icon: "rulerAlert", tone: "rose", title: "No of Creches where Wrong Equipment is Chosen for Welcome Anthro/Exit Anthro", query: "wrong_equipment" },
        low_enrolment: { icon: "personDown", tone: "amber", title: "No. of Creches with Enrolled Children 10 or Less than 10", query: "low_enrolment" },
        eligible: { icon: "personCheck", tone: "blue", title: "No. of current eligible children", query: "eligible" },
        enrolled: { icon: "group", tone: "teal", title: "No. of current enrolled children", query: "enrolled" },
        enrolled_month: { icon: "personPlus", tone: "green", title: "No. of children enrolled this month", query: "enrolled_month" },
        exited_month: { icon: "personExit", tone: "violet", title: "No. of children exited this month", query: "exited_month" },
        eligible_vs_enrolled: { icon: "pie", tone: "teal", title: "Current Eligible to Current Enrolled %", query: "eligible_vs_enrolled" },
        enrolment_exit_ratio: { icon: "balance", tone: "blue", title: "Current month enrolled vs Current month exited (Ratio)", query: "enrolment_exit_ratio" },
        overage_not_exited: { icon: "hourglass", tone: "rose", title: "No. of children completed 36 months but not exited", query: "overage_not_exited" },

        att_avg_below_50: { icon: "gaugeLow", tone: "amber", title: "No. of Creches with Average Attendance Below 50%", query: "att_avg_below_50" },
        att_daily_below_10: { icon: "barsDown", tone: "amber", title: "No. of Creches with Daily Average Attendance Below 10", query: "att_daily_below_10" },
        att_children_zero: { icon: "personX", tone: "rose", title: "No. of Enrolled Children with 0% Attendance", query: "att_children_zero" },
        att_children_below_50: { icon: "personPercent", tone: "rose", title: "No. of Enrolled Children with Below 50% Attendance", query: "att_children_below_50" },
        att_closed_over_7: { icon: "lock", tone: "violet", title: "No. of Creches Closed for More Than 7 Days – Attendance", query: "att_closed_over_7" },
        att_missed_over_5: { icon: "calendarClock", tone: "amber", title: "No. of Creches That Have Not Submitted Attendance for More Than 5 Days – Attendance", query: "att_missed_over_5" },
        att_missed_all: { icon: "calendarX", tone: "rose", title: "No. of Creches That Have Not Submitted Attendance for All Days", query: "att_missed_all" },

        // ---- Malnutrition Prevalence ----
        mp_measure_below_100: { icon: "rulerPercent", tone: "amber", title: "No of Creches with less than 100% measurement", query: "mp_measure_below_100" },
        mp_not_submitted: { icon: "clipboardX", tone: "rose", title: "No. of creches not submitted anthro", query: "mp_not_submitted" },
        mp_wrong_equipment: { icon: "rulerAlert", tone: "rose", title: "No of Creches where wrong Measurement Equipment Used", query: "mp_wrong_equipment" },
        mp_implausible: { icon: "dataAlert", tone: "violet", title: "No. of children with implausible measurements (both height and weight)", query: "mp_implausible" },
        mp_snc: { icon: "personAlert", tone: "rose", title: "No. of SNC Children", query: "mp_snc" },
        mp_sam: { icon: "pulse", tone: "rose", title: "No. of SAM children", query: "mp_sam" },
        mp_suw: { icon: "weightAlert", tone: "amber", title: "No. of SUW children", query: "mp_suw" },
        mp_gf2: { icon: "trendDown", tone: "amber", title: "No. of GF2 children", query: "mp_gf2" },
        mp_zigzag: { icon: "zigzag", tone: "violet", title: "No. of Zig Zag children", query: "mp_zigzag" },
        mp_to_refer: { icon: "clipboardArrow", tone: "blue", title: "No. of children to be referred (GF2, Zig Zag, SAM, SUW, Illness)", query: "mp_to_refer" },

        // ---- Malnutrition Management ----
        mm_to_refer: { icon: "personAlert", tone: "amber", title: "No. of children to be referred (GF2, Zig-Zag, SAM, SUW and Illness)", query: "mm_to_refer" },
        mm_referred: { icon: "clipboardArrow", tone: "blue", title: "No. of children actually referred", query: "mm_referred" },
        mm_nrc_admitted: { icon: "bed", tone: "teal", title: "No. of children admitted to NRC", query: "mm_nrc_admitted" },
        mm_uw_worse: { icon: "weightDown", tone: "rose", title: "No. of children who moved from Normal to Moderate or Severe Underweight (quarterly)", query: "mm_uw_worse" },
        mm_wasting_worse: { icon: "rulerDown", tone: "rose", title: "No. of children who moved from Normal to Moderate or Severe Wasting (quarterly)", query: "mm_wasting_worse" },
        mm_uw_better: { icon: "weightUp", tone: "green", title: "No. of children who moved from Severe to Normal or Moderate Underweight (quarterly)", query: "mm_uw_better" },
        mm_wasting_better: { icon: "rulerUp", tone: "green", title: "No. of children who moved from Severe to Normal or Moderate Wasting (quarterly)", query: "mm_wasting_better" },
        mm_gf1_to_gf2: { icon: "trendDown", tone: "amber", title: "No. of children who moved from GF1 to GF2", query: "mm_gf1_to_gf2" },
        mm_gf2_to_gf1: { icon: "trendUp", tone: "green", title: "No. of children who moved from GF2 to GF1", query: "mm_gf2_to_gf1" },
        mm_sam_3m: { icon: "rulerAlert", tone: "rose", title: "No. of children in the SAM category during the last 3 months", query: "mm_sam_3m" },
        mm_suw_3m: { icon: "weightAlert", tone: "violet", title: "No. of children in the SUW category during the last 3 months", query: "mm_suw_3m" },

        // ---- Check-In ----
        ci_sup_lt3: { icon: "pinMinus", tone: "amber", title: "No. of Creches with fewer than 3 supervisor check-ins in a month", query: "ci_sup_lt3" },
        ci_sup_none: { icon: "pinX", tone: "rose", title: "No. of Creches with no supervisor check-ins in a month", query: "ci_sup_none" },
        ci_short_engagement: { icon: "clock", tone: "amber", title: "No. of check-ins with less than 2 hours of engagement by the supervisor", query: "ci_short_engagement" },
        ci_not_opening: { icon: "sunrise", tone: "violet", title: "No. of Creches where check-in was not performed during opening hours (for the month)", query: "ci_not_opening" },
        ci_not_closing: { icon: "sunset", tone: "violet", title: "No. of Creches where check-in was not performed during closing hours (for the month)", query: "ci_not_closing" },
        ci_cc_low: { icon: "group", tone: "blue", title: "No. of Cluster Coordinators with fewer than 40 check-ins", query: "ci_cc_low" },
        ci_tc_low: { icon: "cap", tone: "teal", title: "No. of Training Coordinators with fewer than 20 check-ins", query: "ci_tc_low" },
        ci_mis_low: { icon: "monitor", tone: "violet", title: "No. of MIS Coordinators with fewer than 20 check-ins", query: "ci_mis_low" },
        ci_sc_low: { icon: "shield", tone: "green", title: "No. of Safety Coordinators with fewer than 20 check-ins", query: "ci_sc_low" },
        ci_lc_low: { icon: "truck", tone: "amber", title: "No. of Logistics Coordinators with fewer than 20 check-ins", query: "ci_lc_low" },

        // ---- Safety ----
        // `age` cards carry an age filter (1-6 months, more than 6 months) in the card itself; the text is its tooltip.
        sf_not_audited: { icon: "shieldX", tone: "amber", title: "No. of Creches That Have Not Completed Safety Audits", query: "sf_not_audited" },
        sf_identified: { icon: "shieldAlert", tone: "rose", title: "No. of Creches with Safety Issues Identified", query: "sf_identified", age: "Show creches whose latest audit with issues was held this long ago" },
        sf_unresolved: { icon: "shieldClock", tone: "rose", title: "No. of Creches with Unresolved Safety Issues", query: "sf_unresolved", age: "Show creches whose issues have been unresolved for this long" },
        sf_infra: { icon: "houseAlert", tone: "violet", title: "No. of Creches with Infrastructural and Environmental Safety Issues", query: "sf_infra" },
        sf_physical: { icon: "fence", tone: "blue", title: "No. of Creches with Physical Safety and Security Issues", query: "sf_physical" },
        sf_fire: { icon: "flame", tone: "rose", title: "No. of Creches with Fire Safety Issues", query: "sf_fire" },
        sf_electrical: { icon: "bolt", tone: "amber", title: "No. of Creches with Electrical Safety Issues", query: "sf_electrical" },
        sf_food: { icon: "utensils", tone: "teal", title: "No. of Creches with Food Safety Issues", query: "sf_food" },
        sf_other: { icon: "firstAid", tone: "violet", title: "No. of Creches with Other Safety Issues", query: "sf_other" },

        // ---- Logistics ----
        lg_lpg_not_updated: { icon: "cylinderX", tone: "amber", title: "No. of Creches with LPG Status Not Updated", query: "lg_lpg_not_updated" },
        lg_fire_not_updated: { icon: "extinguisher", tone: "amber", title: "No. of Creches with Fire Extinguisher Status Not Updated", query: "lg_fire_not_updated" },
        lg_alt_fuel: { icon: "swap", tone: "violet", title: "No. of Creches Operating Using Alternative Fuel Sources", query: "lg_alt_fuel" },
        lg_lpg_one_month: { icon: "cylinderLow", tone: "rose", title: "No. of Creches with LPG Remaining for One Month", query: "lg_lpg_one_month" },
        lg_fire_expired: { icon: "calendarX", tone: "rose", title: "No. of Creches with Expired Fire Extinguishers", query: "lg_fire_expired" },
        lg_fire_refill_pending: { icon: "refill", tone: "amber", title: "No. of Creches Where Fire Extinguishers Have Been Awaiting Refilling for More Than One Month", query: "lg_fire_refill_pending" },
        lg_stock_not_updated: { icon: "box", tone: "blue", title: "No. of Creches Where Monthly Stock Details Have Not Been Updated", query: "lg_stock_not_updated" },
        lg_cashbook_not_updated: { icon: "wallet", tone: "teal", title: "No. of Creches Where the Weekly Cashbook Has Not Been Updated", query: "lg_cashbook_not_updated" },
        lg_zero_balance: { icon: "rupee", tone: "rose", title: "No. of Creches Operating with Zero or Negative Balance", query: "lg_zero_balance" },

        // ---- Community Engagement ----
        ce_gram_sabha_not_submitted: { icon: "clipboardX", tone: "amber", title: "No. of Creches Not Submitted Community/Gram Sabha Resolutions", query: "ce_gram_sabha_not_submitted" },
        ce_cmc_not_done: { icon: "calendarX", tone: "rose", title: "No. of Creches Where CMC Meeting Not Done for the Month", query: "ce_cmc_not_done" }
    };

    // The titles read better without the leading "No. of" / "No of" ("Operational creches", "SNC Children" ...).
    Object.values(CARDS).forEach(card => {
        card.title = card.title.replace(/^No\.? of\s+/i, '').replace(/^./, first => first.toUpperCase());
    });

    // Ages offered by the cards that have `age: true` (value sent as `age`; the server groups issues in 30-day months).
    const AGE_OPTIONS = [
        { value: "", label: "All ages" },
        { value: "1", label: "1 month" },
        { value: "2", label: "2 months" },
        { value: "3", label: "3 months" },
        { value: "4", label: "4 months" },
        { value: "5", label: "5 months" },
        { value: "6", label: "6 months" },
        { value: "7", label: "More than 6 months" }
    ];

    // A section with `hidden: true` is not shown and its APIs are not called. Remove the flag to show it again.
    const ALL_SECTIONS = [
        {
            key: "overview",
            title: "Overview",
            cards: ["op_creches", "op_partners", "op_blocks", "op_districts", "profile_not_submitted"]
        },
        {
            key: "enrolment",
            title: "Enrollment",
            cards: [
                "hh_not_done", "no_exit_anthro", "no_welcome_anthro", "wrong_equipment",
                "low_enrolment", "eligible", "enrolled", "enrolled_month",
                "exited_month", "enrolment_exit_ratio", "overage_not_exited"
            ]
        },
        {
            key: "attendance",
            title: "Attendance",
            cards: ["att_avg_below_50", "att_daily_below_10", "att_children_zero", "att_children_below_50", "att_closed_over_7", "att_missed_over_5", "att_missed_all"]
        },
        {
            key: "prevalence",
            title: "Malnutrition Prevalence",
            cards: [
                "mp_measure_below_100", "mp_not_submitted", "mp_wrong_equipment", "mp_implausible",
                "mp_snc", "mp_sam", "mp_suw", "mp_gf2", "mp_zigzag"
            ]
        },
        {
            key: "malnutrition",
            title: "Malnutrition Management",
            // hidden: true,
            cards: [
                "mm_to_refer",
                "mm_uw_worse", "mm_wasting_worse", "mm_uw_better", "mm_wasting_better",
                "mm_gf1_to_gf2", "mm_gf2_to_gf1", "mm_sam_3m", "mm_suw_3m"
            ]
        },
        {
            key: "checkin",
            title: "Check-In Indicators",
            cards: [
                "ci_sup_lt3", "ci_sup_none", "ci_short_engagement", "ci_not_opening", "ci_not_closing",
                "ci_cc_low", "ci_tc_low", "ci_mis_low", "ci_sc_low"
            ]
        },
        {
            key: "safety",
            title: "Safety",
            cards: [
                "sf_not_audited", "sf_identified", "sf_unresolved",
                "sf_infra", "sf_physical", "sf_fire", "sf_electrical", "sf_food", "sf_other"
            ]
        },
        {
            key: "logistics",
            title: "Logistics",
            cards: [
                "lg_lpg_not_updated", "lg_fire_not_updated", "lg_alt_fuel", "lg_lpg_one_month",
                "lg_fire_expired", "lg_fire_refill_pending",
                "lg_stock_not_updated", "lg_cashbook_not_updated", "lg_zero_balance"
            ]
        },
        {
            key: "community",
            title: "Community Engagement",
            cards: ["ce_gram_sabha_not_submitted", "ce_cmc_not_done"]
        }
    ];
    const SECTIONS = ALL_SECTIONS.filter(s => !s.hidden);

    // Cards of the Malnutrition Prevalence, Malnutrition Management and Check-In sections that are counted together in one request (group -> cards).
    const CARD_GROUPS = {
        mp_creche: ["mp_measure_below_100", "mp_not_submitted"],
        mp_flags: ["mp_snc", "mp_sam", "mp_suw", "mp_gf2", "mp_zigzag", "mp_implausible"],
        mm_referral: ["mm_to_refer"],
        mm_quarter: ["mm_uw_worse", "mm_wasting_worse", "mm_uw_better", "mm_wasting_better"],
        mm_gf: ["mm_gf1_to_gf2", "mm_gf2_to_gf1"],
        mm_last3: ["mm_sam_3m", "mm_suw_3m"],
        ci_creche: ["ci_sup_lt3", "ci_sup_none", "ci_not_opening", "ci_not_closing"],
        ci_cadre: ["ci_cc_low", "ci_tc_low", "ci_mis_low", "ci_sc_low"],
        sf_month: ["sf_not_audited", "sf_infra", "sf_physical", "sf_fire", "sf_electrical", "sf_food", "sf_other"],
        lg_fuel: ["lg_lpg_not_updated", "lg_fire_not_updated", "lg_alt_fuel", "lg_lpg_one_month", "lg_fire_expired", "lg_fire_refill_pending"]
    };

    // Each API returns { <Section>: [{ id, title, value, extra }] }.
    const SECTION_APIS = [
        { section: "overview", fn: "review_card.review_section_overview", cards: SECTIONS[0].cards },
        { section: "enrolment", fn: "review_card.review_section_enrolment_counts", cards: ["eligible", "enrolled", "enrolled_month", "exited_month", "overage_not_exited"], derived: true },
        // The slowest checks go first so they start earliest. These two cards share one query.
        { section: "attendance", fn: "review_card.review_attendance_creche_cards", cards: ["att_avg_below_50", "att_daily_below_10"] },
        // One request per data-quality card, so each shows as soon as its own query returns.
        ...["hh_not_done", "no_exit_anthro", "no_welcome_anthro", "wrong_equipment", "low_enrolment"].map(card => (
            { section: "enrolment", fn: "review_card.review_card_count", params: { card }, cards: [card] }
        )),
        ...["att_children_zero", "att_children_below_50", "att_closed_over_7", "att_missed_over_5", "att_missed_all"].map(card => (
            { section: "attendance", fn: "review_card.review_card_count", params: { card }, cards: [card] }
        )),
        // Cards that read the same data share one request; the engagement card has its own.
        ...Object.entries(CARD_GROUPS).map(([group, cards]) => (
            { section: ALL_SECTIONS.find(s => s.cards.includes(cards[0])).key, fn: "review_card.review_card_group", params: { group }, cards }
        )),
        { section: "prevalence", fn: "review_card.review_card_count", params: { card: "mp_wrong_equipment" }, cards: ["mp_wrong_equipment"] },
        { section: "checkin", fn: "review_card.review_card_count", params: { card: "ci_short_engagement" }, cards: ["ci_short_engagement"] },
        // The two Safety age cards send the age chosen in the card (see ageParam); the cashbook has its own query.
        ...["sf_identified", "sf_unresolved"].map(card => (
            { section: "safety", fn: "review_card.review_card_count", params: () => ({ card, ...ageParam(card) }), cards: [card] }
        )),
        ...["lg_stock_not_updated", "lg_cashbook_not_updated", "lg_zero_balance"].map(card => (
            { section: "logistics", fn: "review_card.review_card_count", params: { card }, cards: [card] }
        )),
        ...["ce_gram_sabha_not_submitted", "ce_cmc_not_done"].map(card => (
            { section: "community", fn: "review_card.review_card_count", params: { card }, cards: [card] }
        ))
    ].filter(api => SECTIONS.some(s => s.key === api.section));

    // Bands for the "Current Eligible to Current Enrolled %" card. The range is
    // still to be decided, so nothing is shown until entries are added here, e.g.
    //   { min: 0,  max: 50,       label: "Low",  color: "#d64550" },
    //   { min: 50, max: 75,       label: "Fair", color: "#d9822b" },
    //   { min: 75, max: Infinity, label: "Good", color: "#2f9e6b" }
    // A value falls in a band when min <= value < max.
    const ELIGIBLE_ENROLLED_RANGES = [];

    // ------------------------------------------------------------------
    // Page markup
    // ------------------------------------------------------------------
    const toneCss = Object.entries(TONES).map(([name, tn]) =>
        `.rv-card.rv-tone-${name} { --rv-accent: ${tn.accent}; --rv-light: ${tn.light}; --rv-soft: ${tn.soft}; --rv-edge: ${tn.edge}; }`
    ).join("\n");

    if (!document.getElementById("rv-styles")) {
        const style = document.createElement("style");
        style.id = "rv-styles";
        style.textContent = `
        ${toneCss}

        @keyframes rv-spin { to { transform: rotate(360deg); } }
        @keyframes rv-fade-up {
            from { opacity: 0; transform: translateY(14px) scale(0.98); }
            to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes rv-pop {
            0%   { transform: scale(0.85); opacity: 0; }
            100% { transform: scale(1); opacity: 1; }
        }
        @keyframes rv-modal-in {
            from { opacity: 0; transform: translateY(-22px) scale(0.97); }
            to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes rv-backdrop-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes rv-shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
        @keyframes rv-float { 0%, 100% { translate: 0 0; } 50% { translate: 0 -4px; } }
        /* ---- page chrome ---- */
        /* ---- filter bar: one card, a caption above every filter, filters slide in and out ---- */
        /* The bar's look (background, border, shadow) is drawn by .rv-bar-chrome behind the filters, so that it can
           grow and shrink on its own while the filters, which are laid out once, only fade and slide. */
        #page-review-card .page-form {
            --rv-ease-out: cubic-bezier(.22, 1, .36, 1);      /* quick start, long soft landing */
            /* A grid, not a wrapping flexbox: every filter is in a column of the same width, whichever row it is in.
               --rv-filter-min is the narrowest a filter gets; the columns share the rest of the bar equally. */
            --rv-filter-min: 180px;
            position: relative; box-sizing: border-box; display: grid !important; grid-template-columns: repeat(auto-fill, minmax(var(--rv-filter-min), 1fr));
            align-items: end; align-content: start; gap: 10px 12px;
            margin: 0 0 14px !important; padding: 10px 16px 14px !important; border: 0 !important; background: none !important;
            animation: rv-fade-up 0.6s var(--rv-ease-out) backwards;
        }
        #page-review-card .page-form .rv-bar-chrome {
            position: absolute; top: 0; left: 0; right: 0; bottom: 0; pointer-events: none;
            background: linear-gradient(180deg, #ffffff 0%, #f7f9fd 100%);
            border: 1px solid #e3e8f0; border-radius: 14px;
            box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04), 0 12px 26px -20px rgba(15, 23, 42, 0.28);
        }
        #page-review-card .page-form .frappe-control {
            --rv-cap: 17px;     /* height of the caption above the input */
            --rv-input: 36px;   /* height of the input */
            position: relative; width: auto !important; min-width: 0 !important; max-width: none !important;
            margin: 0 !important; padding: 0 !important;
        }
        #page-review-card .page-form .frappe-control .form-group { margin: 0 !important; }
        /* the caption sits in the top padding of the filter it names */
        #page-review-card .page-form .frappe-control[data-rv-label] { padding-top: var(--rv-cap) !important; }
        /* Frappe puts the dropdown arrow (select) and the open-link button (link) a few px from the top of the
           filter, which is now the caption; centre them on the input instead. */
        #page-review-card .page-form .frappe-control .select-icon,
        #page-review-card .page-form .frappe-control .link-btn {
            top: calc(var(--rv-cap) + var(--rv-input) / 2) !important; bottom: auto !important; transform: translateY(-50%);
        }
        #page-review-card .page-form .frappe-control .select-icon { display: flex; align-items: center; line-height: 1; }
        /* The text Frappe shows in an empty dropdown has the same top: 3px, so it lands on the caption (and repeats it). */
        #page-review-card .page-form .frappe-control .placeholder {
            top: calc(var(--rv-cap) + var(--rv-input) / 2) !important; left: 12px; transform: translateY(-50%);
            max-width: calc(100% - 44px); padding: 0 !important; font-size: 0.86rem; line-height: 1; color: #9aa6ba;
        }
        #page-review-card .page-form .frappe-control[data-rv-label]::before {
            content: attr(data-rv-label); position: absolute; top: 0; left: 3px; max-width: calc(100% - 6px);
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap; pointer-events: none;
            font-size: 0.66rem; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: #7a879c;
            transition: color 0.3s ease;
        }
        #page-review-card .page-form .frappe-control[data-rv-label]:focus-within::before { color: ${BRAND}; }
        #page-review-card .page-form .form-control {
            height: var(--rv-input); padding-left: 12px; border-radius: 10px; border: 1px solid #d3dcec; background-color: #ffffff;
            color: #1f2937; font-size: 0.86rem; box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
            transition: border-color 0.3s ease, box-shadow 0.3s ease, background-color 0.3s ease;
        }
        #page-review-card .page-form .form-control:hover { border-color: #a9bbd8; }
        #page-review-card .page-form .form-control:focus { border-color: ${BRAND}; box-shadow: 0 0 0 3px rgba(89, 121, 170, 0.18); background-color: #ffffff; }
        #page-review-card .page-form .form-control::placeholder { color: #9aa6ba; }
        #page-review-card .page-body { margin-top: 6px !important; }
        #page-review-card > div.page-head.flex {
            padding-top: 0 !important; padding-bottom: 0 !important; margin-bottom: 0 !important;
            min-height: unset !important; height: auto !important; border-bottom: none !important; line-height: 1 !important;
        }
        #page-review-card > div.page-head.flex .page-head-content { padding-top: 4px !important; padding-bottom: 4px !important; min-height: unset !important; align-items: center !important; }
        #page-review-card > div.page-head.flex .title-area,
        #page-review-card > div.page-head.flex .page-title { padding: 0 !important; margin: 0 !important; line-height: 1.2 !important; }
        #page-review-card > div.page-head.flex h1.title-text { font-size: 1.1rem !important; line-height: 1.2 !important; margin: 0 !important; }

        /* Search / Reset / Download / Logic in the page header */
        .rv-search-btn, .rv-reset-btn, .rv-download-dropdown > button, .rv-logic-btn {
            transition: transform 0.3s cubic-bezier(.22, 1, .36, 1), box-shadow 0.3s ease, filter 0.3s ease, background-color 0.3s ease !important;
        }
        .rv-search-btn:hover, .rv-download-dropdown > button:hover, .rv-logic-btn:hover {
            transform: translateY(-1px); filter: brightness(1.07); box-shadow: 0 8px 16px -10px rgba(89, 121, 170, 0.95);
        }
        .rv-reset-btn:hover { transform: translateY(-1px); background-color: #eef1f6 !important; box-shadow: 0 6px 14px -10px rgba(15, 23, 42, 0.5); }
        .rv-search-btn:active, .rv-reset-btn:active, .rv-download-dropdown > button:active, .rv-logic-btn:active { transform: translateY(0) scale(0.98); transition-duration: 0.1s !important; }

        /* ---- layout ---- */
        /* The desk background below the content is grey; this page is white edge to edge. */
        body.rv-page-active, body.rv-page-active #body, body.rv-page-active .main-section { background-color: #ffffff !important; }
        /* white edge to edge, with a very faint tint in two corners so the page does not look flat */
        #page-review-card {
            background: radial-gradient(1100px 340px at 88% -60px, rgba(89, 121, 170, 0.07), transparent 70%),
                        radial-gradient(800px 300px at -5% 14%, rgba(18, 160, 140, 0.04), transparent 70%), #ffffff;
        }
        .rv-root { font-family: inherit; color: #1f2937; padding-bottom: 32px; -webkit-font-smoothing: antialiased; }
        /* ---- section tabs: one section shown at a time ---- */
        .rv-tabs {
            position: relative; display: flex; gap: 4px; margin-top: 4px; border-bottom: 1px solid #e3e8f0;
            overflow-x: auto; scrollbar-width: none;
        }
        .rv-tabs::-webkit-scrollbar { display: none; }
        .rv-tab {
            appearance: none; background: none; border: none; border-bottom: 3px solid transparent; margin-bottom: -1px;
            padding: 10px 16px; display: inline-flex; align-items: center; gap: 8px; white-space: nowrap; cursor: pointer;
            font-size: 0.95rem; font-weight: 600; color: #6b7280; border-radius: 6px 6px 0 0;
            transition: color 0.2s ease, border-color 0.2s ease, background 0.2s ease;
        }
        .rv-tab:hover { color: #1f2a44; background: #f5f7fb; }
        .rv-tab.rv-active { color: ${BRAND}; border-bottom-color: ${BRAND}; }
        /* the line under the active tab slides from one tab to the next (placed by moveTabIndicator) */
        .rv-tabs.rv-has-indicator .rv-tab.rv-active { border-bottom-color: transparent; }
        .rv-tab-indicator {
            position: absolute; left: 0; bottom: 0; height: 3px; width: var(--rv-tw, 0px); border-radius: 3px 3px 0 0; pointer-events: none;
            background: linear-gradient(90deg, ${BRAND}, #86a1cd); box-shadow: 0 -3px 12px rgba(89, 121, 170, 0.35);
            transform: translateX(var(--rv-tx, 0px));
            transition: transform 0.5s cubic-bezier(.22, 1, .36, 1), width 0.5s cubic-bezier(.22, 1, .36, 1);
        }
        .rv-tab:focus-visible { outline: 2px solid ${BRAND}; outline-offset: -2px; }
        .rv-tab-count {
            min-width: 22px; padding: 1px 8px; border-radius: 999px; font-size: 0.72rem; font-weight: 700; text-align: center;
            color: #5b6b85; background: #eef2f9; border: 1px solid #d6e0f0; transition: background 0.2s ease, color 0.2s ease;
        }
        .rv-tab.rv-active .rv-tab-count { color: #ffffff; background: ${BRAND}; border-color: ${BRAND}; }
        .rv-section { display: none; margin-top: 18px; }
        .rv-section.rv-active { display: block; }

        /* Columns follow the width of the cards area, so every card has the same
           size in all sections; a short last row starts at the left. */
        .rv-cards-area { container-type: inline-size; }
        .rv-grid { --rv-cols: 1; display: flex; flex-wrap: wrap; justify-content: flex-start; gap: 20px; }
        .rv-grid .rv-card { flex: 0 0 calc((100% - (var(--rv-cols) - 1) * 20px) / var(--rv-cols)); }
        @container (min-width: 600px)  { .rv-grid { --rv-cols: 2; } }
        @container (min-width: 900px)  { .rv-grid { --rv-cols: 3; } }
        @container (min-width: 1180px) { .rv-grid { --rv-cols: 4; } }
        @media (max-width: 600px) {
            .rv-tab { flex: 1 1 0; justify-content: center; padding: 10px 8px; font-size: 0.9rem; }
            .rv-illus { transform: scale(0.85); transform-origin: bottom right; }
            #page-review-card .page-form { padding: 10px 12px 12px !important; }
            #page-review-card .page-form { grid-template-columns: repeat(2, minmax(0, 1fr)); }
            .rv-search-btn, .rv-reset-btn, .rv-download-dropdown, .rv-logic-btn { display: none !important; }
            #rv-mobile-kebab { display: inline-block !important; }
        }

        /* ---- card ---- */
        .rv-card {
            --rv-accent: ${BRAND}; --rv-light: #93aad3; --rv-soft: #eef2f9; --rv-edge: #d6e0f0;
            --rv-rx: 0deg; --rv-ry: 0deg; --rv-mx: 50%; --rv-my: 0%; --rv-px: 0px; --rv-py: 0px;
            box-sizing: border-box; position: relative; overflow: hidden; display: flex;
            height: 152px; padding: 14px 18px 12px; border-radius: 20px;
            background: linear-gradient(115deg, #ffffff 38%, var(--rv-soft) 140%);
            border: 1.5px solid var(--rv-edge);
            box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05), 0 6px 12px -6px rgba(15, 23, 42, 0.08), 0 14px 26px -16px rgba(15, 23, 42, 0.22),
                        inset 0 1px 0 rgba(255, 255, 255, 0.9);
            transform: perspective(900px) translateY(0) rotateX(0deg) rotateY(0deg);
            transition: transform 0.25s cubic-bezier(.2,.7,.2,1), box-shadow 0.25s ease, border-color 0.25s ease;
            animation: rv-fade-up 0.55s cubic-bezier(.2,.7,.2,1) backwards;
            animation-delay: calc(var(--rv-i, 0) * 45ms);
            will-change: transform;
        }
        .rv-card::after {
            content: ""; position: absolute; inset: 0; z-index: 0; pointer-events: none; opacity: 0; transition: opacity 0.25s ease;
            background: radial-gradient(260px circle at var(--rv-mx) var(--rv-my), rgba(255, 255, 255, 0.7), transparent 60%);
        }
        .rv-card:hover {
            transform: perspective(900px) translateY(-6px) rotateX(var(--rv-rx)) rotateY(var(--rv-ry));
            box-shadow: 0 2px 3px rgba(15, 23, 42, 0.05), 0 22px 36px -16px rgba(15, 23, 42, 0.3), 0 0 0 1px var(--rv-accent),
                        inset 0 1px 0 rgba(255, 255, 255, 0.9);
            box-shadow: 0 2px 3px rgba(15, 23, 42, 0.05), 0 22px 36px -16px rgba(15, 23, 42, 0.3), 0 0 0 1px var(--rv-accent),
                        0 28px 46px -24px color-mix(in srgb, var(--rv-accent) 60%, transparent), inset 0 1px 0 rgba(255, 255, 255, 0.9);
            border-color: var(--rv-accent);
        }
        /* a short accent edge at the top of the card that grows on hover */
        .rv-card::before {
            content: ""; position: absolute; left: 18px; top: 0; z-index: 1; width: 34px; height: 4px; border-radius: 0 0 6px 6px; pointer-events: none;
            background: linear-gradient(90deg, var(--rv-accent), var(--rv-light)); transition: width 0.45s cubic-bezier(.22, 1, .36, 1);
        }
        .rv-card:hover::before { width: 64px; }
        .rv-card:hover::after { opacity: 1; }
        .rv-card.rv-clickable { cursor: pointer; }
        .rv-card.rv-clickable:focus-visible { outline: 3px solid var(--rv-accent); outline-offset: 2px; }
        .rv-card.rv-clickable:active { transform: perspective(900px) translateY(-2px) scale(0.99); }

        .rv-card-body { position: relative; z-index: 1; flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; }
        .rv-card-title { font-size: 0.9rem; font-weight: 700; line-height: 1.25; color: #111827; }
        .rv-card-row { margin-top: 4px; max-width: 64%; display: flex; align-items: center; flex-wrap: wrap; gap: 0 8px; }
        .rv-card-value {
            min-height: 34px; display: flex; align-items: center; flex-wrap: wrap; gap: 8px;
            font-size: 1.65rem; font-weight: 800; line-height: 1.1; letter-spacing: -0.02em; color: #111827; font-variant-numeric: tabular-nums;
        }
        .rv-card-value .rv-value-text { animation: rv-pop 0.35s cubic-bezier(.2,.7,.2,1) backwards; }
        .rv-card-value.rv-value-error .rv-value-text { color: #9ca3af; }
        .rv-card-extra { font-size: 0.72rem; font-weight: 400; color: #6b7280; }
        .rv-badge {
            font-size: 0.7rem; font-weight: 700; letter-spacing: 0.03em; text-transform: uppercase; padding: 2px 8px; border-radius: 999px;
            color: #ffffff; background: var(--rv-badge, #6b7280); animation: rv-pop 0.35s cubic-bezier(.2,.7,.2,1) backwards;
        }

        /* age filter inside a card (Safety): a pill-shaped select next to the value */
        .rv-card-row.rv-has-age { max-width: 100%; }
        .rv-age-select, .rv-age-static {
            box-sizing: border-box; height: 26px; max-width: 100%; border-radius: 999px; border: 1px solid var(--rv-edge);
            background-color: #ffffff; color: var(--rv-accent); font-size: 0.72rem; font-weight: 600; line-height: 24px;
            box-shadow: 0 2px 8px -2px rgba(15, 23, 42, 0.12);
        }
        .rv-age-select {
            appearance: none; -webkit-appearance: none; padding: 0 26px 0 11px; cursor: pointer; font-family: inherit;
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
            background-repeat: no-repeat; background-position: right 9px center; background-size: 10px;
            transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }
        .rv-age-select:hover { border-color: var(--rv-accent); }
        .rv-age-select:focus-visible { outline: 2px solid var(--rv-accent); outline-offset: 2px; }
        .rv-age-static { display: inline-block; padding: 0 11px; white-space: nowrap; }

        .rv-cta {
            margin-top: auto; padding: 4px 11px; display: inline-flex; align-items: center; gap: 5px;
            font-size: 0.75rem; font-weight: 600; color: var(--rv-accent); background: #ffffff; border-radius: 9px;
            border: 1px solid rgba(15, 23, 42, 0.06); box-shadow: 0 2px 8px -2px rgba(15, 23, 42, 0.12);
            transition: background 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease; visibility: hidden;
        }
        .rv-cta::after { content: "\u203A"; font-size: 1.15em; line-height: 1; transition: transform 0.2s ease; }
        .rv-card[data-cta] .rv-cta { visibility: visible; }
        .rv-cta.rv-cta-off { color: #9ca3af; box-shadow: none; background: rgba(255, 255, 255, 0.6); }
        .rv-cta.rv-cta-off::after { content: none; }
        .rv-card.rv-clickable:hover .rv-cta { background: var(--rv-soft); box-shadow: 0 6px 14px -6px var(--rv-accent); transform: translateY(-1px); }
        .rv-card.rv-clickable:hover .rv-cta::after { transform: translateX(3px); }
        .rv-card-row + .rv-cta { margin-top: 6px; }

        /* illustration: glossy tile + soft blob, bottom-right */
        .rv-illus {
            position: absolute; right: 6px; bottom: 4px; width: 90px; height: 90px; z-index: 1; pointer-events: none;
            animation: rv-float 5.5s ease-in-out infinite; animation-delay: calc(var(--rv-i, 0) * -0.7s);
        }
        .rv-illus-blob {
            position: absolute; right: -10px; bottom: -10px; width: 80px; height: 80px; border-radius: 50%; opacity: 0.2;
            background: radial-gradient(circle at 35% 35%, var(--rv-light), var(--rv-accent));
            translate: calc(var(--rv-px) * -0.5) calc(var(--rv-py) * -0.5); transition: translate 0.45s ease-out;
        }
        .rv-illus-ring {
            position: absolute; left: 4px; top: 6px; width: 12px; height: 12px; border-radius: 50%;
            border: 2px solid var(--rv-light); opacity: 0.55; transition: transform 0.35s ease, translate 0.45s ease-out;
            translate: calc(var(--rv-px) * -1.2) calc(var(--rv-py) * -1.2);
        }
        .rv-illus-dot {
            position: absolute; right: 5px; top: 14px; width: 7px; height: 7px; border-radius: 50%;
            background: var(--rv-light); opacity: 0.7; transition: transform 0.35s ease, translate 0.45s ease-out;
            translate: calc(var(--rv-px) * -1.2) calc(var(--rv-py) * -1.2);
        }
        .rv-illus-tile {
            position: absolute; right: 15px; bottom: 15px; width: 50px; height: 50px; border-radius: 16px;
            display: flex; align-items: center; justify-content: center;
            background: linear-gradient(145deg, var(--rv-light), var(--rv-accent));
            box-shadow: 0 18px 24px -12px var(--rv-accent), inset 0 2px 0 rgba(255, 255, 255, 0.5), inset 0 -6px 10px rgba(0, 0, 0, 0.08);
            transform: rotate(-8deg); transition: transform 0.35s cubic-bezier(.2,.7,.2,1), translate 0.3s ease-out;
            translate: var(--rv-px) var(--rv-py);
        }
        .rv-illus-tile svg { width: 25px; height: 25px; fill: none; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
        .rv-card:hover .rv-illus-tile { transform: rotate(-2deg) translateY(-6px) scale(1.07); }
        .rv-card:hover .rv-illus-ring { transform: translate(-3px, -3px) scale(1.15); }
        .rv-card:hover .rv-illus-dot { transform: translate(3px, -4px) scale(1.2); }

        .rv-mini-loader {
            width: 24px; height: 24px; border: 3px solid rgba(15, 23, 42, 0.08); border-top-color: var(--rv-accent);
            border-radius: 50%; animation: rv-spin 0.9s linear infinite;
        }
        /* while a number loads: a shimmering placeholder instead of a spinner */
        .rv-card-value .rv-mini-loader {
            width: 76px; height: 28px; border: 0; border-radius: 9px; animation: rv-shimmer 1.4s linear infinite;
            background: linear-gradient(100deg, rgba(15, 23, 42, 0.06) 30%, rgba(15, 23, 42, 0.13) 50%, rgba(15, 23, 42, 0.06) 70%) 0 0 / 200% 100%;
        }
        .rv-card-overlay {
            position: absolute; inset: 0; display: none; align-items: center; justify-content: center; z-index: 3;
            background: rgba(255, 255, 255, 0.72); opacity: 0; transition: opacity 0.25s ease; backdrop-filter: blur(1px);
        }
        .rv-card.rv-busy .rv-card-overlay { display: flex; opacity: 1; }
        .rv-card.rv-busy { pointer-events: none; }

        @media (prefers-reduced-motion: reduce) {
            .rv-card, .rv-card-value .rv-value-text, .rv-badge { animation: none !important; }
            .rv-tab, .rv-card, .rv-cta, .rv-illus-tile, .rv-illus-ring, .rv-illus-dot { transition: none !important; }
            #page-review-card .page-form { animation: none !important; }
            #page-review-card .page-form .frappe-control, #page-review-card .page-form .form-control,
            .rv-search-btn, .rv-reset-btn, .rv-download-dropdown > button, .rv-logic-btn { transition: none !important; }
            .rv-card:hover { transform: none; }
            .rv-illus, .rv-card-value .rv-mini-loader, #rvDataModal, #rvDataModal .rv-modal-content, .rv-modal, .rv-modal-content { animation: none !important; }
            .rv-tab-indicator, .rv-card::before, .rv-illus-blob, .rv-illus-tile, .rv-illus-ring, .rv-illus-dot { transition: none !important; }
        }

        /* Off-screen capture for PNG / PDF: no animation, no hover artefacts. */
        .rv-capture .rv-card { animation: none !important; transition: none !important; transform: none !important; opacity: 1 !important; will-change: auto; }
        .rv-capture .rv-card::after, .rv-capture .rv-cta, .rv-capture .rv-card-overlay { display: none !important; }
        .rv-capture .rv-value-text, .rv-capture .rv-badge { animation: none !important; }
        /* html2canvas draws inset shadows on a rotated rounded box as a checkerboard, so export a flat tile. */
        .rv-capture .rv-illus-tile { box-shadow: none !important; transform: none !important; }
        .rv-capture .rv-illus, .rv-capture .rv-illus-tile, .rv-capture .rv-illus-blob, .rv-capture .rv-illus-ring, .rv-capture .rv-illus-dot { animation: none !important; translate: none !important; }

        /* ---- modals ---- */
        body.rv-modal-open { overflow: hidden; }
        .rv-modal {
            display: none; position: fixed; inset: 0; z-index: 9999; overflow: auto;
            background: rgba(15, 23, 42, 0.45); backdrop-filter: blur(6px) saturate(1.1); animation: rv-backdrop-in 0.3s ease;
        }
        .rv-modal-content {
            position: relative; background: #fff; margin: 4% auto; padding: 22px; border-radius: 18px; width: 92%; max-width: 95vw;
            max-height: 92vh; display: flex; flex-direction: column;
            box-shadow: 0 2px 4px rgba(15, 23, 42, 0.06), 0 28px 64px -14px rgba(15, 23, 42, 0.38), inset 0 1px 0 rgba(255, 255, 255, 0.9);
            animation: rv-modal-in 0.45s cubic-bezier(.22, 1, .36, 1);
        }
        .rv-modal-head { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 12px; }
        .rv-modal-head h2 { flex: 1 1 240px; margin: 0; font-size: 1.35rem; font-weight: 700; letter-spacing: -0.01em; color: #1f2a44; }
        .rv-modal-count { font-size: 0.78rem; font-weight: 600; color: #5b6b85; padding: 3px 11px; margin-right: 4px; border-radius: 999px; background: #eef2f9; border: 1px solid #d6e0f0; }
        .rv-modal-search { position: relative; flex: 1 1 260px; min-width: 200px; }
        .rv-modal-search input {
            box-sizing: border-box; width: 100%; outline: none; padding: 8px 36px 8px 14px; border: 1px solid #d3dcec; border-radius: 10px; background: #f8fafc;
            transition: border-color 0.25s ease, box-shadow 0.25s ease, background-color 0.25s ease;
        }
        .rv-modal-search input:hover { border-color: #a9bbd8; }
        .rv-modal-search input:focus { border-color: ${BRAND}; background: #ffffff; box-shadow: 0 0 0 3px rgba(89, 121, 170, 0.18); }
        .rv-modal-search span { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); color: #888; pointer-events: none; }
        .rv-btn {
            padding: 8px 16px; background: linear-gradient(180deg, #6486b7, ${BRAND}); color: #fff; border: none; border-radius: 10px; cursor: pointer;
            font-weight: 600; box-shadow: 0 6px 14px -8px rgba(89, 121, 170, 0.9);
            transition: background 0.2s ease, transform 0.2s cubic-bezier(.22, 1, .36, 1), box-shadow 0.25s ease;
        }
        .rv-btn:hover { background: linear-gradient(180deg, #5a7cae, #4b6996); transform: translateY(-1px); box-shadow: 0 10px 18px -10px rgba(89, 121, 170, 1); }
        .rv-btn:active { transform: translateY(0) scale(0.98); }
        .rv-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
        .rv-close-btn {
            width: 36px; height: 36px; padding: 0; background: rgba(0, 0, 0, 0.05); border: none; border-radius: 8px;
            font-size: 24px; color: #333; display: flex; align-items: center; justify-content: center; cursor: pointer;
            transition: background 0.2s, transform 0.2s;
        }
        .rv-close-btn:hover { background: #ffe5e9; transform: rotate(90deg); }
        .rv-close-btn:active { background: rgba(0, 0, 0, 0.15); transform: scale(0.9); }

        /* download scope pop-up */
        #rvScopeModal .rv-modal-content { max-width: 380px; margin: 14vh auto 0; padding: 20px; }
        #rvScopeModal .rv-modal-head { margin-bottom: 4px; flex-wrap: nowrap; }
        #rvScopeModal .rv-modal-head h2 { font-size: 1.15rem; color: ${BRAND}; }
        .rv-scope-hint { margin: 0 0 14px; font-size: 0.82rem; color: #6b7280; }
        .rv-scope-options { display: flex; flex-direction: column; gap: 10px; }
        .rv-scope-option {
            display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 100%; padding: 12px 14px; text-align: left;
            background: #fff; border: 1px solid #d1d5db; border-radius: 10px; cursor: pointer;
            transition: border-color 0.2s ease, background 0.2s ease, transform 0.15s ease;
        }
        .rv-scope-option:hover, .rv-scope-option:focus-visible { border-color: ${BRAND}; background: #f5f7fb; outline: none; transform: translateY(-1px); }
        .rv-scope-option b { font-size: 0.95rem; color: #111827; }
        .rv-scope-option span { font-size: 0.78rem; color: #6b7280; }

        #rvModalTableContainer { max-height: 62vh; overflow: auto; border-radius: 12px; border: 1px solid #e3e8f0; box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04); }
        #rvModalTableContainer table { width: 100%; border-collapse: separate; border-spacing: 0; }
        #rvModalTableContainer thead th {
            position: sticky; top: 0; z-index: 2; background: linear-gradient(180deg, #6486b7, ${BRAND}); color: #fff; white-space: nowrap; text-align: left;
            font-size: 0.82rem; font-weight: 700; letter-spacing: 0.02em; border-bottom: 0; border-right-color: rgba(255, 255, 255, 0.18);
            box-shadow: 0 3px 8px -4px rgba(15, 23, 42, 0.35);
        }
        #rvModalTableContainer th, #rvModalTableContainer td { padding: 11px 14px; border: 0; border-bottom: 1px solid #e8edf5; border-right: 1px solid #eef1f6; white-space: nowrap; }
        #rvModalTableContainer th:last-child, #rvModalTableContainer td:last-child { border-right: 0; }
        /* the Seq. ID column stays in view when a wide table is scrolled sideways */
        #rvModalTableContainer th:first-child, #rvModalTableContainer td:first-child { position: sticky; left: 0; }
        #rvModalTableContainer thead th:first-child { z-index: 3; }
        #rvModalTableContainer tbody td:first-child { z-index: 1; background: #ffffff; box-shadow: 1px 0 0 #e3e8f0; font-weight: 600; color: #5b6b85; }
        #rvModalTableContainer tbody tr.rv-alt td:first-child { background: #f8fafc; }
        #rvModalTableContainer tbody tr:hover td:first-child { background: #eef3fb; box-shadow: inset 3px 0 0 ${BRAND}, 1px 0 0 #e3e8f0; }
        #rvModalTableContainer tbody tr { transition: background-color 0.15s ease; }
        #rvModalTableContainer td { text-align: left; vertical-align: top; }
        /* headings: left-aligned like the values below them; Seq. ID centred like its numbers */
        #rvModalTableContainer thead th.rv-seq { text-align: center; }
        #rvModalTableContainer thead th.rv-sortable { cursor: pointer; user-select: none; }
        #rvModalTableContainer thead th.rv-sortable:hover { background: linear-gradient(180deg, #5b7fb2, #4a6a9b); }
        #rvModalTableContainer thead th.rv-sortable:focus-visible { outline: 2px solid #fff; outline-offset: -3px; }
        .rv-sort-arrow { display: inline-block; min-width: 1em; margin-left: 6px; font-size: 0.7rem; }
        #rvModalTableContainer thead tr.rv-filter-row th {
            background: #eef2f9; padding: 6px 8px; border-bottom: 1px solid #d9e2f0; box-shadow: 0 3px 8px -4px rgba(15, 23, 42, 0.25);
        }
        .rv-col-filter {
            width: 100%; min-width: 84px; height: 28px; padding: 0 8px; border: 1px solid #cdd8ea; border-radius: 6px;
            font-size: 0.78rem; font-weight: 400; color: #1f2937; background: #fff; outline: none;
        }
        .rv-col-filter:focus { border-color: ${BRAND}; box-shadow: 0 0 0 2px rgba(89, 121, 170, 0.18); }
        #rvModalTableContainer td.rv-status { text-align: center; font-weight: 700; letter-spacing: 0.01em; }
        #rvModalTableContainer td.rv-status-normal { background: #d4f4dd; color: #14633a; }
        #rvModalTableContainer td.rv-status-moderate { background: #fff1b8; color: #7a5b00; }
        #rvModalTableContainer td.rv-status-severe { background: #fbd0d0; color: #b3261e; }
        /* Virtual scrolling needs every row to be the same height: one line. A long text is cut short with an ellipsis
           and its whole is in the cell's tooltip. */
        #rvModalTableContainer tbody tr { height: 42px; }
        #rvModalTableContainer tbody td { box-sizing: border-box; height: 42px; padding-top: 0; padding-bottom: 0; line-height: 41px; overflow: hidden; text-overflow: ellipsis; }
        /* .rv-vs-sizer is as tall as the whole table (it makes the scrollbar). .rv-vs-viewport is pinned to the top of the
           scroll area and is exactly as tall as what is visible of it (the height is set in layout): a pinned element can
           never go below the bottom of its parent, so a taller one would be pushed up near the end of the scroll area. It
           clips the rows drawn above and below the screen; overflow "clip" (unlike "hidden") keeps the Seq. ID column
           sticky sideways. The table inside swaps its rows as the area scrolls. */
        .rv-vs-sizer { position: relative; }
        .rv-vs-viewport { position: sticky; top: 0; overflow-x: visible; overflow-y: clip; }
        #rvModalTableContainer:focus-visible { outline: 2px solid ${BRAND}; outline-offset: 2px; }
        #rvModalTableContainer tbody tr.rv-alt { background: #f8fafc; }
        #rvModalTableContainer tbody tr:hover { background: #eef3fb; }
        #rvModalTableContainer::-webkit-scrollbar { width: 8px; height: 8px; }
        #rvModalTableContainer::-webkit-scrollbar-thumb { background: rgba(89, 121, 170, 0.4); border-radius: 4px; transition: background 0.2s ease; }
        #rvModalTableContainer::-webkit-scrollbar-thumb:hover { background: rgba(89, 121, 170, 0.7); }
        .rv-empty { padding: 48px 16px; text-align: center; color: #6b7280; font-size: 1rem; }
        #rvModalTableContainer td.rv-empty { border-right: 0; white-space: normal; }
        .rv-retry {
            margin-left: 6px; padding: 4px 12px; border: 1px solid ${BRAND}; border-radius: 8px; background: #fff; color: ${BRAND};
            font-weight: 600; cursor: pointer; transition: background 0.2s ease, color 0.2s ease;
        }
        .rv-retry:hover { background: ${BRAND}; color: #fff; }
        /* while a new sort / search / filter is being read the rows stay, dimmed, so the table never goes blank */
        #rvModalTableContainer { transition: opacity 0.15s ease; }
        #rvModalTableContainer.rv-loading { opacity: 0.55; pointer-events: none; }

        /* a row whose data is still on its way: bars of the same height as a row. Still (not shimmering): hundreds of
           animated bars would make the browser repaint the table all the time, which is what lag feels like. */
        .rv-skel { display: block; width: 70%; height: 12px; margin-top: 15px; border-radius: 6px; background: rgba(15, 23, 42, 0.09); }
        .rv-skel-failed { opacity: 0.5; }

        /* where the user is in the table, under it */
        .rv-status-line { align-items: center; gap: 10px; min-height: 30px; margin-top: 10px; font-size: 0.82rem; font-weight: 600; color: #5b6b85; font-variant-numeric: tabular-nums; }
        .rv-child-link { color: ${BRAND}; text-decoration: underline; cursor: pointer; }

        /* Safety questions pop-up: opens over the detail table */
        #rvSafetyModal .rv-modal-content { max-width: 980px; }
        .rv-safety-sub { margin: 0 0 12px; font-size: 0.82rem; color: #6b7280; }
        #rvSafetyTableContainer { max-height: 62vh; overflow: auto; border-radius: 12px; border: 1px solid #e3e8f0; box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04); }
        #rvSafetyTableContainer table { width: 100%; border-collapse: separate; border-spacing: 0; }
        #rvSafetyTableContainer thead th {
            position: sticky; top: 0; z-index: 2; padding: 11px 14px; text-align: left; white-space: nowrap;
            background: linear-gradient(180deg, #6486b7, ${BRAND}); color: #fff; font-size: 0.82rem; font-weight: 700; letter-spacing: 0.02em;
        }
        #rvSafetyTableContainer td { padding: 11px 14px; border-bottom: 1px solid #e8edf5; vertical-align: top; line-height: 1.45; }
        #rvSafetyTableContainer tbody tr:nth-child(even) { background: #f8fafc; }
        #rvSafetyTableContainer tbody tr:hover { background: #eef3fb; }
        #rvSafetyTableContainer td.rv-sq-cell { text-align: center; font-weight: 700; white-space: nowrap; }
        #rvSafetyTableContainer td.rv-sq-bad { background: #fbd0d0; color: #b3261e; }
        #rvSafetyTableContainer td.rv-sq-good { background: #d4f4dd; color: #14633a; }

        #rvLogicTableWrapper { overflow-y: auto; max-height: 70vh; border-radius: 12px; border: 1px solid #e3e8f0; background: #fff; box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04); }
        #rvLogicTableWrapper table { width: 100%; border-collapse: collapse; font-size: 14px; text-align: left; }
        #rvLogicTableWrapper thead th { position: sticky; top: 0; background: linear-gradient(180deg, #6486b7, ${BRAND}); color: #fff; padding: 12px; border: 0; z-index: 1; box-shadow: 0 3px 8px -4px rgba(15, 23, 42, 0.35); }
        #rvLogicTableWrapper td { padding: 10px 12px; border: 0; border-bottom: 1px solid #e8edf5; vertical-align: top; line-height: 1.5; }
        #rvLogicTableWrapper tbody tr { transition: background-color 0.15s ease; }
        #rvLogicTableWrapper tbody tr:hover { background: #eef3fb; }
        #rvLogicTableWrapper td:first-child { font-weight: 600; color: #333; width: 32%; }
        #rvLogicTableWrapper td:last-child { color: #555; }
        #rvLogicTableWrapper tbody tr:nth-child(even) { background: #f9f9f9; }
        #rvLogicTableWrapper tbody tr.rv-logic-section td { width: auto; padding: 9px 12px; background: #e6edf8; color: ${BRAND}; font-weight: 700; font-size: 15px; letter-spacing: 0.2px; border-bottom: 1px solid #cfd9ea; border-left: 4px solid ${BRAND}; }

        @media (max-width: 768px) {
            .rv-modal-content { width: 96%; padding: 14px; margin: 3% auto; }
            #rvModalTableContainer th, #rvModalTableContainer td { padding: 9px 6px; font-size: 14px; }
            #rvSafetyTableContainer th, #rvSafetyTableContainer td { padding: 9px 8px; font-size: 14px; }
        }
        `;
        document.head.appendChild(style);
    }

    page.main.append(`
        <div class="rv-root">
            <div class="rv-tabs" role="tablist" aria-label="Review card sections"></div>
            <div class="rv-cards-area"></div>
        </div>

        <div id="rvDataModal" class="rv-modal">
            <div class="rv-modal-content">
                <div class="rv-modal-head">
                    <h2 id="rvModalTitle"></h2>
                    <span class="rv-modal-count" id="rvModalCount"></span>
                    <div class="rv-modal-search">
                        <input id="rvModalSearchInput" type="text" placeholder="Search..." autocomplete="off">
                        <span>&#128269;</span>
                    </div>
                    <button id="rvDownloadDataBtn" class="rv-btn" type="button">Download Data</button>
                    <button class="rv-close-btn rv-data-close" type="button" aria-label="Close">&times;</button>
                </div>
                <div id="rvModalTableContainer"></div>
                <div id="rvModalStatus" class="rv-status-line" style="display: none;"></div>
            </div>
        </div>

        <div id="rvSafetyModal" class="rv-modal" role="dialog" aria-modal="true" aria-labelledby="rvSafetyTitle" style="z-index: 10000;">
            <div class="rv-modal-content">
                <div class="rv-modal-head">
                    <h2 id="rvSafetyTitle"></h2>
                    <span class="rv-modal-count" id="rvSafetyCount"></span>
                    <button class="rv-close-btn rv-safety-close" type="button" aria-label="Close">&times;</button>
                </div>
                <p class="rv-safety-sub" id="rvSafetySub"></p>
                <div id="rvSafetyTableContainer"></div>
            </div>
        </div>

        <div id="rvScopeModal" class="rv-modal" role="dialog" aria-modal="true" aria-labelledby="rvScopeTitle" style="z-index: 10001;">
            <div class="rv-modal-content">
                <div class="rv-modal-head">
                    <h2 id="rvScopeTitle">Download</h2>
                    <button class="rv-close-btn rv-scope-close" type="button" aria-label="Close">&times;</button>
                </div>
                <p class="rv-scope-hint" id="rvScopeHint"></p>
                <div class="rv-scope-options">
                    <button class="rv-scope-option" type="button" data-scope="all">
                        <b>All Indicators</b><span>Every section together</span>
                    </button>
                    <button class="rv-scope-option" type="button" data-scope="screen">
                        <b>This Screen</b><span id="rvScopeScreenHint"></span>
                    </button>
                </div>
            </div>
        </div>

        <div id="rvLogicModal" class="rv-modal" style="z-index: 10000;">
            <div id="rvLogicModalContent" class="rv-modal-content" style="max-width: 1200px;">
                <div class="rv-modal-head">
                    <h2 style="color: ${BRAND};">Card Logic</h2>
                    <button id="rvDownloadLogicXlsxBtn" class="rv-btn" type="button">Download XLSX</button>
                    <button id="rvDownloadLogicPngBtn" class="rv-btn" type="button">Download PNG</button>
                    <button id="rvDownloadLogicPdfBtn" class="rv-btn" type="button">Download PDF</button>
                    <button class="rv-close-btn rv-logic-close" type="button" aria-label="Close">&times;</button>
                </div>
                <div id="rvLogicTableWrapper">
                    <table>
                        <thead><tr><th>Card Title</th><th>Logic</th></tr></thead>
                        <tbody id="rvLogicTableBody"></tbody>
                    </table>
                </div>
            </div>
        </div>
    `);

    const cardsArea = page.main.find('.rv-cards-area')[0];
    const dataModal = document.getElementById('rvDataModal');
    const logicModal = document.getElementById('rvLogicModal');

    // ------------------------------------------------------------------
    // Cards: build, update
    // ------------------------------------------------------------------
    const cardRefs = {};
    let renderToken = 0;
    let activeFilters = {};
    let cardValues = {};
    // Age chosen in the cards that have one (card id -> "" or "1".."7"); kept across searches.
    const cardAge = {};

    function formatNumber(number) {
        return new Intl.NumberFormat("en-IN").format(number);
    }

    // The `age` request parameter of a card, only when an age is chosen.
    function ageParam(cardId) {
        return cardAge[cardId] ? { age: cardAge[cardId] } : {};
    }

    function ageLabel(cardId) {
        const option = AGE_OPTIONS.find(o => o.value === (cardAge[cardId] || ''));
        return option && option.value ? option.label : '';
    }

    const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // A card's number counts up from zero. The final text is kept in data-final, so that a download never reads half a count.
    function animateCount(el, to, display) {
        el.dataset.final = display;
        const start = performance.now();
        const duration = Math.min(900, 380 + String(to).length * 90);
        el.textContent = formatNumber(0);
        const step = (now) => {
            const t = Math.max(0, Math.min(1, (now - start) / duration));   // the first frame's timestamp can precede `start`
            el.textContent = t === 1 ? display : formatNumber(Math.round(to * (1 - Math.pow(1 - t, 3))));
            if (t < 1) el._rvRaf = requestAnimationFrame(step);
            else delete el.dataset.final;
        };
        el._rvRaf = requestAnimationFrame(step);
    }

    function settleCounters() {
        cardsArea.querySelectorAll('.rv-value-text[data-final]').forEach(el => {
            cancelAnimationFrame(el._rvRaf);
            el.textContent = el.dataset.final;
            delete el.dataset.final;
        });
    }

    // Explicit stroke colour (not currentColor) so html2canvas keeps it in PNG/PDF.
    function iconSvg(iconName) {
        return `<svg viewBox="0 0 24 24" stroke="#ffffff" aria-hidden="true">${ICONS[iconName]}</svg>`;
    }

    function createCard(cardId, index) {
        const cfg = CARDS[cardId];
        const card = document.createElement('div');
        card.className = `rv-card rv-tone-${cfg.tone}`;
        card.dataset.cardId = cardId;
        card.style.setProperty('--rv-i', index);
        card.innerHTML = `
            <div class="rv-card-body">
                <div class="rv-card-title"></div>
                <div class="rv-card-row">
                    <div class="rv-card-value"><span class="rv-mini-loader"></span></div>
                    <div class="rv-card-extra"></div>
                </div>
                <div class="rv-cta"></div>
            </div>
            <div class="rv-illus" aria-hidden="true">
                <span class="rv-illus-blob"></span>
                <span class="rv-illus-ring"></span>
                <span class="rv-illus-dot"></span>
                <span class="rv-illus-tile">${iconSvg(cfg.icon)}</span>
            </div>
            <div class="rv-card-overlay"><span class="rv-mini-loader"></span></div>
        `;
        card.querySelector('.rv-card-title').textContent = cfg.title;

        if (cfg.age) {
            const select = document.createElement('select');
            select.className = 'rv-age-select';
            select.title = cfg.age;
            select.setAttribute('aria-label', `${cfg.title}: age of the issues`);
            AGE_OPTIONS.forEach(option => {
                const el = document.createElement('option');
                el.value = option.value;
                el.textContent = option.label;
                select.appendChild(el);
            });
            select.value = cardAge[cardId] || '';
            const row = card.querySelector('.rv-card-row');
            row.classList.add('rv-has-age');
            row.insertBefore(select, row.querySelector('.rv-card-extra'));
        }

        cardRefs[cardId] = card;
        return card;
    }

    // ------------------------------------------------------------------
    // Section tabs: one section on screen at a time
    // ------------------------------------------------------------------
    const tabsBar = page.main.find('.rv-tabs')[0];
    let activeSection = SECTIONS[0].key;

    SECTIONS.forEach(section => {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'rv-tab';
        tab.id = `rv-tab-${section.key}`;
        tab.dataset.section = section.key;
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-controls', `rv-panel-${section.key}`);
        tab.innerHTML = '<span class="rv-tab-label"></span><span class="rv-tab-count"></span>';
        tab.querySelector('.rv-tab-label').textContent = section.title;
        tab.querySelector('.rv-tab-count').textContent = section.cards.length;
        tab.title = `${section.cards.length} indicators`;
        tabsBar.appendChild(tab);
    });

    // The line under the active tab slides from tab to tab instead of jumping.
    const tabIndicator = document.createElement('span');
    tabIndicator.className = 'rv-tab-indicator';
    tabIndicator.setAttribute('aria-hidden', 'true');
    tabsBar.appendChild(tabIndicator);
    tabsBar.classList.add('rv-has-indicator');

    function moveTabIndicator() {
        const active = tabsBar.querySelector('.rv-tab.rv-active');
        if (!active) return;
        tabIndicator.style.setProperty('--rv-tx', `${active.offsetLeft}px`);
        tabIndicator.style.setProperty('--rv-tw', `${active.offsetWidth}px`);
    }
    if (window.ResizeObserver) new ResizeObserver(moveTabIndicator).observe(tabsBar);
    window.addEventListener('resize', moveTabIndicator);

    function sectionPanel(key) {
        return cardsArea.querySelector(`.rv-section[data-section="${key}"]`);
    }

    function setActiveSection(key) {
        activeSection = key;
        tabsBar.querySelectorAll('.rv-tab').forEach(tab => {
            const active = tab.dataset.section === key;
            tab.classList.toggle('rv-active', active);
            tab.setAttribute('aria-selected', String(active));
            tab.tabIndex = active ? 0 : -1;
        });
        cardsArea.querySelectorAll('.rv-section').forEach(panel => {
            panel.classList.toggle('rv-active', panel.dataset.section === key);
        });
        moveTabIndicator();
        // Before the first search there is nothing to load; renderCards() loads the active tab.
        if (renderToken > 0) loadSection(key);
    }

    tabsBar.addEventListener('click', (e) => {
        const tab = e.target.closest('.rv-tab');
        if (tab && tab.dataset.section !== activeSection) setActiveSection(tab.dataset.section);
    });

    tabsBar.addEventListener('keydown', (e) => {
        const tabs = Array.from(tabsBar.querySelectorAll('.rv-tab'));
        const current = tabs.findIndex(tab => tab.dataset.section === activeSection);
        const next = {
            ArrowRight: (current + 1) % tabs.length,
            ArrowLeft: (current - 1 + tabs.length) % tabs.length,
            Home: 0,
            End: tabs.length - 1
        }[e.key];
        if (next === undefined) return;
        e.preventDefault();
        tabs[next].focus();
        setActiveSection(tabs[next].dataset.section);
    });

    setActiveSection(activeSection);

    function createAllCardPlaceholders() {
        cardsArea.innerHTML = '';
        Object.keys(cardRefs).forEach(k => delete cardRefs[k]);

        SECTIONS.forEach(section => {
            const el = document.createElement('section');
            el.className = 'rv-section';
            el.id = `rv-panel-${section.key}`;
            el.dataset.section = section.key;
            el.setAttribute('role', 'tabpanel');
            el.setAttribute('aria-labelledby', `rv-tab-${section.key}`);
            el.classList.toggle('rv-active', section.key === activeSection);
            const grid = document.createElement('div');
            grid.className = 'rv-grid';
            section.cards.forEach((cardId, i) => grid.appendChild(createCard(cardId, i)));
            el.appendChild(grid);
            cardsArea.appendChild(el);
        });
    }

    // display: text shown as the big value. opts: { extra, clickable, badge }
    function updateCard(cardId, display, opts = {}) {
        const card = cardRefs[cardId];
        if (!card) return;

        const valueEl = card.querySelector('.rv-card-value');
        valueEl.classList.toggle('rv-value-error', !!opts.error);
        valueEl.innerHTML = '';
        const text = document.createElement('span');
        text.className = 'rv-value-text';
        text.textContent = display;
        valueEl.appendChild(text);
        if (opts.countTo > 0 && !reducedMotion) animateCount(text, opts.countTo, display);

        if (opts.badge) {
            const badge = document.createElement('span');
            badge.className = 'rv-badge';
            badge.style.setProperty('--rv-badge', opts.badge.color || '#6b7280');
            badge.textContent = opts.badge.label;
            valueEl.appendChild(badge);
        }

        card.querySelector('.rv-card-extra').textContent = opts.extra || '';

        const clickable = !!opts.clickable && !!CARDS[cardId].query;
        card.classList.toggle('rv-clickable', clickable);

        const cta = card.querySelector('.rv-cta');
        cta.textContent = clickable ? 'View details' : 'No records';
        cta.classList.toggle('rv-cta-off', !clickable);
        if (opts.error) card.removeAttribute('data-cta');
        else card.setAttribute('data-cta', '1');

        if (clickable) {
            card.setAttribute('tabindex', '0');
            card.setAttribute('role', 'button');
            card.setAttribute('aria-label', `${CARDS[cardId].title}: ${display}. Open details`);
        } else {
            card.removeAttribute('tabindex');
            card.removeAttribute('role');
            card.removeAttribute('aria-label');
        }
    }

    function markCardError(cardId) {
        updateCard(cardId, '—', { extra: 'Unable to load', error: true });
    }

    function getRange(percent) {
        return ELIGIBLE_ENROLLED_RANGES.find(r =>
            percent >= (r.min === undefined ? -Infinity : r.min) &&
            percent < (r.max === undefined ? Infinity : r.max)
        ) || null;
    }

    function updateDerivedCards() {
        const { eligible, enrolled, enrolled_month, exited_month } = cardValues;

        if (eligible !== undefined && enrolled !== undefined) {
            if (eligible > 0) {
                const percent = (enrolled / eligible) * 100;
                const range = getRange(percent);
                updateCard('eligible_vs_enrolled', `${percent.toFixed(1)}%`, {
                    extra: `(${formatNumber(enrolled)} enrolled of ${formatNumber(eligible)} eligible)`,
                    clickable: true,
                    badge: range
                });
            } else {
                updateCard('eligible_vs_enrolled', '—', { extra: '(No eligible children)' });
            }
        }

        if (enrolled_month !== undefined && exited_month !== undefined) {
            let extra;
            if (exited_month > 0) {
                extra = `(${(enrolled_month / exited_month).toFixed(2)} enrolled per 1 exited)`;
            } else {
                extra = enrolled_month > 0 ? '(No exits this month)' : '(No enrollment or exits this month)';
            }
            updateCard('enrolment_exit_ratio', `${formatNumber(enrolled_month)} : ${formatNumber(exited_month)}`, {
                extra,
                clickable: enrolled_month + exited_month > 0
            });
        }
    }

    function applySection(data) {
        Object.values(data).forEach(items => {
            if (!Array.isArray(items)) return;
            items.forEach(it => {
                if (!it || !CARDS[it.id] || it.value === undefined) return;
                const value = Number(it.value) || 0;
                cardValues[it.id] = value;
                updateCard(it.id, formatNumber(value), { extra: it.extra || '', clickable: value > 0, countTo: value });
            });
        });
    }

    // ------------------------------------------------------------------
    // Filters -> API params
    // ------------------------------------------------------------------
    const filterToApiKeyMap = {
        partner: "partner_id",
        state: "state_id",
        district: "district_id",
        gp: "gp_id",
        block: "block_id",
        supervisor_id: "supervisor_id",
        creche: "creche_id",
        year: "year",
        month: "month",
        creche_status_id: "c_status",
        phases: "phases"
    };

    function getApiFilters() {
        const params = {};
        const byDateRange = page.fields_dict["date_input_type"].get_value() === "date_range";

        Object.entries(filterToApiKeyMap).forEach(([fieldname, apiKey]) => {
            // The Year and Month are used with the Month/Year type only
            if (byDateRange && (fieldname === "year" || fieldname === "month")) return;
            const field = page.fields_dict[fieldname];
            const value = field && field.get_value();
            if (value) params[apiKey] = value;
        });

        // With the Date Range type the From - To range is used instead of the Year and Month (the server reads from_date / to_date first)
        const period = byDateRange ? page.fields_dict["date_range"].get_value() : null;
        if (period && period.length === 2 && period[0] && period[1]) {
            params.from_date = period[0];
            params.to_date = period[1];
        }

        const rangeType = page.fields_dict["cr_opening_range_type"].get_value();
        const singleDate = page.fields_dict["single_date"].get_value();
        const dateRange = page.fields_dict["c_opening_range"].get_value();

        if (rangeType) {
            if (rangeType === "between" && dateRange && dateRange.length === 2) {
                params.cstart_date = dateRange[0];
                params.cend_date = dateRange[1];
            } else if (rangeType === "before" && singleDate) {
                params.cstart_date = "2017-01-01";
                params.cend_date = singleDate;
            } else if (rangeType === "after" && singleDate) {
                params.cstart_date = singleDate;
                params.cend_date = new Date().toISOString().split("T")[0];
            } else if (rangeType === "equal" && singleDate) {
                params.cstart_date = singleDate;
                params.cend_date = singleDate;
            }
        }
        return params;
    }

    async function fetchSection(fn, filterParams) {
        const url = new URL(`${API_ROOT}.${fn}`);
        Object.entries(filterParams).forEach(([key, value]) => url.searchParams.append(key, value));
        const response = await fetch(url.toString(), { method: "GET", credentials: "same-origin" });
        const json = await response.json();
        if (!json || !json.data) {
            throw new Error(json && (json.exception || json._server_messages) || `No data returned from ${fn}`);
        }
        return json.data;
    }

    // Sections already requested for the current search; a tab is fetched the first time it is opened.
    // Maps section key -> its in-flight/finished load promise, so exports can wait for it.
    const loadedSections = new Map();

    async function renderCards() {
        renderToken++;
        activeFilters = getApiFilters();
        cardValues = {};
        loadedSections.clear();
        createAllCardPlaceholders();
        await loadSection(activeSection);
    }

    function loadSection(sectionKey) {
        if (!loadedSections.has(sectionKey)) loadedSections.set(sectionKey, fetchSectionCards(sectionKey));
        return loadedSections.get(sectionKey);
    }

    async function fetchSectionCards(sectionKey) {
        const token = renderToken;

        await Promise.all(SECTION_APIS.filter(api => api.section === sectionKey).map(api =>
            fetchSection(api.fn, { ...activeFilters, ...(typeof api.params === 'function' ? api.params() : api.params || {}) })
                .then(data => {
                    if (token !== renderToken) return;
                    applySection(data);
                    if (api.derived) updateDerivedCards();
                })
                .catch(err => {
                    console.error(`Error loading ${api.fn}:`, err);
                    if (token !== renderToken) return;
                    api.cards.forEach(markCardError);
                    if (api.derived) {
                        markCardError('eligible_vs_enrolled');
                        markCardError('enrolment_exit_ratio');
                    }
                })
        ));
    }

    // ------------------------------------------------------------------
    // Card interactions: click, keyboard, 3D tilt
    // ------------------------------------------------------------------
    async function handleCardClick(cardId, cardElement) {
        const cfg = CARDS[cardId];
        cardElement.classList.add('rv-busy');

        const baseParams = { ...activeFilters, ...ageParam(cardId), query_type: cfg.query };
        const title = ageLabel(cardId) ? `${cfg.title} – ${ageLabel(cardId)}` : cfg.title;

        try {
            // Only the first page comes now (with the number of records); the rest is read as the user pages.
            const first = await fetchDetailPage(baseParams, { page: 0, pageSize: CHUNK_SIZE, count: true });
            openModalWithTable(title, first, undefined, cardId, baseParams);
        } catch (err) {
            console.error("Error fetching card data:", err);
            openModalWithTable(title, null, "Error fetching data", cardId, baseParams);
        } finally {
            cardElement.classList.remove('rv-busy');
        }
    }

    // Count of one age card again after its age was changed. The card is locked (busy) while it loads.
    const ageRequests = {};

    async function reloadAgeCard(cardId) {
        const token = renderToken;
        const request = (ageRequests[cardId] || 0) + 1;
        ageRequests[cardId] = request;
        const card = cardRefs[cardId];
        card.classList.add('rv-busy');

        try {
            const data = await fetchSection('review_card.review_card_count', { ...activeFilters, card: cardId, ...ageParam(cardId) });
            if (token !== renderToken || request !== ageRequests[cardId]) return;
            applySection(data);
        } catch (err) {
            console.error(`Error loading ${cardId}:`, err);
            if (token === renderToken && request === ageRequests[cardId]) markCardError(cardId);
        } finally {
            card.classList.remove('rv-busy');
        }
    }

    // The age select lives inside the card, so it must not open the details.
    const inAgeSelect = (e) => !!e.target.closest('.rv-age-select');

    cardsArea.addEventListener('change', (e) => {
        const select = e.target.closest('.rv-age-select');
        if (!select) return;
        const cardId = select.closest('.rv-card').dataset.cardId;
        cardAge[cardId] = select.value;
        reloadAgeCard(cardId);
    });

    cardsArea.addEventListener('click', (e) => {
        if (inAgeSelect(e)) return;
        const card = e.target.closest('.rv-card.rv-clickable');
        if (card) handleCardClick(card.dataset.cardId, card);
    });

    cardsArea.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        if (inAgeSelect(e)) return;
        const card = e.target.closest('.rv-card.rv-clickable');
        if (!card) return;
        e.preventDefault();
        handleCardClick(card.dataset.cardId, card);
    });

    const canTilt = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches
        && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (canTilt) {
        cardsArea.addEventListener('mousemove', (e) => {
            const card = e.target.closest('.rv-card');
            if (!card) return;
            const rect = card.getBoundingClientRect();
            const x = (e.clientX - rect.left) / rect.width;
            const y = (e.clientY - rect.top) / rect.height;
            card.style.setProperty('--rv-ry', `${((x - 0.5) * 8).toFixed(2)}deg`);
            card.style.setProperty('--rv-rx', `${((0.5 - y) * 8).toFixed(2)}deg`);
            card.style.setProperty('--rv-mx', `${(x * 100).toFixed(1)}%`);
            card.style.setProperty('--rv-my', `${(y * 100).toFixed(1)}%`);
            // the illustration moves against the tilt, so it seems to sit in front of the card
            card.style.setProperty('--rv-px', `${((x - 0.5) * -10).toFixed(1)}px`);
            card.style.setProperty('--rv-py', `${((y - 0.5) * -8).toFixed(1)}px`);
        });
        cardsArea.addEventListener('mouseout', (e) => {
            const card = e.target.closest('.rv-card');
            if (!card || card.contains(e.relatedTarget)) return;
            card.style.setProperty('--rv-ry', '0deg');
            card.style.setProperty('--rv-rx', '0deg');
            card.style.setProperty('--rv-px', '0px');
            card.style.setProperty('--rv-py', '0px');
        });
    }

    // ------------------------------------------------------------------
    // Drill-down modal
    // ------------------------------------------------------------------
    // The table on screen: { title, columns, baseParams, total, abort }. Null while the pop-up is closed.
    let modalState = null;

    // The table scrolls through all the records but only the rows on screen (and a few more) are in the DOM, and
    // only the chunks of rows around the screen are in the browser; the server sorts, filters and hands out the rest.
    const CHUNK_SIZE = 500;           // rows one request reads while scrolling
    const MAX_CACHED_CHUNKS = 16;     // chunks kept in memory; one scrolled away from is read again when scrolled back to
    const ROW_BUFFER = 8;             // rows drawn above and below the visible ones
    const READ_AHEAD_ROWS = 100;      // rows read ahead of the screen in the direction of scrolling (one screen the other way)
    const ROW_HEIGHT = 42;            // px; the real height is measured from the first row (see the CSS)
    const HEAD_HEIGHT = 76;           // px; the two heading rows, measured the same way
    const MAX_BODY_HEIGHT = 15000000; // px; the tallest scroll area used: browsers stop at 17 to 33 million. A bigger table gets a scaled scrollbar
    const FETCH_IDLE = 120;           // ms the scrolling must pause before the server is asked for the rows on screen ...
    const FETCH_MAX_WAIT = 400;       // ... but it is asked at least this often while the user keeps scrolling
    const FILTER_DELAY = 400;         // ms after the last keystroke before the search or a filter asks the server
    const EXPORT_CHUNK = 20000;       // rows one request reads for Download Data
    const EXPORT_XLSX_MAX = 50000;    // an XLSX is built in memory; a bigger download is a CSV, written chunk by chunk

    // One chunk of a card's detail (`page` of `pageSize` rows): { rows, total }. `total` is the number of records matching
    // the search and the filters (null for the plain table unless `count` is set, as scrolling does not change it).
    // view: { page, pageSize, count, columns, sort: { col, direction }, query, filters }
    async function fetchDetailPage(baseParams, view, signal) {
        const params = new URLSearchParams({ ...baseParams, page: view.page, page_size: view.pageSize });
        if (view.count) params.set('count', '1');

        const filters = Object.fromEntries(Object.entries(view.filters || {}).filter(([, text]) => text));
        const narrowed = Object.keys(filters).length > 0 || !!view.query;
        const sorted = !!(view.sort && view.sort.col);
        if (narrowed || sorted) params.set('columns', JSON.stringify(view.columns));
        if (sorted) {
            params.set('sort_col', view.sort.col);
            params.set('sort_dir', view.sort.direction === -1 ? 'desc' : 'asc');
        }
        if (view.query) params.set('search', view.query);
        if (Object.keys(filters).length) params.set('col_filters', JSON.stringify(filters));

        const res = await fetch(`${API_ROOT}.review_cards_details.fetch_review_card_data?${params.toString()}`, { credentials: "same-origin", signal });
        const result = await res.json();
        if (!result || !Array.isArray(result.data)) throw new Error("Unexpected response");
        return { rows: result.data, total: result.total };
    }

    // Columns that hold the child's name: a link to the child's growth monitoring page.
    const CHILD_NAME_COLUMNS = ['Child Name', 'Name of the child'];
    // Safety tables: the number of issues is a link that shows the creche's questions in a pop-up.
    const SAFETY_ISSUES_COLUMN = 'Number of Issues Identified';
    // Nutrition status columns, shown in colour: Normal green, Moderate yellow, Severe red.
    const STATUS_COLUMNS = ['Weight-for-Age Status', 'Weight-for-Height Status', 'Height-for-Age Status'];
    const STATUS_CLASSES = { Normal: 'rv-status-normal', Moderate: 'rv-status-moderate', Severe: 'rv-status-severe' };

    function updateModalCount(shown, total) {
        const label = total === 1 ? 'record' : 'records';
        document.getElementById('rvModalCount').textContent =
            shown === total ? `${formatNumber(total)} ${label}` : `${formatNumber(shown)} of ${formatNumber(total)} ${label}`;
    }

    // The child's name links out of the detail table, in a new tab, for the month and year of the cards on screen.
    function selectedPeriod() {
        // With a Date Range the other pages take the month of its To date (they only have a Year and a Month)
        if (activeFilters.to_date) {
            const [year, month] = activeFilters.to_date.split('-');
            return { month: Number(month), year: Number(year) };
        }
        const now = new Date();
        return {
            month: activeFilters.month || now.getMonth() + 1,
            year: activeFilters.year || now.getFullYear()
        };
    }

    function childGrowthMonitoringUrl(record) {
        const { month, year } = selectedPeriod();
        return `${BASE_URL}/app/growth-monitoring-ch?creche_id=${encodeURIComponent(record._creche_docname)}`
            + `&child_id=${encodeURIComponent(record._child_docname)}&month=${encodeURIComponent(month)}&year=${encodeURIComponent(year)}`;
    }

    // ------------------------------------------------------------------
    // Safety questions: the number of issues of a creche opens its questions in a pop-up over the detail table,
    // on the same screen (it used to open the Safety status report in a new tab).
    // ------------------------------------------------------------------
    const SAFETY_QUESTION_NOTE = "Questions answered with the unsafe answer in the audits of the selected period. Audit Date is the latest audit that found the issue.";
    const SAFETY_QUESTION_NOTES = {
        sf_identified: "Questions answered with the unsafe answer at the creche's latest audit with issues.",
        sf_unresolved: "Questions answered with the unsafe answer in the creche's current run of audits with issues. Status says whether the issue is still there at its latest audit; Audit Date is the latest audit that found it."
    };
    // Unsafe answers and open issues in red, resolved issues in green.
    const SAFETY_CELL_CLASSES = { No: 'rv-sq-bad', Yes: 'rv-sq-bad', Unresolved: 'rv-sq-bad', Resolved: 'rv-sq-good' };

    const safetyModal = document.getElementById('rvSafetyModal');
    const safetyContainer = document.getElementById('rvSafetyTableContainer');
    let safetyRequest = 0;

    function showSafetyMessage(text) {
        safetyContainer.innerHTML = '';
        const message = document.createElement('div');
        message.className = 'rv-empty';
        message.textContent = text;
        safetyContainer.appendChild(message);
    }

    function renderSafetyQuestions(rows) {
        document.getElementById('rvSafetyCount').textContent = `${rows.length} ${rows.length === 1 ? 'question' : 'questions'}`;
        if (!rows.length) {
            showSafetyMessage('No question found');
            return;
        }

        const columns = Object.keys(rows[0]);
        const table = document.createElement('table');
        const headerRow = table.createTHead().insertRow();
        columns.forEach(col => {
            const th = document.createElement('th');
            th.textContent = col;
            headerRow.appendChild(th);
        });
        const tbody = table.createTBody();
        rows.forEach(row => {
            const tr = tbody.insertRow();
            columns.forEach(col => {
                const td = tr.insertCell();
                td.textContent = row[col];
                if ((col === 'Answer' || col === 'Status') && SAFETY_CELL_CLASSES[row[col]]) td.className = `rv-sq-cell ${SAFETY_CELL_CLASSES[row[col]]}`;
            });
        });
        safetyContainer.innerHTML = '';
        safetyContainer.appendChild(table);
    }

    // The creche's questions for the card, for the filters of the search on screen.
    async function openSafetyQuestions(record, cardId) {
        const request = ++safetyRequest;
        document.getElementById('rvSafetyTitle').textContent = record['Creche Name'] || 'Safety questions';
        document.getElementById('rvSafetySub').textContent = `${CARDS[cardId].title}. ${SAFETY_QUESTION_NOTES[cardId] || SAFETY_QUESTION_NOTE}`;
        document.getElementById('rvSafetyCount').textContent = '';
        showSafetyMessage('Loading...');
        safetyModal.style.display = 'block';
        safetyModal.querySelector('.rv-safety-close').focus();

        try {
            const params = new URLSearchParams({ ...activeFilters, creche_id: record._creche_docname, card: cardId });
            const res = await fetch(`${API_ROOT}.review_cards_details.fetch_safety_questions?${params.toString()}`, { credentials: "same-origin" });
            const result = await res.json();
            if (!result || !Array.isArray(result.data)) throw new Error("Unexpected response");
            if (request === safetyRequest) renderSafetyQuestions(result.data);
        } catch (err) {
            console.error("Error fetching safety questions:", err);
            if (request === safetyRequest) showSafetyMessage('Error fetching data');
        }
    }

    // Closes only this pop-up: the detail table below it stays open.
    function closeSafetyModal() {
        safetyRequest++;
        safetyModal.style.display = 'none';
    }

    safetyModal.querySelector('.rv-safety-close').addEventListener('click', closeSafetyModal);
    safetyModal.addEventListener('click', (e) => {
        if (e.target === safetyModal) closeSafetyModal();
    });

    function safetyQuestionsLink(text, record, cardId) {
        const link = document.createElement('a');
        link.href = '#';
        link.className = 'rv-child-link';
        link.title = 'Show the questions';
        link.textContent = text;
        link.addEventListener('click', (e) => {
            e.preventDefault();
            openSafetyQuestions(record, cardId);
        });
        return link;
    }

    function newTabLink(text, href, className) {
        const link = document.createElement('a');
        link.href = href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.className = className;
        link.textContent = text;
        return link;
    }

    // The detail table: one scrolling table of all the records, no pages. A browser cannot hold a million rows, so
    // the table is VIRTUAL: the scrollbar covers every record, but only the rows on screen (plus a few) exist in the
    // DOM, and their data is read from the server CHUNK_SIZE rows at a time as the user scrolls. Sorting, the search
    // box and the column filters run on the server. It stays as quick with a million records as with fifty.
    // `first` is the first chunk ({ rows, total }) read when the card was clicked, null if that failed.
    function openModalWithTable(title, first, message, cardId, baseParams) {
        if (modalState) modalState.abort();
        const container = document.getElementById('rvModalTableContainer');
        const status = document.getElementById('rvModalStatus');

        // Fresh input on every open so listeners from a previous table never fire.
        const previousInput = document.getElementById('rvModalSearchInput');
        const searchInput = previousInput.cloneNode(true);
        previousInput.parentNode.replaceChild(searchInput, previousInput);
        searchInput.value = '';

        document.getElementById('rvModalTitle').textContent = title;
        document.body.classList.add('rv-modal-open');
        dataModal.style.display = 'block';
        container.innerHTML = '';
        container.scrollTop = 0;
        container.classList.remove('rv-loading');
        container.onscroll = null;
        status.innerHTML = '';
        status.style.display = 'none';

        // Columns starting with "_" carry link data only and are never shown.
        const firstRows = first ? first.rows : [];
        const grandTotal = first ? (Number.isFinite(first.total) ? first.total : firstRows.length) : 0;
        const columns = firstRows.length ? Object.keys(firstRows[0]).filter(k => !k.startsWith('_')) : [];
        const state = { title, columns, baseParams, total: grandTotal, abort() {} };
        modalState = state;

        if (!grandTotal || !firstRows.length) {
            updateModalCount(0, 0);
            const empty = document.createElement('div');
            empty.className = 'rv-empty';
            empty.textContent = message || 'No record found';
            container.appendChild(empty);
            return;
        }

        const view = { page: 0, pageSize: CHUNK_SIZE, columns, sort: { col: null, direction: 1 }, query: '', filters: {} };
        let total = grandTotal;                       // records matching the search and the filters
        let generation = 0;                           // bumped when the sort, search or a filter changes: older answers are dropped
        const chunks = new Map([[0, firstRows]]);     // chunk number -> its rows, least recently used first
        const pending = new Map();                    // chunk number -> the AbortController of its request
        const failed = new Set();                     // chunks whose request failed (not retried until the user asks)
        let retryAction = null;
        let rowH = ROW_HEIGHT;                        // measured from the first rendered row
        let headH = HEAD_HEIGHT;                      // the two heading rows
        let measured = false;
        let renderedStart = -1;
        let renderedEnd = -1;
        let dirty = true;                             // the rows on screen need drawing again (new data arrived)
        let frame = 0;
        let applyTimer = null;
        let fetchTimer = null;
        let fetchDueSince = 0;
        let lastFirstIndex = 0;
        let scrollingDown = true;                     // the direction of the latest scrolling: rows are read ahead that way
        let sizerHeight = '';                         // what was last written to the page (see layout)
        let viewportHeight = '';
        let rowCount = -1;
        let windowShift = '';

        const isNarrowed = () => !!view.query || Object.values(view.filters).some(Boolean);

        // ---- headings: click one to sort by it (ascending, descending, off); every column has its own filter box
        const sizer = document.createElement('div');          // as tall as the whole table would be: it makes the scrollbar
        sizer.className = 'rv-vs-sizer';
        // Pinned to the top of the scroll area and exactly as tall as what is visible of it (see layout). A pinned element
        // taller than that would be pushed up by the end of the scroll area, away from where its rows are placed.
        const viewport = document.createElement('div');
        viewport.className = 'rv-vs-viewport';
        const table = document.createElement('table');        // its rows are swapped as the area scrolls
        table.className = 'rv-vs-table';
        const head = table.createTHead();
        const headerRow = head.insertRow();
        const filterRow = head.insertRow();
        filterRow.className = 'rv-filter-row';
        const sortArrows = {};

        const seqHeader = document.createElement('th');
        seqHeader.textContent = 'Seq. ID';
        seqHeader.className = 'rv-seq';
        headerRow.appendChild(seqHeader);
        filterRow.appendChild(document.createElement('th'));

        function updateSortIndicators() {
            columns.forEach(col => {
                const { th, arrow } = sortArrows[col];
                const active = view.sort.col === col;
                arrow.textContent = active ? (view.sort.direction === 1 ? '▲' : '▼') : '';
                th.setAttribute('aria-sort', active ? (view.sort.direction === 1 ? 'ascending' : 'descending') : 'none');
            });
        }

        function toggleSort(col) {
            if (view.sort.col !== col) {
                view.sort = { col, direction: 1 };
            } else if (view.sort.direction === 1) {
                view.sort.direction = -1;
            } else {
                view.sort = { col: null, direction: 1 };
            }
            updateSortIndicators();
            applyView();
        }

        // Typing waits for a pause before the server is asked.
        function scheduleApply() {
            clearTimeout(applyTimer);
            applyTimer = setTimeout(applyView, FILTER_DELAY);
        }

        columns.forEach(col => {
            const th = document.createElement('th');
            th.className = 'rv-sortable';
            th.tabIndex = 0;
            th.title = 'Click to sort';
            const label = document.createElement('span');
            label.textContent = col;
            const arrow = document.createElement('span');
            arrow.className = 'rv-sort-arrow';
            th.append(label, arrow);
            th.addEventListener('click', () => toggleSort(col));
            th.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleSort(col);
                }
            });
            sortArrows[col] = { th, arrow };
            headerRow.appendChild(th);

            const filterCell = document.createElement('th');
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'rv-col-filter';
            input.placeholder = 'Filter';
            input.setAttribute('aria-label', `Filter ${col}`);
            input.addEventListener('input', () => {
                view.filters[col] = input.value.trim();
                scheduleApply();
            });
            filterCell.appendChild(input);
            filterRow.appendChild(filterCell);
        });

        const tbody = table.createTBody();
        viewport.appendChild(table);
        sizer.appendChild(viewport);
        container.appendChild(sizer);
        container.tabIndex = 0;           // so the arrow, Page Up / Down, Home and End keys scroll it
        container.setAttribute('aria-label', 'Detail table');

        // ---- rows: only the ones on screen exist
        const linkable = columns.some(col => CHILD_NAME_COLUMNS.includes(col));

        // `i` is the row's place in the whole table (from 0): it gives the Seq. ID and the stripe, so a row keeps its look
        // wherever the window of rows starts.
        function buildRow(record, i) {
            const tr = document.createElement('tr');
            if (i % 2) tr.className = 'rv-alt';
            tr.setAttribute('aria-rowindex', i + 3);

            const serialCell = document.createElement('td');
            serialCell.textContent = i + 1;
            serialCell.style.textAlign = 'center';
            tr.appendChild(serialCell);

            columns.forEach(col => {
                const td = document.createElement('td');
                const cell = record[col];

                if (linkable && CHILD_NAME_COLUMNS.includes(col) && cell && record._child_docname && record._creche_docname) {
                    td.appendChild(newTabLink(cell, childGrowthMonitoringUrl(record), 'rv-child-link'));
                } else if (col === SAFETY_ISSUES_COLUMN && cell !== null && cell !== undefined && cell !== '' && record._creche_docname) {
                    td.style.textAlign = 'center';
                    td.appendChild(safetyQuestionsLink(cell, record, cardId));
                } else {
                    td.textContent = cell === null || cell === undefined ? '' : cell;
                    if (STATUS_COLUMNS.includes(col) && STATUS_CLASSES[cell]) td.className = `rv-status ${STATUS_CLASSES[cell]}`;
                    // every row is one line high, so a long text is cut short: the whole of it is in the tooltip
                    if (typeof cell === 'string' && cell.length > 40) td.title = cell;
                }
                tr.appendChild(td);
            });
            return tr;
        }

        // A row whose data has not arrived: grey bars of the same height as a real row.
        function placeholderRow(i, isFailed) {
            const tr = document.createElement('tr');
            if (i % 2) tr.className = 'rv-alt';
            tr.setAttribute('aria-rowindex', i + 3);
            const serialCell = document.createElement('td');
            serialCell.textContent = i + 1;
            serialCell.style.textAlign = 'center';
            tr.appendChild(serialCell);
            columns.forEach(() => {
                const td = document.createElement('td');
                const bar = document.createElement('span');
                bar.className = isFailed ? 'rv-skel rv-skel-failed' : 'rv-skel';
                td.appendChild(bar);
                tr.appendChild(td);
            });
            return tr;
        }

        function messageRow(text) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = columns.length + 1;
            td.className = 'rv-empty';
            td.textContent = text;
            tr.appendChild(td);
            return tr;
        }

        const recordAt = (i) => {
            const rows = chunks.get(Math.floor(i / CHUNK_SIZE));
            return rows ? rows[i % CHUNK_SIZE] : undefined;
        };

        // The columns keep the widths of the first rows, so they do not change width as the rows scroll by.
        function freezeColumns() {
            const cells = Array.from(headerRow.children);
            // offsetWidth / offsetHeight, not getBoundingClientRect: the pop-up is still scaling in (a transform) when
            // the table first draws, and a bounding box would be measured at that scale
            const widths = cells.map(th => th.offsetWidth);
            if (widths.some(width => !width)) return;       // not laid out (hidden): keep the automatic layout
            const seqMin = String(total).length * 9 + 28;
            const fitted = widths.map((width, i) => Math.round(Math.min(Math.max(width, i === 0 ? seqMin : 90), 520)));
            const colgroup = document.createElement('colgroup');
            fitted.forEach(width => {
                const col = document.createElement('col');
                col.style.width = `${width}px`;
                colgroup.appendChild(col);
            });
            table.insertBefore(colgroup, table.firstChild);
            table.style.tableLayout = 'fixed';
            table.style.minWidth = `${fitted.reduce((sum, width) => sum + width, 0)}px`;
        }

        // ---- the window of rows for the scroll position
        // The scroll area is as tall as the table (rows x row height), but never taller than MAX_BODY_HEIGHT, as browsers
        // stop at 17-33 million px. A bigger table maps the scroll position to a row proportionally (the scrollbar is
        // scaled); a smaller one maps it 1:1, which is the same formula.
        const bodyHeightOf = () => Math.min(total * rowH, MAX_BODY_HEIGHT);

        function metrics() {
            const visibleHeight = Math.max(container.clientHeight - headH, rowH);     // the rows' room under the headings
            const visibleRows = visibleHeight / rowH;
            const scrollable = Math.max(bodyHeightOf() - visibleHeight, 0);
            const ratio = scrollable > 0 ? Math.min(Math.max(container.scrollTop / scrollable, 0), 1) : 0;
            return { visibleRows, firstIndex: ratio * Math.max(total - visibleRows, 0) };
        }

        // The rows [from, to) as a fragment; a row whose data has not arrived is a placeholder.
        function rowsFragment(from, to) {
            const fragment = document.createDocumentFragment();
            for (let i = from; i < to; i++) {
                const record = recordAt(i);
                fragment.appendChild(record ? buildRow(record, i) : placeholderRow(i, failed.has(Math.floor(i / CHUNK_SIZE))));
            }
            return fragment;
        }

        // Draws the rows [start, end) from scratch.
        function renderWindow(start, end) {
            if (!total) {
                tbody.replaceChildren(messageRow('No matching record'));
                renderedStart = renderedEnd = -1;
            } else {
                tbody.replaceChildren(rowsFragment(start, end));
                renderedStart = start;
                renderedEnd = end;
            }
            dirty = false;
        }

        // Scrolling slides the window a row or two at a time: the rows that stay are kept and only the few new ones at the
        // edge are built. Everything is drawn again only when new data arrived or the window jumped.
        function syncWindow(start, end) {
            const slid = !dirty && total > 0 && renderedStart >= 0 && start < renderedEnd && end > renderedStart;
            if (!slid) {
                renderWindow(start, end);
                return;
            }
            while (renderedStart < start) {
                tbody.firstChild.remove();
                renderedStart++;
            }
            while (renderedEnd > end) {
                tbody.lastChild.remove();
                renderedEnd--;
            }
            if (start < renderedStart) {
                tbody.insertBefore(rowsFragment(start, renderedStart), tbody.firstChild);
                renderedStart = start;
            }
            if (end > renderedEnd) {
                tbody.appendChild(rowsFragment(renderedEnd, end));
                renderedEnd = end;
            }
        }

        const statusText = document.createElement('span');
        statusText.className = 'rv-status-text';
        const retryButton = document.createElement('button');
        retryButton.type = 'button';
        retryButton.className = 'rv-retry';
        retryButton.textContent = 'Retry';
        retryButton.hidden = true;
        retryButton.addEventListener('click', () => {
            if (retryAction) retryAction();
        });
        status.append(statusText, retryButton);
        status.style.display = 'flex';

        function updateStatus(firstIndex, visibleRows) {
            const from = total ? Math.floor(firstIndex) + 1 : 0;
            const to = Math.min(total, Math.ceil(firstIndex + visibleRows));
            let text = `Rows ${formatNumber(from)}–${formatNumber(to)} of ${formatNumber(total)}`;
            if (isNarrowed()) text += ` (filtered from ${formatNumber(grandTotal)})`;
            if (retryAction) text += ' · some rows could not be loaded';
            else if (pending.size) text += ' · loading…';
            if (statusText.textContent !== text) statusText.textContent = text;
            retryButton.hidden = !retryAction;
        }

        function layout() {
            if (modalState !== state) return;
            // Only what changed is written to the page: every write can make the browser lay the table out again.
            // The scroll area gets its height first: how much of it is visible (the container's height) follows from it.
            const sizerPx = `${headH + bodyHeightOf()}px`;
            if (sizerPx !== sizerHeight) {
                sizer.style.height = sizerPx;
                sizerHeight = sizerPx;
            }
            const { visibleRows, firstIndex } = metrics();
            if (firstIndex !== lastFirstIndex) scrollingDown = firstIndex > lastFirstIndex;
            lastFirstIndex = firstIndex;
            const viewportPx = `${container.clientHeight}px`;
            if (viewportPx !== viewportHeight) {
                viewport.style.height = viewportPx;
                viewportHeight = viewportPx;
            }
            if (total !== rowCount) {
                table.setAttribute('aria-rowcount', total + 2);
                rowCount = total;
            }

            const start = Math.max(0, Math.floor(firstIndex) - ROW_BUFFER);
            const end = Math.min(total, Math.ceil(firstIndex + visibleRows) + ROW_BUFFER);
            if (dirty || start !== renderedStart || end !== renderedEnd) syncWindow(start, end);
            // the window starts a few rows above the screen: slide it so that row `firstIndex` is right under the headings
            const shift = total ? `translateY(${-(firstIndex - start) * rowH}px)` : '';
            if (shift !== windowShift) {
                tbody.style.transform = shift;
                windowShift = shift;
            }

            if (!measured && total && tbody.rows.length) {
                // The real heights of a row and of the headings, and the column widths, are known once rows exist.
                measured = true;
                const rowHeight = tbody.rows[0].offsetHeight;
                const headHeight = head.offsetHeight;
                if (rowHeight > 0) rowH = rowHeight;
                if (headHeight > 0) headH = headHeight;
                freezeColumns();
                filterRow.querySelectorAll('th').forEach(th => { th.style.top = `${headerRow.offsetHeight}px`; });
                layout();
                return;
            }
            updateStatus(firstIndex, visibleRows);
        }

        // ---- reading the rows: the chunks around the screen, well ahead in the direction the user is scrolling
        function neededChunks() {
            const { visibleRows, firstIndex } = metrics();
            const behind = scrollingDown ? visibleRows : READ_AHEAD_ROWS;
            const ahead = scrollingDown ? READ_AHEAD_ROWS : visibleRows;
            const from = Math.max(0, Math.floor(firstIndex - behind));
            const to = Math.min(total, Math.ceil(firstIndex + visibleRows + ahead) + 1);
            const needed = [];
            for (let chunk = Math.floor(from / CHUNK_SIZE); chunk * CHUNK_SIZE < to; chunk++) needed.push(chunk);
            return needed;
        }

        async function loadChunk(chunk) {
            const gen = generation;
            const controller = new AbortController();
            pending.set(chunk, controller);
            try {
                const { rows, total: matched } = await fetchDetailPage(baseParams, { ...view, page: chunk }, controller.signal);
                if (gen !== generation || modalState !== state) return;
                chunks.set(chunk, rows);
                if (typeof matched === 'number' && matched !== total) {
                    total = matched;
                    updateModalCount(total, grandTotal);
                }
                dirty = true;
            } catch (err) {
                if (err.name === 'AbortError' || gen !== generation || modalState !== state) return;
                console.error("Error fetching card data:", err);
                failed.add(chunk);
                dirty = true;
                retryAction = () => {
                    retryAction = null;
                    failed.clear();
                    dirty = true;
                    fetchNeeded();
                    layout();
                };
            } finally {
                if (pending.get(chunk) === controller) pending.delete(chunk);
                if (gen === generation && modalState === state) layout();
            }
        }

        function fetchNeeded() {
            if (modalState !== state) return;
            const needed = neededChunks();

            // requests for chunks the user has scrolled away from are of no use any more
            pending.forEach((controller, chunk) => {
                if (!needed.includes(chunk)) {
                    controller.abort();
                    pending.delete(chunk);
                }
            });
            needed.forEach(chunk => {
                const rows = chunks.get(chunk);
                if (rows) {
                    chunks.delete(chunk);       // used just now: it goes to the end of the line for eviction
                    chunks.set(chunk, rows);
                } else if (!pending.has(chunk) && !failed.has(chunk)) {
                    loadChunk(chunk);
                }
            });
            while (chunks.size > MAX_CACHED_CHUNKS) {
                const oldest = Array.from(chunks.keys()).find(chunk => !needed.includes(chunk));
                if (oldest === undefined) break;
                chunks.delete(oldest);
            }
        }

        // While the user is scrolling the server is not asked for every position passed: it waits for a pause (but
        // never longer than FETCH_MAX_WAIT) and then reads what is on screen.
        function scheduleFetch() {
            const now = performance.now();
            if (!fetchTimer) fetchDueSince = now;
            clearTimeout(fetchTimer);
            const wait = Math.max(0, Math.min(FETCH_IDLE, FETCH_MAX_WAIT - (now - fetchDueSince)));
            fetchTimer = setTimeout(() => {
                fetchTimer = null;
                fetchNeeded();
                layout();
            }, wait);
        }

        // The sort, the search or a filter changed: read the first chunk of the new view. The old rows stay (dimmed) until
        // it arrives, then the table starts again from the top.
        async function applyView() {
            clearTimeout(applyTimer);
            const gen = ++generation;
            pending.forEach(controller => controller.abort());
            pending.clear();
            failed.clear();
            retryAction = null;
            const controller = new AbortController();
            pending.set(0, controller);
            container.classList.add('rv-loading');
            container.setAttribute('aria-busy', 'true');

            try {
                const { rows, total: matched } = await fetchDetailPage(baseParams, { ...view, page: 0 }, controller.signal);
                if (gen !== generation || modalState !== state) return;
                total = typeof matched === 'number' ? matched : (isNarrowed() ? total : grandTotal);
                chunks.clear();
                chunks.set(0, rows);
                dirty = true;
                updateModalCount(total, grandTotal);
                container.scrollTop = 0;
                pending.delete(0);
                layout();
                fetchNeeded();
                layout();
            } catch (err) {
                if (err.name === 'AbortError' || gen !== generation || modalState !== state) return;
                console.error("Error fetching card data:", err);
                // the rows on screen belong to the old view: show them as not loaded, with a Retry
                chunks.clear();
                failed.add(0);
                dirty = true;
                container.scrollTop = 0;
                retryAction = applyView;
                layout();
            } finally {
                if (gen === generation) {
                    pending.delete(0);
                    container.classList.remove('rv-loading');
                    container.removeAttribute('aria-busy');
                }
            }
        }

        // ---- scrolling and resizing
        container.onscroll = () => {
            if (frame) return;
            frame = requestAnimationFrame(() => {
                frame = 0;
                layout();
                scheduleFetch();
            });
        };
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
            layout();
            scheduleFetch();
        }) : null;
        if (observer) observer.observe(container);

        state.abort = () => {
            generation++;
            clearTimeout(applyTimer);
            clearTimeout(fetchTimer);
            if (frame) cancelAnimationFrame(frame);
            frame = 0;
            pending.forEach(controller => controller.abort());
            pending.clear();
            container.onscroll = null;
            if (observer) observer.disconnect();
        };

        searchInput.addEventListener('input', function () {
            view.query = this.value.trim();
            scheduleApply();
        });

        updateModalCount(total, grandTotal);
        layout();
        fetchNeeded();
    }

    function closeDataModal() {
        closeSafetyModal();
        // drops anything still loading for the table, and a download in progress stops
        if (modalState) modalState.abort();
        modalState = null;
        dataModal.style.display = 'none';
        document.body.classList.remove('rv-modal-open');
    }

    function exportToExcel(columns, rows, title) {
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([columns, ...rows]);
        XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
        XLSX.writeFile(wb, `${title.replace(/[^\w-]+/g, '_')}.xlsx`);
    }

    dataModal.querySelector('.rv-data-close').addEventListener('click', closeDataModal);
    dataModal.addEventListener('click', (e) => {
        if (e.target === dataModal) closeDataModal();
    });

    const csvCell = (value) => {
        if (value === null || value === undefined) return '';
        const text = String(value);
        return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const csvLine = (cells) => `${cells.map(csvCell).join(',')}\r\n`;

    function saveBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    // Download Data: every record of the card in its own order (not just the page, search or filters on screen).
    // The rows are read EXPORT_CHUNK at a time. A small table becomes an XLSX; a big one a CSV that is written chunk by
    // chunk (its rows are never all held as objects), so a million records neither freeze nor exhaust the browser.
    let downloadingData = false;

    async function downloadDetailData() {
        const state = modalState;
        if (!state || !state.total) {
            frappe.show_alert({ message: __('No data available to download'), indicator: 'orange' });
            return;
        }
        if (downloadingData) return;
        downloadingData = true;

        const button = document.getElementById('rvDownloadDataBtn');
        const label = button.textContent;
        button.disabled = true;

        const asCsv = state.total > EXPORT_XLSX_MAX;
        const headings = ['Seq. ID', ...state.columns];
        const rows = [];                                    // for the XLSX
        const parts = [`﻿${csvLine(headings)}`];       // for the CSV (the BOM makes Excel read it as UTF-8)
        try {
            for (let page = 0; page * EXPORT_CHUNK < state.total; page++) {
                const offset = page * EXPORT_CHUNK;
                button.textContent = `Preparing ${Math.floor(offset * 100 / state.total)}%`;
                const { rows: chunk } = await fetchDetailPage(state.baseParams, { page, pageSize: EXPORT_CHUNK });
                if (modalState !== state) return;           // the pop-up was closed meanwhile
                if (!chunk.length) break;

                const lines = chunk.map((record, i) => [offset + i + 1, ...state.columns.map(col => record[col])]);
                if (asCsv) parts.push(lines.map(csvLine).join(''));
                else lines.forEach(line => rows.push(line));
            }

            if (asCsv) saveBlob(new Blob(parts, { type: 'text/csv;charset=utf-8' }), `${state.title.replace(/[^\w-]+/g, '_')}.csv`);
            else exportToExcel(headings, rows, state.title);
        } catch (err) {
            console.error("Error downloading card data:", err);
            frappe.show_alert({ message: __('Could not download the data'), indicator: 'red' });
        } finally {
            downloadingData = false;
            button.disabled = false;
            button.textContent = label;
        }
    }

    document.getElementById('rvDownloadDataBtn').addEventListener('click', downloadDetailData);

    // ------------------------------------------------------------------
    // Logic modal
    // ------------------------------------------------------------------
    const hiddenCardTitles = new Set([
        ...ALL_SECTIONS.filter(s => s.hidden).flatMap(s => s.cards.map(id => CARDS[id].title)),
        // Cards taken off their section.
        ...["mp_to_refer", "mm_referred", "mm_nrc_admitted", "ci_lc_low", "eligible_vs_enrolled"].map(id => CARDS[id].title)
    ]);
    const logicDataList = [
        { title: CARDS.op_creches.title, logic: "Creches with status Active/Operational that match the selected filters and opened on or before the end of the selected month." },
        { title: CARDS.op_partners.title, logic: "Distinct partner organizations running at least one operational creche in the current selection. Detail has one row per partner with its number of operational creches and its state, district and block names." },
        { title: CARDS.op_blocks.title, logic: "Distinct blocks that have at least one operational creche in the current selection. Detail has one row per block with its state, district and partner names." },
        { title: CARDS.op_districts.title, logic: "Distinct districts that have at least one operational creche in the current selection. Detail has one row per district with its state, block and partner names." },
        { title: CARDS.profile_not_submitted.title, logic: "Operational creches that have no Gram Sabha consent form attached to the creche record (the same test the Creche Profile report uses for 'submitted')." },
        { title: CARDS.hh_not_done.title, logic: "Operational creches with no household form (not deleted) visited or created during the calendar quarter that contains the selected month: Jan-Mar, Apr-Jun, Jul-Sep or Oct-Dec." },
        { title: CARDS.no_exit_anthro.title, logic: "Cumulative: all children who exited on or before the end of the selected period (the end of the selected month, or the To date of a Date Range), not only those who exited in it, whose exit record has no weight or no height recorded at exit." },
        { title: CARDS.no_welcome_anthro.title, logic: "Cumulative: all children enrolled on or before the end of the selected period (the end of the selected month, or the To date of a Date Range), not only those enrolled in it, whose enrollment record has no measurement taken, or has no weight or no height. Children who have since exited are included." },
        { title: CARDS.wrong_equipment.title, logic: "Creches with a child enrolled (welcome anthro) or exited (exit anthro) in the selected month where the equipment recorded does not suit the child's age at measurement: Infantometer for children under 24 months, Stadiometer from 24 months. The card counts creches; the number of affected children is shown beneath it." },
        { title: CARDS.low_enrolment.title, logic: "Operational creches whose number of currently enrolled children (as at the end of the selected month) is 10 or fewer, including creches with no enrolled children." },
        { title: CARDS.eligible.title, logic: "Children from household records aged between 6 and 36 months (as at today for the current month, otherwise the end of the selected month) who have a date of birth and no child status, belonging to the filtered creches. Same rule as the Creche Report Card." },
        { title: CARDS.enrolled.title, logic: "Children enrolled on or before the end of the selected month and not exited by then. Same rule as Current active children on the Creche Report Card." },
        { title: CARDS.enrolled_month.title, logic: "Children whose date of enrollment falls in the selected month." },
        { title: CARDS.exited_month.title, logic: "Children whose date of exit falls in the selected month." },
        { title: CARDS.eligible_vs_enrolled.title, logic: "Current enrolled children divided by current eligible children, as a percentage. Detail lists each creche's eligible children, enrolled children and percentage. The colour band beside the value appears once the range is configured (ELIGIBLE_ENROLLED_RANGES in review_card.js)." },
        { title: CARDS.enrolment_exit_ratio.title, logic: "Children enrolled in the selected month compared with children exited in the selected month, shown as 'enrolled : exited'. The line beneath shows enrolled children per one exited child. Detail lists the creches that enrolled or exited at least one child, with the children enrolled, the children exited and the children still to be enrolled (eligible children from the household survey who are not enrolled in a creche now)." },
        { title: CARDS.overage_not_exited.title, logic: "Currently enrolled children (not exited by the end of the selected month) who are 36 months or older at the end of that month." },
        { title: CARDS.att_avg_below_50.title, logic: "Operational creches whose average attendance for the selected month is below 50%: children present divided by children listed, over the days the creche was open. Creches with no attendance records are not counted here (see the not-submitted cards). Detail shows the enrolled children, the average attendance % and the daily average attendance." },
        { title: CARDS.att_daily_below_10.title, logic: "Operational creches where the average number of children present per open day in the selected month is below 10 (total children present divided by days the creche was open, to 1 decimal). Creches that were never open in the month are not counted. Detail shows the enrolled children, the average attendance % and the daily average attendance." },
        { title: CARDS.att_children_zero.title, logic: "Children enrolled at any time in the selected month (enrolled on or before month end and not exited before month start) who attended on none of the days the creche was open. A child with no attendance record counts as 0%. Same rule as the Average Attendance Child Wise report." },
        { title: CARDS.att_children_below_50.title, logic: "Children enrolled at any time in the selected month whose attendance (days attended divided by open days, to 2 decimals) is below 50%. Includes the 0% children and children with no attendance record." },
        { title: CARDS.att_closed_over_7.title, logic: "Operational creches marked closed for the day on more than 7 different days in the selected month. Detail also shows the number of enrolled children." },
        { title: CARDS.att_missed_over_5.title, logic: "Operational creches missing attendance for more than 5 days in the selected month (days due minus records submitted). Days due run from the creche opening date (or the 1st of the month) to today for the current month, otherwise to month end. Any submitted record counts, open or closed. Detail also shows the number of enrolled children." },
        { title: CARDS.att_missed_all.title, logic: "Operational creches that have not submitted attendance for every day due in the selected month (same rule as 'No. of creches not submitted attendance (All Days)' on the Creche Report Card): submitted records are fewer than days due. Detail also shows the number of enrolled children." },

        { title: CARDS.mp_measure_below_100.title, logic: "Operational creches where, of the children enrolled at any time in the selected month, fewer than 100% have a height and weight measurement taken in a growth monitoring entry dated in that month. Creches that submitted no measurements count (0%); creches with no enrolled children do not. Detail lists each creche with its partner, supervisor and area and the measurement %. In the child tables the weight-for-age, weight-for-height and height-for-age status are in colour: Normal green, Moderate yellow, Severe red." },
        { title: CARDS.mp_not_submitted.title, logic: "Operational creches with no growth monitoring entry dated in the selected month (same rule as 'Anthro data not submitted' on the Creche Report Card). Detail lists each creche with its partner, supervisor and area." },
        { title: CARDS.mp_wrong_equipment.title, logic: "Creches where a child's latest measurement of the selected month was taken with equipment that does not suit the child's age on the measurement date: Infantometer for children under 24 months, Stadiometer from 24 months. The card counts creches; the number of children is shown beneath it. Detail has one row per creche, listing the children measured with the wrong equipment, their age, the equipment used and the equipment needed." },
        { title: CARDS.mp_implausible.title, logic: "Children whose latest measurement of the selected month has both weight and height outside the WHO plausible range (-4 SD to +3 SD) for their age in months and gender, as flagged in the Malnutrition Prevalence Report (Childwise). Age is taken at the end of the selected month (today for the current month), a part month counting as a whole one. Only children aged 6 to 36 months are checked; a missing or zero weight or height is not counted. Detail has one row per child and says which of the weight and height is outside the range, and the range." },
        { title: CARDS.mp_snc.title, logic: "Children measured in the selected month who meet any of GF1 (weight-for-age z-score lower than last month's, or two months back if there is none last month), GF2, Zig-Zag (with the z-score both rising and falling over the last 4 months), SAM or SUW. Same rule as the SNC column of the Malnutrition Prevalence Report (Childwise). Detail shows the malnutrition status (GF1, GF1+ - a fall of 0.5 or more from last month, GF2, Zig-Zag, SAM, SUW) and the child's weight-for-age, weight-for-height and height-for-age status. Each child is counted once, on the latest measurement of the month." },
        { title: CARDS.mp_sam.title, logic: "Children measured in the selected month whose weight-for-height is classified Severe (below -3 SD): severe acute malnutrition. Each child is counted once, on the latest measurement of the month. Detail shows the child's WHZ (weight-for-height z-score) and the three statuses." },
        { title: CARDS.mp_suw.title, logic: "Children measured in the selected month whose weight-for-age is classified Severe (below -3 SD): severely underweight. Each child is counted once, on the latest measurement of the month. Detail shows the child's WAZ (weight-for-age z-score) and the three statuses." },
        { title: CARDS.mp_gf2.title, logic: "Children measured in the selected month whose weight-for-age z-score fell by 0.5 or more against two months back (or three months back if there was no measurement two months back). Same rule as the GF2 column of the Malnutrition Prevalence Report (Childwise). Detail shows the child's WAZ in the selected month and the two before it (the rule can also look back to the third month) and the three statuses." },
        { title: CARDS.mp_zigzag.title, logic: "Children measured in the selected month and in each of the previous four months, enrolled before those four months, whose weight-for-age z-score is 0.5 or more below the highest of the four. Same rule as the ZigZag column of the Malnutrition Prevalence Report (Childwise). Detail shows the child's WAZ in the selected month and the two before it (the rule uses the four months before) and the three statuses." },
        { title: CARDS.mp_to_refer.title, logic: "Children enrolled in the selected month who are GF2, Zig-Zag, SAM or SUW on their latest measurement of the month, or who were recorded with a medical complication / major illness at the month's growth monitoring. Same children as 'No. of children to be referred' under Malnutrition Management. Detail shows the reason (GF2, Zig-Zag, SAM, SUW, Illness) and the three statuses." },

        { title: CARDS.mm_to_refer.title, logic: "Children enrolled in the selected month (enrolled on or before month end and not exited before month start) who, using the same flags as the Malnutrition Prevalence report (child wise), are any of: GF2 (weight-for-age z-score at least 0.5 below 2 months ago, else 3 months ago); Zig-Zag (z-score at least 0.5 below the best of the last 4 months, measured in all 4); SAM (weight-for-height category Severe) or SUW (weight-for-age category Severe) at the latest measurement of the month; or recorded with a medical complication / major illness at the month's growth monitoring. Each child is counted once." },
        { title: CARDS.mm_referred.title, logic: "Of the children to be referred (previous card), those with a referral (Child Referral, any health facility) dated in the selected month." },
        { title: CARDS.mm_nrc_admitted.title, logic: "Of the children to be referred, those admitted to an NRC (NRC Admission and Discharge with 'Child admitted to NRC' = Yes) with a date of admission in the selected month." },
        { title: CARDS.mm_uw_worse.title, logic: "Children whose weight-for-age category at their latest measurement of the previous calendar quarter was Normal and is Moderate or Severe at their latest measurement of the selected quarter (the quarter that contains the selected month: Jan-Mar, Apr-Jun, Jul-Sep or Oct-Dec). Children not measured in both quarters are not counted." },
        { title: CARDS.mm_wasting_worse.title, logic: "Children whose weight-for-height category at their latest measurement of the previous calendar quarter was Normal and is Moderate or Severe at their latest measurement of the selected quarter. Children not measured in both quarters are not counted." },
        { title: CARDS.mm_uw_better.title, logic: "Children whose weight-for-age category at their latest measurement of the previous calendar quarter was Severe and is Normal or Moderate at their latest measurement of the selected quarter. Children not measured in both quarters are not counted." },
        { title: CARDS.mm_wasting_better.title, logic: "Children whose weight-for-height category at their latest measurement of the previous calendar quarter was Severe and is Normal or Moderate at their latest measurement of the selected quarter. Children not measured in both quarters are not counted." },
        { title: CARDS.mm_gf1_to_gf2.title, logic: "Children who were GF1 (and not GF2) in the previous month and are GF2 in the selected month. GF1: weight-for-age z-score fell compared with last month (else 2 months back). GF2: z-score fell by 0.5 or more compared with 2 months back (else 3 months back). A child who qualifies for both in a month is counted as GF2. Both months need a measurement." },
        { title: CARDS.mm_gf2_to_gf1.title, logic: "Children who were GF2 in the previous month and are GF1 (and not GF2) in the selected month. GF1 and GF2 are defined as on the card above. Both months need a measurement." },
        { title: CARDS.mm_sam_3m.title, logic: "Children enrolled at some point in the last 3 months (the selected month and the two before it) who were measured as severely wasted (weight-for-height category Severe) at least once in those 3 months." },
        { title: CARDS.mm_suw_3m.title, logic: "Children enrolled at some point in the last 3 months (the selected month and the two before it) who were measured as severely underweight (weight-for-age category Severe) at least once in those 3 months." },

        { title: CARDS.ci_sup_lt3.title, logic: "Operational creches with fewer than 3 check-ins by creche supervisors during the selected month. Includes creches with no check-in at all (see the next card). Detail lists each creche with its supervisor and the number of check-ins done. Detail starts with the creche and shows its opening date." },
        { title: CARDS.ci_sup_none.title, logic: "Operational creches with no check-in by a creche supervisor during the selected month. Detail starts with the creche and shows its opening date." },
        { title: CARDS.ci_short_engagement.title, logic: "Supervisor check-ins of the selected month made on a day when the supervisor's check-ins at that creche span less than 2 hours (time between the first and the last check-in of the day). A check-in has no check-out time, so a day with a single check-in counts as less than 2 hours. Check-ins without a recorded time are not counted. Detail has one row per check-in. In the detail the check-out time is the last check-in of that day at that creche, as the app records no check-out. Detail starts with the creche and shows its opening date." },
        { title: CARDS.ci_not_opening.title, logic: "Operational creches with an opening time set where none of the month's supervisor check-ins was made within 60 minutes (before or after) of the creche's opening time. Detail shows the date of the supervisor's latest check-in of the month and the creche's opening and closing time. Detail starts with the creche and shows its opening date." },
        { title: CARDS.ci_not_closing.title, logic: "Operational creches with a closing time set where none of the month's supervisor check-ins was made within 60 minutes (before or after) of the creche's closing time. Detail shows the date of the supervisor's latest check-in of the month with the first and last check-in time of that day. Detail starts with the creche and shows its opening date." },
        { title: CARDS.ci_cc_low.title, logic: "Active Cluster Coordinators of the selected partner and geography with fewer than 40 check-ins in the selected month, counting all their check-ins at any creche. Detail lists each such user with the creches they checked in at this month, the geography they are mapped to and the number of check-ins done." },
        { title: CARDS.ci_tc_low.title, logic: "Active Training Coordinators (users with the designation Capacity and Building Manager) of the selected partner and geography with fewer than 20 check-ins in the selected month, counting all their check-ins at any creche. Detail lists each such user with the creches they checked in at this month, the geography they are mapped to and the number of check-ins done." },
        { title: CARDS.ci_mis_low.title, logic: "Active MIS Coordinators (users with the designation MIS Manager) of the selected partner and geography with fewer than 20 check-ins in the selected month, counting all their check-ins at any creche. Detail lists each such user with the creches they checked in at this month, the geography they are mapped to and the number of check-ins done." },
        { title: CARDS.ci_sc_low.title, logic: "Active Safety Coordinators of the selected partner and geography with fewer than 20 check-ins in the selected month, counting all their check-ins at any creche. Detail lists each such user with the creches they checked in at this month, the geography they are mapped to and the number of check-ins done." },
        { title: CARDS.ci_lc_low.title, logic: "Active Logistics Coordinators (users with the designation Accounts and Logistics Manager) of the selected partner and geography with fewer than 20 check-ins in the selected month, counting all their check-ins at any creche. Detail lists each such user with the creches they checked in at this month, the geography they are mapped to and the number of check-ins done." },

        { title: CARDS.sf_not_audited.title, logic: "Operational creches with no safety audit (Safety Indicators visit) dated in the selected month. Detail shows Pending Since: the month after the creche's last safety audit, or the month the creche opened if it has never been audited." },
        { title: CARDS.sf_identified.title, logic: `Operational creches that have had at least one safety issue identified at a safety audit up to the end of the selected month, whether or not it has been resolved since. An issue is the unsafe answer to a Safety Indicators question: 'No' to every question except 'Is any well/tube well within 20 m radius of the creche?', where 'Yes' is the issue ('Not Observed' and 'Other' answers are not issues, and 'properly covered with an iron net' counts only when a well is within 20 m). Age filter: how long ago the creche's latest audit with issues was held, in 30-day months (1 month = up to 30 days, 2 months = 31-60 days ... 6 months = 151-180 days, More than 6 months = over 180 days), counted to today for the current month and to the month end otherwise. Detail shows the number of issues found at that audit. Pending Since is the date of the first audit of the creche's current run of audits with issues, or 'Resolved' when a clean audit came after the last one with issues.` },
        { title: CARDS.sf_unresolved.title, logic: `Operational creches whose latest safety audit (up to the end of the selected month) still has at least one safety issue, that is, there is no clean audit after the last audit with issues. Issues are counted as under 'Safety Issues Identified'. Age filter: how long the issues have been open, counted from the first audit of the creche's current run of audits with issues, in the same 30-day months (More than 6 months = over 180 days). Detail shows how many different issues were identified in the creche's current run of audits with issues, and how many of them are still there at its latest audit. Pending Since is the date of the first audit of that run.` },
        { title: CARDS.sf_infra.title, logic: "Operational creches audited in the selected month where at least one audit has an issue in Infrastructural & Environmental Safety: structural safety of the roof and walls not ensured, not protected from rainwater leakage, a well/tube well within 20 m of the creche (Yes), a well within 20 m not covered with an iron net, or sharp edge cutters/machinery not kept away. Detail shows the number of issues found (the questions of the category with the unsafe answer) and Pending Since: the first audit of the creche's current run of audits with an issue in this category." },
        { title: CARDS.sf_physical.title, logic: "Operational creches audited in the selected month where at least one audit has an issue in Physical Safety & Security: no external fencing, no safety gate at the main entrance or at the kitchen entrance, creche not secured against poisonous and domestic animals, or entry of persons other than parents not recorded in the visitor register. Detail shows the number of issues found (the questions of the category with the unsafe answer) and Pending Since: the first audit of the creche's current run of audits with an issue in this category." },
        { title: CARDS.sf_fire.title, logic: "Operational creches audited in the selected month where at least one audit has an issue in Fire Safety: gas stove slab/table not above cylinder height, fire extinguisher not available or not working, no fire blankets and fire buckets in the kitchen, or the caregiver not confident in handling a pressure cooker. Detail shows the number of issues found (the questions of the category with the unsafe answer) and Pending Since: the first audit of the creche's current run of audits with an issue in this category." },
        { title: CARDS.sf_electrical.title, logic: "Operational creches audited in the selected month where at least one audit has an issue in Electrical Safety: electrical connections within children's reach, fans and lights not at a safe location and height, solar panels or batteries within children's reach, or no lightning arrestor in the creche building. Detail shows the number of issues found (the questions of the category with the unsafe answer) and Pending Since: the first audit of the creche's current run of audits with an issue in this category." },
        { title: CARDS.sf_food.title, logic: "Operational creches audited in the selected month where at least one audit has an issue in Food Safety: food grains and rice not used first come first out, egg floating test not done periodically, leftover food not disposed of every day, or a water filter not used for safe drinking water. Detail shows the number of issues found (the questions of the category with the unsafe answer) and Pending Since: the first audit of the creche's current run of audits with an issue in this category." },
        { title: CARDS.sf_other.title, logic: "Operational creches audited in the selected month where at least one audit has an issue in the remaining safety questions: creche not running with two caregivers during the visit, no fully equipped first-aid box, or emergency contact numbers not clearly displayed. Detail shows the number of issues found (the questions of the category with the unsafe answer) and Pending Since: the first audit of the creche's current run of audits with an issue in this category." },

        { title: CARDS.lg_lpg_not_updated.title, logic: "Operational creches with no LPG record (LPG supply with a Date of Supply on or before today for the current month, or the month end otherwise). Same data as the LPG report, which reads each creche's latest record. Detail shows Pending Since: the creche's opening date, as it has never had an LPG record." },
        { title: CARDS.lg_fire_not_updated.title, logic: "Operational creches with no Fire Extinguisher record. Same data as the Fire Extinguisher Status report. Detail shows Pending Since: the creche's opening date, as it has never had a fire extinguisher record." },
        { title: CARDS.lg_alt_fuel.title, logic: "Operational creches whose latest LPG record has a Current Source of Fuel that is set and different from the Supplied Fuel Source (same rule as 'No of Creches Running on Alternative Fuel' in the LPG report). Detail shows the source of fuel (the remarks when it is 'Other'). Pending Since is the date of that latest LPG record." },
        { title: CARDS.lg_lpg_one_month.title, logic: "Operational creches whose latest LPG record shows LPG as the Current Source of Fuel and a Date of Supply more than 90 days ago, that is, the 'Available Fuel for Month (0-1 Month)' bucket of the LPG report (days counted to today for the current month, otherwise to the month end). Detail shows Pending Since: the date of supply." },
        { title: CARDS.lg_fire_expired.title, logic: "Operational creches with at least one fire extinguisher record whose Date of Expiry is before today (or before the month end for a past month). A record with the status 'Not Available' has no extinguisher and is not counted. Detail shows the earliest expiry date (which is also Pending Since) and the Date of Dispatch for Refilling, if the extinguisher was sent for refilling." },
        { title: CARDS.lg_fire_refill_pending.title, logic: "Operational creches with at least one fire extinguisher record with the status 'Gone for Refilling' whose Gone for Refilling Date (the date it was sent for refilling) is more than one month ago; a record without that date uses the date it was last saved. Detail shows the expiry date of the extinguisher awaiting refilling (the earliest if there are several), Pending Since and the Date of Dispatch for Refilling." },
        { title: CARDS.lg_stock_not_updated.title, logic: "Operational creches with no stock entry (Creche Stock) for the selected month and year. Detail shows the month of the creche's latest stock entry up to the selected month ('Never' if it has none) and Pending Since: the month after it (the month the creche opened if it has never entered stock)." },
        { title: CARDS.lg_cashbook_not_updated.title, logic: "Operational creches with no cashbook entry in a week of the selected month that is over. Weeks are those of the Cashbook report: days 1-7, 8-14, 15-21, 22-28 and 29 to month end. A week is checked once it has ended (before today for the current month) and only if the creche had opened by its first day. Detail shows the month of the creche's latest cashbook entry ('Never' if it has none) and Pending Since: the first day of the first week of the month that is over and has no entry." },
        { title: CARDS.lg_zero_balance.title, logic: "Operational creches with cashbook data whose cash balance is zero or negative: the opening balance entered in the cashbook + the receipts before the month - the expenses before the month, then + the month's receipts - the month's expenses up to today (to the month end for a past month). Same working as the Cashbook report. Detail shows the remaining balance in \u20b9 and Pending Since: the first cashbook day from which the balance has stayed at zero or below." },

        { title: CARDS.ce_gram_sabha_not_submitted.title, logic: "Operational creches that have no Gram Sabha / community resolution attached to the creche record (the 'No. of creches Not submitted' column of the Gramsabha/Community Resolution report). Detail lists each creche with its gram panchayat, block, district, state, partner, opening date and supervisor, and Pending Since (the creche's opening date, as no resolution was ever attached)." },
        { title: CARDS.ce_cmc_not_done.title, logic: "Operational creches with no Creche Committee Meeting dated in the selected month (the 'Creches Not Conducted CMC Meeting' column of the CMC Meeting report). Detail lists each creche with its gram panchayat, block, district, state, partner, opening date and supervisor, and Pending Since (the month after the creche's last meeting before the period, or the month it opened if it never held one)." }
    ].filter(row => !hiddenCardTitles.has(row.title));

    // Group the logic under the section each card sits in (the order of the section tabs).
    const sectionOfCard = new Map(
        ALL_SECTIONS.flatMap((s, order) => s.cards.map(id => [CARDS[id].title, { title: s.title, order }]))
    );
    logicDataList.forEach(row => {
        const section = sectionOfCard.get(row.title);
        row.section = section ? section.title : "Other";
        row.order = section ? section.order : ALL_SECTIONS.length;
    });
    logicDataList.sort((a, b) => a.order - b.order);

    function populateLogicTable() {
        const tbody = document.getElementById("rvLogicTableBody");
        if (tbody.children.length) return;
        let currentSection = null;
        logicDataList.forEach(row => {
            if (row.section !== currentSection) {
                currentSection = row.section;
                const count = logicDataList.filter(r => r.section === currentSection).length;
                const header = document.createElement('tr');
                header.className = 'rv-logic-section';
                const cell = document.createElement('td');
                cell.colSpan = 2;
                cell.textContent = `${currentSection} (${count} ${count === 1 ? 'card' : 'cards'})`;
                header.appendChild(cell);
                tbody.appendChild(header);
            }
            const tr = document.createElement('tr');
            const t = document.createElement('td');
            const l = document.createElement('td');
            t.textContent = row.title;
            l.textContent = row.logic;
            tr.append(t, l);
            tbody.appendChild(tr);
        });
    }

    function openLogicModal() {
        populateLogicTable();
        logicModal.style.display = "block";
        document.body.classList.add("rv-modal-open");
    }

    function closeLogicModal() {
        logicModal.style.display = "none";
        document.body.classList.remove("rv-modal-open");
    }

    logicBtn.on('click', function (e) {
        e.preventDefault();
        openLogicModal();
    });
    logicModal.querySelector('.rv-logic-close').addEventListener('click', closeLogicModal);
    logicModal.addEventListener('click', (e) => {
        if (e.target === logicModal) closeLogicModal();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (scopeModal.style.display === 'block') closeScopeModal(null);
        else if (safetyModal.style.display === 'block') closeSafetyModal();
        else if (logicModal.style.display === 'block') closeLogicModal();
        else if (dataModal.style.display === 'block') closeDataModal();
    });

    // ------------------------------------------------------------------
    // Downloads (PNG / XLSX / PDF) for the cards and the logic table
    // ------------------------------------------------------------------
    // scope: 'screen' (the open tab) or 'all' (every section)
    const scopeModal = document.getElementById('rvScopeModal');
    let scopeResolve = null;

    function closeScopeModal(result) {
        scopeModal.style.display = 'none';
        if (dataModal.style.display !== 'block' && logicModal.style.display !== 'block') document.body.classList.remove('rv-modal-open');
        if (scopeResolve) {
            const resolve = scopeResolve;
            scopeResolve = null;
            resolve(result || null);
        }
    }

    // Pop-up asking what to download. Resolves 'all', 'screen', or null when dismissed.
    function askDownloadScope(formatLabel) {
        if (scopeResolve) closeScopeModal(null);
        document.getElementById('rvScopeTitle').textContent = `Download ${formatLabel}`;
        document.getElementById('rvScopeHint').textContent = 'What would you like to download?';
        document.getElementById('rvScopeScreenHint').textContent =
            `Only the current section: ${SECTIONS.find(s => s.key === activeSection).title}`;
        scopeModal.style.display = 'block';
        document.body.classList.add('rv-modal-open');
        scopeModal.querySelector('[data-scope="all"]').focus();
        return new Promise(resolve => { scopeResolve = resolve; });
    }

    scopeModal.addEventListener('click', (e) => {
        const option = e.target.closest('.rv-scope-option');
        if (option) closeScopeModal(option.dataset.scope);
        else if (e.target === scopeModal || e.target.closest('.rv-scope-close')) closeScopeModal(null);
    });

    // Sections load lazily, so "All Indicators" first makes sure every section has finished loading.
    async function prepareScope(scope) {
        if (scope !== 'all') return;
        if (renderToken === 0) await renderCards();
        await Promise.all(SECTIONS.map(s => loadSection(s.key)));
    }

    function scopeSections(scope) {
        return scope === 'all' ? SECTIONS : SECTIONS.filter(s => s.key === activeSection);
    }

    function scopeFilename(scope) {
        return scope === 'all' ? 'review_cards_all_indicators' : `review_cards_${activeSection}`;
    }

    function buildFilterSummaryEl(captureWidth, scope) {
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
            { key: "creche_status_id", label: "Creche Status", map: statusLabels },
        ];

        const chipStyle = "display:inline-block;background:#eef2f8;border:1px solid #c8d5e8;border-radius:4px;padding:3px 10px;font-size:12px;color:#333;margin:3px 4px 3px 0;";
        const chips = [];
        const addChip = (label, value) => {
            const chip = document.createElement('span');
            chip.style.cssText = chipStyle;
            const b = document.createElement('b');
            b.style.color = BRAND;
            b.textContent = `${label}:`;
            chip.append(b, ` ${value}`);
            chips.push(chip);
        };

        addChip("Section", scope === 'all' ? "All Indicators" : SECTIONS.find(s => s.key === activeSection).title);

        // The Date Range or the Year and Month, as the Date Input Type says
        const byDateRange = page.fields_dict["date_input_type"].get_value() === "date_range";
        const period = byDateRange ? page.fields_dict["date_range"].get_value() : null;
        if (period && period.length === 2 && period[0] && period[1]) addChip("Date Range", `${period[0]} to ${period[1]}`);

        fieldDefs.forEach(({ key, label, map, isLink }) => {
            const field = page.fields_dict[key];
            if (!field) return;
            if (byDateRange && (key === "year" || key === "month")) return;

            // Link fields: use the displayed text (readable name), not the internal id.
            let val = isLink
                ? (field.$input && field.$input.val ? field.$input.val().trim() : field.get_value())
                : field.get_value();

            if (!val && val !== 0) return;
            if (map && map[val]) val = map[val];
            addChip(label, val);
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
            if (dateVal) addChip("Opening Date", dateVal);
        }

        const el = document.createElement('div');
        el.style.cssText = `width:${captureWidth}px;background:#f8fafd;border:1px solid #dce6f0;border-radius:8px;padding:10px 14px;margin-bottom:14px;box-sizing:border-box;font-family:Arial,sans-serif;`;
        const heading = document.createElement('div');
        heading.style.cssText = `font-size:13px;font-weight:700;color:${BRAND};margin-bottom:6px;`;
        heading.textContent = 'Applied Filters';
        const body = document.createElement('div');
        if (chips.length) {
            chips.forEach(c => body.appendChild(c));
        } else {
            body.innerHTML = '<span style="font-size:12px;color:#888;">No filters applied</span>';
        }
        el.append(heading, body);
        return el;
    }

    // Renders the filter summary + a copy of the cards off-screen and returns a canvas.
    async function captureCardsCanvas(scope) {
        await prepareScope(scope);
        settleCounters();
        return new Promise((resolve, reject) => {
            if (typeof html2canvas === 'undefined') {
                frappe.msgprint("Image generation library is still loading. Please try again in a moment.");
                return resolve(null);
            }

            const captureWidth = Math.max(cardsArea.scrollWidth, 1200);
            const holder = document.createElement('div');
            holder.className = 'rv-capture rv-root';
            holder.style.cssText = `position:absolute;top:0;left:-99999px;background:#fff;width:${captureWidth}px;padding:16px;box-sizing:border-box;font-family:Arial,sans-serif;`;
            holder.appendChild(buildFilterSummaryEl(captureWidth - 32, scope));
            const areaCopy = cardsArea.cloneNode(false);
            scopeSections(scope).forEach(section => {
                const panel = sectionPanel(section.key);
                if (!panel) return;
                if (scope === 'all') {
                    const heading = document.createElement('h3');
                    heading.style.cssText = `margin:14px 0 8px;font-size:16px;font-weight:700;color:${BRAND};`;
                    heading.textContent = section.title;
                    areaCopy.appendChild(heading);
                }
                // Hidden tabs are display:none, so force the copy visible.
                const copy = panel.cloneNode(true);
                // A select is not drawn reliably in the image, so show the chosen age as plain text.
                copy.querySelectorAll('.rv-age-select').forEach(select => {
                    const label = document.createElement('span');
                    label.className = 'rv-age-static';
                    label.textContent = ageLabel(select.closest('.rv-card').dataset.cardId) || AGE_OPTIONS[0].label;
                    select.replaceWith(label);
                });
                copy.classList.add('rv-active');
                copy.style.marginTop = '0';
                areaCopy.appendChild(copy);
            });
            holder.appendChild(areaCopy);
            document.body.appendChild(holder);

            const originalScrollX = window.scrollX;
            const originalScrollY = window.scrollY;
            window.scrollTo(0, 0);

            setTimeout(() => {
                html2canvas(holder, {
                    scale: 2,
                    useCORS: true,
                    backgroundColor: "#ffffff",
                    logging: false,
                    scrollX: 0,
                    scrollY: 0,
                    width: holder.scrollWidth,
                    height: holder.scrollHeight,
                    windowWidth: document.documentElement.scrollWidth,
                    windowHeight: document.documentElement.scrollHeight
                }).then(canvas => {
                    resolve(canvas);
                }).catch(reject).finally(() => {
                    document.body.removeChild(holder);
                    window.scrollTo(originalScrollX, originalScrollY);
                });
            }, 100);
        });
    }

    function saveCanvasAsPng(canvas, filename) {
        return new Promise(resolve => {
            canvas.toBlob(blob => {
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = url;
                link.download = filename;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
                resolve();
            }, 'image/png');
        });
    }

    // orientation: 'landscape' | 'portrait' | 'auto' (landscape when the image fits on one page)
    function saveCanvasAsPdf(canvas, filename, orientation) {
        const { jsPDF: JSPDF } = window.jspdf || {};
        const JsPDF = JSPDF || window.jsPDF;
        if (!JsPDF) {
            frappe.msgprint("PDF generation library is still loading. Please try again in a moment.");
            return;
        }

        const imgWidth = canvas.width;
        const imgHeight = canvas.height;
        const ratio = imgWidth / imgHeight;

        if (orientation === 'auto') {
            orientation = (297 / ratio) <= 210 ? 'landscape' : 'portrait';
        }
        const doc = new JsPDF({ orientation, unit: 'mm', format: 'a4' });
        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();
        const scaledH = pageW / ratio;

        let yOffset = 0;
        let remaining = scaledH;
        while (remaining > 0) {
            const sliceH = Math.min(remaining, pageH);
            const srcY = yOffset * (imgHeight / scaledH);
            const srcH = sliceH * (imgHeight / scaledH);

            const sliceCanvas = document.createElement('canvas');
            sliceCanvas.width = imgWidth;
            sliceCanvas.height = srcH;
            sliceCanvas.getContext('2d').drawImage(canvas, 0, srcY, imgWidth, srcH, 0, 0, imgWidth, srcH);

            if (yOffset > 0) doc.addPage();
            doc.addImage(sliceCanvas.toDataURL('image/png'), 'PNG', 0, 0, pageW, sliceH);

            yOffset += sliceH;
            remaining -= sliceH;
        }
        doc.save(filename);
    }

    async function downloadCardsPNG(scope) {
        try {
            const canvas = await captureCardsCanvas(scope);
            if (canvas) await saveCanvasAsPng(canvas, `${scopeFilename(scope)}.png`);
        } catch (err) {
            console.error("Error generating PNG", err);
            frappe.msgprint("Error generating PNG.");
        }
    }

    async function downloadCardsPDF(scope) {
        try {
            const canvas = await captureCardsCanvas(scope);
            if (canvas) saveCanvasAsPdf(canvas, `${scopeFilename(scope)}.pdf`, 'auto');
        } catch (err) {
            console.error("Error generating PDF", err);
            frappe.msgprint("Error generating PDF.");
        }
    }

    async function downloadCardsXLSX(scope) {
        try {
            await prepareScope(scope);
            settleCounters();
            const rows = [];
            scopeSections(scope).forEach(section => {
                const panel = sectionPanel(section.key);
                Array.from(panel ? panel.querySelectorAll('.rv-card') : []).forEach(card => {
                    const text = sel => {
                        const el = card.querySelector(sel);
                        return el ? el.textContent.trim() : '';
                    };
                    const age = card.querySelector('.rv-age-select')
                        ? `Age: ${ageLabel(card.dataset.cardId) || AGE_OPTIONS[0].label}`
                        : '';
                    rows.push({
                        "Section": section.title,
                        "Card Title": text('.rv-card-title'),
                        "Value": text('.rv-value-text'),
                        "Rating": text('.rv-badge'),
                        "Extra Information": [text('.rv-card-extra'), age].filter(Boolean).join(' ')
                    });
                });
            });

            if (rows.length > 0) {
                const worksheet = XLSX.utils.json_to_sheet(rows);
                const workbook = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(workbook, worksheet, "Review Cards");
                XLSX.writeFile(workbook, `${scopeFilename(scope)}.xlsx`);
            }
        } catch (err) {
            console.error("Error generating XLSX", err);
        }
    }

    // Logic table exports: expand the scroll area so the whole table is captured.
    async function captureLogicModal() {
        const target = document.getElementById('rvLogicModalContent');
        const wrap = document.getElementById('rvLogicTableWrapper');
        const saved = [wrap.style.maxHeight, wrap.style.overflowY, target.style.maxHeight, target.style.overflow];
        wrap.style.maxHeight = 'none';
        wrap.style.overflowY = 'visible';
        target.style.maxHeight = 'none';
        target.style.overflow = 'visible';
        try {
            return await html2canvas(target, { scale: 2, windowHeight: target.scrollHeight, scrollY: -window.scrollY });
        } finally {
            [wrap.style.maxHeight, wrap.style.overflowY, target.style.maxHeight, target.style.overflow] = saved;
        }
    }

    function bindLogicDownload(selector, action) {
        document.querySelector(selector).addEventListener('click', function () {
            const btn = this;
            const originalText = btn.textContent;
            btn.textContent = 'Downloading...';
            btn.disabled = true;
            setTimeout(async () => {
                try {
                    await action();
                } catch (err) {
                    console.error("Error generating logic download", err);
                    frappe.msgprint("Error generating download.");
                } finally {
                    btn.textContent = originalText;
                    btn.disabled = false;
                }
            }, 100);
        });
    }

    bindLogicDownload('#rvDownloadLogicXlsxBtn', async () => {
        const worksheet = XLSX.utils.json_to_sheet(logicDataList.map(r => ({ "Section": r.section, "Card Title": r.title, "Logic": r.logic })));
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Card Logic");
        XLSX.writeFile(workbook, "review_card_logic.xlsx");
    });
    bindLogicDownload('#rvDownloadLogicPngBtn', async () => {
        await saveCanvasAsPng(await captureLogicModal(), "review_card_logic.png");
    });
    bindLogicDownload('#rvDownloadLogicPdfBtn', async () => {
        saveCanvasAsPdf(await captureLogicModal(), "review_card_logic.pdf", 'portrait');
    });

    // Frappe keeps this page in the DOM after leaving it, so the white desk background
    // is switched on only while the page is showing.
    document.body.classList.add('rv-page-active');
    $(wrapper).on('show', () => document.body.classList.add('rv-page-active'));
    $(wrapper).on('hide', () => document.body.classList.remove('rv-page-active'));

    frappe.after_ajax(async () => {
        await dateInputReady;
        renderCards();
    });
};
