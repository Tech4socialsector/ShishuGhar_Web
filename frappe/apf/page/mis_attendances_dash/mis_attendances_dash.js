frappe.pages['mis-attendances-dash'].on_page_load = function(wrapper) {
  var page = frappe.ui.make_app_page({
      parent: wrapper,
      title: 'MIS Dashboard',
      single_column: true
  });

  frappe.require("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js");
  frappe.require("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js");
  frappe.require("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");

  if (typeof ApexCharts === 'undefined') {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/apexcharts@3.45.1/dist/apexcharts.min.js';
    script.onload = function() {
      console.log('ApexCharts loaded successfully');
      initializeDashboard();
    };
    script.onerror = function() {
      console.error('Failed to load ApexCharts');
      const fallbackScript = document.createElement('script');
      fallbackScript.src = '/assets/js/apexcharts.min.js';
      fallbackScript.onload = function() {
        console.log('ApexCharts loaded from fallback');
        initializeDashboard();
      };
      fallbackScript.onerror = function() {
        console.error('Failed to load ApexCharts from fallback too');
        showApexChartsError();
      };
      document.head.appendChild(fallbackScript);
    };
    document.head.appendChild(script);
  } else {
    initializeDashboard();
  }
  
  function showApexChartsError() {
    page.main.innerHTML = '<div style="text-align: center; padding: 50px;"> <h3 style="color: #dc3545;">Error Loading Chart Library</h3> <p>Please refresh the page or check your internet connection.</p> <button onclick="location.reload()" style="background: #5979aa; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer;"> Refresh Page </button> </div>';
  }
  
  function initializeDashboard() {
    // Define filters
    let filters = [
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
          resetForwardFilters("year");
          updateFilterDesc();
        }
      },
      {
        fieldname: "month",
        label: __("Month"),
        fieldtype: "Select",
        options: [
          { value: "1", label: __("January") },
          { value: "2", label: __("February") },
          { value: "3", label: __("March") },
          { value: "4", label: __("April") },
          { value: "5", label: __("May") },
          { value: "6", label: __("June") },
          { value: "7", label: __("July") },
          { value: "8", label: __("August") },
          { value: "9", label: __("September") },
          { value: "10", label: __("October") },
          { value: "11", label: __("November") },
          { value: "12", label: __("December") }
        ],
        default: (new Date().getMonth() + 1).toString(),
        onchange: function () {
          resetForwardFilters("month");
          updateFilterDesc();
        }
      },
      {
        fieldname: "partner",
        label: __("Partner"),
        fieldtype: "Link",
        options: "Partner",
        default: frappe.defaults.get_user_default("partner"),
        onchange: function () {
          resetForwardFilters("partner");
          updateFilterDesc();
        }
      },
      {
        fieldname: "state",
        label: __("State"),
        fieldtype: "Link",
        options: "State",
        get_query: function () {
          return { filters: { "is_active": 1 } };
        },
        onchange: function () {
          resetForwardFilters("state");
          updateFilterDesc();
        }
      },
      {
        fieldname: "district",
        label: __("District"),
        fieldtype: "Link",
        options: "District",
        get_query: function () {
          let state = page.fields_dict["state"] ? page.fields_dict["state"].get_value() : "";
          return state ? { filters: { "is_active": 1, "state_id": state } } : { filters: { "is_active": 1 } };
        },
        onchange: function () {
          resetForwardFilters("district");
          updateFilterDesc();
        }
      },
      {
        fieldname: "block",
        label: __("Block"),
        fieldtype: "Link",
        options: "Block",
        get_query: function () {
          let district = page.fields_dict["district"] ? page.fields_dict["district"].get_value() : "";
          return district ? { filters: { "is_active": 1, "district_id": district } } : { filters: { "is_active": 1 } };
        },
        onchange: function () {
          resetForwardFilters("block");
          updateFilterDesc();
        }
      },
      {
        fieldname: "gp",
        label: __("Gram Panchayat"),
        fieldtype: "Link",
        options: "Gram Panchayat",
        get_query: function () {
          let block = page.fields_dict["block"] ? page.fields_dict["block"].get_value() : "";
          return block ? { filters: { "is_active": 1, "block_id": block } } : { filters: { "is_active": 1 } };
        },
        onchange: function () {
          resetForwardFilters("gp");
          updateFilterDesc();
        }
      },
      {
        fieldname: "creche",
        label: __("Creche"),
        fieldtype: "Link",
        options: "Creche",
        get_query: function () {
          let gp = page.fields_dict["gp"] ? page.fields_dict["gp"].get_value() : "";
          return gp ? { filters: { "is_active": 1, "gp_id": gp } } : { filters: { "is_active": 1 } };
        },
        onchange: function () {
          resetForwardFilters("creche");
          updateFilterDesc();
        }
      },
      {
        fieldname: "supervisor_id",
        label: __("Supervisor"),
        fieldtype: "Link",
        options: "User",
        onchange: function () {
          resetForwardFilters("supervisor_id");
          updateFilterDesc();
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
          updateFilterDesc();
        }
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
          { value: "4", label: __("Closed") },
        ],
        default: "3",
        onchange: function () {
          updateFilterDesc();
        }
      },
      {
        fieldname: "duration",
        label: __("Duration"),
        fieldtype: "Select",
        options: [
          { value: "", label: __("") },
          { value: "3_months", label: __("3 Month") },
          { value: "6_months", label: __("6 Month") },
          { value: "9_months", label: __("9 Month") },
          { value: "12_months", label: __("12 Month") },
        ],
        default: "3_months",
        onchange: function () {
          updateFilterDesc();
        }
      },
      {
        fieldname: "gender",
        label: __("Gender"),
        fieldtype: "Select",
        options: [
          { value: "", label: __("") },
          { value: "1", label: __("Male") },
          { value: "2", label: __("Female") },
        ],
        onchange: function () {
          updateFilterDesc();
        }
      },
      {
        fieldname: "child_age",
        label: __("Child Age"),
        fieldtype: "Select",
        options: [
          { value: "", label: __("") },
          { value: "1_year", label: __("Below 1 Year") },
          { value: "1_2_year", label: __("1-2 Year") },
          { value: "2_3_year", label: __("2-3 Year") },
        ],
        onchange: function () {
          updateFilterDesc();
        }
      },
      {
        fieldname: "creche_age",
        label: __("Age of Creche"),
        fieldtype: "Select",
        options: [
          { value: "", label: __("") },
          { value: "6_months", label: __("6 Month") },
          { value: "12_months", label: __("12 Month") },
          { value: "18_months", label: __("18 Month") },
          { value: "24_months", label: __("24 Month") },
        ],
        onchange: function () {
          syncCrecheAgeWithOpeningDate();
          updateFilterDesc();
        }
      },
      {
        fieldname: "level",
        label: __("Level"),
        fieldtype: "Select",
        options: [
          { value: "", label: __("Level") },
          { value: "1", label: __("Partner") },
          { value: "2", label: __("State") },
          { value: "3", label: __("District") },
          { value: "4", label: __("Block") },
          { value: "5", label: __("Supervisor") },
          { value: "6", label: __("GP") },
          { value: "7", label: __("Creche") }
        ],
        default: "",
        onchange: function () {
          updateFilterDesc();
        }
      }
    ];
    
    filters.forEach(filter => page.add_field(filter));
    
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
      default: "",
      onchange: function () {
        let selected_value = cr_opening_range_type.get_value();
        page.fields_dict.c_opening_range.toggle(selected_value === "between");
        page.fields_dict.single_date.toggle(["before", "after", "equal"].includes(selected_value));
        if (selected_value === "between") {
          page.fields_dict.single_date.set_value(null);
        } else if (["before", "after", "equal"].includes(selected_value)) {
          page.fields_dict.c_opening_range.set_value(null);
        }
        updateFilterDesc();
      }
    });
    
    let c_opening_range = page.add_field({ fieldname: "c_opening_range", label: __("Creche Opening Range"), fieldtype: "DateRange", hidden: 1, onchange: updateFilterDesc });
    let single_date = page.add_field({ fieldname: "single_date", label: __("Creche Opening Date"), fieldtype: "Date", hidden: 1, onchange: updateFilterDesc });
    
    function resetForwardFilters(currentFilter) {
      let currentIndex = filters.findIndex(filter => filter.fieldname === currentFilter);
      if (currentIndex === -1) return;
      for (let i = currentIndex + 1; i < filters.length; i++) {
        if (["creche_status_id", "phases", "duration", "creche_age", "level"].includes(filters[i].fieldname)) continue;
        if (page.fields_dict[filters[i].fieldname]) {
          page.fields_dict[filters[i].fieldname].set_value("");
        }
      }
      page.fields_dict["cr_opening_range_type"].set_value("");
      page.fields_dict["c_opening_range"].set_value("");
      page.fields_dict["single_date"].set_value("");
    }
    
    // ==============================================================================
    // SILENT AUTO-RESOLVERS FOR HIERARCHY
    // ==============================================================================
    
    // Helper to get all parent IDs if the user skips filters and directly selects a lower level
    async function getResolvedHierarchyFromFilters() {
        let ids = {
            partner: page.fields_dict.partner ? page.fields_dict.partner.get_value() : null,
            state: page.fields_dict.state ? page.fields_dict.state.get_value() : null,
            district: page.fields_dict.district ? page.fields_dict.district.get_value() : null,
            block: page.fields_dict.block ? page.fields_dict.block.get_value() : null,
            gp: page.fields_dict.gp ? page.fields_dict.gp.get_value() : null,
            creche: page.fields_dict.creche ? page.fields_dict.creche.get_value() : null,
            supervisor_id: page.fields_dict.supervisor_id ? page.fields_dict.supervisor_id.get_value() : null
        };

        if (ids.creche) {
            try { let r = await frappe.db.get_value("Creche", ids.creche, ['state_id', 'district_id', 'block_id', 'gp_id']); 
            if(r && r.message) { ids.state = ids.state || r.message.state_id; ids.district = ids.district || r.message.district_id; ids.block = ids.block || r.message.block_id; ids.gp = ids.gp || r.message.gp_id; } } catch(e){}
        } else if (ids.gp) {
            try { let r = await frappe.db.get_value("Gram Panchayat", ids.gp, ['state_id', 'district_id', 'block_id']); 
            if(r && r.message) { ids.state = ids.state || r.message.state_id; ids.district = ids.district || r.message.district_id; ids.block = ids.block || r.message.block_id; } } catch(e){}
        } else if (ids.block) {
            try { let r = await frappe.db.get_value("Block", ids.block, ['state_id', 'district_id']); 
            if(r && r.message) { ids.state = ids.state || r.message.state_id; ids.district = ids.district || r.message.district_id; } } catch(e){}
        } else if (ids.district) {
            try { let r = await frappe.db.get_value("District", ids.district, ['state_id']); 
            if(r && r.message) { ids.state = ids.state || r.message.state_id; } } catch(e){}
        }
        return ids;
    }

    // Debounced UI update to prevent server spam
    let filterDescTimeout;
    function updateFilterDesc() {
        clearTimeout(filterDescTimeout);
        filterDescTimeout = setTimeout(async () => {
            const filterDesc = document.getElementById("filterDesc");
            if (!filterDesc) return;

            const activeFilters = [];
            const year = page.fields_dict["year"] ? page.fields_dict["year"].get_value() : "";
            const month = page.fields_dict["month"] ? page.fields_dict["month"].get_value() : "";
            
            if (year) activeFilters.push(`Year: ${year}`);
            if (month) {
                const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
                activeFilters.push(`Month: ${monthNames[parseInt(month) - 1]}`);
            }

            // 1. Get auto-resolved IDs
            let hierarchyIds = await getResolvedHierarchyFromFilters();

            // 2. Fetch Actual Human Names for IDs
            const filterMap = [
                { key: "partner", label: "Partner", doctype: "Partner", name_field: "partner_name" },
                { key: "state", label: "State", doctype: "State", name_field: "state_name" },
                { key: "district", label: "District", doctype: "District", name_field: "district_name" },
                { key: "block", label: "Block", doctype: "Block", name_field: "block_name" },
                { key: "gp", label: "Gram Panchayat", doctype: "Gram Panchayat", name_field: "gp_name" },
                { key: "creche", label: "Creche", doctype: "Creche", name_field: "creche_name" },
                { key: "supervisor_id", label: "Supervisor", doctype: "User", name_field: "full_name" }
            ];

            // Resolve all names in parallel instead of one round-trip after another.
            const resolvedNames = await Promise.all(filterMap.map(async f => {
                const val = hierarchyIds[f.key];
                if (!val) return null;
                const name_val = await resolveDbName(f.doctype, val, f.name_field);
                return `<strong>${f.label}:</strong> ${name_val}`;
            }));
            resolvedNames.forEach(n => { if (n) activeFilters.push(n); });

            // 3. Process Dropdown Selects
            const selectFields = {
                "phases": "Phase", "creche_status_id": "Creche Status", "duration": "Duration",
                "creche_age": "Age of Creche", "gender": "Gender", "child_age": "Child Age", "level": "Level"
            };

            Object.keys(selectFields).forEach(field => {
                const fieldObj = page.fields_dict[field];
                if (fieldObj) {
                    const value = fieldObj.get_value();
                    if (value && value !== "") {
                        let displayValue = value;
                        if (field === "creche_status_id") {
                            const statusMap = { "1": "Planned", "2": "Plan dropped", "3": "Active/Operational", "4": "Closed" };
                            displayValue = statusMap[value] || value;
                        } else if (field === "duration") {
                            const durationMap = { "3_months": "3 Month", "6_months": "6 Month", "9_months": "9 Month", "12_months": "12 Month" };
                            displayValue = durationMap[value] || value;
                        } else if (field === "gender") {
                            const genderMap = { "1": "Male", "2": "Female" };
                            displayValue = genderMap[value] || value;
                        } else if (field === "child_age") {
                            const ageMap = { "1_year": "Below 1 Year", "1_2_year": "1-2 Year", "2_3_year": "2-3 Year" };
                            displayValue = ageMap[value] || value;
                        } else if (field === "creche_age") {
                            const crecheAgeMap = { "6_months": "6 Month", "12_months": "12 Month", "18_months": "18 Month", "24_months": "24 Month" };
                            displayValue = crecheAgeMap[value] || value;
                        } else if (field === "level") {
                            const levelMap = { "1": "Partner", "2": "State", "3": "District", "4": "Block", "5": "Supervisor", "6": "GP", "7": "Creche" };
                            displayValue = levelMap[value] || value;
                        }
                        activeFilters.push(`<strong>${selectFields[field]}:</strong> ${Array.isArray(displayValue) ? displayValue.join(", ") : displayValue}`);
                    }
                }
            });

            // 3b. Indicator (toolbar control, not a page field)
            const indicatorSelectEl = document.getElementById("indicatorSelect");
            if (indicatorSelectEl && indicatorSelectEl.value) {
                const indicatorMap = { "weight_for_age": "Weight for Age", "weight_for_height": "Weight for Height", "height_for_age": "Height for Age" };
                activeFilters.push(`<strong>Indicator:</strong> ${indicatorMap[indicatorSelectEl.value] || indicatorSelectEl.value}`);
            }

            // 4. Process Dates
            const rangeType = page.fields_dict["cr_opening_range_type"] ? page.fields_dict["cr_opening_range_type"].get_value() : "";
            if (rangeType) {
                if (rangeType === "between") {
                    const range = page.fields_dict["c_opening_range"] ? page.fields_dict["c_opening_range"].get_value() : null;
                    if (range && range[0] && range[1]) activeFilters.push(`<strong>Creche Opening:</strong> ${range[0]} to ${range[1]}`);
                } else {
                    const singleDate = page.fields_dict["single_date"] ? page.fields_dict["single_date"].get_value() : null;
                    if (singleDate) {
                        const rangeTypeMap = { "before": "Before", "after": "After", "equal": "On" };
                        activeFilters.push(`<strong>Creche Opening:</strong> ${rangeTypeMap[rangeType]} ${singleDate}`);
                    }
                }
            }

            filterDesc.innerHTML = activeFilters.length > 0 ? `${activeFilters.join(" &nbsp;|&nbsp; ")}` : "";
        }, 300);
    }
    
    function syncCrecheAgeWithOpeningDate() {
      const value = page.fields_dict.creche_age ? page.fields_dict.creche_age.get_value() : "";
      const type_field = page.fields_dict.cr_opening_range_type;
      const range_field = page.fields_dict.c_opening_range;
      const single_field = page.fields_dict.single_date;
      if (value) {
        const n_months_map = {"6_months": 6,"12_months": 12,"18_months": 18,"24_months": 24};
        const n_months = n_months_map[value];
        if (n_months !== undefined) {
          let curr_year = parseInt(page.fields_dict.year.get_value()) || new Date().getFullYear();
          let curr_month = parseInt(page.fields_dict.month.get_value()) || (new Date().getMonth() + 1);
          let current_date = new Date(curr_year, curr_month, 0);
          let past_date = new Date(current_date);
          past_date.setMonth(past_date.getMonth() - n_months);
          let date_str = past_date.getFullYear() + "-" + String(past_date.getMonth() + 1).padStart(2, '0') + "-" + String(past_date.getDate()).padStart(2, '0');
          type_field.set_value("before");
          single_field.set_value(date_str);
          range_field.set_value([]);
          range_field.toggle(false);
          single_field.toggle(true);
        }
      } else {
        type_field.set_value("");
        single_field.set_value("");
        range_field.set_value([]);
        range_field.toggle(false);
        single_field.toggle(false);
      }
    }
    
    let searchBtn = page.add_button(__("Search"), async () => {
      searchBtn.prop('disabled', true);
      searchBtn.text("Loading...");
      searchBtn.css("opacity", "0.7");
      await refreshChartData();
      searchBtn.text("Search");
      searchBtn.prop('disabled', false);
      searchBtn.css("opacity", "1");
    });
    
    let resetBtn = page.add_button(__("Reset"), async () => {
      resetBtn.prop('disabled', true);
      resetBtn.css("opacity", "0.7");
      location.reload();
    });

    let logicBtn = page.add_button(__("Logic"), () => {
      openLogicModal();
    });

    searchBtn.css({ "background-color": "#5979aa", "color": "white", "border-radius": "4px", "padding": "6px 16px", "font-weight": "500", "border": "none", "cursor": "pointer", "transition": "all 0.2s ease", "font-size": "12px", "margin-right": "5px" });
    resetBtn.css({ "background-color": "#f5f5f5", "color": "#333", "border-radius": "4px", "padding": "6px 16px", "font-weight": "500", "border": "1px solid #ddd", "cursor": "pointer", "transition": "all 0.2s ease", "font-size": "12px", "margin-right": "5px" });
    logicBtn.css({ "background-color": "#5979aa", "color": "white", "border-radius": "4px", "padding": "6px 16px", "font-weight": "500", "border": "none", "cursor": "pointer", "transition": "all 0.2s ease", "font-size": "12px" });
    
    page.main.append(`
      <div class="dashboard-container">
        <div class="tabs-nav">
          <div class="tab-nav-item active" data-tab="demography">Demography</div>
          <div class="tab-nav-item" data-tab="creche_profile">Creche Profile</div>
          <div class="tab-nav-item" data-tab="attendance">Attendance</div>
          <div class="tab-nav-item" data-tab="enrollment">Enrollment</div>
          <div class="tab-nav-item" data-tab="malnutrition">Malnutrition</div>
          <div class="tab-nav-item" data-tab="cohort">Cohort</div>
        </div>
        <div class="active-filters" id="filterDesc"></div>
        <div class="dashboard-content">
          <div class="indicators-sidebar">
            <div class="sidebar-header">
              <h3>Select Indicator</h3>
            </div>
            <div class="indicators-list" id="indicatorList"></div>
          </div>
          <div class="chart-container">
            <div class="chart-header">
              <h3 id="chartHeader">Select an indicator to view data</h3>
              <div class="chart-actions">
                <div class="chart-search-wrapper">
                  <svg class="chart-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                  </svg>
                  <input type="text" id="chartSearchInput" class="chart-search-input" placeholder="Search..." />
                  <button class="chart-search-clear" id="chartSearchClear" title="Clear search">&#10005;</button>
                </div>
                <button class="chart-action-btn" id="refreshChart" title="Refresh Data">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M23 4v6h-6"></path>
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
                  </svg>
                </button>
                <div class="chart-indicator-wrapper" id="indicatorWrapper" title="Indicator" style="display: none;">
                  <svg class="chart-indicator-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M23 4v6h-6"></path>
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
                  </svg>
                  <select id="indicatorSelect" class="chart-indicator-select">
                    <option value="weight_for_age">Weight for Age</option>
                    <option value="weight_for_height">Weight for Height</option>
                    <option value="height_for_age">Height for Age</option>
                  </select>
                </div>
              </div>
            </div>
            <div class="chart-display" id="chartField">
              <div class="chart-overlay-loader" id="spinnerContainer">
                <div class="spinner-wrapper">
                  <div class="spinner">
                    <div class="spinner-circle"></div>
                  </div>
                  <p class="loading-text">Loading chart data...</p>
                </div>
              </div>
              <div class="chart-scroll-outer" id="chartScrollOuter">
                <div id="chart-container" style="height: 380px;"></div>
              </div>
              <div class="scroll-hint" id="scrollHint">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
                Scroll right to see more data
              </div>
            </div>
          </div>
        </div>
      </div>

      <div id="logicModal" style="display: none; position: fixed; z-index: 10000; left: 0; top: 0; width: 100%; height: 100%; overflow: auto; background-color: rgba(0, 0, 0, 0.5); backdrop-filter: blur(3px);">
        <div id="logicModalContent" class="modal-content" style="background-color: #fff; margin: 5% auto; padding: 20px; border-radius: 12px; width: 90%; max-width: 1200px; max-height: 90vh; overflow: hidden; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2); position: relative; display: flex; flex-direction: column;">
          <div style="display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 15px;">
            <h2 style="flex: 1; margin: 0; font-size: 1.45rem; color: #5979aa;">Card Logic</h2>
            <button id="downloadLogicXlsxBtn" style="padding: 6px 12px; background-color: #5979aa; color: white; border: none; border-radius: 4px; cursor: pointer;">Download XLSX</button>
            <button id="downloadLogicPngBtn" style="padding: 6px 12px; background-color: #5979aa; color: white; border: none; border-radius: 4px; cursor: pointer;">Download PNG</button>
            <button id="downloadLogicPdfBtn" style="padding: 6px 12px; background-color: #5979aa; color: white; border: none; border-radius: 4px; cursor: pointer;">Download PDF</button>
            <button class="logic-close-btn" aria-label="Close" style="width: 36px; height: 36px; background: rgba(0,0,0,0.05); border: none; border-radius: 5px; font-size: 24px; cursor: pointer; display: flex; align-items: center; justify-content: center;">&times;</button>
          </div>

          <div id="logicTableWrapper" style="overflow-y: auto; max-height: 70vh; border-radius: 8px; border: 1px solid #ddd; background: white; padding: 10px;">
            <table style="width: 100%; border-collapse: collapse; font-size: 14px; text-align: left;">
              <thead style="position: sticky; top: -10px; background-color: #5979aa; color: white; z-index: 1;">
                <tr>
                  <th style="padding: 12px; border: 1px solid #ccc; width: 30%;">Card Title</th>
                  <th style="padding: 12px; border: 1px solid #ccc; width: 70%;">Logic</th>
                </tr>
              </thead>
              <tbody id="logicTableBody"></tbody>
            </table>
          </div>
        </div>
      </div>

      <div id="childDetailsModal" style="display: none; position: fixed; z-index: 10000; left: 0; top: 0; width: 100%; height: 100%; overflow: auto; background-color: rgba(0, 0, 0, 0.5); backdrop-filter: blur(3px);">
        <div id="childDetailsModalContent" class="modal-content" style="background-color: #fff; margin: 4% auto; padding: 20px; border-radius: 12px; width: 92%; max-width: 1400px; max-height: 90vh; overflow: hidden; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2); position: relative; display: flex; flex-direction: column;">
          <div style="display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 12px;">
            <h2 id="childDetailsTitle" style="flex: 1; margin: 0; font-size: 1.3rem; color: #5979aa; min-width: 0;">Child Details</h2>
            <button id="downloadChildDetailsXlsxBtn" style="padding: 6px 12px; background-color: #5979aa; color: white; border: none; border-radius: 4px; cursor: pointer; white-space: nowrap;">Download (XLSX)</button>
            <button class="child-details-close-btn" aria-label="Close" style="width: 36px; height: 36px; background: rgba(0,0,0,0.05); border: none; border-radius: 5px; font-size: 24px; cursor: pointer; display: flex; align-items: center; justify-content: center;">&times;</button>
          </div>

          <div id="childDetailsTableWrapper" style="overflow: auto; max-height: 65vh; border-radius: 8px; border: 1px solid #ddd; background: white; position: relative; min-height: 150px;">
            <table style="width: 100%; border-collapse: collapse; font-size: 13px; text-align: left; white-space: nowrap;">
              <thead id="childDetailsTableHead" style="position: sticky; top: 0; background-color: #5979aa; color: white; z-index: 1;"></thead>
              <tbody id="childDetailsTableBody"></tbody>
            </table>
            <div id="childDetailsLoader" style="display: none; align-items: center; justify-content: center; padding: 40px; color: #64748b;">Loading...</div>
            <div id="childDetailsEmpty" style="display: none; align-items: center; justify-content: center; padding: 40px; color: #94a3b8;">No records found for the selected filters.</div>
          </div>

          <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 12px; font-size: 13px; color: #475569;">
            <span id="childDetailsSummary">Showing 0 of 0 records</span>
            <div style="display: flex; gap: 6px; align-items: center;">
              <button id="childDetailsPrevBtn" style="padding: 5px 12px; border: 1px solid #e2e8f0; background: white; border-radius: 4px; cursor: pointer;">&larr; Prev</button>
              <span id="childDetailsPageInfo">Page 1</span>
              <button id="childDetailsNextBtn" style="padding: 5px 12px; border: 1px solid #e2e8f0; background: white; border-radius: 4px; cursor: pointer;">Next &rarr;</button>
            </div>
          </div>
        </div>
      </div>
    `);

    const style = document.createElement('style');
    style.textContent = `
      .dashboard-container { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #ffffff; min-height: calc(100vh - 140px); font-size: 14px; }
      .tabs-nav { display: flex; flex-wrap: wrap; gap: 4px; background: white; border-radius: 6px; padding: 4px; margin-bottom: 15px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); border: 1px solid #e2e8f0; max-width: 100%; }
      .tabs-nav::-webkit-scrollbar { display: none; }
      .tab-nav-item { flex: none; min-width: auto; text-align: center; padding: 10px 16px; font-weight: 500; color: #64748b; cursor: pointer; border-radius: 4px; transition: all 0.15s ease; font-size: 14px; user-select: none; }
      .tab-nav-item:hover { background: #f1f5f9; color: #475569; }
      .tab-nav-item.active { background: #5979aa; color: white; font-weight: 600; box-shadow: 0 1px 3px rgba(89, 121, 170, 0.3); }
      .active-filters { background: white; border-radius: 6px; padding: 14px 18px; margin-bottom: 15px; border: 1px solid #e2e8f0; font-size: 13px; color: #475569; line-height: 1.4; }
      .active-filters strong { color: #334155; font-weight: 600; font-size: 13px; }
      .dashboard-content { display: grid; grid-template-columns: 280px 1fr; gap: 16px; min-height: 450px; }
      @media (max-width: 1024px) { .dashboard-content { grid-template-columns: 1fr; } }
      .indicators-sidebar { background: white; border-radius: 8px; border: 1px solid #e2e8f0; overflow: hidden; display: flex; flex-direction: column; box-shadow: 0 1px 3px rgba(0,0,0,0.1); height: fit-content; }
      .sidebar-header { padding: 15px 18px; border-bottom: 1px solid #f1f5f9; background: #5979aa; color: white; }
      .sidebar-header h3 { margin: 0; font-size: 17px; font-weight: 600; }
      .indicators-list { flex: 1; overflow-y: auto; padding: 10px 0; max-height: 450px; }
      .indicator-item { padding: 12px 18px; border-bottom: 1px solid #f8fafc; cursor: pointer; transition: all 0.15s ease; font-size: 14px; color: #334155; display: flex; align-items: center; position: relative; user-select: none; }
      .indicator-item:last-child { border-bottom: none; }
      .indicator-item:hover { background: #f8fafc; color: #5979aa; }
      .indicator-item.selected { background: #5979aa; color: white; font-weight: 500; border-left: 3px solid #4267B2; }
      .indicator-item::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: #cbd5e1; margin-right: 12px; flex-shrink: 0; }
      .indicator-item.selected::before { background: white; }
      .indicator-item:active { transform: translateY(1px); }
      .chart-container { background: white; border-radius: 8px; border: 1px solid #e2e8f0; overflow: hidden; display: flex; flex-direction: column; box-shadow: 0 1px 3px rgba(0,0,0,0.1); min-width: 0; }
      .chart-header { padding: 12px 16px; border-bottom: 1px solid #f1f5f9; display: flex; justify-content: space-between; align-items: center; background: white; gap: 12px; flex-wrap: wrap; }
      .chart-header h3 { margin: 0; font-size: 16px; font-weight: 600; color: #1e293b; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .chart-actions { display: flex; gap: 8px; align-items: center; flex-shrink: 0; flex-wrap: wrap; }
      .chart-search-wrapper { position: relative; display: flex; align-items: center; }
      .chart-search-icon { position: absolute; left: 8px; color: #94a3b8; pointer-events: none; flex-shrink: 0; }
      .chart-search-input { padding: 6px 28px; border: 1px solid #e2e8f0; border-radius: 4px; font-size: 13px; color: #334155; background: #f8fafc; width: 160px; transition: all 0.15s ease; outline: none; }
      .chart-search-input:focus { border-color: #5979aa; background: white; box-shadow: 0 0 0 2px rgba(89,121,170,0.15); width: 200px; }
      .chart-search-clear { position: absolute; right: 6px; background: none; border: none; color: #94a3b8; cursor: pointer; font-size: 11px; padding: 2px 4px; display: none; line-height: 1; }
      .chart-search-clear:hover { color: #475569; }
      .chart-action-btn { width: 34px; height: 34px; border-radius: 4px; border: 1px solid #e2e8f0; background: white; color: #64748b; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.15s ease; padding: 0; flex-shrink: 0; }
      .chart-action-btn:hover { background: #f1f5f9; color: #475569; border-color: #cbd5e1; }
      .chart-action-btn:active { transform: scale(0.95); }
      .chart-indicator-wrapper { position: relative; display: flex; align-items: center; height: 34px; border-radius: 4px; border: 1px solid #e2e8f0; background: white; color: #64748b; padding: 0 8px 0 8px; transition: all 0.15s ease; flex-shrink: 0; }
      .chart-indicator-wrapper:hover { background: #f1f5f9; color: #475569; border-color: #cbd5e1; }
      .chart-indicator-icon { flex-shrink: 0; pointer-events: none; }
      .chart-indicator-select { appearance: none; -webkit-appearance: none; -moz-appearance: none; border: none; background: transparent; color: #334155; font-size: 12px; font-weight: 500; padding: 0 16px 0 6px; height: 32px; cursor: pointer; outline: none; }
      .chart-indicator-wrapper::after { content: ''; position: absolute; right: 8px; top: 50%; width: 0; height: 0; border-left: 4px solid transparent; border-right: 4px solid transparent; border-top: 4px solid #94a3b8; transform: translateY(-50%); pointer-events: none; }
      body.modal-open { overflow: hidden; }
      .chart-display { flex: 1; min-height: 380px; padding: 16px 16px 8px 16px; position: relative; background: white; display: flex; flex-direction: column; overflow: hidden; }
      .chart-scroll-outer { flex: 1; overflow-x: auto; overflow-y: hidden; -webkit-overflow-scrolling: touch; min-height: 380px; position: relative; scrollbar-width: thin; scrollbar-color: #cbd5e1 #f1f5f9; }
      .chart-scroll-outer::-webkit-scrollbar { height: 6px; }
      .chart-scroll-outer::-webkit-scrollbar-track { background: #f1f5f9; border-radius: 3px; }
      .chart-scroll-outer::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }
      .chart-scroll-outer::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
      .scroll-hint { display: none; align-items: center; gap: 4px; color: #94a3b8; font-size: 11px; padding: 4px 0 0 0; justify-content: flex-end; }
      .scroll-hint.visible { display: flex; }
      .chart-overlay-loader { position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(255, 255, 255, 0.95); display: none; z-index: 100; align-items: center; justify-content: center; flex-direction: column; }
      .spinner-wrapper { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; }
      .spinner { position: relative; width: 48px; height: 48px; }
      .spinner-circle { position: absolute; width: 100%; height: 100%; border: 4px solid transparent; border-top-color: #5979aa; border-right-color: #5979aa; border-radius: 50%; animation: spin 1s linear infinite; }
      @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
      .loading-text { margin: 0; color: #64748b; font-size: 15px; font-weight: 500; }
      .indicators-list::-webkit-scrollbar { width: 6px; }
      .indicators-list::-webkit-scrollbar-track { background: #f1f5f9; }
      .indicators-list::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }
      .indicators-list::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
      @media (max-width: 768px) {
        .dashboard-content { gap: 12px; grid-template-columns: 1fr; }
        .tabs-nav { max-width: 100%; }
        .chart-header { padding: 10px 12px; }
        .chart-header h3 { font-size: 14px; }
        .indicators-list { max-height: 250px; }
        .chart-display { padding: 12px 12px 6px 12px; min-height: 320px; }
        .chart-scroll-outer { min-height: 320px; }
        .chart-search-input { width: 120px; }
        .chart-search-input:focus { width: 150px; }
        .chart-actions { gap: 6px; }
      }
      @media (max-width: 480px) { .chart-search-input { width: 100px; } .chart-search-input:focus { width: 130px; } }
      .bar-value-btn { position: absolute; transform: translate(-50%, -100%); background: #5979aa; color: #fff; border: none; border-radius: 10px; padding: 2px 8px; font-size: 11px; font-weight: 600; cursor: pointer; white-space: nowrap; box-shadow: 0 1px 3px rgba(0,0,0,0.25); z-index: 5; transition: transform 0.1s ease, background 0.15s ease; pointer-events: auto; }
      .bar-value-btn:hover { background: #43587a; transform: translate(-50%, -100%) scale(1.06); }
      .bar-value-btn:active { transform: translate(-50%, -100%) scale(0.96); }
      .bar-value-overlay { position: absolute; top: 0; left: 0; right: 0; bottom: 0; pointer-events: none; }
      #childDetailsTableWrapper table th, #childDetailsTableWrapper table td { padding: 8px 10px; border: 1px solid #e5e7eb; }
      #childDetailsTableWrapper table tbody tr:nth-child(even) { background: #f9fafb; }
      #childDetailsTableWrapper table tbody tr:hover { background: #eef2f7; }
      #childDetailsPrevBtn:disabled, #childDetailsNextBtn:disabled { opacity: 0.5; cursor: not-allowed; }
    `;
    document.head.appendChild(style);
    
    // Same-origin API calls: the page always talks to the site that served it (UAT or production).
    const BASE_URL = "";
    let selectedPartnerId, stateId, district_id, block_id, gp_id, creche_id, supervisor_id, child_age, gender, level;
    let year = new Date().getFullYear().toString();
    let month = (new Date().getMonth() + 1).toString();
    let chartEndpoint, chartType, chartIndicator, chartColors, chartChildDetails;
    let currentChart = null;
    let lastRenderedChartData = null;
    // Filters the currently displayed chart was fetched with. The drill-down and the
    // Child Details popup reuse this exact snapshot (not whatever the filter fields say
    // now), so the popup always lists exactly the children counted on the clicked bar.
    let lastChartParams = null;
    let chartAbortController = null;
    let chartRequestSeq = 0;
    let currentTab = "demography";
    let fullChartData = null;
    let searchTimeout = null;
    
    function updateFilterValues() {
      year = page.fields_dict["year"] ? page.fields_dict["year"].get_value() : year;
      month = page.fields_dict["month"] ? page.fields_dict["month"].get_value() : month;
      selectedPartnerId = page.fields_dict["partner"] ? page.fields_dict["partner"].get_value() : "";
      stateId = page.fields_dict["state"] ? page.fields_dict["state"].get_value() : "";
      district_id = page.fields_dict["district"] ? page.fields_dict["district"].get_value() : "";
      block_id = page.fields_dict["block"] ? page.fields_dict["block"].get_value() : "";
      gp_id = page.fields_dict["gp"] ? page.fields_dict["gp"].get_value() : "";
      creche_id = page.fields_dict["creche"] ? page.fields_dict["creche"].get_value() : "";
      supervisor_id = page.fields_dict["supervisor_id"] ? page.fields_dict["supervisor_id"].get_value() : "";
      child_age = page.fields_dict["child_age"] ? page.fields_dict["child_age"].get_value() : "";
      gender = page.fields_dict["gender"] ? page.fields_dict["gender"].get_value() : "";
      level = page.fields_dict["level"] ? page.fields_dict["level"].get_value() : "";
    }
    
    const indicatorsList = {
      demography: [
        { indicator: "Age-wise Distribution of Enrolled Children", type: "pie", endpoint: "get_age_wise_distribution" },
        { indicator: "Gender-wise Distribution of Enrolled Children", type: "pie", endpoint: "get_gender_wise_distribution" },
        { indicator: "Children enrolled at age in months", type: "pie", endpoint: "age_in_months" },
        { indicator: "Specially abled children", type: "pie", endpoint: "get_specially_abled_children" },
        { indicator: "Education level of mother", type: "pie", endpoint: "get_education_level_mother" },
        { indicator: "Registered households", type: "bar", colors: ["#FF5722"], endpoint: "get_reg_HH", childDetails: { api: "get_registered_households_details" } },
        { indicator: "Households religion wise", type: "pie", endpoint: "get_religion_data" },
        { indicator: "Households caste wise", type: "pie", endpoint: "get_caste_data" },
        { indicator: "Households occupation wise", type: "pie", endpoint: "get_occupation_data" },
        { indicator: "Households migrating", type: "pie", endpoint: "hh_migration_data" },
      ],
      creche_profile: [
        { indicator: "Creche Status", type: "stacked_bar", colors: ["#f59e0b", "#ef4444", "#10b981", "#64748b"], endpoint: "get_creche_status_data" },
        { indicator: "Creche Inauguration Trend (Month Wise)", type: "bar", colors: ["#5979aa"], endpoint: "get_creche_inauguration_trend_data" },
        { indicator: "Type of Creche House", type: "stacked_bar", colors: ["#8b5cf6", "#f59e0b", "#10b981", "#ec4899"], endpoint: "get_type_of_creche_house_data" },
        { indicator: "Type of Building", type: "stacked_bar", colors: ["#5979aa", "#f59e0b"], endpoint: "get_type_of_building_data" },
        { indicator: "Hard To Reach", type: "stacked_bar", colors: ["#ef4444", "#10b981"], endpoint: "get_hard_to_reach_data" },
        { indicator: "Roof Type", type: "stacked_bar", colors: ["#64748b", "#f59e0b", "#10b981", "#3b82f6"], endpoint: "get_roof_type_data" },
        { indicator: "Source of Power Supply", type: "stacked_bar", colors: ["#f59e0b", "#10b981", "#3b82f6"], endpoint: "get_source_of_power_supply_data" },
        { indicator: "Equipped with Lightning Arrestor", type: "stacked_bar", colors: ["#10b981", "#ef4444"], endpoint: "get_equipped_with_lightning_arrestor_data" },
        { indicator: "Age-wise Creche Distribution", type: "stacked_bar", colors: ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"], endpoint: "get_age_wise_creche_distribution_data" },
        { indicator: "Independent Kitchen Room", type: "stacked_bar", colors: ["#10b981", "#ef4444"], endpoint: "get_independent_kitchen_room_data" },
        { indicator: "Equipped with Operational Toilet", type: "stacked_bar", colors: ["#10b981", "#ef4444"], endpoint: "get_equipped_with_operational_toilet_data" }
      ],
      attendance: [
        { indicator: "Avg. Daily Attendance", type: "bar", colors: ["#5979aa"], endpoint: "avg_daily_attendance" },
        { indicator: "Attendance (%)", type: "bar", colors: ["#10b981"], endpoint: "attendance_percentage" },
        { indicator: "No of Children with (100% Attendance)", type: "bar", colors: ["#10b981"], endpoint: "full_attendance", childDetails: { api: "get_attendance_details", indicator_key: "full_attendance" } },
        { indicator: "No of Children with (0% Attendance)", type: "bar", colors: ["#c3c03a"], endpoint: "zero_attendance", childDetails: { api: "get_attendance_details", indicator_key: "zero_attendance" } },
        { indicator: "No of Regular Children (Attendance ≥ 70%)", type: "bar", colors: ["#f59e0b"], endpoint: "seventy_attendance", childDetails: { api: "get_attendance_details", indicator_key: "seventy_attendance" } },
        { indicator: "No of Irregular Children (Attendance ≤ 50%)", type: "bar", colors: ["#ef4444"], endpoint: "fivety_attendance", childDetails: { api: "get_attendance_details", indicator_key: "fivety_attendance" } },
        { indicator: "Avg. Attendance of SAM Children", type: "bar", colors: ["#8b5cf6"], endpoint: "avg_sam_attendance_percent" },
        { indicator: "Avg. Attendance of SUW Children", type: "bar", colors: ["#ec4899"], endpoint: "avg_suw_attendance_percent" },
      ],
      enrollment: [
        { indicator: "Elligible vs Enrolled (Unique Value)",  type: "line", colors: ["#0047AB", "#0BDA51"], endpoint: "get_active_enrolled_data" },
        { indicator: "Total Exited", type: "bar", endpoint: "get_total_exited", childDetails: { api: "get_enrollment_details", indicator_key: "get_total_exited" } },
        { indicator: "Exit (Graduated)", type: "bar", endpoint: "get_exit_graduated", childDetails: { api: "get_enrollment_details", indicator_key: "get_exit_graduated" } },
        { indicator: "Exit (Migrated)", type: "bar", endpoint: "get_exit_migrated", childDetails: { api: "get_enrollment_details", indicator_key: "get_exit_migrated" } },
        { indicator: "Exit (Not Willing to Stay)", type: "bar", endpoint: "get_exit_not_willing", childDetails: { api: "get_enrollment_details", indicator_key: "get_exit_not_willing" } },
        { indicator: "Exit (Death)", type: "bar", endpoint: "get_exit_death", childDetails: { api: "get_enrollment_details", indicator_key: "get_exit_death" } },
        { indicator: "Exit (Other)", type: "bar", endpoint: "get_exit_other", childDetails: { api: "get_enrollment_details", indicator_key: "get_exit_other" } },
        { indicator: "Total Not Enrolled", type: "bar", endpoint: "get_total_not_enrolled", childDetails: { api: "get_household_enrollment_details", indicator_key: "get_total_not_enrolled" } },
        { indicator: "Not Enrolled (Migrated)", type: "bar", endpoint: "get_not_enrolled_migrated", childDetails: { api: "get_household_enrollment_details", indicator_key: "get_not_enrolled_migrated" } },
        { indicator: "Not Enrolled (Death)", type: "bar", endpoint: "get_not_enrolled_death", childDetails: { api: "get_household_enrollment_details", indicator_key: "get_not_enrolled_death" } },
        { indicator: "Not Enrolled (Outside Catchment Area)", type: "bar", endpoint: "get_not_enrolled_outside_catchment", childDetails: { api: "get_household_enrollment_details", indicator_key: "get_not_enrolled_outside_catchment" } },
        { indicator: "To be Enrolled", type: "bar", endpoint: "get_to_be_enrolled", childDetails: { api: "get_household_enrollment_details", indicator_key: "get_to_be_enrolled" } },
        { indicator: "New Enrolment", type: "bar", endpoint: "get_new_enrolment", childDetails: { api: "get_enrollment_details", indicator_key: "get_new_enrolment" } }
      ],
      malnutrition: [
        { indicator: "Measurment (%)", type: "bar", endpoint: "get_measured_data", childDetails: { api: "get_malnutrition_details", indicator_key: "get_measured_data" } },
        { indicator: "Enrolled vs Measured", type: "line", colors: ["#0047AB", "#0BDA51"], endpoint: "get_enrolled_measured" },
        { indicator: "WFA (Normal)", type: "bar",   colors: ["#009630"] ,endpoint: "get_wfa_normal_data", childDetails: { api: "get_malnutrition_details", indicator_key: "get_wfa_normal_data" } },
        { indicator: "WFA (Modrate )", type: "bar",colors: ["#f0ce22"] , endpoint: "get_wfa_modrate_data", childDetails: { api: "get_malnutrition_details", indicator_key: "get_wfa_modrate_data" } },
        { indicator: "WFA (Severe )", type: "bar", colors: ["#af2b2b"] , endpoint: "get_wfa_severe_data", childDetails: { api: "get_malnutrition_details", indicator_key: "get_wfa_severe_data" } },
        { indicator: "WFH (Normal)", type: "bar", colors: ["#009630"] ,   endpoint: "get_wfh_normal_data", childDetails: { api: "get_malnutrition_details", indicator_key: "get_wfh_normal_data" } },
        { indicator: "WFH (Modrate )", type: "bar",  colors: ["#f0ce22"] ,  endpoint: "get_wfh_modrate_data", childDetails: { api: "get_malnutrition_details", indicator_key: "get_wfh_modrate_data" } },
        { indicator: "WFH (Severe )", type: "bar", colors: ["#af2b2b"] , endpoint: "get_wfh_severe_data", childDetails: { api: "get_malnutrition_details", indicator_key: "get_wfh_severe_data" } },
        { indicator: "HFA (Normal)", type: "bar", colors: ["#009630"] ,  endpoint: "get_hfa_normal_data", childDetails: { api: "get_malnutrition_details", indicator_key: "get_hfa_normal_data" } },
        { indicator: "HFA (Modrate )", type: "bar", colors: ["#f0ce22"] ,  endpoint: "get_hfa_modrate_data", childDetails: { api: "get_malnutrition_details", indicator_key: "get_hfa_modrate_data" } },
        { indicator: "HFA (Severe )", type: "bar", colors: ["#af2b2b"] , endpoint: "get_hfa_severe_data", childDetails: { api: "get_malnutrition_details", indicator_key: "get_hfa_severe_data" } },
        { indicator: "Weight for Age (ALL)", type: "stacked_bar", colors: ["#009630", "#f0ce22", "#af2b2b"], endpoint: "get_weight_age_data" },
        { indicator: "Weight for Height (ALL)", type: "stacked_bar", colors: ["#009630", "#f0ce22", "#af2b2b"], endpoint: "get_weight_height_data" },
        { indicator: "Height for Age (ALL)", type: "stacked_bar", colors: ["#009630", "#f0ce22", "#af2b2b"], endpoint: "get_height_age_data" },
        { indicator: "GF1", type: "bar",colors: ["#af2b2b"] , endpoint: "get_gf_data", childDetails: { api: "get_gf_snc_details", indicator_key: "gf1" } },
        { indicator: "GF1+", type: "bar", colors: ["#af2b2b"] , endpoint: "get_gf_one_data", childDetails: { api: "get_gf_snc_details", indicator_key: "gf1_plus" } },
        { indicator: "GF2", type: "bar", colors: ["#af2b2b"] , endpoint: "get_gf_two_data", childDetails: { api: "get_gf_snc_details", indicator_key: "gf2" } },
        { indicator: "Zig Zag", type: "bar",colors: ["#af2b2b"] , endpoint: "get_zig_zag_data", childDetails: { api: "get_gf_snc_details", indicator_key: "zig_zag" } },
        { indicator: "SNC", type: "bar", colors: ["#af2b2b"] , endpoint: "get_snc_data", childDetails: { api: "get_gf_snc_details", indicator_key: "snc" } }
      ],
      cohort: [
        { indicator: "Moderate to Normal", type: "bar", colors: ["#b7eb8f"], endpoint: "get_cohort_moderate_to_normal", childDetails: { api: "get_cohort_details", indicator_key: "get_cohort_moderate_to_normal" } },
        { indicator: "Severe to Moderate", type: "bar", colors: ["#b7eb8f"], endpoint: "get_cohort_severe_to_moderate", childDetails: { api: "get_cohort_details", indicator_key: "get_cohort_severe_to_moderate" } },
        { indicator: "Severe to Normal", type: "bar", colors: ["#b7eb8f"], endpoint: "get_cohort_severe_to_normal", childDetails: { api: "get_cohort_details", indicator_key: "get_cohort_severe_to_normal" } },
        { indicator: "Total Recovery", type: "bar", colors: ["#b7eb8f"], endpoint: "get_cohort_total_recovery", childDetails: { api: "get_cohort_details", indicator_key: "get_cohort_total_recovery" } },
        { indicator: "Normal to Moderate", type: "bar", colors: ["#ffccc7"], endpoint: "get_cohort_normal_to_moderate", childDetails: { api: "get_cohort_details", indicator_key: "get_cohort_normal_to_moderate" } },
        { indicator: "Normal to Severe", type: "bar", colors: ["#ffccc7"], endpoint: "get_cohort_normal_to_severe", childDetails: { api: "get_cohort_details", indicator_key: "get_cohort_normal_to_severe" } },
        { indicator: "Moderate to Severe", type: "bar", colors: ["#ffccc7"], endpoint: "get_cohort_moderate_to_severe", childDetails: { api: "get_cohort_details", indicator_key: "get_cohort_moderate_to_severe" } },
        { indicator: "Total Deterioration", type: "bar", colors: ["#ffccc7"], endpoint: "get_cohort_total_deterioration", childDetails: { api: "get_cohort_details", indicator_key: "get_cohort_total_deterioration" } },
        { indicator: "Normal to Normal", type: "bar", colors: ["#f0f0f0"], endpoint: "get_cohort_normal_to_normal", childDetails: { api: "get_cohort_details", indicator_key: "get_cohort_normal_to_normal" } },
        { indicator: "Moderate to Moderate", type: "bar", colors: ["#f0f0f0"], endpoint: "get_cohort_moderate_to_moderate", childDetails: { api: "get_cohort_details", indicator_key: "get_cohort_moderate_to_moderate" } },
        { indicator: "Severe to Severe", type: "bar", colors: ["#f0f0f0"], endpoint: "get_cohort_severe_to_severe", childDetails: { api: "get_cohort_details", indicator_key: "get_cohort_severe_to_severe" } },
        { indicator: "No Change", type: "bar", colors: ["#f0f0f0"], endpoint: "get_cohort_no_change", childDetails: { api: "get_cohort_details", indicator_key: "get_cohort_no_change" } }
      ]
    };
    
    const tabs = document.querySelectorAll(".tab-nav-item");
    const indicatorList = document.getElementById("indicatorList");
    const chartHeader = document.getElementById("chartHeader");
    const spinnerContainer = document.getElementById("spinnerContainer");
    const refreshChartBtn = document.getElementById("refreshChart");
    const chartSearchInput = document.getElementById("chartSearchInput");
    const chartSearchClear = document.getElementById("chartSearchClear");
    const scrollHint = document.getElementById("scrollHint");
    const chartScrollOuter = document.getElementById("chartScrollOuter");

    chartSearchInput.addEventListener("input", function() {
      clearTimeout(searchTimeout);
      const query = this.value.trim();
      chartSearchClear.style.display = query ? "block" : "none";
      searchTimeout = setTimeout(() => { applySearch(query); }, 300);
    });

    chartSearchClear.addEventListener("click", function() {
      chartSearchInput.value = "";
      chartSearchClear.style.display = "none";
      applySearch("");
    });

    function applySearch(query) {
      if (!fullChartData) return;
      if (!query) {
        renderChart(fullChartData, chartType, chartColors);
        return;
      }
      const lowerQuery = query.toLowerCase();
      const matchedIndices = [];
      (fullChartData.labels || []).forEach((label, i) => {
        if (String(label).toLowerCase().includes(lowerQuery)) {
          matchedIndices.push(i);
        }
      });

      const filteredData = {
        ...fullChartData,
        labels: matchedIndices.map(i => fullChartData.labels[i]),
        datasets: (fullChartData.datasets || []).map(ds => ({
          ...ds,
          values: matchedIndices.map(i => ds.values[i])
        }))
      };

      renderChart(filteredData, chartType, chartColors);
    }

    function renderIndicators(tabId) {
      currentTab = tabId;
      indicatorList.innerHTML = "";
      const indicators = indicatorsList[tabId] || [];

      const indicatorWrapper = document.getElementById("indicatorWrapper");
      if (indicatorWrapper) indicatorWrapper.style.display = tabId === "cohort" ? "flex" : "none";
      
      indicators.forEach((indicator, index) => {
        const div = document.createElement("div");
        div.className = "indicator-item";
        div.textContent = indicator.indicator;
        
        if (index === 0) {
          div.classList.add("selected");
          chartEndpoint = indicator.endpoint;
          chartType = indicator.type;
          chartIndicator = indicator.indicator;
          chartColors = indicator.colors || null;
          chartChildDetails = indicator.childDetails || null;
        }

        div.addEventListener("click", function () {
          document.querySelectorAll(".indicator-item").forEach(ind => ind.classList.remove("selected"));
          this.classList.add("selected");

          const indicatorData = indicators[index];
          chartEndpoint = indicatorData.endpoint;
          chartType = indicatorData.type;
          chartIndicator = indicatorData.indicator;
          chartColors = indicatorData.colors || null;
          chartChildDetails = indicatorData.childDetails || null;

          chartSearchInput.value = "";
          chartSearchClear.style.display = "none";

          refreshChartData();
        });
        indicatorList.appendChild(div);
      });
    }
    
    tabs.forEach(tab => {
      tab.addEventListener("click", function(e) {
        tabs.forEach(t => t.classList.remove("active"));
        this.classList.add("active");
        
        const tabId = this.dataset.tab;
        renderIndicators(tabId);
        chartSearchInput.value = "";
        chartSearchClear.style.display = "none";
        refreshChartData();
      });
    });
    
    renderIndicators("demography");
    
    function computeChartWidth(numBars, type) {
      if (type === "pie") return "100%";
      const containerWidth = chartScrollOuter.clientWidth || 600;
      if (numBars <= 0) return containerWidth + "px";
      const minBarWidth = numBars > 100 ? 40 : numBars > 30 ? 55 : 70;
      const computed = Math.max(containerWidth, numBars * minBarWidth);
      return computed + "px";
    }

    function updateScrollHint() {
      const outer = chartScrollOuter;
      if (outer && outer.scrollWidth > outer.clientWidth + 4) {
        scrollHint.classList.add("visible");
      } else {
        scrollHint.classList.remove("visible");
      }
    }

    // Snapshot of every filter currently selected on the page, as API params.
    function buildFilterParams() {
      updateFilterValues();
      let params = {
        year: year, month: month, partner_id: selectedPartnerId, state_id: stateId,
        district_id: district_id, block_id: block_id, gp_id: gp_id, creche_id: creche_id,
        supervisor_id: supervisor_id, gender: gender, child_age: child_age, level: level
      };

      const phases_val = page.fields_dict.phases ? page.fields_dict.phases.get_value() : null;
      if (phases_val && phases_val.length > 0) params.phases = phases_val.join(",");

      const status_val = page.fields_dict.creche_status_id ? page.fields_dict.creche_status_id.get_value() : null;
      if (status_val) params.creche_status_id = status_val;

      const duration_val = page.fields_dict.duration ? page.fields_dict.duration.get_value() : null;
      if (duration_val) params.duration = duration_val;

      const indicatorSelectEl = document.getElementById("indicatorSelect");
      const indicator_val = indicatorSelectEl ? indicatorSelectEl.value : null;
      if (indicator_val) params.indicator = indicator_val;

      let opening_from = null;
      let opening_to = null;
      const range_type = page.fields_dict.cr_opening_range_type ? page.fields_dict.cr_opening_range_type.get_value() : "";
      if (range_type === "between") {
        const range = page.fields_dict.c_opening_range ? page.fields_dict.c_opening_range.get_value() : null;
        if (range && range[0] && range[1]) { opening_from = range[0]; opening_to = range[1]; }
      } else if (range_type) {
        const s_date = page.fields_dict.single_date ? page.fields_dict.single_date.get_value() : null;
        if (s_date) {
          if (range_type === "after") opening_from = s_date;
          else if (range_type === "before") opening_to = s_date;
          else if (range_type === "equal") { opening_from = s_date; opening_to = s_date; }
        }
      }
      if (opening_from) params.opening_from = opening_from;
      if (opening_to) params.opening_to = opening_to;

      return Object.fromEntries(Object.entries(params).filter(([_, v]) => v !== "" && v !== null && v !== undefined));
    }

    // `baseParams` lets a caller reuse an exact earlier filter snapshot (the drill-down
    // modal reuses the snapshot of the chart it was opened from).
    async function fetchChartData(endpoint, { isDrilldown = false, drillGroup = null, baseParams = null, force = false, signal = undefined } = {}) {
      let params = { ...(baseParams || buildFilterParams()) };

      if (isDrilldown && drillGroup) {
        params.drilldown_group = drillGroup;
        params.drilldown_level = params.level;
      }
      if (force) params.refresh = 1;

      const queryParams = new URLSearchParams(params).toString();
      const Url = `${BASE_URL}/api/method/frappe.apf.page.mis_attendances_dash.indicator.${endpoint}?${queryParams}`;

      try {
        const response = await fetch(Url, { signal, credentials: "same-origin" });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        return data && data.data ? data.data : null;
      } catch (error) {
        if (error && error.name === "AbortError") throw error;
        console.error("Error fetching chart data:", error);
        return null;
      }
    }
    
    // ==============================================================================
    // ADVANCED TITLE & CONTEXT RESOLVER
    // ==============================================================================
    
    async function resolveDbName(doctype, id_val, name_field) {
        if (!id_val) return null;
        try {
            let r = await frappe.db.get_value(doctype, id_val, name_field);
            return (r && r.message && r.message[name_field]) ? r.message[name_field] : id_val;
        } catch(e) { return id_val; }
    }

    async function getResolvedHierarchyTitle(clickedLabel) {
        let parts = [];
        let selectedLevel = parseInt(page.fields_dict.level.get_value()) || 0;
        
        let baseIds = await getResolvedHierarchyFromFilters();
        let entityIds = { ...baseIds };

        const levelMeta = {
            2: { doctype: "State", name_field: "state_name", fields: [] },
            3: { doctype: "District", name_field: "district_name", fields: ["state_id"] },
            4: { doctype: "Block", name_field: "block_name", fields: ["state_id", "district_id"] },
            6: { doctype: "Gram Panchayat", name_field: "gp_name", fields: ["state_id", "district_id", "block_id"] },
            7: { doctype: "Creche", name_field: "creche_name", fields: ["state_id", "district_id", "block_id", "gp_id"] }
        };

        if (selectedLevel && levelMeta[selectedLevel]) {
            let meta = levelMeta[selectedLevel];
            let queryFilters = { [meta.name_field]: clickedLabel };
            
            // Prevent duplicate name clashes across states by feeding the existing UI filter context
            if (baseIds.state) queryFilters.state_id = baseIds.state;
            if (baseIds.district) queryFilters.district_id = baseIds.district;
            if (baseIds.block) queryFilters.block_id = baseIds.block;

            try {
                let r = await frappe.db.get_value(meta.doctype, queryFilters, meta.fields);
                if (r && r.message) {
                    if (r.message.state_id) entityIds.state = r.message.state_id;
                    if (r.message.district_id) entityIds.district = r.message.district_id;
                    if (r.message.block_id) entityIds.block = r.message.block_id;
                    if (r.message.gp_id) entityIds.gp = r.message.gp_id;
                }
            } catch(e) {}
        }

        if (entityIds.state && (!selectedLevel || selectedLevel > 2)) {
            let name = await resolveDbName("State", entityIds.state, "state_name");
            if (name) parts.push(`State: ${name}`);
        }
        if (entityIds.district && (!selectedLevel || selectedLevel > 3)) {
            let name = await resolveDbName("District", entityIds.district, "district_name");
            if (name) parts.push(`District: ${name}`);
        }
        if (entityIds.block && (!selectedLevel || selectedLevel > 4)) {
            let name = await resolveDbName("Block", entityIds.block, "block_name");
            if (name) parts.push(`Block: ${name}`);
        }
        if (entityIds.gp && (!selectedLevel || selectedLevel > 6)) {
            let name = await resolveDbName("Gram Panchayat", entityIds.gp, "gp_name");
            if (name) parts.push(`GP: ${name}`);
        }

        let levelNames = { "1": "Partner", "2": "State", "3": "District", "4": "Block", "5": "Supervisor", "6": "GP", "7": "Creche" };
        let currentLevelName = levelNames[selectedLevel] || "Timeline";
        parts.push(`${currentLevelName}: ${clickedLabel}`);
        
        return parts.join(" | ");
    }

    async function openDrillDownModal(label) {
      let hierarchyTitle = await getResolvedHierarchyTitle(label);
      let d = new frappe.ui.Dialog({
        title: `Month-wise Trend: ${hierarchyTitle}`,
        fields: [{ fieldtype: 'HTML', fieldname: 'chart_area' }],
        size: 'large'
      });
      d.show();
      d.fields_dict.chart_area.$wrapper.html(`
        <div id="drill-chart" style="height:350px; display:flex; align-items:center; justify-content:center;">
          <span style="color:#64748b;">Loading drill-down data...</span>
        </div>
      `);

      fetchChartData(chartEndpoint, { isDrilldown: true, drillGroup: label, baseParams: lastChartParams }).then(drillData => {
        setTimeout(() => {
          const container = d.fields_dict.chart_area.$wrapper.find('#drill-chart')[0];
          container.innerHTML = "";
          
          if (!drillData || !drillData.labels || drillData.labels.length === 0) {
            container.innerHTML = '<span style="color: #ef4444;">No data available.</span>';
            return;
          }

          let enableLabels = drillData.labels.length <= 100;

          let drillOptions = {
            series: drillData.datasets.map(ds => ({ name: ds.name, data: ds.values })),
            chart: { type: 'bar', height: 350, stacked: true, toolbar: { show: true } },
            colors: chartColors || ["#5979aa", "#10b981", "#f59e0b", "#ef4444"],
            xaxis: { categories: drillData.labels },
            plotOptions: { bar: { borderRadius: 2, columnWidth: '55%', dataLabels: { position: 'top' } } },
            grid: { padding: { top: 25 } },
            dataLabels: { enabled: enableLabels, offsetY: -20, style: { fontSize: '10px', colors: ['#334155'] } }
          };

          new ApexCharts(container, drillOptions).render();
        }, 300);
      });
    }

    function renderChart(rawData, type, colors) {
        chartHeader.textContent = chartIndicator;
        const chartContainer = document.getElementById('chart-container');
        if (!chartContainer) return;

        // Only plain (non-stacked) bar charts with a registered Child Details API get clickable value buttons.
        const usesBarValueButtons = type === "bar" && !!chartChildDetails;
        clearBarValueButtons();
        lastRenderedChartData = null;

        if (!rawData || (Array.isArray(rawData) && rawData.length === 0) ||
            (rawData.labels && rawData.labels.length === 0)) {
            if (currentChart) { currentChart.destroy(); currentChart = null; }
            chartContainer.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:380px;color:#94a3b8;font-size:14px;">No data available for the selected filters</div>';
            chartContainer.style.width = "100%";
            updateScrollHint();
            return;
        }

        let data = rawData;
        const levelVal = lastChartParams ? (lastChartParams.level || "") : "";
        const duration = lastChartParams ? (lastChartParams.duration || "") : "";

        if (!levelVal && duration && (type === "line" || type === "bar" || type === "stacked_bar")) {
            const numMonthsMap = { "3_months": 3, "6_months": 6, "9_months": 9, "12_months": 12 };
            const numMonths = numMonthsMap[duration] || 0;
            if (numMonths > 0 && data.labels && data.labels.length > numMonths) {
                const startIdx = data.labels.length - numMonths;
                const sliceArr = arr => Array.isArray(arr) ? arr.slice(startIdx) : arr;
                const extra = data.extra
                    ? Object.fromEntries(Object.entries(data.extra).map(([k, v]) => [k, sliceArr(v)]))
                    : data.extra;
                data = {
                    ...data,
                    labels: data.labels.slice(startIdx),
                    datasets: data.datasets.map(ds => ({ ...ds, values: ds.values.slice(startIdx) })),
                    extra: extra,
                    child_counts: sliceArr(data.child_counts)
                };
            }
        }

        const numBars = (data.labels || []).length;
        const defaultColors = colors || ["#5979aa", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];
        
        const chartWidthStr = computeChartWidth(numBars, type);
        chartContainer.style.width = chartWidthStr;
        chartContainer.style.height = "380px";

        let columnWidth = numBars > 500 ? "85%" : numBars > 200 ? "80%" : numBars > 100 ? "75%" : numBars > 50 ? "70%" : "65%";
        let xAxisFontSize = numBars > 500 ? "8px" : numBars > 200 ? "9px" : numBars > 100 ? "10px" : numBars > 50 ? "11px" : "13px";

        const isLarge = numBars > 100;
        let options = {};

        try {
            const commonChartOptions = {
                background: 'transparent',
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                // Bars with click-to-detail buttons render at final position immediately
                // (no grow-in animation) so the button overlay - measured right after
                // render - never has to race an in-progress animation for its geometry.
                animations: { enabled: !isLarge && !usesBarValueButtons, easing: 'easeinout', speed: 400, animateGradually: { enabled: false }, dynamicAnimation: { enabled: false } },
                events: {}
            };

            if (type === "line") {
                const series = data.datasets.map((ds, i) => ({ name: ds.name || `Series ${i + 1}`, data: ds.values }));
                options = {
                    series: series,
                    chart: { ...commonChartOptions, type: 'line', height: 380, width: chartWidthStr, toolbar: { show: false }, zoom: { enabled: false } },
                    colors: defaultColors,
                    stroke: { curve: 'smooth', width: numBars > 200 ? 1 : 3, lineCap: 'round' },
                    markers: { size: numBars > 100 ? 0 : 5, strokeColors: '#fff', strokeWidth: 2, hover: { size: numBars > 100 ? 3 : 7 } },
                    grid: { show: true, borderColor: '#e2e8f0', strokeDashArray: 0, padding: { top: 10, right: 10, bottom: 0, left: 10 } },
                    xaxis: { categories: data.labels, labels: { style: { colors: '#64748b', fontSize: xAxisFontSize }, rotate: numBars > 20 ? -45 : 0, rotateAlways: numBars > 20, hideOverlappingLabels: true, maxHeight: 80 }, axisBorder: { show: true, color: '#e2e8f0' }, tooltip: { enabled: false }, tickAmount: numBars > 500 ? Math.min(numBars, 100) : undefined },
                    yaxis: { labels: { style: { colors: '#64748b', fontSize: '13px' }, formatter: (val) => val ? val.toLocaleString() : '0' } },
                    legend: { position: 'bottom', fontSize: '13px', itemMargin: { horizontal: 20, vertical: 8 } },
                    tooltip: { enabled: true, shared: true, intersect: false, y: { formatter: (val) => val ? val.toLocaleString() : '0' } },
                    dataLabels: { enabled: false }
                };
            } else if (type === "pie") {
                chartContainer.style.width = "100%";
                options = {
                    series: data.datasets[0]?.values || [],
                    chart: { ...commonChartOptions, type: 'pie', height: 380, width: '100%' },
                    labels: data.labels,
                    colors: defaultColors,
                    legend: { position: 'bottom', fontSize: '13px' },
                    dataLabels: { enabled: true, style: { fontSize: '13px' }, formatter: (val) => val.toFixed(1) + '%' }
                };
            } else if (type === "bar" || type === "stacked_bar") {
                const series = data.datasets.map((ds, i) => ({ name: ds.name || `Series ${i + 1}`, data: ds.values }));
                const isStacked = type === "stacked_bar";
                
                commonChartOptions.events.dataPointSelection = function(event, chartContext, config) {
                    if (!(lastChartParams && lastChartParams.level)) {
                        frappe.show_alert({ message: __("Select a Geography Level (e.g., State, District) to enable bar drill-downs."), indicator: "orange" });
                        return;
                    }
                    let clickedLabel = data.labels[config.dataPointIndex];
                    if (clickedLabel) {
                        openDrillDownModal(clickedLabel);
                    }
                };

                options = {
                    series: series,
                    chart: { ...commonChartOptions, type: 'bar', stacked: isStacked, height: 380, width: chartWidthStr, toolbar: { show: true } },
                    colors: defaultColors,
                    states: { hover: { filter: { type: 'darken', value: 0.8 } } },
                    plotOptions: { bar: { borderRadius: numBars > 100 || isStacked ? 0 : 3, columnWidth: columnWidth, dataLabels: { position: 'top' } } },
                    xaxis: { categories: data.labels, labels: { style: { fontSize: xAxisFontSize, colors: '#64748b' }, rotate: numBars > 10 ? -45 : 0, rotateAlways: numBars > 10, hideOverlappingLabels: true, maxHeight: 80, trim: numBars > 200 }, tooltip: { enabled: false } },
                    yaxis: { labels: { style: { fontSize: '13px' }, formatter: (val) => val ? val.toLocaleString() : '0' } },
                    legend: { position: 'bottom', fontSize: '13px' },
                    grid: { borderColor: '#e2e8f0', padding: { top: 25 } },
                    tooltip: { 
                        custom: function({series, seriesIndex, dataPointIndex, w}) {
                            const label = w.globals.labels[dataPointIndex];
                            let tooltipHtml = `<div class="apexcharts-tooltip-title" style="font-family: Helvetica, Arial, sans-serif; font-size: 13px; padding: 6px 10px; background: #f3f4f6; border-bottom: 1px solid #e5e7eb;">${label}</div>`;
                            
                            for(let i = 0; i < series.length; i++) {
                                const val = series[i][dataPointIndex];
                                const seriesName = w.globals.seriesNames[i];
                                const color = w.globals.colors[i];
                                tooltipHtml += `<div class="apexcharts-tooltip-series-group apexcharts-active" style="display: flex; padding: 4px 10px;">
                                    <span class="apexcharts-tooltip-marker" style="background-color: ${color}; width: 10px; height: 10px; border-radius: 50%; display: inline-block; margin-right: 8px; margin-top: 4px;"></span>
                                    <div class="apexcharts-tooltip-text" style="font-family: Helvetica, Arial, sans-serif; font-size: 13px;">
                                        <div class="apexcharts-tooltip-y-group"><span class="apexcharts-tooltip-text-y-label" style="color: #475569;">${seriesName}: </span><span class="apexcharts-tooltip-text-y-value" style="font-weight: 600;">${val ? val.toLocaleString() : '0'}</span></div>
                                    </div>
                                </div>`;
                            }
                            
                            if (data.extra && data.extra["Measurement Taken"]) {
                                const extraVal = data.extra["Measurement Taken"][dataPointIndex];
                                tooltipHtml += `<div class="apexcharts-tooltip-series-group apexcharts-active" style="display: flex; padding: 4px 10px; padding-top: 0; padding-bottom: 8px;">
                                    <span class="apexcharts-tooltip-marker" style="background-color: #64748b; width: 10px; height: 10px; border-radius: 50%; display: inline-block; margin-right: 8px; margin-top: 4px;"></span>
                                    <div class="apexcharts-tooltip-text" style="font-family: Helvetica, Arial, sans-serif; font-size: 13px;">
                                        <div class="apexcharts-tooltip-y-group"><span class="apexcharts-tooltip-text-y-label" style="color: #475569;">Measurement Taken: </span><span class="apexcharts-tooltip-text-y-value" style="font-weight: 600;">${extraVal ? extraVal.toLocaleString() : '0'}</span></div>
                                    </div>
                                </div>`;
                            }
                            return tooltipHtml;
                        }
                    },
                    dataLabels: { enabled: (!isLarge && !isStacked) && !usesBarValueButtons, offsetY: -20, style: { fontSize: numBars > 500 ? '7px' : numBars > 200 ? '8px' : numBars > 100 ? '9px' : numBars > 50 ? '10px' : '12px', colors: ['#334155'] }, formatter: function(val) {
                        if (!val && val !== 0) return '';
                        if (numBars > 100) {
                            if (Math.abs(val) >= 1000000) return (val / 1000000).toFixed(1) + 'M';
                            if (Math.abs(val) >= 1000) return (val / 1000).toFixed(1) + 'K';
                        }
                        return val.toLocaleString();
                    }, dropShadow: { enabled: false } }
                };
            }

            if (currentChart) { currentChart.destroy(); currentChart = null; }
            chartContainer.innerHTML = '';

            if (typeof ApexCharts === 'undefined') throw new Error('ApexCharts library not loaded');

            currentChart = new ApexCharts(chartContainer, options);
            if (usesBarValueButtons) lastRenderedChartData = data;
            currentChart.render().then(() => {
                setTimeout(updateScrollHint, 200);
                if (usesBarValueButtons) {
                    // Animations are disabled for these charts, so bars are already at
                    // their final position once rendered - just wait one frame for the
                    // browser to paint before measuring them.
                    requestAnimationFrame(() => requestAnimationFrame(() => renderBarValueButtons(data)));
                }
            });

        } catch (error) {
            console.error("Error rendering chart:", error);
            if (currentChart) { currentChart.destroy(); currentChart = null; }
            chartContainer.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:380px;color:#ef4444;font-size:14px;">Error rendering chart</div>';
        }
    }

    // ==============================================================================
    // BAR VALUE BUTTONS (clickable count above each bar -> Child Details modal)
    // ==============================================================================

    let barValueButtonsObserver = null;
    let barValueButtonsRenderPending = false;

    function clearBarValueButtons() {
        if (barValueButtonsObserver) {
            barValueButtonsObserver.disconnect();
            barValueButtonsObserver = null;
        }
        const overlay = document.getElementById('bar-value-overlay');
        if (overlay) overlay.remove();
    }

    function renderBarValueButtons(data) {
        clearBarValueButtons();
        const chartContainer = document.getElementById('chart-container');
        if (!chartContainer || !currentChart) return;

        const svg = chartContainer.querySelector('.apexcharts-svg');
        const barAreas = chartContainer.querySelectorAll('.apexcharts-bar-series .apexcharts-bar-area');
        if (!svg || !barAreas.length) {
            // Bars aren't in the DOM yet (e.g. ApexCharts is mid-redraw). Keep the
            // watcher armed so we retry as soon as the bars actually appear,
            // instead of giving up and leaving no way to recover automatically.
            watchBarValueButtons(data);
            return;
        }

        const overlay = document.createElement('div');
        overlay.id = 'bar-value-overlay';
        overlay.className = 'bar-value-overlay';
        chartContainer.style.position = chartContainer.style.position || 'relative';

        const containerRect = chartContainer.getBoundingClientRect();

        const values = (data.datasets && data.datasets[0] && data.datasets[0].values) || [];
        const labels = data.labels || [];
        // Percentage charts (e.g. Measurement %) also send the number of children the
        // popup will list for each bar, so the button can show that count too.
        const childCounts = Array.isArray(data.child_counts) ? data.child_counts : null;

        barAreas.forEach((barEl, idx) => {
            const val = values[idx];
            const label = labels[idx];
            if (val === undefined || val === null || val === "" || label === undefined) return;
            const expectedCount = childCounts ? Number(childCounts[idx] || 0) : (typeof val === "string" ? parseFloat(val) : val);
            // Skip empty/zero bars: nothing meaningful to show in a Child Details list.
            if (!expectedCount || expectedCount <= 0) return;

            const rect = barEl.getBoundingClientRect();
            const centerX = (rect.left - containerRect.left) + rect.width / 2;
            const topY = (rect.top - containerRect.top);

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'bar-value-btn';
            btn.style.left = centerX + 'px';
            btn.style.top = Math.max(topY - 4, 14) + 'px';
            const valText = typeof val === "string" ? val : val.toLocaleString();
            btn.textContent = childCounts ? `${valText} · ${expectedCount.toLocaleString()}` : valText;
            btn.title = `View child details for ${label}`;
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                openChildDetailsModal(label, expectedCount);
            });
            overlay.appendChild(btn);
        });

        chartContainer.appendChild(overlay);
        watchBarValueButtons(data);
    }

    // Self-healing overlay: ApexCharts can redraw/replace its SVG at times we
    // don't fully control (window resize, internal responsiveness, animations
    // triggered by layout shifts elsewhere on the page like a modal opening or
    // closing), which wipes our button overlay since it lives inside the same
    // container ApexCharts owns. Rather than guessing exactly when that
    // happens, watch the container and re-render the buttons any time its
    // contents change and our overlay is no longer present.
    function watchBarValueButtons(data) {
        const chartContainer = document.getElementById('chart-container');
        if (!chartContainer) return;

        if (barValueButtonsObserver) {
            barValueButtonsObserver.disconnect();
            barValueButtonsObserver = null;
        }
        if (!chartChildDetails || chartType !== "bar") return;

        barValueButtonsObserver = new MutationObserver(() => {
            if (barValueButtonsRenderPending) return;
            if (document.getElementById('bar-value-overlay')) return;
            if (!chartContainer.querySelector('.apexcharts-bar-series .apexcharts-bar-area')) return;

            barValueButtonsRenderPending = true;
            requestAnimationFrame(() => {
                barValueButtonsRenderPending = false;
                // Guard against firing after the user has switched to a different
                // indicator/tab in the meantime.
                if (chartChildDetails && chartType === "bar" && lastRenderedChartData === data) {
                    renderBarValueButtons(data);
                }
            });
        });
        barValueButtonsObserver.observe(chartContainer, { childList: true, subtree: false });
    }

    // ==============================================================================
    // CHILD DETAILS MODAL
    // ==============================================================================

    let childDetailsState = { start: 0, pageLength: 500, total: 0, label: null, value: null };

    function closeChildDetailsModal() {
        const modal = document.getElementById("childDetailsModal");
        if (modal) modal.style.display = "none";
        document.body.classList.remove("modal-open");
        // If closing the modal happened to wipe the button overlay (e.g. a layout
        // shift made ApexCharts redraw its SVG), the MutationObserver installed
        // by watchBarValueButtons() re-adds it automatically. This is just a
        // direct fallback in case the overlay is simply missing right now.
        if (lastRenderedChartData && !document.getElementById('bar-value-overlay')) {
            renderBarValueButtons(lastRenderedChartData);
        }
    }

    async function openChildDetailsModal(barLabel, barValue) {
        if (!chartChildDetails || !chartChildDetails.api) return;

        childDetailsState = {
            start: 0, pageLength: 500, total: 0, label: barLabel, value: barValue,
            // Frozen at click time: the API, indicator and filters of the chart that was clicked.
            api: chartChildDetails.api,
            indicatorKey: chartChildDetails.indicator_key || null,
            params: { ...(lastChartParams || buildFilterParams()) }
        };

        const modal = document.getElementById("childDetailsModal");
        const title = document.getElementById("childDetailsTitle");
        if (title) title.textContent = `${chartIndicator} — ${barLabel}`;

        // Wipe the previous bar's table and count before showing the modal, so the
        // old "Showing 1-500 of N" never appears while the new list is loading.
        const thead = document.getElementById("childDetailsTableHead");
        const tbody = document.getElementById("childDetailsTableBody");
        if (thead) thead.innerHTML = "";
        if (tbody) tbody.innerHTML = "";
        updateChildDetailsPager();

        if (modal) modal.style.display = "block";
        document.body.classList.add("modal-open");

        await loadChildDetailsPage();
    }

    // `knownTotal` (from the first page) lets the server skip re-counting on later pages.
    async function fetchChildDetailsData(start, length, knownTotal = null) {
        // The bar is either a level group (level set when the chart was loaded) or a
        // month of the trend; the server works out which from `level` + `bar_label`.
        let params = {
            ...childDetailsState.params,
            start: start, page_length: length,
            bar_label: childDetailsState.label
        };
        if (childDetailsState.indicatorKey) params.indicator_key = childDetailsState.indicatorKey;
        if (knownTotal !== null && knownTotal !== undefined) params.known_total = knownTotal;

        params = Object.fromEntries(Object.entries(params).filter(([_, v]) => v !== "" && v !== null && v !== undefined));
        const queryParams = new URLSearchParams(params).toString();
        const url = `${BASE_URL}/api/method/frappe.apf.page.mis_attendances_dash.child_details.${childDetailsState.api}?${queryParams}`;

        const response = await fetch(url, { credentials: "same-origin" });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const json = await response.json();
        return (json && json.message) ? json.message : (json && json.data ? json.data : null);
    }

    // Normal/Moderate/Severe badge colors, matching the malnutrition report's convention.
    const STATUS_BADGE_STYLES = {
        normal:   "background:#CCFFCC; color:#006600;",
        moderate: "background:#FFFFCC; color:#999900;",
        severe:   "background:#FFCCCC; color:#CC0000;",
    };
    const STATUS_BADGE_BASE = "display:inline-block; padding:2px 10px; border-radius:10px; font-weight:600; font-size:12px;";

    function renderStatusCell(value) {
        const key = String(value).trim().toLowerCase();
        const style = STATUS_BADGE_STYLES[key];
        if (!style) return frappe.utils.escape_html(String(value));
        return `<span style="${STATUS_BADGE_BASE} ${style}">${frappe.utils.escape_html(String(value))}</span>`;
    }

    function renderChildDetailsTable(result) {
        const thead = document.getElementById("childDetailsTableHead");
        const tbody = document.getElementById("childDetailsTableBody");
        const emptyEl = document.getElementById("childDetailsEmpty");
        const wrapper = document.getElementById("childDetailsTableWrapper");
        if (!thead || !tbody) return;

        const columns = (result && result.columns) || [];
        const rows = (result && result.rows) || [];

        thead.innerHTML = columns.length
            ? `<tr>${columns.map(c => `<th>${frappe.utils.escape_html(c.label || c.fieldname)}</th>`).join("")}</tr>`
            : "";

        const tableEl = wrapper ? wrapper.querySelector('table') : null;

        if (!rows.length) {
            tbody.innerHTML = "";
            if (emptyEl) emptyEl.style.display = "flex";
            if (tableEl) tableEl.style.display = "none";
            return;
        }

        if (emptyEl) emptyEl.style.display = "none";
        if (tableEl) tableEl.style.display = "table";

        tbody.innerHTML = rows.map(row => {
            return `<tr>${columns.map(c => {
                const v = row[c.fieldname];
                if (v === null || v === undefined || v === "") return `<td>-</td>`;
                if (c.type === "status") return `<td>${renderStatusCell(v)}</td>`;
                return `<td>${frappe.utils.escape_html(String(v))}</td>`;
            }).join("")}</tr>`;
        }).join("");
    }

    function updateChildDetailsPager() {
        const total = childDetailsState.total || 0;
        const start = childDetailsState.start || 0;
        const length = childDetailsState.pageLength || 100;
        const shownFrom = total === 0 ? 0 : start + 1;
        const shownTo = Math.min(start + length, total);
        const pageNum = Math.floor(start / length) + 1;
        const totalPages = Math.max(1, Math.ceil(total / length));

        const summary = document.getElementById("childDetailsSummary");
        const pageInfo = document.getElementById("childDetailsPageInfo");
        const prevBtn = document.getElementById("childDetailsPrevBtn");
        const nextBtn = document.getElementById("childDetailsNextBtn");

        if (summary) summary.textContent = `Showing ${shownFrom}-${shownTo} of ${total.toLocaleString()} records`;
        if (pageInfo) pageInfo.textContent = `Page ${pageNum} of ${totalPages}`;
        if (prevBtn) prevBtn.disabled = start <= 0;
        if (nextBtn) nextBtn.disabled = start + length >= total;
    }

    let childDetailsRequestToken = 0;

    async function loadChildDetailsPage() {
        const loader = document.getElementById("childDetailsLoader");
        const wrapper = document.getElementById("childDetailsTableWrapper");
        const prevBtn = document.getElementById("childDetailsPrevBtn");
        const nextBtn = document.getElementById("childDetailsNextBtn");
        if (loader) loader.style.display = "flex";
        if (wrapper) { const t = wrapper.querySelector('table'); if (t) t.style.display = "none"; }
        const emptyEl = document.getElementById("childDetailsEmpty");
        if (emptyEl) emptyEl.style.display = "none";
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;

        const myToken = ++childDetailsRequestToken;
        const isFirstPage = !childDetailsState.lastResult;

        try {
            const result = await fetchChildDetailsData(
                childDetailsState.start, childDetailsState.pageLength,
                isFirstPage ? null : childDetailsState.total
            );
            if (myToken !== childDetailsRequestToken) return; // a newer page request superseded this one
            childDetailsState.total = (result && result.total) || 0;
            childDetailsState.lastResult = result;
            renderChildDetailsTable(result);
            updateChildDetailsPager();

            // The bar and this list run the same query; they can only differ when
            // records were added/changed after the chart was loaded (the chart is
            // served from a short-lived cache). Re-sync the chart in that case.
            const expected = Number(childDetailsState.value);
            if (isFirstPage && Number.isFinite(expected) && expected !== childDetailsState.total) {
                frappe.show_alert({ message: __("Data changed since the chart was loaded. Refreshing the chart with the latest numbers."), indicator: "blue" });
                refreshChartData({ force: true, useLastParams: true });
            }
        } catch (error) {
            if (myToken !== childDetailsRequestToken) return;
            console.error("Error loading child details:", error);
            const tbody = document.getElementById("childDetailsTableBody");
            if (tbody) tbody.innerHTML = "";
            const summary = document.getElementById("childDetailsSummary");
            if (summary) summary.textContent = "Error loading records";
        } finally {
            if (myToken === childDetailsRequestToken) {
                if (loader) loader.style.display = "none";
                updateChildDetailsPager();
            }
        }
    }

    document.addEventListener("click", function(e) {
        if (e.target.closest && e.target.closest(".child-details-close-btn")) {
            closeChildDetailsModal();
        }
    });

    window.addEventListener("click", function(event) {
        if (event.target === document.getElementById("childDetailsModal")) {
            closeChildDetailsModal();
        }
    });

    const childDetailsPrevBtn = document.getElementById("childDetailsPrevBtn");
    if (childDetailsPrevBtn) {
        childDetailsPrevBtn.addEventListener("click", () => {
            if (childDetailsState.start <= 0) return;
            childDetailsState.start = Math.max(0, childDetailsState.start - childDetailsState.pageLength);
            loadChildDetailsPage();
        });
    }

    const childDetailsNextBtn = document.getElementById("childDetailsNextBtn");
    if (childDetailsNextBtn) {
        childDetailsNextBtn.addEventListener("click", () => {
            if (childDetailsState.start + childDetailsState.pageLength >= childDetailsState.total) return;
            childDetailsState.start += childDetailsState.pageLength;
            loadChildDetailsPage();
        });
    }

    const downloadChildDetailsXlsxBtn = document.getElementById("downloadChildDetailsXlsxBtn");
    if (downloadChildDetailsXlsxBtn) {
        downloadChildDetailsXlsxBtn.addEventListener("click", async function(e) {
            e.preventDefault();
            const btn = this;
            const originalText = btn.textContent;
            btn.disabled = true;
            btn.style.opacity = 0.6;
            btn.style.cursor = "not-allowed";

            try {
                if (typeof XLSX === "undefined") throw new Error("XLSX library not loaded");

                // The server caps every request at MAX_PAGE_LENGTH (2000) rows. To export
                // the FULL list, page through every batch and accumulate the rows before
                // writing the workbook. The total from the first batch is sent back on
                // later batches so the server doesn't recount; a hard iteration ceiling
                // guards against a runaway loop.
                const FETCH_PAGE_SIZE = 2000;
                const MAX_PAGES = 100; // up to 200,000 rows
                let columns = [];
                let allRows = [];
                let pageStart = 0;
                let total = Infinity;
                let pageCount = 0;

                while (pageStart < total && pageCount < MAX_PAGES) {
                    btn.textContent = total === Infinity
                        ? "Downloading..."
                        : `Downloading... (${Math.min(pageStart, total)}/${total})`;

                    const page = await fetchChildDetailsData(pageStart, FETCH_PAGE_SIZE, total === Infinity ? null : total);
                    if (!page) break;

                    if (!columns.length) columns = page.columns || [];
                    const rows = page.rows || [];
                    allRows = allRows.concat(rows);
                    total = typeof page.total === "number" ? page.total : allRows.length;

                    if (!rows.length) break; // no more data, regardless of what `total` says
                    pageStart += FETCH_PAGE_SIZE;
                    pageCount++;
                }

                const exportRows = allRows.map(row => {
                    const obj = {};
                    columns.forEach(c => { obj[c.label || c.fieldname] = row[c.fieldname]; });
                    return obj;
                });
                if (exportRows.length > 0) {
                    const worksheet = XLSX.utils.json_to_sheet(exportRows);
                    const workbook = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(workbook, worksheet, "Child Details");
                    XLSX.writeFile(workbook, "child_details.xlsx");
                } else {
                    if (frappe && frappe.show_alert) frappe.show_alert({ message: __("No records to export."), indicator: "orange" });
                }
            } catch (err) {
                console.error("Error generating Child Details XLSX", err);
                if (frappe && frappe.msgprint) frappe.msgprint("Error generating XLSX.");
            } finally {
                btn.textContent = originalText;
                btn.disabled = false;
                btn.style.opacity = 1;
                btn.style.cursor = "pointer";
            }
        });
    }

    // force: bypass the server-side cache. useLastParams: reload the displayed chart
    // with the filters it was loaded with (not the possibly-edited filter fields).
    async function refreshChartData({ force = false, useLastParams = false } = {}) {
        // A newer request (indicator/tab switch, Search, Refresh) supersedes any
        // in-flight one instead of being ignored until the slow one finishes.
        if (chartAbortController) chartAbortController.abort();
        const controller = new AbortController();
        chartAbortController = controller;
        const mySeq = ++chartRequestSeq;
        const params = (useLastParams && lastChartParams) ? { ...lastChartParams } : buildFilterParams();

        spinnerContainer.style.display = "flex";
        if (chartScrollOuter) chartScrollOuter.scrollLeft = 0;
        scrollHint.classList.remove("visible");

        try {
            const data = await fetchChartData(chartEndpoint, { baseParams: params, force, signal: controller.signal });
            if (mySeq !== chartRequestSeq) return;
            lastChartParams = params;
            fullChartData = data;
            const currentSearch = chartSearchInput.value.trim();
            if (currentSearch) {
              applySearch(currentSearch);
            } else {
              renderChart(data, chartType, chartColors);
            }
        } catch (error) {
            if ((error && error.name === "AbortError") || mySeq !== chartRequestSeq) return;
            console.error("Error refreshing chart:", error);
            const chartContainer = document.getElementById('chart-container');
            if (chartContainer) chartContainer.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:380px;color:#ef4444;font-size:14px;">Error loading chart data</div>';
        } finally {
            if (mySeq === chartRequestSeq) {
                spinnerContainer.style.display = "none";
                chartAbortController = null;
            }
        }
    }
    
    // ==============================================================================
    // CARD LOGIC FEATURE
    // ==============================================================================

    const logicDataBySection = {
      "Demography": [
        { title: "Age-wise Distribution of Enrolled Children", logic: "Distribution of all enrolled children by current age bracket (0-6, 7-12, 13-18, 19-24, 25-30, 31-36, Above 36 months), based on child_dob compared to today's date." },
        { title: "Gender-wise Distribution of Enrolled Children", logic: "Count of all enrolled children grouped by gender (Male, Female, Other, Unknown)." },
        { title: "Children enrolled at age in months", logic: "Number of currently active (not exited) enrolled children grouped by their age at enrollment: 6-9, 9-12, 12-24, and 24-36 months." },
        { title: "Specially abled children", logic: "Compares total currently active enrolled children against the subset flagged as specially abled (child_specially_abled = 1)." },
        { title: "Education level of mother", logic: "Distribution of enrolled children by their mother's/caregiver's education level (Not Literate, Class 5, Class 8, Class 10, Intermediate, Diploma, Graduate, PG and above, Not Available)." },
        { title: "Registered households", logic: "Count of households registered (created) within the selected month/period, optionally grouped by geography level or shown as a month-wise trend." },
        { title: "Households religion wise", logic: "Count of households grouped by religion (Hindu, Muslim, Christian, Buddhism, Sikhism, Jainism, Any Other, Not Available)." },
        { title: "Households caste wise", logic: "Count of households grouped by social category (General, OBC, SC, ST, Other, Not Available)." },
        { title: "Households occupation wise", logic: "Count of households grouped by the family's primary occupation." },
        { title: "Households migrating", logic: "Count of households with a migrant worker, split by whether migrants were away for 6+ months or less than 6 months in the last year." },
      ],
      "Creche Profile": [
        { title: "Creche Status", logic: "Count of creches grouped by operational status: Planned, Plan Dropped, Active/Operational, or Closed." },
        { title: "Creche Inauguration Trend (Month Wise)", logic: "Number of creches inaugurated (opened) per month over the selected duration window." },
        { title: "Type of Creche House", logic: "Count of creches grouped by the type of premises used: Rented House, Community Hall, Old School Building, Any Other." },
        { title: "Type of Building", logic: "Count of creches grouped by building construction type: Kaccha or Pakka." },
        { title: "Hard To Reach", logic: "Count of creches split by whether they are located in a hard-to-reach area (Yes/No)." },
        { title: "Roof Type", logic: "Count of creches grouped by roof material: Asbestos, Tin, Cemented, or Khapra (Tile)." },
        { title: "Source of Power Supply", logic: "Count of creches grouped by power source: Electricity, Electricity + Inverter, or Solar." },
        { title: "Equipped with Lightning Arrestor", logic: "Count of creches split by whether they are equipped with a lightning arrestor (Yes/No)." },
        { title: "Age-wise Creche Distribution", logic: "Count of creches grouped by how long ago they were opened, relative to today: Below 6 Months, 6-12, 12-18, 18-24, Above 24 Months." },
        { title: "Independent Kitchen Room", logic: "Count of creches split by whether they have an independent kitchen room (Yes/No)." },
        { title: "Equipped with Operational Toilet", logic: "Count of creches split by whether they have an equipped, operational toilet (Yes/No)." },
      ],
      "Attendance": [
        { title: "Avg. Daily Attendance", logic: "Average number of children present per day, calculated as total attendance marks recorded divided by the number of distinct attendance days, for days the creche was open (not closed)." },
        { title: "Attendance (%)", logic: "Attendance percentage = (sum of attendance marks / count of attendance records) x 100, rounded to 2 decimals, for days the creche was open." },
        { title: "No of Children with (100% Attendance)", logic: "Count of distinct children whose days_attended equals their eligible_days within the selected period (i.e. attended every eligible day)." },
        { title: "No of Children with (0% Attendance)", logic: "Count of distinct children whose days_attended is 0 across their eligible days within the selected period." },
        { title: "No of Regular Children (Attendance ≥ 70%)", logic: "Count of distinct children whose (days_attended / eligible_days) x 100 is 70% or more." },
        { title: "No of Irregular Children (Attendance ≤ 50%)", logic: "Count of distinct children whose (days_attended / eligible_days) x 100 is 50% or less." },
        { title: "Avg. Attendance of SAM Children", logic: "Percentage of attendance marks recorded as present, out of total measured Anthropometric records, restricted to children flagged Severe on weight-for-height (SAM)." },
        { title: "Avg. Attendance of SUW Children", logic: "Percentage of attendance marks recorded as present, out of total measured Anthropometric records, restricted to children flagged Severe on weight-for-age (SUW)." },
      ],
      "Enrollment": [
        { title: "Elligible vs Enrolled (Unique Value)", logic: "Compares children eligible for enrollment (age 6-36 months, no exit/child status) against those currently enrolled (enrolled on or before period end, not yet exited)." },
        { title: "Total Exited", logic: "Count of all children whose date_of_exit falls within the selected period, across all exit reasons." },
        { title: "Exit (Graduated)", logic: "Count of children who exited within the selected period with reason_for_exit = Graduated." },
        { title: "Exit (Migrated)", logic: "Count of children who exited within the selected period with reason_for_exit = Migrated." },
        { title: "Exit (Not Willing to Stay)", logic: "Count of children who exited within the selected period with reason_for_exit = Not Willing to Stay." },
        { title: "Exit (Death)", logic: "Count of children who exited within the selected period with reason_for_exit = Death." },
        { title: "Exit (Other)", logic: "Count of children who exited within the selected period with reason_for_exit = Other." },
        { title: "Total Not Enrolled", logic: "Sum of Not Enrolled (Migrated) + Not Enrolled (Death) + Not Enrolled (Outside Catchment Area) + To Be Enrolled, for eligible children aged 6-36 months." },
        { title: "Not Enrolled (Migrated)", logic: "Count of eligible children (6-36 months) with household child_status = Migrated who were never enrolled." },
        { title: "Not Enrolled (Death)", logic: "Count of eligible children (6-36 months) with household child_status = Death who were never enrolled." },
        { title: "Not Enrolled (Outside Catchment Area)", logic: "Count of eligible children (6-36 months) with household child_status = Outside Catchment Area who were never enrolled." },
        { title: "To be Enrolled", logic: "Count of eligible children (6-36 months) with no child status and no enrollment record yet — i.e. pending enrollment." },
        { title: "New Enrolment", logic: "Count of children whose date_of_enrollment falls within the selected period." },
      ],
      "Malnutrition": [
        { title: "Measurment (%)", logic: "Percentage of currently enrolled children who had a growth measurement (height/weight) recorded within the selected period, out of all currently enrolled children." },
        { title: "Enrolled vs Measured", logic: "Compares the count of currently enrolled children against the count of those with a measurement recorded within the selected period." },
        { title: "WFA (Normal)", logic: "Count of measured children classified Normal on the Weight-for-Age indicator for the selected period." },
        { title: "WFA (Modrate )", logic: "Count of measured children classified Moderate on the Weight-for-Age indicator for the selected period." },
        { title: "WFA (Severe )", logic: "Count of measured children classified Severe on the Weight-for-Age indicator for the selected period." },
        { title: "WFH (Normal)", logic: "Count of measured children classified Normal on the Weight-for-Height indicator for the selected period." },
        { title: "WFH (Modrate )", logic: "Count of measured children classified Moderate on the Weight-for-Height indicator for the selected period." },
        { title: "WFH (Severe )", logic: "Count of measured children classified Severe on the Weight-for-Height indicator for the selected period." },
        { title: "HFA (Normal)", logic: "Count of measured children classified Normal on the Height-for-Age indicator for the selected period." },
        { title: "HFA (Modrate )", logic: "Count of measured children classified Moderate on the Height-for-Age indicator for the selected period." },
        { title: "HFA (Severe )", logic: "Count of measured children classified Severe on the Height-for-Age indicator for the selected period." },
        { title: "Weight for Age (ALL)", logic: "Stacked breakdown of measured children into Normal / Moderate / Severe on the Weight-for-Age indicator for the selected period." },
        { title: "Weight for Height (ALL)", logic: "Stacked breakdown of measured children into Normal / Moderate / Severe on the Weight-for-Height indicator for the selected period." },
        { title: "Height for Age (ALL)", logic: "Stacked breakdown of measured children into Normal / Moderate / Severe on the Height-for-Age indicator for the selected period." },
        { title: "GF1", logic: "Growth Faltering 1: number of children whose weight-for-age Z-score has declined (any decrease) compared to the previous month (or 2 months ago if previous data is missing)." },
        { title: "GF1+", logic: "Growth Faltering 1+: number of children whose weight-for-age Z-score has declined by at least 0.5 compared to the previous month (or 2 months ago if previous data is missing)." },
        { title: "GF2", logic: "Growth Faltering 2: number of children whose weight-for-age Z-score has declined by at least 0.5 compared to 2 months ago (or 3 months ago if 2-month data is missing)." },
        { title: "Zig Zag", logic: "Number of children whose weight-for-age Z-score has dropped by at least 0.5 from the maximum Z-score of the past 4 months, while also showing a fluctuating (zig-zag) pattern — at least one increase and one decrease across consecutive months over the last 5 months." },
        { title: "SNC", logic: "Special Nutrition Care: children flagged with any growth faltering (GF1/GF2/Zig-Zag pattern) or currently classified Severe on weight-for-age or weight-for-height." },
      ],
      "Cohort": [
        { title: "Moderate to Normal", logic: "Count of children whose classification on the selected indicator moved from Moderate (first measurement) to Normal (latest measurement) within the selected period." },
        { title: "Severe to Moderate", logic: "Count of children whose classification on the selected indicator moved from Severe (first measurement) to Moderate (latest measurement) within the selected period." },
        { title: "Severe to Normal", logic: "Count of children whose classification on the selected indicator moved from Severe (first measurement) to Normal (latest measurement) within the selected period." },
        { title: "Total Recovery", logic: "Sum of Moderate→Normal, Severe→Moderate, and Severe→Normal transitions — children whose nutritional status improved within the selected period." },
        { title: "Normal to Moderate", logic: "Count of children whose classification on the selected indicator moved from Normal (first measurement) to Moderate (latest measurement) within the selected period." },
        { title: "Normal to Severe", logic: "Count of children whose classification on the selected indicator moved from Normal (first measurement) to Severe (latest measurement) within the selected period." },
        { title: "Moderate to Severe", logic: "Count of children whose classification on the selected indicator moved from Moderate (first measurement) to Severe (latest measurement) within the selected period." },
        { title: "Total Deterioration", logic: "Sum of Normal→Moderate, Normal→Severe, and Moderate→Severe transitions — children whose nutritional status worsened within the selected period." },
        { title: "Normal to Normal", logic: "Count of children classified Normal at both their first and latest measurement within the selected period (no change, stayed Normal)." },
        { title: "Moderate to Moderate", logic: "Count of children classified Moderate at both their first and latest measurement within the selected period (no change, stayed Moderate)." },
        { title: "Severe to Severe", logic: "Count of children classified Severe at both their first and latest measurement within the selected period (no change, stayed Severe)." },
        { title: "No Change", logic: "Sum of Normal→Normal, Moderate→Moderate, and Severe→Severe — children whose nutritional classification stayed the same within the selected period." },
      ],
    };

    function populateLogicTable() {
      const tbody = document.getElementById("logicTableBody");
      if (!tbody) return;
      let rowsHtml = "";
      Object.keys(logicDataBySection).forEach((section) => {
        rowsHtml += `
          <tr>
            <td colspan="2" style="padding: 10px 12px; background-color: #eef2f7; color: #5979aa; font-weight: 700; font-size: 14px; border: 1px solid #ddd;">${section}</td>
          </tr>
        `;
        logicDataBySection[section].forEach((row, index) => {
          const bgClass = index % 2 === 0 ? "background-color: #f9f9f9;" : "background-color: #ffffff;";
          rowsHtml += `
            <tr style="${bgClass}">
              <td style="padding: 10px 12px; border: 1px solid #ddd; font-weight: 600; color: #333; white-space: normal;">${row.title}</td>
              <td style="padding: 10px 12px; border: 1px solid #ddd; color: #555; white-space: normal; line-height: 1.5;">${row.logic}</td>
            </tr>
          `;
        });
      });
      tbody.innerHTML = rowsHtml;
    }

    function openLogicModal() {
      populateLogicTable();
      const modal = document.getElementById("logicModal");
      if (modal) modal.style.display = "block";
      document.body.classList.add("modal-open");
    }

    function closeLogicModal() {
      const modal = document.getElementById("logicModal");
      if (modal) modal.style.display = "none";
      document.body.classList.remove("modal-open");
    }

    document.addEventListener("click", function(e) {
      if (e.target.closest && e.target.closest(".logic-close-btn")) {
        closeLogicModal();
      }
    });

    window.addEventListener("click", function(event) {
      if (event.target === document.getElementById("logicModal")) {
        closeLogicModal();
      }
    });

    function flattenLogicRows() {
      const rows = [];
      Object.keys(logicDataBySection).forEach((section) => {
        logicDataBySection[section].forEach((row) => {
          rows.push({ "Section": section, "Card Title": row.title, "Logic": row.logic });
        });
      });
      return rows;
    }

    const downloadLogicXlsxBtn = document.getElementById("downloadLogicXlsxBtn");
    if (downloadLogicXlsxBtn) {
      downloadLogicXlsxBtn.addEventListener("click", function(e) {
        e.preventDefault();
        const btn = this;
        const originalText = btn.textContent;
        btn.textContent = "Downloading...";
        btn.disabled = true;
        btn.style.opacity = 0.6;
        btn.style.cursor = "not-allowed";

        setTimeout(() => {
          try {
            const rows = flattenLogicRows();
            if (rows.length > 0 && typeof XLSX !== "undefined") {
              const worksheet = XLSX.utils.json_to_sheet(rows);
              const workbook = XLSX.utils.book_new();
              XLSX.utils.book_append_sheet(workbook, worksheet, "Card Logic");
              XLSX.writeFile(workbook, "card_logic.xlsx");
            }
          } catch (err) {
            console.error("Error generating Logic XLSX", err);
            if (frappe && frappe.msgprint) frappe.msgprint("Error generating XLSX.");
          } finally {
            btn.textContent = originalText;
            btn.disabled = false;
            btn.style.opacity = 1;
            btn.style.cursor = "pointer";
          }
        }, 100);
      });
    }

    const downloadLogicPngBtn = document.getElementById("downloadLogicPngBtn");
    if (downloadLogicPngBtn) {
      downloadLogicPngBtn.addEventListener("click", function(e) {
        e.preventDefault();
        const btn = this;
        const originalText = btn.textContent;
        btn.textContent = "Downloading...";
        btn.disabled = true;
        btn.style.opacity = 0.6;
        btn.style.cursor = "not-allowed";

        setTimeout(() => {
          const targetElement = document.getElementById("logicModalContent");
          const wrapper = document.getElementById("logicTableWrapper");
          if (targetElement && wrapper && typeof html2canvas !== "undefined") {
            const wrapperOrigMaxHeight = wrapper.style.maxHeight;
            const wrapperOrigOverflowY = wrapper.style.overflowY;
            const modalOrigMaxHeight = targetElement.style.maxHeight;
            const modalOrigOverflow = targetElement.style.overflow;

            wrapper.style.maxHeight = "none";
            wrapper.style.overflowY = "visible";
            targetElement.style.maxHeight = "none";
            targetElement.style.overflow = "visible";

            const restore = () => {
              wrapper.style.maxHeight = wrapperOrigMaxHeight;
              wrapper.style.overflowY = wrapperOrigOverflowY;
              targetElement.style.maxHeight = modalOrigMaxHeight;
              targetElement.style.overflow = modalOrigOverflow;
              btn.textContent = originalText;
              btn.disabled = false;
              btn.style.opacity = 1;
              btn.style.cursor = "pointer";
            };

            html2canvas(targetElement, {
              scale: 2,
              windowHeight: targetElement.scrollHeight,
              scrollY: -window.scrollY
            }).then(canvas => {
              canvas.toBlob(function(blob) {
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = url;
                link.download = "card_logic.png";
                link.click();
                URL.revokeObjectURL(url);
                restore();
              }, "image/png");
            }).catch(err => {
              console.error("Error generating Logic PNG", err);
              if (frappe && frappe.msgprint) frappe.msgprint("Error generating PNG.");
              restore();
            });
          } else {
            btn.textContent = originalText;
            btn.disabled = false;
            btn.style.opacity = 1;
            btn.style.cursor = "pointer";
          }
        }, 100);
      });
    }

    const downloadLogicPdfBtn = document.getElementById("downloadLogicPdfBtn");
    if (downloadLogicPdfBtn) {
      downloadLogicPdfBtn.addEventListener("click", function(e) {
        e.preventDefault();
        const btn = this;
        const originalText = btn.textContent;
        btn.textContent = "Downloading...";
        btn.disabled = true;
        btn.style.opacity = 0.6;
        btn.style.cursor = "not-allowed";

        setTimeout(() => {
          const targetElement = document.getElementById("logicModalContent");
          const wrapper = document.getElementById("logicTableWrapper");
          if (targetElement && wrapper && typeof html2canvas !== "undefined") {
            const wrapperOrigMaxHeight = wrapper.style.maxHeight;
            const wrapperOrigOverflowY = wrapper.style.overflowY;
            const modalOrigMaxHeight = targetElement.style.maxHeight;
            const modalOrigOverflow = targetElement.style.overflow;

            wrapper.style.maxHeight = "none";
            wrapper.style.overflowY = "visible";
            targetElement.style.maxHeight = "none";
            targetElement.style.overflow = "visible";

            const restore = () => {
              wrapper.style.maxHeight = wrapperOrigMaxHeight;
              wrapper.style.overflowY = wrapperOrigOverflowY;
              targetElement.style.maxHeight = modalOrigMaxHeight;
              targetElement.style.overflow = modalOrigOverflow;
              btn.textContent = originalText;
              btn.disabled = false;
              btn.style.opacity = 1;
              btn.style.cursor = "pointer";
            };

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
                const ctx = sliceCanvas.getContext("2d");
                ctx.drawImage(canvas, 0, srcY, imgWidth, srcH, 0, 0, imgWidth, srcH);

                if (yOffset > 0) doc.addPage();
                doc.addImage(sliceCanvas.toDataURL("image/png"), "PNG", 0, 0, scaledW, sliceH);

                yOffset += sliceH;
                remaining -= sliceH;
              }

              doc.save("card_logic.pdf");
              restore();
            }).catch(err => {
              console.error("Error generating Logic PDF", err);
              if (frappe && frappe.msgprint) frappe.msgprint("Error generating PDF.");
              restore();
            });
          } else {
            btn.textContent = originalText;
            btn.disabled = false;
            btn.style.opacity = 1;
            btn.style.cursor = "pointer";
          }
        }, 100);
      });
    }

    if (refreshChartBtn) {
      refreshChartBtn.addEventListener('click', function() {
        this.style.transform = 'rotate(180deg)';
        setTimeout(() => { this.style.transform = 'rotate(0deg)'; }, 300);
        // Explicit refresh skips the server cache and recomputes from live data.
        refreshChartData({ force: true });
      });
    }

    const indicatorSelect = document.getElementById("indicatorSelect");
    if (indicatorSelect) {
      indicatorSelect.addEventListener('change', function() {
        refreshChartData();
        updateFilterDesc();
      });
    }

    window.addEventListener('resize', () => {
      setTimeout(updateScrollHint, 300);
      // The MutationObserver installed by watchBarValueButtons() catches
      // ApexCharts' own resize-triggered redraw and re-adds the buttons once
      // it settles; nothing else to do here.
    });
    
    setTimeout(() => {
      refreshChartData();
      updateFilterDesc();
    }, 300);
  }
};