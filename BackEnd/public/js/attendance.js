// ATTENDANCE PAGE

import { app } from "/js/firebase.js";

import {
  getAuth,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
  doc,
  setDoc,
  serverTimestamp,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const auth = getAuth(app);
const db = getFirestore(app);

let attendanceInitialized = false;
let currentAttendance = null;
let unsubscribeAttendance = null;
let statsTimer = null;
let attendanceHistory = [];
let selectedAttendanceRange = "today";

// ========================================
// INITIALIZE ATTENDANCE
// ========================================

export async function initAttendance() {
  if (attendanceInitialized) return;

  attendanceInitialized = true;
  setAttendanceDate();
  setupAttendanceTabs();

  try {
    const user = auth.currentUser;

    // Walang naka-login
    if (!user) {
      console.warn("No logged-in user found.");

      showNoAttendance("No logged-in user.");

      return;
    }

    console.log("Attendance user:", user.uid);

    // ========================================
    // GET EMPLOYEE INFORMATION
    // ========================================

    const employeeQuery = query(
      collection(db, "employees"),
      where("uid", "==", user.uid)
    );

    const employeeSnapshot = await getDocs(employeeQuery);

    if (employeeSnapshot.empty) {
      console.warn("Employee record not found.");

      showNoAttendance("Employee information not found.");

      return;
    }

    const employeeData = employeeSnapshot.docs[0].data();

    const fname = employeeData.fname || "";
    const lname = employeeData.lname || "";

    console.log("Employee:", fname, lname);

    // ========================================
    // TODAY'S DOCUMENT ID
    // ========================================

    const today = getTodayDate();

    const attendanceId = `${user.uid}_${today}`;

    const attendanceRef = doc(
      db,
      "attendance",
      attendanceId
    );

    watchAttendance(attendanceRef, { attendanceRef, user, fname, lname, today });
    await loadAttendanceStats(user.uid);

  } catch (error) {
    console.error(
      "Attendance initialization error:",
      error
    );

    showNoAttendance(
      "Unable to load attendance."
    );
  }
}

// ========================================
// GET TODAY'S DATE
// ========================================

function getTodayDate() {
  const date = new Date();

  const year = date.getFullYear();

  const month = String(
    date.getMonth() + 1
  ).padStart(2, "0");

  const day = String(
    date.getDate()
  ).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

// ========================================
// DISPLAY ATTENDANCE
// ========================================

function displayAttendance(attendance) {
  currentAttendance = attendance;
  if (attendance.status === "pending") {
    updateTodayStatus("Awaiting approval", "Your time-in request has been sent to the manager.", "pending");
    setTimeInButtonPending();
    displayPendingAttendance(attendance);
    return;
  }

  if (attendance.status === "completed") {
    updateTodayStatus("Shift completed", "Your time out has been recorded for today.", "completed");
    setTimeInButtonCompleted();
    displayCompletedAttendance(attendance);
    return;
  }

  setTimeInButtonActive();
  updateTodayStatus("Time in active", "You are currently clocked in.", "active");

  const activityList =
    document.querySelector(".activity-list");

  if (!activityList) return;

  let clockedInTime =
    attendance.clockedInAt;

  // Firebase Timestamp
  if (
    clockedInTime &&
    typeof clockedInTime.toDate === "function"
  ) {
    clockedInTime =
      clockedInTime.toDate();
  }

  // Fallback
  if (!(clockedInTime instanceof Date)) {
    clockedInTime = new Date();
  }

  // ========================================
  // FORMAT TIME
  // ========================================

  const formattedTime =
    clockedInTime.toLocaleTimeString(
      "en-US",
      {
        hour: "2-digit",
        minute: "2-digit",
      }
    );

  // ========================================
  // FORMAT DATE
  // ========================================

  const formattedDate =
    clockedInTime.toLocaleDateString(
      "en-US",
      {
        month: "short",
        day: "numeric",
        year: "numeric",
      }
    );

  // ========================================
  // EMPLOYEE NAME
  // ========================================

  const employeeName =
    `${attendance.fname || ""} ${
      attendance.lname || ""
    }`.trim();

  // ========================================
  // DISPLAY
  // ========================================

  activityList.innerHTML = `

    <div class="activity-item">

      <div class="activity-icon">
        <span class="material-icons">
          login
        </span>
      </div>

      <div class="activity-info">

        <div class="activity-title">
          Clocked In
        </div>

        <div class="activity-time">
          ${employeeName}
        </div>

        <div class="activity-time">
          ${formattedDate} · ${formattedTime}
        </div>

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

function showNoAttendance(message) {
  updateTodayStatus("Ready to time in", "Submit your request when you are ready to start.", "ready");
  const activityList =
    document.querySelector(".activity-list");

  if (!activityList) return;

  activityList.innerHTML = `

    <div class="activity-item">

      <div class="activity-info">

        <div class="activity-title">
          ${message}
        </div>

      </div>

    </div>

  `;
}

// ========================================
// CLEANUP
// ========================================

export function stopAttendancePage() {
  attendanceInitialized = false;
  currentAttendance = null;
  unsubscribeAttendance?.();
  unsubscribeAttendance = null;
  clearInterval(statsTimer);
  statsTimer = null;
  attendanceHistory = [];

  console.log(
    "Attendance page stopped."
  );
}

function displayPendingAttendance(attendance) {
  updateTodayStatus("Awaiting approval", "Your time-in request has been sent to the manager.", "pending");
  const activityList = document.querySelector(".activity-list");
  if (!activityList) return;

  const employeeName = `${attendance.fname || ""} ${attendance.lname || ""}`.trim();
  activityList.innerHTML = `
    <div class="activity-item">
      <div class="activity-icon"><span class="material-icons">hourglass_top</span></div>
      <div class="activity-info">
        <div class="activity-title">Time In Request Sent</div>
        <div class="activity-time">${employeeName}</div>
        <div class="activity-time">Waiting for manager approval</div>
      </div>
      <div class="activity-right">
        <div class="activity-status pending">Pending</div>
      </div>
    </div>
  `;
}

function displayCompletedAttendance(attendance) {
  updateTodayStatus("Shift completed", "Your time out has been recorded for today.", "completed");
  const activityList = document.querySelector(".activity-list");
  if (!activityList) return;

  const employeeName = `${attendance.fname || ""} ${attendance.lname || ""}`.trim();
  const clockedOutAt = toDate(attendance.clockedOutAt);
  const formattedTime = clockedOutAt
    ? clockedOutAt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
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

async function loadAttendanceStats(userId) {
  try {
    const snapshot = await getDocs(query(collection(db, "attendance"), where("userId", "==", userId)));
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
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
  const activeDates = new Set();
  let totalMilliseconds = 0;

  attendanceHistory.forEach((attendance) => {
    if (attendance.status !== "active" && attendance.status !== "completed") return;
    const clockedInAt = toDate(attendance.clockedInAt);
    const dateKey = attendance.attendanceDate || (clockedInAt ? toDateKey(clockedInAt) : "");
    if (!clockedInAt || !dateKey) return;

    activeDates.add(dateKey);
    const attendanceDate = dateFromKey(dateKey);
    if (attendanceDate < weekStart || attendanceDate > now) return;

    const clockedOutAt = toDate(attendance.clockedOutAt);
    const endOfShift = clockedOutAt || (dateKey === today
      ? now
      : new Date(attendanceDate.getFullYear(), attendanceDate.getMonth(), attendanceDate.getDate() + 1));
    totalMilliseconds += Math.max(0, endOfShift - clockedInAt);
  });

  document.querySelector("#total-hours-value")?.replaceChildren(
    document.createTextNode((totalMilliseconds / 3600000).toFixed(1))
  );
  document.querySelector("#shift-streak-value")?.replaceChildren(
    document.createTextNode(String(getShiftStreak(activeDates, today)))
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
    tab.addEventListener("click", () => {
      selectedAttendanceRange = tab.dataset.range;
      document.querySelectorAll(".tab[data-range]").forEach((item) => {
        const active = item === tab;
        item.classList.toggle("active", active);
        item.setAttribute("aria-pressed", String(active));
      });
      renderAttendanceHistory();
    });
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
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
  const records = attendanceHistory
    .filter((attendance) => {
      const date = attendance.attendanceDate || (toDate(attendance.clockedInAt) ? toDateKey(toDate(attendance.clockedInAt)) : "");
      return selectedAttendanceRange === "today"
        ? date === today
        : date && dateFromKey(date) >= weekStart;
    })
    .sort((a, b) => (toDate(b.clockedInAt)?.getTime() || 0) - (toDate(a.clockedInAt)?.getTime() || 0));

  if (!records.length) {
    activityList.innerHTML = `<div class="attendance-empty"><span class="material-icons">event_available</span><strong>No attendance records</strong><small>${selectedAttendanceRange === "today" ? "No shift activity has been recorded today." : "No activity was recorded this week."}</small></div>`;
    return;
  }

  activityList.innerHTML = records.map((attendance) => {
    const clockedInAt = toDate(attendance.clockedInAt);
    const label = attendance.status === "pending" ? "Time in request" : attendance.status === "completed" ? "Shift completed" : "Clocked in";
    const status = attendance.status === "pending" ? "pending" : attendance.status === "completed" ? "completed" : "active";
    const icon = status === "pending" ? "hourglass_top" : status === "completed" ? "logout" : "login";
    const dateLabel = clockedInAt ? clockedInAt.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : attendance.attendanceDate || "Today";
    const timeLabel = clockedInAt ? clockedInAt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : "Awaiting approval";
    return `<div class="activity-item"><div class="activity-icon ${status === "completed" ? "out" : ""}"><span class="material-icons">${icon}</span></div><div class="activity-info"><div class="activity-title">${label}</div><div class="activity-time">${dateLabel} · ${timeLabel}</div></div><div class="activity-right"><div class="activity-status ${status}">${status === "active" ? '<span class="status-dot"></span>' : ""}${status === "active" ? "Active" : status === "pending" ? "Pending" : "Completed"}</div></div></div>`;
  }).join("");
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

  unsubscribeAttendance = onSnapshot(attendanceRef, (snapshot) => {
    if (snapshot.exists()) {
      displayAttendance(snapshot.data());
      loadAttendanceStats(context.user.uid);
      return;
    }

    currentAttendance = null;
    showTimeInButton(context);
    showNoAttendance("No time-in request submitted today.");
  });
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

  timeInButton.onclick = async () => {
    if (currentAttendance) return;

    timeInButton.disabled = true;
    timeInButton.textContent = "Sending request...";

    const attendanceData = {
      userId: user.uid,
      fname,
      lname,
      email: user.email || "",
      status: "pending",
      type: "time_in_request",
      attendanceDate: today,
      requestedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    };

    try {
      await setDoc(attendanceRef, attendanceData);
      currentAttendance = attendanceData;
      setTimeInButtonPending();
      displayPendingAttendance(attendanceData);
    } catch (error) {
      console.error("Time in error:", error);
      timeInButton.disabled = false;
      timeInButton.innerHTML = `
        <span class="material-icons">login</span>
        Time In
      `;
      showNoAttendance("Unable to send time-in request. Please try again.");
    }
  };
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

  timeInButton.disabled = true;
  timeInButton.classList.remove("pending", "completed");
  timeInButton.classList.add("active");
  timeInButton.innerHTML = `
    <span class="material-icons">check_circle</span>
    Time In Active
  `;
}
