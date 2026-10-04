import { db, isManagerAccount } from "/js/firebase.js";
import {
  collection,
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const currency = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
});

let employees = [];
let attendance = [];
let orders = [];
let payrollRecords = new Map();
let unsubscribers = [];
let managerAccount = false;

function asDate(value) {
  if (value?.toDate) return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

function getEmployeeName(data) {
  return `${data.fname || ""} ${data.lname || ""}`.trim() || "Employee";
}

function getOrderEmployeeId(order) {
  const id = order.employeeUid || order.employee || order.employeeId || order.userId;
  return id && id !== "guest" ? id : "";
}

function renderEmployeeOptions() {
  const select = document.getElementById("payroll-employee");
  if (!select) return;
  const previous = select.value;
  const selectedRole = document.getElementById("payroll-role")?.value || "";
  select.replaceChildren(new Option("Choose Employee", "", true, true));
  select.disabled = !selectedRole;
  employees
    .map(({ id, data }) => ({
      id: data.uid || id,
      name: getEmployeeName(data),
      role: String(data.role || "").trim().toLowerCase(),
    }))
    .filter((employee) => selectedRole && employee.role === selectedRole)
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((employee) => select.add(new Option(employee.name, employee.id)));
  if ([...select.options].some((option) => option.value === previous)) {
    select.value = previous;
  }
}

function renderRoleOptions() {
  const select = document.getElementById("payroll-role");
  if (!select) return;
  const previous = select.value;
  const roleNames = [
    ...employees.map(({ data }) => String(data.role || "").trim()).filter(Boolean),
    ...attendance.map(({ data }) => String(data.role || "").trim()).filter(Boolean),
  ];
  const roles = new Map(roleNames.map((role) => [role.toLowerCase(), role]));
  select.replaceChildren(
    new Option("Choose Role", "", true, true),
  );
  [...roles.values()]
    .filter((role) => !(managerAccount && role.toLowerCase() === "manager"))
    .sort((a, b) => a.localeCompare(b))
    .forEach((role) => {
      select.add(new Option(role, role.toLowerCase()));
    });
  if ([...select.options].some((option) => option.value === previous)) {
    select.value = previous;
  }
}

function calculateShift(shift) {
  const shiftStart = asDate(shift.data.clockedInAt);
  const shiftEnd = asDate(shift.data.clockedOutAt);
  const shiftDate = shift.data.attendanceDate || (shiftStart ? dateKey(shiftStart) : "");
  const uid = shift.data.userId || "";
  const employee = employees.find(({ id, data }) => (data.uid || id) === uid);
  const employeeData = employee?.data || {};
  const employeeName = employee ? getEmployeeName(employeeData) :
    `${shift.data.fname || ""} ${shift.data.lname || ""}`.trim() || "Unknown Employee";
  const role = String(employeeData.role || shift.data.role || "").trim();
  const roleLower = role.toLowerCase();

  const shiftOrders = orders.filter((order) => {
    if (String(order.status || "paid").toLowerCase() !== "paid") return false;
    if (getOrderEmployeeId(order) !== uid) return false;
    const orderDate = asDate(order.created_at || order.createdAt);
    if (!orderDate || dateKey(orderDate) !== shiftDate) return false;
    return !shiftStart || !shiftEnd || (orderDate >= shiftStart && orderDate <= shiftEnd) || dateKey(orderDate) === shiftDate;
  });

  let siomaiPacks = 0;
  if (roleLower.includes("siomai")) {
    shiftOrders.forEach((order) => {
      (Array.isArray(order.items) ? order.items : []).forEach((item) => {
        const unit = String(item.unit || "").toLowerCase();
        if (unit !== "pack") return;
        const quantity = Number(item.qty ?? item.quantity) || 0;
        const piecesPerPack = Number(item.pieces_per_pack) || 1;
        siomaiPacks += quantity / piecesPerPack;
      });
    });
  }

  let basePay = 0;
  if (roleLower.includes("siomai")) basePay = siomaiPacks * 130;
  else if (roleLower.includes("pares")) basePay = 600;

  return {
    ...shift,
    uid,
    employeeName,
    role: role || "Unspecified",
    shiftDate,
    shiftEnd,
    siomaiPacks,
    basePay,
    payroll: payrollRecords.get(shift.id) || null,
  };
}

function renderPayroll() {
  const tableSection = document.getElementById("payroll-table-section");
  const tableTitle = document.getElementById("payroll-table-title");
  const tableHead = document.getElementById("payroll-table-head");
  const tbody = document.getElementById("payroll-rows");
  const dateFilter = document.getElementById("payroll-date");
  const roleFilter = document.getElementById("payroll-role");
  const employeeFilter = document.getElementById("payroll-employee");
  if (!tableSection || !tableTitle || !tableHead || !tbody || !dateFilter || !roleFilter || !employeeFilter) return;

  const selectedRole = roleFilter.value;
  if (!selectedRole || !employeeFilter.value) {
    tableSection.hidden = true;
    document.getElementById("payroll-unpaid-total").textContent = currency.format(0);
    document.getElementById("payroll-paid-total").textContent = currency.format(0);
    document.getElementById("payroll-shift-count").textContent = "0";
    return;
  }
  tableSection.hidden = false;

  const rows = attendance
    .filter(({ data }) => data.status === "completed" && asDate(data.clockedOutAt))
    .map(calculateShift)
    .filter((row) => row.shiftDate === dateFilter.value)
    .filter((row) => row.role.toLowerCase() === selectedRole)
    .filter((row) => !employeeFilter.value || row.uid === employeeFilter.value)
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName));

  const selectedRoleLabel =
    [...roleFilter.options].find((option) => option.value === selectedRole)?.textContent || "Payroll";
  const showPacks = selectedRole.includes("siomai");
  tableTitle.textContent = `${selectedRoleLabel} Payroll`;
  const headers = [
    "Employee",
    "Time Out",
    ...(showPacks ? ["Packs Sold"] : []),
    selectedRole.includes("siomai") ? "Base Pay (₱130 / pack)" : selectedRole.includes("pares") ? "Base Pay (₱600 / shift)" : "Base Pay",
    "Manager Add-on",
    "Total Pay",
    "Status / Action",
  ];
  tableHead.innerHTML = `<tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr>`;

  let unpaidTotal = 0;
  let paidTotal = 0;
  rows.forEach((row) => {
    if (row.payroll) paidTotal += Number(row.payroll.totalPay) || 0;
    else unpaidTotal += row.basePay;
  });
  document.getElementById("payroll-unpaid-total").textContent = currency.format(unpaidTotal);
  document.getElementById("payroll-paid-total").textContent = currency.format(paidTotal);
  document.getElementById("payroll-shift-count").textContent = String(rows.length);

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="${headers.length}" class="center-align">No completed shifts for these filters.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map((row) => {
    const paid = row.payroll;
    const savedExtra = Number(paid?.managerExtra) || 0;
    const total = paid ? Number(paid.totalPay) || 0 : row.basePay;
    const statusAction = paid
      ? `<span class="status available">Paid ${escapeHtml(asDate(paid.paidAt)?.toLocaleDateString("en-PH") || "")}</span>`
      : `<button class="btn green pay-employee" data-shift-id="${escapeHtml(row.id)}">Pay</button>`;
    return `<tr data-shift-id="${escapeHtml(row.id)}" data-base-pay="${row.basePay}" data-paid="${paid ? "true" : "false"}">
      <td data-label="Employee">${escapeHtml(row.employeeName)}</td>
      <td data-label="Time Out">${escapeHtml(row.shiftEnd?.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" }) || "—")}</td>
      ${showPacks ? `<td data-label="Packs Sold">${row.siomaiPacks.toFixed(2)}</td>` : ""}
      <td data-label="Base Pay">${currency.format(paid ? Number(paid.basePay) || 0 : row.basePay)}</td>
      <td data-label="Manager Add-on">${paid
        ? currency.format(savedExtra)
        : `<input class="payroll-extra" type="number" min="0" step="0.01" value="0" aria-label="Manager add-on for ${escapeHtml(row.employeeName)}" />`}</td>
      <td data-label="Total Pay"><strong>${currency.format(total)}</strong></td>
      <td data-label="Status / Action">${statusAction}</td>
    </tr>`;
  }).join("");

  tbody.querySelectorAll(".pay-employee").forEach((button) => {
    button.onclick = () => payShift(button.dataset.shiftId, button);
  });
  tbody.querySelectorAll(".payroll-extra").forEach((input) => {
    input.oninput = () => {
      const rowElement = input.closest("tr");
      const basePay = Number(rowElement?.dataset.basePay) || 0;
      const extra = Math.max(0, Number(input.value) || 0);
      const totalCell = rowElement?.querySelector('[data-label="Total Pay"] strong');
      if (totalCell) totalCell.textContent = currency.format(basePay + extra);
      const due = [...tbody.querySelectorAll('tr[data-paid="false"]')].reduce((sum, row) => {
        const base = Number(row.dataset.basePay) || 0;
        const amount = Number(row.querySelector(".payroll-extra")?.value) || 0;
        return sum + base + Math.max(0, amount);
      }, 0);
      document.getElementById("payroll-unpaid-total").textContent = currency.format(due);
    };
  });
}

