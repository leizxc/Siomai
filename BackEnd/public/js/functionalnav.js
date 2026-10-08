let currentLoadToken = 0;
let isNavigating = false;
let currentCleanup = null;
let attendanceStylesheet = null;

// Materialize keeps modal instances and their overlays outside of application
function disposeSectionModals(root) {
  if (typeof M === "undefined" || !root) return;

  root.querySelectorAll(".modal").forEach((modal) => {
    const instance = M.Modal.getInstance(modal);
    if (!instance) return;

    // close() updates Materialize's internal open-modal counter before
    if (instance.isOpen) instance.close();
    instance.destroy();
  });

  // A previous interrupted navigation may already have detached a modal but
  // left an overlay in this section. Remove only overlays owned by #content.
  root.querySelectorAll(".modal-overlay").forEach((overlay) => overlay.remove());

  if (!document.querySelector(".modal.open")) {
    document.body.style.overflow = "";
    if (M.Modal && typeof M.Modal._modalsOpen === "number") {
      M.Modal._modalsOpen = 0;
    }
  }
}

function applyTableDataLabels(root = document) {
  root.querySelectorAll("table").forEach((table) => {
    const headers = Array.from(table.querySelectorAll("thead th")).map((th) =>
      th.textContent.trim(),
    );

    if (!headers.length) return;

    table.classList.add("data-table");
    table.querySelectorAll("tbody tr").forEach((row) => {
      Array.from(row.cells).forEach((cell, index) => {
        if (cell.colSpan > 1 || cell.dataset.label) return;
        cell.dataset.label = headers[index] || "";
      });
    });
  });
}

const contentArea = document.getElementById("content");
if (contentArea) {
  applyTableDataLabels(contentArea);
  new MutationObserver(() => applyTableDataLabels(contentArea)).observe(contentArea, {
    childList: true,
    subtree: true,
  });
}

