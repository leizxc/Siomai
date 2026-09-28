import { app } from "/js/firebase.js";
import { requestDeviceNotificationPermission, showDeviceNotification } from "/js/deviceNotifications.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, deleteDoc, doc, getFirestore, onSnapshot, query, serverTimestamp, updateDoc, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const db = getFirestore(app);
const auth = getAuth(app);
let unsubscribeAttendanceNotifications = null;
let attendanceNotifications = [];
let hasLoadedInitialAttendanceNotifications = false;
const selectedNotificationIds = new Set();
let pendingDeleteNotificationIds = [];

function formatDate(timestamp) {
  return timestamp?.toDate?.().toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" }) || "Just now";
}

function updateBadge(bell, badge) {
  const unreadCount = attendanceNotifications.filter((item) => !item.read).length;
  badge.textContent = unreadCount > 9 ? "9+" : String(unreadCount);
  badge.hidden = unreadCount === 0;
  bell.classList.toggle("has-notification", unreadCount > 0);
}

function renderNotifications() {
  const list = document.querySelector("#employee-notification-list");
  if (!list) return;
  const notices = [
    ...attendanceNotifications.map((item) => ({
      ...item,
      icon: item.type === "expense_report_read" ? "receipt_long" : item.type === "time_out_approved" ? "logout" : "check_circle",
    })),
  ].sort((a, b) => (b.updatedAt?.toMillis?.() || b.createdAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || a.createdAt?.toMillis?.() || 0));

  if (!notices.length) {
    list.innerHTML = '<p class="employee-notification-empty">No notifications.</p>';
    syncSelectionControls();
    return;
  }

  list.innerHTML = notices.map((item) => `
    <article class="employee-notification ${item.read ? "" : "unread"}" data-id="${item.id || ""}" data-source="${item.source}">
      <label class="employee-notification-select" aria-label="Select notification"><input type="checkbox" value="${item.id}" ${selectedNotificationIds.has(item.id) ? "checked" : ""} /><span></span></label>
      <i class="material-icons">${item.icon}</i>
      <div><strong>${item.title}</strong><p>${item.message}</p><small>${formatDate(item.updatedAt || item.createdAt)}</small></div>
      ${!item.read ? '<button type="button" class="btn-flat mark-employee-notification-read">Mark read</button>' : ""}
    </article>
  `).join("");

  list.querySelectorAll(".mark-employee-notification-read").forEach((button) => {
    button.addEventListener("click", async (event) => {
      const item = event.currentTarget.closest("[data-source='employee']");
      if (!item) return;
      await updateDoc(doc(db, "employeeNotifications", item.dataset.id), { read: true, readAt: serverTimestamp() });
    });
  });

  list.querySelectorAll(".employee-notification-select input").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selectedNotificationIds.add(checkbox.value);
      else selectedNotificationIds.delete(checkbox.value);
      syncSelectionControls();
    });
  });
  syncSelectionControls();
}

function syncSelectionControls() {
  const selectAll = document.querySelector("#employee-select-all-notifications");
  const count = document.querySelector("#employee-selected-notification-count");
  const deleteButton = document.querySelector("#delete-employee-selected-notifications");
  const markReadButton = document.querySelector("#mark-employee-selected-notifications-read");
  const visibleIds = attendanceNotifications.map((item) => item.id);
  const selectedVisibleCount = visibleIds.filter((id) => selectedNotificationIds.has(id)).length;
  if (count) count.textContent = `${selectedNotificationIds.size} selected`;
  if (selectAll) {
    selectAll.checked = visibleIds.length > 0 && selectedVisibleCount === visibleIds.length;
    selectAll.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < visibleIds.length;
  }
  if (deleteButton) deleteButton.disabled = selectedNotificationIds.size === 0;
  if (markReadButton) {
    markReadButton.disabled = !attendanceNotifications.some((item) => selectedNotificationIds.has(item.id) && !item.read);
  }
}

