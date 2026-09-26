import { db } from "/js/firebase.js";
import {
  collection,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let unsubscribeOrders = null;
let unsubscribeEmployees = null;
let unsubscribeAttendance = null;
let unsubscribeProducts = null;
let orders = [];
let employees = [];
let attendanceRecords = [];
let productOwners = new Map();

const currency = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
});

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function asDate(value) {
  if (value?.toDate) return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function getEmployeeLookup() {
  const lookup = new Map();
  employees.forEach((employee) => {
    const displayName = `${employee.data.fname || ""} ${employee.data.lname || ""}`.trim() || "Employee";
    const canonicalId = employee.data.uid || employee.id;
    const value = { id: canonicalId, displayName };
    lookup.set(canonicalId, value);
    lookup.set(employee.id, value);
  });
  return lookup;
}

function refreshEmployeeFilter() {
  const select = document.getElementById("income-employee-filter");
  if (!select) return;

  const previousValue = select.value;
  const options = new Map();
  employees.forEach((employee) => {
    const id = employee.data.uid || employee.id;
    const name = `${employee.data.fname || ""} ${employee.data.lname || ""}`.trim() || "Employee";
    options.set(id, name);
  });

  select.replaceChildren(new Option("All Employees", ""));
  [...options.entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
    .forEach(([id, name]) => select.add(new Option(name, id)));
  if (options.has(previousValue)) select.value = previousValue;
}

function getOrderEmployeeKey(order) {
  const explicitKey = order.employeeUid || order.employee || order.employeeId || order.userId;
  if (explicitKey && explicitKey !== "guest") return explicitKey;

  // Older checkout records did not save the employee UID. Infer the seller
  // only when all specifically assigned products in that cart belong to one
  // employee; shared products are intentionally ignored here.
  const assignedOwners = new Set();
  (Array.isArray(order.items) ? order.items : []).forEach((item) => {
    const productId = item.id || item.productId;
    const ownerId = productOwners.get(productId);
    if (ownerId && ownerId !== "ALL") assignedOwners.add(ownerId);
  });
  return assignedOwners.size === 1 ? [...assignedOwners][0] : "";
}

function getOrderTotal(order) {
  if (!Array.isArray(order.items)) return Number(order.total || order.total_amount || 0);
  return order.items.reduce((sum, item) => {
    const quantity = Number(item.qty ?? item.quantity) || 0;
    const price = Number(item.price ?? item.unit_price) || 0;
    return sum + quantity * price;
  }, 0);
}

function formatTime(date) {
  if (!date) return "—";
  return date.toLocaleTimeString("en-PH", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderIncome() {
  const dateFilter = document.getElementById("income-date-filter");
  const employeeFilter = document.getElementById("income-employee-filter");
  const tbody = document.getElementById("income-cart-rows");
  if (!dateFilter || !employeeFilter || !tbody) return;

  const selectedDate = dateFilter.value;
  const selectedEmployee = employeeFilter.value;
  const employeeLookup = getEmployeeLookup();
  const paidOrders = orders
    .map((order) => ({
      ...order,
      createdAt: asDate(order.created_at || order.createdAt),
      employeeKey: getOrderEmployeeKey(order),
      total: getOrderTotal(order),
    }))
    .filter((order) => String(order.status || "paid").toLowerCase() === "paid" && order.createdAt);

  // An employee's income is reportable only after their shift has been timed out.
  const completedShifts = attendanceRecords
    .map((record) => {
      const data = record.data;
      const start = asDate(data.clockedInAt);
      const end = asDate(data.clockedOutAt);
      const attendanceDate = data.attendanceDate || (start ? localDateKey(start) : "");
      const employee = employeeLookup.get(data.userId) || {
        id: data.userId || "",
        displayName: `${data.fname || ""} ${data.lname || ""}`.trim() || "Unknown Employee",
      };
      return { ...record, data, start, end, attendanceDate, employee };
    })
    .filter((shift) =>
      shift.data.status === "completed" &&
      shift.end &&
      shift.attendanceDate === selectedDate &&
      (!selectedEmployee || shift.employee.id === selectedEmployee),
    );

  const employeeTotals = new Map();
  for (const shift of completedShifts) {
    const employeeId = shift.employee.id || shift.data.userId || shift.id;
    let total = employeeTotals.get(employeeId);
    if (!total) {
      total = {
        employeeId,
        employeeName: shift.employee.displayName,
        shifts: [],
        carts: 0,
        income: 0,
      };
      employeeTotals.set(employeeId, total);
    }
    total.shifts.push(shift);

    paidOrders.forEach((order) => {
      const orderEmployeeId =
        employeeLookup.get(order.employeeKey)?.id || order.employeeKey;
      const orderDate = localDateKey(order.createdAt);
      const insideShift =
        orderDate === shift.attendanceDate ||
        (shift.start && order.createdAt >= shift.start && order.createdAt <= shift.end);
      if (
        orderEmployeeId === employeeId &&
        insideShift
      ) {
        total.carts++;
        total.income += order.total;
      }
    });
  }

  const rows = [...employeeTotals.values()].sort((a, b) =>
    a.employeeName.localeCompare(b.employeeName),
  );
  const totalIncome = rows.reduce((sum, row) => sum + row.income, 0);
  const totalCarts = rows.reduce((sum, row) => sum + row.carts, 0);

  const totalEl = document.getElementById("income-total");
  const employeeCountEl = document.getElementById("income-cart-count");
  const cartCountEl = document.getElementById("income-cart-average");
  if (totalEl) totalEl.textContent = currency.format(totalIncome);
  if (employeeCountEl) employeeCountEl.textContent = String(rows.length);
  if (cartCountEl) cartCountEl.textContent = String(totalCarts);

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="center-align">No completed time-outs found for these filters.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map((row) => {
    const shiftSummary = row.shifts
      .sort((a, b) => (a.start?.getTime() || 0) - (b.start?.getTime() || 0))
      .map((shift) => `${formatTime(shift.start)}–${formatTime(shift.end)}`)
      .join(", ");
    return `<tr>
      <td data-label="Employee">${escapeHtml(row.employeeName)}</td>
      <td data-label="Completed Shifts">${escapeHtml(shiftSummary)}</td>
      <td data-label="Paid Carts">${row.carts}</td>
      <td data-label="Total Income"><strong>${currency.format(row.income)}</strong></td>
    </tr>`;
  }).join("");
}

export function initIncomeCart() {
  cleanupIncomeCart();
  const dateFilter = document.getElementById("income-date-filter");
  const employeeFilter = document.getElementById("income-employee-filter");
  if (!dateFilter || !employeeFilter) return;

  dateFilter.value = localDateKey(new Date());
  dateFilter.onchange = renderIncome;
  employeeFilter.onchange = renderIncome;

  unsubscribeEmployees = onSnapshot(collection(db, "employees"), (snapshot) => {
    employees = snapshot.docs.map((item) => ({ id: item.id, data: item.data() }));
    refreshEmployeeFilter();
    renderIncome();
  }, (error) => console.error("Unable to load income employees:", error));

  unsubscribeOrders = onSnapshot(collection(db, "orders"), (snapshot) => {
    orders = snapshot.docs.map((item) => ({ ...item.data(), id: item.id }));
    renderIncome();
  }, (error) => console.error("Unable to load income orders:", error));

  unsubscribeAttendance = onSnapshot(collection(db, "attendance"), (snapshot) => {
    attendanceRecords = snapshot.docs.map((item) => ({ id: item.id, data: item.data() }));
    renderIncome();
  }, (error) => console.error("Unable to load income attendance:", error));

  unsubscribeProducts = onSnapshot(collection(db, "products"), (snapshot) => {
    productOwners = new Map(
      snapshot.docs.map((item) => [item.id, item.data().employeeId || ""]),
    );
    renderIncome();
  }, (error) => console.error("Unable to load income product ownership:", error));
}

export function cleanupIncomeCart() {
  unsubscribeOrders?.();
  unsubscribeEmployees?.();
  unsubscribeAttendance?.();
  unsubscribeProducts?.();
  unsubscribeOrders = null;
  unsubscribeEmployees = null;
  unsubscribeAttendance = null;
  unsubscribeProducts = null;
  const dateFilter = document.getElementById("income-date-filter");
  const employeeFilter = document.getElementById("income-employee-filter");
  if (dateFilter) dateFilter.onchange = null;
  if (employeeFilter) employeeFilter.onchange = null;
  orders = [];
  employees = [];
  attendanceRecords = [];
  productOwners = new Map();
}
