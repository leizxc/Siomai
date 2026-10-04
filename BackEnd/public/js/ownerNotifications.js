import { db } from "/js/firebase.js";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  deleteDoc,
  updateDoc,
  doc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let unsubscribeNotifications = null;
let modalInstance = null;
let deleteModalInstance = null;
let notifications = [];
const selectedNotificationIds = new Set();
let pendingDeleteNotificationIds = [];

function escapeHtml(value) {
  const element = document.createElement("span");
  element.textContent = String(value ?? "");
  return element.innerHTML;
}

function formatDate(timestamp) {
  if (!timestamp?.toDate) return "Just now";
  return timestamp.toDate().toLocaleString("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function notificationPage(item) {
  if (["time_in_request", "time_out_request"].includes(item.type)) {
    return item.accountRole === "manager"
      ? "owner-manager-attendance"
      : "owner-attendance";
  }
  if (item.type === "expense_report") return "owner-capital";
  if (item.type === "low_stock") return "owner-inventory";
  return "";
}

function renderNotifications(notifications) {
  const bell = document.getElementById("owner-notification-bell");
  const badge = document.getElementById("owner-notification-count");
  const list = document.getElementById("owner-notification-list");
  const unreadCount = notifications.filter((item) => !item.read).length;

  bell?.classList.toggle("has-notification", unreadCount > 0);
  if (badge) {
    badge.textContent = unreadCount > 9 ? "9+" : String(unreadCount);
    badge.hidden = unreadCount === 0;
  }
  if (!list) return;

  const activeIds = new Set(notifications.map((item) => item.id));
  selectedNotificationIds.forEach((id) => {
    if (!activeIds.has(id)) selectedNotificationIds.delete(id);
  });

  list.innerHTML = notifications.length
    ? notifications
        .map((item) => {
          const icon = item.type === "expense_report"
            ? "receipt_long"
            : item.type === "time_in_request"
              ? "login"
              : item.type === "time_out_request"
                ? "logout"
                : "warning";
          const title = item.title || `Low stock: ${item.productName || "Product"}`;
          const message = item.message || `${item.remainingStock ?? ""} ${item.unit || ""} remaining`;
          const page = notificationPage(item);
          return `<article class="manager-notification ${item.read ? "" : "unread"} ${page ? "clickable" : ""}" data-id="${escapeHtml(item.id)}" ${page ? `data-page="${page}" tabindex="0" role="button"` : ""}>
            <label class="manager-notification-select" aria-label="Select notification"><input type="checkbox" value="${escapeHtml(item.id)}" ${selectedNotificationIds.has(item.id) ? "checked" : ""} /><span></span></label>
            <i class="material-icons">${icon}</i>
            <div>
              <strong>${escapeHtml(title)}</strong>
              <p>${escapeHtml(message)}</p>
              <small>${formatDate(item.updatedAt || item.createdAt)}</small>
              <span class="notification-read-state ${item.read ? "is-read" : "is-unread"}">${item.read ? "Read" : "Unread"}</span>
            </div>
          </article>`;
        })
        .join("")
    : '<p class="manager-notification-empty">No notifications.</p>';

  list.querySelectorAll(".manager-notification-select input").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selectedNotificationIds.add(checkbox.value);
      else selectedNotificationIds.delete(checkbox.value);
      syncSelectionControls(notifications);
    });
  });

  list.querySelectorAll(".manager-notification.clickable").forEach((element) => {
    const open = async (event) => {
      if (event.target.closest("button, input, label, a")) return;
      const id = element.dataset.id;
      if (modalInstance?.isOpen) modalInstance.close();
      window.loadSection?.(element.dataset.page);
      try {
        await updateDoc(doc(db, "managerNotifications", id), {
          read: true,
          readAt: serverTimestamp(),
        });
      } catch (error) {
        console.error("Unable to mark owner notification as read:", error);
      }
    };
    element.addEventListener("click", open);
    element.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      open(event);
    });
  });
  syncSelectionControls(notifications);
}

function syncSelectionControls(currentNotifications = notifications) {
  const selectAll = document.getElementById("owner-select-all-notifications");
  const count = document.getElementById("owner-selected-notification-count");
  const markRead = document.getElementById("mark-owner-selected-notifications-read");
  const deleteSelected = document.getElementById("delete-owner-selected-notifications");
  const selectedCount = currentNotifications.filter((item) => selectedNotificationIds.has(item.id)).length;
  if (count) count.textContent = `${selectedCount} selected`;
  if (selectAll) {
    selectAll.checked = currentNotifications.length > 0 && selectedCount === currentNotifications.length;
    selectAll.indeterminate = selectedCount > 0 && selectedCount < currentNotifications.length;
  }
  if (markRead) markRead.disabled = !currentNotifications.some((item) => selectedNotificationIds.has(item.id) && !item.read);
  if (deleteSelected) deleteSelected.disabled = selectedCount === 0;
}

