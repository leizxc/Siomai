// ATTENDANCE PAGE

import { app } from "/js/firebase.js";

import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  runTransaction,
  serverTimestamp,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const auth = getAuth(app);
const db = getFirestore(app);

let attendanceInitialized = false;
let currentAttendance = null;
let currentAttendanceRef = null;
let unsubscribeAttendance = null;
let statsTimer = null;
let attendanceHistory = [];
let selectedAttendanceRange = "today";
let pendingAttendanceAction = null;

// Lifecycle tracking
// - attendanceRoot: ang DOM element na kasalukuyang naka-bind (para malaman kung napalitan ang page)
// - rootObserver: awtomatikong nag-stop kapag nawala sa DOM ang page
// - initToken: pang-cancel ng mga async na gawain na natapos pagkatapos mag-stop
let attendanceRoot = null;
let rootObserver = null;
let initToken = 0;

function getAttendanceRoot() {
  return document.querySelector("#time-in-button");
}

// Kapag inalis sa DOM ang attendance page (lumipat ng ibang content),
// awtomatikong tatawagin ang stopAttendancePage kahit hindi ito tawagin ng navigation.
function watchRootRemoval(root) {
  rootObserver?.disconnect();
  const container = document.querySelector("#content") || document.body;
  rootObserver = new MutationObserver(() => {
    if (attendanceRoot && !attendanceRoot.isConnected) {
      stopAttendancePage();
    }
  });
  rootObserver.observe(container, { childList: true, subtree: true });
}

// ========================================
// INITIALIZE ATTENDANCE
// ========================================

export async function initAttendance() {
  const root = getAttendanceRoot();
  if (!root) return;

  // Kung initialized na at pareho pa ang DOM, huwag nang ulitin.
  // Kung ibang DOM na ang nasa page, i-stop muna ang luma at mag-init ulit.
  if (attendanceInitialized) {
    if (attendanceRoot === root) return;
    stopAttendancePage();
  }

  attendanceInitialized = true;
  attendanceRoot = root;
  const token = ++initToken;
  watchRootRemoval(root);

  setAttendanceDate();
  setupAttendanceTabs();

  try {
    // hintayin muna ang auth para hindi null ang currentUser pagka-load
    try {
      await auth.authStateReady?.();
    } catch (_) {}
    if (token !== initToken) return;

    const user = auth.currentUser;

    // Walang naka-login
    if (!user) {
      console.warn("No logged-in user found.");
      showAttendanceError("No logged-in user.");
      return;
    }

    console.log("Attendance user:", user.uid);

    // ========================================
    // GET EMPLOYEE INFORMATION
    // ========================================

    const employeeQuery = query(
      collection(db, "employees"),
      where("uid", "==", user.uid),
    );

    const employeeSnapshot = await getDocs(employeeQuery);
    if (token !== initToken) return; // na-stop habang naghihintay

    if (employeeSnapshot.empty) {
      console.warn("Employee record not found.", user.uid, user.email);
      showAttendanceError("Employee information not found.");
      return;
    }

    const employeeData = employeeSnapshot.docs[0].data();
    const accountRole = String(
      (await user.getIdTokenResult()).claims.role || "employee",
    ).toLowerCase();

    const fname = employeeData.fname || "";
    const lname = employeeData.lname || "";

    console.log("Employee:", fname, lname);

    // ========================================
    // SHIFT DOCUMENT (ngayon, o kahapon kung bukas pa ang shift)
    // ========================================

    const { ref: attendanceRef, date: today } = await resolveShiftRef(user);
    if (token !== initToken) return;

    watchAttendance(attendanceRef, {
      attendanceRef,
      user,
      fname,
      lname,
      accountRole,
      today,
    });
    await loadAttendanceStats(user.uid, token);
  } catch (error) {
    console.error("Attendance initialization error:", error);
    if (token !== initToken) return;
    showAttendanceError("Unable to load attendance.");
  }
}

// ========================================
// DATE HELPERS
// ========================================

