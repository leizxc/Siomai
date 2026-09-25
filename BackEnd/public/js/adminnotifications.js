import { db } from "/js/firebase.js";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  doc,
  deleteDoc,
  serverTimestamp,
  getDoc,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  requestDeviceNotificationPermission,
  showDeviceNotification,
} from "/js/deviceNotifications.js";

let unsubscribeNotifications = null;
let selectedNotificationIds = new Set();
let notificationsById = new Map();
let pendingDeleteNotificationIds = [];
let hasLoadedInitialNotifications = false;

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
  const bell = document.getElementById("manager-notification-bell");
  const list = document.getElementById("manager-notification-list");
  const unreadCount = notifications.filter((item) => !item.read).length;

  bell?.classList.toggle("has-notification", unreadCount > 0);

  if (badge) {
    badge.textContent = unreadCount > 9 ? "9+" : String(unreadCount);
    badge.hidden = unreadCount === 0;
  }

  if (!list) return;
  const activeIds = new Set(notifications.map((item) => item.id));
  notificationsById = new Map(notifications.map((item) => [item.id, item]));
  selectedNotificationIds = new Set([...selectedNotificationIds].filter((id) => activeIds.has(id)));

  if (!notifications.length) {
    list.innerHTML = '<p class="manager-notification-empty">No notifications.</p>';
    syncSelectionControls(notifications);
    return;
  }

  list.innerHTML = notifications.map(({ id, ...item }) => `
    <article class="manager-notification ${item.read ? "" : "unread"}" data-id="${id}">
      <label class="manager-notification-select" aria-label="Select notification"><input type="checkbox" value="${id}" ${selectedNotificationIds.has(id) ? "checked" : ""} /><span></span></label>
      <i class="material-icons">${item.type === "expense_report" ? "receipt_long" : item.type === "time_in_request" ? "login" : item.type === "time_out_request" ? "logout" : "warning"}</i>
      <div>
        <strong>${escapeHtml(item.title || `Low stock: ${item.productName}`)}</strong>
        <p>${escapeHtml(item.message || `${item.remainingStock} ${item.unit} remaining`)}</p>
        <small>${formatDate(item.updatedAt || item.createdAt)}</small>
      </div>
      ${item.read ? '<span class="notification-read-state">Read</span>' : '<button type="button" class="btn-flat mark-notification-read">Mark read</button>'}
    </article>
  `).join("");

  list.querySelectorAll(".mark-notification-read").forEach((button) => {
    button.addEventListener("click", async (event) => {
      const notification = event.currentTarget.closest("[data-id]");
      if (!notification) return;
      try {
        await markNotificationRead(notification.dataset.id);
        showToast("Notification marked as read.", "green");
      } catch (error) {
        console.error("Unable to mark notification as read:", error);
      }
    });
  });

  list.querySelectorAll(".manager-notification-select input").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selectedNotificationIds.add(checkbox.value);
      else selectedNotificationIds.delete(checkbox.value);
      syncSelectionControls(notifications);
    });
  });

  syncSelectionControls(notifications);
}

function syncSelectionControls(notifications = []) {
  const count = document.getElementById("manager-selected-count");
  const selectAll = document.getElementById("manager-select-all");
  const markRead = document.getElementById("mark-manager-selected-read");
  const deleteSelected = document.getElementById("delete-manager-selected");
  const selectedCount = selectedNotificationIds.size;
  const unreadSelectedCount = [...selectedNotificationIds].filter((id) => !notificationsById.get(id)?.read).length;
  if (count) count.textContent = `${selectedCount} selected`;
  if (selectAll) {
    selectAll.checked = notifications.length > 0 && selectedCount === notifications.length;
    selectAll.indeterminate = selectedCount > 0 && selectedCount < notifications.length;
  }
  if (markRead) markRead.disabled = unreadSelectedCount === 0;
  if (deleteSelected) deleteSelected.disabled = selectedCount === 0;
}

function showToast(message, classes) {
  if (typeof M !== "undefined") M.toast({ html: message, classes });
}

async function markNotificationRead(id) {
  const notification = notificationsById.get(id);
  if (!notification || notification.read) return false;

  const updates = [
    updateDoc(doc(db, "managerNotifications", id), {
      read: true,
      readAt: serverTimestamp(),
    }),
  ];

  if (notification.type === "expense_report" && notification.reportId) {
    const reportRef = doc(db, "expenseReports", notification.reportId);
    updates.push(updateDoc(reportRef, {
      status: "read",
      reviewedAt: serverTimestamp(),
    }));
    const reportSnapshot = await getDoc(reportRef);
    const report = reportSnapshot.data();
    if (report?.employeeUid) {
      updates.push(setDoc(doc(db, "employeeNotifications", `expense-report-read-${notification.reportId}`), {
        type: "expense_report_read",
        reportId: notification.reportId,
        userId: report.employeeUid,
        title: "Expense report read",
        message: "The admin/manager has read your expense report.",
        read: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }));
    }
  }

  await Promise.all(updates);
  return true;
}