function loadSection(page) {
  isNavigating = true;

  const isOwnerPage = window.location.pathname.startsWith("/owner/");
  const sidebar = document.querySelector(".sidebar");
  if (sidebar) sidebar.scrollTop = 0;
  document.body.classList.toggle("manager-attendance-view", !isOwnerPage && page === "attendance.html");
  const ownerFeaturePages = new Set([
    "owner-sales",
    "owner-capital",
    "owner-orders",
    "owner-employee-stock",
    "owner-inventory",
    "owner-performance",
    "owner-attendance",
    "owner-manager-attendance",
    "owner-managers",
  ]);
  const sectionUrl = isOwnerPage
    ? page === "owner-capital"
      ? "/admin/expenses.html"
      : page === "owner-sales"
      ? "/admin/sales.html"
      : page === "owner-orders"
      ? "/admin/sales.html"
      : ownerFeaturePages.has(page)
      ? "/owner/ownerfeature.html"
      : `/owner/${page}`
    : page;

  // Every section gets a synchronous chance to invalidate in-flight work
  // before its root is replaced. Shell-owned listeners must not subscribe to
  // this event; they live for the authenticated session instead.
  window.dispatchEvent(
    new CustomEvent(isOwnerPage ? "owner:before-section-change" : "manager:before-section-change", {
      detail: { page },
    }),
  );

  // Stop the previous page's listeners before loading the new one
  if (currentCleanup) {
    currentCleanup();
    currentCleanup = null;
  }
  attendanceStylesheet?.remove();
  attendanceStylesheet = null;
  if (isOwnerPage) window.ownerDashboardCleanup?.();
  else window.managerDashboardCleanup?.();

  const myToken = ++currentLoadToken;

  fetch(sectionUrl)
    .then((response) => response.text())
    .then(async (data) => {
      if (myToken !== currentLoadToken) return;

      const main = document.getElementById("content");
      disposeSectionModals(main);
      main.classList.toggle("owner-capital-content", isOwnerPage && page === "owner-capital");
      main.classList.toggle("owner-sales-content", isOwnerPage && page === "owner-sales");
      main.classList.toggle("owner-order-status-content", isOwnerPage && page === "owner-orders");
      main.innerHTML = data;
      applyTableDataLabels(main);

      const title = document.getElementById("mobile-title");

      const pageTitles = {
        "dashboard.html": "Dashboard",
        "inventory.html": "Inventory Management",
        "product.html": "Products Assign Management",
        "productMenu.html": "Product menu Management",
        "expenses.html": "Capital Management",
        "EmployeeManagement.html": "Employees Management",
        "EmployeeMonitoring.html": "Employee Monitoring",
        "attendance.html": "My Attendance",
        "IncomeCart.html": "Income Per Cart",
        "sales.html": "Sales Orders",
        "payroll.html": "Employee Payroll",
        "owner-sales": "Real Time Sales",
        "owner-capital": "Capital Status Record",
        "owner-orders": "Order Product Status",
        "owner-employee-stock": "Stock by Employee",
        "owner-inventory": "Real Time Inventory",
        "owner-performance": "Employee Performance",
        "owner-attendance": "Employee Attendance",
        "owner-manager-attendance": "Manager Attendance",
        "owner-managers": "Manager Management",
      };

      if (title) title.textContent = pageTitles[page] || "Administrator";

      if (isOwnerPage && ownerFeaturePages.has(page) && page !== "owner-capital" && page !== "owner-sales" && page !== "owner-orders") {
        try {
          const ownerModule = await import("/js/ownerFeatures.js");
          if (myToken !== currentLoadToken) return;
          ownerModule.initOwnerFeature(page);
          currentCleanup = ownerModule.cleanupOwnerFeature;
        } catch (err) {
          console.error("Owner feature init error:", err);
        }
        return;
      }

      M.FormSelect.init(document.querySelectorAll("select"));
      M.Modal.init(document.querySelectorAll(".modal"));

      switch (page) {
        case "inventory.html":
          try {
            const addbtnModule = await import("/js/inventoryADDbtn.js?v=20261003b");
            if (myToken !== currentLoadToken) return;
            addbtnModule.initInventoryModal?.();

            const inventoryModule = await import("/js/adminBE.js?v=20261003b");
            if (myToken !== currentLoadToken) return;
            await inventoryModule.initInventoryPage?.();
            if (myToken !== currentLoadToken) {
              inventoryModule.stopInventoryPage?.();
              return;
            }

            currentCleanup = () => {
              inventoryModule.stopInventoryPage?.();
              addbtnModule.stopInventoryModal?.();
            };
          } catch (err) {
            console.error("Inventory Init Error:", err);
          }
          break;

        case "product.html":
          try {
            const addproducts = await import("/js/addproductbtn.js");
            if (myToken !== currentLoadToken) return;
            addproducts.initProductModal?.();

            const productModule = await import("/js/adminaddproduct.js?v=20261008a");
            if (myToken !== currentLoadToken) return;
            await productModule.initProductPage?.();
            if (myToken !== currentLoadToken) {
              productModule.cleanupProductPage?.();
              return;
            }
            if (myToken !== currentLoadToken) return;
            productModule.loadProducts?.();

            currentCleanup = () => {
              productModule.cleanupProductPage?.();
              addproducts.stopProductModal?.();
            };
          } catch (err) {
            console.error("Product Init Error:", err);
          }
          break;

        case "productMenu.html":
          try {
            const photoModule = await import("/js/photomenu.js");
            if (myToken !== currentLoadToken) return;
            photoModule.initPhotoMenu?.();

            const productmenu = await import("/js/productmenu.js?v=20261008b");
            if (myToken !== currentLoadToken) return;
            await productmenu.initProductPage?.();
            if (myToken !== currentLoadToken) {
              productmenu.cleanupProductMenuPage?.();
              return;
            }
            currentCleanup = productmenu.cleanupProductMenuPage || null;
          } catch (err) {
            console.error("Product Menu Init Error:", err);
          }
          break;

        case "expenses.html":
        case "owner-capital":
          try {
            const addbtnModule = await import("/js/addExpensesbtn.js?v=20261008c");
            if (myToken !== currentLoadToken) return;
            addbtnModule.initExpensesModal?.();

            const expensesModule = await import("/js/adminExpenses.js?v=20261008c");
            if (myToken !== currentLoadToken) return;
            expensesModule.loadExpenses?.();
            currentCleanup = () => {
              expensesModule.stopLoadingExpenses?.();
              addbtnModule.stopExpensesModal?.();
            };
          } catch (err) {
            console.error("Expenses Init Error:", err);
          }
          break;

        case "EmployeeManagement.html":
          try {
            const employeeModule = await import("/js/addemployeebtn.js?v=20261003b");
            if (myToken !== currentLoadToken) return;
            employeeModule.initEmployee?.();

            const addemployeeModule = await import("/js/adminEmployee.js?v=20261003b");
            if (myToken !== currentLoadToken) return;
            addemployeeModule.loadEmployees?.();
            currentCleanup = () => {
              addemployeeModule.stopEmployeesPage?.();
              employeeModule.stopEmployee?.();
            };
          } catch (err) {
            console.error("Employee Init Error:", err);
          }
          break;

        case "EmployeeMonitoring.html":
          try {
            const attendanceModule = await import("/js/attendanceAdmin.js");
            if (myToken !== currentLoadToken) return;
            attendanceModule.initAttendanceMonitoring?.();
            currentCleanup = attendanceModule.stopAttendanceMonitoring || null;
          } catch (err) {
            console.error("Attendance monitoring init error:", err);
          }
          break;

        case "attendance.html":
          try {
            attendanceStylesheet = document.createElement("link");
            attendanceStylesheet.rel = "stylesheet";
            attendanceStylesheet.href = "/css/employee.css";
            document.head.append(attendanceStylesheet);
            const attendanceModule = await import("/js/attendance.js");
            if (myToken !== currentLoadToken) return;
            await attendanceModule.initAttendance?.();
            if (myToken !== currentLoadToken) {
              attendanceModule.stopAttendancePage?.();
              return;
            }
            currentCleanup = attendanceModule.stopAttendancePage || null;
          } catch (err) {
            console.error("Attendance init error:", err);
          }
          break;

        case "IncomeCart.html":
          try {
            const incomeModule = await import("/js/incomeCart.js");
            if (myToken !== currentLoadToken) return;
            incomeModule.initIncomeCart?.();
            currentCleanup = incomeModule.cleanupIncomeCart || null;
          } catch (err) {
            console.error("Income Per Cart Init Error:", err);
          }
          break;

        case "sales.html":
        case "owner-sales":
        case "owner-orders":
          try {
            const salesModule = await import("/js/sales.js");
            if (myToken !== currentLoadToken) return;
            salesModule.initSalesPage?.();
            currentCleanup = salesModule.cleanupSalesPage || null;
          } catch (err) {
            console.error("Sales Orders Init Error:", err);
          }
          break;

        case "payroll.html":
          try {
            const payrollModule = await import("/js/payroll.js");
            if (myToken !== currentLoadToken) return;
            payrollModule.initPayroll?.();
            currentCleanup = payrollModule.cleanupPayroll || null;
          } catch (err) {
            console.error("Payroll Init Error:", err);
          }
          break;
      }
    })
    .catch((err) => console.error("Error Loading Section:", err))
    .finally(() => {
      isNavigating = false;
    });

  const navItems = document.querySelectorAll(".nav li");
  navItems.forEach((item) => item.classList.remove("active"));

  const link = document.querySelector(`.nav a[onclick*="${page}"]`);
  if (link) link.parentElement.classList.add("active");

  document.querySelector(".sidebar")?.classList.remove("active");
  document.querySelector(".overlay")?.classList.remove("active");
}

window.loadSection = loadSection;

const menuBtn = document.getElementById("menu-toggle");
const sidebar = document.querySelector(".sidebar");
const overlay = document.querySelector(".overlay");

menuBtn?.addEventListener("click", () => {
  sidebar?.classList.toggle("active");
  overlay?.classList.toggle("active");
});

overlay?.addEventListener("click", () => {
  sidebar?.classList.remove("active");
  overlay?.classList.remove("active");
});

function handleOrientation() {
  const isLandscape = window.matchMedia("(orientation: landscape)").matches;
  if (isLandscape && window.innerWidth <= 1024) {
    sidebar?.classList.remove("active");
    overlay?.classList.remove("active");
  }
}

handleOrientation();
window.addEventListener("resize", handleOrientation);
window.addEventListener("orientationchange", handleOrientation);
