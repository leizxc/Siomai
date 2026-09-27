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
      callback(false);
      return;
    }
    unsubscribeAttendance = onSnapshot(doc(db, "attendance", `${user.uid}_${todayKey()}`), (snapshot) => {
      const shift = snapshot.exists() ? snapshot.data() : null;
      callback(Boolean(shift && shift.status === "active" && shift.clockedInAt && !shift.clockedOutAt));
    }, (error) => {
      console.error("Unable to verify employee shift:", error);
      callback(false);
    });
  });
  return () => {
    unsubscribeAuth();
    unsubscribeAttendance?.();
  };
}

export function showShiftRequired(container, visible) {
  if (!container) return;
  let notice = container.querySelector("[data-shift-required]");
  if (visible && !notice) {
    notice = document.createElement("div");
    notice.dataset.shiftRequired = "true";
    notice.setAttribute("role", "status");
    notice.className = "shift-required-notice";
    notice.innerHTML = `
      <span class="material-icons shift-required-icon" aria-hidden="true">lock_clock</span>
      <div class="shift-required-copy">
        <strong>Need to time in</strong>
        <span>Timed in and wait for the manager's approval before using POS or report expense.</span>
      </div>
      <button type="button" class="shift-required-action" data-go-to-attendance>Go to Attendance</button>
    `;
    notice.querySelector("[data-go-to-attendance]").addEventListener("click", () => {
      window.loadSection?.("attendance.html");
    });
    container.prepend(notice);
  }
  if (notice) notice.hidden = !visible;
}