export function initManagerNotifications() {
  const bell = document.getElementById("manager-notification-bell");
  const modalElement = document.getElementById("manager-notifications-modal");
  const deleteModalElement = document.getElementById("delete-notifications-modal");
  const confirmDeleteButton = document.getElementById("confirm-delete-notifications");
  const deleteMessage = document.getElementById("delete-notifications-message");

  if (
    !bell ||
    !modalElement ||
    !deleteModalElement ||
    !confirmDeleteButton ||
    !deleteMessage ||
    unsubscribeNotifications
  ) return;

  const modal = M.Modal.getInstance(modalElement) || M.Modal.init(modalElement);
  const closeButton = modalElement.querySelector(".modal-close");
  if (closeButton) {
    closeButton.onclick = () => modal.close();
  }
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
      !deleteModal?.isOpen &&
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
  const existingDeleteModal = M.Modal.getInstance(deleteModalElement);
  if (existingDeleteModal) {
    if (existingDeleteModal.isOpen) existingDeleteModal.close();
    existingDeleteModal.destroy();
  }
  const deleteModal = M.Modal.init(deleteModalElement, {
    onCloseEnd: () => {
      pendingDeleteNotificationIds = [];
    },
  });
  bell.onclick = async () => {
    const userDocId = sessionStorage.getItem("adminUserDocId");
    const permission = await requestDeviceNotificationPermission(userDocId);
    if (permission === "denied") {
      showToast("Allow notifications in your browser settings to receive phone alerts.", "orange");
    }
    modal.open();
  };

  document.getElementById("manager-select-all")?.addEventListener("change", (event) => {
    document.querySelectorAll(".manager-notification-select input").forEach((checkbox) => {
      checkbox.checked = event.currentTarget.checked;
      if (checkbox.checked) selectedNotificationIds.add(checkbox.value);
      else selectedNotificationIds.delete(checkbox.value);
    });
    syncSelectionControls(Array.from(document.querySelectorAll(".manager-notification")));
  });

  document.getElementById("mark-manager-selected-read")?.addEventListener("click", async () => {
    const ids = [...selectedNotificationIds].filter((id) => !notificationsById.get(id)?.read);
    if (!ids.length) {
      showToast("The selected notifications are already read.", "orange");
      return;
    }
    await Promise.all(ids.map((id) => markNotificationRead(id)));
    selectedNotificationIds.clear();
    showToast(`${ids.length} notification${ids.length > 1 ? "s" : ""} marked as read.`, "green");
  });

  document.getElementById("delete-manager-selected")?.addEventListener("click", () => {
    const ids = [...selectedNotificationIds];
    if (!ids.length) return;

    pendingDeleteNotificationIds = ids;
    deleteMessage.textContent = `Delete ${ids.length} selected notification${ids.length > 1 ? "s" : ""}? This action cannot be undone.`;
    deleteModal.open();
  });

  confirmDeleteButton.addEventListener("click", async () => {
    const ids = [...pendingDeleteNotificationIds];
    if (!ids.length) return;

    confirmDeleteButton.disabled = true;
    try {
      await Promise.all(ids.map((id) => deleteDoc(doc(db, "managerNotifications", id))));
      selectedNotificationIds.clear();
      deleteModal.close();
      showToast("Selected notifications deleted.", "green");
    } catch (error) {
      console.error("Unable to delete notifications:", error);
      showToast("Unable to delete selected notifications.", "red");
    } finally {
      confirmDeleteButton.disabled = false;
    }
  });

  unsubscribeNotifications = onSnapshot(
    query(collection(db, "managerNotifications"), orderBy("updatedAt", "desc")),
    (snapshot) => {
      const notifications = snapshot.docs.map((entry) => ({
        id: entry.id,
        ...entry.data(),
      }));

      // The first snapshot contains old notifications, so do not replay them
      // as phone alerts. Only genuinely new, unread notifications alert.
      if (hasLoadedInitialNotifications) {
        snapshot.docChanges()
          .filter((change) => change.type === "added" && !change.doc.data().read)
          .forEach((change) => {
            const item = change.doc.data();
            showDeviceNotification({
              title: item.title || (item.type === "expense_report" ? "New expense report" : "Low stock alert"),
              body: item.message || `${item.productName || "A product"} is running low on stock.`,
              tag: `manager-notification-${change.doc.id}`,
              url: "/admin/adminpanel.html",
            }).catch((error) => console.error("Unable to show device notification:", error));
          });
      }
      hasLoadedInitialNotifications = true;
      renderNotifications(notifications);
    },
    (error) => console.error("Unable to load manager notifications:", error),
  );
}
