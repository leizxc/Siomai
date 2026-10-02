import { app } from "/js/firebase.js";
import {
  requestDeviceNotificationPermission,
  showDeviceNotification,
} from "/js/deviceNotifications.js";
import {
  getAuth,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection,
  deleteDoc,
  doc,
  getFirestore,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const db = getFirestore(app);
const auth = getAuth(app);
let unsubscribeAttendanceNotifications = null;
let attendanceNotifications = [];
let hasLoadedInitialAttendanceNotifications = false;
const selectedNotificationIds = new Set();
let pendingDeleteNotificationIds = [];
// tandaan kung aling bell element ang huling na-bind para malaman kung napalitan ang DOM
let boundBell = null;
// FIX 2: lock para hindi magsabay ang dalawang pagbubukas ng notification
let isOpeningNotification = false;
// FIX 1: backup na pantandaan ng huling section na na-load natin mula dito
let lastLoadedPage = null;

function formatDate(timestamp) {
  return (
    timestamp
      ?.toDate?.()
      .toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" }) ||
    "Just now"
  );
}

function escapeHtml(value) {
  const element = document.createElement("div");
  element.textContent = String(value ?? "");
  return element.innerHTML;
}

function updateBadge(bell, badge) {
  const unreadCount = attendanceNotifications.filter(
    (item) => !item.read,
  ).length;
  badge.textContent = unreadCount > 9 ? "9+" : String(unreadCount);
  badge.hidden = unreadCount === 0;
  bell.classList.toggle("has-notification", unreadCount > 0);
}

function getNotificationPage(item) {
  if (["time_in_approved", "time_out_approved"].includes(item.type)) {
    return "attendance.html";
  }
  if (item.type === "expense_report_read") return "report.html";
  return null;
}

// FIX 1: alamin kung anong section ang kasalukuyang nakabukas.
// Subukan ang mga posibleng pinagkukunan. PALITAN mo ito ng tamang gamit ng navemployee mo.
function getCurrentSection() {
  return (
    window.currentSection ||
    document.querySelector("#content")?.dataset?.section ||
    lastLoadedPage ||
    null
  );
}

// hintayin munang matapos ang close animation ng modal bago palitan ang section,
// para hindi maiwan ang .modal-overlay at ang "overflow: hidden" sa body.
function closeModalAndWait(modal, timeout = 600) {
  if (!modal?.isOpen) return Promise.resolve();
  return new Promise((resolve) => {
    let finished = false;
    const previous = modal.options.onCloseEnd;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (modal.options.onCloseEnd !== previous) {
        modal.options.onCloseEnd = previous;
      }
      resolve();
    };
    modal.options.onCloseEnd = function (...args) {
      if (typeof previous === "function") previous.apply(this, args);
      finish();
    };
    setTimeout(finish, timeout);
    modal.close();
  });
}

// FIX 3: mas matibay na safety net. Inaalis ang naiwang overlay, ibinabalik ang scroll,
// at nire-reset ang internal counter ng Materialize kapag wala nang bukas na modal.
function cleanupStuckModalOverlay() {
  if (document.querySelector(".modal.open")) return;
  document
    .querySelectorAll(".modal-overlay")
    .forEach((overlay) => overlay.remove());
  document.body.style.overflow = "";
  document.documentElement.style.overflow = "";
  if (typeof M !== "undefined" && M.Modal) M.Modal._modalsOpen = 0;
}

async function openEmployeeNotification(item) {
  const page = getNotificationPage(item);

  // FIX 1: huwag mag-loadSection kung nasa page na tayo
  if (
    page &&
    typeof window.loadSection === "function" &&
    getCurrentSection() !== page
  ) {
    await window.loadSection(page);
    lastLoadedPage = page;
  }

  if (!item.read) {
    await updateDoc(doc(db, "employeeNotifications", item.id), {
      read: true,
      readAt: serverTimestamp(),
    });
  }
}

