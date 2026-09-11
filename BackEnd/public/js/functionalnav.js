let currentLoadToken = 0;
let isNavigating = false;
let currentCleanup = null;

function loadSection(page) {
  if (isNavigating) return;
  isNavigating = true;

  // Stop the previous page's listeners before loading the new one
  if (currentCleanup) {
    currentCleanup();
    currentCleanup = null;
  }

  const myToken = ++currentLoadToken;

  fetch(page)
    .then((response) => response.text())
    .then(async (data) => {
      if (myToken !== currentLoadToken) return;

      const main = document.getElementById("content");
      main.innerHTML = data;

      const title = document.getElementById("mobile-title");

      const pageTitles = {
        "dashboard.html": "Dashboard",
        "inventory.html": "Inventory Management",
        "product.html": "Products Assign Management",
        "productMenu.html": "Product menu Management",
        "expenses.html": "Capital Management",
        "EmployeeManagement.html": "Employees Management",
        "EmployeeMonitoring.html": "Employee Monitoring",
      };

      if (title) title.textContent = pageTitles[page] || "Administrator";

      M.FormSelect.init(document.querySelectorAll("select"));
      M.Modal.init(document.querySelectorAll(".modal"));

      switch (page) {
        case "inventory.html":
          try {
            const addbtnModule = await import("/js/inventoryADDbtn.js");
            if (myToken !== currentLoadToken) return;
            addbtnModule.initInventoryModal?.();

            const inventoryModule = await import("/js/adminBE.js");
            if (myToken !== currentLoadToken) return;
            await inventoryModule.initInventoryPage?.();

            currentCleanup = inventoryModule.stopInventoryPage || null;
          } catch (err) {
            console.error("Inventory Init Error:", err);
          }
          break;

        case "product.html":
          try {
            const addproducts = await import("/js/addproductbtn.js");
            if (myToken !== currentLoadToken) return;
            addproducts.initProductModal?.();

            const productModule = await import("/js/adminaddproduct.js");
            if (myToken !== currentLoadToken) return;
            await productModule.initProductPage?.();
            if (myToken !== currentLoadToken) return;
            productModule.loadProducts?.();

            currentCleanup = productModule.cleanupProductPage || null;
          } catch (err) {
            console.error("Product Init Error:", err);
          }
          break;

        case "productMenu.html":
          try {
            const photoModule = await import("/js/photomenu.js");
            if (myToken !== currentLoadToken) return;
            photoModule.initPhotoMenu?.();

            const productmenu = await import("/js/productmenu.js");
            if (myToken !== currentLoadToken) return;
            await productmenu.initProductPage?.();
          } catch (err) {
            console.error("Product Menu Init Error:", err);
          }
          break;

        case "expenses.html":
          try {
            const addbtnModule = await import("/js/addExpensesbtn.js");
            if (myToken !== currentLoadToken) return;
            addbtnModule.initExpensesModal?.();

            const expensesModule = await import("/js/adminExpenses.js");
            if (myToken !== currentLoadToken) return;
            expensesModule.loadExpenses?.();
          } catch (err) {
            console.error("Expenses Init Error:", err);
          }
          break;

        case "EmployeeManagement.html":
          try {
            const employeeModule = await import("/js/addemployeebtn.js");
            if (myToken !== currentLoadToken) return;
            employeeModule.initEmployee?.();

            const addemployeeModule = await import("/js/adminEmployee.js");
            if (myToken !== currentLoadToken) return;
            addemployeeModule.loadEmployees?.();
          } catch (err) {
            console.error("Employee Init Error:", err);
          }
          break;

        case "EmployeeMonitoring.html":
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
