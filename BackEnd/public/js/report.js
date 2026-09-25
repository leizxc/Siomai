import { app } from "/js/firebase.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { addDoc, collection, deleteDoc, doc, getDocs, getFirestore, onSnapshot, query, serverTimestamp, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const db = getFirestore(app);
const auth = getAuth(app);
let unsubscribeReports = null;
let currentEmployee = null;
let currentReports = [];
const selectedReportIds = new Set();
let pendingDeleteReportIds = [];

export async function initReportPage() {
  currentEmployee = await getCurrentEmployee();
  if (!currentEmployee) return;

  document.querySelector("#reportExpenseDate").value = localDate();
  document.querySelector("#expenseReportForm").onsubmit = submitExpenseReport;
  document.querySelector("#reportHistoryDateFilter").onchange = renderReportHistory;
  document.querySelector("#clearReportHistoryDate").onclick = () => {
    document.querySelector("#reportHistoryDateFilter").value = "";
    renderReportHistory();
  };
  initReportDeleteModal();

  unsubscribeReports?.();
  unsubscribeReports = onSnapshot(
    query(collection(db, "expenseReports"), where("employeeId", "==", currentEmployee.id)),
    async (snapshot) => {
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
  const button = document.querySelector("#submitExpenseReport");
  const date = document.querySelector("#reportExpenseDate").value;
  const amount = Number(document.querySelector("#reportExpenseAmount").value);
  const category = document.querySelector("#reportExpenseCategory").value.trim();
  const reference = document.querySelector("#reportExpenseReference").value.trim();
  const description = document.querySelector("#reportExpenseDescription").value.trim();

  if (!date || !category || !description || !Number.isFinite(amount) || amount <= 0) return;
  button.disabled = true;
  button.textContent = "Submitting...";

  try {
    const employeeName = `${currentEmployee.fname || ""} ${currentEmployee.lname || ""}`.trim() || "Employee";
    const report = { employeeId: currentEmployee.id, employeeUid: auth.currentUser.uid, employeeName, date, amount, category, reference, description, status: "pending", submittedAt: serverTimestamp() };
    const reportRef = await addDoc(collection(db, "expenseReports"), report);
    await addDoc(collection(db, "managerNotifications"), { type: "expense_report", reportId: reportRef.id, title: "New expense report", message: `${employeeName} submitted ₱${amount.toFixed(2)} for ${category}.`, read: false, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    event.target.reset();
    document.querySelector("#reportExpenseDate").value = localDate();
    if (typeof M !== "undefined") M.toast({ html: "Expense report submitted for manager review.", classes: "green rounded" });
  } catch (error) {
    console.error("Unable to submit expense report:", error);
    if (typeof M !== "undefined") M.toast({ html: "Unable to submit report. Please try again.", classes: "red rounded" });
  } finally {
    button.disabled = false;
    button.innerHTML = '<span class="material-icons">send</span>Confirm &amp; Submit';
  }
}

async function getCurrentEmployee() {
  const user = await new Promise((resolve) => { const unsubscribe = onAuthStateChanged(auth, (value) => { unsubscribe(); resolve(value); }); });
  if (!user) return null;
  const snapshot = await getDocs(query(collection(db, "employees"), where("uid", "==", user.uid)));
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
    return `<article class="expense-history-item"><label class="expense-report-select"><input type="checkbox" value="${escapeHtml(report.id)}" ${selectedReportIds.has(report.id) ? "checked" : ""} /><span></span></label><div class="expense-history-details"><strong>${escapeHtml(report.category)}</strong><p>${escapeHtml(report.description)}</p><small>${escapeHtml(report.date)}${report.reference ? ` · ${escapeHtml(report.reference)}` : ""}</small></div><div><b>${formatCurrency(report.amount)}</b><span class="report-status ${escapeHtml(report.status)}">${escapeHtml(statusLabel)}</span></div></article>`;
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
  if (deleteButton) deleteButton.disabled = selectedReportIds.size === 0;
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
    await deleteDoc(doc(db, "expenseReports", reportId));
    try {
      const managerNotifications = await getDocs(query(collection(db, "managerNotifications"), where("reportId", "==", reportId)));
      await Promise.all(managerNotifications.docs.map((item) => deleteDoc(doc(db, "managerNotifications", item.id))));
    } catch (notificationError) {
      console.warn("Unable to remove the related manager notification:", notificationError);
    }
  } catch (error) {
    throw error;
  }
}

function timestamp(value) { return value?.toDate ? value.toDate().getTime() : 0; }
function localDate() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`; }
function formatCurrency(value) { return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(Number(value || 0)); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]); }

export function stopReportPage() { unsubscribeReports?.(); unsubscribeReports = null; currentEmployee = null; currentReports = []; selectedReportIds.clear(); pendingDeleteReportIds = []; }