function showToast(message, classes) {
  if (typeof M !== "undefined") M.toast({ html: message, classes });
}

export function initOwnerNotifications() {
  const bell = document.getElementById("owner-notification-bell");
  const modalElement = document.getElementById("owner-notifications-modal");
  const deleteModalElement = document.getElementById("delete-owner-notifications-modal");
  const confirmDeleteButton = document.getElementById("confirm-delete-owner-notifications");
  const deleteMessage = document.getElementById("delete-owner-notifications-message");
  if (!bell || !modalElement || !deleteModalElement || !confirmDeleteButton || !deleteMessage || typeof M === "undefined") return;

  if (unsubscribeNotifications) unsubscribeNotifications();
  modalInstance = M.Modal.getInstance(modalElement) || M.Modal.init(modalElement);
  deleteModalInstance = M.Modal.getInstance(deleteModalElement) || M.Modal.init(deleteModalElement, {
    onCloseEnd: () => { pendingDeleteNotificationIds = []; },
  });
  bell.onclick = () => modalInstance.open();
  document.getElementById("owner-select-all-notifications")?.addEventListener("change", (event) => {
    notifications.forEach((item) => {
      if (event.currentTarget.checked) selectedNotificationIds.add(item.id);
      else selectedNotificationIds.delete(item.id);
    });
    renderNotifications(notifications);
  });
  document.getElementById("mark-owner-selected-notifications-read")?.addEventListener("click", async () => {
    const ids = notifications.filter((item) => selectedNotificationIds.has(item.id) && !item.read).map((item) => item.id);
    if (!ids.length) return;
    try {
      await Promise.all(ids.map((id) => updateDoc(doc(db, "managerNotifications", id), {
        read: true,
        readAt: serverTimestamp(),
      })));
      selectedNotificationIds.clear();
      showToast(`${ids.length} notification${ids.length === 1 ? "" : "s"} marked as read.`, "green");
    } catch (error) {
      console.error("Unable to mark owner notifications as read:", error);
      showToast("Unable to mark selected notifications as read.", "red");
    }
  });
  document.getElementById("delete-owner-selected-notifications")?.addEventListener("click", () => {
    pendingDeleteNotificationIds = notifications.filter((item) => selectedNotificationIds.has(item.id)).map((item) => item.id);
    if (!pendingDeleteNotificationIds.length) return;
    const count = pendingDeleteNotificationIds.length;
    deleteMessage.textContent = `Delete ${count} selected notification${count === 1 ? "" : "s"}? This action cannot be undone.`;
    deleteModalInstance.open();
  });
  confirmDeleteButton.onclick = async () => {
    const ids = [...pendingDeleteNotificationIds];
    if (!ids.length) return;
    confirmDeleteButton.disabled = true;
    try {
      await Promise.all(ids.map((id) => deleteDoc(doc(db, "managerNotifications", id))));
      ids.forEach((id) => selectedNotificationIds.delete(id));
      deleteModalInstance.close();
      showToast("Selected notifications deleted.", "green");
    } catch (error) {
      console.error("Unable to delete owner notifications:", error);
      showToast("Unable to delete selected notifications.", "red");
    } finally {
      confirmDeleteButton.disabled = false;
    }
  };
  unsubscribeNotifications = onSnapshot(
    query(collection(db, "managerNotifications"), orderBy("updatedAt", "desc")),
    (snapshot) => {
      notifications = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
      renderNotifications(notifications);
    },
    (error) => {
      console.error("Unable to load owner notifications:", error);
      const list = document.getElementById("owner-notification-list");
      if (list) list.innerHTML = '<p class="manager-notification-empty">Unable to load notifications.</p>';
    },
  );
}

export function stopOwnerNotifications() {
  unsubscribeNotifications?.();
  unsubscribeNotifications = null;
  modalInstance?.destroy();
  modalInstance = null;
  deleteModalInstance?.destroy();
  deleteModalInstance = null;
  notifications = [];
  selectedNotificationIds.clear();
  pendingDeleteNotificationIds = [];
}

window.addEventListener("pagehide", stopOwnerNotifications, { once: true });
