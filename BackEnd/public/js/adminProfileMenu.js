import { auth, db } from "/js/firebase.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

function setProfileText(name, role) {
  ["admin-profile-name", "admin-profile-menu-name"].forEach((id) => {
    const element = document.getElementById(id);
    if (element) element.textContent = name;
  });
  ["admin-profile-role", "admin-profile-menu-role"].forEach((id) => {
    const element = document.getElementById(id);
    if (element) element.textContent = role;
  });
}

async function loadProfile() {
  const isOwner = window.location.pathname.startsWith("/owner/");
  let role = isOwner ? "Owner" : "Administrator";
  const userId = sessionStorage.getItem(isOwner ? "ownerUserDocId" : "adminUserDocId");
  let name = auth.currentUser?.displayName || auth.currentUser?.email || role;

  if (userId) {
    try {
      const snapshot = await getDoc(doc(db, "users", userId));
      const user = snapshot.data() || {};
      const accountRole = String(user.role || "").toLowerCase();
      if (!isOwner && accountRole === "manager") role = "Manager";
      const firstLast = [user.fname || user.firstName, user.lname || user.lastName]
        .filter(Boolean)
        .join(" ")
        .trim();
      name = firstLast || user.fullName || user.name || user.displayName || user.username || name;
    } catch (error) {
      console.error("Unable to load account profile:", error);
    }
  }

  setProfileText(name, role);
}

export function initAdminProfileMenu() {
  const button = document.getElementById("admin-profile-menu-button");
  const panel = document.getElementById("admin-profile-menu-panel");
  if (!button || !panel) return;

  const close = () => {
    panel.hidden = true;
    button.setAttribute("aria-expanded", "false");
  };

  button.addEventListener("click", () => {
    const open = panel.hidden;
    panel.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".admin-profile-menu")) close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });

  const user = auth.currentUser;
  if (user) void loadProfile();
  else {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      unsubscribe();
      if (currentUser) void loadProfile();
    });
  }
}
