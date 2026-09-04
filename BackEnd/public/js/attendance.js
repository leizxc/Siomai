// ATTENDANCE PAGE

import { app } from "/js/firebase.js";

import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const auth = getAuth(app);
const db = getFirestore(app);

let attendanceInitialized = false;

// INITIALIZE ATTENDANCE

export async function initAttendance() {
  if (attendanceInitialized) return;

  attendanceInitialized = true;

  try {
    const user = auth.currentUser;

    // Walang naka login
    if (!user) {
      console.warn("No logged-in user found.");

      showNoAttendance("No logged-in user.");

      return;
    }

    console.log("Attendance user:", user.uid);

    // TODAY'S DOCUMENT ID

    const today = getTodayDate();

    const attendanceId = `${user.uid}_${today}`;

    const attendanceRef = doc(db, "attendance", attendanceId);

    // CHECK EXISTING ATTENDANCE

    const attendanceSnapshot = await getDoc(attendanceRef);

    if (attendanceSnapshot.exists()) {
      console.log("Attendance already recorded today.");

      displayAttendance(attendanceSnapshot.data());

      return;
    }

    // AUTOMATIC CLOCK IN

    const attendanceData = {
      userId: user.uid,

      email: user.email || "",

      status: "active",

      type: "clocked_in",

      clockedInAt: serverTimestamp(),

      createdAt: serverTimestamp(),
    };

    await setDoc(attendanceRef, attendanceData);

    console.log("Attendance successfully recorded.");

    // Display current time immediately
    displayAttendance({
      ...attendanceData,

      clockedInAt: new Date(),
    });
  } catch (error) {
    console.error("Attendance initialization error:", error);

    showNoAttendance("Unable to load attendance.");
  }
}

// GET TODAY'S DATE

function getTodayDate() {
  const date = new Date();

  const year = date.getFullYear();

  const month = String(date.getMonth() + 1).padStart(2, "0");

  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

// DISPLAY ATTENDANCE

function displayAttendance(attendance) {
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

  // FORMAT TIME

  const formattedTime = clockedInTime.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });

  // FORMAT DATE

  const formattedDate = clockedInTime.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  // DISPLAY

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

// EMPTY / ERROR STATE

function showNoAttendance(message) {
  const activityList = document.querySelector(".activity-list");

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

// CLEANUP

export function stopAttendancePage() {
  attendanceInitialized = false;

  console.log("Attendance page stopped.");
}
