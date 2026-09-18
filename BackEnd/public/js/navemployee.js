let currentLoadToken = 0;
let isNavigating = false;
let currentCleanup = null;

async function loadSection(page) {
  if (isNavigating) return;

  isNavigating = true;

  // Ang unang POS load ay ini-init mula sa userpanel.html, kaya wala pa itong
  // currentCleanup sa navigator. Ipaalam din sa POS module na papalitan na ang
  // DOM para maisara nito ang realtime product listener.
  window.dispatchEvent(new Event("employee:before-section-change"));

  if (currentCleanup) {
    currentCleanup();
    currentCleanup = null;
  }

  const myToken = ++currentLoadToken;

  try {
    const response = await fetch(page);

    if (!response.ok) {
      throw new Error(`Failed to load ${page}`);
    }

    const data = await response.text();

    if (myToken !== currentLoadToken) return;

    const parser = new DOMParser();
    const parsedPage = parser.parseFromString(data, "text/html");

    const main = document.getElementById("content");

    if (!main) {
      throw new Error("#content not found");
    }

    const pageContent = parsedPage.querySelector("#content");

    if (pageContent) {
      main.innerHTML = pageContent.innerHTML;
    } else {
      main.innerHTML = parsedPage.body.innerHTML;
    }

    const title = document.getElementById("mobile-title");

    const pageTitles = {
      "userpanel.html": "Point of Sale",
      "report.html": "Report",
      "stock.html": "Inventory",
      "attendance.html": "Attendance",
    };

    if (title) {
      title.textContent = pageTitles[page] || "Employee";
    }

    updateBottomNav(page);

    if (typeof M !== "undefined") {
      M.FormSelect.init(
        document.querySelectorAll("select")
      );

      M.Modal.init(
        document.querySelectorAll(".modal")
      );
    }

    switch (page) {
      case "userpanel.html":
        try {
          const posModule = await import("/js/empoleyee.js");

          if (
            myToken !== currentLoadToken
          ) {
            return;
          }

          if (
            typeof posModule.initPOS === "function"
          ) {
            await posModule.initPOS();
          }

          currentCleanup =
            posModule.stopPosPage || null;
        } catch (err) {
          console.error(
            "POS init Error:",
            err
          );
        }
        break;

      case "stock.html":
        try {
          const stockModule =
            await import("/js/stock.js");

          if (
            myToken !== currentLoadToken
          ) {
            return;
          }

          if (
            typeof stockModule.loadstock ===
            "function"
          ) {
            await stockModule.loadstock();
          }

          currentCleanup =
            stockModule.stopStockPage || null;
        } catch (err) {
          console.error(
            "Stock init Error:",
            err
          );
        }
        break;

      case "attendance.html":
        try {
          const attendanceModule =
            await import("/js/attendance.js");

          if (
            myToken !== currentLoadToken
          ) {
            return;
          }

          if (
            typeof attendanceModule.initAttendance ===
            "function"
          ) {
            await attendanceModule.initAttendance();
          }

          currentCleanup =
            attendanceModule.stopAttendancePage ||
            null;
        } catch (err) {
          console.error(
            "Attendance init Error:",
            err
          );
        }
        break;

      case "report.html":
        try {
          const reportModule = await import("/js/report.js");
          if (myToken !== currentLoadToken) return;
          await reportModule.initReportPage?.();
          currentCleanup = reportModule.stopReportPage || null;
        } catch (err) {
          console.error("Expense report init error:", err);
        }
        break;
    }
  } catch (err) {
    console.error(
      "Error Loading Section:",
      err
    );
  } finally {
    isNavigating = false;
  }
}

window.loadSection = loadSection;

function updateBottomNav(page) {
  const navItems =
    document.querySelectorAll(
      ".bottom-nav a"
    );

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

document.addEventListener(
  "DOMContentLoaded",
  async () => {
    const bottomNav =
      document.querySelector(".bottom-nav");

    document.querySelector("#employee-notification-bell")?.addEventListener(
      "click",
      () => loadSection("report.html")
    );

    try {
      const notificationModule = await import("/js/employeeNotifications.js");
      notificationModule.initEmployeeNotifications?.();
    } catch (err) {
      console.error("Employee notification init error:", err);
    }

    if (!bottomNav) {
      return;
    }

    const navItems =
      bottomNav.querySelectorAll("a");

    navItems[0]?.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        loadSection("userpanel.html");
      }
    );

    navItems[1]?.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        loadSection("stock.html");
      }
    );

    navItems[2]?.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        loadSection("attendance.html");
      }
    );

    navItems[3]?.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        loadSection("report.html");
      }
    );

    navItems[4]?.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        window.location.href =
          "/index.html";
      }
    );

    updateBottomNav("userpanel.html");
  }
);
