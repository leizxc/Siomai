// navemployee.js
// ================================
// BOTTOM NAVIGATION
// ================================

function loadSection(page) {
  fetch(page)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to load ${page}`);
      }

      return response.text();
    })
    .then(async (data) => {
      const content = document.getElementById("content");

      if (!content) {
        console.error("Content container not found.");
        return;
      }

      // Load page content
      content.innerHTML = data;

      // ================================
      // PAGE TITLE
      // ================================

      const title = document.getElementById("mobile-title");

      const pageTitles = {
        "userpanel.html": "Point of Sale",
        "stock.html": "Inventory",
        "sales.html": "History",
      };

      if (title) {
        title.textContent = pageTitles[page] || "Employee";
      }

      // ================================
      // MATERIALIZE INITIALIZATION
      // ================================

      const selects = content.querySelectorAll("select");

      if (selects.length > 0) {
        M.FormSelect.init(selects);
      }

      const modals = content.querySelectorAll(".modal");

      if (modals.length > 0) {
        M.Modal.init(modals);
      }

      // ================================
      // PAGE INITIALIZERS
      // ================================

      switch (page) {
        case "userpanel.html":
          try {
            const posModule = await import("./empoleyee.js");

            if (typeof posModule.initPOS === "function") {
              await posModule.initPOS();
            }
          } catch (error) {
            console.error("POS Init Error:", error);
          }
          break;

        case "stock.html":
          try {
            const stockModule = await import("./stock.js");

            if (typeof stockModule.loadStock === "function") {
              await stockModule.loadStock();
            }
          } catch (error) {
            console.error("Stock Init Error:", error);
          }
          break;

        case "sales.html":
          try {
            const salesModule = await import("./sales.js");

            if (typeof salesModule.loadSales === "function") {
              await salesModule.loadSales();
            }
          } catch (error) {
            console.error("Sales Init Error:", error);
          }
          break;

        default:
          console.log(`No initializer for ${page}`);
      }

      // ================================
      // UPDATE BOTTOM NAV
      // ================================

      updateBottomNav(page);
    })
    .catch((error) => {
      console.error("Error Loading Section:", error);
    });
}

// Make function available to HTML
window.loadSection = loadSection;


// ================================
// BOTTOM NAV ACTIVE STATE
// ================================

function updateBottomNav(page) {
  const navItems = document.querySelectorAll(".bottom-nav a");

  navItems.forEach((item) => {
    item.classList.remove("active");
  });

  if (page === "userpanel.html") {
    navItems[0]?.classList.add("active");
  }

  else if (page === "stock.html") {
    navItems[1]?.classList.add("active");
  }

  else if (page === "sales.html") {
    navItems[2]?.classList.add("active");
  }
}


// ================================
// BOTTOM NAV CLICK EVENTS
// ================================

document.addEventListener("DOMContentLoaded", () => {

  const bottomNav = document.querySelector(".bottom-nav");

  if (!bottomNav) {
    console.warn("Bottom navigation not found.");
    return;
  }

  const navItems = bottomNav.querySelectorAll("a");

  // POS
  navItems[0]?.addEventListener("click", (event) => {
    event.preventDefault();

    loadSection("userpanel.html");
  });

  // INVENTORY
  navItems[1]?.addEventListener("click", (event) => {
    event.preventDefault();

    loadSection("stock.html");
  });

  // HISTORY
  navItems[2]?.addEventListener("click", (event) => {
    event.preventDefault();

    loadSection("sales.html");
  });

});


// ================================
// INITIAL PAGE
// ================================

document.addEventListener("DOMContentLoaded", () => {

  // POS is the default page
  updateBottomNav("userpanel.html");

});