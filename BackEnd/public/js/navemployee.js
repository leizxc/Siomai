// navemployee.js
let currentLoadToken = 0;
let isNavigating = false;
let currentCleanup = null;

function loadSection(page) {
  if (isNavigating) return;
  isNavigating = true;

  //stop the previus page listener
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
        "userpanel.html": "Point of Sale",
        "report.html": "Report",
        "stock.html": "Inventory",
        "attendance.html": "Attendance",
      };
      if (title) title.textContent = pageTitles[page] || "Employee";

      M.FormSelect.init(document.querySelectorAll("select"));
      M.Modal.init(document.querySelectorAll(".modal"));

      switch (page) {
        case "userpanel.html":
          try {
            const posModule = await import("/js/empoleyee.js");
            if (typeof posModule.initPOS === "function") {
              if (myToken !== currentLoadToken) return;
              await posModule.initPOS();
            }
            currentCleanup = posModule.stopPosPage || null;
          } catch (err) {
            console.error("POS init Error", err);
          }
          break;

        case "stock.html":
          try {
            const stockmodule = await import("/js/stock.js");
            if (typeof stockmodule.loadstock === "function") {
              if (myToken !== currentLoadToken) return;
              await stockmodule.loadstock();
            }

            currentCleanup = stockmodule.stopStockPage || null;
          } catch (err) {
            console.error("stock init Error:", err);
          }
          break;

        case "attendance.html":
          try {
            const attendanceModule = await import("/js/attendance.js");

            if (typeof attendanceModule.initAttendance === "function") {
              if (myToken !== currentLoadToken) return;

              await attendanceModule.initAttendance();
            }

            currentCleanup = attendanceModule.stopAttendancePage || null;
          } catch (err) {
            console.error("Attendance init Error:", err);
          }

          break;

        case "report.html":
      }
    })
    .catch((err) => console.error("Error Loading Section:", err))
    .finally(() => {
      isNavigating = false;
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
  } else if (page === "stock.html") {
    navItems[1]?.classList.add("active");
  } else if (page === "attendance.html") {
    navItems[2]?.classList.add("active");
  } else if (page === "report.html") {
    navItems[3]?.classList.add("active");
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

  // ATTENDANCE
  navItems[2]?.addEventListener("click", (event) => {
    event.preventDefault();

    loadSection("attendance.html");
  });

  // REPORT
  navItems[3]?.addEventListener("click", (event) => {
    event.preventDefault();

    loadSection("report.html");
  });

  // Logout
  navItems[4]?.addEventListener("click", (event) => {
    event.preventDefault();

    window.location.href = "/index.html";
  });
});

// ================================
// INITIAL PAGE
// ================================

document.addEventListener("DOMContentLoaded", () => {
  // POS is the default page
  updateBottomNav("userpanel.html");
});
