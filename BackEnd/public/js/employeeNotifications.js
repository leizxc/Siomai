import { app } from "/js/firebase.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, doc, getDocs, getFirestore, onSnapshot, query, serverTimestamp, updateDoc, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const db = getFirestore(app);
const auth = getAuth(app);
let unsubscribeReports = null;
let unsubscribeAttendanceNotifications = null;
let expenseNotifications = [];
let attendanceNotifications = [];

function formatDate(timestamp) {
  return timestamp?.toDate?.().toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" }) || "Just now";
}

function updateBadge(bell, badge) {
  const unreadCount = expenseNotifications.length + attendanceNotifications.filter((item) => !item.read).length;
  badge.textContent = unreadCount > 9 ? "9+" : String(unreadCount);
  badge.hidden = unreadCount === 0;
  bell.classList.toggle("has-notification", unreadCount > 0);
}

function renderNotifications() {
  const list = document.querySelector("#employee-notification-list");
  if (!list) return;
  const notices = [
    ...attendanceNotifications.map((item) => ({ ...item, icon: "check_circle" })),
    ...expenseNotifications.map((item) => ({ ...item, icon: "receipt_long" })),
  ].sort((a, b) => (b.updatedAt?.toMillis?.() || b.createdAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || a.createdAt?.toMillis?.() || 0));

  if (!notices.length) {
    list.innerHTML = '<p class="employee-notification-empty">No notifications.</p>';
    return;
  }

  list.innerHTML = notices.map((item) => `
    <article class="employee-notification ${item.read ? "" : "unread"}" data-id="${item.id || ""}" data-source="${item.source}">
      <i class="material-icons">${item.icon}</i>
      <div><strong>${item.title}</strong><p>${item.message}</p><small>${formatDate(item.updatedAt || item.createdAt)}</small></div>
      ${item.source === "attendance" && !item.read ? '<button type="button" class="btn-flat mark-employee-notification-read">Mark read</button>' : ""}
    </article>
  `).join("");

  list.querySelectorAll(".mark-employee-notification-read").forEach((button) => {
    button.addEventListener("click", async (event) => {
      const item = event.currentTarget.closest("[data-source='attendance']");
      if (!item) return;
      await updateDoc(doc(db, "employeeNotifications", item.dataset.id), { read: true, readAt: serverTimestamp() });
    });
  });
}

export async function initEmployeeNotifications() {
  const bell = document.querySelector("#employee-notification-bell");
  const badge = document.querySelector("#employee-notification-count");
  const modalElement = document.querySelector("#employee-notifications-modal");
  if (!bell || !badge || !modalElement || unsubscribeReports || unsubscribeAttendanceNotifications) return;

  const modal = M.Modal.init(modalElement);
  bell.addEventListener("click", () => modal.open());
  const user = await new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => { unsubscribe(); resolve(currentUser); });
  });
  if (!user) return;

  const employeeSnapshot = await getDocs(query(collection(db, "employees"), where("uid", "==", user.uid)));
  if (employeeSnapshot.empty) return;
  const employeeId = employeeSnapshot.docs[0].id;

  unsubscribeReports = onSnapshot(query(collection(db, "expenseReports"), where("employeeId", "==", employeeId)), (snapshot) => {
    expenseNotifications = snapshot.docs.filter((item) => item.data().status === "read" && !item.data().employeeNotified).map((item) => ({ id: item.id, source: "expense", title: "Expense report reviewed", message: "Your expense report has been reviewed by the manager.", ...item.data() }));
    updateBadge(bell, badge);
    renderNotifications();
  }, (error) => console.error("Unable to load employee expense notifications:", error));

  unsubscribeAttendanceNotifications = onSnapshot(query(collection(db, "employeeNotifications"), where("userId", "==", user.uid)), (snapshot) => {
    attendanceNotifications = snapshot.docs.map((item) => ({ id: item.id, source: "attendance", ...item.data() }));
    updateBadge(bell, badge);
    renderNotifications();
  }, (error) => console.error("Unable to load employee attendance notifications:", error));
}

export function stopEmployeeNotifications() {
  unsubscribeReports?.();
  unsubscribeAttendanceNotifications?.();
  unsubscribeReports = null;
  unsubscribeAttendanceNotifications = null;
  expenseNotifications = [];
  attendanceNotifications = [];
}
