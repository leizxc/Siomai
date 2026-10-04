import { db } from "/js/firebase.js";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  doc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let unsubscribeNotifications = null;
let modalInstance = null;

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
          return `<article class="manager-notification ${item.read ? "" : "unread"} ${page ? "clickable" : ""}" ${page ? `data-id="${escapeHtml(item.id)}" data-page="${page}" tabindex="0" role="button"` : ""}>
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

  list.querySelectorAll(".manager-notification.clickable").forEach((element) => {
    const open = async () => {
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
      open();
    });
  });
}

export function initOwnerNotifications() {
  const bell = document.getElementById("owner-notification-bell");
  const modalElement = document.getElementById("owner-notifications-modal");
  if (!bell || !modalElement || typeof M === "undefined") return;

  if (unsubscribeNotifications) unsubscribeNotifications();
  modalInstance = M.Modal.getInstance(modalElement) || M.Modal.init(modalElement);
  bell.onclick = () => modalInstance.open();
  unsubscribeNotifications = onSnapshot(
    query(collection(db, "managerNotifications"), orderBy("updatedAt", "desc")),
    (snapshot) => renderNotifications(snapshot.docs.map((entry) => ({
      id: entry.id,
      ...entry.data(),
    }))),
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
}

window.addEventListener("pagehide", stopOwnerNotifications, { once: true });
