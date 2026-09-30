import { db } from "/js/firebase.js";
import {
  collection,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const state = {
  orders: [],
  expenses: [],
  attendance: [],
  inventory: [],
  alerts: [],
  employees: [],
};
const unsubscribers = [];
const money = (value) =>
  `₱${Number(value || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateKey = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};
const asDate = (value) =>
  value?.toDate ? value.toDate() : value instanceof Date ? value : null;
const total = (order) =>
  Number(order.total) ||
  (Array.isArray(order.items)
    ? order.items.reduce(
        (sum, item) =>
          sum + (Number(item.price) || 0) * (Number(item.qty) || 0),
        0,
      )
    : 0);
const escapeHtml = (value) => {
  const el = document.createElement("span");
  el.textContent = String(value ?? "");
  return el.innerHTML;
};
const setText = (id, value) => {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
};

function render() {
  const today = dateKey(new Date());
  const todayOrders = state.orders.filter(
    (order) =>
      order.status === "paid" &&
      asDate(order.created_at) &&
      dateKey(asDate(order.created_at)) === today,
  );
  const salesToday = todayOrders.reduce((sum, order) => sum + total(order), 0);
  const expensesToday = state.expenses
    .filter(
      (item) =>
        item.date === today &&
        String(item.status || "").toLowerCase() !== "rejected",
    )
    .reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const pending = state.attendance.filter((item) =>
    ["pending", "time_out_pending"].includes(item.status),
  );
  const activeEmployees = new Set(
    state.attendance
      .filter((item) => {
        const attendanceDate =
          item.attendanceDate ||
          (asDate(item.clockedInAt) ? dateKey(asDate(item.clockedInAt)) : "");
        return (
          attendanceDate === today &&
          ["active", "time_out_pending"].includes(item.status) &&
          !item.clockedOutAt &&
          item.userId
        );
      })
      .map((item) => item.userId),
  );
  const unread = state.alerts.filter((item) => !item.read);
  const lowStock = state.inventory.filter((item) => {
    const unit = String(item.unit_type || "")
      .trim()
      .toLowerCase();
    const category = String(item.category || "")
      .trim()
      .toLowerCase();
    return (
      ["piece", "pieces", "pcs", "pc", "pack"].includes(unit) &&
      !["kaban", "kilogram", "kg", "packs"].includes(unit) &&
      !["drinks", "rice"].includes(category) &&
      Number(item.stock_quantity) > 0 &&
      Number(item.stock_quantity) <= 25
    );
  });
  const outStock = state.inventory.filter(
    (item) => Number(item.stock_quantity) <= 0,
  );

  setText("owner-sales-today", money(salesToday));
  setText(
    "owner-orders-today",
    `${todayOrders.length} paid ${todayOrders.length === 1 ? "order" : "orders"}`,
  );
  setText("owner-expenses-today", money(expensesToday));
  setText("owner-net-today", money(salesToday - expensesToday));
  setText("owner-team-active", String(activeEmployees.size));
  setText("owner-pending-count", String(pending.length));
  setText("owner-alert-count", String(unread.length));
  setText("owner-inventory-total", String(state.inventory.length));
  setText("owner-low-stock", String(lowStock.length));
  setText("owner-out-stock", String(outStock.length));

  renderEmployeeSales(todayOrders);
  renderActivity(pending, unread);
  renderStock([...outStock, ...lowStock]);
  renderExpenses();
  drawChart();
}

function renderEmployeeSales(orders) {
  const body = document.getElementById("owner-employee-sales");
  if (!body) return;
  const rows = new Map();
  orders.forEach((order) => {
    const employeeId = String(order.employeeId || "");
    const employeeUid = String(order.employeeUid || order.employee || "");
    const employeeRecord = state.employees.find(
      (item) =>
        item.id === employeeId ||
        item.uid === employeeUid ||
        item.authUid === employeeUid ||
        item.data?.uid === employeeUid,
    );
    const employeeData = employeeRecord?.data || employeeRecord;
    const employee = String(
      order.employeeName ||
        order.employee_name ||
        (employeeData &&
          `${employeeData.fname || ""} ${employeeData.lname || ""}`.trim()) ||
        employeeId ||
        employeeUid ||
        "Unknown employee",
    );
    const row = rows.get(employee) || { orders: 0, sales: 0 };
    row.orders += 1;
    row.sales += total(order);
    rows.set(employee, row);
  });
  const sorted = [...rows.entries()].sort((a, b) => b[1].sales - a[1].sales);
  body.innerHTML = sorted.length
    ? sorted
        .map(
          ([name, data]) =>
            `<tr><td>${escapeHtml(name)}</td><td>${data.orders}</td><td>${money(data.sales)}</td></tr>`,
        )
        .join("")
    : '<tr><td colspan="3" class="dashboard-empty">No paid orders today.</td></tr>';
}

function renderActivity(pending, unread) {
  const body = document.getElementById("owner-activity-list");
  if (!body) return;
  const items = [
    ...pending.map((item) => ({
      title:
        `${item.fname || ""} ${item.lname || ""}`.trim() ||
        item.email ||
        "Employee",
      detail:
        item.status === "time_out_pending"
          ? "Time-out request awaiting manager approval"
          : "Time-in request awaiting manager approval",
      icon: "schedule",
    })),
    ...unread.map((item) => ({
      title: item.title || "Manager notification",
      detail: item.message || item.type || "Unread manager alert",
      icon: "notifications",
    })),
    ...state.attendance
      .filter((item) => {
        const attendanceDate =
          item.attendanceDate ||
          (asDate(item.clockedInAt) ? dateKey(asDate(item.clockedInAt)) : "");
        return (
          attendanceDate === dateKey(new Date()) &&
          ["active", "time_out_pending"].includes(item.status) &&
          !item.clockedOutAt
        );
      })
      .map((item) => ({
        title:
          `${item.fname || ""} ${item.lname || ""}`.trim() ||
          item.email ||
          "Employee",
        detail:
          item.status === "time_out_pending"
            ? "Timed in · time-out pending approval"
            : "Currently timed in",
        icon: "check_circle",
      })),
  ].slice(0, 8);
  body.innerHTML = items.length
    ? items
        .map(
          (item) =>
            `<div class="dashboard-queue-item owner-activity-item"><i class="material-icons">${item.icon}</i><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.detail)}</small></span></div>`,
        )
        .join("")
    : '<p class="dashboard-empty">No pending requests or manager alerts.</p>';
}

function renderStock(items) {
  const body = document.getElementById("owner-stock-list");
  if (!body) return;
  const unique = [
    ...new Map(
      items.map((item) => [
        item.product_id || item.product_name || item.name,
        item,
      ]),
    ).values(),
  ].slice(0, 6);
  body.innerHTML = unique.length
    ? unique
        .map((item) => {
          const quantity = Number(item.stock_quantity) || 0;
          return `<div class="dashboard-stock-item"><span><strong>${escapeHtml(item.product_name || item.name || "Unnamed item")}</strong><small>${escapeHtml(item.category || item.unit_type || "Inventory")}</small></span><b class="${quantity <= 0 ? "stock-out" : "stock-low"}">${quantity <= 0 ? "Out of stock" : `${escapeHtml(quantity)} ${escapeHtml(item.unit_type || "units")}`}</b></div>`;
        })
        .join("")
    : '<p class="dashboard-empty">No low or out-of-stock items.</p>';
}

function renderExpenses() {
  const body = document.getElementById("owner-recent-expenses");
  if (!body) return;
  const recent = [...state.expenses]
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
    .slice(0, 5);
  body.innerHTML = recent.length
    ? recent
        .map(
          (item) =>
            `<tr><td>${escapeHtml(item.description || "Expense")}</td><td>${escapeHtml(item.category || "—")}</td><td>${money(item.amount)}</td><td>${escapeHtml(item.date || "—")}</td></tr>`,
        )
        .join("")
    : '<tr><td colspan="4" class="dashboard-empty">No expense records yet.</td></tr>';
}

function drawChart() {
  const canvas = document.getElementById("owner-income-chart");
  if (!canvas) return;
  const width = Math.max(300, canvas.getBoundingClientRect().width);
  const height = 270;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (6 - i));
    return {
      key: dateKey(date),
      label: date.toLocaleDateString("en-PH", { weekday: "short" }),
    };
  });
  const series = [
    {
      name: "Sales",
      color: "#2563eb",
      values: days.map(({ key }) =>
        state.orders
          .filter(
            (o) =>
              o.status === "paid" &&
              asDate(o.created_at) &&
              dateKey(asDate(o.created_at)) === key,
          )
          .reduce((sum, o) => sum + total(o), 0),
      ),
    },
    {
      name: "Expenses",
      color: "#f59e0b",
      values: days.map(({ key }) =>
        state.expenses
          .filter(
            (e) =>
              e.date === key &&
              String(e.status || "").toLowerCase() !== "rejected",
          )
          .reduce((sum, e) => sum + (Number(e.amount) || 0), 0),
      ),
    },
  ];
  const max = Math.max(1, ...series.flatMap((item) => item.values));
  const left = 54,
    right = 16,
    top = 18,
    bottom = 36;
  const chartWidth = width - left - right,
    chartHeight = height - top - bottom;
  const dark = document.documentElement.classList.contains("dark");
  ctx.clearRect(0, 0, width, height);
  ctx.font = "12px system-ui, sans-serif";
  ctx.textBaseline = "middle";
  for (let tick = 0; tick <= 4; tick += 1) {
    const y = top + (chartHeight * tick) / 4;
    const amount = (max * (4 - tick)) / 4;
    ctx.strokeStyle = dark ? "#334155" : "#e5e7eb";
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(width - right, y);
    ctx.stroke();
    ctx.fillStyle = dark ? "#cbd5e1" : "#64748b";
    ctx.textAlign = "right";
    ctx.fillText(
      amount >= 1000
        ? `₱${(amount / 1000).toFixed(0)}k`
        : `₱${Math.round(amount)}`,
      left - 8,
      y,
    );
  }
  days.forEach(({ label }, i) => {
    ctx.fillStyle = dark ? "#cbd5e1" : "#64748b";
    ctx.textAlign = "center";
    ctx.fillText(label, left + (chartWidth * i) / 6, height - 13);
  });
  series.forEach((item) => {
    ctx.strokeStyle = item.color;
    ctx.fillStyle = item.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    item.values.forEach((amount, i) => {
      const x = left + (chartWidth * i) / 6;
      const y = top + chartHeight * (1 - amount / max);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    item.values.forEach((amount, i) => {
      ctx.beginPath();
      ctx.arc(
        left + (chartWidth * i) / 6,
        top + chartHeight * (1 - amount / max),
        4,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    });
  });
  const legend = document.getElementById("owner-chart-legend");
  if (legend)
    legend.innerHTML = series
      .map(
        (item) =>
          `<span><i style="--legend-color:${item.color}"></i>${item.name}</span>`,
      )
      .join("");
}

function subscribe(name, key) {
  unsubscribers.push(
    onSnapshot(
      collection(db, name),
      (snapshot) => {
        state[key] = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        render();
      },
      (error) => {
        console.error(`Unable to load owner dashboard ${name}:`, error);
        const message = document.getElementById("owner-dashboard-error");
        if (message) {
          message.hidden = false;
          message.textContent =
            "May datos na hindi ma-load. Tingnan ang Firebase access o internet connection.";
        }
      },
    ),
  );
}

subscribe("orders", "orders");
subscribe("expenses", "expenses");
subscribe("attendance", "attendance");
subscribe("inventory", "inventory");
subscribe("managerNotifications", "alerts");
subscribe("employees", "employees");
function redrawForTheme() {
  requestAnimationFrame(drawChart);
}

window.addEventListener("resize", drawChart);
document.getElementById("theme-toggle")?.addEventListener("click", redrawForTheme);

export function stopOwnerDashboard() {
  unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
  window.removeEventListener("resize", drawChart);
  document.getElementById("theme-toggle")?.removeEventListener("click", redrawForTheme);
}

window.addEventListener("pagehide", stopOwnerDashboard, { once: true });