function getTodayDate() {
  return toDateKey(new Date());
}

function getYesterdayDate() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return toDateKey(d);
}

// Hanapin muna kung may bukas na shift kahapon (tumawid ng hatinggabi).
// Kung wala, gamitin ang dokumento ng ngayon.
async function resolveShiftRef(user) {
  const today = getTodayDate();
  const yesterday = getYesterdayDate();
  const yRef = doc(db, "attendance", `${user.uid}_${yesterday}`);
  const ySnap = await getDoc(yRef);
  const y = ySnap.exists() ? ySnap.data() : null;
  if (
    y &&
    !y.clockedOutAt &&
    ["active", "pending", "time_out_pending"].includes(y.status)
  ) {
    return { ref: yRef, date: yesterday };
  }
  return { ref: doc(db, "attendance", `${user.uid}_${today}`), date: today };
}

// ========================================
// DISPLAY ATTENDANCE
// ========================================

function displayAttendance(attendance) {
  currentAttendance = attendance;
  const approver = attendance.accountRole === "manager" ? "owner" : "manager";
  if (attendance.status === "pending") {
    updateTodayStatus(
      "Waiting for Approval",
      `Your time-in request has been sent. Please wait for ${approver} approval.`,
      "pending",
    );
    setTimeInButtonPending();
    displayPendingAttendance(attendance);
    return;
  }

  if (attendance.status === "time_out_pending") {
    updateTodayStatus(
      "Time out awaiting approval",
      `Your time-out request has been sent to the ${approver}.`,
      "pending",
    );
    setTimeOutButtonPending();
    displayPendingTimeOut(attendance);
    return;
  }

  if (attendance.status === "completed") {
    updateTodayStatus(
      "Shift completed",
      "Your time out has been recorded for today.",
      "completed",
    );
    setTimeInButtonCompleted();
    displayCompletedAttendance(attendance);
    return;
  }

  setTimeInButtonActive();
  updateTodayStatus(
    "Time in active",
    "You are currently clocked in.",
    "active",
  );

  const activityList = document.querySelector(".activity-list");
  if (!activityList) return;

  let clockedInTime = attendance.clockedInAt;

  // Firebase Timestamp
  if (clockedInTime && typeof clockedInTime.toDate === "function") {
    clockedInTime = clockedInTime.toDate();
  }

  // Fallback
  if (!(clockedInTime instanceof Date)) {
    clockedInTime = new Date();
  }

  const formattedTime = clockedInTime.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const formattedDate = clockedInTime.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const employeeName =
    `${attendance.fname || ""} ${attendance.lname || ""}`.trim();

  activityList.innerHTML = `
    <div class="activity-item">
      <div class="activity-icon">
        <span class="material-icons">login</span>
      </div>
      <div class="activity-info">
        <div class="activity-title">Clocked In</div>
        <div class="activity-time">${employeeName}</div>
        <div class="activity-time">${formattedDate} · ${formattedTime}</div>
      </div>
      <div class="activity-right">
        <div class="activity-status active">
          <span class="status-dot"></span>
          Active
        </div>
      </div>
    </div>
  `;
}

// ========================================
// EMPTY / ERROR STATE
// ========================================

// Gamitin lang kapag NAPATUNAYAN na walang record (ready na mag-time in).
function showNoAttendance(message) {
  updateTodayStatus(
    "Ready to time in",
    "Submit your request when you are ready to start.",
    "ready",
  );
  const activityList = document.querySelector(".activity-list");
  if (!activityList) return;

  activityList.innerHTML = `
    <div class="activity-item">
      <div class="activity-info">
        <div class="activity-title">${message}</div>
      </div>
    </div>
  `;
}

function lockTimeInButton(label = "Unavailable") {
  const button = document.querySelector("#time-in-button");
  if (!button) return;
  button.disabled = true;
  button.onclick = null;
  button.innerHTML = `<span class="material-icons">lock</span> ${label}`;
}

