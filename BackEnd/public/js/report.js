import { app } from "/js/firebase.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, doc, getDoc, getDocs, getFirestore, onSnapshot, query, serverTimestamp, where, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { watchActiveShift, showShiftRequired } from "/js/attendanceAccess.js";
import { EXPENSE_CATEGORIES } from "/js/expenseCategories.js?v=20261008c";

const db = getFirestore(app);
const auth = getAuth(app);
let unsubscribeReports = null;
let currentEmployee = null;
let currentReports = [];
const selectedReportIds = new Set();
let pendingDeleteReportIds = [];
let unsubscribeShift = null;
let reportShiftActive = false;
let reportButtonsObserver = null;
let reportSession = 0;

function setReportButtonsDisabled(disabled, root = document.querySelector(".expense-report-page")) {
  root?.querySelectorAll("button").forEach((button) => {
    if (button.matches("[data-go-to-attendance]")) return;
    if (disabled) {
      if (button.dataset.shiftWasDisabled === undefined) {
        button.dataset.shiftWasDisabled = String(button.disabled);
      }
      button.disabled = true;
      button.setAttribute("aria-disabled", "true");
    } else if (button.dataset.shiftWasDisabled !== undefined) {
      button.disabled = button.dataset.shiftWasDisabled === "true";
      button.removeAttribute("data-shift-was-disabled");
      if (!button.disabled) button.removeAttribute("aria-disabled");
    }
  });
}

export async function initReportPage() {
  stopReportPage();
  const token = ++reportSession;
  const page = document.querySelector(".expense-report-page");
  page?.classList.add("shift-inactive");
  setReportButtonsDisabled(true, page);
  reportButtonsObserver?.disconnect();
  if (page) {
    reportButtonsObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) setReportButtonsDisabled(!reportShiftActive, node);
      }));
    });
    reportButtonsObserver.observe(page, { childList: true, subtree: true });
  }

  currentEmployee = await getCurrentEmployee(token);
  if (token !== reportSession || !page?.isConnected) return;
  if (!currentEmployee) return;

  const form = document.querySelector("#expenseReportForm");
  setupReportCategories();
  unsubscribeShift?.();
  unsubscribeShift = watchActiveShift((shift) => {
    if (token !== reportSession || !page?.isConnected) return;
    reportShiftActive = shift.active;
    page?.classList.toggle("shift-inactive", !shift.active);
    setReportButtonsDisabled(!shift.active, page);
    syncReportSelection();
    if (form) form.inert = !shift.active;
    showShiftRequired(page, !shift.active, shift.timedOut, shift.pending);
  });

  document.querySelector("#reportExpenseDate").value = localDate();
  form.onsubmit = submitExpenseReport;
  document.querySelector("#reportHistoryDateFilter").onchange = renderReportHistory;
  document.querySelector("#clearReportHistoryDate").onclick = () => {
    document.querySelector("#reportHistoryDateFilter").value = "";
    renderReportHistory();
  };
  initReportDeleteModal();

  unsubscribeReports?.();
  unsubscribeReports = onSnapshot(
    query(collection(db, "expenseReports"), where("employeeUid", "==", auth.currentUser?.uid || "")),
    async (snapshot) => {
      if (token !== reportSession || !page?.isConnected) return;
      currentReports = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      const activeIds = new Set(currentReports.map((report) => report.id));
      selectedReportIds.forEach((id) => { if (!activeIds.has(id)) selectedReportIds.delete(id); });
      renderReportHistory();
    },
    (error) => console.error("Unable to load expense reports:", error),
  );
}

