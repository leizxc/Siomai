import { db } from "/js/firebase.js";
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  getDoc,
  query,
  where,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const auth = getAuth();

// How many rows show per page in the employee table — the table's
const PAGE_SIZE = 10;
let currentPage = 1;

// Cache of the current (unpaginated) employee list, rebuilt every time
let employeeListCache = [];

function toLocalDateValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Kept live (not a one-time snapshot) so a just-added employee's
let usersMap = {};
let latestEmployeeDocs = [];
let unsubscribeUsers = null;
let unsubscribeEmployees = null;

// Load employees list with username from users collection
export async function loadEmployees() {
  const tbody = document.querySelector("#employeeTable tbody");
  if (tbody) tbody.innerHTML = "";

  if (unsubscribeUsers) unsubscribeUsers();
  if (unsubscribeEmployees) unsubscribeEmployees();

  unsubscribeUsers = onSnapshot(collection(db, "users"), (snapshot) => {
    usersMap = {};
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      usersMap[data.email] = {
        username: data.username,
        status: data.status,
      };
    });
    rebuildEmployeeData();
  });

  //  Real-time listener for employees
  unsubscribeEmployees = onSnapshot(
    collection(db, "employees"),
    (querySnapshot) => {
      latestEmployeeDocs = [];
      querySnapshot.forEach((docSnap) => {
        latestEmployeeDocs.push({ id: docSnap.id, data: docSnap.data() });
      });
      rebuildEmployeeData();
    },
  );
}

// Recomputes the summary cards + employeeListCache from whichever
function rebuildEmployeeData() {
  const tbody = document.querySelector("#employeeTable tbody");
  if (!tbody || !tbody.isConnected) return;

  const today = toLocalDateValue(new Date());

  let activeCount = 0;
  let todayCount = 0;

  employeeListCache = latestEmployeeDocs.map(({ id, data }) => {
    const userInfo = usersMap[data.email] || {};

    if (userInfo.status === "active") activeCount++;

    if (data.created_at) {
      const createdDate = toLocalDateValue(data.created_at.toDate());
      if (createdDate === today) todayCount++;
    }

    return {
      id,
      data,
      username: userInfo.username || "—",
    };
  });

  // Summary cards
  const totalEmployeesEl = document.getElementById("totalEmployees");
  const activeEmployeesEl = document.getElementById("activeEmployees");
  const todayEmployeesEl = document.getElementById("todayEmployees");

  if (totalEmployeesEl) totalEmployeesEl.textContent = employeeListCache.length;
  if (activeEmployeesEl) activeEmployeesEl.textContent = activeCount;
  if (todayEmployeesEl) todayEmployeesEl.textContent = todayCount;

  renderEmployeePage();
}

// Renders whichever page is currently selected, updates
function renderEmployeePage() {
  const tbody = document.querySelector("#employeeTable tbody");
  const showingCountEl = document.getElementById("showingCount");
  const paginationLinks = document.querySelectorAll(".employee-pagination a");
  const prevBtn = paginationLinks[0];
  const nextBtn = paginationLinks[1];

  if (!tbody) return;

  const totalPages = Math.max(
    1,
    Math.ceil(employeeListCache.length / PAGE_SIZE),
  );
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = employeeListCache.slice(start, start + PAGE_SIZE);

  tbody.innerHTML = "";

  pageItems.forEach(({ id, data, username }) => {
    tbody.innerHTML += `
  <tr data-id="${id}">
    <td data-label="First Name">${data.fname}</td>
    <td data-label="Last Name">${data.lname}</td>
    <td data-label="Email">${data.email}</td>
    <td data-label="Username">${username}</td>
    <td data-label="Role">${data.role}</td>
    <td data-label="Action">
      <button class="edit-btn btn blue" data-id="${id}">
        <i class="material-icons">edit</i>
      </button>
      <button class="delete-btn btn red" data-id="${id}">
        <i class="material-icons">delete</i>
      </button>
    </td>
  </tr>
`;
  });

  if (showingCountEl) showingCountEl.textContent = pageItems.length;

  if (prevBtn) {
    prevBtn.classList.toggle("disabled", currentPage <= 1);
    prevBtn.onclick = (e) => {
      e.preventDefault();
      if (currentPage <= 1) return;
      currentPage--;
      renderEmployeePage();
    };
  }

  if (nextBtn) {
    nextBtn.classList.toggle("disabled", currentPage >= totalPages);
    nextBtn.onclick = (e) => {
      e.preventDefault();
      if (currentPage >= totalPages) return;
      currentPage++;
      renderEmployeePage();
    };
  }

  bindRowButtons();
}

