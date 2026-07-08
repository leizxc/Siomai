function loadSection(page) {
    fetch(page)
        .then(response => response.text())
        .then(async data => {
            const main = document.getElementById('content');
            main.innerHTML = data;

            const title = document.getElementById("mobile-title");

            const pageTitles = {
                "dashboard.html": "Dashboard",
                "inventory.html": "Inventory",
                "product.html": "Products Assign",
                "expenses.html": "Expenses Records",
                "EmployeeManagement.html": "Employees Management",
                "EmployeeMonitoring.html": "Employee Monitoring"
            };

            if (title) {
                title.textContent = pageTitles[page] || "Administrator";
            }

            // Initialize Materialize Components
            const selects = document.querySelectorAll('select');
            M.FormSelect.init(selects);

            const modals = document.querySelectorAll('.modal');
            M.Modal.init(modals);

            // PAGE INITIALIZERS
            switch (page) {
                case "inventory.html":
                    try {
                        const addbtnModule = await import("/js/inventoryADDbtn.js");
                        if (typeof addbtnModule.initInventoryModal === "function") {
                            addbtnModule.initInventoryModal();
                        }

                        const inventoryModule = await import("/js/adminBE.js");
                        if (typeof inventoryModule.loadInventory === "function") {
                            inventoryModule.loadInventory();
                        }
                        if (typeof inventoryModule.loadCategories === "function") {
                            inventoryModule.loadCategories();
                        }
                    } catch (err) {
                        console.error("Inventory Init Error:", err);
                    }
                    break;

                case "product.html":
                    try {
                        const addproducts = await import("/js/addproductbtn.js");
                        if (typeof addproducts.initProductModal === "function") {
                            addproducts.initProductModal();
                        }

                        const productModule = await import("/js/adminaddproduct.js");
                        if (typeof productModule.loadProducts === "function") {
                            productModule.loadProducts();
                        }
                    } catch (err) {
                        console.error("Product Init Error:", err);
                    }
                    break;

                case "expenses.html":
                    try {
                        const addbtnModule = await import("/js/addExpensesbtn.js");
                        if (typeof addbtnModule.initExpensesModal === "function") {
                            addbtnModule.initExpensesModal();
                        }

                        const expensesModule = await import("/js/adminExpenses.js");
                        if (typeof expensesModule.loadExpenses === "function") {
                            expensesModule.loadExpenses();
                        }
                    } catch (err) {
                        console.error("Expenses Init Error:", err);
                    }
                    break;

                case "EmployeeManagement.html":
                    try {
                        const employeeModule = await import("/js/addemployeebtn.js");
                        if (typeof employeeModule.initEmployee === "function") {
                            employeeModule.initEmployee();
                        }

                        const addemployeeModule = await import("/js/adminEmployee.js");
                        if (typeof addemployeeModule.loadEmployees === "function") {
                            addemployeeModule.loadEmployees();
                        }
                    } catch (err) {
                        console.error("Employee Init Error:", err);
                    }
                    break;

                case "EmployeeMonitoring.html":
                    try {
                        // future monitoring logic
                    } catch (err) {
                        console.error("Monitoring Init Error:", err);
                    }
                    break;
            }
        })
        .catch(err => console.error('Error Loading Section:', err));

    // Highlight nav
    const navItems = document.querySelectorAll('.nav li');
    navItems.forEach(item => item.classList.remove('active'));

    const link = document.querySelector(`.nav a[onclick*="${page}"]`);
    if (link) {
        link.parentElement.classList.add('active');
    }

    // Close sidebar on mobile
    document.querySelector('.sidebar')?.classList.remove('active');
    document.querySelector('.overlay')?.classList.remove('active');
}

// Make global for inline onclick
window.loadSection = loadSection;

// HAMBURGER MENU
const menuBtn = document.getElementById('menu-toggle');
const sidebar = document.querySelector('.sidebar');
const overlay = document.querySelector('.overlay');

if (menuBtn) {
    menuBtn.addEventListener('click', () => {
        sidebar?.classList.toggle('active');
        overlay?.classList.toggle('active');
    });
}

// CLOSE OVERLAY
if (overlay) {
    overlay.addEventListener('click', () => {
        sidebar?.classList.remove('active');
        overlay?.classList.remove('active');
    });
}

// LANDSCAPE FIX
function handleOrientation() {
    const isLandscape = window.matchMedia("(orientation: landscape)").matches;
    if (isLandscape && window.innerWidth <= 1024) {
        sidebar?.classList.remove('active');
        overlay?.classList.remove('active');
    }
}

// INITIAL RUN
handleOrientation();

// LISTENERS
window.addEventListener('resize', handleOrientation);
window.addEventListener('orientationchange', handleOrientation);