async function submitExpenseReport(event) {
  event.preventDefault();
  const token = reportSession;
  const employee = currentEmployee;
  const employeeUid = auth.currentUser?.uid;
  if (!reportShiftActive) {
    if (typeof M !== "undefined") M.toast({ html: "Timed in first before reporting expense.", classes: "red rounded" });
    return;
  }
  const button = document.querySelector("#submitExpenseReport");
  const date = document.querySelector("#reportExpenseDate").value;
  const amountValue = document.querySelector("#reportExpenseAmount").value.trim();
  const amount = amountValue ? Number(amountValue) : null;
  const selectedCategory = document.querySelector("#reportExpenseCategory").value;
  const customCategory = document.querySelector("#reportOtherCategory").value.trim();
  const category = selectedCategory === "Others" ? customCategory : selectedCategory;
  const reference = document.querySelector("#reportExpenseReference").value.trim();
  const description = document.querySelector("#reportExpenseDescription").value.trim();

  if (!category || !description || (amountValue && (!Number.isFinite(amount) || amount <= 0))) {
    if (!category && typeof M !== "undefined") M.toast({ html: "Please choose an expense category.", classes: "red rounded" });
    if (!description && typeof M !== "undefined") M.toast({ html: "Please enter an expense description.", classes: "red rounded" });
    return;
  }
  button.disabled = true;
  button.textContent = "Submitting...";

  try {
    const employeeName = `${employee?.fname || ""} ${employee?.lname || ""}`.trim() || "Employee";
    const submittedAt = serverTimestamp();
    const reportRef = doc(collection(db, "expenseReports"));
    const expenseRef = doc(collection(db, "expenses"));
    const notificationRef = doc(collection(db, "managerNotifications"));
    const report = { uid: employeeUid, employeeId: employee?.id, employeeUid, employeeName, date, amount, category, reference, description, expenseId: expenseRef.id, managerNotificationId: notificationRef.id, status: "pending", submittedAt };
    const batch = writeBatch(db);
    batch.set(reportRef, report);
    batch.set(expenseRef, {
      date,
      category,
      description,
      amount: amount ?? 0,
      status: "Paid",
      source: "employee_report",
      reportId: reportRef.id,
      uid: employeeUid || "",
      employeeId: employee?.id || "",
      employeeUid: employeeUid || "",
      employeeName,
      reference,
      submittedAt,
    });
    const notificationMessage = amount !== null ? `${employeeName} submitted an expense for PHP ${amount.toFixed(2)}${category ? ` in ${category}` : ""}.` : `${employeeName} submitted an expense report${category ? ` for ${category}` : ""}.`;
    batch.set(notificationRef, { type: "expense_report", reportId: reportRef.id, employeeUid, title: "New expense report", message: notificationMessage, read: false, createdAt: submittedAt, updatedAt: submittedAt });
    await batch.commit();
    if (token !== reportSession) return;
    event.target.reset();
    document.querySelector("#reportExpenseDate").value = localDate();
    syncReportOtherCategory();
    if (typeof M !== "undefined") M.FormSelect?.getInstance(document.querySelector("#reportExpenseCategory"))?.destroy();
    if (typeof M !== "undefined") M.FormSelect?.init(document.querySelector("#reportExpenseCategory"));
    if (typeof M !== "undefined") M.toast({ html: "Expense report submitted for manager review.", classes: "green rounded" });
  } catch (error) {
    console.error("Unable to submit expense report:", error);
    if (token === reportSession && typeof M !== "undefined") M.toast({ html: "Unable to submit report. Please try again.", classes: "red rounded" });
  } finally {
    if (token === reportSession && button?.isConnected) {
      button.disabled = false;
      button.innerHTML = '<span class="material-icons">send</span>Confirm &amp; Submit';
    }
  }
}

function setupReportCategories() {
  const select = document.querySelector("#reportExpenseCategory");
  if (!select) return;
  const previousValue = select.value;
  select.innerHTML = '<option value="" disabled>Choose category</option>';
  EXPENSE_CATEGORIES.forEach((category) => {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    select.appendChild(option);
  });
  select.value = EXPENSE_CATEGORIES.includes(previousValue) ? previousValue : "";
  select.onchange = syncReportOtherCategory;
  syncReportOtherCategory();
  if (typeof M !== "undefined" && M.FormSelect) {
    M.FormSelect.getInstance(select)?.destroy();
    M.FormSelect.init(select);
  }
}

function syncReportOtherCategory() {
  const isOthers = document.querySelector("#reportExpenseCategory")?.value === "Others";
  const field = document.querySelector("#reportOtherCategoryField");
  const input = document.querySelector("#reportOtherCategory");
  if (field) field.hidden = !isOthers;
  if (input) {
    input.required = isOthers;
    if (!isOthers) input.value = "";
  }
}