function renderNotifications() {
  const list = document.querySelector("#employee-notification-list");
  if (!list) return;
  const notices = [
    ...attendanceNotifications.map((item) => ({
      ...item,
      icon:
        item.type === "expense_report_read"
          ? "receipt_long"
          : item.type === "low_stock_read"
            ? "warning"
            : item.type === "time_out_approved"
              ? "logout"
              : "check_circle",
    })),
  ].sort(
    (a, b) =>
      (b.updatedAt?.toMillis?.() || b.createdAt?.toMillis?.() || 0) -
      (a.updatedAt?.toMillis?.() || a.createdAt?.toMillis?.() || 0),
  );

  if (!notices.length) {
    list.innerHTML =
      '<p class="employee-notification-empty">No notifications.</p>';
    syncSelectionControls();
    return;
  }

  // i-save at ibalik ang scroll position para hindi tumalon ang list sa taas tuwing may update
  const previousScroll = list.scrollTop;

  list.innerHTML = notices
    .map(
      (item) => `
    <article class="employee-notification ${item.read ? "" : "unread"} ${getNotificationPage(item) ? "clickable" : ""}" data-id="${escapeHtml(item.id || "")}" data-type="${escapeHtml(item.type || "")}" ${getNotificationPage(item) ? 'tabindex="0" role="button"' : ""}>
      <label class="employee-notification-select" aria-label="Select notification"><input type="checkbox" value="${escapeHtml(item.id)}" ${selectedNotificationIds.has(item.id) ? "checked" : ""} /><span></span></label>
      <i class="material-icons">${item.icon}</i>
      <div>
        <strong>${escapeHtml(item.title || "Notification")}</strong>
        <p>${escapeHtml(item.message || "")}</p>
        <small>${formatDate(item.updatedAt || item.createdAt)}</small>
        <span class="notification-read-state ${item.read ? "is-read" : "is-unread"}">${item.read ? "Read" : "Unread"}</span>
      </div>
      ${!item.read ? '<button type="button" class="btn-flat mark-employee-notification-read">Mark read</button>' : ""}
    </article>
  `,
    )
    .join("");

  list.scrollTop = previousScroll;

  list
    .querySelectorAll(".employee-notification.clickable")
    .forEach((element) => {
      const open = async (event) => {
        if (event.target.closest("button, input, label, a")) return;
        // FIX 2: huwag pansinin ang click kung may nagbubukas pa
        if (isOpeningNotification) return;
        const notification = attendanceNotifications.find(
          (item) => item.id === element.dataset.id,
        );
        if (!notification || !getNotificationPage(notification)) return;

        isOpeningNotification = true;
        try {
          const modal = M.Modal.getInstance(
            document.querySelector("#employee-notifications-modal"),
          );
          const targetPage = getNotificationPage(notification);
          if (getCurrentSection() === targetPage) {
            // Nasa page na tayo: walang section swap, kaya isara agad ang modal
            // at huwag nang maghintay sa animation bago i-mark as read.
            modal?.close();
          } else {
            // Ibang page: isara muna at hintayin bago palitan ang section.
            await closeModalAndWait(modal);
            cleanupStuckModalOverlay();
          }
          await openEmployeeNotification(notification);
        } catch (error) {
          console.error("Unable to open employee notification:", error);
          if (typeof M !== "undefined")
            M.toast({
              html: "Unable to open this notification.",
              classes: "red",
            });
        } finally {
          isOpeningNotification = false;
          // bigyan ng sandali ang bagong section na mag-init ng sarili niyang modals
          setTimeout(cleanupStuckModalOverlay, 350);
          setTimeout(cleanupStuckModalOverlay, 1000);
        }
      };

      element.addEventListener("click", open);
      element.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        open(event);
      });
    });

  list
    .querySelectorAll(".mark-employee-notification-read")
    .forEach((button) => {
      button.addEventListener("click", async (event) => {
        const item = event.currentTarget.closest("[data-id]");
        if (!item) return;
        try {
          await updateDoc(doc(db, "employeeNotifications", item.dataset.id), {
            read: true,
            readAt: serverTimestamp(),
          });
        } catch (error) {
          console.error("Unable to mark employee notification as read:", error);
          if (typeof M !== "undefined")
            M.toast({
              html: "Unable to mark this notification as read.",
              classes: "red",
            });
        }
      });
    });

  list
    .querySelectorAll(".employee-notification-select input")
    .forEach((checkbox) => {
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selectedNotificationIds.add(checkbox.value);
        else selectedNotificationIds.delete(checkbox.value);
        syncSelectionControls();
      });
    });
  syncSelectionControls();
}

