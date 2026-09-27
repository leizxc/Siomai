import { app } from "/js/firebase.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getFirestore, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const auth = getAuth(app);
const db = getFirestore(app);

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function watchActiveShift(callback) {
  let unsubscribeAttendance = null;
  const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
    unsubscribeAttendance?.();
    if (!user) {
      callback({ active: false, timedOut: false });
      return;
    }
    unsubscribeAttendance = onSnapshot(doc(db, "attendance", `${user.uid}_${todayKey()}`), (snapshot) => {
      const shift = snapshot.exists() ? snapshot.data() : null;
      const timedOut = Boolean(shift && (shift.status === "completed" || shift.clockedOutAt));
      callback({
        active: Boolean(shift && shift.status === "active" && shift.clockedInAt && !shift.clockedOutAt),
        timedOut,
      });
    }, (error) => {
      console.error("Unable to verify employee shift:", error);
      callback({ active: false, timedOut: false });
    });
  });
  return () => {
    unsubscribeAuth();
    unsubscribeAttendance?.();
  };
}

export function showShiftRequired(container, visible, timedOut = false) {
  if (!container) return;
  let notice = container.querySelector("[data-shift-required]");
  if (visible && !notice) {
    notice = document.createElement("div");
    notice.dataset.shiftRequired = "true";
    notice.setAttribute("role", "status");
    notice.className = "shift-required-notice";
    notice.innerHTML = `
      <span class="material-icons shift-required-icon" data-shift-notice-icon aria-hidden="true"></span>
      <div class="shift-required-copy">
        <strong data-shift-notice-title></strong>
        <span data-shift-notice-message></span>
      </div>
      <button type="button" class="shift-required-action" data-go-to-attendance>Go to Attendance</button>
    `;
    notice.querySelector("[data-go-to-attendance]").addEventListener("click", () => {
      window.loadSection?.("attendance.html");
    });
    container.prepend(notice);
  }
  if (notice) {
    notice.hidden = !visible;
    if (visible) {
      notice.querySelector("[data-shift-notice-icon]").textContent = timedOut ? "task_alt" : "lock_clock";
      notice.querySelector("[data-shift-notice-title]").textContent = timedOut ? "You already timed out" : "Need to time in";
      notice.querySelector("[data-shift-notice-message]").textContent = timedOut
        ? "All records have been saved."
        : "Time in and wait for the manager's approval before using POS or reporting an expense.";
      const attendanceButton = notice.querySelector("[data-go-to-attendance]");
      attendanceButton.hidden = timedOut;
    }
  }
}