async function getCurrentEmployee(token) {
  const user = await new Promise((resolve) => { const unsubscribe = onAuthStateChanged(auth, (value) => { unsubscribe(); resolve(value); }); });
  if (token !== reportSession) return null;
  if (!user) return null;
  const snapshot = await getDocs(query(collection(db, "employees"), where("uid", "==", user.uid)));
  if (token !== reportSession) return null;
  return snapshot.empty ? null : { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
}

function renderReportHistory() {
  const reports = [...currentReports];
  const list = document.querySelector("#expenseReportHistory");
  const pending = reports.filter((report) => report.status === "pending").length;
  const count = document.querySelector("#reportPendingCount");
  if (count) count.textContent = `${pending} pending`;
  if (!list) return;
  const selectedDate = document.querySelector("#reportHistoryDateFilter")?.value || "";
  const filteredReports = getVisibleReports(reports, selectedDate);
  filteredReports.sort((a, b) => timestamp(b.submittedAt) - timestamp(a.submittedAt));
  list.innerHTML = filteredReports.length ? filteredReports.map((report) => {
    const statusLabel = report.status === "read" ? "Read by manager" : report.status;
    return `<article class="expense-history-item"><label class="expense-report-select"><input type="checkbox" value="${escapeHtml(report.id)}" ${selectedReportIds.has(report.id) ? "checked" : ""} /><span></span></label><div class="expense-history-details"><strong>${escapeHtml(report.category)}</strong><p>${escapeHtml(report.description)}</p><small>${escapeHtml(report.date)}${report.reference ? ` Â· ${escapeHtml(report.reference)}` : ""}</small></div><div><b>${formatCurrency(report.amount)}</b><span class="report-status ${escapeHtml(report.status)}">${escapeHtml(statusLabel)}</span></div></article>`;
  }).join("") : `<div class="expense-history-empty">${selectedDate ? "No expense reports found for this date." : "No expense reports submitted yet."}</div>`;

  list.querySelectorAll(".expense-report-select input").forEach((checkbox) => {
    checkbox.onchange = () => {
      if (checkbox.checked) selectedReportIds.add(checkbox.value);
      else selectedReportIds.delete(checkbox.value);
      syncReportSelection();
    };
  });
  syncReportSelection();
}

function getVisibleReports(reports = currentReports, selectedDate = document.querySelector("#reportHistoryDateFilter")?.value || "") {
  return selectedDate ? reports.filter((report) => report.date === selectedDate) : [...reports];
}

function syncReportSelection() {
  const visibleReports = getVisibleReports();
  const visibleIds = visibleReports.map((report) => report.id);
  const selectedVisible = visibleIds.filter((id) => selectedReportIds.has(id)).length;
  const selectAll = document.querySelector("#selectAllExpenseReports");
  const count = document.querySelector("#selectedExpenseReportCount");
  const deleteButton = document.querySelector("#deleteSelectedExpenseReports");
  if (selectAll) {
    selectAll.checked = visibleIds.length > 0 && selectedVisible === visibleIds.length;
    selectAll.indeterminate = selectedVisible > 0 && selectedVisible < visibleIds.length;
  }
  if (count) count.textContent = `${selectedReportIds.size} selected`;
  if (deleteButton) deleteButton.disabled = !reportShiftActive || selectedReportIds.size === 0;
}

function initReportDeleteModal() {
  const modalElement = document.querySelector("#confirmDeleteExpenseReportsModal");
  const confirmButton = document.querySelector("#confirmDeleteExpenseReports");
  const selectAll = document.querySelector("#selectAllExpenseReports");
  const deleteButton = document.querySelector("#deleteSelectedExpenseReports");
  const message = document.querySelector("#confirmDeleteExpenseReportsMessage");
  if (!modalElement || !confirmButton || !selectAll || !deleteButton) return;

  const modal = M.Modal.getInstance(modalElement) || M.Modal.init(modalElement);
  selectAll.onchange = (event) => {
    getVisibleReports().forEach((report) => {
      if (event.currentTarget.checked) selectedReportIds.add(report.id);
      else selectedReportIds.delete(report.id);
    });
    renderReportHistory();
  };
  deleteButton.onclick = () => {
    pendingDeleteReportIds = [...selectedReportIds];
    if (!pendingDeleteReportIds.length) return;
    if (message) message.textContent = `Delete ${pendingDeleteReportIds.length} selected expense report${pendingDeleteReportIds.length === 1 ? "" : "s"}? This action cannot be undone.`;
    modal.open();
  };
  confirmButton.onclick = async () => {
    const ids = [...pendingDeleteReportIds];
    if (!ids.length) return;
    confirmButton.disabled = true;
    try {
      await Promise.all(ids.map(deleteExpenseReport));
      ids.forEach((id) => selectedReportIds.delete(id));
      pendingDeleteReportIds = [];
      modal.close();
      if (typeof M !== "undefined") M.toast({ html: `${ids.length} expense report${ids.length === 1 ? "" : "s"} deleted.`, classes: "green rounded" });
    } catch (error) {
      console.error("Unable to delete selected expense reports:", error);
      if (typeof M !== "undefined") M.toast({ html: "Unable to delete selected reports.", classes: "red rounded" });
    } finally {
      confirmButton.disabled = false;
    }
  };
}

async function deleteExpenseReport(reportId) {
  try {
    const reportSnapshot = await getDoc(doc(db, "expenseReports", reportId));
    if (!reportSnapshot.exists() || reportSnapshot.data().employeeUid !== auth.currentUser?.uid) return;
    const reportToDelete = reportSnapshot.data();
    const batch = writeBatch(db);
    batch.delete(doc(db, "expenseReports", reportId));
    if (reportToDelete?.expenseId) batch.delete(doc(db, "expenses", reportToDelete.expenseId));
    if (reportToDelete?.managerNotificationId) batch.delete(doc(db, "managerNotifications", reportToDelete.managerNotificationId));
    await batch.commit();
  } catch (error) {
    throw error;
  }
}

function timestamp(value) { return value?.toDate ? value.toDate().getTime() : 0; }
function localDate() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`; }
function formatCurrency(value) { return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(Number(value || 0)); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]); }

export function stopReportPage() { reportSession += 1; unsubscribeReports?.(); unsubscribeReports = null; unsubscribeShift?.(); unsubscribeShift = null; reportButtonsObserver?.disconnect(); reportButtonsObserver = null; reportShiftActive = false; currentEmployee = null; currentReports = []; selectedReportIds.clear(); pendingDeleteReportIds = []; }