async function payShift(shiftId, button) {
  const row = attendance.find((item) => item.id === shiftId);
  if (!row) return;
  const tr = button.closest("tr");
  const managerExtra = Number(tr?.querySelector(".payroll-extra")?.value || 0);
  if (!Number.isFinite(managerExtra) || managerExtra < 0) {
    M.toast({ html: "Manager add-on must be zero or higher.", classes: "red rounded" });
    return;
  }

  const details = calculateShift(row);
  if (!details.shiftEnd) {
    M.toast({ html: "Payroll is available after time out is approved.", classes: "red rounded" });
    return;
  }

  button.disabled = true;
  button.textContent = "Saving...";
  const payrollRef = doc(db, "payroll", shiftId);
  try {
    await runTransaction(db, async (transaction) => {
      const existing = await transaction.get(payrollRef);
      if (existing.exists()) throw new Error("Payroll for this shift was already paid.");
      transaction.set(payrollRef, {
        attendanceId: shiftId,
        employeeId: details.uid,
        employeeName: details.employeeName,
        role: details.role,
        shiftDate: details.shiftDate,
        siomaiPacks: details.siomaiPacks,
        basePay: details.basePay,
        managerExtra,
        totalPay: details.basePay + managerExtra,
        status: "paid",
        paidAt: serverTimestamp(),
      });
    });
    M.toast({ html: `Payroll paid: ${currency.format(details.basePay + managerExtra)}`, classes: "green rounded" });
  } catch (error) {
    console.error("Unable to save payroll:", error);
    M.toast({ html: error.message || "Unable to save payroll.", classes: "red rounded" });
    button.disabled = false;
    button.textContent = "Pay";
  }
}

