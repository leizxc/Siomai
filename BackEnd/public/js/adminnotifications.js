import { db } from "/js/firebase.js";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  doc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let unsubscribeNotifications = null;

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}

function formatDate(timestamp) {
  if (!timestamp?.toDate) return "Just now";
  return timestamp.toDate().toLocaleString("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function renderNotifications(notifications) {
  const badge = document.getElementById("manager-notification-count");
  const list = document.getElementById("manager-notification-list");
  const unreadCount = notifications.filter((item) => !item.read).length;

  if (badge) {
    badge.textContent = unreadCount > 9 ? "9+" : String(unreadCount);
    badge.hidden = unreadCount === 0;
  }

  if (!list) return;
  if (!notifications.length) {
    list.innerHTML = '<p class="manager-notification-empty">No notifications.</p>';
    return;
  }

  list.innerHTML = notifications.map(({ id, ...item }) => `
    <article class="manager-notification ${item.read ? "" : "unread"}" data-id="${id}">
      <i class="material-icons">warning</i>
      <div>
        <strong>Low stock: ${escapeHtml(item.productName)}</strong>
        <p>${escapeHtml(item.remainingStock)} ${escapeHtml(item.unit)} remaining</p>
        <small>${formatDate(item.updatedAt || item.createdAt)}</small>
      </div>
      ${item.read ? "" : '<button type="button" class="btn-flat mark-notification-read">Mark read</button>'}
    </article>
  `).join("");

  list.querySelectorAll(".mark-notification-read").forEach((button) => {
    button.addEventListener("click", async (event) => {
      const notification = event.currentTarget.closest("[data-id]");
      if (!notification) return;
      try {
        await updateDoc(doc(db, "managerNotifications", notification.dataset.id), {
          read: true,
        });
      } catch (error) {
        console.error("Unable to mark notification as read:", error);
      }
    });
  });
}

export function initManagerNotifications() {
  const bell = document.getElementById("manager-notification-bell");
  const modalElement = document.getElementById("manager-notifications-modal");
  if (!bell || !modalElement || unsubscribeNotifications) return;

  const modal = M.Modal.init(modalElement);
  bell.addEventListener("click", () => modal.open());

  unsubscribeNotifications = onSnapshot(
    query(collection(db, "managerNotifications"), orderBy("updatedAt", "desc")),
    (snapshot) => renderNotifications(snapshot.docs.map((entry) => ({
      id: entry.id,
      ...entry.data(),
    }))),
    (error) => console.error("Unable to load manager notifications:", error),
  );
}