function bindRowButtons() {
  // Delete employees
  document.querySelectorAll(".delete-btn").forEach((btn) => {
    btn.onclick = async (e) => {
      const id = e.currentTarget.dataset.id;

      const confirmed = await confirmDeletion(
        "Delete Employee?",
        "This employee will be permanently deleted. This action cannot be undone.",
      );

      if (!confirmed) return;

      await deleteEmployee(id);
    };
  });

  // Edit buttons
  document.querySelectorAll(".edit-btn").forEach((btn) => {
    btn.onclick = (e) => {
      const id = e.currentTarget.dataset.id;
      const row = e.currentTarget.closest("tr");

      // Ang mga orihinal na value bago mag-edit — gagamitin sa pag-check
      // kung talagang may binago bago pumayag mag-submit ng update.
      const originalFname = row.children[0].textContent;
      const originalLname = row.children[1].textContent;
      const originalEmail = row.children[2].textContent;
      const originalRole = row.children[4].textContent;

      document.getElementById("edit-fname").value = originalFname;
      document.getElementById("edit-lname").value = originalLname;
      document.getElementById("edit-email").value = originalEmail;
      document.getElementById("edit-role").value = originalRole;

      M.updateTextFields();
      M.FormSelect.init(document.querySelectorAll("select"));

      const modalElem = document.getElementById("modal-edit-employee");
      let modalInstance = M.Modal.getInstance(modalElem);

      if (!modalInstance) {
        modalInstance = M.Modal.init(modalElem);
      }

      modalInstance.open();

      const saveBtn = document.getElementById("edit-save");

      saveBtn.onclick = async () => {
        const newFname = document.getElementById("edit-fname").value.trim();
        const newLname = document.getElementById("edit-lname").value.trim();
        const newEmail = document.getElementById("edit-email").value.trim();
        const newRole = document.getElementById("edit-role").value;

        // Walang pwedeng maiwan na blangko.
        if (!newFname || !newLname || !newEmail || !newRole) {
          M.toast({
            html: "Please fill in all fields before saving.",
            classes: "red rounded",
          });
          return;
        }

        // Bawal mag-Update kung wala namang binago.
        const noChanges =
          newFname === originalFname &&
          newLname === originalLname &&
          newEmail === originalEmail &&
          newRole === originalRole;

        if (noChanges) {
          M.toast({
            html: "No changes were made.",
            classes: "orange rounded",
          });
          modalInstance.close();
          return;
        }

        await updateDoc(doc(db, "employees", id), {
          fname: newFname,
          lname: newLname,
          email: newEmail,
          role: newRole,
          last_updated: serverTimestamp(),
        });

        const q = query(
          collection(db, "users"),
          where("email", "==", newEmail),
        );

        const snapshot = await getDocs(q);

        try {
          for (const docSnap of snapshot.docs) {
            await updateDoc(docSnap.ref, {
              role: newRole,
              last_updated: serverTimestamp(),
            });
          }
          M.toast({ html: "Update Successfully", classes: "green rounded" });
          modalInstance.close();
        } catch (err) {
          console.error("Update error", err);
          M.toast({ html: "Failed to update", classes: "red rounded" });
        }
      };
    };
  });
}

//hash password
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Blocks obviously weak/guessable usernames: too short, all-digits,
const WEAK_USERNAMES = [
  "admin",
  "administrator",
  "user",
  "guest",
  "test",
  "root",
  "employee",
  "password",
  "12345",
  "qwerty",
];

function isWeakUsername(username) {
  if (!username || username.length < 5) return true;
  if (/^\d+$/.test(username)) return true; // all numbers
  if (/\s/.test(username)) return true; // contains a space
  if (/^(.)\1+$/.test(username)) return true; // same character repeated
  if (WEAK_USERNAMES.includes(username.toLowerCase())) return true;
  return false;
}