function syncSelectionControls() {
  const selectAll = document.querySelector(
    "#employee-select-all-notifications",
  );
  const count = document.querySelector("#employee-selected-notification-count");
  const deleteButton = document.querySelector(
    "#delete-employee-selected-notifications",
  );
  const markReadButton = document.querySelector(
    "#mark-employee-selected-notifications-read",
  );
  const visibleIds = attendanceNotifications.map((item) => item.id);
  const selectedVisibleCount = visibleIds.filter((id) =>
    selectedNotificationIds.has(id),
  ).length;
  if (count) count.textContent = `${selectedNotificationIds.size} selected`;
  if (selectAll) {
    selectAll.checked =
      visibleIds.length > 0 && selectedVisibleCount === visibleIds.length;
    selectAll.indeterminate =
      selectedVisibleCount > 0 && selectedVisibleCount < visibleIds.length;
  }
  if (deleteButton) deleteButton.disabled = selectedNotificationIds.size === 0;
  if (markReadButton) {
    markReadButton.disabled = !attendanceNotifications.some(
      (item) => selectedNotificationIds.has(item.id) && !item.read,
    );
  }
}

export async function initEmployeeNotifications() {
  const bell = document.querySelector("#employee-notification-bell");
  const badge = document.querySelector("#employee-notification-count");
  const modalElement = document.querySelector("#employee-notifications-modal");
  const deleteModalElement = document.querySelector(
    "#delete-employee-notifications-modal",
  );
  if (!bell || !badge || !modalElement || !deleteModalElement) return;

  // Kung ibang bell na ang nasa page, i-reset muna ang luma at ibalik ang lahat ng handler.
  if (unsubscribeAttendanceNotifications || boundBell) {
    if (boundBell === bell) return;
    stopEmployeeNotifications();
  }
  boundBell = bell;

  const confirmDeleteButton = document.querySelector(
    "#confirm-delete-employee-notifications",
  );
  const deleteMessage = document.querySelector(
    "#delete-employee-notifications-message",
  );

  const existingNotificationModal = M.Modal.getInstance(modalElement);
  existingNotificationModal?.destroy();
  const modal = M.Modal.init(modalElement, { dismissible: false });
  const deleteModal =
    M.Modal.getInstance(deleteModalElement) ||
    M.Modal.init(deleteModalElement, {
      onCloseEnd: () => {
        pendingDeleteNotificationIds = [];
      },
    });
  const closeButton = modalElement.querySelector(".modal-close");

  // Gamitin ang parehong instance na nagbukas ng modal.
  if (closeButton) {
    closeButton.onclick = () => modal.close();
  }

  bell.onclick = async () => {
    const userDocId = sessionStorage.getItem("employeeUserDocId");
    const permission = await requestDeviceNotificationPermission(userDocId);
    if (permission === "denied" && typeof M !== "undefined") {
      M.toast({
        html: "Allow notifications in your browser settings to receive phone alerts.",
        classes: "orange",
      });
    }
    modal.open();
  };

  const selectAllCheckbox = document.querySelector(
    "#employee-select-all-notifications",
  );
  if (selectAllCheckbox)
    selectAllCheckbox.onchange = (event) => {
      attendanceNotifications.forEach((item) => {
        if (event.currentTarget.checked) selectedNotificationIds.add(item.id);
        else selectedNotificationIds.delete(item.id);
      });
      renderNotifications();
    };
  const deleteSelectedButton = document.querySelector(
    "#delete-employee-selected-notifications",
  );
  if (deleteSelectedButton)
    deleteSelectedButton.onclick = () => {
      pendingDeleteNotificationIds = [...selectedNotificationIds];
      if (!pendingDeleteNotificationIds.length) return;
      if (deleteMessage)
        deleteMessage.textContent = `Delete ${pendingDeleteNotificationIds.length} selected notification${pendingDeleteNotificationIds.length === 1 ? "" : "s"}? This action cannot be undone.`;
      deleteModal.open();
    };
  const markSelectedReadButton = document.querySelector(
    "#mark-employee-selected-notifications-read",
  );
  if (markSelectedReadButton)
    markSelectedReadButton.onclick = async () => {
      const ids = attendanceNotifications
        .filter((item) => selectedNotificationIds.has(item.id) && !item.read)
        .map((item) => item.id);
      if (!ids.length) return;
      markSelectedReadButton.disabled = true;
      try {
        await Promise.all(
          ids.map((id) =>
            updateDoc(doc(db, "employeeNotifications", id), {
              read: true,
              readAt: serverTimestamp(),
            }),
          ),
        );
        selectedNotificationIds.clear();
        if (typeof M !== "undefined")
          M.toast({
            html: `${ids.length} notification${ids.length === 1 ? "" : "s"} marked as read.`,
            classes: "green",
          });
      } catch (error) {
        console.error("Unable to mark employee notifications as read:", error);
        if (typeof M !== "undefined")
          M.toast({
            html: "Unable to mark selected notifications as read.",
            classes: "red",
          });
      }
    };
  if (confirmDeleteButton)
    confirmDeleteButton.onclick = async () => {
      const ids = [...pendingDeleteNotificationIds];
      if (!ids.length) return;
      confirmDeleteButton.disabled = true;
      try {
        await Promise.all(
          ids.map((id) => deleteDoc(doc(db, "employeeNotifications", id))),
        );
        ids.forEach((id) => selectedNotificationIds.delete(id));
        deleteModal.close();
        if (typeof M !== "undefined")
          M.toast({
            html: "Selected notifications deleted.",
            classes: "green",
          });
      } catch (error) {
        console.error("Unable to delete employee notifications:", error);
        if (typeof M !== "undefined")
          M.toast({
            html: "Unable to delete selected notifications.",
            classes: "red",
          });
      } finally {
        confirmDeleteButton.disabled = false;
      }
    };
  const user = await new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      unsubscribe();
      resolve(currentUser);
    });
  });
  // kung napalitan o na-stop habang naghihintay sa auth, huwag nang mag-subscribe
  if (!user || boundBell !== bell || unsubscribeAttendanceNotifications) return;

  unsubscribeAttendanceNotifications = onSnapshot(
    query(
      collection(db, "employeeNotifications"),
      where("userId", "==", user.uid),
    ),
    (snapshot) => {
      if (hasLoadedInitialAttendanceNotifications) {
        snapshot
          .docChanges()
          .filter(
            (change) => change.type === "added" && !change.doc.data().read,
          )
          .forEach((change) => {
            const item = change.doc.data();
            showDeviceNotification({
              title: item.title || "New notification",
              body: item.message || "You have a new system notification.",
              tag: `employee-notification-${change.doc.id}`,
              url: "/employee/siomai/userpanel.html",
            }).catch((error) =>
              console.error("Unable to show device notification:", error),
            );
          });
      }
      hasLoadedInitialAttendanceNotifications = true;
      attendanceNotifications = snapshot.docs.map((item) => ({
        id: item.id,
        source: "employee",
        ...item.data(),
      }));
      const activeIds = new Set(attendanceNotifications.map((item) => item.id));
      selectedNotificationIds.forEach((id) => {
        if (!activeIds.has(id)) selectedNotificationIds.delete(id);
      });
      updateBadge(bell, badge);
      renderNotifications();
    },
    (error) =>
      console.error("Unable to load employee attendance notifications:", error),
  );
}

export function stopEmployeeNotifications() {
  unsubscribeAttendanceNotifications?.();
  unsubscribeAttendanceNotifications = null;
  attendanceNotifications = [];
  hasLoadedInitialAttendanceNotifications = false;
  boundBell = null;
  isOpeningNotification = false;
  selectedNotificationIds.clear();
  pendingDeleteNotificationIds = [];
}
