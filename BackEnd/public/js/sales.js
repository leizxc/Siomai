import { db } from "/js/firebase.js";
import { collection, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let unsubscribeOrders = null;
let unsubscribeEmployees = null;
let unsubscribeProducts = null;
let orders = [];
let employees = [];
let productOwners = new Map();
let currentPage = 1;
const PAGE_SIZE = 10;

const currency = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
});

function asDate(value) {
  if (value?.toDate) return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
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

function buildEmployeeLookup() {
  const lookup = new Map();
  employees.forEach(({ id, data }) => {
    const uid = data.uid || id;
    const name = `${data.fname || ""} ${data.lname || ""}`.trim() || "Employee";
    const employee = { id: uid, name };
    lookup.set(uid, employee);
    lookup.set(id, employee);
  });
  return lookup;
}

function refreshEmployeeFilter() {
  const select = document.getElementById("sales-employee-filter");
  if (!select) return;
  const previousValue = select.value;
  const options = new Map();
  employees.forEach(({ id, data }) => {
    options.set(data.uid || id, `${data.fname || ""} ${data.lname || ""}`.trim() || "Employee");
  });
  select.replaceChildren(new Option("All Employees", ""));
  [...options.entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
    .forEach(([id, name]) => select.add(new Option(name, id)));
  if (options.has(previousValue)) select.value = previousValue;
}

function getEmployeeKey(order) {
  const explicitKey = order.employeeUid || order.employee || order.employeeId || order.userId;
  if (explicitKey && explicitKey !== "guest") return explicitKey;

  const owners = new Set();
  (Array.isArray(order.items) ? order.items : []).forEach((item) => {
    const productId = item.id || item.productId;
    const ownerId = productOwners.get(productId);
    if (ownerId && ownerId !== "ALL") owners.add(ownerId);
  });
  return owners.size === 1 ? [...owners][0] : "";
}

function getOrderTotal(order) {
  if (Number.isFinite(Number(order.total))) return Number(order.total);
  if (Number.isFinite(Number(order.total_amount))) return Number(order.total_amount);
  return (Array.isArray(order.items) ? order.items : []).reduce((sum, item) => {
    const qty = Number(item.qty ?? item.quantity) || 0;
    const price = Number(item.price ?? item.unit_price) || 0;
    return sum + qty * price;
  }, 0);
}

function renderSales() {
  const tbody = document.getElementById("sales-order-rows");
  const dateFilter = document.getElementById("sales-date-filter");
  const employeeFilter = document.getElementById("sales-employee-filter");
  const paymentFilter = document.getElementById("sales-payment-filter");
  if (!tbody || !dateFilter || !employeeFilter || !paymentFilter) return;

  const employeeLookup = buildEmployeeLookup();
  const selectedDate = dateFilter.value;
  const selectedEmployee = employeeFilter.value;
  const selectedPayment = paymentFilter.value;
  const isCashFilter = selectedPayment === "cash";
  const visibleColumnCount = isCashFilter ? 8 : 7;
  const referenceHeader = document.getElementById("sales-reference-header");
  const cashHeader = document.getElementById("sales-cash-header");
  const changeHeader = document.getElementById("sales-change-header");
  if (referenceHeader) referenceHeader.hidden = isCashFilter;
  if (cashHeader) cashHeader.hidden = !isCashFilter;
  if (changeHeader) changeHeader.hidden = !isCashFilter;
  const filtered = orders
    .map((order) => {
      const date = asDate(order.created_at || order.createdAt);
      const employeeKey = getEmployeeKey(order);
      const employee = employeeLookup.get(employeeKey);
      return {
        ...order,
        date,
        employeeId: employee?.id || employeeKey,
        employeeName: employee?.name || (employeeKey ? "Unknown Employee" : "Unassigned"),
        total: getOrderTotal(order),
      };
    })
    .filter((order) =>
      order.date &&
      (!selectedDate || localDateKey(order.date) === selectedDate) &&
      (!selectedEmployee || order.employeeId === selectedEmployee) &&
      (!selectedPayment || String(order.payment_method || order.paymentMethod || "cash").toLowerCase() === selectedPayment),
    )
    .sort((a, b) => b.date - a.date);

  const paidTotal = filtered.reduce((sum, order) =>
    String(order.status || "paid").toLowerCase() === "paid"
      ? sum + order.total
      : sum,
  0);
  const totalEl = document.getElementById("sales-total");
  const countEl = document.getElementById("sales-order-count");
  if (totalEl) totalEl.textContent = currency.format(paidTotal);
  if (countEl) countEl.textContent = String(filtered.length);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  currentPage = Math.min(Math.max(currentPage, 1), totalPages);
  const start = (currentPage - 1) * PAGE_SIZE;
  const visibleOrders = filtered.slice(start, start + PAGE_SIZE);
  const prevButton = document.getElementById("sales-prev");
  const nextButton = document.getElementById("sales-next");
  const pageNumber = document.getElementById("sales-page-number");
  const pageInfo = document.getElementById("sales-page-info");
  if (prevButton) {
    prevButton.disabled = currentPage <= 1;
    prevButton.onclick = () => {
      if (currentPage <= 1) return;
      currentPage--;
      renderSales();
    };
  }
  if (nextButton) {
    nextButton.disabled = currentPage >= totalPages;
    nextButton.onclick = () => {
      if (currentPage >= totalPages) return;
      currentPage++;
      renderSales();
    };
  }
  if (pageNumber) pageNumber.textContent = `Page ${currentPage} of ${totalPages}`;
  if (pageInfo) {
    pageInfo.textContent = filtered.length
      ? `Showing ${start + 1}–${Math.min(start + PAGE_SIZE, filtered.length)} of ${filtered.length} orders`
      : "Showing 0 orders";
  }

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="${visibleColumnCount}" class="center-align">No orders found for these filters.</td></tr>`;
    return;
  }

  tbody.innerHTML = visibleOrders.map((order) => {
    const items = Array.isArray(order.items) ? order.items : [];
    const itemSummary = items.length
      ? items.map((item) => `${item.name || item.product_name || "Product"} × ${Number(item.qty ?? item.quantity) || 0}`).join(", ")
      : "—";
    const status = String(order.status || "paid");
    const paymentMethod = String(order.payment_method || order.paymentMethod || "Cash");
    const isCashless = paymentMethod.toLowerCase() === "cashless";
    const paymentInfo = order.payment_info || order.paymentInfo || {};
    const referenceNo = isCashless
      ? (typeof paymentInfo === "string" ? paymentInfo : "") || order.reference_no || order.referenceNo || order.reference_number || "—"
      : "—";
    const cashReceived = !isCashless && typeof paymentInfo === "object"
      ? paymentInfo.amount_paid ?? paymentInfo.amountPaid ?? "—"
      : "—";
    const cashChange = !isCashless && typeof paymentInfo === "object"
      ? paymentInfo.change ?? "—"
      : "—";
    const orderTime = order.date.toLocaleString("en-PH", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    return `<tr>
      <td data-label="Date & Time">${escapeHtml(orderTime)}</td>
      <td data-label="Employee">${escapeHtml(order.employeeName)}</td>
      <td data-label="Items">${escapeHtml(itemSummary)}</td>
      <td data-label="Payment">${escapeHtml(paymentMethod)}</td>
      ${isCashFilter ? `
        <td data-label="Cash Received">${cashReceived === "—" ? "—" : currency.format(Number(cashReceived) || 0)}</td>
        <td data-label="Change">${cashChange === "—" ? "—" : currency.format(Number(cashChange) || 0)}</td>
      ` : `<td data-label="Reference No.">${escapeHtml(referenceNo)}</td>`}
      <td data-label="Status">${escapeHtml(status)}</td>
      <td data-label="Order Total"><strong>${currency.format(order.total)}</strong></td>
    </tr>`;
  }).join("");
}

export function initSalesPage() {
  cleanupSalesPage();
  const dateFilter = document.getElementById("sales-date-filter");
  const employeeFilter = document.getElementById("sales-employee-filter");
  const paymentFilter = document.getElementById("sales-payment-filter");
  if (!dateFilter || !employeeFilter || !paymentFilter) return;
  currentPage = 1;
  dateFilter.onchange = () => {
    currentPage = 1;
    renderSales();
  };
  employeeFilter.onchange = () => {
    currentPage = 1;
    renderSales();
  };
  paymentFilter.onchange = () => {
    currentPage = 1;
    renderSales();
  };

  unsubscribeEmployees = onSnapshot(collection(db, "employees"), (snapshot) => {
    employees = snapshot.docs.map((item) => ({ id: item.id, data: item.data() }));
    refreshEmployeeFilter();
    renderSales();
  }, (error) => console.error("Unable to load sales employees:", error));

  unsubscribeOrders = onSnapshot(collection(db, "orders"), (snapshot) => {
    orders = snapshot.docs.map((item) => ({ ...item.data(), id: item.id }));
    renderSales();
  }, (error) => console.error("Unable to load sales orders:", error));

  unsubscribeProducts = onSnapshot(collection(db, "products"), (snapshot) => {
    productOwners = new Map(
      snapshot.docs.map((item) => [item.id, item.data().employeeId || ""]),
    );
    renderSales();
  }, (error) => console.error("Unable to load sales product ownership:", error));
}

export function cleanupSalesPage() {
  unsubscribeOrders?.();
  unsubscribeEmployees?.();
  unsubscribeProducts?.();
  unsubscribeOrders = null;
  unsubscribeEmployees = null;
  unsubscribeProducts = null;
  const dateFilter = document.getElementById("sales-date-filter");
  const employeeFilter = document.getElementById("sales-employee-filter");
  const paymentFilter = document.getElementById("sales-payment-filter");
  if (dateFilter) dateFilter.onchange = null;
  if (employeeFilter) employeeFilter.onchange = null;
  if (paymentFilter) paymentFilter.onchange = null;
  const prevButton = document.getElementById("sales-prev");
  const nextButton = document.getElementById("sales-next");
  if (prevButton) prevButton.onclick = null;
  if (nextButton) nextButton.onclick = null;
  orders = [];
  employees = [];
  productOwners = new Map();
  currentPage = 1;
}