//  Add employee securely with Firebase Auth
export async function addEmployee(
  fname,
  lname,
  email,
  username,
  role,
  password,
) {
  try {
    // Materialize-enhanced <select> elements don't reliably enforce
    if (!role || !role.trim()) {
      M.toast({
        html: "Please select a role before adding the employee.",
        classes: "red rounded",
      });
      return;
    }

    const normalizedUsername = username.trim().toLowerCase();

    if (isWeakUsername(normalizedUsername)) {
      M.toast({
        html: "Username is too weak. Use at least 5 characters, not all numbers, and not a common word like 'admin' or 'test'.",
        classes: "red rounded",
      });
      return;
    }

    const q = query(collection(db, "users"), where("email", "==", email));
    const snapshot = await getDocs(q);

    if (!snapshot.empty) {
      M.toast({ html: "Email already exists!", classes: "red rounded" });
      return;
    }

    const usernameQuery = query(
      collection(db, "users"),
      where("username", "==", normalizedUsername),
    );
    const usernameSnapshot = await getDocs(usernameQuery);

    if (!usernameSnapshot.empty) {
      M.toast({ html: "Username is already taken.", classes: "red rounded" });
      return;
    }

    const API_BASE = window.location.origin;
    const idToken = await auth.currentUser.getIdToken();

    const authRes = await fetch(`${API_BASE}/createAuthUser`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${idToken}`,
        "Content-type": "application/json",
      },
      body: JSON.stringify({
        email,
        password,
      }),
    });

    const authResult = await authRes.json();
    if (!authResult.success) {
      M.toast({
        html: authResult.error,
        classes: "red rounded",
      });
      return;
    }

    const uid = authResult.uid;

    await addDoc(collection(db, "employees"), {
      uid,
      fname,
      lname,
      email,
      role,
      created_at: serverTimestamp(),
    });
    const hashvalue = await hashPassword(password);
    await addDoc(collection(db, "users"), {
      username: normalizedUsername,
      email,
      role,
      status: "active",
      passwordHash: hashvalue, // store hashed password
      created_at: serverTimestamp(),
    });

    M.toast({ html: "Employee added successfully!", classes: "green rounded" });
  } catch (error) {
    console.error("Error adding employee:", error);
    M.toast({ html: "Failed to add employee.", classes: "red rounded" });
  }
}

//delete role
// Delete role — only if no user is currently assigned to it
export async function deleteRole() {
  const roleSelect = document.getElementById("role");
  const roleName = roleSelect ? roleSelect.value : "";
  console.log("DEBUG deleteRole roleName:", roleName);

  if (!roleName) {
    M.toast({ html: "Please select a role", classes: "red rounded" });
    return;
  }

  const inUse = await getDocs(
    query(collection(db, "users"), where("role", "==", roleName)),
  );
  if (!inUse.empty) {
    M.toast({
      html: "Cannot delete. This role still has users.",
      classes: "red rounded",
    });
    return;
  }

  // option.value stores the role NAME, not the Firestore doc ID
  const roleDoc = await getDocs(
    query(collection(db, "roles"), where("name", "==", roleName)),
  );
  if (roleDoc.empty) {
    M.toast({ html: "Role not found.", classes: "red rounded" });
    return;
  }

  await deleteDoc(roleDoc.docs[0].ref);
  M.toast({ html: "Role deleted", classes: "green rounded" });
}

//confirmation delete
function confirmDeletion(title, message) {
  const modalElement = document.getElementById("modal-delete-category");
  const confirmButton = document.getElementById("confirm-delete-category");
  const cancelButton = document.getElementById("cancel-delete-category");
  const titleElement = document.getElementById("delete-confirmation-title");
  const messageElement = document.getElementById("delete-confirmation-message");
  if (!modalElement || !confirmButton || !cancelButton) {
    return Promise.resolve(false);
  }
  const modalInstance = M.Modal.init(modalElement, { dismissible: false });

  if (titleElement) titleElement.textContent = title;
  if (messageElement) messageElement.textContent = message;

  return new Promise((resolve) => {
    cancelButton.onclick = () => {
      modalInstance.close();
      resolve(false);
    };

    confirmButton.onclick = () => {
      modalInstance.close();
      resolve(true);
    };

    modalInstance.open();
  });
}

// Delete employee
export async function deleteEmployee(id) {
  try {
    const employeeRef = doc(db, "employees", id);
    const employeeSnap = await getDoc(employeeRef);

    if (!employeeSnap.exists()) {
      M.toast({
        html: "Employee not found.",
        classes: "red rounded",
      });
      return;
    }

    const employeeData = employeeSnap.data();
    const uid = employeeData.uid;
    const email = employeeData.email;
    const role = employeeData.role?.toLowerCase();

    if (role === "admin") {
      M.toast({
        html: "Admin accounts cannot be deleted.",
        classes: "red rounded",
      });
      return;
    }

    if (!uid) {
      M.toast({
        html: "No UID found for this employee.",
        classes: "red rounded",
      });
      return;
    }

    const idToken = await auth.currentUser?.getIdToken();

    if (!idToken) {
      M.toast({
        html: "Your session has expired. Please sign in again.",
        classes: "red rounded",
      });
      return;
    }

    const API_BASE = window.location.origin;

    // STEP 1: Delete Firebase Auth FIRST
    const res = await fetch(`${API_BASE}/deleteAuthUser`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${idToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ uid }),
    });

    const result = await res.json();

    if (!result.success) {
      M.toast({
        html: result.error || "Unable to delete authentication account.",
        classes: "red rounded",
      });
      return;
    }

    // STEP 2: Delete employee document
    await deleteDoc(employeeRef);

    // STEP 3: Delete users document
    const q = query(collection(db, "users"), where("email", "==", email));

    const snapshot = await getDocs(q);

    for (const docSnap of snapshot.docs) {
      await deleteDoc(docSnap.ref);
    }

    M.toast({
      html: "Employee deleted successfully!",
      classes: "green rounded",
    });
  } catch (error) {
    console.error("Error deleting employee:", error);

    M.toast({
      html: "Failed to delete employee.",
      classes: "red rounded",
    });
  }
}
