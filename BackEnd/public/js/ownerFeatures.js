import { db, auth } from "/js/firebase.js";
import { API_BASE_URL } from "/js/apiConfig.js";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const state = {
  orders: [],
  expenses: [],
  inventory: [],
  products: [],
  attendance: [],
  employees: [],
  users: [],
  alerts: [],
};
const unsubscribers = [];
let root = null;
let view = "";
let filters = { date: "", status: "all" };

const money = (value) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(Number(value) || 0);
const esc = (value) => {
  const node = document.createElement("span");
  node.textContent = String(value ?? "—");
  return node.innerHTML;
};
const asDate = (value) =>
  value?.toDate ? value.toDate() : value instanceof Date ? value : null;
const dateKey = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const today = () => dateKey(new Date());
const orderDate = (order) => asDate(order.created_at || order.createdAt);
const orderTotal = (order) =>
  Number(order.total ?? order.total_amount) ||
  (Array.isArray(order.items)
    ? order.items.reduce(
        (sum, item) =>
          sum +
          (Number(item.price ?? item.unit_price) || 0) *
            (Number(item.qty ?? item.quantity) || 0),
        0,
      )
    : 0);
const orderEmployeeId = (order) =>
  String(
    order.employeeUid ||
      order.employee ||
      order.employeeId ||
      order.userId ||
      "",
  );
const employeeName = (employee) =>
  `${employee?.fname || ""} ${employee?.lname || ""}`.trim() ||
  employee?.name ||
  "Unknown employee";
const employeeFor = (id) =>
  state.employees.find(
    (employee) =>
      employee.id === id || employee.uid === id || employee.authUid === id,
  );
const statusBadge = (status) => {
  const label = String(status || "unknown").replaceAll("_", " ");
  const tone =
    /^(paid|active|available|completed|approved|in stock|registered)$/i.test(
      label,
    )
      ? "good"
      : /pending|processing|low/i.test(label)
        ? "pending"
        : /out|reject|cancel|expired/i.test(label)
          ? "bad"
          : "neutral";
  return `<span class="owner-status-badge ${tone}">${esc(label)}</span>`;
};

function shell(title, description, filtersMarkup = "", content = "") {
  if (!root) return;
  root.innerHTML = `
    ${filtersMarkup ? `<div class="owner-feature-filters">${filtersMarkup}</div>` : ""}
    ${content}
    <p class="owner-feature-error" role="status" hidden></p>
  `;
  root.querySelectorAll("[data-owner-filter]").forEach((control) => {
    control.value = filters[control.dataset.ownerFilter] || "";
    control.addEventListener("change", () => {
      filters[control.dataset.ownerFilter] = control.value;
      render();
    });
  });
}

function kpis(items) {
  return `<div class="owner-feature-kpis">${items
    .map(
      ([label, value, note, icon]) =>
        `<article class="owner-feature-kpi"><span class="owner-feature-kpi-icon"><i class="material-icons">${icon}</i></span><div><small>${label}</small><strong>${value}</strong><em>${note}</em></div></article>`,
    )
    .join("")}</div>`;
}

