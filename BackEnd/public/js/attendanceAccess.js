import { app } from "/js/firebase.js";
import {
  getAuth,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  getFirestore,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const auth = getAuth(app);
const db = getFirestore(app);

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function todayKey() {
  return dateKey(new Date());
}

function yesterdayKey() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return dateKey(d);
}

function msUntilNextMidnight() {
  const now = new Date();
  const next = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0,
    0,
    1,
  );
  return next.getTime() - now.getTime();
}

const isActiveShift = (s) =>
  Boolean(s && s.status === "active" && s.clockedInAt && !s.clockedOutAt);

export function watchActiveShift(callback) {
  let listeners = [];
  let rolloverTimer = null;
  let lastState = null;

  const stopListeners = () => {
    listeners.forEach((stop) => stop());
    listeners = [];
  };

  const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
    clearTimeout(rolloverTimer);
    stopListeners();
    lastState = null;

    if (!user) {
      callback({
        active: false,
        timedOut: false,
        pending: false,
        accountRole: "",
      });
      return;
    }

    let accountRole = "";
    try {
      accountRole = String(
        (await user.getIdTokenResult()).claims.role || "",
      ).toLowerCase();
    } catch (_) {}

    const start = () => {
      stopListeners();
      const data = { today: null, yesterday: null };
      const ready = { today: false, yesterday: false };

      const emit = () => {
        if (!ready.today || !ready.yesterday) return;
        const { today, yesterday } = data;
        // A shift that started yesterday and is still open (or waiting for
        // time-out approval) keeps counting after midnight.
        const yesterdayOpen =
          isActiveShift(yesterday) ||
          Boolean(yesterday && yesterday.status === "time_out_pending");
        const timedOut = Boolean(
          today && (today.status === "completed" || today.clockedOutAt),
        );
        const state = {
          active: isActiveShift(today) || isActiveShift(yesterday),
          timedOut: timedOut && !yesterdayOpen,
          pending: Boolean(
            (today && ["pending", "time_out_pending"].includes(today.status)) ||
            (yesterday && yesterday.status === "time_out_pending"),
          ),
          accountRole,
        };
        lastState = state;
        callback(state);
      };

      const watch = (key, slot) => {
        const stop = onSnapshot(
          doc(db, "attendance", `${user.uid}_${key}`),
          (snapshot) => {
            data[slot] = snapshot.exists() ? snapshot.data() : null;
            ready[slot] = true;
            emit();
          },
          (error) => {
            console.error("Unable to verify employee shift:", error);
            // Keep the last known state instead of dropping to "not timed in".
            if (lastState) callback({ ...lastState, accountRole });
            else
              callback({
                active: false,
                timedOut: false,
                pending: false,
                accountRole,
              });
          },
        );
        listeners.push(stop);
      };

      watch(todayKey(), "today");
      watch(yesterdayKey(), "yesterday");

      // Re-point the listeners at the new dates once the day changes.
      rolloverTimer = setTimeout(start, msUntilNextMidnight());
    };

    start();
  });

  return () => {
    clearTimeout(rolloverTimer);
    unsubscribeAuth();
    stopListeners();
  };
}

export function showShiftRequired(
  container,
  visible,
  timedOut = false,
  pending = false,
) {
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
    notice
      .querySelector("[data-go-to-attendance]")
      .addEventListener("click", () => {
        window.loadSection?.("attendance.html");
      });
    container.prepend(notice);
  }
  if (notice) {
    notice.hidden = !visible;
    if (visible) {
      notice.querySelector("[data-shift-notice-icon]").textContent = timedOut
        ? "task_alt"
        : pending
          ? "hourglass_top"
          : "lock_clock";
      notice.querySelector("[data-shift-notice-title]").textContent = timedOut
        ? "You already timed out"
        : pending
          ? "Waiting for Approval"
          : "Need to time in";
      notice.querySelector("[data-shift-notice-message]").textContent = timedOut
        ? "All records have been saved."
        : pending
          ? "Your time-in request has been sent. Please wait for the manager's approval before using POS or reporting an expense."
          : "Time in and wait for the manager's approval before using POS or reporting an expense.";
      const attendanceButton = notice.querySelector("[data-go-to-attendance]");
      attendanceButton.hidden = timedOut;
    }
  }
}
