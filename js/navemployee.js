function loadSection(page) {
  fetch(page)
    .then(response => response.text())
    .then(async data => {
      const main = document.getElementById('content');
      main.innerHTML = data;

      // Initialize Materialize Components
      const selects = document.querySelectorAll('select');
      M.FormSelect.init(selects);

      const modals = document.querySelectorAll('.modal');
      M.Modal.init(modals);

      // PAGE INITIALIZERS (Employee side)
      switch (page) {
        case "stock.html":
          try {
            const stockModule = await import("");
            if (typeof stockModule.loadStock === "function") {
              stockModule.loadStock();
            }
          } catch (err) {
            console.error("Stock Init Error:", err);
          }
          break;

        case "sales.html":
          try {
            const salesModule = await import("");
            if (typeof salesModule.loadSales === "function") {
              salesModule.loadSales();
            }
          } catch (err) {
            console.error("Sales Init Error:", err);
          }
          break;

        case "qouta.html":
          try {
            const quotaModule = await import("");
            if (typeof quotaModule.loadQuota === "function") {
              quotaModule.loadQuota();
            }
          } catch (err) {
            console.error("Quota Init Error:", err);
          }
          break;

        case "userpanel.html":
          try {
            const posModule = await import("");
            if (typeof posModule.initPOS === "function") {
              posModule.initPOS();
            }
          } catch (err) {
            console.error("POS Init Error:", err);
          }
          break;
      }
    })
    .catch(err => console.error("Error Loading Section:", err));

  // Highlight nav
  const navItems = document.querySelectorAll(".nav li");
  navItems.forEach(item => {
    item.classList.remove("active");
  });

  const link = document.querySelector(`.nav a[onclick*="${page}"]`);
  if (link) {
    link.parentElement.classList.add("active");
  }

  // Close sidebar on mobile
  document.querySelector(".sidebar")?.classList.remove("active");
  document.querySelector(".overlay")?.classList.remove("active");
}

// Make global for inline onclick
window.loadSection = loadSection;

// HAMBURGER MENU
const menuBtn = document.getElementById("menu-toggle");
const sidebar = document.querySelector(".sidebar");
const overlay = document.querySelector(".overlay");

if (menuBtn) {
  menuBtn.addEventListener("click", () => {
    sidebar?.classList.toggle("active");
    overlay?.classList.toggle("active");
  });
}

// CLOSE OVERLAY
if (overlay) {
  overlay.addEventListener("click", () => {
    sidebar?.classList.remove("active");
    overlay?.classList.remove("active");
  });
}

// LANDSCAPE FIX
function handleOrientation() {
  const isLandscape = window.matchMedia("(orientation: landscape)").matches;
  if (isLandscape && window.innerWidth <= 1024) {
    sidebar?.classList.remove("active");
    overlay?.classList.remove("active");
  }
}

// INITIAL RUN
handleOrientation();

// LISTENERS
window.addEventListener("resize", handleOrientation);
window.addEventListener("orientationchange", handleOrientation);
