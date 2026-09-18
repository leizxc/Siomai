import { app } from "/js/firebase.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { addDoc, collection, doc, getDocs, getFirestore, onSnapshot, query, serverTimestamp, updateDoc, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const db = getFirestore(app);
const auth = getAuth(app);
let unsubscribeReports = null;
let currentEmployee = null;

export async function initReportPage() {
  currentEmployee = await getCurrentEmployee();
  if (!currentEmployee) return;

  document.querySelector("#reportExpenseDate").value = localDate();
  document.querySelector("#expenseReportForm").onsubmit = submitExpenseReport;

  unsubscribeReports?.();
  unsubscribeReports = onSnapshot(
    query(collection(db, "expenseReports"), where("employeeId", "==", currentEmployee.id)),
    async (snapshot) => {
      const reports = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      renderReportHistory(reports);
      const newlyRead = reports.filter((report) => report.status === "read" && !report.employeeNotified);
      if (newlyRead.length) {
        await Promise.all(newlyRead.map((report) => updateDoc(doc(db, "expenseReports", report.id), { employeeNotified: true, employeeReadAt: serverTimestamp() })));
      }
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

function renderReportHistory(reports) {
  const list = document.querySelector("#expenseReportHistory");
  const pending = reports.filter((report) => report.status === "pending").length;
  const count = document.querySelector("#reportPendingCount");
  if (count) count.textContent = `${pending} pending`;
  if (!list) return;
  reports.sort((a, b) => timestamp(b.submittedAt) - timestamp(a.submittedAt));
  list.innerHTML = reports.length ? reports.slice(0, 5).map((report) => {
    const statusLabel = report.status === "read" ? "Read by manager" : report.status;
    return `<article class="expense-history-item"><div><strong>${escapeHtml(report.category)}</strong><p>${escapeHtml(report.description)}</p><small>${escapeHtml(report.date)}${report.reference ? ` · ${escapeHtml(report.reference)}` : ""}</small></div><div><b>${formatCurrency(report.amount)}</b><span class="report-status ${escapeHtml(report.status)}">${escapeHtml(statusLabel)}</span></div></article>`;
  }).join("") : '<div class="expense-history-empty">No expense reports submitted yet.</div>';
}

function timestamp(value) { return value?.toDate ? value.toDate().getTime() : 0; }
function localDate() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`; }
function formatCurrency(value) { return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(Number(value || 0)); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]); }

export function stopReportPage() { unsubscribeReports?.(); unsubscribeReports = null; currentEmployee = null; }