export async function initPayroll() {
  cleanupPayroll();
  const dateFilter = document.getElementById("payroll-date");
  const roleFilter = document.getElementById("payroll-role");
  const employeeFilter = document.getElementById("payroll-employee");
  if (!dateFilter || !roleFilter || !employeeFilter) return;

  managerAccount = await isManagerAccount();
  if (!roleFilter.isConnected) return;

  dateFilter.value = dateKey(new Date());
  dateFilter.onchange = renderPayroll;
  roleFilter.onchange = () => {
    renderEmployeeOptions();
    renderPayroll();
  };
  employeeFilter.onchange = renderPayroll;

  unsubscribers = [
    onSnapshot(collection(db, "employees"), (snapshot) => {
      employees = snapshot.docs.map((item) => ({ id: item.id, data: item.data() }));
      renderEmployeeOptions();
      renderRoleOptions();
      renderPayroll();
    }, (error) => console.error("Unable to load payroll employees:", error)),
    onSnapshot(collection(db, "attendance"), (snapshot) => {
      attendance = snapshot.docs.map((item) => ({ id: item.id, data: item.data() }));
      renderRoleOptions();
      renderPayroll();
    }, (error) => console.error("Unable to load payroll shifts:", error)),
    onSnapshot(collection(db, "orders"), (snapshot) => {
      orders = snapshot.docs.map((item) => item.data());
      renderPayroll();
    }, (error) => console.error("Unable to load payroll orders:", error)),
    onSnapshot(collection(db, "payroll"), (snapshot) => {
      payrollRecords = new Map(snapshot.docs.map((item) => [item.id, item.data()]));
      renderPayroll();
    }, (error) => console.error("Unable to load payroll payments:", error)),
  ];
}

export function cleanupPayroll() {
  unsubscribers.forEach((unsubscribe) => unsubscribe());
  unsubscribers = [];
  employees = [];
  attendance = [];
  orders = [];
  payrollRecords = new Map();
}
