import { app } from "/js/firebase.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection,
  doc,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const db = getFirestore(app);
const auth = getAuth(app);
let unsubscribeAttendance = null;
let attendanceRows = [];

export function initAttendanceMonitoring() {
  const tbody = document.querySelector(".monitorTable tbody");
  const dateInput = document.querySelector("#monitorDate");
  const statusFilter = document.querySelector(".statusFilter");

  if (!tbody) return;

  if (unsubscribeAttendance) unsubscribeAttendance();

  dateInput.value = toDateKey(new Date());
  dateInput.onchange = renderAttendanceRows;
  statusFilter.onchange = renderAttendanceRows;

  unsubscribeAttendance = onSnapshot(collection(db, "attendance"), (snapshot) => {
    attendanceRows = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    renderAttendanceRows();
  });
}

function renderAttendanceRows() {
  const tbody = document.querySelector(".monitorTable tbody");
  const dateInput = document.querySelector("#monitorDate");
  const statusFilter = document.querySelector(".statusFilter");
  if (!tbody || !dateInput || !statusFilter) return;

  const rows = attendanceRows
    .filter((item) => !dateInput.value || getAttendanceDate(item) === dateInput.value)
    .filter((item) => statusFilter.value === "all" || item.status === statusFilter.value)
    .sort((a, b) => getTimestamp(b.requestedAt || b.clockedInAt) - getTimestamp(a.requestedAt || a.clockedInAt));

  tbody.innerHTML = rows.length
    ? rows.map((item) => `
      <tr>
        <td data-label="ID">${escapeHtml(item.userId || "—")}</td>
        <td data-label="Name">${escapeHtml(`${item.fname || ""} ${item.lname || ""}`.trim() || "—")}</td>
        <td data-label="Email">${escapeHtml(item.email || "—")}</td>
        <td data-label="Status">${formatStatus(item.status)}</td>
        <td data-label="Time In">${formatTime(item.clockedInAt)}</td>
        <td data-label="Time Out">${formatTime(item.clockedOutAt)}</td>
        <td data-label="Notes">${getNotes(item)}</td>
        <td data-label="Action">${getAction(item)}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="8">No attendance records found.</td></tr>`;

  document.querySelectorAll(".approve-attendance").forEach((button) => {
    button.onclick = () => approveAttendance(button.dataset.id, button);
  });

  document.querySelectorAll(".time-out-attendance").forEach((button) => {
    button.onclick = () => timeOutAttendance(button.dataset.id, button);
  });
}

async function timeOutAttendance(id, button) {
  button.disabled = true;
  button.textContent = "Recording...";

  try {
    await updateDoc(doc(db, "attendance", id), {
      status: "completed",
      type: "clocked_out",
      clockedOutAt: serverTimestamp(),
    });
  } catch (error) {
    console.error("Unable to record time out:", error);
    button.disabled = false;
    button.textContent = "Time Out";
    if (typeof M !== "undefined") {
      M.toast({ html: "Unable to record time out.", classes: "red" });
    }
  }
}

function formatStatus(status) {
  if (status === "pending") return "Pending approval";
  if (status === "completed") return "Timed out";
  return "Active";
}

function getNotes(item) {
  if (item.status === "pending") return "Awaiting manager approval";
  if (item.status === "completed") return "Time out recorded";
  return "Approved";
}

function getAction(item) {
  if (item.status === "pending") {
    return `<button class="btn green approve-attendance" data-id="${item.id}">Accept</button>`;
  }
  if (item.status === "active") {
    return `<button class="btn orange time-out-attendance" data-id="${item.id}">Time Out</button>`;
  }
  return "—";
}

async function approveAttendance(id, button) {
  button.disabled = true;
  button.textContent = "Accepting...";

  try {
    const attendance = attendanceRows.find((item) => item.id === id);
    await updateDoc(doc(db, "attendance", id), {
      status: "active",
      type: "clocked_in",
      clockedInAt: serverTimestamp(),
      approvedAt: serverTimestamp(),
      approvedBy: auth.currentUser?.uid || "",
    });
    if (attendance?.userId) {
      await setDoc(doc(db, "employeeNotifications", `time-in-approved-${id}`), {
        type: "time_in_approved",
        attendanceId: id,
        userId: attendance.userId,
        title: "Time-in approved",
        message: "Your manager approved your time-in request.",
        read: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    console.error("Unable to approve attendance:", error);
    button.disabled = false;
    button.textContent = "Accept";
    if (typeof M !== "undefined") {
      M.toast({ html: "Unable to accept the time-in request.", classes: "red" });
    }
  }
}

function getTimestamp(value) {
  return value?.toDate ? value.toDate().getTime() : 0;
}

function formatTime(value) {
  if (!value?.toDate) return "—";
  return value.toDate().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

function getAttendanceDate(item) {
  if (item.attendanceDate) return item.attendanceDate;
  return item.requestedAt?.toDate ? toDateKey(item.requestedAt.toDate()) : "";
}

function toDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);
}

export function stopAttendanceMonitoring() {
  unsubscribeAttendance?.();
  unsubscribeAttendance = null;
  attendanceRows = [];
}