function tableCard(title, headers, rows, emptyMessage) {
  const body = rows.length
    ? rows.join("")
    : `<tr><td colspan="${headers.length}" class="owner-feature-empty">${emptyMessage}</td></tr>`;
  return `<section class="dashboard-panel owner-feature-table-card"><div class="panel-header"><h3>${title}</h3><span class="owner-live-indicator"><i></i>Live</span></div><div class="table-container"><table class="striped responsive-table data-table"><thead><tr>${headers.map((item) => `<th>${item}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></div></section>`;
}

function filteredOrders({ paidOnly = false } = {}) {
  return state.orders
    .map((order) => ({ ...order, _date: orderDate(order) }))
    .filter((order) => order._date)
    .filter((order) => !filters.date || dateKey(order._date) === filters.date)
    .filter(
      (order) =>
        !paidOnly || String(order.status || "paid").toLowerCase() === "paid",
    )
    .filter(
      (order) =>
        filters.status === "all" ||
        String(order.status || "paid").toLowerCase() === filters.status,
    )
    .sort((a, b) => b._date - a._date);
}

function renderSales() {
  const orders = filteredOrders({ paidOnly: true });
  const total = orders.reduce((sum, order) => sum + orderTotal(order), 0);
  const cash = orders
    .filter(
      (order) =>
        String(
          order.payment_method || order.paymentMethod || "cash",
        ).toLowerCase() === "cash",
    )
    .reduce((sum, order) => sum + orderTotal(order), 0);
  const cashless = total - cash;
  const rows = orders.map((order) => {
    const employee = employeeFor(orderEmployeeId(order));
    const items = (Array.isArray(order.items) ? order.items : [])
      .map(
        (item) =>
          `${item.name || item.product_name || "Item"} × ${Number(item.qty ?? item.quantity) || 0}`,
      )
      .join(", ");
    return `<tr><td>${esc(order._date.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" }))}</td><td>${esc(employee ? employeeName(employee) : order.employeeName || "Unassigned")}</td><td>${esc(items || "—")}</td><td>${esc(order.payment_method || order.paymentMethod || "Cash")}</td><td>${statusBadge("Paid")}</td><td><strong>${money(orderTotal(order))}</strong></td></tr>`;
  });
  shell(
    "Real Time Sales",
    "Live paid-order totals and sales activity.",
    '<label>Date<input type="date" data-owner-filter="date"></label>',
    `${kpis([
      ["PAID SALES", money(total), `${orders.length} orders`, "payments"],
      ["CASH", money(cash), "Cash payments", "payments"],
      ["CASHLESS", money(cashless), "Digital payments", "phone_android"],
    ])}${tableCard("Sales activity", ["Date & time", "Employee", "Items", "Payment", "Status", "Total"], rows, "No paid sales for this date.")}`,
  );
  if (!filters.date) filters.date = today();
}

function renderCapital() {
  const expenses = [...state.expenses]
    .filter((item) => !filters.date || item.date === filters.date)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  const total = expenses.reduce(
    (sum, item) => sum + (Number(item.amount) || 0),
    0,
  );
  const categories = new Set(
    expenses.map((item) => item.category).filter(Boolean),
  ).size;
  const rows = expenses.map(
    (item) =>
      `<tr><td>${esc(item.date)}</td><td>${esc(item.category)}</td><td>${esc(item.description)}</td><td>${statusBadge(item.status || "recorded")}</td><td><strong>${money(item.amount)}</strong></td></tr>`,
  );
  shell(
    "Capital Status Record",
    "Live expense records and capital outflow overview.",
    '<label>Date<input type="date" data-owner-filter="date"></label>',
    `${kpis([
      [
        "TOTAL RECORDED",
        money(total),
        `${expenses.length} records`,
        "account_balance_wallet",
      ],
      ["CATEGORIES", categories, "Categories in view", "category"],
      [
        "LATEST ENTRY",
        esc(expenses[0]?.date || "—"),
        "Most recent date",
        "event",
      ],
    ])}${tableCard("Capital records", ["Date", "Category", "Description", "Status", "Amount"], rows, "No capital records found.")}`,
  );
}

function renderOrders() {
  const orders = filteredOrders();
  const total = orders.reduce((sum, item) => sum + orderTotal(item), 0);
  const pending = orders.filter((item) =>
    /pending|processing/i.test(item.status || ""),
  ).length;
  const rows = orders.map((order) => {
    const employee = employeeFor(orderEmployeeId(order));
    const itemNames = (Array.isArray(order.items) ? order.items : [])
      .map(
        (item) =>
          `${item.name || item.product_name || "Item"} × ${Number(item.qty ?? item.quantity) || 0}`,
      )
      .join(", ");
    return `<tr><td>${esc(order.order_number || order.orderId || order.id)}</td><td>${esc(order._date.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" }))}</td><td>${esc(employee ? employeeName(employee) : order.employeeName || "Unassigned")}</td><td>${esc(itemNames || "—")}</td><td>${statusBadge(order.status || "paid")}</td><td>${esc(order.payment_method || order.paymentMethod || "Cash")}</td><td><strong>${money(orderTotal(order))}</strong></td></tr>`;
  });
  shell(
    "Order Status",
    "Track employee orders and payment status as updates arrive.",
    `<label>Date<input type="date" data-owner-filter="date"></label><label>Status<select data-owner-filter="status" class="browser-default"><option value="all">All statuses</option><option value="pending">Pending</option><option value="processing">Processing</option><option value="paid">Paid</option><option value="cancelled">Cancelled</option></select></label>`,
    `${kpis([
      ["ORDERS", orders.length, "Orders in view", "receipt_long"],
      ["PENDING", pending, "Awaiting completion", "pending_actions"],
      ["ORDER VALUE", money(total), "Value in view", "payments"],
    ])}${tableCard("Live order list", ["Order", "Date", "Employee", "Items", "Status", "Payment", "Total"], rows, "No orders match these filters.")}`,
  );
}

