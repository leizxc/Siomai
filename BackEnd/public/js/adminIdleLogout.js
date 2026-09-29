import { auth } from "/js/firebase.js";
import { signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const INACTIVITY_LIMIT_MS = 10 * 60 * 1000;
const ACTIVITY_EVENTS = ["pointerdown", "pointermove", "keydown", "scroll", "touchstart"];
const isOwnerPage = window.location.pathname.startsWith("/owner/");
let inactivityTimer;
let isSigningOut = false;

function resetInactivityTimer() {
  if (isSigningOut) return;

  window.clearTimeout(inactivityTimer);
  inactivityTimer = window.setTimeout(() => {
    void logoutAdmin();
  }, INACTIVITY_LIMIT_MS);
}

async function logoutAdmin() {
  if (isSigningOut) return;
  isSigningOut = true;
  window.clearTimeout(inactivityTimer);

  try {
    await signOut(auth);
  } catch (error) {
    console.error("Unable to sign out admin:", error);
  } finally {
    sessionStorage.removeItem(isOwnerPage ? "ownerUserDocId" : "adminUserDocId");
    window.location.replace("/index.html");
  }
}

ACTIVITY_EVENTS.forEach((eventName) => {
  window.addEventListener(eventName, resetInactivityTimer, { passive: true });
});

const logoutLink = document.querySelector(isOwnerPage ? '.sidebar a[href="/"]' : '.sidebar a[href="../index.html"]');
logoutLink?.addEventListener("click", (event) => {
  event.preventDefault();
  void logoutAdmin();
});

resetInactivityTimer();
