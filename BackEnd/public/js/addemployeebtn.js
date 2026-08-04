import { addEmployee, loadEmployees } from "/js/adminEmployee.js";
import { db } from "/js/firebase.js";
import {
  collection,
  addDoc,
  onSnapshot,
  serverTimestamp,
  query,
  where,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let unsubscribeRoles = null;

// Populates BOTH the Add Employee "#role" select and the Edit Employee
function loadRoleOptions() {
  const addRoleSelect = document.getElementById("role");
  const editRoleSelect = document.getElementById("edit-role");
  const totalRolesEl = document.getElementById("totalRoles");

  if (!addRoleSelect && !editRoleSelect) return;

  if (unsubscribeRoles) {
    unsubscribeRoles();
  }

  unsubscribeRoles = onSnapshot(collection(db, "roles"), (snapshot) => {
    if (totalRolesEl) {
      totalRolesEl.textContent = snapshot.size;
    }

    if (addRoleSelect && addRoleSelect.isConnected) {
      const previousValue = addRoleSelect.value;

      addRoleSelect.innerHTML = `<option value="" disabled selected>Select Role</option>`;

      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const option = document.createElement("option");
        option.value = data.name;
        option.textContent = data.name;
        addRoleSelect.appendChild(option);
      });

      if (
        previousValue &&
        [...addRoleSelect.options].some((o) => o.value === previousValue)
      ) {
        addRoleSelect.value = previousValue;
      }

      M.FormSelect.init(addRoleSelect);
    }

    if (editRoleSelect && editRoleSelect.isConnected) {
      const previousValue = editRoleSelect.value;

      editRoleSelect.innerHTML = `<option value="" disabled selected>Select Role</option>`;

      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const option = document.createElement("option");
        option.value = data.name;
        option.textContent = data.name;
        editRoleSelect.appendChild(option);
      });

      if (
        previousValue &&
        [...editRoleSelect.options].some((o) => o.value === previousValue)
      ) {
        editRoleSelect.value = previousValue;
      }

      M.FormSelect.init(editRoleSelect);
    }
  });
}

// "Add New Role" button + modal — saves straight to the "roles"
function bindAddRoleButton() {
  const btnAddRole = document.getElementById("btnAddRole");
  const modalElem = document.getElementById("modal-add-role");
  const saveRoleBtn = document.getElementById("save-role");
  const newRoleInput = document.getElementById("new-role");

  if (!btnAddRole || !modalElem || !saveRoleBtn || !newRoleInput) return;

  let modalInstance = M.Modal.getInstance(modalElem);
  if (!modalInstance) {
    modalInstance = M.Modal.init(modalElem);
  }

  btnAddRole.onclick = () => {
    newRoleInput.value = "";
    M.updateTextFields();
    modalInstance.open();
  };

  saveRoleBtn.onclick = async () => {
    const roleName = newRoleInput.value.trim().toUpperCase();

    if (!roleName) {
      M.toast({ html: "Please enter a role name.", classes: "red rounded" });
      return;
    }

    if (roleName === "ADMIN") {
      M.toast({
        html: '"Admin" is already a built-in role.',
        classes: "red rounded",
      });
      return;
    }

    // Everything is stored uppercase, so an exact match here already
    const existing = await getDocs(
      query(collection(db, "roles"), where("name", "==", roleName)),
    );

    if (!existing.empty) {
      M.toast({
        html: "That role already exists.",
        classes: "red rounded",
      });
      return;
    }

    await addDoc(collection(db, "roles"), {
      name: roleName,
      created_at: serverTimestamp(),
    });

    M.toast({ html: "Role added!", classes: "green rounded" });

    newRoleInput.value = "";
    modalInstance.close();
  };
}

function bindAddEmployeeForm() {
  const form = document.getElementById("employeeForm");
  if (!form) return;

  form.onsubmit = async (e) => {
    e.preventDefault();

    const fname = document.getElementById("fname").value;
    const lname = document.getElementById("lname").value;
    const email = document.getElementById("email").value;
    const username = document.getElementById("username").value;
    const role = document.getElementById("role").value;
    const password = document.getElementById("password").value;

    await addEmployee(fname, lname, email, username, role, password);

    form.reset();
    M.updateTextFields();
    M.FormSelect.init(document.querySelectorAll("select"));
  };
}

// Eye icon next to the password field — toggles between hidden (dots)
function bindPasswordToggle() {
  const toggleIcon = document.getElementById("togglePassword");
  const passwordInput = document.getElementById("password");
  if (!toggleIcon || !passwordInput) return;

  toggleIcon.onclick = () => {
    const isHidden = passwordInput.type === "password";
    passwordInput.type = isHidden ? "text" : "password";
    toggleIcon.textContent = isHidden ? "visibility" : "visibility_off";
  };
}

// Called by functionalnav.js every time EmployeeManagement.html load
export function initEmployee() {
  loadRoleOptions();
  bindPasswordToggle();
  bindAddRoleButton();
  bindAddEmployeeForm();
}