function renderEmployeeStock() {
  const rows = state.products
    .filter(
      (product) =>
        Number(
          product.pieces ??
            product.stock ??
            product.quantity ??
            product.stock_quantity ??
            product.current_stock ??
            product.current_pieces ??
            0,
        ) > 0,
    )
    .sort((a, b) =>
      String(a.employee_name || "").localeCompare(
        String(b.employee_name || ""),
      ),
    )
    .map((product) => {
      const employee = employeeFor(String(product.employeeId || ""));
      const qty = Number(
        product.pieces ??
          product.stock ??
          product.quantity ??
          product.stock_quantity ??
          product.current_stock ??
          product.current_pieces ??
          0,
      );
      return `<tr><td>${esc(employee ? employeeName(employee) : product.employee_name || "Shared stock")}</td><td>${esc(product.name || product.product_name)}</td><td>${esc(product.category || product.role)}</td><td>${esc(qty)} ${esc(product.unit || "pcs")}</td><td>${statusBadge(qty <= 5 ? "Low stock" : "In stock")}</td></tr>`;
    });
  shell(
    "Stock Status by Employee",
    "Current assigned product quantities grouped by employee.",
    "",
    `${kpis([
      [
        "ASSIGNED ITEMS",
        rows.length,
        "Active product assignments",
        "inventory",
      ],
      [
        "EMPLOYEES",
        new Set(state.products.map((item) => item.employeeId).filter(Boolean))
          .size,
        "With assigned stock",
        "groups",
      ],
      [
        "LOW STOCK",
        state.products.filter(
          (item) =>
            Number(
              item.pieces ??
                item.stock ??
                item.quantity ??
                item.stock_quantity ??
                item.current_stock ??
                item.current_pieces ??
                0,
            ) <= 5,
        ).length,
        "Five units or fewer",
        "warning",
      ],
    ])}${tableCard("Employee stock", ["Employee", "Product", "Category", "Quantity", "Status"], rows, "No assigned stock found.")}`,
  );
}

function renderInventory() {
  const items = [...state.inventory].sort((a, b) =>
    String(a.product_name || "").localeCompare(String(b.product_name || "")),
  );
  const low = items.filter(
    (item) =>
      Number(item.stock_quantity) > 0 && Number(item.stock_quantity) <= 25,
  );
  const out = items.filter((item) => Number(item.stock_quantity) <= 0);
  const rows = items.map(
    (item) =>
      `<tr><td>${esc(item.product_id || item.id)}</td><td>${esc(item.product_name || item.name)}</td><td>${esc(item.category)}</td><td>${esc(item.stock_quantity ?? 0)} ${esc(item.unit_type || "units")}</td><td>${statusBadge(Number(item.stock_quantity) <= 0 ? "Out of stock" : Number(item.stock_quantity) <= 25 ? "Low stock" : "Available")}</td><td>${esc(item.last_updated?.toDate?.().toLocaleString("en-PH") || "—")}</td></tr>`,
  );
  shell(
    "Real Time Inventory Status",
    "Live stock levels, low-stock alerts, and recent inventory updates.",
    "",
    `${kpis([
      ["PRODUCTS", items.length, "Tracked inventory items", "inventory_2"],
      ["LOW STOCK", low.length, "25 units or less", "warning"],
      ["OUT OF STOCK", out.length, "Needs restocking", "remove_shopping_cart"],
    ])}${tableCard("Inventory status", ["Product ID", "Product", "Category", "Stock", "Status", "Last updated"], rows, "No inventory records found.")}`,
  );
}

