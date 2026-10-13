import { db } from "/js/firebase.js";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const LIST_MODAL_ID = "owner-notifications-modal";
const DELETE_MODAL_ID = "owner-delete-notifications-modal";

let unsubscribeNotifications = null;
let notificationsById = new Map();
let selectedNotificationIds = new Set();
let pendingDeleteIds = [];
let reopenListAfterDelete = false;
let openDeleteAfterListClose = false;

// Laging kunin ang kasalukuyang Materialize instance (huwag i-cache),
// para hindi madesync kapag may ibang code na nag-init ulit ng modal.
function getListModal() {
  const element = document.getElementById(LIST_MODAL_ID);
  if (!element || typeof M === "undefined") return null;
  return M.Modal.getInstance(element) || createListModal(element);
}

function getDeleteModal() {
  const element = document.getElementById(DELETE_MODAL_ID);
  if (!element || typeof M === "undefined") return null;
  return M.Modal.getInstance(element) || createDeleteModal(element);
}

function createListModal(element) {
  return M.Modal.init(element, {
    dismissible: true,
    onCloseEnd: () => {
      // Bubuksan ang delete modal PAGKATAPOS lang talagang magsara ang list modal.
      if (openDeleteAfterListClose) {
        openDeleteAfterListClose = false;
        getDeleteModal()?.open();
      }
    },
  });
}

function createDeleteModal(element) {
  return M.Modal.init(element, {
    dismissible: true,
    onCloseEnd: () => {
      pendingDeleteIds = [];
      if (reopenListAfterDelete) {
        reopenListAfterDelete = false;
        getListModal()?.open();
      }
    },
  });
}