export async function initEmployeeNotifications() {
  const bell = document.querySelector("#employee-notification-bell");
  const badge = document.querySelector("#employee-notification-count");
  const modalElement = document.querySelector("#employee-notifications-modal");
  if (!bell || !badge || !modalElement || unsubscribeAttendanceNotifications) return;

  const deleteModalElement = document.querySelector("#delete-employee-notifications-modal");
  const confirmDeleteButton = document.querySelector("#confirm-delete-employee-notifications");
  const deleteMessage = document.querySelector("#delete-employee-notifications-message");

  const modal = M.Modal.getInstance(modalElement) || M.Modal.init(modalElement);
  const deleteModal = M.Modal.getInstance(deleteModalElement) || M.Modal.init(deleteModalElement, {
    onCloseEnd: () => { pendingDeleteNotificationIds = []; },
  });
  const closeButton = modalElement.querySelector(".modal-close");

  // Use the same instance that opened the modal. This remains reliable even
  // after the employee content section is replaced.
  if (closeButton) {
    closeButton.onclick = () => modal.close();
  }

  // Materialize normally handles its overlay click. Keep an explicit fallback
  // because this modal is preserved while the employee content DOM changes.
  if (modalElement._outsideCloseHandler) {
    document.removeEventListener(
      "pointerdown",
      modalElement._outsideCloseHandler,
      true,
    );
  }
  modalElement._outsideCloseHandler = (event) => {
    if (
      modal.isOpen &&
      !deleteModal.isOpen &&
      !modalElement.contains(event.target)
    ) {
      modal.close();
    }
  };
  document.addEventListener(
    "pointerdown",
    modalElement._outsideCloseHandler,
    true,
  );

  bell.onclick = async () => {
    const userDocId = sessionStorage.getItem("employeeUserDocId");
    const permission = await requestDeviceNotificationPermission(userDocId);
    if (permission === "denied" && typeof M !== "undefined") {
      M.toast({ html: "Allow notifications in your browser settings to receive phone alerts.", classes: "orange" });
    }
    modal.open();
  };

  const selectAllCheckbox = document.querySelector("#employee-select-all-notifications");
  if (selectAllCheckbox) selectAllCheckbox.onchange = (event) => {
    attendanceNotifications.forEach((item) => {
      if (event.currentTarget.checked) selectedNotificationIds.add(item.id);
      else selectedNotificationIds.delete(item.id);
    });
    renderNotifications();
  };
  const deleteSelectedButton = document.querySelector("#delete-employee-selected-notifications");
  if (deleteSelectedButton) deleteSelectedButton.onclick = () => {
    pendingDeleteNotificationIds = [...selectedNotificationIds];
    if (!pendingDeleteNotificationIds.length) return;
    if (deleteMessage) deleteMessage.textContent = `Delete ${pendingDeleteNotificationIds.length} selected notification${pendingDeleteNotificationIds.length === 1 ? "" : "s"}? This action cannot be undone.`;
    deleteModal.open();
  };
  const markSelectedReadButton = document.querySelector("#mark-employee-selected-notifications-read");
  if (markSelectedReadButton) markSelectedReadButton.onclick = async () => {
    const ids = attendanceNotifications
      .filter((item) => selectedNotificationIds.has(item.id) && !item.read)
      .map((item) => item.id);
    if (!ids.length) return;
    markSelectedReadButton.disabled = true;
    try {
      await Promise.all(ids.map((id) => updateDoc(doc(db, "employeeNotifications", id), {
        read: true,
        readAt: serverTimestamp(),
      })));
      selectedNotificationIds.clear();
      if (typeof M !== "undefined") M.toast({ html: `${ids.length} notification${ids.length === 1 ? "" : "s"} marked as read.`, classes: "green" });
    } catch (error) {
      console.error("Unable to mark employee notifications as read:", error);
      if (typeof M !== "undefined") M.toast({ html: "Unable to mark selected notifications as read.", classes: "red" });
    }
  };
  if (confirmDeleteButton) confirmDeleteButton.onclick = async () => {
    const ids = [...pendingDeleteNotificationIds];
    if (!ids.length) return;
    confirmDeleteButton.disabled = true;
    try {
      await Promise.all(ids.map((id) => deleteDoc(doc(db, "employeeNotifications", id))));
      ids.forEach((id) => selectedNotificationIds.delete(id));
      deleteModal.close();
      if (typeof M !== "undefined") M.toast({ html: "Selected notifications deleted.", classes: "green" });
    } catch (error) {
      console.error("Unable to delete employee notifications:", error);
      if (typeof M !== "undefined") M.toast({ html: "Unable to delete selected notifications.", classes: "red" });
    } finally {
      confirmDeleteButton.disabled = false;
    }
  };
  const user = await new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => { unsubscribe(); resolve(currentUser); });
  });
  if (!user) return;

  unsubscribeAttendanceNotifications = onSnapshot(query(collection(db, "employeeNotifications"), where("userId", "==", user.uid)), (snapshot) => {
    if (hasLoadedInitialAttendanceNotifications) {
      snapshot.docChanges()
          .filter((change) => change.type === "added" && !change.doc.data().read)
        .forEach((change) => {
          const item = change.doc.data();
          showDeviceNotification({
            title: item.title || "New notification",
            body: item.message || "You have a new system notification.",
            tag: `employee-notification-${change.doc.id}`,
            url: "/employee/siomai/userpanel.html",
          }).catch((error) => console.error("Unable to show device notification:", error));
        });
    }
    hasLoadedInitialAttendanceNotifications = true;
    attendanceNotifications = snapshot.docs.map((item) => ({ id: item.id, source: "employee", ...item.data() }));
    const activeIds = new Set(attendanceNotifications.map((item) => item.id));
    selectedNotificationIds.forEach((id) => { if (!activeIds.has(id)) selectedNotificationIds.delete(id); });
    updateBadge(bell, badge);
    renderNotifications();
  }, (error) => console.error("Unable to load employee attendance notifications:", error));
}

export function stopEmployeeNotifications() {
  unsubscribeAttendanceNotifications?.();
  unsubscribeAttendanceNotifications = null;
  attendanceNotifications = [];
  hasLoadedInitialAttendanceNotifications = false;
}