function renderPerformance() {
  const orders = filteredOrders({ paidOnly: true });
  const employees = new Map();
  orders.forEach((order) => {
    const id = orderEmployeeId(order) || "unassigned";
    const employee = employeeFor(id);
    const row = employees.get(id) || {
      name: employee
        ? employeeName(employee)
        : order.employeeName || "Unassigned",
      orders: 0,
      sales: 0,
      items: 0,
    };
    row.orders += 1;
    row.sales += orderTotal(order);
    row.items += (Array.isArray(order.items) ? order.items : []).reduce(
      (sum, item) => sum + (Number(item.qty ?? item.quantity) || 0),
      0,
    );
    employees.set(id, row);
  });
  const results = [...employees.values()].sort((a, b) => b.sales - a.sales);
  const rows = results.map(
    (item, index) =>
      `<tr><td>${index + 1}</td><td>${esc(item.name)}</td><td>${item.orders}</td><td>${item.items}</td><td><strong>${money(item.sales)}</strong></td><td>${statusBadge(item.orders ? "Active" : "No sales")}</td></tr>`,
  );
  shell(
    "Employee Performance",
    "Live paid sales and order activity by employee.",
    '<label>Date<input type="date" data-owner-filter="date"></label>',
    `${kpis([
      ["EMPLOYEES", results.length, "With paid orders", "groups"],
      ["PAID ORDERS", orders.length, "Orders in view", "receipt_long"],
      [
        "TEAM SALES",
        money(orders.reduce((sum, order) => sum + orderTotal(order), 0)),
        "Paid sales in view",
        "trending_up",
      ],
    ])}${tableCard("Performance ranking", ["Rank", "Employee", "Orders", "Items sold", "Sales", "Status"], rows, "No paid sales for this date.")}`,
  );
}

function attendanceDate(item) {
  if (item.attendanceDate) return item.attendanceDate;
  const date = asDate(item.clockedInAt || item.requestedAt);
  return date ? dateKey(date) : "";
}

function renderAttendance() {
  const isManagerAttendance = view === "owner-manager-attendance";
  const records = state.attendance
    .filter((item) => view === "owner-manager-attendance"
      ? String(item.accountRole || item.role || "employee").toLowerCase() === "manager"
      : String(item.accountRole || item.role || "employee").toLowerCase() !== "manager")
    .filter((item) => !filters.date || attendanceDate(item) === filters.date)
    .sort(
      (a, b) =>
        (asDate(b.clockedInAt)?.getTime() || 0) -
        (asDate(a.clockedInAt)?.getTime() || 0),
    );
  const active = records.filter(
    (item) =>
      ["active", "time_out_pending"].includes(item.status) &&
      !item.clockedOutAt,
  ).length;
  const pending = records.filter((item) =>
    ["pending", "time_out_pending"].includes(item.status),
  ).length;
  const rows = records.map(
    (item) =>
      `<tr><td>${esc(`${item.fname || ""} ${item.lname || ""}`.trim() || item.email)}</td><td>${esc(item.email)}</td><td>${statusBadge(item.status)}</td><td>${esc(asDate(item.clockedInAt)?.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" }) || "—")}</td><td>${esc(asDate(item.clockedOutAt)?.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" }) || "—")}</td><td>${esc(item.notes || item.note || "—")}</td></tr>`,
  );
  if (isManagerAttendance) {
    records.forEach((item, index) => {
      const action = item.status === "pending"
        ? `<button class="btn green owner-approve-manager-time-in" data-id="${esc(item.id)}">Confirm Time In</button>`
        : item.status === "time_out_pending"
          ? `<button class="btn orange owner-approve-manager-time-out" data-id="${esc(item.id)}">Confirm Time Out</button>`
          : "—";
      rows[index] = rows[index].replace(
        "</tr>",
        `<td>${action}</td></tr>`,
      );
    });
  }
  shell(
    view === "owner-manager-attendance" ? "Manager Attendance Status" : "Employee Attendance Status",
    view === "owner-manager-attendance"
      ? "Live manager time-in / time-out records and current shift status."
      : "Live employee time-in / time-out records and current shift status.",
    '<label>Date<input type="date" data-owner-filter="date"></label>',
    `${kpis([
      [view === "owner-manager-attendance" ? "MANAGERS" : "EMPLOYEES", records.length, "Attendance records", "groups"],
      ["ACTIVE", active, "Currently clocked in", "login"],
      ["PENDING", pending, isManagerAttendance ? "Awaiting owner confirmation" : "Awaiting manager review", "schedule"],
    ])}${tableCard(isManagerAttendance ? "Manager attendance requests" : "Attendance overview", ["Employee", "Email", "Status", "Time in", "Time out", "Notes", ...(isManagerAttendance ? ["Owner confirmation"] : [])], rows, "No attendance records for this date.")}`,
  );
  if (isManagerAttendance) {
    root?.querySelectorAll(".owner-approve-manager-time-in").forEach((button) => {
      button.onclick = () => confirmManagerAttendance(button.dataset.id, "time-in", button);
    });
    root?.querySelectorAll(".owner-approve-manager-time-out").forEach((button) => {
      button.onclick = () => confirmManagerAttendance(button.dataset.id, "time-out", button);
    });
  }
}

