frappe.pages['saturation-status-da'].on_page_load = function (wrapper) {
    var page = frappe.ui.make_app_page({
        parent: wrapper,
        title: 'Saturation Status Dashboard',
        single_column: true
    });

    const LEVEL_STATE = "2";
    const LEVEL_DISTRICT = "3";
    const LEVEL_BLOCK = "4";

    const LEVEL_MAP = {
        "1": { key: "partner", label: "Partner" },
        "2": { key: "state", label: "State" },
        "3": { key: "district", label: "District" },
        "4": { key: "block", label: "Block" },
        "5": { key: "supervisor", label: "Creche Supervisor" },
        "6": { key: "gram_panchayat", label: "Gram Panchayat" },
        "7": { key: "creche", label: "Creche" },
        "8": { key: "village", label: "Village" }
    };

    const PASTEL_COLORS = [
        '#e57373', '#f06292', '#ba68c8', '#9575cd', '#7986cb', '#64b5f6',
        '#4fc3f7', '#4dd0e1', '#4db6ac', '#81c784', '#aed581', '#dce775',
        '#fff176', '#ffd54f', '#ffb74d', '#ff8a65', '#a1887f', '#e0e0e0', '#90a4ae',
        '#ff5252', '#ff4081', '#e040fb', '#7c4dff', '#536dfe', '#448aff',
        '#40c4ff', '#18ffff', '#64ffda', '#69f0ae', '#b2ff59', '#eeff41',
        '#ffd740', '#ffab40', '#ff6e40'
    ];

    const FONT_STACK = "'Calibri', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

    const MAP_LABEL_FONT_STACK =
        "'Inter', 'Segoe UI Variable Text', 'Segoe UI', -apple-system, BlinkMacSystemFont, " +
        "'Noto Sans', 'Source Sans Pro', 'Helvetica Neue', Arial, sans-serif";

    const LABEL_MIN_PX = 8;
    const LABEL_MAX_PX = 17;

    const ctx = {
        map: null,
        features: [],
        geoLayer: null,
        data: [],
        groupedData: {},
        groupKeys: [],
        stateNameToId: {},
        districtNameToId: {},
        blockNameToId: {},
        geoConfig: null,
        loadToken: 0,
        isLoading: false,
        resizeObserver: null,
        history: [],
        backControl: null,
        isolatedBlock: null,
        preIsolationView: null,
        crecheLayer: null,
        crecheRows: [],
        overlayMode: 'category',
        overlayToken: 0,
        overlayPromise: null,
        supervisorColors: null,
        isFullscreen: false,
        fullscreenControl: null,
        summaryPopoverOpen: false
    };

    const escapeHtml = (value) => String(value === null || value === undefined ? "" : value)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

    const legendRowHtml = (color, label) => `
        <div style="display: flex; align-items: center; margin-bottom: 5px;">
            <span style="display: inline-block; width: 16px; height: 16px; background-color: ${color}; margin-right: 8px; border-radius: 4px; border: 1px solid rgba(0,0,0,0.15);"></span>
            <span style="font-size: 12px; color: #1f2937;">${escapeHtml(label)}</span>
        </div>`;

    const textValue = (value) => {
        if (value === null || value === undefined) return "";
        if (typeof value === "string" || typeof value === "number") return String(value);
        if (typeof value === "object") {
            return textValue(value.value ?? value.label ?? value.name ?? value.id ?? "");
        }
        return "";
    };

    const cleanName = (value) => textValue(value).toLowerCase().replace(/[^a-z0-9]/g, "");

    const displayName = (value) => textValue(value).trim().toLowerCase()
        .replace(/\b[a-z]/g, letter => letter.toUpperCase());

    const fuzzyKey = (value) => {
        let key = cleanName(value);
        if (!key) return "";
        key = key.replace(/pore/g, "pur").replace(/poor/g, "pur");
        key = key.replace(/h/g, "");
        key = key.replace(/w/g, "v").replace(/y/g, "i");
        return key.replace(/(.)\1+/g, "$1");
    };

    const debounce = (fn, wait) => {
        let timer = null;
        return function (...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), wait);
        };
    };

    const getFieldValue = (name) => {
        const field = page.fields_dict[name];
        return field && typeof field.get_value === "function" ? textValue(field.get_value()) : "";
    };

    const getFieldLabel = (name) => {
        const field = page.fields_dict[name];
        if (!field) return "";
        const typed = field.$input ? textValue(field.$input.val()) : "";
        return typed || (typeof field.get_value === "function" ? textValue(field.get_value()) : "");
    };

    const filters = [
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
            default: new Date().getFullYear().toString()
        },
        {
            fieldname: "month",
            label: __("Month"),
            fieldtype: "Select",
            options: [
                { value: "1", label: __("January") }, { value: "2", label: __("February") },
                { value: "3", label: __("March") }, { value: "4", label: __("April") },
                { value: "5", label: __("May") }, { value: "6", label: __("June") },
                { value: "7", label: __("July") }, { value: "8", label: __("August") },
                { value: "9", label: __("September") }, { value: "10", label: __("October") },
                { value: "11", label: __("November") }, { value: "12", label: __("December") }
            ],
            default: (new Date().getMonth() + 1).toString()
        },
        {
            fieldname: "state",
            label: __("State"),
            fieldtype: "Link",
            options: "State",
            get_query: () => ({ filters: { is_active: 1 } })
        },
        {
            fieldname: "district",
            label: __("District"),
            fieldtype: "Link",
            options: "District",
            get_query: () => {
                const state = getFieldValue("state");
                const f = { is_active: 1 };
                if (state) f.state_id = state;
                return { filters: f };
            }
        },
        {
            fieldname: "block",
            label: __("Block"),
            fieldtype: "Link",
            options: "Block",
            get_query: () => {
                const district = getFieldValue("district");
                const f = {};
                if (district) f.district_id = district;
                if (blockHasIsActive) f.is_active = 1;
                return { filters: f };
            }
        },
        {
            fieldname: "level",
            label: __("Level"),
            fieldtype: "Select",
            options: [
                { value: "", label: __("Level") },
                { value: LEVEL_STATE, label: __("State") },
                { value: LEVEL_DISTRICT, label: __("District") },
                { value: LEVEL_BLOCK, label: __("Block") }
            ],
            default: LEVEL_STATE
        },
        {
            fieldname: "creche_status_id",
            label: __("Creche Status"),
            fieldtype: "Select",
            options: [
                { value: "", label: __("") },
                { value: "1", label: __("Planned") },
                { value: "2", label: __("Plan dropped") },
                { value: "3", label: __("Active/Operational") },
                { value: "4", label: __("Closed") }
            ],
            default: "3"
        }
    ];

    let blockHasIsActive = false;
    frappe.call({
        method: "frappe.apf.page.saturation_status_da.api_data.get_filter_meta",
        callback: (r) => { blockHasIsActive = !!(r.message && r.message.block_has_is_active); }
    });

    filters.forEach(f => page.add_field(f));

    const DEPENDENTS = {
        state: ["district", "block"],
        district: ["block"]
    };

    let suppressCascade = false;

    function clearDependents(fieldname) {
        const dependents = DEPENDENTS[fieldname];
        if (!dependents) return;
        dependents.forEach(name => {
            const field = page.fields_dict[name];
            if (field && field.get_value()) field.set_value("");
        });
    }

    ["state", "district"].forEach(fieldname => {
        const field = page.fields_dict[fieldname];
        if (!field || !field.$input) return;
        field.$input.on("change", () => {
            if (suppressCascade) return;
            clearDependents(fieldname);
        });
    });

    const searchBtn = page.add_button(__("Search"), () => runSearch());
    const resetBtn = page.add_button(__("Reset"), () => {
        resetBtn.prop('disabled', true);
        location.reload();
    });

    searchBtn.css({
        "background-color": "#5979aa", "color": "white", "border": "1px solid #5979aa",
        "border-radius": "4px", "padding": "5px 16px", "font-weight": "500", "font-size": "14px"
    });
    resetBtn.css({
        "background-color": "#f9fafb", "color": "#1f2937", "border": "1px solid #d1d5db",
        "border-radius": "4px", "padding": "5px 16px", "font-weight": "500", "font-size": "14px"
    });

    function runSearch() {
        if (ctx.isLoading) return;
        ctx.history = [];
        updateBackControl();
        searchBtn.text(__('Searching....')).prop('disabled', true);
        load_data(() => {
            searchBtn.text(__('Search')).prop('disabled', false);
        });
    }

    const downloadDropdown = $(`
        <div class="dropdown custom-dropdown" style="display:inline-block; position: relative;">
            <button class="btn btn-default btn-sm dropdown-toggle" type="button" style="background-color: #5979aa; color: white; border: 1px solid #5979aa; border-radius: 4px; padding: 5px 16px; font-weight: 500; font-size: 14px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center;">
                <span>${__("Download")}</span>
            </button>
            <div class="dropdown-menu" style="display: none; position: absolute; top: 100%; left: 0; background-color: white; border: 1px solid #ddd; border-radius: 4px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); z-index: 1000; min-width: 100%; margin-top: 0; padding: 5px 0;">
                <a href="#" class="dropdown-item" id="dl-png" style="display: block; padding: 8px 16px; color: #333; text-decoration: none; border-bottom: 1px solid #eee;">PNG</a>
                <a href="#" class="dropdown-item" id="dl-csv" style="display: block; padding: 8px 16px; color: #333; text-decoration: none;">CSV</a>
            </div>
        </div>
    `);
    page.page_actions.append(downloadDropdown);

    let hideTimeout;
    downloadDropdown.hover(
        function () {
            clearTimeout(hideTimeout);
            $(this).find('.dropdown-menu').show();
        },
        function () {
            const menu = $(this).find('.dropdown-menu');
            hideTimeout = setTimeout(() => menu.hide(), 150);
        }
    );
    downloadDropdown.find('.dropdown-item').hover(
        function () { $(this).css('background-color', '#f5f5f5'); },
        function () { $(this).css('background-color', 'white'); }
    );

    downloadDropdown.on('click', '#dl-csv', function (e) {
        e.preventDefault();
        $(this).closest('.dropdown-menu').hide();
        const toggleBtn = downloadDropdown.find('.dropdown-toggle');
        const mainBtn = toggleBtn.find('span');
        const originalText = mainBtn.text();
        mainBtn.text(__("Downloading..."));
        toggleBtn.prop('disabled', true);

        try {
            const label = (LEVEL_MAP[getFieldValue("level")] || {}).label || "";
            let csv = "Level,Name,No of Creche Centre,No of GP,No of Village\n";
            ctx.groupKeys.forEach(name => {
                const stats = ctx.groupedData[name];
                csv += `${label},"${String(name).replace(/"/g, '""')}",${stats.creches.size},${stats.gps.size},${stats.villages.size}\n`;
            });
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = "map_data.csv";
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        } finally {
            mainBtn.text(originalText);
            toggleBtn.prop('disabled', false);
        }
    });

    downloadDropdown.on('click', '#dl-png', function (e) {
        e.preventDefault();
        $(this).closest('.dropdown-menu').hide();
        const toggleBtn = downloadDropdown.find('.dropdown-toggle');
        const mainBtn = toggleBtn.find('span');
        const originalText = mainBtn.text();

        const mapNode = document.getElementById('export-map-container');
        if (!mapNode) return;
        if (!window.html2canvas) {
            frappe.msgprint(__("PNG Export library not loaded yet."));
            return;
        }

        mainBtn.text(__("Downloading..."));
        toggleBtn.prop('disabled', true);
        const restore = () => {
            mainBtn.text(originalText);
            toggleBtn.prop('disabled', false);
        };

        window.html2canvas(mapNode, { useCORS: true, logging: false }).then(canvas => {
            const link = document.createElement("a");
            link.download = "map_view.png";
            link.href = canvas.toDataURL("image/png");
            link.click();
            restore();
        }).catch(err => {
            frappe.msgprint(__("Error exporting map: ") + err);
            restore();
        });
    });

    const map_container = $('<div class="map-view-container" style="background-color: #f4f5f6; min-height: 500px;"></div>').appendTo(page.main);

    injectStyles();

    function injectStyles() {
        if (document.getElementById('map-label-style')) return;
        const style = document.createElement('style');
        style.id = 'map-label-style';
        style.textContent = `
            .leaflet-tooltip.map-label {
                background: transparent !important;
                border: none !important;
                box-shadow: none !important;
                font-family: ${MAP_LABEL_FONT_STACK} !important;
                font-size: 11px !important;
                padding: 0 !important;
                white-space: nowrap;
                text-shadow: none !important;

                -webkit-font-smoothing: antialiased;
                -moz-osx-font-smoothing: grayscale;
                text-rendering: optimizeLegibility;
                font-feature-settings: "kern" 1, "liga" 1;

                will-change: transform;
                backface-visibility: hidden;
            }

            .leaflet-tooltip.map-label.gp-label {
                font-size: 10px;
                font-weight: 600 !important;
                letter-spacing: 0.005em;
                line-height: 1.15;
                pointer-events: none;
                transition: font-size 120ms ease-out, opacity 120ms ease-out;
            }
            @media (prefers-reduced-motion: reduce) {
                .leaflet-tooltip.map-label.gp-label { transition: none; }
            }
            .leaflet-tooltip.map-label::before,
            .leaflet-tooltip-left.map-label::before,
            .leaflet-tooltip-right.map-label::before,
            .leaflet-tooltip-top.map-label::before,
            .leaflet-tooltip-bottom.map-label::before {
                display: none !important;
            }

            .leaflet-overlay-pane > svg {
                filter: drop-shadow(4px 5px 6px rgba(0,0,0,0.35));
            }
            .leaflet-container.leaflet-drag-target .leaflet-overlay-pane > svg,
            .leaflet-container.leaflet-zoom-anim .leaflet-overlay-pane > svg {
                filter: none;
            }
            .leaflet-overlay-pane svg path.boundary-shape {
                stroke-linejoin: round;
                stroke-linecap: round;
                shape-rendering: geometricPrecision;
            }
            .leaflet-container.map-busy { cursor: progress; }
            .ssd-back-control { margin-top: 8px !important; }
            .ssd-back-control a {
                font-family: ${FONT_STACK};
                color: #1f2937;
                text-decoration: none;
            }
            .ssd-back-control a:hover { background-color: #f4f4f4; }
            .ssd-refresh-control { margin-top: 8px !important; }
            .ssd-refresh-control a {
                font-family: ${FONT_STACK};
                color: #1f2937;
                text-decoration: none;
            }
            .ssd-refresh-control a:hover { background-color: #f4f4f4; }
            .ssd-refresh-control.ssd-refresh-spinning a {
                display: inline-block;
                animation: ssd-spin 0.7s linear infinite;
            }
            @media (prefers-reduced-motion: reduce) {
                .ssd-refresh-control.ssd-refresh-spinning a { animation-duration: 2s; }
            }
            .ssd-fullscreen-control { margin-top: 8px !important; }
            .ssd-fullscreen-control a {
                font-family: ${FONT_STACK};
                color: #1f2937;
                text-decoration: none;
            }
            .ssd-fullscreen-control a:hover { background-color: #f4f4f4; }

            .ssd-map-row.ssd-fullscreen {
                position: fixed; inset: 0; z-index: 1050;
                margin: 0; padding: 12px;
                background-color: #f4f6f8;
                overflow: auto;
            }
            .ssd-map-row.ssd-fullscreen .ssd-side-column { display: none; }
            .ssd-map-row.ssd-fullscreen #export-map-container {
                flex: 1 1 100%; max-width: none; height: 100%;
                display: flex; flex-direction: column; min-height: 0;
            }
            .ssd-map-row.ssd-fullscreen #leaflet-map {
                flex: 1 1 auto; height: auto !important; max-height: none !important;
                min-height: 0 !important;
            }

            .ssd-summary-fab {
                display: none;
                position: absolute; top: 64px; right: 15px; z-index: 1001;
                width: 38px; height: 38px; border-radius: 50%;
                background-color: #5979aa; color: #fff; border: 1px solid #46628a;
                box-shadow: 0 4px 10px -2px rgba(0,0,0,0.35);
                font-size: 16px; line-height: 1; cursor: pointer;
                align-items: center; justify-content: center;
                transition: background-color 0.15s ease, transform 0.15s ease;
            }
            .ssd-map-row.ssd-fullscreen .ssd-summary-fab { display: flex; }
            .ssd-summary-fab:hover { background-color: #46628a; }
            .ssd-summary-fab:active { transform: scale(0.94); }
            .ssd-summary-fab.is-active {
                background-color: #1f2937; border-color: #1f2937;
                transform: rotate(90deg);
            }
            .ssd-summary-fab.is-active:active { transform: rotate(90deg) scale(0.94); }
            @media (prefers-reduced-motion: reduce) {
                .ssd-summary-fab { transition: none; }
            }
            .ssd-summary-popover {
                display: none;
                position: absolute; top: 111px; right: 15px; z-index: 1000;
                width: 280px; max-width: calc(100vw - 40px);
                max-height: calc(100% - 80px);
                overflow-y: auto;
                opacity: 0; transform: translateY(-8px) scale(0.98);
                transition: opacity 0.18s ease, transform 0.18s ease;
                pointer-events: none;
            }
            .ssd-summary-popover.is-open {
                display: block;
                opacity: 1; transform: translateY(0) scale(1);
                pointer-events: auto;
            }
            @media (prefers-reduced-motion: reduce) {
                .ssd-summary-popover { transition: none; }
            }
            .ssd-summary-popover .ssd-card-summary {
                box-shadow: 0 10px 24px -6px rgba(0,0,0,0.28);
                max-height: 100%;
            }
            .ssd-summary-popover .ssd-scroll { max-height: calc(100vh - 180px); }
            @media (max-width: 600px) {
                .ssd-summary-popover { width: calc(100vw - 30px); right: 8px; top: 130px; }
                .ssd-summary-fab { top: 88px; right: 8px; }
            }
            .ssd-spinner {
                position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
                background: rgba(244,246,248,0.82); backdrop-filter: blur(2px);
                z-index: 1200; font-family: ${FONT_STACK};
                transition: opacity 0.2s ease; opacity: 1;
            }
            .ssd-spinner.ssd-fade-out { opacity: 0; pointer-events: none; }
            .ssd-spinner-card {
                display: flex; flex-direction: column; align-items: center; gap: 14px;
                padding: 26px 34px; background: #fff; border-radius: 10px;
                box-shadow: 0 10px 24px -6px rgba(0,0,0,0.18); border: 1px solid #e5e7eb;
            }
            .ssd-spinner-ring {
                width: 34px; height: 34px; border-radius: 50%;
                border: 3px solid #e5e7eb; border-top-color: #5979aa;
                animation: ssd-spin 0.7s linear infinite;
            }
            .ssd-spinner-text { font-size: 13px; font-weight: 600; color: #374151; }
            @keyframes ssd-spin { to { transform: rotate(360deg); } }
            @media (prefers-reduced-motion: reduce) {
                .ssd-spinner-ring { animation-duration: 2s; }
            }

            .ssd-card {
                border: 1px solid #e5e7eb; border-radius: 8px; background: #fff;
                box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); overflow: hidden;
                font-family: ${FONT_STACK};
            }
            .ssd-card-head {
                background: #5979aa; color: #fff; text-align: center; font-weight: 600;
                padding: 11px 12px; font-size: 13px; text-transform: uppercase;
                letter-spacing: 0.02em;
                flex: 0 0 auto;
            }
            .ssd-card-head-search {
                display: flex; align-items: center; justify-content: space-between;
                gap: 10px; text-align: left;
            }
            .ssd-head-search {
                flex: 0 1 130px; min-width: 90px;
                padding: 4px 9px; border-radius: 4px;
                border: 1px solid rgba(255,255,255,0.45);
                background: rgba(255,255,255,0.16); color: #fff;
                font-family: ${FONT_STACK}; font-size: 11px; font-weight: 500;
                outline: none; text-transform: none; letter-spacing: normal;
                transition: background-color 0.15s, border-color 0.15s;
            }
            .ssd-head-search::placeholder { color: rgba(255,255,255,0.75); }
            .ssd-head-search:focus {
                background: rgba(255,255,255,0.28); border-color: #fff;
            }
            .ssd-map-btn {
                padding: 5px 14px; border-radius: 4px;
                border: 1px solid #60a5fa; background: #eff6ff; color: #5979aa;
                font-family: ${FONT_STACK}; font-size: 12px; font-weight: 600;
                cursor: pointer; white-space: nowrap;
                transition: background-color 0.15s, color 0.15s;
            }
            .ssd-map-btn:hover { background: #dbeafe; }
            .ssd-map-btn.is-active {
                background: #1d4ed8; color: #fff; border-color: #1d4ed8;
            }

            .ssd-gp-loading {
                display: inline-flex; align-items: center; gap: 6px;
                padding: 4px 10px; border-radius: 4px;
                background: rgba(255,255,255,0.16); color: #fff;
                font-family: ${FONT_STACK}; font-size: 11px; font-weight: 600;
                white-space: nowrap;
            }
            .ssd-gp-loading-ring {
                width: 11px; height: 11px; border-radius: 50%; flex-shrink: 0;
                border: 2px solid rgba(255,255,255,0.4); border-top-color: #fff;
                animation: ssd-spin 0.7s linear infinite;
            }
            @media (prefers-reduced-motion: reduce) {
                .ssd-gp-loading-ring { animation-duration: 2s; }
            }
            .ssd-card-body { padding: 0; }
            .ssd-card-loading { padding: 18px; text-align: center; color: #6b7280; font-size: 12px; }
            .ssd-metric {
                display: flex; align-items: center; justify-content: space-between; gap: 10px;
                padding: 10px 14px; border-bottom: 1px solid #e8ebef;
                font-size: 13px; font-weight: 600; color: #1f2937;
            }
            .ssd-metric:last-child { border-bottom: none; }
            .ssd-metric-label { display: flex; align-items: center; gap: 8px; min-width: 0; }
            .ssd-swatch {
                width: 14px; height: 14px; border-radius: 3px; flex-shrink: 0;
                border: 1px solid rgba(0,0,0,0.18);
            }
            .ssd-metric-value { font-size: 15px; font-variant-numeric: tabular-nums; flex-shrink: 0; }
            .ssd-metric.ssd-total { background: #5979aa; color: #fff; }
            .ssd-metric.ssd-operational { background: #e8f1fb; }
            .ssd-metric.ssd-less { background: #fdf6d8; }
            .ssd-metric.ssd-scattered { background: #fdeada; }
            .ssd-metric.ssd-urban { background: #f2e8f8; }
            .ssd-metric.ssd-muted .ssd-metric-value { color: #9ca3af; font-weight: 500; }
            .ssd-metric-selectable { cursor: pointer; transition: box-shadow 0.12s, background-color 0.12s; }
            .ssd-metric-selectable:hover { box-shadow: inset 0 0 0 1px rgba(31,41,55,0.18); }
            .ssd-metric-selectable.is-selected { box-shadow: inset 0 0 0 2px #1f2937; }
            .ssd-card-section {
                padding: 7px 14px; background: #f3f4f6; color: #4b5563;
                font-size: 10px; font-weight: 700; text-transform: uppercase;
                letter-spacing: 0.05em; border-bottom: 1px solid #e5e7eb;
            }

            .ssd-side-column {
                display: flex; flex-direction: column; gap: 15px;
                height: calc(70vh + 44px);
                min-height: 444px;
                max-height: 844px;
            }
            .ssd-card { display: flex; flex-direction: column; min-height: 0; }
            .ssd-card-summary { flex: 0 0 auto; }
            .ssd-card-grow { flex: 1 1 auto; min-height: 0; }
            .ssd-scroll {
                overflow-y: auto;
                -webkit-overflow-scrolling: touch;
                overscroll-behavior: contain;
                scrollbar-width: thin;
            }
            .ssd-card-summary .ssd-scroll { max-height: 34vh; }
            .ssd-card-grow .ssd-scroll { flex: 1 1 auto; min-height: 0; }
            .ssd-scroll::-webkit-scrollbar { width: 8px; }
            .ssd-scroll::-webkit-scrollbar-track { background: #f3f4f6; }
            .ssd-scroll::-webkit-scrollbar-thumb { background: #c7cdd6; border-radius: 4px; }
            .ssd-scroll::-webkit-scrollbar-thumb:hover { background: #aab3c0; }

            .ssd-side-table {
                width: 100%; border-collapse: collapse; text-align: center;
                font-family: ${FONT_STACK}; font-size: 13px;
            }
            .ssd-side-table thead th {
                position: sticky; top: 0; z-index: 1;
                background: #f3f4f6; color: #374151; font-weight: 600; font-size: 11px;
                padding: 9px 10px; border: 1px solid #e5e7eb;
                box-shadow: inset 0 -2px 0 #e5e7eb;
            }
            .ssd-side-table td {
                padding: 9px 10px; border: 1px solid #e5e7eb; color: #1f2937;
                font-weight: 500;
            }
            .ssd-side-table tbody tr:hover { background: #eef2ff; }
            .ssd-side-table tbody tr[data-supervisor] { cursor: pointer; }
            .ssd-side-table tbody tr.is-selected { background: #dbe6f8; }
            .ssd-side-table tbody tr.is-selected td { font-weight: 700; }
            .ssd-sup-name {
                text-align: left; font-weight: 600;
                display: flex; align-items: center; gap: 7px;
            }

            @media (max-width: 768px) {

                .ssd-side-column { height: auto; max-height: none; max-width: none !important; }
                .ssd-card-summary .ssd-scroll { max-height: 300px; }
                .ssd-card-grow .ssd-scroll { max-height: 320px; }
            }
            .ssd-empty {
                display: flex; align-items: center; justify-content: center; height: 100%;
                font-family: ${FONT_STACK}; font-size: 14px; color: #6b7280;
            }
`;
        document.head.appendChild(style);
    }

    const OPTIONAL_ASSET_TIMEOUT = 8000;

    function requireOptional(url) {
        return new Promise((resolve) => {
            let settled = false;
            const done = () => {
                if (settled) return;
                settled = true;
                resolve();
            };

            setTimeout(done, OPTIONAL_ASSET_TIMEOUT);
            try {
                const pending = frappe.require([url], done);
                if (pending && typeof pending.catch === "function") pending.catch(done);
            } catch (e) {
                done();
            }
        });
    }

    function loadLeafletFallback() {
        if (typeof L !== "undefined") return Promise.resolve();
        return requireOptional("/assets/frappe/js/lib/leaflet/leaflet.js")
            .then(() => {
                if (typeof L === "undefined") {
                    return requireOptional("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js");
                }
            });
    }

    const librariesReady = loadLeafletFallback()
        .then(() => {
            requireOptional("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js");
            return typeof L !== "undefined";
        })
        .catch(() => typeof L !== "undefined");

    function collectValues() {
        const values = {};
        Object.keys(page.fields_dict).forEach(key => {
            const field = page.fields_dict[key];
            if (field && typeof field.get_value === "function") values[key] = field.get_value();
        });
        return values;
    }

    function load_data(callback, overrides) {
        if (ctx.isLoading) {
            if (typeof callback === 'function') callback();
            return;
        }
        const values = Object.assign(collectValues(), overrides || {});

        if (values.level === LEVEL_DISTRICT && !values.state) {
            frappe.show_alert({ message: __("Please select a State to view the District level map."), indicator: "orange" });
            if (typeof callback === 'function') callback();
            return;
        }
        if (values.level === LEVEL_BLOCK && !values.district) {
            frappe.show_alert({ message: __("Please select a District to view the Block level map."), indicator: "orange" });
            if (typeof callback === 'function') callback();
            return;
        }

        const token = ++ctx.loadToken;
        ctx.isLoading = true;
        showLoading();

        frappe.call({
            method: "frappe.apf.page.saturation_status_da.api_data.get_creche_master_data",
            args: {
                year: values.year,
                month: values.month,
                c_status: values.creche_status_id,
                state: values.state,
                district: values.district,
                block: values.block
            },
            callback: function (r) {
                if (token !== ctx.loadToken) return;
                ctx.isLoading = false;
                const rows = (r.message && r.message.data) || [];
                render_map_view(rows, values.level, values);
            },
            error: function () {
                if (token !== ctx.loadToken) return;
                ctx.isLoading = false;
                hideLoading();
            },
            always: function () {
                if (token === ctx.loadToken && typeof callback === 'function') callback();
            }
        });
    }

    function showLoading(message) {
        let el = document.getElementById('ssd-spinner');
        if (!el) {
            el = document.createElement('div');
            el.id = 'ssd-spinner';
            el.className = 'ssd-spinner';
            el.innerHTML = `
                <div class="ssd-spinner-card">
                    <div class="ssd-spinner-ring"></div>
                    <div class="ssd-spinner-text"></div>
                </div>`;
            map_container.get(0).appendChild(el);
        }
        el.querySelector('.ssd-spinner-text').textContent = message || __('Loading map...');
        el.classList.remove('ssd-fade-out');

        map_container.get(0).appendChild(el);
    }

    function hideLoading() {
        const el = document.getElementById('ssd-spinner');
        if (!el) return;
        el.classList.add('ssd-fade-out');
        setTimeout(() => {
            if (el.parentNode && el.classList.contains('ssd-fade-out')) {
                el.parentNode.removeChild(el);
            }
        }, 220);
    }

    function applyFilters(next) {
        suppressCascade = true;
        try {
            Object.keys(next).forEach(name => {
                const field = page.fields_dict[name];
                if (field) field.set_value(next[name] === null ? "" : next[name]);
            });
        } finally {
            setTimeout(() => { suppressCascade = false; }, 0);
        }
    }

    function currentView() {
        return {
            state: getFieldValue("state"),
            district: getFieldValue("district"),
            block: getFieldValue("block"),
            level: getFieldValue("level")
        };
    }

    const sameView = (a, b) => !!a && !!b
        && a.level === b.level && a.state === b.state
        && a.district === b.district && a.block === b.block;

    function navigate(next, { remember = true } = {}) {
        if (remember) {
            const from = currentView();
            if (!sameView(from, next)) ctx.history.push(from);
        }
        applyFilters(next);
        load_data(null, next);
        updateBackControl();
    }

    function goBack() {
        if (ctx.isolatedBlock) {
            clearBlockIsolation();
            return;
        }
        const previous = ctx.history.pop();
        updateBackControl();
        if (!previous) return;
        navigate(previous, { remember: false });
    }

    function drillToDistrictView(stateName) {
        const stateId = ctx.stateNameToId[stateName] || stateName;
        navigate({ state: stateId, district: "", block: "", level: LEVEL_DISTRICT });
    }

    function drillToBlockView(districtName) {
        const districtId = ctx.districtNameToId[districtName] || districtName;
        const stateId = getFieldValue("state");
        navigate({ state: stateId, district: districtId, block: "", level: LEVEL_BLOCK });
    }

    const GP_SERVICE_URL =
        "https://mapservice.gov.in/mapserviceserv176/rest/services" +
        "/Panchayat/AdminGPHierarchy/MapServer/3/query";

    const GP_OUT_FIELDS = "GPNAME,GPCODE,STNAME,DTNAME,SDTNAME,blkname,blklgdcode,VILCODE11,VILNAME11";

    const GP_SIMPLIFY = "0.00005";

    const gpCleanBlockName = (name) => stripBlockSuffix(String(name || ""))
        .replace(/-\s*\d+\s*$/, "")
        .trim();

    const gpQuote = (value) => String(value || "").replace(/'/g, "''");

    const districtRowsCache = new Map();

    const GP_PAGE_SIZE = 2000;
    const GP_PARALLEL_PAGES = 4;

    function fetchDistrictRows(state, district) {
        const key = `${cleanName(state)}|${cleanName(district)}`;
        if (districtRowsCache.has(key)) return districtRowsCache.get(key);

        const clauses = [];
        if (district) clauses.push(`UPPER(DTNAME) LIKE '%${gpQuote(district).toUpperCase()}%'`);
        if (state) clauses.push(`UPPER(STNAME) LIKE '%${gpQuote(state).toUpperCase()}%'`);
        if (!clauses.length) return Promise.resolve([]);

        const params = new URLSearchParams({
            where: clauses.join(" AND "),
            outFields: GP_OUT_FIELDS,
            returnGeometry: "true",
            outSR: "4326",
            maxAllowableOffset: GP_SIMPLIFY,
            geometryPrecision: "6",
            f: "geojson"
        });

        const fetchOnePage = (offset) => {
            const pageParams = new URLSearchParams(params);
            pageParams.set('resultOffset', String(offset));
            pageParams.set('resultRecordCount', String(GP_PAGE_SIZE));
            return fetch(`${GP_SERVICE_URL}?${pageParams.toString()}`)
                .then(res => (res.ok ? res.json() : null));
        };

        const fetchAllPages = (offset, collected) => {
            return fetchOnePage(offset).then(data => {
                const page = (data && data.features) || [];
                const full = page.length > 0 && (page.length === GP_PAGE_SIZE || (data && data.exceededTransferLimit));
                if (!full) return collected.concat(page);

                const parallelOffsets = [];
                for (let i = 1; i <= GP_PARALLEL_PAGES; i++) {
                    parallelOffsets.push(offset + page.length * i);
                }
                return Promise.all(parallelOffsets.map(fetchOnePage)).then(results => {
                    let all = collected.concat(page);
                    let lastFull = full;
                    for (let i = 0; i < results.length; i++) {
                        const nextPage = (results[i] && results[i].features) || [];
                        all = all.concat(nextPage);
                        lastFull = nextPage.length > 0
                            && (nextPage.length === GP_PAGE_SIZE || (results[i] && results[i].exceededTransferLimit));
                        if (!lastFull) return all;
                    }
                    return fetchAllPages(offset + page.length * (GP_PARALLEL_PAGES + 1), all);
                });
            });
        };

        const promise = fetchAllPages(0, [])
            .catch(err => {
                console.warn("[SSD] GP boundary fetch failed for district", district, err);
                return [];
            });

        districtRowsCache.set(key, promise);

        promise.then(rows => {
            if (!rows.length) districtRowsCache.delete(key);
        });
        return promise;
    }

    const BLOCK_SERVICE_URL =
        "https://mapservice.gov.in/mapserviceserv176/rest/services" +
        "/Panchayat/AdminGPHierarchy/MapServer/2/query";

    const BLOCK_OUT_FIELDS = "block_name,district,state,block_lgd,Dist_LGD";

    const districtBlockRowsCache = new Map();

    function fetchDistrictBlockRows(state, district) {
        const key = `${cleanName(state)}|${cleanName(district)}`;
        if (districtBlockRowsCache.has(key)) return districtBlockRowsCache.get(key);

        const clauses = [];
        if (district) clauses.push(`UPPER(district) LIKE '%${gpQuote(district).toUpperCase()}%'`);
        if (state) clauses.push(`UPPER(state) LIKE '%${gpQuote(state).toUpperCase()}%'`);
        if (!clauses.length) return Promise.resolve([]);

        const params = new URLSearchParams({
            where: clauses.join(" AND "),
            outFields: BLOCK_OUT_FIELDS,
            returnGeometry: "true",
            outSR: "4326",
            maxAllowableOffset: GP_SIMPLIFY,
            geometryPrecision: "6",
            f: "geojson"
        });

        const promise = fetch(`${BLOCK_SERVICE_URL}?${params.toString()}`)
            .then(res => (res.ok ? res.json() : null))
            .then(data => (data && data.features) || [])
            .catch(err => {
                console.warn("[SSD] Block boundary fetch failed for district", district, err);
                return [];
            });

        districtBlockRowsCache.set(key, promise);
        promise.then(rows => {
            if (!rows.length) districtBlockRowsCache.delete(key);
        });
        return promise;
    }

    function findBlockRow(blockRows, blockName) {
        const blockKey = cleanName(gpCleanBlockName(blockName));
        if (!blockKey) return null;

        let best = null;
        for (let i = 0; i < blockRows.length; i++) {
            const row = blockRows[i];
            const props = row.properties || {};
            const cand = cleanName(gpCleanBlockName(props.block_name || ""));
            if (!cand) continue;
            if (cand === blockKey) return row;
            if (!best && cand.length > 4 && blockKey.length > 4 &&
                (cand.indexOf(blockKey) >= 0 || blockKey.indexOf(cand) >= 0)) {
                best = row;
            }
        }
        return best;
    }

    function gpRowInBlock(props, blockKey) {
        if (!blockKey) return false;
        const candidates = [props.blkname, props.SDTNAME];
        for (let i = 0; i < candidates.length; i++) {
            const raw = candidates[i];
            if (!raw) continue;
            const cand = cleanName(gpCleanBlockName(raw));
            if (!cand) continue;
            if (cand === blockKey) return true;
            if (cand.length > 4 && blockKey.length > 4 &&
                (cand.indexOf(blockKey) >= 0 || blockKey.indexOf(cand) >= 0)) return true;
        }
        return false;
    }

    function gpGeomCentroid(geometry) {
        if (!geometry || !geometry.coordinates) return null;
        const depth = { Polygon: 2, MultiPolygon: 3 }[geometry.type];
        if (depth === undefined) return null;

        let x = 0, y = 0, count = 0;
        (function walk(node, level) {
            if (level === 0) {
                if (node.length >= 2 && isFinite(node[0]) && isFinite(node[1])) {
                    x += node[0]; y += node[1]; count++;
                }
                return;
            }
            node.forEach(child => walk(child, level - 1));
        })(geometry.coordinates, depth);

        return count ? [x / count, y / count] : null;
    }

    function gpPointInRing(point, ring) {
        const [x, y] = point;
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const xi = ring[i][0], yi = ring[i][1];
            const xj = ring[j][0], yj = ring[j][1];
            if ((yi > y) !== (yj > y)) {
                const denom = (yj - yi) || 1e-12;
                if (x < (xj - xi) * (y - yi) / denom + xi) inside = !inside;
            }
        }
        return inside;
    }

    function gpOuterRings(geometry) {
        if (!geometry || !geometry.coordinates) return [];
        if (geometry.type === 'Polygon') return geometry.coordinates.length ? [geometry.coordinates[0]] : [];
        if (geometry.type === 'MultiPolygon') return geometry.coordinates.map(poly => poly[0]).filter(Boolean);
        return [];
    }

    function gpInsideBlockGeometry(geometry, clipGeometry) {
        if (!clipGeometry) return true;
        const centroid = gpGeomCentroid(geometry);
        if (!centroid) return true;
        const rings = gpOuterRings(clipGeometry);
        if (!rings.length) return true;
        return rings.some(ring => gpPointInRing(centroid, ring));
    }

    const blockRowsCache = new Map();

    function fetchBlockRows(state, district, block, clipGeometry) {
        const key = `${cleanName(state)}|${cleanName(district)}|${cleanName(block)}`;
        if (blockRowsCache.has(key)) return blockRowsCache.get(key);

        const blockName = gpCleanBlockName(block);
        if (!blockName) return Promise.resolve(null);
        const blockKey = cleanName(blockName);

        const promise = Promise.all([
            fetchDistrictRows(state, district),
            fetchDistrictBlockRows(state, district)
        ]).then(([gpRows, blockRows]) => {
            const blockRow = findBlockRow(blockRows, blockName);
            const blockLgd = blockRow && blockRow.properties
                ? String(blockRow.properties.block_lgd || "").trim() : "";
            const blockGeometry = blockRow ? blockRow.geometry : clipGeometry;

            const namedMatches = gpRows.filter(f => {
                const props = f.properties || {};
                return gpRowInBlock(props, blockKey)
                    && gpInsideBlockGeometry(f.geometry, blockGeometry);
            });

            const codeMatches = blockLgd
                ? namedMatches.filter(f => String((f.properties || {}).blklgdcode || '').trim() === blockLgd)
                : [];
            const mine = codeMatches.length ? codeMatches : namedMatches;

            return { rows: mine, blockRow: blockRow || null, matchedByLgd: codeMatches.length > 0 };
        });

        blockRowsCache.set(key, promise);
        promise.then(result => {
            if (!result || !result.rows.length) blockRowsCache.delete(key);
        });
        return promise;
    }

    function mergeBoundaryFeatures(rows, blockName, { nameField, idOf, outNameKey, outKeyKey, countKey }) {
        const merged = new Map();

        (rows || []).forEach(feature => {
            const props = feature.properties || {};
            const name = (props[nameField] || "").trim();
            if (!name) return;

            const geometry = feature.geometry;
            if (!geometry || !geometry.coordinates) return;

            const id = idOf(props, name);
            let entry = merged.get(id);
            if (!entry) {
                entry = { name, props, polygons: [] };
                merged.set(id, entry);
            }
            if (geometry.type === "Polygon") {
                entry.polygons.push(geometry.coordinates);
            } else if (geometry.type === "MultiPolygon") {
                geometry.coordinates.forEach(poly => entry.polygons.push(poly));
            }
        });

        const out = [];
        merged.forEach(entry => {
            if (!entry.polygons.length) return;
            out.push({
                type: "Feature",
                properties: Object.assign({}, entry.props, {
                    [outNameKey]: displayName(entry.name),
                    [outKeyKey]: cleanName(entry.name),
                    _parts: entry.polygons.length
                }),
                geometry: entry.polygons.length === 1
                    ? { type: "Polygon", coordinates: entry.polygons[0] }
                    : { type: "MultiPolygon", coordinates: entry.polygons }
            });
        });

        return {
            type: "FeatureCollection",
            features: out,
            _meta: { block: blockName, rows: (rows || []).length, [countKey]: out.length }
        };
    }

    function mergeGPFeatures(data, blockName) {
        return mergeBoundaryFeatures((data && data.features) || [], blockName, {
            nameField: "GPNAME",
            idOf: (props, name) => props.GPCODE || cleanName(name),
            outNameKey: "_gpName",
            outKeyKey: "_gpKey",
            countKey: "gps"
        });
    }

    function fetchBoundaryFeatures(cache, mergeFn, state, district, block, clipGeometry) {
        const key = `${cleanName(state)}|${cleanName(district)}|${cleanName(block)}`;
        if (cache.has(key)) return cache.get(key);

        const blockName = gpCleanBlockName(block);
        const promise = fetchBlockRows(state, district, block, clipGeometry).then(result => {
            if (!result) return null;
            const collection = mergeFn(result.rows, blockName);
            collection._meta.blockFeature = result.blockRow;
            collection._meta.matchedByLgd = result.matchedByLgd;
            return collection;
        });

        cache.set(key, promise);
        promise.then(collection => {
            if (!collection || !collection.features.length) cache.delete(key);
        });
        return promise;
    }

    const gpBoundaryCache = new Map();

    function fetchGPBoundaries(state, district, block, clipGeometry) {
        return fetchBoundaryFeatures(
            gpBoundaryCache,
            (rows, blockName) => mergeGPFeatures({ features: rows }, blockName),
            state, district, block, clipGeometry
        );
    }

    const SITE_FIELD = { gp: 'gram_panchayat' };

    function aggregateSites(rows) {
        const field = SITE_FIELD.gp;
        const bySite = new Map();
        rows.forEach(row => {
            const name = (row[field] || '').trim();
            if (!name) return;

            const key = cleanName(name);
            let entry = bySite.get(key);
            if (!entry) {
                entry = {
                    name,
                    creches: new Set(),
                    operationalCreches: new Set(),
                    supervisors: new Map(),
                    scatteredGP: false,
                    urbanGP: false,
                    villageCategories: new Set()
                };
                bySite.set(key, entry);
            }
            if (row.creche_id) {
                entry.creches.add(row.creche_id);
                if (row.is_operational) entry.operationalCreches.add(row.creche_id);
            }
            const supervisor = row.supervisor || 'Unassigned';
            entry.supervisors.set(supervisor, (entry.supervisors.get(supervisor) || 0) + 1);
            if (row.scattered_gp) entry.scatteredGP = true;
            if (row.urban_gp) entry.urbanGP = true;
            if (row.village_category) entry.villageCategories.add(row.village_category);
        });

        const stats = new Map();
        bySite.forEach((entry, key) => {
            stats.set(key, {
                name: displayName(entry.name),
                creches: entry.creches.size,
                operationalCreches: entry.operationalCreches.size,

                dominantCategory: (() => {
                    if (entry.operationalCreches.size > 0) return 'operational';
                    if (entry.scatteredGP) return 'scattered';
                    if (entry.urbanGP) return 'urban';
                    return null;
                })(),
                dominantSupervisor: Array.from(entry.supervisors.entries())
                    .sort((a, b) => b[1] - a[1])[0][0],
                villageCategories: entry.villageCategories,
                hasData: true
            });
        });
        return stats;
    }

    const SUPERVISOR_COLORS = [
        '#1878c8', '#f0913f', '#7ac143', '#b57edc', '#00b3b3', '#e8547c',
        '#ffd400', '#5b6abf', '#e2725b', '#3aa76d', '#c96ec9', '#8d6e63'
    ];

    let crechePointsPromise = null;
    let crechePointsKey = "";

    function loadCrechePoints(values) {
        const key = [values.year, values.month, values.state, values.district,
                     values.block, values.partner, values.creche_status_id].join('|');
        if (crechePointsPromise && crechePointsKey === key) return crechePointsPromise;
        crechePointsKey = key;
        crechePointsPromise = new Promise((resolve) => {
            frappe.call({
                method: "frappe.apf.page.saturation_status_da.api_data.get_creche_points",
                args: {
                    year: values.year,
                    month: values.month,
                    state: values.state || "",
                    district: values.district || "",
                    block: values.block || "",
                    partner: values.partner || "",
                    c_status: values.creche_status_id || ""
                },
                callback: (r) => resolve((r.message && r.message.data) || []),
                error: () => resolve([])
            });
        });
        return crechePointsPromise;
    }

    let gpVillageStatusPromise = null;
    let gpVillageStatusKey = "";

    function loadGpVillageStatus(scope) {
        const key = [scope && scope.stateId, scope && scope.districtId, scope && scope.blockId].join('|');
        if (gpVillageStatusPromise && gpVillageStatusKey === key) return gpVillageStatusPromise;
        gpVillageStatusKey = key;
        gpVillageStatusPromise = new Promise((resolve) => {
            frappe.call({
                method: "frappe.apf.page.saturation_status_da.api_data.get_gp_village_status",
                args: {
                    state: (scope && scope.stateId) || "",
                    district: (scope && scope.districtId) || "",
                    block: (scope && scope.blockId) || ""
                },
                callback: (r) => resolve(r.message || { gps: [], villages: [] }),
                error: () => resolve({ gps: [], villages: [] })
            });
        });
        return gpVillageStatusPromise;
    }

    function buildStatusNameIndex(rows, idField, nameField) {
        const exact = new Map();
        const fuzzy = new Map();
        rows.forEach(row => {
            [row[nameField], row.name, row[idField]].forEach(candidate => {
                if (!candidate) return;
                const exactKey = cleanName(candidate);
                if (exactKey) {
                    if (!exact.has(exactKey)) exact.set(exactKey, new Set());
                    exact.get(exactKey).add(row);
                }
                const fuzzyKeyVal = fuzzyKey(candidate);
                if (fuzzyKeyVal) {
                    if (!fuzzy.has(fuzzyKeyVal)) fuzzy.set(fuzzyKeyVal, new Set());
                    fuzzy.get(fuzzyKeyVal).add(row);
                }
            });
        });
        return { exact, fuzzy, rows, matched: new Set() };
    }

    function lookupStatusFlags(index, name) {
        if (!name) return null;
        const exactKey = cleanName(name);
        if (exactKey && index.exact.has(exactKey)) {
            return mergeStatusFlags(index.exact.get(exactKey), index);
        }
        const fuzzyKeyVal = fuzzyKey(name);
        if (fuzzyKeyVal && index.fuzzy.has(fuzzyKeyVal)) {
            return mergeStatusFlags(index.fuzzy.get(fuzzyKeyVal), index);
        }

        if (fuzzyKeyVal && fuzzyKeyVal.length >= 4) {
            let found = null;
            const matches = new Set();
            index.fuzzy.forEach((flags, key) => {
                if (key.length < 4) return;
                if (key.indexOf(fuzzyKeyVal) !== -1 || fuzzyKeyVal.indexOf(key) !== -1) {
                    flags.forEach(row => matches.add(row));
                }
            });
            if (matches.size === 1) {
                found = mergeStatusFlags(matches, index);
                return found;
            }
        }
        return null;
    }

    const STATUS_ID_KEYS = new Set(['name', 'gp_id', 'village_id', 'gp_name', 'village_name']);

    function mergeStatusFlags(rows, index) {
        const merged = {};
        rows.forEach(row => {
            Object.keys(row).forEach(key => {
                if (!STATUS_ID_KEYS.has(key)) {
                    merged[key] = merged[key] || !!row[key];
                }
            });
            index.matched.add(row);
        });
        return merged;
    }

    const looksLikeUsableName = (value) => !!value && !/^[0-9\s.-]+$/.test(String(value));

    function unmatchedStatusNames(index, idField, nameField, flag) {
        const names = [];
        index.rows.forEach(row => {
            if (!row[flag]) return;
            if (index.matched.has(row)) return;
            const best = looksLikeUsableName(row[nameField]) ? row[nameField]
                : looksLikeUsableName(row[idField]) ? row[idField]
                : (row.name || row[idField] || row[nameField] || '?');
            names.push(best);
        });
        return names;
    }

    const METRIC_FLAG_MAP = {
        gp: {
            operational: { flag: 'is_operational', idField: 'gp_id', nameField: 'gp_name' },
            scattered: { flag: 'scattered_gp', idField: 'gp_id', nameField: 'gp_name' },
            urban: { flag: 'urban_gp', idField: 'gp_id', nameField: 'gp_name' }
        },
        village: {
            operational: { flag: 'is_operational', idField: 'village_id', nameField: 'village_name' },
            scattered: { flag: 'scattered_village', idField: 'village_id', nameField: 'village_name' },
            lessChildren: { flag: 'less_children_village', idField: 'village_id', nameField: 'village_name' }
        }
    };

    function unmatchedGpVillageNames(kind, category) {
        const mapping = (METRIC_FLAG_MAP[kind] || {})[category];
        const index = kind === 'village' ? ctx.villageStatusIndex : ctx.gpStatusIndex;
        if (!mapping || !index) return [];
        return unmatchedStatusNames(index, mapping.idField, mapping.nameField, mapping.flag)
            .map(value => looksLikeUsableName(value) ? displayName(value) : value);
    }

    function siteCellPopup(site, colorLabel) {
        return `
            <div style="font-family: ${FONT_STACK}; min-width: 170px;">
                <div style="font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #9ca3af; margin-bottom: 2px;">
                    ${__("Gram Panchayat")}
                </div>
                <div style="font-weight: 600; font-size: 13px; margin-bottom: 6px; color: #1f2937; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px;">
                    ${escapeHtml(site.name)}
                </div>
                <div style="font-size: 12px; color: #4b5563; line-height: 1.6;">
                    <div><b>${__("Operational Creches")}:</b> ${site.operationalCreches}</div>
                    <div><b>${__("Total Creches")}:</b> ${site.creches}</div>
                    <div><b>${__("Supervisor")}:</b> ${escapeHtml(site.dominantSupervisor)}</div>
                    <div style="margin-top: 4px; color: #6b7280;">${escapeHtml(colorLabel)}</div>
                </div>
            </div>`;
    }

    const CATEGORY_LABELS = {
        operational: "Operational",
        lessChildren: "Less Children",
        scattered: "Scattered",
        urban: "Urban"
    };

    const NO_DATA_COLOR = '#e2e8f0';
    const BLOCK_GAP_COLOR = '#d1d8dd';

    function geoJsonToLatLngs(geometry) {
        if (!geometry || !geometry.coordinates) return [];
        const ring = (coords) => coords
            .filter(pt => Array.isArray(pt) && pt.length >= 2 &&
                          isFinite(pt[0]) && isFinite(pt[1]))
            .map(pt => [pt[1], pt[0]]);

        if (geometry.type === 'Polygon') {
            const rings = geometry.coordinates.map(ring).filter(r => r.length >= 3);
            return rings.length ? rings : [];
        }
        if (geometry.type === 'MultiPolygon') {
            return geometry.coordinates
                .map(poly => poly.map(ring).filter(r => r.length >= 3))
                .filter(poly => poly.length);
        }
        return [];
    }

    function emptySiteStats(name) {
        return {
            name: name,
            creches: 0,
            operationalCreches: 0,
            icds: 0,
            dominantCategory: null,
            dominantSupervisor: '—',
            scatteredGP: false,
            urbanGP: false,
            villageCategories: new Set(),
            hasData: false
        };
    }

    function buildSiteCellLayers(rows, mode, supervisorColor, gpGeoJSON, statusRows) {
        const features = (gpGeoJSON && gpGeoJSON.features) || [];
        if (!features.length) return [];

        const statsByGP = aggregateSites(rows || []);
        const statusIndex = buildStatusNameIndex((statusRows && statusRows.gps) || [], 'gp_id', 'gp_name');
        ctx.gpStatusIndex = statusIndex;
        ctx.villageStatusIndex = buildStatusNameIndex((statusRows && statusRows.villages) || [], 'village_id', 'village_name');
        const layers = [];

        features.forEach(feature => {
            const props = feature.properties || {};
            const gpName = displayName(props._gpName || props.GPNAME || '');
            if (!gpName) return;

            const key = props._gpKey || cleanName(gpName);
            const site = statsByGP.get(key)
                || statsByGP.get(cleanName(gpName))
                || emptySiteStats(gpName);

            const dbFlags = lookupStatusFlags(statusIndex, gpName);
            const isOperational = site.operationalCreches > 0 || (dbFlags && dbFlags.is_operational);
            const isScattered = site.scatteredGP || (dbFlags && dbFlags.scattered_gp);
            const isUrban = site.urbanGP || (dbFlags && dbFlags.urban_gp);

            const statusCategories = new Set();
            if (isOperational) statusCategories.add('operational');
            if (isScattered) statusCategories.add('scattered');
            if (isUrban) statusCategories.add('urban');

            const dominantCategory = isOperational ? 'operational'
                : (isScattered ? 'scattered' : (isUrban ? 'urban' : null));

            const color = dominantCategory === null
                ? NO_DATA_COLOR
                : (mode === 'supervisor'
                    ? (supervisorColor.get(site.dominantSupervisor) || '#94a3b8')
                    : (CATEGORY_COLORS[dominantCategory] || NO_DATA_COLOR));

            const label = dominantCategory === null
                ? __("No Data")
                : (mode === 'supervisor'
                    ? `${__("Supervisor")}: ${site.dominantSupervisor}`
                    : (CATEGORY_LABELS[dominantCategory] || ''));

            const latlngs = geoJsonToLatLngs(feature.geometry);
            if (!latlngs.length) return;
            const polygon = L.polygon(latlngs, {
                fillColor: color,
                color: '#1f2937',
                weight: 1.1,
                opacity: 1,
                fillOpacity: 0.9
            });

            const hasData = site.hasData || dominantCategory !== null;

            polygon.bindPopup(siteCellPopup(site, label), { autoPan: false });
            const labelStyle = hasData
                ? 'color:#ffffff; text-shadow: 0 1px 2px rgba(0,0,0,0.95), 0 0 3px rgba(0,0,0,0.95);'
                : 'color:#334155; text-shadow: 0 1px 2px rgba(255,255,255,0.95), 0 0 3px rgba(255,255,255,0.95);';
            polygon.bindTooltip(
                `<span style="${labelStyle}">${escapeHtml(gpName)}</span>`,
                { permanent: true, direction: 'center', className: 'map-label gp-label' }
            );

            polygon.supervisorName = site.dominantSupervisor;
            polygon.gpName = gpName;
            polygon.hasData = hasData;
            polygon.gpCategory = dominantCategory;
            polygon.statusCategories = statusCategories;
            polygon.villageCategories = site.villageCategories || new Set();
            polygon._ssdBaseStyle = { fillColor: color, color: '#1f2937', weight: 1.1, fillOpacity: 0.9 };
            layers.push(polygon);
        });

        return layers;
    }

    function bindGPLabelVisibility(map, group) {
        let lastZoom = null;
        const apply = (force) => {
            if (ctx.crecheLayer !== group) {
                map.off('zoomend', onZoom);
                map.off('moveend', onMove);
                return;
            }
            const zoom = map.getZoom();
            if (!force && zoom === lastZoom) return;
            lastZoom = zoom;
            updateGPLabelVisibility(map, group);
        };
        const onZoom = () => apply(true);
        const onMove = () => apply(false);

        setTimeout(() => apply(true), 0);
        map.on('zoomend', onZoom);
        map.on('moveend', onMove);
    }

    const AVG_GLYPH_EM = 0.55;
    const LABEL_FIT_MARGIN = 0.88;
    const LABEL_LINE_HEIGHT = 1.15;

    function sizeLabelToPolygon(entry) {
        const { el, width, height, area } = entry;
        if (!el) return;
        if (!area || !isFinite(area)) {
            el.style.fontSize = LABEL_MIN_PX + 'px';
            return;
        }

        const byArea = Math.sqrt(area) / 9;

        let metrics = el._ssdTextMetrics;
        if (metrics === undefined) {
            const lines = (el.innerHTML || '')
                .split(/<br\s*\/?>/i)
                .map(part => part.replace(/<[^>]*>/g, '').trim())
                .filter(part => part.length);
            metrics = {
                chars: lines.reduce((longest, l) => Math.max(longest, l.length), 0) || 1,
                lines: Math.max(lines.length, 1)
            };
            el._ssdTextMetrics = metrics;
        }
        const byWidth = (width * LABEL_FIT_MARGIN) / (metrics.chars * AVG_GLYPH_EM);
        const byHeight = (height * LABEL_FIT_MARGIN) / (metrics.lines * LABEL_LINE_HEIGHT);

        const size = Math.max(
            LABEL_MIN_PX,
            Math.min(LABEL_MAX_PX, byArea, byWidth, byHeight)
        );

        const px = Math.round(size * 2) / 2;
        if (el._ssdFontPx !== px) {
            el._ssdFontPx = px;
            el.style.fontSize = px + 'px';
        }
    }

    function updateGPLabelVisibility(map, group) {
        if (!map || !group) return;

        const pane = map.getPane('tooltipPane');
        if (!pane) return;

        const origin = pane.getBoundingClientRect();

        const entries = [];
        group.eachLayer(layer => {
            const tooltip = layer.getTooltip && layer.getTooltip();
            if (!tooltip) return;
            const el = tooltip.getElement && tooltip.getElement();
            if (!el) return;

            el.style.display = '';

            let area = 0, width = 0, height = 0;
            try {
                const b = layer.getBounds();
                const nw = map.latLngToLayerPoint(b.getNorthWest());
                const se = map.latLngToLayerPoint(b.getSouthEast());
                width = Math.abs(se.x - nw.x);
                height = Math.abs(se.y - nw.y);
                area = width * height;
            } catch (e) {  }

            entries.push({ el, layer, area, width, height });
        });

        if (!entries.length) return;

        entries.forEach(sizeLabelToPolygon);

        entries.forEach(entry => {
            const r = entry.el.getBoundingClientRect();
            entry.box = [
                r.left - origin.left,
                r.top - origin.top,
                r.right - origin.left,
                r.bottom - origin.top
            ];
        });

        entries.sort((a, b) => b.area - a.area);

        const GAP = 2;
        const placed = [];
        entries.forEach(entry => {
            const [x1, y1, x2, y2] = entry.box;

            if (x2 - x1 <= 0 || y2 - y1 <= 0) {
                entry.el.style.display = 'none';
                return;
            }
            const clash = placed.some(pb =>
                !(x2 + GAP < pb[0] || x1 - GAP > pb[2] ||
                  y2 + GAP < pb[1] || y1 - GAP > pb[3])
            );
            if (clash) {
                entry.el.style.display = 'none';
                return;
            }
            placed.push(entry.box);
            entry.el.style.display = '';
        });
    }

    function buildSupervisorColorMap(rows) {
        const supervisors = Array.from(new Set(
            rows.map(r => r.supervisor || 'Unassigned')
        )).sort();
        const supervisorColor = new Map();
        supervisors.forEach((name, idx) => {
            supervisorColor.set(name, SUPERVISOR_COLORS[idx % SUPERVISOR_COLORS.length]);
        });
        return supervisorColor;
    }

    function gpScope(blockName) {
        const values = collectValues();
        return {
            state: getFieldLabel("state") || values.state || "",
            district: getFieldLabel("district") || values.district || "",
            block: blockName || "",
            stateId: values.state || "",
            districtId: values.district || "",
            blockId: (blockName && ctx.blockNameToId[blockName]) || values.block || ""
        };
    }

    function showGPLoading() {
        const el = document.getElementById('map-gp-loading');
        if (!el) return;
        const label = el.querySelector('span:last-child');
        if (label) {
            label.textContent = __("Loading GP boundaries...");
        }
        el.style.display = 'inline-flex';
    }

    function hideGPLoading(token) {
        if (token !== ctx.overlayToken) return;
        const el = document.getElementById('map-gp-loading');
        if (el) el.style.display = 'none';
    }

    const OVERLAY_EMPTY = { empty: true, supervisors: [], supervisorColor: new Map() };

    function renderSiteOverlay(map, blockLayer, rows, mode, scope) {
        if (ctx.crecheLayer) {
            map.removeLayer(ctx.crecheLayer);
            ctx.crecheLayer = null;
        }
        if (!blockLayer) return Promise.resolve(null);

        const token = ++ctx.overlayToken;
        const blockName = scope && scope.block ? scope.block : (blockLayer.featureName || '');
        showGPLoading();

        return Promise.all([
            fetchGPBoundaries(
                (scope && scope.state) || '',
                (scope && scope.district) || '',
                blockName,
                blockLayer.feature ? blockLayer.feature.geometry : null
            ).catch(err => {
                console.warn(`[SSD] gp boundary fetch failed for block`, blockName, err);
                return null;
            }),
            loadGpVillageStatus(scope).catch(() => ({ gps: [], villages: [] }))
        ]).then(([geoJSON, statusRows]) => {
            if (token !== ctx.overlayToken) return null;

            const supervisorColor = buildSupervisorColorMap(rows || []);
            const layers = buildSiteCellLayers(rows || [], mode, supervisorColor, geoJSON, statusRows);
            if (!layers.length) {
                console.warn(`No gp boundaries drawn for block`, blockName,
                             (geoJSON && geoJSON._meta) || "(no response)");
                return OVERLAY_EMPTY;
            }

            const meta = geoJSON._meta || {};
            if (meta.blockFeature && meta.blockFeature.geometry) {
                const outlineLatLngs = geoJsonToLatLngs(meta.blockFeature.geometry);
                if (outlineLatLngs.length) {
                    const fillLayer = L.polygon(outlineLatLngs, {
                        fillColor: BLOCK_GAP_COLOR, fillOpacity: 1,
                        color: '#1f2937', weight: 2,
                        interactive: false, className: 'boundary-shape'
                    });
                    fillLayer._ssdOutline = true;
                    layers.unshift(fillLayer);
                }
                if (blockLayer.setStyle) {
                    blockLayer.setStyle({ weight: 0, opacity: 0, fillOpacity: 0 });
                }
            }

            const group = L.layerGroup(layers);
            group.addTo(map);
            ctx.crecheLayer = group;
            ctx.supervisorColors = supervisorColor;
            bindGPLabelVisibility(map, group);
            return { supervisors: Array.from(supervisorColor.keys()), supervisorColor };
        }).finally(() => hideGPLoading(token));
    }

    function ensureIsolatedOverlay() {
        if (!ctx.map || !ctx.isolatedBlock) return Promise.resolve(null);

        if (ctx.crecheLayer) {
            return Promise.resolve(null);
        }
        if (ctx.overlayPromise) {
            return ctx.overlayPromise;
        }

        const blockName = ctx.isolatedBlock;
        const blockLayer = findBlockLayer(blockName);
        const values = collectValues();
        const rowsPromise = ctx.crecheRows.length
            ? Promise.resolve(ctx.crecheRows)
            : loadCrechePoints(values).then(rows => {
                ctx.crecheRows = rows;
                return rows;
            });
        const scoped = rowsPromise.then(rows => rows.filter(
            row => cleanName(row.block) === cleanName(blockName)
        ));
        const promise = scoped.then(rows => renderSiteOverlay(
            ctx.map, blockLayer, rows, ctx.overlayMode,
            gpScope(blockName)
        )).then(info => {
            updateOverlayLegend(ctx.overlayMode, info);
            return info;
        });
        const trackedPromise = promise.finally(() => {
            if (ctx.overlayPromise === trackedPromise) ctx.overlayPromise = null;
        });
        ctx.overlayPromise = trackedPromise;
        return trackedPromise;
    }

    const SUPERVISOR_HIGHLIGHT_COLOR = '#ff2d78';

    function highlightSupervisor(name) {
        if (!ctx.crecheLayer) return;
        ctx.crecheLayer.eachLayer(polygon => {
            if (!polygon.setStyle || polygon._ssdOutline) return;
            const base = polygon._ssdBaseStyle || { fillColor: '#94a3b8', color: '#64748b', weight: 0.8, fillOpacity: 0.9 };
            const tooltipEl = polygon.getTooltip && polygon.getTooltip()
                && polygon.getTooltip().getElement && polygon.getTooltip().getElement();
            if (tooltipEl) tooltipEl.style.opacity = '';

            if (!name) {
                polygon.setStyle({
                    fillColor: base.fillColor, color: base.color,
                    weight: base.weight, fillOpacity: base.fillOpacity, opacity: 1
                });
                return;
            }
            const hit = polygon.supervisorName === name;
            polygon.setStyle({
                fillColor: base.fillColor,
                color: hit ? SUPERVISOR_HIGHLIGHT_COLOR : base.color,
                opacity: 1,
                fillOpacity: hit ? 0.95 : 0.2,
                weight: hit ? 3 : 1
            });
            if (hit && polygon.bringToFront) polygon.bringToFront();
        });
    }

    function highlightMetric(kind, category) {
        if (!ctx.crecheLayer) return;
        const hitColor = category ? (CATEGORY_COLORS[category] || SUPERVISOR_HIGHLIGHT_COLOR) : null;
        const hits = [];

        ctx.crecheLayer.eachLayer(polygon => {
            if (!polygon.setStyle || polygon._ssdOutline) return;
            const base = polygon._ssdBaseStyle || { fillColor: '#94a3b8', color: '#64748b', weight: 0.8, fillOpacity: 0.9 };
            const tooltipEl = polygon.getTooltip && polygon.getTooltip()
                && polygon.getTooltip().getElement && polygon.getTooltip().getElement();

            if (!category) {
                polygon.setStyle({
                    fillColor: base.fillColor, color: base.color,
                    weight: base.weight, fillOpacity: base.fillOpacity, opacity: 1
                });
                if (tooltipEl) tooltipEl.style.opacity = '';
                return;
            }

            const hit = kind === 'village'
                ? polygon.villageCategories && polygon.villageCategories.has(category)
                : polygon.statusCategories && polygon.statusCategories.has(category);

            polygon.setStyle({
                fillColor: hit ? hitColor : base.fillColor,
                color: hit ? '#111827' : base.color,
                opacity: hit ? 1 : 0.35,
                fillOpacity: hit ? 0.95 : 0.15,
                weight: hit ? 3 : Math.min(base.weight, 0.8)
            });
            if (tooltipEl) tooltipEl.style.opacity = hit ? '1' : '0.25';

            if (hit) {
                if (polygon.bringToFront) polygon.bringToFront();
                hits.push(polygon);
            }
        });

        return hits;
    }

    function frameMetricHits(hits) {
        if (!ctx.map || !hits || !hits.length) return;

        let bounds = null;
        hits.forEach(polygon => {
            try {
                const b = polygon.getBounds();
                if (!b || !b.isValid()) return;
                bounds = bounds ? bounds.extend(b) : L.latLngBounds(b.getSouthWest(), b.getNorthEast());
            } catch (e) {  }
        });
        if (!bounds || !bounds.isValid()) return;

        const current = ctx.map.getZoom();
        if (ctx.map.getBounds().pad(-0.08).contains(bounds)) return;

        const target = Math.min(
            ctx.map.getBoundsZoom(bounds, false, L.point(60, 60)),
            current + 3,
            14
        );

        ctx.map.flyToBounds(bounds, {
            padding: [60, 60],
            maxZoom: Math.max(target, current),
            duration: 0.6
        });
    }

    function updateOverlayLegend(mode, info) {
        const host = document.getElementById('map-legend-items');
        if (!host) return;

        if (mode === 'supervisor' && info && !info.empty) {

            const supervisorRows = info.supervisors
                .map(name => legendRowHtml(info.supervisorColor.get(name), name))
                .join('');
            host.innerHTML = supervisorRows
                ? supervisorRows + legendRowHtml(NO_DATA_COLOR, __("No Data"))
                : `<div style="font-size: 12px; color: #6b7280;">${__("No supervisors")}</div>`;
        } else {

            host.innerHTML = [
                legendRowHtml(CATEGORY_COLORS.operational, __("Operational Creches")),
                legendRowHtml(CATEGORY_COLORS.scattered, __("Scattered")),
                legendRowHtml(CATEGORY_COLORS.urban, __("Urban")),
                legendRowHtml(NO_DATA_COLOR, __("No Data"))
            ].join('');
        }
    }

    const CATEGORY_COLORS = {
        operational: '#1878c8',
        lessChildren: '#ffe800',
        scattered: '#f0913f',
        urban: '#8e44ad'
    };

    let summaryToken = 0;

    function loadSummaryCards(values) {
        const mapToken = ctx.loadToken;
        const token = ++summaryToken;

        frappe.call({
            method: "frappe.apf.page.saturation_status_da.api_data.get_dashboard_summary",
            args: {
                year: values.year,
                month: values.month,
                state: values.state || "",
                district: values.district || "",
                block: values.block || "",
                partner: values.partner || "",
                c_status: values.creche_status_id || ""
            },
            callback: (r) => {
                if (token !== summaryToken || mapToken !== ctx.loadToken) return;
                renderSummaryCards(r.message || {});
            },
            error: () => {
                if (token !== summaryToken || mapToken !== ctx.loadToken) return;
                const host = document.getElementById('ssd-summary-card');
                if (host) host.innerHTML = `<div class="ssd-card-loading">${__("Summary unavailable.")}</div>`;
                const rowsHost = document.getElementById('ssd-supervisor-rows');
                if (rowsHost) rowsHost.innerHTML = `<tr><td colspan="4" class="ssd-card-loading">${__("Unavailable.")}</td></tr>`;
            }
        });
    }

    function renderSummaryCards(summary) {
        const host = document.getElementById('ssd-summary-card');
        const creches = summary.creches || {};
        const gps = summary.gps || {};
        const villages = summary.villages || {};
        const unavailable = new Set(summary.unavailable || []);

        const metric = (label, value, cls, swatch, selector, id) => {
            const attrs = selector
                ? ` data-metric-kind="${escapeHtml(selector.kind)}" data-metric-category="${escapeHtml(selector.category)}"`
                : '';
            const idAttr = id ? ` id="${escapeHtml(id)}"` : '';
            return `
            <div class="ssd-metric ${cls || ''}${selector ? ' ssd-metric-selectable' : ''}"${attrs}>
                <span class="ssd-metric-label">
                    ${swatch ? `<span class="ssd-swatch" style="background:${swatch};"></span>` : ''}
                    <span>${escapeHtml(label)}</span>
                </span>
                <span class="ssd-metric-value"${idAttr}>${value}</span>
            </div>`;
        };

        if (host) {
            host.innerHTML = [
                metric(__("Total No of Operational Creches"), creches.operational || 0, 'ssd-total'),
                metric(__("Total No of Creches"), creches.total || 0),
                `<div class="ssd-card-section">${__("Gram Panchayats")}</div>`,
                metric(__("Total No of Gram Panchayats"), gps.total || 0, null, null, null, 'ssd-total-gp'),
                metric(__("Operational Gram Panchayats"), gps.operational || 0,
                    'ssd-operational', CATEGORY_COLORS.operational, { kind: 'gp', category: 'operational' }),
                metric(__("Scattered Gram Panchayats"), gps.scattered || 0,
                    'ssd-scattered', CATEGORY_COLORS.scattered, { kind: 'gp', category: 'scattered' }),
                metric(__("Urban Gram Panchayats"),
                    unavailable.has('gps.urban') ? '&mdash;' : (gps.urban || 0),
                    unavailable.has('gps.urban') ? 'ssd-muted' : 'ssd-urban', CATEGORY_COLORS.urban,
                    unavailable.has('gps.urban') ? null : { kind: 'gp', category: 'urban' }),
                `<div class="ssd-card-section">${__("Villages")}</div>`,
                metric(__("Total No of Villages"), villages.total || 0, null, null, null, 'ssd-total-village'),
                metric(__("Operational Villages"), villages.operational || 0,
                    'ssd-operational', CATEGORY_COLORS.operational, { kind: 'village', category: 'operational' }),
                metric(__("Scattered Villages"), villages.scattered || 0,
                    'ssd-scattered', CATEGORY_COLORS.scattered, { kind: 'village', category: 'scattered' }),
                metric(__("Less Children Villages"), villages.less_children || 0,
                    'ssd-less', CATEGORY_COLORS.lessChildren, { kind: 'village', category: 'lessChildren' })
            ].join('');
        }

        const rowsHost = document.getElementById('ssd-supervisor-rows');
        if (rowsHost) {
            const supervisors = summary.supervisors || [];
            rowsHost.innerHTML = supervisors.length
                ? supervisors.map(s => {
                    const name = s.supervisor || '-';
                    const swatch = (ctx.overlayMode === 'supervisor' && ctx.supervisorColors)
                        ? ctx.supervisorColors.get(name)
                        : null;
                    return `
                        <tr data-supervisor="${escapeHtml(name)}">
                            <td class="ssd-sup-name">
                                ${swatch ? `<span class="ssd-swatch" style="background:${swatch};"></span>` : ''}
                                ${escapeHtml(name)}
                            </td>
                            <td>${s.creches || 0}</td>
                            <td>${s.villages || 0}</td>
                            <td>${s.gps || 0}</td>
                        </tr>`;
                }).join('')
                : `<tr class="ssd-no-match"><td colspan="4" class="ssd-card-loading">${__("No supervisors in this scope.")}</td></tr>`;
        }
    }

    map_container.on('click', '#ssd-supervisor-rows tr', function () {
        const $row = $(this);
        if ($row.hasClass('ssd-no-match') || !ctx.crecheLayer) return;
        const name = ($row.data('supervisor') || '').toString();
        if (!name) return;

        $('.ssd-metric-selectable').removeClass('is-selected');

        if ($row.hasClass('is-selected')) {
            $row.removeClass('is-selected');
            highlightSupervisor(null);
            return;
        }
        $('#ssd-supervisor-rows tr').removeClass('is-selected');
        $row.addClass('is-selected');
        highlightSupervisor(name);
    });

    map_container.on('click', '.ssd-metric-selectable', function () {
        const $row = $(this);
        const kind = $row.attr('data-metric-kind');
        const category = $row.attr('data-metric-category');
        if (!kind || !category) return;
        if (!ctx.isolatedBlock) {
            frappe.show_alert({
                message: __("Double-click a block on the map first to see its Gram Panchayat / Village boundaries, then click this again to highlight them."),
                indicator: "orange"
            });
            return;
        }

        $('#ssd-supervisor-rows tr').removeClass('is-selected');

        if ($row.hasClass('is-selected')) {
            $row.removeClass('is-selected');
            highlightMetric(null, null);
            return;
        }
        $('.ssd-metric-selectable').removeClass('is-selected');
        $row.addClass('is-selected');

        const label = kind === 'gp'
            ? ({ operational: __('Operational Gram Panchayats'), scattered: __('Scattered Gram Panchayats'), urban: __('Urban Gram Panchayats') }[category] || category)
            : ({ operational: __('Operational Villages'), scattered: __('Scattered Villages'), lessChildren: __('Less Children Villages') }[category] || category);

        const applyAndFrame = () => {
            const hits = highlightMetric(kind, category) || [];
            if (!hits.length) {
                highlightMetric(null, null);
                $row.removeClass('is-selected');
                const names = unmatchedGpVillageNames(kind, category);
                ctx.lastUnmatchedMetric = { kind, category, names };
                if (names.length) {
                    console.info(`[SSD] ${label}: no boundary matched for`, names);
                }
                frappe.show_alert({
                    message: names.length
                        ? __("{0}: {1} record(s) have no usable GP/Village name to match on the map. Fix the name on: {2}", [label, names.length, names.join(', ')])
                        : __("No {0} boundaries could be matched on the map for this block.", [label]),
                    indicator: "orange"
                });
                return;
            }
            frameMetricHits(hits);
        };

        if (ctx.crecheLayer) {
            applyAndFrame();
            return;
        }

        ensureIsolatedOverlay().then(() => applyAndFrame());
    });

    function addBackControl(map) {
        const control = L.control({ position: 'topleft' });

        control.onAdd = function () {
            const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control ssd-back-control');
            const link = L.DomUtil.create('a', '', container);
            link.href = '#';
            link.title = __('Back to previous level');
            link.setAttribute('role', 'button');
            link.innerHTML = '&#8249;';
            link.style.cssText = "font-size: 22px; font-weight: 700; line-height: 26px; text-align: center;";

            L.DomEvent.disableClickPropagation(container);
            L.DomEvent.on(link, 'click', (e) => {
                L.DomEvent.stop(e);
                if (link.getAttribute('aria-disabled') === 'true') return;
                goBack();
            });

            this._link = link;
            this._container = container;
            return container;
        };

        control.setEnabled = function (enabled) {
            if (!this._link || !this._container) return;
            this._container.style.display = enabled ? '' : 'none';
            this._link.setAttribute('aria-disabled', enabled ? 'false' : 'true');
        };

        control.addTo(map);
        ctx.backControl = control;
        updateBackControl();
        return control;
    }

    function addRefreshControl(map) {
        const control = L.control({ position: 'topleft' });

        control.onAdd = function () {
            const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control ssd-refresh-control');
            const link = L.DomUtil.create('a', '', container);
            link.href = '#';
            link.title = __('Refresh map');
            link.setAttribute('role', 'button');
            link.innerHTML = '&#8635;';
            link.style.cssText = "font-size: 16px; font-weight: 700; line-height: 26px; text-align: center;";

            L.DomEvent.disableClickPropagation(container);
            L.DomEvent.on(link, 'click', (e) => {
                L.DomEvent.stop(e);
                if (container.classList.contains('ssd-refresh-spinning')) return;
                container.classList.add('ssd-refresh-spinning');
                const done = () => container.classList.remove('ssd-refresh-spinning');
                if (ctx.isolatedBlock) {
                    refreshLiveData(done);
                } else {
                    load_data(done, currentView());
                }
            });

            this._link = link;
            this._container = container;
            return container;
        };

        control.addTo(map);
        return control;
    }

    function updateBackControl() {
        if (ctx.backControl && ctx.backControl.setEnabled) {
            ctx.backControl.setEnabled(ctx.history.length > 0 || !!ctx.isolatedBlock);
        }
    }

    function addFullscreenControl(map) {
        const control = L.control({ position: 'topleft' });

        control.onAdd = function () {
            const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control ssd-fullscreen-control');
            const link = L.DomUtil.create('a', '', container);
            link.href = '#';
            link.title = __('Full screen');
            link.setAttribute('role', 'button');
            link.innerHTML = '&#9974;';
            link.style.cssText = "font-size: 15px; font-weight: 700; line-height: 26px; text-align: center;";

            L.DomEvent.disableClickPropagation(container);
            L.DomEvent.on(link, 'click', (e) => {
                L.DomEvent.stop(e);
                toggleFullscreen(map);
            });

            this._link = link;
            return container;
        };

        control.addTo(map);
        ctx.fullscreenControl = control;
        return control;
    }

    function toggleFullscreen(map) {
        ctx.isFullscreen = !ctx.isFullscreen;
        const center = map.getCenter();
        const zoom = map.getZoom();

        if (!ctx.isFullscreen) ctx.summaryPopoverOpen = false;
        applyFullscreenState();

        requestAnimationFrame(() => {
            if (!ctx.map || ctx.map !== map) return;
            map.invalidateSize({ animate: false });
            map.setView(center, zoom, { animate: false });
        });
    }

    function applyFullscreenState() {
        const root = map_container.get(0);
        if (!root) return;
        const row = root.querySelector('.ssd-map-row');
        if (row) row.classList.toggle('ssd-fullscreen', !!ctx.isFullscreen);

        const link = root.querySelector('.ssd-fullscreen-control a');
        if (link) {
            link.innerHTML = ctx.isFullscreen ? '&#10006;' : '&#9974;';
            link.title = ctx.isFullscreen ? __('Exit full screen') : __('Full screen');
        }
        applySummaryPopoverState();
    }

    function applySummaryPopoverState() {
        const root = map_container.get(0);
        if (!root) return;
        const cardWrap = root.querySelector('#ssd-summary-card-wrap');
        const popover = root.querySelector('#ssd-summary-popover');
        const sideColumn = root.querySelector('.ssd-side-column');
        const fab = root.querySelector('#ssd-summary-fab');
        if (!cardWrap || !popover || !sideColumn) return;

        const open = !!ctx.isFullscreen && !!ctx.summaryPopoverOpen;
        if (open && cardWrap.parentElement !== popover) {
            popover.appendChild(cardWrap);
        } else if (!open && cardWrap.parentElement !== sideColumn) {
            sideColumn.insertBefore(cardWrap, sideColumn.firstChild);
        }
        popover.classList.toggle('is-open', open);

        if (fab) {
            fab.classList.toggle('is-active', open);
            fab.setAttribute('aria-expanded', open ? 'true' : 'false');
            fab.title = open ? __('Hide Summary') : __('Show Summary');
            fab.setAttribute('aria-label', fab.title);
        }
    }

    map_container.on('click', '#ssd-summary-fab', (e) => {
        e.stopPropagation();
        if (!ctx.isFullscreen) return;
        ctx.summaryPopoverOpen = !ctx.summaryPopoverOpen;
        applySummaryPopoverState();
    });

    map_container.on('click', (e) => {
        if (!ctx.isFullscreen || !ctx.summaryPopoverOpen) return;
        if ($(e.target).closest('#ssd-summary-popover, #ssd-summary-fab').length) return;
        ctx.summaryPopoverOpen = false;
        applySummaryPopoverState();
    });

    $(document).on('keydown.ssdFullscreen', (e) => {
        if (e.key !== 'Escape' || !ctx.map || !ctx.isFullscreen) return;
        if (ctx.summaryPopoverOpen) {
            ctx.summaryPopoverOpen = false;
            applySummaryPopoverState();
            return;
        }
        toggleFullscreen(ctx.map);
    });

    let activeStatesPromise = null;

    function loadActiveStates() {
        if (!activeStatesPromise) {
            activeStatesPromise = new Promise((resolve) => {
                frappe.call({
                    method: "frappe.apf.page.saturation_status_da.api_data.get_active_state_names",
                    callback: (r) => resolve(r.message || []),
                    error: () => resolve([])
                });
            });
        }
        return activeStatesPromise;
    }

    function loadGeolocation() {
        if (ctx.geoConfig) return Promise.resolve(ctx.geoConfig);
        return new Promise((resolve, reject) => {
            frappe.call({
                method: "frappe.apf.page.saturation_status_da.api_data.get_geolocation_config",
                callback: (r) => {
                    if (r.message) {
                        ctx.geoConfig = r.message;
                        resolve(r.message);
                    } else {
                        reject(new Error("No geolocation config returned"));
                    }
                },
                error: reject
            });
        });
    }

    const boundaryCache = new Map();

    function fetchBoundaryGeoJSON(level, state, district) {
        const key = `${level}|${state || ""}|${district || ""}`;
        if (boundaryCache.has(key)) return boundaryCache.get(key);

        const promise = new Promise((resolve, reject) => {
            frappe.call({
                method: "frappe.apf.page.saturation_status_da.api_data.get_boundary_geojson",
                args: { level: level, state: state || "", district: district || "" },
                callback: (r) => r.message ? resolve(r.message) : reject(new Error("No boundary GeoJSON returned")),
                error: reject
            });
        }).catch(err => {
            boundaryCache.delete(key);
            throw err;
        });

        boundaryCache.set(key, promise);
        return promise;
    }

    const BLOCK_SUFFIX_RE = /\s*\bcd\s+block\b|\s*\bblock\b|\s*\(pt\.?\)|\s*\(part\)|\s*\btaluk\b|\s*\btehsil\b|\s*\bmandal\b|\s*\bsub\s*division\b|\s*\bcircle\b/gi;

    const stripBlockSuffix = (name) => (name || "").replace(BLOCK_SUFFIX_RE, "").trim();

    function isInScope() {
        return true;
    }

    function getFeatureName(feature, level) {
        const p = feature.properties || {};
        if (level === LEVEL_STATE) return p.ST_NM || p.name || p.NAME_1 || "";
        if (level === LEVEL_DISTRICT) return p._districtName || p.NAME_2 || p.district || p.dtname || "";
        if (level === LEVEL_BLOCK) {
            return stripBlockSuffix(p.shapeName || p.NAME_3 || p.taluk || p.tehsil || p.subdistrict || p.block || "");
        }
        return "";
    }

    function getMapCenter(geoConfig, level, scope) {
        const defaults = (geoConfig && geoConfig.defaults) || { center: [22.8, 83.9], zoom: 5 };

        if (level === LEVEL_DISTRICT && scope.stateLabel && geoConfig.states) {
            const target = cleanName(scope.stateLabel);
            for (const name in geoConfig.states) {
                if (cleanName(name) === target) {
                    return { center: geoConfig.states[name].center, zoom: geoConfig.states[name].zoom || 8 };
                }
            }
        } else if (level === LEVEL_BLOCK && scope.districtLabel && geoConfig.districts) {
            const target = cleanName(scope.districtLabel);
            for (const name in geoConfig.districts) {
                if (cleanName(name) === target) {
                    return { center: geoConfig.districts[name].center, zoom: geoConfig.districts[name].zoom || 10 };
                }
            }
        }
        return { center: defaults.center, zoom: defaults.zoom };
    }

    function buildNameResolver(groupKeys) {
        const exact = new Map();
        const fuzzy = new Map();
        groupKeys.forEach(key => {
            const c = cleanName(key);
            if (c && !exact.has(c)) exact.set(c, key);
            const f = fuzzyKey(key);
            if (f && !fuzzy.has(f)) fuzzy.set(f, key);
        });

        return function resolve(featureName) {
            if (!featureName) return null;
            const c = cleanName(featureName);
            if (!c) return null;

            const direct = exact.get(c);
            if (direct) return direct;

            const viaFuzzy = fuzzy.get(fuzzyKey(featureName));
            if (viaFuzzy) return viaFuzzy;

            if (c.length > 4) {
                for (const [candidate, key] of exact) {
                    if (candidate.length > 4 && (c.includes(candidate) || candidate.includes(c))) return key;
                }
            }
            return null;
        };
    }

    function aggregate(data, groupKey) {
        const grouped = Object.create(null);
        const totals = { creches: new Set(), gps: new Set(), villages: new Set() };

        for (let i = 0; i < data.length; i++) {
            const row = data[i];
            const name = row[groupKey] || 'Unknown';
            let bucket = grouped[name];
            if (!bucket) {
                bucket = grouped[name] = { creches: new Set(), gps: new Set(), villages: new Set() };
            }
            if (row.creche_id) {
                bucket.creches.add(row.creche_id);
                totals.creches.add(row.creche_id);
            }
            if (row.gram_panchayat) {
                bucket.gps.add(row.gram_panchayat);
                totals.gps.add(row.gram_panchayat);
            }
            if (row.village) {
                bucket.villages.add(row.village);
                totals.villages.add(row.village);
            }
        }
        return { grouped, totals };
    }

    function render_map_view(data, level, values) {
        teardownMap();
        map_container.empty();

        if (!level) {
            map_container.html(`<div class="text-center text-muted" style="margin-top: 50px; font-size: 16px;">${__("Please select a Level to view the map data.")}</div>`);
            hideLoading();
            return;
        }

        const selected = LEVEL_MAP[level];
        if (!selected) return;

        const groupKey = selected.key;
        const groupLabel = selected.label;

        ctx.data = data;

        ctx.stateNameToId = Object.create(null);
        ctx.districtNameToId = Object.create(null);
        ctx.blockNameToId = Object.create(null);
        data.forEach(row => {
            if (row.state && row.state_id) ctx.stateNameToId[row.state] = row.state_id;
            if (row.district && row.district_id) ctx.districtNameToId[row.district] = row.district_id;
            if (row.block && row.block_id) ctx.blockNameToId[row.block] = row.block_id;
        });

        const { grouped } = aggregate(data, groupKey);
        ctx.groupedData = grouped;
        ctx.groupKeys = Object.keys(grouped);

        const colorFor = (name) => {
            const idx = ctx.groupKeys.indexOf(name);
            return PASTEL_COLORS[(idx < 0 ? 0 : idx) % PASTEL_COLORS.length];
        };

        const scope = {
            stateValue: values.state || "",
            districtValue: values.district || "",
            stateLabel: getFieldLabel("state"),
            districtLabel: getFieldLabel("district")
        };

        map_container.html(buildLayout({
            groupKeys: ctx.groupKeys,
            level,
            headerTitle: scope.stateLabel ? `Dashboard Map View - ${scope.stateLabel}` : `Dashboard Map View`
        }));

        bindTextFilter();
        loadSummaryCards(values);

        if (!data.length) {
            const host = document.getElementById('leaflet-map');
            if (host) host.innerHTML = `<div class="ssd-empty">${__("No records match the selected filters.")}</div>`;
            hideLoading();
            return;
        }

        initMap(level, groupKey, groupLabel, colorFor, scope);
    }

    function buildLayout({ groupKeys, level, headerTitle }) {

        const legend = level === LEVEL_BLOCK
            ? [
                legendRowHtml(CATEGORY_COLORS.operational, __("Operational Creches")),
                legendRowHtml(CATEGORY_COLORS.scattered, __("Scattered")),
                legendRowHtml(CATEGORY_COLORS.urban, __("Urban")),
                legendRowHtml(NO_DATA_COLOR, __("No Data"))
            ].join('')
            : groupKeys.map((name, idx) =>
                legendRowHtml(PASTEL_COLORS[idx % PASTEL_COLORS.length], name)
            ).join('');

        return `
            <div class="ssd-map-row" style="display: flex; flex-wrap: wrap; width: 100%; justify-content: space-between; align-items: stretch; padding: 20px; gap: 20px; background-color: #f4f6f8;">
                <div id="export-map-container" style="flex: 4 1 600px; min-width: 320px; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); border: 1px solid #e5e7eb; border-radius: 8px; position: relative; overflow: hidden; background-color: #e2f0f4;">
                    <div style="background-color: #5979aa; color: white; padding: 10px 15px; display: flex; justify-content: space-between; align-items: center; font-weight: 600; font-family: ${FONT_STACK}; font-size: 16px; z-index: 2; position: relative; gap: 10px; flex-wrap: wrap;">
                        <span>${escapeHtml(headerTitle)}</span>
                        <span style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                            ${level === LEVEL_BLOCK ? `
                                <span id="map-gp-loading" class="ssd-gp-loading" style="display: none;" title="${__("Loading Gram Panchayat boundaries...")}">
                                    <span class="ssd-gp-loading-ring"></span>
                                    <span>${__("Loading GP boundaries...")}</span>
                                </span>
                                <button type="button" id="map-supervisor-toggle" class="ssd-map-btn"
                                        title="${__("Colour each Gram Panchayat by its Supervisor")}">
                                    ${__("Supervisor")}
                                </button>` : ''}
                            <input type="text" id="map-text-filter" placeholder="${__("Search by Name...")}" style="padding: 5px 12px; border-radius: 4px; border: 1px solid #60a5fa; background-color: #eff6ff; color: #5979aa; font-size: 12px; outline: none; width: 200px; max-width: 100%; font-weight: 500;">
                        </span>
                    </div>
                    <div id="leaflet-map" style="height: 70vh; min-height: 400px; max-height: 800px; width: 100%; background-color: transparent; z-index: 1;"></div>
                    <div id="map-legend-container" style="position: absolute; bottom: 15px; left: 15px; background: rgba(255,255,255,0.95); padding: 10px 15px; border: 1px solid #e5e7eb; border-radius: 6px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); font-family: ${FONT_STACK}; font-size: 12px; font-weight: 600; text-align: left; z-index: 999; max-height: 250px; overflow-y: auto; display: flex; flex-direction: column;">
                        <div id="map-legend-toggle" style="display: flex; justify-content: space-between; align-items: center; cursor: pointer;">
                            <span style="color: #4b5563; font-size: 11px; text-transform: uppercase; margin-right: 20px;">${__("Colour Legend")}</span>
                            <span style="font-size: 10px;">&#128065;</span>
                        </div>
                        <div id="map-legend-items" style="display: block; margin-top: 8px;">${legend}</div>
                    </div>
                    <button type="button" id="ssd-summary-fab" class="ssd-summary-fab" title="${__("Show Summary")}" aria-label="${__("Show Summary")}" aria-expanded="false">
                        <span aria-hidden="true">&#9776;</span>
                    </button>
                    <div id="ssd-summary-popover" class="ssd-summary-popover"></div>
                </div>
                <div class="ssd-side-column" style="flex: 1 1 240px; min-width: 240px; max-width: 300px;">
                    <div class="ssd-card ssd-card-summary" id="ssd-summary-card-wrap">
                        <div class="ssd-card-head">${__("Summary")}</div>
                        <div class="ssd-scroll">
                            <div id="ssd-summary-card" class="ssd-card-body">
                                <div class="ssd-card-loading">${__("Loading summary...")}</div>
                            </div>
                        </div>
                    </div>
                    <div class="ssd-card ssd-card-grow">
                        <div class="ssd-card-head ssd-card-head-search">
                            <span>${__("Creche Supervisors")}</span>
                            <input type="text" id="ssd-supervisor-search" class="ssd-head-search"
                                   placeholder="${__("Search...")}" autocomplete="off">
                        </div>
                        <div class="ssd-scroll">
                            <table class="ssd-side-table">
                                <thead>
                                    <tr>
                                        <th style="width: 40%; text-align: left;">${__("SUPERVISOR")}</th>
                                        <th style="width: 20%;">${__("CRECHE")}</th>
                                        <th style="width: 20%;">${__("VILLAGE")}</th>
                                        <th style="width: 20%;">${__("GP")}</th>
                                    </tr>
                                </thead>
                                <tbody id="ssd-supervisor-rows">
                                    <tr><td colspan="4" class="ssd-card-loading">${__("Loading...")}</td></tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>`;
    }

    function bindTextFilter() {
        const $input = $('#map-text-filter');
        if (!$input.length) return;

        const apply = debounce(function () {
            const term = ($input.val() || "").toLowerCase().trim();

            $('#ssd-supervisor-rows tr').each(function () {
                const text = $(this).find('td:first').text().toLowerCase();
                this.style.display = text.includes(term) ? "" : "none";
            });

            if (!ctx.map || !ctx.features.length) return;
            if (ctx.isolatedBlock) clearBlockIsolation();

            const visible = [];
            ctx.features.forEach(layer => {
                const name = layer.featureName;
                if (!name) return;
                const match = name.toLowerCase().includes(term);
                if (match) {
                    if (!ctx.map.hasLayer(layer)) ctx.map.addLayer(layer);
                    if (layer.getLatLng) {
                        visible.push(layer.getLatLng());
                    } else if (layer.getBounds) {
                        const b = layer.getBounds();
                        visible.push(b.getSouthWest(), b.getNorthEast());
                    }
                } else if (ctx.map.hasLayer(layer)) {
                    ctx.map.removeLayer(layer);
                }
            });

            if (term && visible.length) {
                ctx.map.fitBounds(L.latLngBounds(visible), { padding: [50, 50], maxZoom: 14 });
            }
        }, 200);

        $input.on('input', apply);

        $('#map-legend-toggle').on('click', () => {
            const items = document.getElementById('map-legend-items');
            if (items) items.style.display = items.style.display === 'none' ? 'block' : 'none';
        });

        $('#map-supervisor-toggle').on('click', function () {
            ctx.overlayMode = ctx.overlayMode === 'supervisor' ? 'category' : 'supervisor';
            const on = ctx.overlayMode === 'supervisor';
            $(this).toggleClass('is-active', on);
            if (!ctx.map || !ctx.isolatedBlock) return;

            const blockLayer = findBlockLayer(ctx.isolatedBlock);
            const scoped = (ctx.crecheRows || []).filter(
                r => cleanName(r.block) === cleanName(ctx.isolatedBlock)
            );
            renderSiteOverlay(ctx.map, blockLayer, scoped, ctx.overlayMode, gpScope(ctx.isolatedBlock))
                .then(info => {
                    updateOverlayLegend(ctx.overlayMode, info);
                    highlightSupervisor(null);
                    $('#ssd-supervisor-rows tr').removeClass('is-selected');
                });
        });

        const $supSearch = $('#ssd-supervisor-search');
        $supSearch.on('input', debounce(function () {
            const term = ($supSearch.val() || '').toLowerCase().trim();
            let shown = 0;
            $('#ssd-supervisor-rows tr').each(function () {
                const $row = $(this);
                if ($row.hasClass('ssd-no-match')) return;
                const name = ($row.find('td:first').text() || '').toLowerCase();
                const hit = !term || name.includes(term);
                this.style.display = hit ? '' : 'none';
                if (hit) shown++;
            });
            $('#ssd-supervisor-empty').remove();
            if (!shown) {
                $('#ssd-supervisor-rows').append(
                    `<tr id="ssd-supervisor-empty" class="ssd-no-match"><td colspan="4" class="ssd-card-loading">${__("No matching supervisor.")}</td></tr>`
                );
            }
        }, 120));
    }

    function teardownMap() {
        if (ctx.resizeObserver) {
            ctx.resizeObserver.disconnect();
            ctx.resizeObserver = null;
        }
        if (ctx.map) {
            if (typeof ctx.map.stop === 'function') ctx.map.stop();
            ctx.map.off();
            ctx.map.remove();
            ctx.map = null;
        }
        ctx.features = [];
        ctx.geoLayer = null;
        ctx.backControl = null;
        ctx.fullscreenControl = null;
        ctx.isolatedBlock = null;
        ctx.preIsolationView = null;
        ctx.crecheLayer = null;
        ctx.overlayToken++;
        ctx.supervisorColors = null;
    }

    function initMap(level, groupKey, groupLabel, colorFor, scope) {
        librariesReady.then(hasLeaflet => {
            if (!hasLeaflet) {
                console.warn("Leaflet map library is not loaded.");
                const mapHost = document.getElementById('leaflet-map');
                if (mapHost) {
                    mapHost.innerHTML = `<div class="ssd-empty">${__("Map library unavailable. Other dashboard data is still shown.")}</div>`;
                }
                hideLoading();
                return;
            }
            const host = document.getElementById('leaflet-map');
            if (!host) { hideLoading(); return; }

            const map = L.map(host, {
                scrollWheelZoom: true,
                preferCanvas: false,
                zoomControl: true,
                zoomAnimation: true,
                markerZoomAnimation: false,

                zoomSnap: 0.25,
                zoomDelta: 0.5,
                wheelPxPerZoomLevel: 90,
                wheelDebounceTime: 30
            }).setView([22.8, 83.9], 5);
            ctx.map = map;

            addRefreshControl(map);
            addBackControl(map);
            addFullscreenControl(map);
            applyFullscreenState();

            map.on('popupopen', (e) => {
                const btn = e.popup._container && e.popup._container.querySelector('.leaflet-popup-close-button');
                if (btn) {
                    btn.removeAttribute('href');
                    btn.style.cursor = 'pointer';
                }
            });

            if (window.ResizeObserver) {
                ctx.resizeObserver = new ResizeObserver(debounce(() => {
                    if (ctx.map) ctx.map.invalidateSize();
                }, 150));
                ctx.resizeObserver.observe(host);
            }

            if (level === LEVEL_STATE || level === LEVEL_DISTRICT || level === LEVEL_BLOCK) {
                renderBoundaries(map, level, groupKey, groupLabel, colorFor, scope);
            } else {
                plotPoints(map, groupKey, groupLabel, colorFor);
                whenPainted(map, ctx.loadToken, hideLoading);
            }
        });
    }

    function plotPoints(map, groupKey, groupLabel, colorFor) {
        const bounds = [];
        const layerGroup = L.layerGroup();
        const groupAnchors = Object.create(null);

        ctx.data.forEach(row => {
            if (!row.latitude || !row.longitude) return;
            const name = row[groupKey] || 'Unknown';
            const marker = L.circleMarker([row.latitude, row.longitude], {
                radius: 6, fillColor: colorFor(name), color: "#000",
                weight: 1, opacity: 1, fillOpacity: 0.8
            });

            marker.bindPopup(`
                <div style="font-family: ${FONT_STACK};">
                    <b>${escapeHtml(row.creche || 'Unnamed Creche')}</b><br>
                    ${escapeHtml(groupLabel)}: ${escapeHtml(name)}<br>
                    GP: ${escapeHtml(row.gram_panchayat || 'N/A')}<br>
                    Village: ${escapeHtml(row.village || 'N/A')}<br>
                </div>`, { autoPan: false });
            marker.bindTooltip(escapeHtml(row.creche || name), { direction: "top", className: "map-label" });

            marker.featureName = name;
            ctx.features.push(marker);
            layerGroup.addLayer(marker);
            bounds.push([row.latitude, row.longitude]);
            if (!groupAnchors[name]) groupAnchors[name] = [row.latitude, row.longitude];
        });

        layerGroup.addTo(map);

        Object.keys(groupAnchors).forEach(name => {
            L.marker(groupAnchors[name], {
                opacity: 0,
                interactive: false,
                keyboard: false
            }).addTo(layerGroup).bindTooltip(escapeHtml(name), {
                permanent: true, direction: "center", className: "map-label"
            });
        });

        if (bounds.length) {
            map.fitBounds(L.latLngBounds(bounds), { padding: [20, 20], maxZoom: 14 });
        }
    }

    function whenPainted(map, token, done) {
        let finished = false;
        const finish = () => {
            if (finished) return;
            finished = true;
            clearTimeout(safety);
            if (token === ctx.loadToken) done();
        };

        const safety = setTimeout(finish, 4000);

        const afterPaint = () => requestAnimationFrame(() => requestAnimationFrame(finish));

        if (map && typeof map.whenReady === 'function') {
            map.whenReady(afterPaint);
        } else {
            afterPaint();
        }
    }

    function renderBoundaries(map, level, groupKey, groupLabel, colorFor, scope) {
        const token = ctx.loadToken;

        loadGeolocation().then(geoConfig => {
            if (token !== ctx.loadToken) return;

            const view = getMapCenter(geoConfig, level, scope);
            map.setView(view.center, view.zoom, { animate: false });
            return Promise.all([
                fetchBoundaryGeoJSON(level, scope.stateValue, scope.districtValue),
                level === LEVEL_STATE ? loadActiveStates() : Promise.resolve([])
            ]);
        }).then(result => {
            if (!result || token !== ctx.loadToken) return;
            const [geoData, activeStates] = result;
            if (!geoData) return;
            scope.activeStates = activeStates || [];
            if (level === LEVEL_BLOCK) {
                console.info("[SSD] block boundaries", {
                    features: (geoData.features || []).length,
                    meta: geoData._meta,
                    groupKeys: ctx.groupKeys
                });
            }
            drawGeoJSON(map, geoData, level, groupKey, groupLabel, colorFor, scope);
            if (level === LEVEL_BLOCK) {

                autoIsolateFilteredBlock(map, level);
            }
            whenPainted(map, token, hideLoading);
        }).catch(err => {
            if (token !== ctx.loadToken) return;
            console.error("Boundary load failed", err);
            plotPoints(map, groupKey, groupLabel, colorFor);
            whenPainted(map, token, hideLoading);
        });
    }

    function categoriseGroup(name) {
        const stats = ctx.groupedData[name];
        if (!stats) return null;
        const creches = stats.creches.size;
        const villages = stats.villages.size;
        if (!creches) return 'lessChildren';
        if (creches === 1 && villages <= 1) return 'scattered';
        if (!villages) return 'lessChildren';
        return 'operational';
    }

    function drawGeoJSON(map, geoData, level, groupKey, groupLabel, colorFor, scope) {
        const resolve = buildNameResolver(ctx.groupKeys);
        const bounds = L.latLngBounds([]);
        let drew = false;

        const activeStateKeys = new Map();
        (scope.activeStates || []).forEach(s => {
            if (s && s.name) activeStateKeys.set(cleanName(s.name), s.name);
        });

        const resolutions = new WeakMap();

        function resolveFeature(feature) {
            if (resolutions.has(feature)) return resolutions.get(feature);
            const props = feature.properties || {};
            let result;
            if (!isInScope(feature, level, scope)) {
                result = { hidden: true, name: "", match: null };
            } else {
                const name = getFeatureName(feature, level);
                let match = null;
                if (level === LEVEL_BLOCK && props._blockKey) {
                    match = resolve(props._blockKey) || resolve(name);
                } else {
                    match = resolve(name);
                }

                const activeName = (level === LEVEL_STATE && !match)
                    ? activeStateKeys.get(cleanName(name))
                    : null;

                result = {
                    hidden: !name,
                    name,
                    match,
                    activeOnly: activeName || null,
                    category: match ? categoriseGroup(match) : null
                };
            }
            resolutions.set(feature, result);
            return result;
        }

        ctx.geoLayer = L.geoJSON(geoData, {
            style: (feature) => {
                const info = resolveFeature(feature);
                if (info.hidden) {
                    return { weight: 0, color: 'transparent', fillOpacity: 0, opacity: 0, interactive: false };
                }
                if (info.match) {
                    const fill = colorFor(info.match);
                    return {
                        fillColor: fill,
                        weight: level === LEVEL_BLOCK ? 1.6 : 1,
                        color: level === LEVEL_BLOCK ? '#1f2937' : '#555555',
                        fillOpacity: 1, opacity: 1, className: 'boundary-shape'
                    };
                }
                if (info.activeOnly) {
                    return {
                        fillColor: '#f1f5f9', weight: 1.5, color: '#64748b',
                        dashArray: '4 3', fillOpacity: 1, opacity: 1, className: 'boundary-shape'
                    };
                }
                return {
                    fillColor: NO_DATA_COLOR, weight: 1, color: '#94a3b8',
                    fillOpacity: 1, opacity: 1, className: 'boundary-shape'
                };
            },
            onEachFeature: (feature, layer) => {
                const info = resolveFeature(feature);
                if (info.hidden) return;

                try {
                    bounds.extend(layer.getBounds());
                    drew = true;
                } catch (e) {  }

                if (!info.match) {
                    if (info.activeOnly) {
                        layer.bindTooltip(`
                            <span style="font-size: 10px; font-weight: 600; color: #475569;">${escapeHtml(info.name)}</span>`,
                            { permanent: true, direction: "center", className: "map-label" });
                        layer.bindPopup(`
                            <div style="font-family: ${FONT_STACK}; min-width: 150px;">
                                <div style="font-weight: 600; font-size: 14px; margin-bottom: 6px; color: #1f2937; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px;">
                                    ${escapeHtml(info.name)}
                                </div>
                                <div style="font-size: 12px; color: #6b7280;">
                                    ${__("No creche data for the selected filters.")}
                                </div>
                            </div>`);
                    } else if (info.name) {

                        layer.bindTooltip(escapeHtml(info.name), {
                            permanent: false, direction: "center", className: "map-label"
                        });
                    }
                    return;
                }

                const matchName = info.match;
                const stats = ctx.groupedData[matchName];

                layer.bindTooltip(blockLabelHtml(matchName, level), {
                    permanent: true, direction: "center", className: "map-label"
                });

                const statusRow = (level === LEVEL_BLOCK && info.category)
                    ? `<div style="margin-bottom: 4px;"><b>${__("Status")}:</b> ${escapeHtml(CATEGORY_LABELS[info.category] || '')}</div>`
                    : '';

                layer.bindPopup(`
                    <div style="font-family: ${FONT_STACK}; min-width: 170px;">
                        <div style="font-weight: 600; font-size: 14px; margin-bottom: 8px; color: #1f2937; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px;">
                            ${escapeHtml(matchName)}
                        </div>
                        <div style="font-size: 13px; color: #4b5563;">
                            ${statusRow}
                            <div style="margin-bottom: 4px;"><b>Creches:</b> ${stats.creches.size}</div>
                            <div style="margin-bottom: 4px;"><b>GPs:</b> ${stats.gps.size}</div>
                            <div style="margin-bottom: 4px;"><b>Villages:</b> ${stats.villages.size}</div>
                        </div>
                    </div>`);

                if (level === LEVEL_STATE || level === LEVEL_DISTRICT) {
                    bindDrillDown(layer, map, level, matchName);
                } else if (level === LEVEL_BLOCK) {
                    bindBlockIsolate(layer, map, matchName);
                }

                layer.featureName = matchName;
                ctx.features.push(layer);
            }
        }).addTo(map);

        if (drew && bounds.isValid()) {

            map.invalidateSize({ animate: false });
            map.fitBounds(bounds, { padding: [24, 24], maxZoom: 12, animate: false });
            requestAnimationFrame(() => {
                if (!ctx.map || ctx.map !== map) return;
                map.invalidateSize({ animate: false });
                map.fitBounds(bounds, { padding: [24, 24], maxZoom: 12, animate: false });
            });

            autoIsolateFilteredBlock(map, level);
        } else {
            plotPoints(map, groupKey, groupLabel, colorFor);
        }
    }

    function blockLabelHtml(matchName, level) {
        if (level !== LEVEL_BLOCK) {
            return `<div style="display: flex; align-items: center; gap: 2px;">
                        <span style="width: 6px; height: 6px; background-color: #f472b6; border: 1px solid #9f1239; border-radius: 50%; display: inline-block;"></span>
                        <span style="font-size: 10px; font-weight: 500; color: #000;">${escapeHtml(matchName)}</span>
                    </div>`;
        }
        return `<span style="font-size: 10px; font-weight: 600; color: #0f172a;">${escapeHtml(matchName)}</span>`;
    }

    function findBlockLayer(matchName) {
        if (!ctx.geoLayer) return null;
        let found = null;
        ctx.geoLayer.eachLayer(child => {
            if (!found && child.featureName === matchName) found = child;
        });
        return found;
    }

    function autoIsolateFilteredBlock(map, level) {
        if (level !== LEVEL_BLOCK || !ctx.geoLayer) return;

        const blockValue = getFieldValue("block");
        if (!blockValue) return;

        const label = getFieldLabel("block");
        const wanted = new Set(
            [label, blockValue]
                .concat(Object.keys(ctx.blockNameToId)
                    .filter(name => ctx.blockNameToId[name] === blockValue))
                .filter(Boolean)
                .map(cleanName)
        );

        const candidates = [];
        ctx.geoLayer.eachLayer(child => {
            if (child.featureName) candidates.push(child);
        });
        if (!candidates.length) return;

        const layer = candidates.find(c => wanted.has(cleanName(c.featureName)))
            || (candidates.length === 1 ? candidates[0] : null);
        if (!layer) return;
        if (ctx.isolatedBlock === layer.featureName) return;

        isolateBlock(map, layer, layer.featureName);
    }

    function bindDebouncedClicks(layer, map, onDblClick) {
        let clickTimer = null;

        layer.on("click", (e) => {
            if (e.originalEvent) L.DomEvent.stop(e.originalEvent);
            if (clickTimer) return;
            clickTimer = setTimeout(() => {
                clickTimer = null;
                layer.openPopup(e.latlng);
            }, 220);
        });

        layer.on("dblclick", (e) => {
            if (e.originalEvent) L.DomEvent.stop(e.originalEvent);
            if (clickTimer) {
                clearTimeout(clickTimer);
                clickTimer = null;
            }
            map.closePopup();
            onDblClick();
        });
    }

    function bindBlockIsolate(layer, map, matchName) {
        bindDebouncedClicks(layer, map, () => {
            if (ctx.isolatedBlock === matchName) {
                clearBlockIsolation();
            } else {
                isolateBlock(map, layer, matchName);
            }
        });
    }

    function isolateBlock(map, layer, matchName) {
        if (!ctx.geoLayer) return;

        if (!ctx.isolatedBlock) {
            ctx.preIsolationView = {
                center: map.getCenter(),
                zoom: map.getZoom()
            };
        }
        ctx.isolatedBlock = matchName;

        ctx.geoLayer.eachLayer(child => {
            if (child === layer) {
                if (!map.hasLayer(child)) map.addLayer(child);
            } else if (map.hasLayer(child)) {
                map.removeLayer(child);
            }
        });

        layer.unbindTooltip();
        layer.setStyle({
            fillColor: BLOCK_GAP_COLOR, fillOpacity: 1,
            weight: 2, color: '#1f2937', className: 'boundary-shape'
        });

        try {
            map.fitBounds(layer.getBounds(), { padding: [40, 40], maxZoom: 14, animate: false });
        } catch (e) {  }

        ensureIsolatedOverlay();

        const blockId = ctx.blockNameToId[matchName] || "";
        if (blockId) {
            const values = collectValues();
            loadSummaryCards(Object.assign({}, values, { block: blockId }));
        }

        updateBackControl();
    }

    function clearBlockIsolation() {
        if (!ctx.isolatedBlock || !ctx.geoLayer || !ctx.map) return;
        const map = ctx.map;
        const wasIsolated = ctx.isolatedBlock;

        ctx.geoLayer.eachLayer(child => {
            if (!map.hasLayer(child)) map.addLayer(child);
        });

        const stats = ctx.groupedData[wasIsolated];
        ctx.geoLayer.eachLayer(child => {
            if (child.featureName !== wasIsolated) return;
            ctx.geoLayer.resetStyle(child);
            if (stats) {
                child.unbindTooltip();
                child.bindTooltip(blockLabelHtml(wasIsolated, LEVEL_BLOCK), {
                    permanent: true, direction: "center", className: "map-label"
                });
            }
        });

        const previous = ctx.preIsolationView;
        ctx.isolatedBlock = null;
        ctx.preIsolationView = null;

        if (previous) {
            map.setView(previous.center, previous.zoom, { animate: false });
        }

        ctx.overlayToken++;
        const gpLoadingEl = document.getElementById('map-gp-loading');
        if (gpLoadingEl) gpLoadingEl.style.display = 'none';
        if (ctx.crecheLayer) {
            map.removeLayer(ctx.crecheLayer);
            ctx.crecheLayer = null;
        }
        ctx.supervisorColors = null;
        updateOverlayLegend(ctx.overlayMode, null);

        loadSummaryCards(collectValues());
        updateBackControl();
    }

    function refreshLiveData(done) {
        const finish = () => {
            if (typeof done === 'function') done();
        };
        if (!ctx.map) {
            finish();
            return Promise.resolve();
        }

        if (ctx.isolatedBlock) {
            const blockName = ctx.isolatedBlock;
            const blockId = ctx.blockNameToId[blockName] || "";
            const values = collectValues();
            if (blockId) loadSummaryCards(Object.assign({}, values, { block: blockId }));

            crechePointsPromise = null;
            crechePointsKey = "";
            gpVillageStatusPromise = null;
            gpVillageStatusKey = "";
            ctx.crecheRows = [];
            ctx.overlayToken++;
            ctx.overlayPromise = null;
            if (ctx.crecheLayer) {
                ctx.map.removeLayer(ctx.crecheLayer);
                ctx.crecheLayer = null;
            }

            const pending = ensureIsolatedOverlay();
            pending.then(finish, finish);
            return pending;
        } else {
            loadSummaryCards(collectValues());
            finish();
            return Promise.resolve();
        }
    }

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) refreshLiveData();
    });
    window.addEventListener('focus', refreshLiveData);

    function bindDrillDown(layer, map, level, matchName) {
        bindDebouncedClicks(layer, map, () => {
            if (level === LEVEL_STATE) {
                drillToDistrictView(matchName);
            } else {
                drillToBlockView(matchName);
            }
        });
    }

    librariesReady
        .then(() => load_data())
        .catch((e) => {
            console.warn("Asset load failed; continuing without it.", e);
            load_data();
        });
};