// Fail closed: kapag hindi mapatunayan ang state, huwag payagan ang time-in.
function showAttendanceError(message) {
  updateTodayStatus("Can't verify attendance", message, "pending");
  lockTimeInButton();
  const activityList = document.querySelector(".activity-list");
  if (!activityList) return;
  activityList.innerHTML = `
    <div class="activity-item">
      <div class="activity-info">
        <div class="activity-title">${message}</div>
      </div>
    </div>
  `;
}

// ========================================
// CLEANUP
// ========================================

export function stopAttendancePage() {
  // i-cancel ang lahat ng async na init/stats na hindi pa tapos
  initToken++;

  rootObserver?.disconnect();
  rootObserver = null;
  attendanceRoot = null;

  attendanceInitialized = false;
  currentAttendance = null;
  currentAttendanceRef = null;
  unsubscribeAttendance?.();
  unsubscribeAttendance = null;
  clearInterval(statsTimer);
  statsTimer = null;
  attendanceHistory = [];
  pendingAttendanceAction = null;

  // i-destroy ang confirmation modal para walang maiwang overlay
  // at hindi ma-stuck ang overflow ng body kapag napalitan ang section.
  closeAttendanceConfirmation({ destroy: true });

  console.log("Attendance page stopped.");
}

function displayPendingAttendance(attendance) {
  const approver = attendance.accountRole === "manager" ? "owner" : "manager";
  updateTodayStatus(
    "Waiting for Approval",
    `Your time-in request has been sent. Please wait for ${approver} approval.`,
    "pending",
  );
  const activityList = document.querySelector(".activity-list");
  if (!activityList) return;

  const employeeName =
    `${attendance.fname || ""} ${attendance.lname || ""}`.trim();
  activityList.innerHTML = `
    <div class="activity-item">
      <div class="activity-icon"><span class="material-icons">hourglass_top</span></div>
      <div class="activity-info">
        <div class="activity-title">Time In Request Sent</div>
        <div class="activity-time">${employeeName}</div>
        <div class="activity-time">Waiting for ${approver} approval</div>
      </div>
      <div class="activity-right">
        <div class="activity-status pending">Pending</div>
      </div>
    </div>
  `;
}

function displayCompletedAttendance(attendance) {
  updateTodayStatus(
    "Shift completed",
    "Your time out has been recorded for today.",
    "completed",
  );
  const activityList = document.querySelector(".activity-list");
  if (!activityList) return;

  const employeeName =
    `${attendance.fname || ""} ${attendance.lname || ""}`.trim();
  const clockedOutAt = toDate(attendance.clockedOutAt);
  const formattedTime = clockedOutAt
    ? clockedOutAt.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

  activityList.innerHTML = `
    <div class="activity-item">
      <div class="activity-icon out"><span class="material-icons">logout</span></div>
      <div class="activity-info">
        <div class="activity-title">Clocked Out</div>
        <div class="activity-time">${employeeName}</div>
        <div class="activity-time">Time out: ${formattedTime}</div>
      </div>
      <div class="activity-right">
        <div class="activity-status completed">Completed</div>
      </div>
    </div>
  `;
}

function displayPendingTimeOut(attendance) {
  const approver = attendance.accountRole === "manager" ? "owner" : "manager";
  const activityList = document.querySelector(".activity-list");
  if (!activityList) return;

  const employeeName =
    `${attendance.fname || ""} ${attendance.lname || ""}`.trim();
  activityList.innerHTML = `
    <div class="activity-item">
      <div class="activity-icon out"><span class="material-icons">hourglass_top</span></div>
      <div class="activity-info">
        <div class="activity-title">Time Out Request Sent</div>
        <div class="activity-time">${employeeName}</div>
        <div class="activity-time">Waiting for ${approver} approval</div>
      </div>
      <div class="activity-right">
        <div class="activity-status pending">Pending</div>
      </div>
    </div>
  `;
}