async function confirmManagerAttendance(id, action, button) {
  const record = state.attendance.find((item) => item.id === id);
  if (!record || String(record.accountRole || record.role || "").toLowerCase() !== "manager") return;
  button.disabled = true;
  button.textContent = "Confirming...";
  const isTimeIn = action === "time-in";
  try {
    await updateDoc(doc(db, "attendance", id), {
      status: isTimeIn ? "active" : "completed",
      type: isTimeIn ? "clocked_in" : "clocked_out",
      ...(isTimeIn
        ? { clockedInAt: serverTimestamp(), approvedAt: serverTimestamp(), approvedBy: "owner" }
        : { clockedOutAt: serverTimestamp(), timeOutApprovedAt: serverTimestamp(), timeOutApprovedBy: "owner" }),
    });
    await setDoc(doc(db, "employeeNotifications", `owner-${action}-approved-${id}`), {
      type: isTimeIn ? "time_in_approved" : "time_out_approved",
      attendanceId: id,
      userId: record.userId,
      title: isTimeIn ? "Time-in approved" : "Time-out approved",
      message: `The owner approved your time-${isTimeIn ? "in" : "out"} request.`,
      read: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    console.error("Unable to confirm manager attendance:", error);
    button.disabled = false;
    button.textContent = isTimeIn ? "Confirm Time In" : "Confirm Time Out";
    if (typeof M !== "undefined") M.toast({ html: "Unable to confirm this attendance request.", classes: "red rounded" });
  }
}

function renderManagers() {
  const priorForm = root?.querySelector("#owner-manager-create-form");
  const priorValues = priorForm
    ? Object.fromEntries(new FormData(priorForm).entries())
    : null;
  const employeeManagers = state.employees.filter((employee) =>
    String(employee.role || "").toLowerCase() === "manager" || employee.isManager === true,
  );
  const managerAccounts = state.users.filter(
    (account) => String(account.role || "").toLowerCase() === "manager",
  );
  const byEmail = new Map(employeeManagers.map((employee) => [String(employee.email || "").toLowerCase(), employee]));
  const managersByEmail = new Map();
  managerAccounts.forEach((account) => {
    const email = String(account.email || "").toLowerCase();
    managersByEmail.set(email || account.id, { ...byEmail.get(email), ...account });
  });
  employeeManagers.forEach((employee) => {
    const email = String(employee.email || "").toLowerCase();
    if (!managersByEmail.has(email || employee.id)) {
      managersByEmail.set(email || employee.id, employee);
    }
  });
  const managers = [...managersByEmail.values()];
  const alerts = [...state.alerts].sort((a, b) => {
    const left = asDate(a.updatedAt || a.createdAt)?.getTime() || 0;
    const right = asDate(b.updatedAt || b.createdAt)?.getTime() || 0;
    return right - left;
  });
  const managerRows = managers.map((item) => {
    const uid = item.uid || item.authUid || "";
    const actions = uid
      ? `<div class="owner-manager-actions"><button type="button" class="owner-manager-action-btn owner-manager-change-password" aria-label="Change password for ${esc(employeeName(item))}" title="Change password" data-uid="${esc(uid)}" data-name="${esc(employeeName(item))}" data-fname="${esc(item.fname || "")}" data-lname="${esc(item.lname || "")}"><i class="material-icons" aria-hidden="true">edit</i></button><button type="button" class="owner-manager-action-btn owner-manager-delete" aria-label="Delete ${esc(employeeName(item))}" title="Delete manager" data-uid="${esc(uid)}" data-email="${esc(item.email || "")}" data-name="${esc(employeeName(item))}"><i class="material-icons" aria-hidden="true">delete</i></button></div>`
      : `<span class="owner-manager-no-actions">No linked login</span>`;
    return `<tr><td>${esc(employeeName(item))}</td><td>${esc(item.email)}</td><td>${esc(item.username || "—")}</td><td>${statusBadge(item.status || "Registered")}</td><td>${actions}</td></tr>`;
  });
  const alertRows = alerts
    .slice(0, 20)
    .map(
      (item) =>
        `<tr><td>${esc(asDate(item.updatedAt || item.createdAt)?.toLocaleString("en-PH") || "—")}</td><td>${esc(item.title || item.type || "Manager update")}</td><td>${esc(item.message || "—")}</td><td>${statusBadge(item.read ? "Read" : "Unread")}</td></tr>`,
    );
  shell(
    "Manager Management",
    "Review manager accounts and their latest operational updates.",
    "",
    `${kpis([
      [
        "MANAGERS",
        managers.length,
        "Registered manager accounts",
        "manage_accounts",
      ],
      [
        "UNREAD UPDATES",
        alerts.filter((item) => !item.read).length,
        "Manager alerts",
        "notifications",
      ],
      [
        "TEAM MEMBERS",
        state.employees.length,
        "All employee records",
        "groups",
      ],
    ])}<section class="dashboard-panel owner-manager-create-card">
      <div class="panel-header"><div><h3>Create manager account</h3><p>Set up login credentials for a new manager.</p></div></div>
      <form id="owner-manager-create-form" class="owner-manager-create-form">
        <div class="owner-manager-name-row">
          <label>First name<input name="fname" type="text" autocomplete="given-name" placeholder="Enter first name" required maxlength="60"></label>
          <label>Last name<input name="lname" type="text" autocomplete="family-name" placeholder="Enter last name" required maxlength="60"></label>
        </div>
        <label>Email<input name="email" type="email" autocomplete="email" placeholder="Enter email address" required></label>
        <label>Username<input name="username" type="text" autocomplete="username" placeholder="Create a username" required minlength="5" maxlength="40"></label>
        <label>Password<div class="owner-manager-password-field"><input name="password" type="password" autocomplete="new-password" placeholder="Create a password" required minlength="6"><button class="owner-manager-password-toggle" type="button" aria-label="Show password" aria-pressed="false"><i class="material-icons" aria-hidden="true">visibility</i></button></div></label>
        <div class="owner-manager-form-actions"><button class="btn account-create-button" type="submit" aria-busy="false"><span class="account-submit-label"><i class="material-icons" aria-hidden="true">add</i>CREATE MANAGER</span><span class="account-submit-progress"><span class="account-loading-spinner" aria-hidden="true"></span>Adding...</span></button></div>
      </form>
    </section>${tableCard("Manager accounts", ["Manager", "Email", "Username", "Status", "Actions"], managerRows, "No manager accounts were found in employee records.")}${tableCard("Manager activity", ["Updated", "Type", "Details", "Status"], alertRows, "No manager updates found.")}`,
  );
  if (priorValues) {
    const nextForm = root?.querySelector("#owner-manager-create-form");
    Object.entries(priorValues).forEach(([name, value]) => {
      const field = nextForm?.elements.namedItem(name);
      if (field) field.value = value;
    });
  }
}

function render() {
  if (!root?.isConnected) return;
  switch (view) {
    case "owner-sales":
      renderSales();
      break;
    case "owner-capital":
      renderCapital();
      break;
    case "owner-orders":
      renderOrders();
      break;
    case "owner-employee-stock":
      renderEmployeeStock();
      break;
    case "owner-inventory":
      renderInventory();
      break;
    case "owner-performance":
      renderPerformance();
      break;
    case "owner-attendance":
    case "owner-manager-attendance":
      renderAttendance();
      break;
    case "owner-managers":
      renderManagers();
      break;
  }
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
        console.error(`Owner ${name} feed failed:`, error);
        const message = root?.querySelector(".owner-feature-error");
        if (message) {
          message.hidden = false;
          message.textContent =
            "Some live data could not be loaded. Check the connection or access settings.";
        }
      },
    ),
  );
}

