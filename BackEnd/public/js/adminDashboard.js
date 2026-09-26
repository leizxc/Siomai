import { db } from "/js/firebase.js";
import { collection, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const money = (value) => `\u20B1${Number(value || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const localDateKey = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
const asDate = (value) => value?.toDate ? value.toDate() : value instanceof Date ? value : null;
const orderTotal = (order) => (Array.isArray(order.items) ? order.items : []).reduce(
  (total, item) => total + (Number(item.price) || 0) * (Number(item.qty) || 0), 0,
);

const state = { orders: [], expenses: [], attendance: [], inventory: [], alerts: [] };
const unsubscribers = [];

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function renderDashboard() {
  const today = localDateKey(new Date());
  const todayOrders = state.orders.filter((order) => {
    const date = asDate(order.created_at);
    return order.status === "paid" && date && localDateKey(date) === today;
  });
  const todaySales = todayOrders.reduce((sum, order) => sum + orderTotal(order), 0);
  const todayExpenses = state.expenses
    .filter((expense) => expense.date === today && String(expense.status || "").toLowerCase() !== "rejected")
    .reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0);
  const pendingAttendance = state.attendance.filter((item) => ["pending", "time_out_pending"].includes(item.status));
  const newExpenseReports = state.alerts.filter((item) => item.type === "expense_report" && !item.read);
  const lowStock = state.inventory.filter((item) => {
    const unit = String(item.unit_type || "").trim().toLowerCase();
    const category = String(item.category || "").trim().toLowerCase();
    const pieceBased = ["piece", "pieces", "pcs", "pc", "pack"].includes(unit);
    const exempt = ["kaban", "kilogram", "kg", "packs"].includes(unit) || ["drinks", "rice"].includes(category);
    return pieceBased && !exempt && Number(item.stock_quantity) > 0 && Number(item.stock_quantity) <= 25;
  });
  const outOfStock = state.inventory.filter((item) => Number(item.stock_quantity) <= 0);

  setText("dashboard-sales-today", money(todaySales));
  setText("dashboard-expenses-today", money(todayExpenses));
  setText("dashboard-attendance-pending", String(pendingAttendance.length));
  setText("dashboard-attendance-pending-small", `${pendingAttendance.length} pending attendance requests`);
  setText("dashboard-reports-pending", String(newExpenseReports.length));
  setText("dashboard-inventory-total", String(state.inventory.length));
  setText("dashboard-low-stock", String(lowStock.length));
  setText("dashboard-out-stock", String(outOfStock.length));
  setText("dashboard-net-today", money(todaySales - todayExpenses));

  const attention = [
    ...pendingAttendance.map((item) => ({ label: `${item.fname || "Employee"} ${item.lname || ""}`.trim(), detail: item.status === "time_out_pending" ? "Time out approval" : "Time in approval", link: "EmployeeMonitoring.html" })),
    ...newExpenseReports.map((item) => ({ label: item.title || "New expense report", detail: item.message || "Review this notification", action: "document.getElementById('manager-notification-bell')?.click()" })),
    ...state.alerts.filter((item) => item.type === "low_stock" && !item.read).map((item) => ({ label: item.productName || "Low stock alert", detail: `${item.remainingStock ?? 0} ${item.unit || "pcs"} remaining`, link: "inventory.html" })),
  ].slice(0, 6);
  const attentionBody = document.getElementById("dashboard-manager-queue");
  if (attentionBody) attentionBody.innerHTML = attention.length
    ? attention.map((item) => `<a class="dashboard-queue-item" href="#" onclick="${item.action || `loadSection('${item.link}', this)`}; return false"><span><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.detail)}</small></span><i class="material-icons">chevron_right</i></a>`).join("")
    : '<p class="dashboard-empty">No pending manager actions.</p>';

  const stockBody = document.getElementById("dashboard-stock-list");
  const watchList = [...lowStock, ...outOfStock].slice(0, 6);
  if (stockBody) stockBody.innerHTML = watchList.length
    ? watchList.map((item) => `<div class="dashboard-stock-item"><span><strong>${escapeHtml(item.product_name || item.name || "Unnamed item")}</strong><small>${escapeHtml(item.category || item.unit_type || "Inventory")}</small></span><b class="${Number(item.stock_quantity) <= 0 ? "stock-out" : "stock-low"}">${Number(item.stock_quantity) <= 0 ? "Out of stock" : `${escapeHtml(item.stock_quantity)} ${escapeHtml(item.unit_type || "units")}`}</b></div>`).join("")
    : '<p class="dashboard-empty">No low or out of stock items.</p>';

  const expenseBody = document.getElementById("dashboard-recent-expenses");
  if (expenseBody) {
    const recentExpenses = [...state.expenses].sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))).slice(0, 5);
    expenseBody.innerHTML = recentExpenses.length
      ? recentExpenses.map((item) => `<tr><td>${escapeHtml(item.description || "Expense")}</td><td>${escapeHtml(item.category || "—")}</td><td>${money(item.amount)}</td><td>${escapeHtml(item.date || "—")}</td></tr>`).join("")
      : '<tr><td colspan="4" class="dashboard-empty">No expense records yet.</td></tr>';
  }

  drawIncomeChart();
}

function escapeHtml(value) {
  const element = document.createElement("span");
  element.textContent = String(value ?? "");
  return element.innerHTML;
}

function drawIncomeChart() {
  const canvas = document.getElementById("dashboard-income-chart");
  if (!canvas) return;
  const bounds = canvas.getBoundingClientRect();
  const width = Math.max(300, bounds.width);
  const height = 270;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);

  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (6 - index));
    return { date, key: localDateKey(date), label: date.toLocaleDateString("en-PH", { weekday: "short" }) };
  });
  const series = [
    { name: "Sales", color: "#2563eb", values: days.map(({ key }) => state.orders.filter((order) => order.status === "paid" && localDateKey(asDate(order.created_at) || new Date(0)) === key).reduce((sum, order) => sum + orderTotal(order), 0)) },
    { name: "Expenses", color: "#f59e0b", values: days.map(({ key }) => state.expenses.filter((item) => item.date === key && String(item.status || "").toLowerCase() !== "rejected").reduce((sum, item) => sum + (Number(item.amount) || 0), 0)) },
  ];
  const maxValue = Math.max(1, ...series.flatMap((item) => item.values));
  const left = 54, right = 16, top = 18, bottom = 36;
  const chartWidth = width - left - right, chartHeight = height - top - bottom;
  const dark = document.documentElement.classList.contains("dark");
  ctx.clearRect(0, 0, width, height);
  ctx.font = "12px system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let tick = 0; tick <= 4; tick++) {
    const y = top + chartHeight * tick / 4;
    const value = maxValue * (4 - tick) / 4;
    ctx.strokeStyle = dark ? "#334155" : "#e5e7eb";
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(width - right, y); ctx.stroke();
    ctx.fillStyle = dark ? "#cbd5e1" : "#64748b";
    ctx.fillText(value >= 1000 ? `\u20B1${(value / 1000).toFixed(0)}k` : `\u20B1${Math.round(value)}`, left - 8, y);
  }
  days.forEach(({ label }, index) => {
    const x = left + chartWidth * index / (days.length - 1);
    ctx.fillStyle = dark ? "#cbd5e1" : "#64748b";
    ctx.textAlign = "center";
    ctx.fillText(label, x, height - 13);
  });
  series.forEach((item) => {
    ctx.strokeStyle = item.color;
    ctx.fillStyle = item.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    item.values.forEach((value, index) => {
      const x = left + chartWidth * index / (item.values.length - 1);
      const y = top + chartHeight * (1 - value / maxValue);
      if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    item.values.forEach((value, index) => {
      const x = left + chartWidth * index / (item.values.length - 1);
      const y = top + chartHeight * (1 - value / maxValue);
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
    });
  });
  const legend = document.getElementById("dashboard-chart-legend");
  if (legend) legend.innerHTML = series.map((item) => `<span><i style="--legend-color:${item.color}"></i>${item.name}</span>`).join("");
}

function subscribe(collectionName, key, map) {
  unsubscribers.push(onSnapshot(collection(db, collectionName), (snapshot) => {
    state[key] = snapshot.docs.map((item) => map ? map(item.data()) : item.data());
    renderDashboard();
  }, (error) => console.error(`Unable to load dashboard ${collectionName}:`, error)));
}

subscribe("orders", "orders");
subscribe("expenses", "expenses");
subscribe("attendance", "attendance");
subscribe("inventory", "inventory");
subscribe("managerNotifications", "alerts");
window.addEventListener("resize", drawIncomeChart);
document.getElementById("theme-toggle")?.addEventListener("click", () => requestAnimationFrame(drawIncomeChart));

window.addEventListener("pagehide", () => unsubscribers.forEach((unsubscribe) => unsubscribe()), { once: true });