function disposeModal(element) {
  if (!element || typeof M === "undefined") return;
  const instance = M.Modal.getInstance(element);
  if (!instance) return;
  try {
    if (instance.isOpen) instance.close();
    instance.destroy();
  } catch (error) {
    console.error("Unable to dispose notification modal:", error);
  }
}

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

  notificationsById = new Map(notifications.map((item) => [item.id, item]));
  const activeIds = new Set(notificationsById.keys());
  selectedNotificationIds = new Set(
    [...selectedNotificationIds].filter((id) => activeIds.has(id)),
  );

  list.innerHTML = notifications.length
    ? notifications
        .map((item) => {
          const icon =
            item.type === "expense_report"
              ? "receipt_long"
              : item.type === "time_in_request"
                ? "login"
                : item.type === "time_out_request"
                  ? "logout"
                  : "warning";
          const title =
            item.title || `Low stock: ${item.productName || "Product"}`;
          const message =
            item.message ||
            `${item.remainingStock ?? ""} ${item.unit || ""} remaining`;
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

  list
    .querySelectorAll(".manager-notification-select input")
    .forEach((input) => {
      input.onchange = () => {
        if (input.checked) selectedNotificationIds.add(input.value);
        else selectedNotificationIds.delete(input.value);
        syncSelectionControls(notifications);
      };
    });

  list
    .querySelectorAll(".manager-notification.clickable")
    .forEach((element) => {
      const open = async (event) => {
        if (event.target.closest("button, input, label, a")) return;
        const id = element.dataset.id;
        const listModal = getListModal();
        if (listModal?.isOpen) listModal.close();
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

function syncSelectionControls(notifications = []) {
  const selectAll = document.getElementById("owner-select-all-notifications");
  const count = document.getElementById("owner-selected-notification-count");
  const deleteButton = document.getElementById(
    "owner-delete-selected-notifications",
  );
  const selectedVisibleCount = notifications.filter((item) =>
    selectedNotificationIds.has(item.id),
  ).length;

  if (selectAll) {
    selectAll.checked =
      notifications.length > 0 && selectedVisibleCount === notifications.length;
    selectAll.indeterminate =
      selectedVisibleCount > 0 && selectedVisibleCount < notifications.length;
  }
  if (count) count.textContent = `${selectedNotificationIds.size} selected`;
  if (deleteButton) deleteButton.disabled = selectedNotificationIds.size === 0;
}

export function initOwnerNotifications() {
  const bell = document.getElementById("owner-notification-bell");
  const modalElement = document.getElementById(LIST_MODAL_ID);
  const deleteModalElement = document.getElementById(DELETE_MODAL_ID);
  const deleteButton = document.getElementById(
    "owner-delete-selected-notifications",
  );
  const confirmDeleteButton = document.getElementById(
    "owner-confirm-delete-notifications",
  );
  const deleteMessage = document.getElementById(
    "owner-delete-notifications-message",
  );
  if (
    !bell ||
    !modalElement ||
    !deleteModalElement ||
    !deleteButton ||
    !confirmDeleteButton ||
    !deleteMessage ||
    typeof M === "undefined"
  )
    return;

  unsubscribeNotifications?.();
  unsubscribeNotifications = null;

  // Linisin ang anumang lumang instance bago gumawa ng bago.
  disposeModal(modalElement);
  disposeModal(deleteModalElement);
  openDeleteAfterListClose = false;
  reopenListAfterDelete = false;
  pendingDeleteIds = [];

  createListModal(modalElement);
  createDeleteModal(deleteModalElement);

  bell.onclick = () => getListModal()?.open();

  const selectAll = document.getElementById("owner-select-all-notifications");
  if (selectAll) {
    selectAll.onchange = (event) => {
      const checked = event.currentTarget.checked;
      const notifications = [...notificationsById.values()];
      notifications.forEach((item) => {
        if (checked) selectedNotificationIds.add(item.id);
        else selectedNotificationIds.delete(item.id);
      });
      modalElement
        .querySelectorAll(".manager-notification-select input")
        .forEach((input) => {
          input.checked = checked;
        });
      syncSelectionControls(notifications);
    };
  }

  deleteButton.onclick = () => {
    pendingDeleteIds = [...selectedNotificationIds];
    if (!pendingDeleteIds.length) return;
    deleteMessage.textContent = `Delete ${pendingDeleteIds.length} selected notification${pendingDeleteIds.length === 1 ? "" : "s"}? This action cannot be undone.`;
    reopenListAfterDelete = true;

    const listModal = getListModal();
    if (listModal?.isOpen) {
      // Bubukas ang delete modal sa onCloseEnd ng list modal (walang setTimeout).
      openDeleteAfterListClose = true;
      listModal.close();
    } else {
      getDeleteModal()?.open();
    }
  };

  confirmDeleteButton.onclick = async () => {
    const ids = [...pendingDeleteIds];
    if (!ids.length) return;
    confirmDeleteButton.disabled = true;
    try {
      await Promise.all(
        ids.map((id) => deleteDoc(doc(db, "managerNotifications", id))),
      );
      selectedNotificationIds.clear();
      getDeleteModal()?.close();
      if (typeof M !== "undefined") {
        M.toast({ html: "Selected notifications deleted.", classes: "green" });
      }
    } catch (error) {
      console.error("Unable to delete owner notifications:", error);
      if (typeof M !== "undefined") {
        M.toast({
          html: "Unable to delete selected notifications.",
          classes: "red",
        });
      }
    } finally {
      confirmDeleteButton.disabled = false;
    }
  };

  unsubscribeNotifications = onSnapshot(
    query(collection(db, "managerNotifications"), orderBy("updatedAt", "desc")),
    (snapshot) =>
      renderNotifications(
        snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })),
      ),
    (error) => {
      console.error("Unable to load owner notifications:", error);
      const list = document.getElementById("owner-notification-list");
      if (list) {
        list.innerHTML =
          '<p class="manager-notification-empty">Unable to load notifications.</p>';
      }
    },
  );
}

export function stopOwnerNotifications() {
  unsubscribeNotifications?.();
  unsubscribeNotifications = null;
  disposeModal(document.getElementById(LIST_MODAL_ID));
  disposeModal(document.getElementById(DELETE_MODAL_ID));
  notificationsById.clear();
  selectedNotificationIds.clear();
  pendingDeleteIds = [];
  reopenListAfterDelete = false;
  openDeleteAfterListClose = false;
}

window.addEventListener("pagehide", stopOwnerNotifications, { once: true });