export function cleanupOwnerFeature() {
  unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
  root = null;
}

export function initOwnerFeature(feature) {
  cleanupOwnerFeature();
  root = document.getElementById("owner-feature-root");
  view = feature;
  filters = { date: feature === "owner-capital" ? "" : today(), status: "all" };
  if (!root) return;

  root.innerHTML =
    '<div class="dashboard-panel"><p class="dashboard-empty">Loading live owner data...</p></div>';
  if (feature === "owner-managers") {
    root.addEventListener("click", (event) => {
      const toggle = event.target.closest(".owner-manager-password-toggle");
      if (!toggle) return;
      const input = toggle.closest(".owner-manager-password-field")?.querySelector("input");
      if (!input) return;
      const visible = input.type === "password";
      input.type = visible ? "text" : "password";
      toggle.setAttribute("aria-label", visible ? "Hide password" : "Show password");
      toggle.setAttribute("aria-pressed", String(visible));
      toggle.querySelector(".material-icons").textContent = visible ? "visibility_off" : "visibility";
    });
    let pendingManagerAction = null;
    const passwordModalElement = document.getElementById("owner-manager-password-modal");
    const deleteModalElement = document.getElementById("owner-manager-delete-modal");
    const passwordModal = passwordModalElement && typeof M !== "undefined" ? M.Modal.init(passwordModalElement) : null;
    const deleteModal = deleteModalElement && typeof M !== "undefined" ? M.Modal.init(deleteModalElement) : null;
    const passwordInput = document.getElementById("owner-manager-new-password");
    const firstNameInput = document.getElementById("owner-manager-edit-fname");
    const lastNameInput = document.getElementById("owner-manager-edit-lname");
    document.querySelector(".owner-manager-edit-toggle")?.addEventListener("click", (event) => {
      const toggle = event.currentTarget;
      if (!passwordInput) return;
      const visible = passwordInput.type === "password";
      passwordInput.type = visible ? "text" : "password";
      toggle.setAttribute("aria-label", visible ? "Hide password" : "Show password");
      toggle.querySelector(".material-icons").textContent = visible ? "visibility_off" : "visibility";
    });
    const submitManagerAction = async (button, passwordButton, password = "") => {
      if (!button || button.disabled) return;
      const uid = button.dataset.uid;
      if (!uid) return;
      button.disabled = true;
      try {
        await auth.authStateReady?.();
        const token = await auth.currentUser?.getIdToken();
        if (!token) throw new Error("Please sign in again and retry.");
        const response = await fetch(`${API_BASE_URL}/${passwordButton ? "updateAuthPassword" : "deleteAuthUser"}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(passwordButton ? { uid, password, fname: firstNameInput?.value.trim(), lname: lastNameInput?.value.trim() } : { uid }),
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || "Unable to update the manager account.");
        if (!passwordButton) {
          const [employees, users] = await Promise.all([
            getDocs(query(collection(db, "employees"), where("uid", "==", uid))),
            getDocs(query(collection(db, "users"), where("uid", "==", uid))),
          ]);
          await Promise.all([...employees.docs, ...users.docs].map((item) => deleteDoc(item.ref)));
        }
        if (typeof M !== "undefined") M.toast({ html: passwordButton ? "Manager details saved." : "Manager account deleted.", classes: "green rounded" });
      } catch (error) {
        console.error("Unable to manage manager account:", error);
        if (typeof M !== "undefined") M.toast({ html: error.message || "Unable to manage this manager account.", classes: "red rounded" });
      } finally {
        button.disabled = false;
      }
    };
    document.getElementById("owner-manager-password-confirm")?.addEventListener("click", async () => {
      const password = passwordInput?.value || "";
      if (!firstNameInput?.value.trim() || !lastNameInput?.value.trim()) {
        if (typeof M !== "undefined") M.toast({ html: "First and last name are required.", classes: "red rounded" });
        return;
      }
      if (password && password.length < 6) {
        if (typeof M !== "undefined") M.toast({ html: "Password must be at least 6 characters.", classes: "red rounded" });
        passwordInput?.focus();
        return;
      }
      const button = pendingManagerAction;
      if (!button) return;
      const confirmButton = document.getElementById("owner-manager-password-confirm");
      confirmButton.disabled = true;
      await submitManagerAction(button, true, password);
      confirmButton.disabled = false;
      passwordModal?.close();
      if (passwordInput) passwordInput.value = "";
    });
    document.getElementById("owner-manager-delete-confirm")?.addEventListener("click", async () => {
      const button = pendingManagerAction;
      if (!button) return;
      const confirmButton = document.getElementById("owner-manager-delete-confirm");
      confirmButton.disabled = true;
      await submitManagerAction(button, false);
      confirmButton.disabled = false;
      deleteModal?.close();
    });
    root.addEventListener("click", (event) => {
      const passwordButton = event.target.closest(".owner-manager-change-password");
      const deleteButton = event.target.closest(".owner-manager-delete");
      const button = passwordButton || deleteButton;
      if (!button) return;
      if (!button.dataset.uid || button.disabled) return;
      pendingManagerAction = button;
      if (passwordButton) {
        const message = document.getElementById("owner-manager-password-message");
        if (message) message.textContent = `Set a new password for ${button.dataset.name || "this manager"}.`;
        const firstName = document.getElementById("owner-manager-password-fname");
        const lastName = document.getElementById("owner-manager-password-lname");
        if (firstName) firstName.textContent = button.dataset.fname || "—";
        if (lastName) lastName.textContent = button.dataset.lname || "—";
        if (firstNameInput) firstNameInput.value = button.dataset.fname || "";
        if (lastNameInput) lastNameInput.value = button.dataset.lname || "";
        if (passwordInput) passwordInput.value = "";
        passwordModal?.open();
      } else {
        const message = document.getElementById("owner-manager-delete-message");
        if (message) message.textContent = `Permanently delete the manager account for ${button.dataset.name || button.dataset.email || "this manager"}? This action cannot be undone.`;
        deleteModal?.open();
      }
    });
    root.addEventListener("submit", async (event) => {
      const form = event.target.closest("#owner-manager-create-form");
      if (!form) return;
      event.preventDefault();
      const submit = form.querySelector('button[type="submit"]');
      if (submit?.disabled) return;
      const values = new FormData(form);
      if (submit) {
        submit.disabled = true;
        submit.setAttribute("aria-busy", "true");
      }
      try {
        const { addEmployee } = await import("/js/adminEmployee.js");
        const created = await addEmployee(
          String(values.get("fname") || "").trim(),
          String(values.get("lname") || "").trim(),
          String(values.get("email") || "").trim(),
          String(values.get("username") || "").trim(),
          "manager",
          String(values.get("password") || ""),
          "manager",
        );
        if (created) {
          form.reset();
          root?.querySelector("#owner-manager-create-form")?.reset();
        }
      } catch (error) {
        console.error("Unable to create manager account:", error);
        if (typeof M !== "undefined") {
          M.toast({ html: "Unable to create the manager account.", classes: "red rounded" });
        }
      } finally {
        if (submit) {
          submit.disabled = false;
          submit.setAttribute("aria-busy", "false");
        }
      }
    });
  }
  render();
  [
    ["orders", "orders"],
    ["expenses", "expenses"],
    ["inventory", "inventory"],
    ["products", "products"],
    ["attendance", "attendance"],
    ["employees", "employees"],
    ["managerNotifications", "alerts"],
  ].forEach(([name, key]) => subscribe(name, key));
  if (feature === "owner-managers") subscribe("users", "users");
}