async function loadAttendanceStats(userId, token = initToken) {
  try {
    const snapshot = await getDocs(
      query(collection(db, "attendance"), where("userId", "==", userId)),
    );
    // kung na-stop o napalitan na ang page habang naghihintay, huwag nang mag-render
    // at huwag nang magsimula ng bagong timer.
    if (token !== initToken) return;
    attendanceHistory = snapshot.docs.map((item) => item.data());
    renderAttendanceStats();
    renderAttendanceHistory();
    if (!statsTimer) statsTimer = setInterval(renderAttendanceStats, 60 * 1000);
  } catch (error) {
    console.error("Unable to load attendance statistics:", error);
  }
}

function renderAttendanceStats() {
  const now = new Date();
  const today = getTodayDate();
  const weekStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 6,
  );
  const activeDates = new Set();
  let totalMilliseconds = 0;

  attendanceHistory.forEach((attendance) => {
    if (attendance.status !== "active" && attendance.status !== "completed")
      return;
    const clockedInAt = toDate(attendance.clockedInAt);
    const dateKey =
      attendance.attendanceDate || (clockedInAt ? toDateKey(clockedInAt) : "");
    if (!clockedInAt || !dateKey) return;

    activeDates.add(dateKey);
    const attendanceDate = dateFromKey(dateKey);
    if (attendanceDate < weekStart || attendanceDate > now) return;

    const clockedOutAt = toDate(attendance.clockedOutAt);
    const endOfShift =
      clockedOutAt ||
      (dateKey === today
        ? now
        : new Date(
            attendanceDate.getFullYear(),
            attendanceDate.getMonth(),
            attendanceDate.getDate() + 1,
          ));
    totalMilliseconds += Math.max(0, endOfShift - clockedInAt);
  });

  document
    .querySelector("#total-hours-value")
    ?.replaceChildren(
      document.createTextNode((totalMilliseconds / 3600000).toFixed(1)),
    );
  document
    .querySelector("#shift-streak-value")
    ?.replaceChildren(
      document.createTextNode(String(getShiftStreak(activeDates, today))),
    );
}

function setAttendanceDate() {
  const dateElement = document.querySelector("#attendance-current-date");
  if (!dateElement) return;
  dateElement.textContent = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function setupAttendanceTabs() {
  document.querySelectorAll(".tab[data-range]").forEach((tab) => {
    // onclick (hindi addEventListener) para hindi dumoble ang handler kapag na-init ulit
    tab.onclick = () => {
      selectedAttendanceRange = tab.dataset.range;
      document.querySelectorAll(".tab[data-range]").forEach((item) => {
        const active = item === tab;
        item.classList.toggle("active", active);
        item.setAttribute("aria-pressed", String(active));
      });
      renderAttendanceHistory();
    };
  });
}

function updateTodayStatus(title, note, state) {
  const titleElement = document.querySelector("#today-status-value");
  const noteElement = document.querySelector("#today-status-note");
  const statElement = document.querySelector("#today-status-stat");
  const statNoteElement = document.querySelector("#today-status-stat-note");
  if (titleElement) titleElement.textContent = title;
  if (noteElement) noteElement.textContent = note;
  if (statElement) {
    statElement.textContent = title.replace(" to time in", "");
    statElement.dataset.state = state;
  }
  if (statNoteElement) {
    statNoteElement.className = `stat-sub badge ${state}`;
    statNoteElement.innerHTML = `<span class="material-icons">${state === "active" ? "check_circle" : state === "pending" ? "hourglass_top" : state === "completed" ? "task_alt" : "schedule"}</span> Today`;
  }
}

function renderAttendanceHistory() {
  const activityList = document.querySelector(".activity-list");
  if (!activityList || !attendanceHistory.length) return;

  const today = getTodayDate();
  const now = new Date();
  const weekStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 6,
  );
  const records = attendanceHistory
    .filter((attendance) => {
      const date =
        attendance.attendanceDate ||
        (toDate(attendance.clockedInAt)
          ? toDateKey(toDate(attendance.clockedInAt))
          : "");
      return selectedAttendanceRange === "today"
        ? date === today
        : date && dateFromKey(date) >= weekStart;
    })
    .sort(
      (a, b) =>
        (toDate(b.clockedInAt)?.getTime() || 0) -
        (toDate(a.clockedInAt)?.getTime() || 0),
    );

  if (!records.length) {
    activityList.innerHTML = `<div class="attendance-empty"><span class="material-icons">event_available</span><strong>No attendance records</strong><small>${selectedAttendanceRange === "today" ? "No shift activity has been recorded today." : "No activity was recorded this week."}</small></div>`;
    return;
  }

  activityList.innerHTML = records
    .map((attendance) => {
      const clockedInAt = toDate(attendance.clockedInAt);
      const label =
        attendance.status === "pending"
          ? "Time in request"
          : attendance.status === "completed"
            ? "Shift completed"
            : "Clocked in";
      const status =
        attendance.status === "pending"
          ? "pending"
          : attendance.status === "completed"
            ? "completed"
            : "active";
      const icon =
        status === "pending"
          ? "hourglass_top"
          : status === "completed"
            ? "logout"
            : "login";
      const dateLabel = clockedInAt
        ? clockedInAt.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })
        : attendance.attendanceDate || "Today";
      const timeLabel = clockedInAt
        ? clockedInAt.toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
          })
        : "Awaiting approval";
      return `<div class="activity-item"><div class="activity-icon ${status === "completed" ? "out" : ""}"><span class="material-icons">${icon}</span></div><div class="activity-info"><div class="activity-title">${label}</div><div class="activity-time">${dateLabel} · ${timeLabel}</div></div><div class="activity-right"><div class="activity-status ${status}">${status === "active" ? '<span class="status-dot"></span>' : ""}${status === "active" ? "Active" : status === "pending" ? "Pending" : "Completed"}</div></div></div>`;
    })
    .join("");
}

