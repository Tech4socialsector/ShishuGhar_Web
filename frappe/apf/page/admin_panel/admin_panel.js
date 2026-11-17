frappe.pages['admin-panel'].on_page_load = function(wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Admin Panel',
		single_column: true
	});

    const BASE_URL = "https://shishughar.in";
    let last_results = null;
    let history_log = [];
    let current_page_num = 1;
    const PAGE_SIZE = 100;

    // Panel definitions: one entry per card / duplicate-ID module
    const PANELS = {
        creche_id: {
            key: "creche_id",
            num: "01",
            title: "Creche ID",
            subtitle: "Find and manage duplicate Creche IDs",
            icon: "fa-home",
            color: "blue",
            img_url: "https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/School/3D/school_3d.png",
            endpoint: "frappe.apf.page.admin_panel.duplicate_id_panel.fix_duplicate_creche_ids",
            doctype: "Creche",
            id_field: "creche_id",
            name_field: "creche_name",
            entity_label: "Creche",
            enabled: true
        },
        creche_caregiver_id: {
            key: "creche_caregiver_id",
            num: "02",
            title: "Creche Caregiver ID",
            subtitle: "Find and manage duplicate Caregiver IDs",
            icon: "fa-user-md",
            color: "purple",
            img_url: "https://thumbs.dreamstime.com/b/oco%C3%B1-rgb-354807626.jpg",
            endpoint: "frappe.apf.page.admin_panel.duplicate_id_panel.fix_duplicate_caregiver_ids",
            doctype: "Creche Caregiver",
            id_field: "caregiver_code",
            name_field: "caregiver_name",
            entity_label: "Caregiver",
            enabled: true
        },
        child_id: {
            key: "child_id",
            num: "03",
            title: "Child ID",
            subtitle: "Find and manage duplicate Child IDs",
            icon: "fa-child",
            color: "green",
            img_url: "https://png.pngtree.com/png-clipart/20250203/original/pngtree-animated-little-boy-png-image_20260023.png",
            endpoint: "frappe.apf.page.admin_panel.duplicate_id_panel.fix_duplicate_child_ids",
            doctype: "Child Enrollment and Exit",
            id_field: "child_id",
            name_field: "child_name",
            entity_label: "Child",
            enabled: true
        },
        scheduler: {
            key: "scheduler",
            num: "04",
            title: "Scheduler",
            subtitle: "Automate weekly duplicate-ID fixes",
            icon: "fa-clock-o",
            color: "amber",
            img_url: "https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Alarm%20clock/3D/alarm_clock_3d.png",
            endpoint: null,
            doctype: null,
            id_field: null,
            name_field: null,
            enabled: true,
            is_scheduler: true
        },
        creche_transfer: {
            key: "creche_transfer",
            num: "05",
            title: "Creche Transfer",
            subtitle: "Move all records from one Creche to another",
            icon: "fa-exchange",
            color: "teal",
            img_url: "https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Delivery%20truck/3D/delivery_truck_3d.png",
            endpoint: null,
            doctype: null,
            id_field: null,
            name_field: null,
            enabled: true,
            is_transfer: true
        }
    };

    const METHOD_PREFIX = "frappe.apf.page.admin_panel.duplicate_id_panel";
    const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

    // ==========================================
    // CSS
    // ==========================================
    const css = `
        <style>
            #dip-root { font-family: inherit; perspective: 1400px; }

            @keyframes dip-fade-up {
                from { opacity: 0; transform: translateY(14px); }
                to { opacity: 1; transform: translateY(0); }
            }
            @keyframes dip-fade-in {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            @keyframes dip-scale-in {
                from { opacity: 0; transform: scale(0.96) translateY(10px); }
                to { opacity: 1; transform: scale(1) translateY(0); }
            }
            @keyframes dip-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }

            .dip-page-header { margin-bottom: 26px; animation: dip-fade-up 0.4s ease both; }
            .dip-page-header h2 { font-weight: 700; margin-bottom: 2px; }

            .dip-view { animation: dip-fade-in 0.35s ease both; }

            /* ---------- Home / Stat Cards Redesign ---------- */
            #dip-cards-section { transition: opacity 0.3s ease, max-height 0.4s ease, margin 0.3s ease; overflow: hidden; }
            #dip-cards-section.dip-collapsed { opacity: 0; max-height: 0; margin: 0; pointer-events: none; }

            .stat-card-wrap { animation: dip-fade-up 0.5s ease both; }
            .stat-card-wrap:nth-child(1) { animation-delay: 0.05s; }
            .stat-card-wrap:nth-child(2) { animation-delay: 0.15s; }
            .stat-card-wrap:nth-child(3) { animation-delay: 0.25s; }
            .stat-card-wrap:nth-child(4) { animation-delay: 0.35s; }
            .stat-card-wrap:nth-child(5) { animation-delay: 0.45s; }

            .stat-card {
                position: relative;
                border-radius: 20px;
                padding: 24px;
                height: 100%;
                cursor: pointer;
                background: #ffffff;
                transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
                display: flex;
                flex-direction: row;
                justify-content: space-between;
                min-height: 200px;
                overflow: hidden;
                border: 2px solid transparent;
                box-shadow: 0 4px 15px rgba(0,0,0,0.03);
            }
            
            .stat-card.blue { border-color: #e0e7ff; background: linear-gradient(135deg, #ffffff 40%, #f0f5ff 100%); }
            .stat-card.purple { border-color: #ede9fe; background: linear-gradient(135deg, #ffffff 40%, #f5f3ff 100%); }
            .stat-card.green { border-color: #d1fae5; background: linear-gradient(135deg, #ffffff 40%, #ecfdf5 100%); }
            .stat-card.amber { border-color: #fef3c7; background: linear-gradient(135deg, #ffffff 40%, #fffbeb 100%); }
            .stat-card.teal { border-color: #ccfbf1; background: linear-gradient(135deg, #ffffff 40%, #f0fdfa 100%); }

            .stat-card:hover {
                transform: translateY(-8px);
                box-shadow: 0 20px 40px -10px rgba(0,0,0,0.12);
            }
            .stat-card:active { transform: scale(0.97) translateY(0); transition-duration: 0.1s; }
            
            .stat-card.disabled { cursor: not-allowed; opacity: 0.7; filter: grayscale(0.6); }
            .stat-card.disabled:hover { transform: none; box-shadow: 0 4px 15px rgba(0,0,0,0.03); }

            .stat-content {
                flex: 1;
                position: relative;
                z-index: 2;
                display: flex;
                flex-direction: column;
                justify-content: flex-start;
                max-width: 65%;
            }

            .stat-badge-container { margin-bottom: 16px; display: inline-block; position: relative; }
            .stat-badge {
                width: 40px; height: 40px; border-radius: 50%;
                display: flex; align-items: center; justify-content: center;
                font-weight: 700; font-size: 15px;
                position: relative; z-index: 2;
            }
            .stat-badge::before {
                content: ""; position: absolute; inset: -6px; border-radius: 50%; z-index: -1; opacity: 0.25;
            }
            
            .stat-badge.blue { background: #3b82f6; color: #fff; }
            .stat-badge.blue::before { background: #3b82f6; }
            .stat-badge.purple { background: #8b5cf6; color: #fff; }
            .stat-badge.purple::before { background: #8b5cf6; }
            .stat-badge.green { background: #10b981; color: #fff; }
            .stat-badge.green::before { background: #10b981; }
            .stat-badge.amber { background: #f59e0b; color: #fff; }
            .stat-badge.amber::before { background: #f59e0b; }
            .stat-badge.teal { background: #14b8a6; color: #fff; }
            .stat-badge.teal::before { background: #14b8a6; }

            .stat-card h4 { color: #111827; font-weight: 800; font-size: 18px; margin-bottom: 6px; letter-spacing: -0.3px; }
            .stat-card .stat-sub { color: #6b7280; font-size: 13px; line-height: 1.4; margin-bottom: auto; }

            .stat-cta-container { margin-top: 16px; }
            .stat-cta {
                display: inline-flex; align-items: center; justify-content: space-between;
                padding: 8px 16px; border-radius: 12px;
                font-weight: 600; font-size: 12.5px;
                background: #ffffff;
                border: 1px solid rgba(0,0,0,0.05);
                box-shadow: 0 4px 6px rgba(0,0,0,0.02);
                transition: all 0.3s ease;
            }
            .stat-card:hover .stat-cta {
                box-shadow: 0 6px 12px rgba(0,0,0,0.08);
                padding-right: 12px;
            }
            .stat-cta i { transition: transform 0.3s ease; margin-left: 6px; }
            .stat-card:hover .stat-cta i { transform: translateX(4px); }

            .stat-cta.blue { color: #2563eb; }
            .stat-cta.purple { color: #7c3aed; }
            .stat-cta.green { color: #059669; }
            .stat-cta.amber { color: #d97706; }
            .stat-cta.teal { color: #0d9488; }

            .stat-image {
                position: absolute;
                right: -10px;
                bottom: 0px;
                width: 140px;
                height: 140px;
                z-index: 1;
                transition: transform 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            }
            .stat-image img {
                width: 100%; height: 100%; object-fit: contain;
                filter: drop-shadow(0 15px 15px rgba(0,0,0,0.15));
            }
            .stat-card:hover .stat-image {
                transform: scale(1.1) translateY(-8px) rotate(-3deg);
            }

            .badge-soon {
                background: rgba(0,0,0,0.06);
                color: #6b7280;
                font-size: 10px;
                font-weight: 700;
                padding: 2px 8px;
                border-radius: 999px;
                margin-left: 6px;
                text-transform: uppercase;
            }

            /* ---------- Active panel mini header ---------- */
            .dip-active-strip {
                display: flex;
                align-items: center;
                justify-content: space-between;
                background: #fff;
                border-radius: 14px;
                padding: 14px 20px;
                margin-bottom: 18px;
                box-shadow: 0 2px 8px rgba(15,23,42,0.06);
                animation: dip-fade-up 0.35s ease both;
            }
            .dip-active-strip .icon-circle {
                width: 40px; height: 40px; border-radius: 50%;
                display: flex; align-items: center; justify-content: center;
                font-size: 16px; margin-right: 12px;
            }
            .back-link {
                cursor: pointer;
                color: #2563eb;
                font-weight: 600;
                font-size: 13px;
                display: inline-flex;
                align-items: center;
                transition: transform 0.2s ease;
            }
            .back-link:hover { transform: translateX(-3px); color: #1d4ed8; }

            /* ---------- Module panel ---------- */
            .module-panel {
                background: #ffffff;
                border-radius: 18px;
                box-shadow: 0 4px 20px rgba(15,23,42,0.06);
                border: 1px solid #f3f4f6;
                overflow: hidden;
                animation: dip-scale-in 0.4s cubic-bezier(.22,1,.36,1) both;
            }
            .module-panel-header {
                padding: 22px 24px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                flex-wrap: wrap;
                gap: 12px;
                border-bottom: 1px solid #f3f4f6;
                background: linear-gradient(180deg, #fafbff, #ffffff);
            }
            .module-panel-title { display: flex; align-items: center; }
            .module-panel-title .icon-circle {
                width: 44px; height: 44px; border-radius: 14px;
                display: flex; align-items: center; justify-content: center;
                font-size: 19px; margin-right: 14px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.06);
            }
            .module-panel-title h4 { font-weight: 700; margin-bottom: 2px; }

            .btn-find, .btn-fix, .btn-edit-manual {
                transition: transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
            }
            .btn-find { background: #2563eb; color: white; font-weight: 600; border-radius: 9px; padding: 8px 16px; border: none; font-size: 13px; }
            .btn-find:hover { background: #1d4ed8; color: white; transform: translateY(-1px); box-shadow: 0 6px 14px rgba(37,99,235,0.3); }
            .btn-fix { background: #10b981; color: white; font-weight: 600; border-radius: 9px; padding: 8px 16px; border: none; font-size: 13px; }
            .btn-fix:hover { background: #059669; color: white; transform: translateY(-1px); box-shadow: 0 6px 14px rgba(16,185,129,0.3); }
            .btn-edit-manual { background: #fffbeb; color: #d97706; font-weight: 600; border-radius: 9px; padding: 8px 16px; border: 1px solid #fde68a; font-size: 13px; }
            .btn-edit-manual:hover { background: #fef3c7; color: #b45309; transform: translateY(-1px); }
            .btn-find:disabled, .btn-fix:disabled, .btn-edit-manual:disabled { opacity: 0.55; cursor: not-allowed; transform: none !important; box-shadow: none !important; }
            .btn-find:active, .btn-fix:active { transform: translateY(0) scale(0.97) !important; }

            /* ---------- Tabs ---------- */
            .dip-tabs {
                display: flex;
                gap: 24px;
                padding: 0 24px;
                border-bottom: 1px solid #f3f4f6;
            }
            .dip-tab {
                padding: 14px 2px;
                font-size: 14px;
                font-weight: 600;
                color: #6b7280;
                cursor: pointer;
                border-bottom: 2px solid transparent;
                transition: color 0.2s ease, border-color 0.2s ease;
            }
            .dip-tab:hover { color: #374151; }
            .dip-tab.active { color: #2563eb; border-bottom-color: #2563eb; }
            .dip-tab-content { padding: 20px 24px; animation: dip-fade-in 0.25s ease both; }

            /* ---------- Results table ---------- */
            .dip-table-toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; flex-wrap: wrap; gap: 10px; }
            .dip-count-badge { background: #fee2e2; color: #b91c1c; font-weight: 600; font-size: 12px; padding: 3px 10px; border-radius: 999px; margin-left: 8px; }

            .dip-table-scroll {
                max-height: 560px;
                overflow-y: auto;
                border: 1px solid #f3f4f6;
                border-radius: 12px;
            }
            .dip-table-scroll::-webkit-scrollbar { width: 8px; }
            .dip-table-scroll::-webkit-scrollbar-thumb { background: #e5e7eb; border-radius: 8px; }
            .dip-table-scroll::-webkit-scrollbar-thumb:hover { background: #d1d5db; }

            table.dip-table { width: 100%; font-size: 13px; border-collapse: collapse; }
            table.dip-table thead th {
                position: sticky; top: 0; z-index: 1;
                color: #6b7280; font-weight: 600; font-size: 11.5px; text-transform: uppercase;
                padding: 10px; background: #f9fafb; border-bottom: 1px solid #f3f4f6; text-align: left;
            }
            table.dip-table td { padding: 10px; border-bottom: 1px solid #f9fafb; vertical-align: middle; }
            table.dip-table tbody tr { transition: background 0.15s ease; }
            table.dip-table tbody tr:hover td { background: #fafaff; }
            .id-pill { background: #f3f4f6; padding: 2px 8px; border-radius: 6px; font-family: 'Consolas', monospace; font-size: 12px; }
            .count-pill { background: #fee2e2; color: #b91c1c; font-weight: 700; padding: 2px 10px; border-radius: 999px; font-size: 12px; }
            .icon-btn { width: 28px; height: 28px; border-radius: 7px; border: 1px solid #e5e7eb; background: #fff; margin-right: 4px; color: #6b7280; transition: 0.2s ease; }
            .icon-btn:hover { background: #f3f4f6; transform: translateY(-1px); }
            .icon-btn.view-btn:hover { color: #2563eb; border-color: #bfdbfe; }
            .icon-btn.edit-btn:hover { color: #d97706; border-color: #fde68a; }
            .dip-empty { text-align: center; padding: 44px 0; color: #9ca3af; animation: dip-fade-in 0.3s ease both; }

            .dip-pagination { display: flex; justify-content: space-between; align-items: center; margin-top: 14px; font-size: 13px; color: #6b7280; flex-wrap: wrap; gap: 10px; }
            .dip-pagination .page-btns { display: flex; gap: 6px; flex-wrap: wrap; }
            .dip-pagination button { border: 1px solid #e5e7eb; background: #fff; border-radius: 7px; padding: 4px 11px; font-size: 12px; transition: 0.2s ease; }
            .dip-pagination button:not(:disabled):hover { border-color: #93c5fd; color: #2563eb; }
            .dip-pagination button.active { background: #2563eb; color: white; border-color: #2563eb; }
            .dip-pagination button:disabled { opacity: 0.5; cursor: not-allowed; }

            .group-detail-row td { background: #fafbff; animation: dip-fade-in 0.2s ease both; }
            .group-detail-row .record-line { padding: 4px 0; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px dashed #e5e7eb; }
            .group-detail-row .record-line:last-child { border-bottom: none; }

            /* ---------- Terminal / process log ---------- */
            .terminal-container {
                background: #1e1e2d;
                border-radius: 14px;
                margin-top: 24px;
                overflow: hidden;
                box-shadow: 0 8px 24px rgba(15,23,42,0.15);
                animation: dip-fade-up 0.4s ease both;
            }
            .terminal-header {
                background: #151521;
                padding: 12px 20px;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            .terminal-header .live-dot { width: 8px; height: 8px; border-radius: 50%; background: #10b981; display: inline-block; margin-right: 6px; animation: dip-pulse 1.5s infinite; }
            .terminal-body {
                padding: 20px;
                height: 300px;
                overflow-y: auto;
            }
            .terminal-body pre {
                color: #a1a1aa;
                font-family: 'Consolas', 'Courier New', monospace;
                font-size: 13px;
                background: transparent;
                border: none;
                margin: 0;
                padding: 0;
                white-space: pre-wrap;
            }
            .term-btn { border-radius: 7px; padding: 4px 12px; font-size: 12px; font-weight: 600; color: white; border: none; cursor: pointer; transition: transform 0.15s ease, opacity 0.15s ease; }
            .term-btn:hover { transform: translateY(-1px); opacity: 0.92; }
            .term-btn-excel { background: #10b981; }
            .term-btn-json { background: #4f46e5; }
            .term-btn-clear { background: #374151; }

            /* ---------- History log ---------- */
            .history-item { display: flex; align-items: flex-start; padding: 10px 0; border-bottom: 1px solid #f3f4f6; animation: dip-fade-up 0.3s ease both; }
            .history-item:last-child { border-bottom: none; }
            .history-icon { width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-right: 12px; font-size: 13px; flex-shrink: 0; }
            .history-icon.success { background: #ecfdf5; color: #059669; }
            .history-icon.error { background: #fef2f2; color: #dc2626; }
            .history-icon.running { background: #eff6ff; color: #2563eb; }
            .history-time { color: #9ca3af; font-size: 12px; }

            /* ---------- Edit Manual tab ---------- */
            .edit-search-row { display: flex; gap: 10px; margin-bottom: 16px; }
            .edit-search-row input {
                flex: 1; border: 1px solid #e5e7eb; border-radius: 9px; padding: 8px 12px; font-size: 13px;
                transition: border-color 0.2s ease, box-shadow 0.2s ease;
            }
            .edit-search-row input:focus { outline: none; border-color: #93c5fd; box-shadow: 0 0 0 3px rgba(37,99,235,0.12); }

            /* ---------- Scheduler card + panel ---------- */
            .scheduler-status-inline { display: flex; align-items: center; margin-top: 10px; margin-bottom: auto; }
            .sched-dot { width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; display: inline-block; }
            .sched-dot.on { background: #10b981; animation: dip-pulse 1.5s infinite; }
            .sched-dot.off { background: #d1d5db; }

            .sched-config-card {
                background: #fff;
                border-radius: 14px;
                border: 1px solid #f3f4f6;
                padding: 24px;
                box-shadow: 0 2px 8px rgba(15,23,42,0.05);
            }
            .sched-toggle-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; padding-bottom: 20px; border-bottom: 1px solid #f3f4f6; }
            .sched-toggle-label { font-weight: 700; font-size: 15px; }
            .sched-toggle-sub { color: #6b7280; font-size: 12.5px; margin-top: 2px; }

            .sched-switch { position: relative; display: inline-block; width: 46px; height: 26px; flex-shrink: 0; }
            .sched-switch input { opacity: 0; width: 0; height: 0; }
            .sched-switch .slider {
                position: absolute; cursor: pointer; inset: 0;
                background: #d1d5db; transition: 0.25s; border-radius: 999px;
            }
            .sched-switch .slider::before {
                content: ""; position: absolute; height: 20px; width: 20px; left: 3px; bottom: 3px;
                background: white; transition: 0.25s; border-radius: 50%; box-shadow: 0 1px 3px rgba(0,0,0,0.25);
            }
            .sched-switch input:checked + .slider { background: #10b981; }
            .sched-switch input:checked + .slider::before { transform: translateX(20px); }

            .sched-fields-row { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 22px; }
            .sched-field { flex: 1; min-width: 180px; }
            .sched-field label { font-weight: 600; font-size: 12.5px; color: #374151; margin-bottom: 6px; display: block; }
            .sched-field select, .sched-field input[type="time"] {
                width: 100%; border: 1px solid #e5e7eb; border-radius: 9px; padding: 9px 12px; font-size: 13.5px;
                transition: border-color 0.2s ease, box-shadow 0.2s ease; background: #fff;
            }
            .sched-field select:focus, .sched-field input[type="time"]:focus {
                outline: none; border-color: #93c5fd; box-shadow: 0 0 0 3px rgba(37,99,235,0.12);
            }
            .sched-actions { display: flex; gap: 10px; }
            .btn-sched-save { background: #2563eb; color: #fff; font-weight: 600; border-radius: 9px; padding: 9px 20px; border: none; font-size: 13px; transition: 0.2s ease; }
            .btn-sched-save:hover { background: #1d4ed8; transform: translateY(-1px); box-shadow: 0 6px 14px rgba(37,99,235,0.3); }
            .btn-sched-run { background: #fff; color: #374151; font-weight: 600; border-radius: 9px; padding: 9px 20px; border: 1px solid #e5e7eb; font-size: 13px; transition: 0.2s ease; }
            .btn-sched-run:hover { border-color: #d1d5db; background: #f9fafb; transform: translateY(-1px); }
            .btn-sched-save:disabled, .btn-sched-run:disabled { opacity: 0.6; cursor: not-allowed; transform: none !important; }

            .sched-next-run {
                margin-top: 18px; padding: 12px 16px; border-radius: 10px;
                background: #eff6ff; color: #1d4ed8; font-size: 13px; display: flex; align-items: center;
            }
            .sched-next-run i { margin-right: 8px; }

            /* Scheduler logs */
            .sched-logs-toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
            .status-pill { padding: 3px 10px; border-radius: 999px; font-size: 11.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px; }
            .status-pill.success { background: #ecfdf5; color: #059669; }
            .status-pill.error { background: #fef2f2; color: #dc2626; }
            .status-pill.skipped { background: #f3f4f6; color: #6b7280; }
            .trigger-pill { padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; background: #f3f4f6; color: #6b7280; }
            .trigger-pill.manual { background: #eff6ff; color: #1d4ed8; }

            .sched-log-json-row td { background: #fafbff; animation: dip-fade-in 0.2s ease both; padding: 0; }
            .sched-json-block { padding: 14px 16px; }
            .sched-json-block-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
            .sched-json-pre {
                background: #1e1e2d; color: #a1a1aa; border-radius: 10px; padding: 14px 16px;
                font-family: 'Consolas', 'Courier New', monospace; font-size: 12.5px;
                margin: 0; white-space: pre-wrap; word-break: break-word;
                max-height: 320px; overflow-y: auto;
            }

            /* ---------- Creche Transfer ---------- */
            #transfer-from-link .control-input-wrapper, #transfer-to-link .control-input-wrapper { width: 100%; }
            #transfer-from-link input, #transfer-to-link input { font-size: 13px; }

            .transfer-fields-block { margin: 20px 0; }
            .transfer-fields-block > label { font-weight: 600; font-size: 12.5px; color: #374151; margin-bottom: 10px; display: block; }
            .transfer-fields-grid { display: flex; flex-wrap: wrap; gap: 10px; }
            .transfer-field-checkbox {
                display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 500; color: #374151;
                background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 7px 12px;
                cursor: pointer; margin: 0; transition: 0.2s ease;
            }
            .transfer-field-checkbox:hover { border-color: #99f6e4; background: #f0fdfa; }
            .transfer-field-checkbox input { margin: 0; }

            .transfer-preview-block { margin: 20px 0; padding: 16px; background: #f9fafb; border-radius: 10px; }
            .transfer-preview-total { font-size: 13px; color: #374151; margin-bottom: 10px; }
            .transfer-preview-rows { display: flex; flex-direction: column; gap: 6px; max-height: 220px; overflow-y: auto; }
            .transfer-preview-row { display: flex; justify-content: space-between; align-items: center; font-size: 13px; padding: 4px 0; border-bottom: 1px dashed #e5e7eb; }
            .transfer-preview-row:last-child { border-bottom: none; }
            .transfer-preview-empty { margin: 20px 0; padding: 16px; text-align: center; color: #9ca3af; font-size: 13px; background: #f9fafb; border-radius: 10px; }

            .transfer-progress-card { background: #fff; border-radius: 14px; border: 1px solid #f3f4f6; padding: 24px; }
            .transfer-progress-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }

            .transfer-timer-block {
                text-align: center; background: #0f172a; border-radius: 12px;
                padding: 18px 16px; margin-bottom: 20px;
            }
            .transfer-timer-label { color: #94a3b8; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
            .transfer-timer-clock {
                color: #5eead4; font-family: 'Consolas', 'Courier New', monospace;
                font-size: 32px; font-weight: 700; letter-spacing: 2px;
            }

            .transfer-progress-bar-outer { width: 100%; height: 14px; background: #f3f4f6; border-radius: 999px; overflow: hidden; margin-bottom: 10px; }
            .transfer-progress-bar-inner {
                height: 100%; background: linear-gradient(90deg, #0f766e, #14b8a6);
                border-radius: 999px; transition: width 0.4s ease;
            }
            .transfer-progress-pct {
                font-family: 'Consolas', 'Courier New', monospace; font-size: 13px; color: #374151;
                margin-bottom: 14px; display: flex; align-items: center; gap: 8px;
            }
            .transfer-ascii-bar { color: #0f766e; letter-spacing: -1px; }
            .transfer-progress-stats { display: flex; gap: 24px; font-size: 13px; color: #374151; margin-bottom: 10px; flex-wrap: wrap; }
            .transfer-progress-stats strong { color: #0f766e; }
            .transfer-progress-timing { display: flex; gap: 24px; font-size: 13px; color: #6b7280; margin-bottom: 20px; flex-wrap: wrap; }
            .transfer-progress-timing strong { color: #374151; }
            .transfer-doctype-list { display: flex; flex-direction: column; gap: 8px; max-height: 320px; overflow-y: auto; }
            .transfer-doctype-row {
                display: flex; justify-content: space-between; align-items: center;
                padding: 8px 12px; border-radius: 8px; background: #f9fafb; font-size: 12.5px;
            }
            .transfer-doctype-row.running { background: #eff6ff; }
            .transfer-doctype-row.done { background: #ecfdf5; }
            .transfer-doctype-name { font-weight: 600; color: #374151; flex: 1; }
            .transfer-doctype-count { color: #6b7280; margin: 0 12px; }

            .btn-revert-transfer { font-size: 12px; padding: 5px 12px; }
        </style>
    `;

    page.main.html(`${css}<div class="px-2 py-2" id="dip-root"></div>`);
    const $root = page.main.find('#dip-root');

    render_home();

    // ==========================================
    // HOME VIEW
    // ==========================================
    function render_home() {
        last_results = null;
        history_log = [];

        $root.html(`
            <div id="dip-cards-section" class="row"></div>
            <div id="dip-panel-section"></div>
        `);

        render_stat_cards(null);
        bind_card_clicks();
    }

    function render_stat_cards(active_key) {
        const cards = Object.values(PANELS).map(panel => `
            <div class="col-lg-4 col-md-6 mb-4 stat-card-wrap">
                <div class="stat-card ${panel.color} ${panel.enabled ? '' : 'disabled'} ${active_key === panel.key ? 'active' : ''}" data-panel="${panel.key}">
                    <div class="stat-content">
                        <div class="stat-badge-container">
                            <div class="stat-badge ${panel.color}"><span>${panel.is_scheduler ? '<i class="fa fa-clock-o"></i>' : panel.is_transfer ? '<i class="fa fa-exchange"></i>' : panel.num}</span></div>
                        </div>
                        <h4>${panel.title} ${panel.enabled ? '' : '<span class="badge-soon">Soon</span>'}</h4>
                        <div class="stat-sub">${panel.subtitle}</div>
                        ${panel.is_scheduler ? '<div class="scheduler-status-inline" id="scheduler-status-inline"></div>' : ''}
                        
                        <div class="stat-cta-container">
                            <div class="stat-cta ${panel.color}">
                                ${panel.enabled ? 'Click to Manage' : 'Not configured'} <i class="fa fa-angle-right"></i>
                            </div>
                        </div>
                    </div>
                    <div class="stat-image">
                        <img src="${panel.img_url}" alt="${panel.title}" />
                    </div>
                </div>
            </div>
        `).join('');
        
        $('#dip-cards-section').html(cards);
        refresh_scheduler_status_badge();
    }

    // Small enabled/disabled indicator shown directly on the Scheduler card
    function refresh_scheduler_status_badge() {
        const $el = $root.find('#scheduler-status-inline');
        if (!$el.length) return;
        frappe.call({
            method: `${METHOD_PREFIX}.get_scheduler_settings`,
            callback: function(r) {
                const config = (r.message && r.message.config) || {};
                const on = frappe.utils.cint(config.enabled);
                $el.html(`
                    <span class="sched-dot ${on ? 'on' : 'off'}"></span>
                    <span class="small" style="color: #6b7280; font-weight: 500;">${on ? `Active — ${config.day} ${config.time}` : 'Disabled'}</span>
                `);
            }
        });
    }

    function bind_card_clicks() {
        $root.find('#dip-cards-section').on('click', '.stat-card', function() {
            const key = $(this).data('panel');
            const panel = PANELS[key];
            if (!panel.enabled) return;
            if (panel.is_scheduler) {
                open_scheduler_panel(panel);
            } else if (panel.is_transfer) {
                open_creche_transfer_panel(panel);
            } else {
                open_panel(panel);
            }
        });
    }

    // ==========================================
    // PANEL VIEW (cards hide, panel slides in)
    // ==========================================
    function open_panel(panel) {
        last_results = null;
        history_log = [];
        current_page_num = 1;

        // Hide the cards with a smooth collapse
        $root.find('#dip-cards-section').addClass('dip-collapsed');

        const $panelSection = $root.find('#dip-panel-section');
        $panelSection.html(`
            <div class="dip-view">
                <div class="dip-active-strip">
                    <div class="d-flex align-items-center">
                        <div class="icon-circle stat-card ${panel.color}" style="padding:0;min-height:auto;cursor:default;box-shadow:none;">
                            <i class="fa ${panel.icon}"></i>
                        </div>
                        <div>
                            <div class="font-weight-bold">${panel.title}</div>
                            <div class="text-muted small">${panel.subtitle}</div>
                        </div>
                    </div>
                    <div class="back-link" id="btn-back"><i class="fa fa-arrow-left mr-2"></i> Back to all modules</div>
                </div>

                <div class="module-panel">
                    <div class="module-panel-header">
                        <div class="module-panel-title">
                            <div class="icon-circle stat-card ${panel.color}" style="min-height:auto;padding:0;cursor:default;box-shadow:none;">
                                <i class="fa ${panel.icon}"></i>
                            </div>
                            <div>
                                <h4 class="mb-0">${panel.title} Management</h4>
                                <div class="text-muted small">Find, view and fix duplicate ${panel.title}s</div>
                            </div>
                        </div>
                        <div class="d-flex" style="gap:8px;">
                            <button class="btn-find" id="btn-start-find" ${panel.enabled ? '' : 'disabled'}>
                                <i class="fa fa-search mr-1"></i> Find Duplicate
                            </button>
                            <button class="btn-fix" id="btn-start-fix" ${panel.enabled ? '' : 'disabled'}>
                                <i class="fa fa-wrench mr-1"></i> Fix Duplicate
                            </button>
                            <button class="btn-edit-manual" id="btn-edit-manual-tab" ${panel.enabled ? '' : 'disabled'}>
                                <i class="fa fa-pencil mr-1"></i> Edit ID Manual
                            </button>
                        </div>
                    </div>

                    ${!panel.enabled ? `
                    <div class="dip-tab-content">
                        <div class="alert alert-warning mb-0">
                            Logic for <strong>${panel.title}</strong> has not been configured yet. Come back once the duplicate-detection query is available.
                        </div>
                    </div>` : `
                    <div class="dip-tabs">
                        <div class="dip-tab active" data-tab="results">Duplicate Records</div>
                        <div class="dip-tab" data-tab="edit">Edit ID Manual</div>
                        <div class="dip-tab" data-tab="idchangelog">ID Change Logs</div>
                        <div class="dip-tab" data-tab="history">History Log</div>
                    </div>

                    <div class="dip-tab-content" id="tab-results">
                        <div class="dip-table-toolbar">
                            <div>
                                <strong>Duplicate ${panel.title}s Found</strong>
                                <span class="dip-count-badge" id="dip-group-count" style="display:none;"></span>
                            </div>
                            <span class="text-muted small" style="cursor:pointer;" id="btn-export-results"><i class="fa fa-download mr-1"></i>Export</span>
                        </div>
                        <div id="results-wrap">
                            <div class="dip-empty">Click "Find Duplicate" to scan for duplicate ${panel.title}s.</div>
                        </div>
                    </div>

                    <div class="dip-tab-content" id="tab-edit" style="display:none;">
                        <div class="edit-search-row">
                            <input type="text" id="edit-search-input" placeholder="Search by ${panel.title} or name...">
                            <button class="btn-find" id="btn-edit-search"><i class="fa fa-search mr-1"></i> Search</button>
                        </div>
                        <div id="edit-search-results">
                            <div class="dip-empty">Search for a record to edit its ${panel.title}.</div>
                        </div>
                    </div>

                    <div class="dip-tab-content" id="tab-idchangelog" style="display:none;">
                        <div class="sched-logs-toolbar">
                            <strong>ID Change History</strong>
                            <span class="text-muted small">Showing last 90 days</span>
                        </div>
                        <div id="idchangelog-wrap">
                            <div class="dip-empty">Loading...</div>
                        </div>
                    </div>

                    <div class="dip-tab-content" id="tab-history" style="display:none;">
                        <div id="history-list"><div class="dip-empty">No activity yet.</div></div>
                    </div>
                    `}
                </div>

                <div class="terminal-container">
                    <div class="terminal-header">
                        <div>
                            <span class="live-dot"></span>
                            <span class="text-white font-weight-bold mr-2">Process Log</span>
                            <span class="text-muted small">Live</span>
                        </div>
                        <div class="d-flex align-items-center">
                            <button class="term-btn term-btn-clear mr-2" id="btn-clear-log">Clear</button>
                            <button class="term-btn term-btn-excel mr-2" id="btn-dl-excel"><i class="fa fa-file-excel-o mr-1"></i> Excel</button>
                            <button class="term-btn term-btn-json" id="btn-dl-json"><i class="fa fa-file-code-o mr-1"></i> JSON</button>
                        </div>
                    </div>
                    <div class="terminal-body" id="term-body">
                        <pre id="term-content"></pre>
                    </div>
                </div>
            </div>
        `);

        $panelSection.find('#btn-back').on('click', close_panel);

        if (panel.enabled) {
            bind_tabs(panel);
            bind_panel_actions(panel);
            bind_edit_manual_tab(panel);
        }

        // Scroll the panel into view smoothly
        $panelSection[0].scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function close_panel() {
        $(document).off('click.transfer-to-dismiss');
        $root.find('#dip-panel-section').html('');
        $root.find('#dip-cards-section').removeClass('dip-collapsed');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // ==========================================
    // SCHEDULER PANEL (config + 90-day logs)
    // ==========================================
    function open_scheduler_panel(panel) {
        $root.find('#dip-cards-section').addClass('dip-collapsed');

        const $panelSection = $root.find('#dip-panel-section');
        $panelSection.html(`
            <div class="dip-view">
                <div class="dip-active-strip">
                    <div class="d-flex align-items-center">
                        <div class="icon-circle stat-card ${panel.color}" style="padding:0;min-height:auto;cursor:default;box-shadow:none;">
                            <i class="fa ${panel.icon}"></i>
                        </div>
                        <div>
                            <div class="font-weight-bold">${panel.title}</div>
                            <div class="text-muted small">${panel.subtitle}</div>
                        </div>
                    </div>
                    <div class="back-link" id="btn-back"><i class="fa fa-arrow-left mr-2"></i> Back to all modules</div>
                </div>

                <div class="module-panel">
                    <div class="module-panel-header">
                        <div class="module-panel-title">
                            <div class="icon-circle stat-card ${panel.color}" style="min-height:auto;padding:0;cursor:default;box-shadow:none;">
                                <i class="fa ${panel.icon}"></i>
                            </div>
                            <div>
                                <h4 class="mb-0">Weekly Scheduler</h4>
                                <div class="text-muted small">Automatically runs Fix Duplicate for all configured modules</div>
                            </div>
                        </div>
                    </div>

                    <div class="dip-tabs">
                        <div class="dip-tab active" data-tab="sched-config">Configuration</div>
                        <div class="dip-tab" data-tab="sched-logs">Scheduler Logs (90 days)</div>
                    </div>

                    <div class="dip-tab-content" id="tab-sched-config">
                        <div class="sched-config-card">
                            <div class="sched-toggle-row">
                                <div>
                                    <div class="sched-toggle-label">Enable Weekly Scheduler</div>
                                    <div class="sched-toggle-sub">When enabled, duplicate IDs across all configured modules are fixed automatically every week.</div>
                                </div>
                                <label class="sched-switch">
                                    <input type="checkbox" id="sched-enabled-toggle">
                                    <span class="slider"></span>
                                </label>
                            </div>

                            <div class="sched-fields-row">
                                <div class="sched-field">
                                    <label>Day of Week</label>
                                    <select id="sched-day-select">
                                        ${WEEKDAYS.map(d => `<option value="${d}">${d}</option>`).join('')}
                                    </select>
                                </div>
                                <div class="sched-field">
                                    <label>Time (24-hour, server time)</label>
                                    <input type="time" id="sched-time-input" value="02:00">
                                </div>
                            </div>

                            <div class="sched-actions">
                                <button class="btn-sched-save" id="btn-sched-save"><i class="fa fa-check mr-1"></i> Save Schedule</button>
                                <button class="btn-sched-run" id="btn-sched-run"><i class="fa fa-bolt mr-1"></i> Run Now</button>
                            </div>

                            <div class="sched-next-run" id="sched-next-run" style="display:none;"></div>
                        </div>
                    </div>

                    <div class="dip-tab-content" id="tab-sched-logs" style="display:none;">
                        <div class="sched-logs-toolbar">
                            <strong>Execution History</strong>
                            <span class="text-muted small">Showing last 90 days</span>
                        </div>
                        <div id="sched-logs-wrap">
                            <div class="dip-empty"><i class="fa fa-spinner fa-spin mr-2"></i>Loading logs...</div>
                        </div>
                    </div>
                </div>
            </div>
        `);

        $panelSection.find('#btn-back').on('click', close_panel);
        bind_scheduler_tabs();
        load_scheduler_settings_into_form();
        bind_scheduler_actions();

        $panelSection[0].scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function bind_scheduler_tabs() {
        const $panelSection = $root.find('#dip-panel-section');
        $panelSection.find('.dip-tab').on('click', function() {
            const tab = $(this).data('tab');
            $panelSection.find('.dip-tab').removeClass('active');
            $(this).addClass('active');
            $panelSection.find('#tab-sched-config, #tab-sched-logs').hide();
            $panelSection.find(`#tab-${tab}`).show();
            if (tab === 'sched-logs') {
                load_scheduler_logs();
            }
        });
    }

    function load_scheduler_settings_into_form() {
        const $panelSection = $root.find('#dip-panel-section');
        frappe.call({
            method: `${METHOD_PREFIX}.get_scheduler_settings`,
            callback: function(r) {
                const config = (r.message && r.message.config) || {};
                $panelSection.find('#sched-enabled-toggle').prop('checked', !!frappe.utils.cint(config.enabled));
                $panelSection.find('#sched-day-select').val(config.day || 'Sunday');
                $panelSection.find('#sched-time-input').val(config.time || '02:00');
                update_next_run_hint(config);
            }
        });
    }

    function update_next_run_hint(config) {
        const $hint = $root.find('#sched-next-run');
        if (!frappe.utils.cint(config.enabled)) {
            $hint.hide();
            return;
        }
        $hint.show().html(`<i class="fa fa-info-circle"></i> Next run: every <strong>${config.day}</strong> at <strong>${config.time}</strong> (server time). All enabled modules will be auto-fixed.`);
    }

    function bind_scheduler_actions() {
        const $panelSection = $root.find('#dip-panel-section');

        $panelSection.find('#btn-sched-save').on('click', function() {
            const btn = $(this);
            const enabled = $panelSection.find('#sched-enabled-toggle').is(':checked') ? 1 : 0;
            const day = $panelSection.find('#sched-day-select').val();
            const time = $panelSection.find('#sched-time-input').val() || '02:00';

            btn.prop('disabled', true).html('<i class="fa fa-spinner fa-spin mr-1"></i> Saving...');

            frappe.call({
                method: `${METHOD_PREFIX}.save_scheduler_settings`,
                args: { enabled, day, time },
                callback: function(r) {
                    if (r.message && r.message.status === 'success') {
                        frappe.show_alert({ message: __('Scheduler settings saved'), indicator: 'green' });
                        update_next_run_hint(r.message.config);
                        refresh_scheduler_status_badge();
                    }
                },
                always: function() {
                    btn.prop('disabled', false).html('<i class="fa fa-check mr-1"></i> Save Schedule');
                }
            });
        });

        $panelSection.find('#btn-sched-run').on('click', function() {
            frappe.confirm('Run the duplicate-ID fix for all configured modules right now?', () => {
                const btn = $panelSection.find('#btn-sched-run');
                btn.prop('disabled', true).html('<i class="fa fa-spinner fa-spin mr-1"></i> Running...');

                frappe.call({
                    method: `${METHOD_PREFIX}.run_scheduler_now`,
                    callback: function(r) {
                        const status = r.message && r.message.status;
                        frappe.show_alert({
                            message: status === 'success' ? __('Scheduler run completed successfully') : __('Scheduler run completed with errors'),
                            indicator: status === 'success' ? 'green' : 'red'
                        });
                        if ($panelSection.find('.dip-tab[data-tab="sched-logs"]').hasClass('active')) {
                            load_scheduler_logs();
                        }
                    },
                    always: function() {
                        btn.prop('disabled', false).html('<i class="fa fa-bolt mr-1"></i> Run Now');
                    }
                });
            });
        });
    }

    function load_scheduler_logs() {
        const $panelSection = $root.find('#dip-panel-section');
        const $wrap = $panelSection.find('#sched-logs-wrap');
        $wrap.html('<div class="dip-empty"><i class="fa fa-spinner fa-spin mr-2"></i>Loading logs...</div>');

        frappe.call({
            method: `${METHOD_PREFIX}.get_scheduler_logs`,
            callback: function(r) {
                const logs = (r.message && r.message.logs) || [];
                if (!logs.length) {
                    $wrap.html('<div class="dip-empty">No scheduler runs in the last 90 days.</div>');
                    return;
                }

                const rows = logs.map((entry, idx) => {
                    const modules = entry.modules || {};
                    const module_summary = Object.values(modules).map(m =>
                        `${frappe.utils.escape_html(m.label)}: ${m.total_updated || 0} fixed`
                    ).join(', ') || '—';

                    const dt = frappe.datetime.str_to_user(entry.run_at) || entry.run_at;

                    return `
                        <tr class="sched-log-row" data-idx="${idx}">
                            <td>${frappe.utils.escape_html(dt)}</td>
                            <td><span class="trigger-pill ${entry.trigger === 'manual' ? 'manual' : ''}">${frappe.utils.escape_html(entry.trigger)}</span></td>
                            <td><span class="status-pill ${entry.status}">${frappe.utils.escape_html(entry.status)}</span></td>
                            <td>${frappe.utils.escape_html(module_summary)}</td>
                            <td class="text-center">
                                <button class="icon-btn view-json-btn" title="View JSON"><i class="fa fa-code"></i></button>
                            </td>
                        </tr>
                        <tr class="sched-log-json-row" data-json-for="${idx}" style="display:none;">
                            <td colspan="5"></td>
                        </tr>
                    `;
                }).join('');

                $wrap.html(`
                    <div class="dip-table-scroll">
                        <table class="dip-table">
                            <thead>
                                <tr>
                                    <th>Executed At</th>
                                    <th>Trigger</th>
                                    <th>Status</th>
                                    <th>Details</th>
                                    <th class="text-center">JSON Log</th>
                                </tr>
                            </thead>
                            <tbody>${rows}</tbody>
                        </table>
                    </div>
                `);

                $wrap.find('.view-json-btn').on('click', function() {
                    const idx = $(this).closest('tr').data('idx');
                    toggle_scheduler_log_json(logs[idx], idx);
                });
            },
            error: function() {
                $wrap.html('<div class="dip-empty">Failed to load logs.</div>');
            }
        });
    }

    function toggle_scheduler_log_json(entry, idx) {
        const $panelSection = $root.find('#dip-panel-section');
        const $jsonRow = $panelSection.find(`tr[data-json-for="${idx}"]`);
        const is_open = $jsonRow.is(':visible');
        $panelSection.find('.sched-log-json-row').hide();

        if (is_open) return;

        const json_text = JSON.stringify(entry, null, 4);
        $jsonRow.find('td').html(`
            <div class="sched-json-block">
                <div class="sched-json-block-header">
                    <span class="text-muted small"><i class="fa fa-code mr-1"></i>Execution JSON Log</span>
                    <button class="icon-btn copy-json-btn" title="Copy JSON"><i class="fa fa-clipboard"></i></button>
                </div>
                <pre class="sched-json-pre">${frappe.utils.escape_html(json_text)}</pre>
            </div>
        `);
        $jsonRow.show();

        $jsonRow.find('.copy-json-btn').on('click', function() {
            frappe.utils.copy_to_clipboard(json_text);
            frappe.show_alert({ message: __('JSON copied to clipboard'), indicator: 'green' });
        });
    }

    // ==========================================
    // CRECHE TRANSFER PANEL
    // ==========================================
    let transfer_poll_timer = null;
    let transfer_clock_timer = null;
    let transfer_started_at_ms = null;
    let transfer_final_elapsed_ms = null;
    let transfer_fields_cache = null;
    let transfer_selected_from = null;
    let transfer_selected_to = null;
    let transfer_last_log_count = 0;

    function open_creche_transfer_panel(panel) {
        $root.find('#dip-cards-section').addClass('dip-collapsed');
        stop_transfer_polling();
        stop_transfer_clock();
        transfer_selected_from = null;
        transfer_selected_to = null;
        transfer_last_log_count = 0;

        const $panelSection = $root.find('#dip-panel-section');
        $panelSection.html(`
            <div class="dip-view">
                <div class="dip-active-strip">
                    <div class="d-flex align-items-center">
                        <div class="icon-circle stat-card ${panel.color}" style="padding:0;min-height:auto;cursor:default;box-shadow:none;">
                            <i class="fa ${panel.icon}"></i>
                        </div>
                        <div>
                            <div class="font-weight-bold">${panel.title}</div>
                            <div class="text-muted small">${panel.subtitle}</div>
                        </div>
                    </div>
                    <div class="back-link" id="btn-back"><i class="fa fa-arrow-left mr-2"></i> Back to all modules</div>
                </div>

                <div class="module-panel">
                    <div class="module-panel-header">
                        <div class="module-panel-title">
                            <div class="icon-circle stat-card ${panel.color}" style="min-height:auto;padding:0;cursor:default;box-shadow:none;">
                                <i class="fa ${panel.icon}"></i>
                            </div>
                            <div>
                                <h4 class="mb-0">Creche Transfer</h4>
                                <div class="text-muted small">Move records from one Creche to another, across all linked doctypes</div>
                            </div>
                        </div>
                    </div>

                    <div class="dip-tabs">
                        <div class="dip-tab active" data-tab="transfer-picker">Select Creche</div>
                        <div class="dip-tab" data-tab="transfer-logs">Transfer Logs (90 days)</div>
                    </div>

                    <div class="dip-tab-content" id="tab-transfer-picker">
                        <div id="transfer-step-form">
                            <div class="sched-config-card">
                                <div class="sched-fields-row">
                                    <div class="sched-field" style="flex:2;min-width:260px;">
                                        <label>Transfer From Creche</label>
                                        <div id="transfer-from-link"></div>
                                    </div>
                                    <div class="sched-field" style="flex:2;min-width:260px;">
                                        <label>Transfer To Creche</label>
                                        <div id="transfer-to-link"></div>
                                    </div>
                                </div>

                                <div class="transfer-fields-block">
                                    <label>Fields to Update</label>
                                    <div class="transfer-fields-grid" id="transfer-fields-grid"></div>
                                </div>

                                <div id="transfer-preview-wrap"></div>

                                <div class="sched-actions">
                                    <button class="btn-fix" id="btn-start-transfer" disabled>
                                        <i class="fa fa-exchange mr-1"></i> Start Transfer
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div id="transfer-step-progress" style="display:none;">
                            <div class="transfer-progress-card">
                                <div class="transfer-progress-header">
                                    <div>
                                        <strong id="transfer-progress-title">Transfer in progress</strong>
                                        <div class="text-muted small" id="transfer-progress-sub"></div>
                                    </div>
                                    <span class="status-pill" id="transfer-status-pill">running</span>
                                </div>

                                <div class="transfer-timer-block">
                                    <div class="transfer-timer-label" id="transfer-timer-label">Transfer Started</div>
                                    <div class="transfer-timer-clock" id="transfer-timer-clock">00:00:00</div>
                                </div>

                                <div class="transfer-progress-bar-outer">
                                    <div class="transfer-progress-bar-inner" id="transfer-progress-bar" style="width:0%;"></div>
                                </div>
                                <div class="transfer-progress-pct" id="transfer-progress-pct"></div>
                                <div class="transfer-progress-stats" id="transfer-progress-stats"></div>
                                <div class="transfer-progress-timing" id="transfer-progress-timing"></div>

                                <div class="transfer-doctype-list" id="transfer-doctype-list"></div>
                            </div>
                        </div>
                    </div>

                    <div class="dip-tab-content" id="tab-transfer-logs" style="display:none;">
                        <div class="sched-logs-toolbar">
                            <strong>Transfer History</strong>
                            <span class="text-muted small">Showing last 90 days</span>
                        </div>
                        <div id="transfer-history-wrap">
                            <div class="dip-empty">Loading...</div>
                        </div>
                    </div>
                </div>

                <div class="terminal-container" id="transfer-terminal-container" style="display:none;">
                    <div class="terminal-header">
                        <div>
                            <span class="live-dot" id="transfer-live-dot"></span>
                            <span class="text-white font-weight-bold mr-2">Process Log</span>
                            <span class="text-muted small">Live</span>
                        </div>
                        <div class="d-flex align-items-center">
                            <button class="term-btn term-btn-clear mr-2" id="btn-transfer-clear-log">Clear</button>
                        </div>
                    </div>
                    <div class="terminal-body" id="transfer-term-body">
                        <pre id="transfer-term-content"></pre>
                    </div>
                </div>
            </div>
        `);

        $panelSection.find('#btn-back').on('click', function() {
            stop_transfer_polling();
            close_panel();
        });

        $panelSection.find('#btn-transfer-clear-log').on('click', function() {
            $panelSection.find('#transfer-term-content').text('');
        });

        bind_transfer_tabs();
        load_transfer_creche_list();
        load_transfer_fields();

        // If a transfer is already running (e.g. user navigated away and
        // back), resume showing its live progress instead of the picker.
        frappe.call({
            method: `${METHOD_PREFIX}.get_creche_transfer_status`,
            callback: function(r) {
                const t = r.message && r.message.transfer;
                if (t && t.state === 'running') {
                    show_transfer_progress_view(t.started_at);
                    start_transfer_polling();
                }
            }
        });

        $panelSection[0].scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function bind_transfer_tabs() {
        const $panelSection = $root.find('#dip-panel-section');
        $panelSection.find('.dip-tab').on('click', function() {
            const tab = $(this).data('tab');
            $panelSection.find('.dip-tab').removeClass('active');
            $(this).addClass('active');
            $panelSection.find('#tab-transfer-picker, #tab-transfer-logs').hide();
            $panelSection.find(`#tab-${tab}`).show();
            if (tab === 'transfer-logs') {
                load_transfer_history();
            }
        });
    }

    // ---------- Transfer From / To: standard Frappe Link fields ----------
    let transfer_from_control = null;
    let transfer_to_control = null;

    function load_transfer_creche_list() {
        const $panelSection = $root.find('#dip-panel-section');

        transfer_from_control = frappe.ui.form.make_control({
            parent: $panelSection.find('#transfer-from-link'),
            df: {
                fieldname: "creche",
                label: __("Creche"),
                fieldtype: "Link",
                options: "Creche",
                placeholder: __("Search Creche by name or ID..."),
                change: function() {
                    transfer_selected_from = transfer_from_control.get_value() || null;
                    if (transfer_selected_from && transfer_to_control) {
                        // Frappe's Link field naturally excludes nothing by
                        // default; re-validate in case the same creche was
                        // picked on both sides.
                        if (transfer_selected_to === transfer_selected_from) {
                            transfer_to_control.set_value('');
                            transfer_selected_to = null;
                        }
                    }
                    update_transfer_preview();
                    validate_transfer_form();
                }
            },
            render_input: true
        });
        transfer_from_control.refresh();

        transfer_to_control = frappe.ui.form.make_control({
            parent: $panelSection.find('#transfer-to-link'),
            df: {
                fieldname: "creche",
                label: __("Creche"),
                fieldtype: "Link",
                options: "Creche",
                placeholder: __("Search Creche by name or ID..."),
                get_query: function() {
                    return { filters: transfer_selected_from ? { name: ["!=", transfer_selected_from] } : {} };
                },
                change: function() {
                    transfer_selected_to = transfer_to_control.get_value() || null;
                    update_transfer_preview();
                    validate_transfer_form();
                }
            },
            render_input: true
        });
        transfer_to_control.refresh();

        bind_transfer_form_events();
    }

    function bind_transfer_form_events() {
        const $panelSection = $root.find('#dip-panel-section');

        $panelSection.find('#btn-start-transfer').off('click').on('click', function() {
            if (!transfer_selected_from || !transfer_selected_to) return;

            const selected_fields = get_selected_transfer_fields();
            if (!selected_fields.length) {
                frappe.msgprint(__('Select at least one field to transfer.'));
                return;
            }

            frappe.confirm(
                __('This will move records from the selected creche to the target creche for the chosen fields, across all linked doctypes. Continue?'),
                () => {
                    const btn = $panelSection.find('#btn-start-transfer');
                    btn.prop('disabled', true).html('<i class="fa fa-spinner fa-spin mr-1"></i> Starting...');

                    frappe.call({
                        method: `${METHOD_PREFIX}.start_creche_transfer`,
                        args: {
                            from_creche: transfer_selected_from,
                            to_creche: transfer_selected_to,
                            fields: selected_fields
                        },
                        callback: function(r) {
                            if (r.message && r.message.status === 'success') {
                                show_transfer_progress_view();
                                start_transfer_polling();
                            }
                        },
                        error: function() {
                            btn.prop('disabled', false).html('<i class="fa fa-exchange mr-1"></i> Start Transfer');
                        }
                    });
                }
            );
        });
    }

    function load_transfer_fields() {
        frappe.call({
            method: `${METHOD_PREFIX}.get_transferable_fields`,
            callback: function(r) {
                transfer_fields_cache = (r.message && r.message.fields) || [];
                const $panelSection = $root.find('#dip-panel-section');
                const checkboxes = transfer_fields_cache.map(f => `
                    <label class="transfer-field-checkbox">
                        <input type="checkbox" value="${f.fieldname}" checked>
                        <span>${frappe.utils.escape_html(f.label)}</span>
                    </label>
                `).join('');
                $panelSection.find('#transfer-fields-grid').html(checkboxes);
                $panelSection.find('#transfer-fields-grid input[type="checkbox"]').on('change', function() {
                    update_transfer_preview();
                    validate_transfer_form();
                });
            }
        });
    }

    function get_selected_transfer_fields() {
        const $panelSection = $root.find('#dip-panel-section');
        return $panelSection.find('#transfer-fields-grid input[type="checkbox"]:checked')
            .map(function() { return $(this).val(); }).get();
    }

    function validate_transfer_form() {
        const $panelSection = $root.find('#dip-panel-section');
        const ok = transfer_selected_from && transfer_selected_to &&
            transfer_selected_from !== transfer_selected_to &&
            get_selected_transfer_fields().length > 0;
        $panelSection.find('#btn-start-transfer').prop('disabled', !ok);
    }

    function update_transfer_preview() {
        const $panelSection = $root.find('#dip-panel-section');
        const $wrap = $panelSection.find('#transfer-preview-wrap');

        if (!transfer_selected_from) {
            $wrap.html('');
            return;
        }

        const selected_fields = get_selected_transfer_fields();
        if (!selected_fields.length) {
            $wrap.html('');
            return;
        }

        $wrap.html('<div class="dip-empty" style="padding:20px 0;"><i class="fa fa-spinner fa-spin mr-2"></i>Loading record counts...</div>');

        frappe.call({
            method: `${METHOD_PREFIX}.get_creche_transfer_preview`,
            args: { from_creche: transfer_selected_from, fields: selected_fields },
            callback: function(r) {
                const data = r.message || { counts: [], total: 0 };
                if (!data.total) {
                    $wrap.html('<div class="transfer-preview-empty">No records found for the selected creche and fields.</div>');
                    return;
                }
                const rows = data.counts.map(c => `
                    <div class="transfer-preview-row">
                        <span>${frappe.utils.escape_html(c.doctype)}</span>
                        <span class="count-pill">${c.count}</span>
                    </div>
                `).join('');
                $wrap.html(`
                    <div class="transfer-preview-block">
                        <div class="transfer-preview-total">This will move <strong>${data.total}</strong> record(s) across ${data.counts.length} doctypes:</div>
                        <div class="transfer-preview-rows">${rows}</div>
                    </div>
                `);
            }
        });
    }

    // ---------- Step 3: progress ----------
    function show_transfer_progress_view(resume_started_at) {
        const $panelSection = $root.find('#dip-panel-section');
        $panelSection.find('#transfer-step-form').hide();
        $panelSection.find('#transfer-step-progress').show();
        $panelSection.find('#transfer-terminal-container').show();
        start_transfer_clock(resume_started_at);
    }

    function start_transfer_polling() {
        stop_transfer_polling();
        poll_transfer_status();
        transfer_poll_timer = setInterval(poll_transfer_status, 2000);
    }

    function stop_transfer_polling() {
        if (transfer_poll_timer) {
            clearInterval(transfer_poll_timer);
            transfer_poll_timer = null;
        }
    }

    function render_ascii_bar(pct, width = 20) {
        const filled = Math.round((pct / 100) * width);
        return `<span class="transfer-ascii-bar">${'█'.repeat(filled)}${'░'.repeat(Math.max(0, width - filled))}</span>`;
    }

    function format_hms(total_seconds) {
        const s = Math.max(0, Math.floor(total_seconds));
        const hh = String(Math.floor(s / 3600)).padStart(2, '0');
        const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
        const ss = String(s % 60).padStart(2, '0');
        return `${hh}:${mm}:${ss}`;
    }

    function start_transfer_clock(resume_started_at) {
        // Uses the browser's own clock as the reference point rather than
        // parsing the server's started_at string -- comparing a naive
        // server-timezone string against Date.now() (always UTC-based) can
        // be off by hours if server/browser timezones differ. The clock
        // only needs to measure elapsed duration, not an absolute instant,
        // so a local start reference is both simpler and correct for a
        // freshly-started transfer. The one exception is resuming an
        // already-running transfer after navigating back to this screen --
        // there the browser has no local start reference at all, so a
        // best-effort parse of the server's started_at is the only option.
        stop_transfer_clock();
        if (resume_started_at) {
            const parsed = frappe.datetime.str_to_obj(resume_started_at);
            transfer_started_at_ms = parsed ? parsed.getTime() : Date.now();
        } else {
            transfer_started_at_ms = Date.now();
        }
        transfer_final_elapsed_ms = null;

        const $panelSection = $root.find('#dip-panel-section');
        $panelSection.find('#transfer-timer-label').text('Transfer Started');
        tick_transfer_clock();
        transfer_clock_timer = setInterval(tick_transfer_clock, 1000);
    }

    function tick_transfer_clock() {
        if (transfer_started_at_ms == null) return;
        const $panelSection = $root.find('#dip-panel-section');
        const elapsed_seconds = (Date.now() - transfer_started_at_ms) / 1000;
        $panelSection.find('#transfer-timer-clock').text(format_hms(elapsed_seconds));
    }

    function stop_transfer_clock(final_elapsed_seconds) {
        if (transfer_clock_timer) {
            clearInterval(transfer_clock_timer);
            transfer_clock_timer = null;
        }
        if (final_elapsed_seconds != null) {
            const $panelSection = $root.find('#dip-panel-section');
            $panelSection.find('#transfer-timer-label').text('Transfer Completed');
            $panelSection.find('#transfer-timer-clock').text(`Total Time: ${format_hms(final_elapsed_seconds)}`);
        }
    }

    function poll_transfer_status() {
        const $panelSection = $root.find('#dip-panel-section');
        if (!$panelSection.find('#transfer-step-progress').length) {
            stop_transfer_polling();
            return;
        }

        frappe.call({
            method: `${METHOD_PREFIX}.get_creche_transfer_status`,
            callback: function(r) {
                const t = r.message && r.message.transfer;
                if (!t) return;
                render_transfer_progress(t);

                if (t.state !== 'running') {
                    stop_transfer_polling();
                    const final_elapsed = transfer_started_at_ms != null ? (Date.now() - transfer_started_at_ms) / 1000 : 0;
                    stop_transfer_clock(final_elapsed);
                    $panelSection.find('#transfer-live-dot').hide();
                    frappe.show_alert({
                        message: t.state === 'success'
                            ? __(t.is_revert ? 'Revert completed successfully' : 'Creche transfer completed successfully')
                            : __(t.is_revert ? 'Revert failed' : 'Creche transfer failed'),
                        indicator: t.state === 'success' ? 'green' : 'red'
                    });
                }
            }
        });
    }

    function render_transfer_progress(t) {
        const $panelSection = $root.find('#dip-panel-section');
        const pct = t.records_total ? Math.min(100, Math.round((t.records_processed / t.records_total) * 100)) : 0;

        $panelSection.find('#transfer-progress-bar').css('width', `${pct}%`);
        $panelSection.find('#transfer-progress-pct').html(`${render_ascii_bar(pct)} <strong>${pct}%</strong>`);
        $panelSection.find('#transfer-progress-sub').text(`${t.from_creche} → ${t.to_creche}${t.is_revert ? ' (revert)' : ''}`);

        const pill = $panelSection.find('#transfer-status-pill');
        pill.attr('class', `status-pill ${t.state === 'success' ? 'success' : t.state === 'error' ? 'error' : 'skipped'}`).text(t.state);

        $panelSection.find('#transfer-progress-title').text(
            t.state === 'running' ? `${t.is_revert ? 'Reverting' : 'Transferring'}: ${t.current_doctype || '...'}` :
            t.state === 'success' ? (t.is_revert ? 'Revert complete' : 'Transfer complete') :
            (t.is_revert ? 'Revert failed' : 'Transfer failed')
        );

        $panelSection.find('#transfer-progress-stats').html(`
            <span><strong>${(t.records_processed || 0).toLocaleString()}</strong> processed</span>
            <span><strong>${Math.max(0, (t.records_total || 0) - (t.records_processed || 0)).toLocaleString()}</strong> remaining</span>
            <span><strong>${t.doctypes_done || 0}</strong> / ${t.doctypes_total || 0} doctypes done</span>
        `);

        // Elapsed time comes from the browser's own local clock (see
        // start_transfer_clock); estimated-time-remaining is derived from
        // the observed processing rate so far -- both intentionally client
        // -side rather than server-computed, since the server has no
        // notion of "now" between polls.
        if (t.state === 'running' && transfer_started_at_ms != null) {
            const elapsed_seconds = (Date.now() - transfer_started_at_ms) / 1000;
            let eta_text = 'calculating...';
            if (t.records_processed > 0 && t.records_total > 0) {
                const rate = t.records_processed / elapsed_seconds; // records/sec
                const remaining = Math.max(0, t.records_total - t.records_processed);
                eta_text = rate > 0 ? format_hms(remaining / rate) : 'calculating...';
            }
            $panelSection.find('#transfer-progress-timing').html(`
                <span>Elapsed Time: <strong>${format_hms(elapsed_seconds)}</strong></span>
                <span>Estimated Time Remaining: <strong>${eta_text}</strong></span>
            `);
        } else {
            $panelSection.find('#transfer-progress-timing').html('');
        }

        const doctype_rows = (t.per_doctype || []).map(d => `
            <div class="transfer-doctype-row ${d.status}">
                <span class="transfer-doctype-name">${frappe.utils.escape_html(d.doctype)}</span>
                <span class="transfer-doctype-count">${d.processed}/${d.total}</span>
                <span class="status-pill ${d.status === 'done' ? 'success' : d.status === 'running' ? 'skipped' : ''}">${d.status}</span>
            </div>
        `).join('');
        $panelSection.find('#transfer-doctype-list').html(doctype_rows);

        const log = t.log || [];
        if (log.length > transfer_last_log_count) {
            const new_lines = log.slice(transfer_last_log_count);
            const $content = $panelSection.find('#transfer-term-content');
            let text = $content.text();
            new_lines.forEach(entry => {
                const line = `[${entry.timestamp}] ${entry.message}`;
                text = text.trim() !== '' ? `${text}\n${line}` : line;
            });
            $content.text(text);
            const body = $panelSection.find('#transfer-term-body')[0];
            if (body) body.scrollTop = body.scrollHeight;
            transfer_last_log_count = log.length;
        }
        if (t.state !== 'running') {
            transfer_last_log_count = log.length;
        }
    }

    // ---------- Transfer Logs tab (history + revert) ----------
    function load_transfer_history() {
        const $panelSection = $root.find('#dip-panel-section');
        const $wrap = $panelSection.find('#transfer-history-wrap');
        $wrap.html('<div class="dip-empty"><i class="fa fa-spinner fa-spin mr-2"></i>Loading...</div>');

        frappe.call({
            method: `${METHOD_PREFIX}.get_creche_transfer_history`,
            callback: function(r) {
                const history = (r.message && r.message.history) || [];
                if (!history.length) {
                    $wrap.html('<div class="dip-empty">No transfers in the last 90 days.</div>');
                    return;
                }

                const rows = history.map((entry, idx) => {
                    const started = frappe.datetime.str_to_user(entry.started_at) || entry.started_at;
                    const finished = entry.finished_at ? (frappe.datetime.str_to_user(entry.finished_at) || entry.finished_at) : '—';
                    const fields = (entry.selected_fields || []).join(', ') || '—';

                    let action_html = '';
                    if (entry.reverted) {
                        action_html = '<span class="trigger-pill">Reverted</span>';
                    } else if (entry.revertible && entry.state !== 'running') {
                        action_html = `<button class="btn-edit-manual btn-revert-transfer" data-idx="${idx}"><i class="fa fa-undo mr-1"></i> Revert</button>`;
                    } else if (entry.state === 'running') {
                        action_html = '<span class="trigger-pill">In Progress</span>';
                    } else {
                        action_html = '<span class="text-muted small">—</span>';
                    }

                    return `
                        <tr>
                            <td>${frappe.utils.escape_html(entry.from_creche)} → ${frappe.utils.escape_html(entry.to_creche)}</td>
                            <td>${frappe.utils.escape_html(fields)}</td>
                            <td><span class="status-pill ${entry.state === 'success' ? 'success' : entry.state === 'error' ? 'error' : 'skipped'}">${frappe.utils.escape_html(entry.state)}</span></td>
                            <td>${entry.records_processed || 0}</td>
                            <td>${frappe.utils.escape_html(started)}</td>
                            <td>${frappe.utils.escape_html(finished)}</td>
                            <td class="text-center">${action_html}</td>
                        </tr>
                    `;
                }).join('');

                $wrap.html(`
                    <div class="dip-table-scroll">
                        <table class="dip-table">
                            <thead>
                                <tr>
                                    <th>Transfer</th>
                                    <th>Fields</th>
                                    <th>Status</th>
                                    <th>Records</th>
                                    <th>Started</th>
                                    <th>Finished</th>
                                    <th class="text-center">Action</th>
                                </tr>
                            </thead>
                            <tbody>${rows}</tbody>
                        </table>
                    </div>
                `);

                $wrap.find('.btn-revert-transfer').on('click', function() {
                    const idx = $(this).data('idx');
                    const entry = history[idx];
                    confirm_and_revert_transfer(entry);
                });
            },
            error: function() {
                $wrap.html('<div class="dip-empty">Failed to load transfer history.</div>');
            }
        });
    }

    function confirm_and_revert_transfer(entry) {
        frappe.confirm(
            __(`This will restore all records changed by the transfer from ${entry.from_creche} to ${entry.to_creche} back to their original values. Continue?`),
            () => {
                frappe.call({
                    method: `${METHOD_PREFIX}.start_creche_transfer_revert`,
                    args: { transfer_id: entry.transfer_id },
                    callback: function(r) {
                        if (r.message && r.message.status === 'success') {
                            const $panelSection = $root.find('#dip-panel-section');
                            $panelSection.find('.dip-tab[data-tab="transfer-picker"]').trigger('click');
                            transfer_last_log_count = 0;
                            $panelSection.find('#transfer-term-content').text('');
                            show_transfer_progress_view();
                            start_transfer_polling();
                        }
                    }
                });
            }
        );
    }

    // ==========================================
    // TABS
    // ==========================================
    function bind_tabs(panel) {
        const $panelSection = $root.find('#dip-panel-section');
        $panelSection.find('.dip-tab').on('click', function() {
            const tab = $(this).data('tab');
            $panelSection.find('.dip-tab').removeClass('active');
            $(this).addClass('active');
            $panelSection.find('#tab-results, #tab-edit, #tab-idchangelog, #tab-history').hide();
            $panelSection.find(`#tab-${tab}`).show();
            if (tab === 'idchangelog') {
                load_id_change_logs(panel);
            }
        });

        $panelSection.find('#btn-edit-manual-tab').on('click', function() {
            $panelSection.find('.dip-tab[data-tab="edit"]').trigger('click');
        });
    }

    // ==========================================
    // ID CHANGE LOGS TAB
    // ==========================================
    function load_id_change_logs(panel) {
        const $panelSection = $root.find('#dip-panel-section');
        const $wrap = $panelSection.find('#idchangelog-wrap');
        $wrap.html('<div class="dip-empty"><i class="fa fa-spinner fa-spin mr-2"></i>Loading...</div>');

        frappe.call({
            method: `${METHOD_PREFIX}.get_id_change_logs`,
            args: { doctype: panel.doctype },
            callback: function(r) {
                const logs = (r.message && r.message.logs) || [];
                if (!logs.length) {
                    $wrap.html('<div class="dip-empty">No ID changes recorded in the last 90 days.</div>');
                    return;
                }

                const entity_label = panel.entity_label || 'Child';

                const rows = logs.map(entry => {
                    const dt = frappe.datetime.str_to_user(entry.changed_at) || entry.changed_at;
                    return `
                        <tr>
                            <td>${frappe.utils.escape_html(entry.old_record || '')}</td>
                            <td>${frappe.utils.escape_html(entry.old_name || '')}</td>
                            <td><span class="id-pill">${frappe.utils.escape_html(entry.old_id || '')}</span></td>
                            <td>${frappe.utils.escape_html(entry.new_record || '')}</td>
                            <td>${frappe.utils.escape_html(entry.new_name || '')}</td>
                            <td><span class="id-pill">${frappe.utils.escape_html(entry.new_id || '')}</span></td>
                            <td>${frappe.utils.escape_html(dt)}</td>
                        </tr>
                    `;
                }).join('');

                $wrap.html(`
                    <div class="dip-table-scroll">
                        <table class="dip-table">
                            <thead>
                                <tr>
                                    <th>Old Name</th>
                                    <th>Old ${entity_label} Name</th>
                                    <th>Old ${entity_label} ID</th>
                                    <th>New Name</th>
                                    <th>New ${entity_label} Name</th>
                                    <th>New ${entity_label} ID</th>
                                    <th>Date/Time Stamp</th>
                                </tr>
                            </thead>
                            <tbody>${rows}</tbody>
                        </table>
                    </div>
                `);
            },
            error: function() {
                $wrap.html('<div class="dip-empty">Failed to load ID change logs.</div>');
            }
        });
    }

    // Terminal Logger Function
    function log_to_terminal(action, status, extra = {}) {
        const timestamp = frappe.datetime.now_datetime();
        const log_obj = { timestamp, action, status, ...extra };

        history_log.unshift(log_obj);
        render_history_log();

        let current_text = $('#term-content').text();
        let new_text = JSON.stringify(log_obj, null, 4);

        if (current_text.trim() !== '') {
            new_text = current_text + "\n" + new_text;
        }

        $('#term-content').text(new_text);

        let body = $('#term-body')[0];
        if (body) body.scrollTop = body.scrollHeight;
    }

    function render_history_log() {
        const $list = $root.find('#history-list');
        if (!$list.length) return;
        if (!history_log.length) {
            $list.html('<div class="dip-empty">No activity yet.</div>');
            return;
        }
        const icon_by_status = {
            success: { cls: 'success', icon: 'fa-check' },
            completed: { cls: 'success', icon: 'fa-check' },
            error: { cls: 'error', icon: 'fa-times' },
            started: { cls: 'running', icon: 'fa-spinner' },
            running: { cls: 'running', icon: 'fa-spinner' }
        };
        $list.html(history_log.map(h => {
            const meta = icon_by_status[h.status] || { cls: 'running', icon: 'fa-info' };
            return `
                <div class="history-item">
                    <div class="history-icon ${meta.cls}"><i class="fa ${meta.icon}"></i></div>
                    <div>
                        <div><strong>${frappe.utils.escape_html(h.action)}</strong> — ${frappe.utils.escape_html(h.status)}</div>
                        <div class="text-muted small">${frappe.utils.escape_html(h.message || '')}</div>
                        <div class="history-time">${frappe.utils.escape_html(h.timestamp)}</div>
                    </div>
                </div>
            `;
        }).join(''));
    }

    // ==========================================
    // RESULTS TABLE (grouped by ID, scrollable, 100/page)
    // ==========================================
    function render_results_table(panel, groups) {
        const $panelSection = $root.find('#dip-panel-section');
        const $wrap = $panelSection.find('#results-wrap');
        const $badge = $panelSection.find('#dip-group-count');

        if (!groups || !groups.length) {
            $wrap.html(`<div class="dip-empty">No duplicate ${panel.title}s found.</div>`);
            $badge.hide();
            return;
        }

        $badge.text(`${groups.length} Groups`).show();
        current_page_num = 1;
        render_results_page(panel, groups);
    }

    function render_results_page(panel, groups) {
        const $panelSection = $root.find('#dip-panel-section');
        const $wrap = $panelSection.find('#results-wrap');
        const total_pages = Math.max(1, Math.ceil(groups.length / PAGE_SIZE));
        current_page_num = Math.min(current_page_num, total_pages);

        const start = (current_page_num - 1) * PAGE_SIZE;
        const page_groups = groups.slice(start, start + PAGE_SIZE);

        const rows = page_groups.map((g, idx) => {
            const names_preview = g.names.slice(0, 3).join(', ') + (g.names.length > 3 ? ', ...' : '');
            return `
                <tr class="group-row" data-idx="${start + idx}">
                    <td><span class="id-pill">${frappe.utils.escape_html(g.id_value)}</span></td>
                    <td><span class="count-pill">${g.count}</span></td>
                    <td>${frappe.utils.escape_html(names_preview)}</td>
                    <td class="text-center">
                        <button class="icon-btn view-btn" title="View"><i class="fa fa-eye"></i></button>
                        <button class="icon-btn edit-btn" title="Edit"><i class="fa fa-pencil"></i></button>
                    </td>
                </tr>
                <tr class="group-detail-row" data-detail-for="${start + idx}" style="display:none;">
                    <td colspan="4"></td>
                </tr>
            `;
        }).join('');

        $wrap.html(`
            <div class="dip-table-scroll">
                <table class="dip-table">
                    <thead>
                        <tr>
                            <th>${panel.title}</th>
                            <th>Count</th>
                            <th>${panel.entity_label || 'Child'} Names</th>
                            <th class="text-center">Actions</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
            <div class="dip-pagination">
                <span>Showing ${start + 1} to ${start + page_groups.length} of ${groups.length} groups</span>
                <div class="page-btns" id="dip-page-btns"></div>
            </div>
        `);

        render_pagination(panel, groups, total_pages);

        $wrap.find('.view-btn').on('click', function() {
            const idx = $(this).closest('tr').data('idx');
            toggle_group_detail(panel, groups[idx], idx);
        });

        $wrap.find('.edit-btn').on('click', function() {
            const idx = $(this).closest('tr').data('idx');
            const group = groups[idx];
            // Edit the oldest (first) record in the group by default
            open_edit_dialog(panel, group.records[0], () => {
                render_results_page(panel, groups);
            });
        });
    }

    function toggle_group_detail(panel, group, idx) {
        const $panelSection = $root.find('#dip-panel-section');
        const $detail = $panelSection.find(`tr[data-detail-for="${idx}"]`);
        const is_open = $detail.is(':visible');
        $panelSection.find('.group-detail-row').hide();

        if (is_open) return;

        const lines = group.records.map(r => `
            <div class="record-line">
                <span>${frappe.utils.escape_html(r.name)} — ${frappe.utils.escape_html(r[panel.name_field] || '')}</span>
                <span class="id-pill">${frappe.utils.escape_html(r[panel.id_field] || '')}</span>
            </div>
        `).join('');

        $detail.find('td').html(`<div class="p-2">${lines}</div>`);
        $detail.show();
    }

    function render_pagination(panel, groups, total_pages) {
        const $btns = $root.find('#dip-page-btns');
        let html = `<button ${current_page_num === 1 ? 'disabled' : ''} data-page="prev"><i class="fa fa-chevron-left"></i></button>`;

        const max_visible = 7;
        let pages_to_show = [];
        if (total_pages <= max_visible) {
            pages_to_show = Array.from({length: total_pages}, (_, i) => i + 1);
        } else if (current_page_num <= 4) {
            pages_to_show = [1, 2, 3, 4, 5, '...', total_pages];
        } else if (current_page_num >= total_pages - 3) {
            pages_to_show = [1, '...', total_pages - 4, total_pages - 3, total_pages - 2, total_pages - 1, total_pages];
        } else {
            pages_to_show = [1, '...', current_page_num - 1, current_page_num, current_page_num + 1, '...', total_pages];
        }

        pages_to_show.forEach(p => {
            if (p === '...') {
                html += `<button disabled>...</button>`;
            } else {
                html += `<button class="${p === current_page_num ? 'active' : ''}" data-page="${p}">${p}</button>`;
            }
        });

        html += `<button ${current_page_num === total_pages ? 'disabled' : ''} data-page="next"><i class="fa fa-chevron-right"></i></button>`;
        $btns.html(html);

        $btns.find('button[data-page]').on('click', function() {
            const p = $(this).data('page');
            if (p === 'prev') current_page_num = Math.max(1, current_page_num - 1);
            else if (p === 'next') current_page_num = Math.min(total_pages, current_page_num + 1);
            else current_page_num = p;
            render_results_page(panel, groups);
            root_scroll_results_top();
        });
    }

    function root_scroll_results_top() {
        const el = $root.find('.dip-table-scroll')[0];
        if (el) el.scrollTop = 0;
    }

    // ==========================================
    // EDIT DIALOG (shared)
    // ==========================================
    function open_edit_dialog(panel, record, on_saved) {
        const current_id = record[panel.id_field] || '';

        const dialog = new frappe.ui.Dialog({
            title: `Edit ${panel.title}`,
            fields: [
                {
                    fieldname: 'record_name',
                    fieldtype: 'Data',
                    label: 'Record',
                    default: record.name,
                    read_only: 1
                },
                {
                    fieldname: 'record_display_name',
                    fieldtype: 'Data',
                    label: `${panel.entity_label || 'Child'} Name`,
                    default: record[panel.name_field] || '',
                    read_only: 1
                },
                {
                    fieldname: 'new_id',
                    fieldtype: 'Data',
                    label: panel.title,
                    reqd: 1,
                    default: current_id
                }
            ],
            primary_action_label: 'Save',
            primary_action(values) {
                const new_id = (values.new_id || '').trim();
                if (!new_id || new_id === current_id) {
                    dialog.hide();
                    return;
                }

                dialog.disable_primary_action();
                log_to_terminal("edit_id", "running", {
                    message: `Updating ${record.name} from ${current_id} to ${new_id}`
                });

                frappe.call({
                    method: "frappe.apf.page.admin_panel.duplicate_id_panel.update_record_id",
                    args: {
                        doctype: panel.doctype,
                        docname: record.name,
                        new_id: new_id
                    },
                    callback: function(r) {
                        if (r.message && r.message.status === 'success') {
                            record[panel.id_field] = new_id;
                            log_to_terminal("edit_id", "success", {
                                message: `Updated ${record.name} to ${new_id}`
                            });
                            frappe.show_alert({ message: __('ID updated successfully'), indicator: 'green' });
                            if (on_saved) on_saved();
                        }
                        dialog.hide();
                    },
                    error: function() {
                        log_to_terminal("edit_id", "error", { message: `Failed to update ${record.name}` });
                    },
                    always: function() {
                        dialog.enable_primary_action();
                    }
                });
            }
        });

        dialog.show();
    }

    // ==========================================
    // EDIT ID MANUAL TAB (search independent of scan)
    // ==========================================
    function bind_edit_manual_tab(panel) {
        const $panelSection = $root.find('#dip-panel-section');

        function do_search() {
            const term = $panelSection.find('#edit-search-input').val() || '';
            const $results = $panelSection.find('#edit-search-results');
            $results.html('<div class="dip-empty"><i class="fa fa-spinner fa-spin mr-2"></i>Searching...</div>');

            frappe.call({
                method: "frappe.apf.page.admin_panel.duplicate_id_panel.search_records",
                args: { doctype: panel.doctype, search_term: term },
                callback: function(r) {
                    const records = (r.message && r.message.records) || [];
                    if (!records.length) {
                        $results.html('<div class="dip-empty">No matching records found.</div>');
                        return;
                    }
                    const rows = records.map((rec, idx) => `
                        <tr data-idx="${idx}">
                            <td>${frappe.utils.escape_html(rec.name)}</td>
                            <td>${frappe.utils.escape_html(rec[panel.name_field] || '')}</td>
                            <td><span class="id-pill">${frappe.utils.escape_html(rec[panel.id_field] || '')}</span></td>
                            <td class="text-center"><button class="icon-btn edit-btn"><i class="fa fa-pencil"></i></button></td>
                        </tr>
                    `).join('');

                    $results.html(`
                        <div class="dip-table-scroll" style="max-height:400px;">
                            <table class="dip-table">
                                <thead>
                                    <tr>
                                        <th>Record</th>
                                        <th>${panel.entity_label || 'Child'} Name</th>
                                        <th>${panel.title}</th>
                                        <th class="text-center">Action</th>
                                    </tr>
                                </thead>
                                <tbody>${rows}</tbody>
                            </table>
                        </div>
                    `);

                    $results.find('.edit-btn').on('click', function() {
                        const idx = $(this).closest('tr').data('idx');
                        open_edit_dialog(panel, records[idx], do_search);
                    });
                },
                error: function() {
                    $results.html('<div class="dip-empty">Search failed. Check console.</div>');
                }
            });
        }

        $panelSection.find('#btn-edit-search').on('click', do_search);
        $panelSection.find('#edit-search-input').on('keydown', function(e) {
            if (e.key === 'Enter') do_search();
        });
    }

    // ==========================================
    // FIND / FIX / DOWNLOAD
    // ==========================================
    function bind_panel_actions(panel) {
        const $panelSection = $root.find('#dip-panel-section');

        $panelSection.find('#btn-start-find').on('click', async function() {
            const btn = $(this);
            btn.prop('disabled', true).html('<i class="fa fa-spinner fa-spin mr-1"></i> Scanning...');
            log_to_terminal("find_duplicate", "started", { message: `Scanning for duplicate ${panel.title}s...` });

            try {
                const params = new URLSearchParams({ dry_run: 1 });
                const url = `${BASE_URL}/api/method/${panel.endpoint}?${params.toString()}`;

                const res = await fetch(url);
                const result = await res.json();

                console.log("Find API Response:", result);

                if (result.message) {
                    last_results = result.message;
                    log_to_terminal("find_duplicate", "success", {
                        duplicates_found: result.message.total_duplicate_records || 0,
                        message: `Found ${result.message.total_duplicate_ids || 0} groups, ${result.message.total_duplicate_records || 0} duplicate records`
                    });
                    render_results_table(panel, result.message.duplicate_groups);
                }
            } catch (error) {
                console.error("Error fetching data:", error);
                log_to_terminal("find_duplicate", "error", { message: "API call failed. Check console." });
            } finally {
                btn.prop('disabled', false).html('<i class="fa fa-search mr-1"></i> Find Duplicate');
            }
        });

        $panelSection.find('#btn-start-fix').on('click', function() {
            frappe.confirm('Are you sure you want to fix all duplicates?', async () => {
                const btn = $panelSection.find('#btn-start-fix');
                btn.prop('disabled', true).html('<i class="fa fa-spinner fa-spin mr-1"></i> Fixing...');
                log_to_terminal("fix_duplicate", "running", { message: "Fixing duplicate records..." });

                try {
                    const params = new URLSearchParams({ dry_run: 0 });
                    const url = `${BASE_URL}/api/method/${panel.endpoint}?${params.toString()}`;

                    const res = await fetch(url);
                    const result = await res.json();

                    console.log("Fix API Response:", result);

                    if (result.message) {
                        last_results = result.message;
                        log_to_terminal("fix_duplicate", "completed", {
                            records_fixed: result.message.total_updated || 0,
                            message: `Successfully fixed ${result.message.total_updated || 0} records`
                        });
                        $panelSection.find('#results-wrap').html(`<div class="dip-empty">Fix complete. Run "Find Duplicate" again to refresh results.</div>`);
                        $panelSection.find('#dip-group-count').hide();
                    }
                } catch (error) {
                    console.error("Error fixing data:", error);
                    log_to_terminal("fix_duplicate", "error", { message: "API call failed. Check console." });
                } finally {
                    btn.prop('disabled', false).html('<i class="fa fa-wrench mr-1"></i> Fix Duplicate');
                }
            });
        });

        $panelSection.find('#btn-clear-log').on('click', function() {
            $panelSection.find('#term-content').text('');
        });

        $panelSection.find('#btn-dl-json, #btn-export-results').on('click', function() {
            if (!last_results) {
                frappe.msgprint("Please run a process first.");
                return;
            }
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(last_results, null, 4));
            const a = document.createElement('a');
            a.href = dataStr;
            a.download = `${panel.key}_results.json`;
            a.click();
        });

        $panelSection.find('#btn-dl-excel').on('click', function() {
            const url = `${BASE_URL}/api/method/${panel.endpoint}?export_excel=1`;
            window.open(url);
        });
    }
};