function getShiftStreak(activeDates, today) {
  const cursor = dateFromKey(today);
  if (!activeDates.has(today)) cursor.setDate(cursor.getDate() - 1);

  let streak = 0;
  while (activeDates.has(toDateKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function toDate(value) {
  return value?.toDate ? value.toDate() : value instanceof Date ? value : null;
}

function toDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateFromKey(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function watchAttendance(attendanceRef, context) {
  unsubscribeAttendance?.();
  currentAttendanceRef = attendanceRef;
  const token = initToken;

  unsubscribeAttendance = onSnapshot(
    attendanceRef,
    { includeMetadataChanges: true },
    (snapshot) => {
      // huwag mag-render kung na-stop na ang page
      if (token !== initToken) return;

      if (snapshot.exists()) {
        displayAttendance(snapshot.data());
        if (!snapshot.metadata.hasPendingWrites) {
          loadAttendanceStats(context.user.uid, token);
        }
        return;
      }

      // "Walang dokumento" na galing lang sa cache ay hindi pa kumpirmado.
      // Huwag buksan ang time-in hangga't hindi sigurado.
      if (snapshot.metadata.fromCache) {
        updateTodayStatus(
          "Checking attendance",
          "Verifying your shift status...",
          "pending",
        );
        lockTimeInButton("Checking...");
        return;
      }

      currentAttendance = null;
      showTimeInButton(context);
      showNoAttendance("No time-in request submitted today.");
    },
    (error) => {
      console.error("Attendance listener error:", error);
      if (token !== initToken) return;
      showAttendanceError("Unable to verify your attendance. Please refresh.");
    },
  );
}

function showTimeInButton({ attendanceRef, user, fname, lname, today }) {
  const timeInButton = document.querySelector("#time-in-button");

  if (!timeInButton) return;

  timeInButton.hidden = false;
  timeInButton.classList.remove("active", "pending", "completed");
  timeInButton.disabled = false;
  timeInButton.innerHTML = `
    <span class="material-icons">login</span>
    Time In
  `;

  timeInButton.onclick = () => {
    if (currentAttendance) return;
    openAttendanceConfirmation("time-in");
  };
}

function openAttendanceConfirmation(action) {
  const modal = document.querySelector("#attendance-confirmation");
  const title = document.querySelector("#attendance-confirmation-title");
  const message = document.querySelector("#attendance-confirmation-message");
  const confirmButton = document.querySelector("#attendance-confirm-action");
  if (!modal || !confirmButton) return;

  const isTimeOut = action === "time-out";
  pendingAttendanceAction = action;
  title.textContent = isTimeOut ? "Confirm Time Out" : "Confirm Time In";
  message.textContent = isTimeOut
    ? "Are you sure you want to submit your time-out request?"
    : "Are you sure you want to submit your time-in request?";
  confirmButton.textContent = isTimeOut ? "Yes, Time Out" : "Yes, Time In";
  const instance = M.Modal.getInstance(modal) || M.Modal.init(modal);
  instance.open();
}

function closeAttendanceConfirmation({ destroy = false } = {}) {
  const modal = document.querySelector("#attendance-confirmation");
  const instance = modal && M.Modal.getInstance(modal);
  if (instance?.isOpen) instance.close();

  // kapag aalis na sa page, i-destroy ang instance at linisin ang naiwang overlay/overflow
  // (pero huwag galawin kung may ibang modal na bukas, hal. ang notification modal).
  if (destroy && instance) {
    try {
      instance.destroy();
    } catch (error) {
      console.warn("Unable to destroy attendance modal:", error);
    }
    if (!document.querySelector(".modal.open")) {
      document
        .querySelectorAll(".modal-overlay")
        .forEach((overlay) => overlay.remove());
      document.body.style.overflow = "";
    }
  }

  pendingAttendanceAction = null;
}

async function submitConfirmedAttendanceAction() {
  const action = pendingAttendanceAction;
  const confirmButton = document.querySelector("#attendance-confirm-action");
  const timeInButton = document.querySelector("#time-in-button");
  if (!action || !confirmButton || !timeInButton) return;

  closeAttendanceConfirmation();

  if (action === "time-in") {
    const user = auth.currentUser;
    const attendanceRef = currentAttendanceRef;
    if (!user || !attendanceRef || currentAttendance) return;
    timeInButton.disabled = true;
    timeInButton.textContent = "Sending request...";

    try {
      const employeeQuery = query(
        collection(db, "employees"),
        where("uid", "==", user.uid),
      );
      const employeeSnapshot = await getDocs(employeeQuery);
      if (employeeSnapshot.empty)
        throw new Error("Employee information not found.");
      const employeeData = employeeSnapshot.docs[0].data();
      const accountRole = String(
        (await user.getIdTokenResult()).claims.role || "employee",
      ).toLowerCase();
      const fname = employeeData.fname || "";
      const lname = employeeData.lname || "";
      const attendanceData = {
        userId: user.uid,
        fname,
        lname,
        accountRole,
        email: user.email || "",
        status: "pending",
        type: "time_in_request",
        attendanceDate: getTodayDate(),
        requestedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      };

      // Huwag mag-time in kung may bukas na shift (hal. kahapon),
      // at huwag mag-overwrite ng kahit anong existing na record.
      const open = await resolveShiftRef(user);
      if (open.ref.id !== attendanceRef.id)
        throw new Error("SHIFT_ALREADY_OPEN");
      await runTransaction(db, async (tx) => {
        const existing = await tx.get(attendanceRef);
        if (existing.exists()) throw new Error("SHIFT_ALREADY_EXISTS");
        tx.set(attendanceRef, attendanceData);
      });

      await setDoc(
        doc(db, "managerNotifications", `time-in-${attendanceRef.id}`),
        {
          type: "time_in_request",
          attendanceId: attendanceRef.id,
          userId: user.uid,
          accountRole,
          title: `${accountRole === "manager" ? "Manager" : "Employee"} time-in request`,
          message: `${fname} ${lname}`.trim() + " submitted a time-in request.",
          read: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
      );
      currentAttendance = attendanceData;
      setTimeInButtonPending();
      displayPendingAttendance(attendanceData);
    } catch (error) {
      console.error("Time in error:", error);
      if (
        error.message === "SHIFT_ALREADY_OPEN" ||
        error.message === "SHIFT_ALREADY_EXISTS"
      ) {
        showAttendanceError(
          "You already have an attendance record for this shift.",
        );
        return;
      }
      timeInButton.disabled = false;
      timeInButton.innerHTML = `
        <span class="material-icons">login</span>
        Time In
      `;
      showNoAttendance("Unable to send time-in request. Please try again.");
    }
    return;
  }

  if (currentAttendance?.status !== "active" || !currentAttendanceRef) return;
  timeInButton.disabled = true;
  timeInButton.textContent = "Recording time out...";
  try {
    await updateDoc(currentAttendanceRef, {
      status: "time_out_pending",
      type: "time_out_request",
      timeOutRequestedAt: serverTimestamp(),
    });
    const attendanceId = currentAttendanceRef.id;
    await setDoc(doc(db, "managerNotifications", `time-out-${attendanceId}`), {
      type: "time_out_request",
      attendanceId,
      userId: auth.currentUser?.uid || "",
      accountRole: currentAttendance.accountRole || "employee",
      title: `${currentAttendance.accountRole === "manager" ? "Manager" : "Employee"} time-out request`,
      message:
        `${currentAttendance.fname || ""} ${currentAttendance.lname || ""}`.trim() +
        " requested to time out.",
      read: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    console.error("Time out error:", error);
    timeInButton.disabled = false;
    timeInButton.innerHTML = `<span class="material-icons">logout</span> Time Out`;
    M.toast({
      html: "Unable to send time-out request. Please try again.",
      classes: "red rounded",
    });
  }
}

function setTimeInButtonPending() {
  const timeInButton = document.querySelector("#time-in-button");
  if (!timeInButton) return;

  timeInButton.disabled = true;
  timeInButton.classList.remove("active");
  timeInButton.classList.add("pending");
  timeInButton.innerHTML = `
    <span class="material-icons">hourglass_top</span>
    Awaiting Approval
  `;
}

function setTimeOutButtonPending() {
  const timeInButton = document.querySelector("#time-in-button");
  if (!timeInButton) return;

  timeInButton.disabled = true;
  timeInButton.classList.remove("active", "completed");
  timeInButton.classList.add("pending");
  timeInButton.innerHTML = `
    <span class="material-icons">hourglass_top</span>
    Time Out Awaiting Approval
  `;
}

function setTimeInButtonCompleted() {
  const timeInButton = document.querySelector("#time-in-button");
  if (!timeInButton) return;

  timeInButton.disabled = true;
  timeInButton.classList.remove("active", "pending");
  timeInButton.classList.add("completed");
  timeInButton.innerHTML = `
    <span class="material-icons">logout</span>
    Time Out Recorded
  `;
}

function setTimeInButtonActive() {
  const timeInButton = document.querySelector("#time-in-button");

  if (!timeInButton) return;

  timeInButton.disabled = false;
  timeInButton.classList.remove("pending", "completed");
  timeInButton.classList.add("active");
  timeInButton.innerHTML = `
    <span class="material-icons">logout</span>
    Time Out
  `;

  timeInButton.onclick = () => {
    if (currentAttendance?.status !== "active" || !currentAttendanceRef) return;
    openAttendanceConfirmation("time-out");
  };
}

// siguraduhing isang beses lang ma-register ang document-level listeners
if (!window.__attendanceDocListenersBound) {
  window.__attendanceDocListenersBound = true;

  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-confirm-cancel]"))
      closeAttendanceConfirmation();
    if (event.target.closest("#attendance-confirm-action"))
      submitConfirmedAttendanceAction();
  });

  document.addEventListener("keydown", (event) => {
    // kung may pending action lang
    if (event.key === "Escape" && pendingAttendanceAction) {
      closeAttendanceConfirmation();
    }
  });
}
